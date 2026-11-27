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
        pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-community-1", token=os.environ["HF_TOKEN"])
        pipeline.to(torch.device(args.device))
        kwargs = {"num_speakers": args.speakers} if args.speakers else {}
        output = pipeline({"waveform": torch.from_numpy(audio.copy()).unsqueeze(0), "sample_rate": 16000}, **kwargs)
        # Use regular, not exclusive, diarization so simultaneous speakers survive.
        for span, speaker in output.speaker_diarization:
            if span.end > span.start:
                turns.append({"start": max(0.0, span.start), "end": min(len(audio) / 16000, span.end), "speaker": speaker})
        diarization = {"status": "completed", "model": "pyannote/speaker-diarization-community-1",
                       "revision": "unresolved (pipeline default)", "seconds": time.perf_counter() - diar_start,
                       "packageVersion": importlib.metadata.version("pyannote.audio")}
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
