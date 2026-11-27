# filler

Meeting intelligence for noisy, overlapping conversations — DNE Labs.

**TypeScript first. Python only for speech models.** Target: speaker-labelled transcripts and evidence-linked action items, decisions, disagreements, consensus, and unresolved questions for 4–8-person meetings.

## What works now

- TypeScript CLI for recorded audio, FFmpeg normalization, schema validation, overlap-aware word attribution, and Markdown reports with evidence links.
- Python subprocess running faster-whisper with word timestamps, model revision capture, stage timing, and CPU/GPU options.
- Optional pyannote Community-1 adapter retaining overlapping speaker turns. **Requires gated model access and has not yet been end-to-end tested here.**
- Regression tests, synthetic attribution experiment, and CPU ASR experiment tooling.

This is a recorded-audio research baseline. No live streaming, UI, automatic insight extraction, speech separation, or validated noisy 4–8-speaker performance yet. Whisper alone does not reliably recover every simultaneous voice. Unknown speakers stay unknown; timestamps are not calibrated confidence scores. The example meeting insights are manually authored.

## Quick start (Node 22+)

```bash
npm ci
npm run check
npm test
npm run demo
npm run experiment
mkdir -p outputs
npm run align -- examples/raw-overlap.json --out outputs/overlap-demo
```

Use a **new output directory** for each run. Parent directories must already exist. Output: `raw.json` (words and turns), `meeting.json` (attribution), and `report.md`. Failed runs contain `FAILED.txt`; they are not successful results.

## Transcribe real audio (Linux / Colab)

Install FFmpeg/ffprobe and Python 3.11 or 3.12. The model worker uses Unix file-descriptor redirection; Windows users should use WSL.

```bash
python -m venv .venv
.venv/bin/pip install -r workers/speech/requirements-asr-tested.txt
npm run transcribe -- /absolute/path/meeting.wav \
  --out outputs/meeting-01 --python .venv/bin/python --language en
```

Default: `Systran/faster-whisper-tiny.en`, CPU INT8, four CPU threads, beam size 1, VAD off. This small English model is for smoke tests, not the final accuracy target. Internet is needed on the first model download. For multilingual recordings choose a multilingual model repository; omit `--language` for detection. Use `--model REPO --revision COMMIT_SHA` for a fixed ASR snapshot. Resolved ASR SHA is recorded even when `main` is requested.

For a CUDA environment with compatible CTranslate2 libraries, pass `--device cuda --compute-type float16`. GPU execution is not validated by our CPU experiment.

### Add speaker diarization

Accept the model's conditions yourself at [Community-1](https://huggingface.co/pyannote/speaker-diarization-community-1), then provide `HF_TOKEN` securely in your shell (never commit it).

```bash
.venv/bin/pip install -r workers/speech/requirements-diarization.txt
npm run transcribe -- /absolute/path/meeting.wav \
  --out outputs/meeting-diarized --python .venv/bin/python --diarize --speakers 4
```

Omit `--speakers` when the count is unknown. ASR-only mode leaves every speaker unassigned; it does not pretend to diarize. Diarization uses anonymous IDs, not real names. This optional dependency range and pipeline revision remain unpinned pending validation; it is not a reproducible diarization benchmark yet.

## Experiment

See [experiment notes](docs/EXPERIMENTS.md) and committed [results](experiments/results).

```bash
npm run benchmark -- --audio /path/to/clip.wav --reference /path/to/reference.txt \
  --out outputs/benchmark.json --python .venv/bin/python
.venv/bin/python -m unittest discover -s workers/speech -p 'test_*.py' -v
```

The benchmark compares CPU INT8 and FP32 on the same clip; it records model load, ASR time, total worker time, audio duration, normalized WER, hardware, dependencies, and model revision. It does not measure diarization, GPU VRAM, or production concurrency.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/` | TypeScript contracts, alignment, reports, pipeline, CLI, metrics |
| `workers/speech/` | Python model inference only, plus worker tests |
| `experiments/` | TypeScript experiments and measured/synthetic results |
| `examples/` | Synthetic fixtures and public-speech reference text |
| `tests/` | TypeScript regression and CLI integration tests |
| `docs/PLAN.md` | Phases and evaluation gates |

The old Python application has been replaced by TypeScript; `python -m filler` is no longer the entry point.

## Limits and next work

The current audio path downmixes the first stream to mono 16kHz and records source channel metadata; the original file is not modified. Separate-microphone processing remains future work. Limits: two-hour input, 30-minute worker timeout, 32MB captured worker output. This is a local CLI, not a secured multi-user server. Keep consented recordings, names, tokens, and private transcripts out of git.

Next: validate diarization on an annotated multi-speaker recording, measure word/speaker errors in overlap, then add evidence-grounded reasoning and an Express/Next.js review UI. [Full plan](docs/PLAN.md).
