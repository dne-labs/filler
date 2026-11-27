"""Model-only subprocess. One JSON document on stdout; progress/errors on stderr."""
import argparse
import contextlib
import ctypes
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import sys
import time
import wave
from types import SimpleNamespace


@contextlib.contextmanager
def model_output_to_stderr():
    """Redirect both Python prints and native-library writes away from JSON stdout."""
    sys.stdout.flush()
    saved = os.dup(1)
    try:
        os.dup2(2, 1)
        with contextlib.redirect_stdout(sys.stderr):
            yield
    finally:
        # Flush native stdio before restoring fd 1 (Linux/macOS worker runtime).
        ctypes.CDLL(None).fflush(None)
        os.dup2(saved, 1)
        os.close(saved)


def read_audio(path):
    import numpy as np
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 16000):
            raise ValueError("Worker requires mono 16kHz signed 16-bit PCM WAV")
        samples = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    if not len(samples):
        raise ValueError("Empty audio")
    return samples


def speaker_embedding(samples, cache, device):
    import numpy as np
    import torch
    from pyannote.audio import Inference, Model
    if not os.environ.get("HF_TOKEN"):
        raise ValueError("speaker identification requires HF_TOKEN")
    key = ("speaker-embedding", device)
    inference = cache.get(key)
    if inference is None:
        try:
            model = Model.from_pretrained("pyannote/wespeaker-voxceleb-resnet34-LM", token=os.environ["HF_TOKEN"])
        except TypeError:
            model = Model.from_pretrained("pyannote/wespeaker-voxceleb-resnet34-LM", use_auth_token=os.environ["HF_TOKEN"])
        model.to(torch.device(device))
        inference = Inference(model, window="whole")
        inference.to(torch.device(device))
        cache[key] = inference
    waveform = torch.from_numpy(samples.astype(np.float32, copy=False)).unsqueeze(0)
    embedding = np.asarray(inference({"waveform": waveform, "sample_rate": 16000})).reshape(-1)
    norm = np.linalg.norm(embedding)
    if not np.isfinite(norm) or norm == 0:
        raise ValueError("invalid speaker embedding")
    return (embedding / norm).astype(np.float32)


def match_creator(audio, turns, reference, cache, device):
    import numpy as np
    labels = sorted({turn["speaker"] for turn in turns})
    scores = []
    for label in labels:
        clean = []
        for turn in turns:
            if turn["speaker"] != label or turn["end"] - turn["start"] < 0.5:
                continue
            overlaps_other = any(
                other["speaker"] != label
                and min(turn["end"], other["end"]) > max(turn["start"], other["start"])
                for other in turns
            )
            if not overlaps_other:
                clean.append(turn)
        if sum(turn["end"] - turn["start"] for turn in clean) < 2.0:
            continue
        pieces = []
        remaining = 15.0
        for turn in clean:
            duration = min(turn["end"] - turn["start"], remaining)
            if duration <= 0:
                break
            start = int(turn["start"] * 16000)
            pieces.append(audio[start:start + int(duration * 16000)])
            remaining -= duration
        if pieces:
            candidate = speaker_embedding(np.concatenate(pieces), cache, device)
            scores.append((label, float(np.dot(reference, candidate))))
    scores.sort(key=lambda item: item[1], reverse=True)
    if not scores:
        return {"speaker": None, "similarity": None, "confident": False, "reason": "not enough clean speech"}
    best = scores[0]
    second = scores[1][1] if len(scores) > 1 else -1.0
    threshold = float(os.environ.get("FILLER_CREATOR_THRESHOLD", "0.72"))
    margin = float(os.environ.get("FILLER_CREATOR_MARGIN", "0.08"))
    return {
        "speaker": best[0],
        "similarity": round(best[1], 4),
        "secondBestSimilarity": round(second, 4) if second >= -0.5 else None,
        "confident": best[1] >= threshold and best[1] - second >= margin,
        "threshold": threshold,
        "margin": margin,
        "calibration": "prototype; confirm in UI",
    }


def infer(args, cache=None):
    from faster_whisper import WhisperModel
    from huggingface_hub import snapshot_download
    started = time.perf_counter()
    audio = read_audio(args.audio)
    if args.diarize and not os.environ.get("HF_TOKEN"):
        raise ValueError("--diarize requires HF_TOKEN and accepted community-1 model conditions")
    # Resolve an immutable snapshot and record its SHA, even when the requested revision is main.
    model_path = snapshot_download(args.model, revision=args.revision,
                                   allow_patterns=["model.bin", "config.json", "tokenizer.json", "vocabulary.*", "preprocessor_config.json"])
    model_key = (model_path, args.device, args.compute_type)
    model = cache.get(model_key) if cache is not None else None
    if model is None:
        model = WhisperModel(model_path, device=args.device, compute_type=args.compute_type, cpu_threads=4)
        if cache is not None:
            cache[model_key] = model
    loaded = time.perf_counter()
    segments, info = model.transcribe(
        audio,
        word_timestamps=True,
        beam_size=args.beam_size,
        language=args.language,
        vad_filter=True,
        initial_prompt=args.initial_prompt,
        hotwords=args.hotwords,
    )
    words = []
    dropped = 0
    for segment in segments:  # faster-whisper is lazy; consume inside the inference timer.
        for word in segment.words or []:
            if word.end <= word.start or not word.word.strip():
                dropped += 1
                continue
            words.append({"id": f"w{len(words)}", "start": word.start, "end": word.end, "text": word.word.strip()})
    asr_done = time.perf_counter()
    if cache is None:
        del model
    turns = []
    diarization = {"status": "not-requested"}
    if args.diarize:
        import torch
        from pyannote.audio import Pipeline
        diar_start = time.perf_counter()
        pipeline_key = ("diarization", args.device)
        pipeline = cache.get(pipeline_key) if cache is not None else None
        if pipeline is None:
            pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-community-1", token=os.environ["HF_TOKEN"])
            pipeline.to(torch.device(args.device))
            if cache is not None:
                cache[pipeline_key] = pipeline
        kwargs = {"num_speakers": args.speakers} if args.speakers else {}
        output = pipeline({"waveform": torch.from_numpy(audio.copy()).unsqueeze(0), "sample_rate": 16000}, **kwargs)
        # Use regular, not exclusive, diarization so simultaneous speakers survive.
        for span, speaker in output.speaker_diarization:
            if span.end > span.start:
                turns.append({"start": max(0.0, span.start), "end": min(len(audio) / 16000, span.end), "speaker": speaker})
        diarization = {"status": "completed", "model": "pyannote/speaker-diarization-community-1",
                       "revision": "unresolved (pipeline default)", "seconds": time.perf_counter() - diar_start,
                       "detectedSpeakers": len({turn["speaker"] for turn in turns}),
                       "packageVersion": importlib.metadata.version("pyannote.audio")}
    creator_match = None
    if args.creator_embedding:
        import numpy as np
        reference = np.asarray(json.loads(args.creator_embedding), dtype=np.float32)
        norm = np.linalg.norm(reference)
        if reference.ndim != 1 or reference.size < 32 or not np.isfinite(norm) or norm == 0:
            raise ValueError("invalid creator embedding")
        creator_match = match_creator(audio, turns, reference / norm, cache if cache is not None else {}, args.device)
    elapsed = time.perf_counter() - started
    duration = len(audio) / 16000
    return {"schemaVersion": 1, "duration": duration, "words": words, "turns": turns,
            "metadata": {"asrModel": args.model, "requestedRevision": args.revision,
                         "resolvedRevision": Path(model_path).name, "device": args.device, "computeType": args.compute_type,
                         "cpuThreads": 4, "beamSize": args.beam_size, "vadFilter": True, "language": info.language,
                         "contextBias": bool(args.initial_prompt or args.hotwords),
                         "droppedInvalidWords": dropped, "modelLoadSeconds": loaded - started,
                         "asrSeconds": asr_done - loaded, "workerSeconds": elapsed,
                         "workerRtf": elapsed / duration, "diarization": diarization,
                         "creatorMatch": creator_match,
                         "python": platform.python_version(), "machine": platform.machine(),
                         "packages": {p: importlib.metadata.version(p) for p in ["faster-whisper", "ctranslate2", "huggingface-hub", "numpy"]}}}


def build_parser():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio")
    parser.add_argument("--model", default="Systran/faster-whisper-tiny.en")
    parser.add_argument("--revision", default="main")
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--compute-type", choices=["int8", "float16", "float32"], default="int8")
    parser.add_argument("--language")
    parser.add_argument("--diarize", action="store_true")
    parser.add_argument("--speakers", type=int)
    parser.add_argument("--initial-prompt")
    parser.add_argument("--hotwords")
    parser.add_argument("--beam-size", type=int, choices=range(1, 6), default=3)
    parser.add_argument("--creator-embedding")
    parser.add_argument("--serve", action="store_true")
    return parser


def safe_worker_error(error):
    message = str(error)
    if "No module named" in message:
        return "A required Python speech dependency is missing. Run npm run doctor."
    if "HF_TOKEN" in message or "GatedRepoError" in message or "401" in message or "403" in message:
        return "Diarization model access failed. Check HF_TOKEN and accepted model conditions."
    if "out of memory" in message.lower() or "bad_alloc" in message.lower():
        return "The speech model ran out of memory. Choose a smaller FILLER_ASR_MODEL."
    return "Speech inference failed. Run npm run doctor and inspect the server terminal."


def serve(parser):
    cache = {}
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if request.get("action") == "enroll":
                audio = read_audio(request["audio"])
                if len(audio) < 3 * 16000 or len(audio) > 12 * 16000:
                    raise ValueError("creator enrollment must contain 3 to 12 seconds of audio")
                with model_output_to_stderr():
                    embedding = speaker_embedding(audio, cache, request.get("device", "cpu"))
                result = {"embedding": embedding.tolist()}
            else:
                args = parser.parse_args(request["args"])
                if not args.audio:
                    raise ValueError("audio is required")
                with model_output_to_stderr():
                    result = infer(args, cache)
            response = {"ok": True, "result": result}
        except Exception as error:
            print(f"speech worker error: {type(error).__name__}: {error}", file=sys.stderr)
            response = {"ok": False, "error": safe_worker_error(error)}
        print(json.dumps(response, allow_nan=False), flush=True)


def main():
    parser = build_parser()
    args = parser.parse_args()
    if args.serve:
        serve(parser)
        return
    if not args.audio:
        parser.error("--audio is required")
    if args.speakers is not None and (not args.diarize or not 1 <= args.speakers <= 32):
        parser.error("--speakers requires --diarize and a count from 1 to 32")
    with model_output_to_stderr():
        result = infer(args)
    print(json.dumps(result, allow_nan=False))


if __name__ == "__main__":
    main()
