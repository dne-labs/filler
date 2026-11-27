# Experiments — 2026-11-27

## 1. Timestamp attribution policy (synthetic)

Command: `npm run experiment`. Results: `experiments/results/attribution.json`.

Seven hand-authored cases cover clean speech, simultaneous speech, a short interruption, a speaker boundary, silence, weak support, and duplicate turns. A maximum-overlap baseline agrees with the predefined assignment/abstention policy in 2/7 cases; the conservative implementation agrees in 7/7. This is a regression experiment designed around the policy, not an acoustic accuracy benchmark. Assignment coverage decreases deliberately: ambiguous words remain null and retain candidate labels.

## 2. Actual CPU speech recognition

Source: [OpenAI Whisper's JFK test clip](https://github.com/openai/whisper/blob/main/tests/jfk.flac), an 11-second excerpt of the 1961 inaugural address. Downloaded from `https://raw.githubusercontent.com/openai/whisper/main/tests/jfk.flac`; exact bytes identified by SHA256 `63a4b1e4c1dc655ac70961ffbf518acd249df237e5a0152faae9a4a836949715`. Audio is not committed. The reference text is in `examples/jfk-reference.txt`.

Hardware: AMD EPYC 7763 host, four inference threads; Python 3.12.14; Node 24.22.3. Model: `Systran/faster-whisper-tiny.en`, snapshot `0d3d19a32d3338f10357c0889762bd8d64bbdeba`. Beam size 1, VAD off, English explicitly selected. Input was stereo 44.1kHz, downmixed to mono 16kHz for this baseline.

| Precision | Normalized WER | ASR time | Resolve/load time | Worker total | Full pipeline |
| --- | --- | --- | --- | --- | --- |
| INT8 | 0/22 words (0%) | 0.574s | 5.718s | 6.302s | 7.205s |
| FP32 | 0/22 words (0%) | 0.714s | 5.544s | 6.280s | 7.110s |

Results: `experiments/results/asr-cpu.json`. One sequential run per precision, fresh worker processes, previously downloaded model cache. Resolve/load includes Hugging Face snapshot resolution and model construction. ASR time includes consumption of the lazy transcription iterator. Pipeline time includes probing, normalization, subprocess imports/startup and inference, but excludes report serialization. WER lowercases and strips punctuation except apostrophes; it does not score speaker attribution.

**Interpretation:** real CPU transcription works on this single clean-speaker clip. INT8's timed ASR stage was shorter in this run, while total time was essentially unchanged. This is not proof of general speedup, production capacity, meeting accuracy, or overlapping-speech recovery. No speaker labels were generated: the diarization adapter was not run.

To reproduce (download outside the repository or into ignored data/):

```bash
curl -fL https://raw.githubusercontent.com/openai/whisper/main/tests/jfk.flac -o /tmp/filler-jfk.flac
npm run benchmark -- --audio /tmp/filler-jfk.flac --reference examples/jfk-reference.txt \
  --out outputs/asr-cpu.json --python .venv/bin/python
```

Use a new output file and create its parent first. The benchmark refuses to overwrite prior results. For stronger timing conclusions, repeat with warm persistent models, randomize precision order, use multiple recordings, and report dispersion.

## Validation and integration findings

- TypeScript static check and 12 tests pass, including CLI output and overwrite refusal.
- Three Python tests pass, including a regression for native libraries writing to stdout. The worker now redirects native and Python logs to stderr so stdout stays valid JSON.
- The public-audio CLI completed with 22 words, all speakers intentionally unknown in ASR-only mode.
- ASR runtime dependency snapshot is committed. `socksio` was required by this workspace's proxy and is included in that snapshot; ordinary networks may not require it.
- Real pyannote inference, GPU execution, multi-speaker DER, noisy/overlap WER, insight extraction accuracy, and live streaming are **not tested**.

## Next experiment

Use a consented or appropriately licensed recording with at least four speakers, annotated word timestamps, speaker identities, and overlapping regions. Validate the optional pyannote adapter after accepting the model conditions. Measure speaker-attributed WER and DER with overlap included, then compare conservative attribution against the maximum-overlap baseline on held-out data. Include assignment coverage so abstention cannot masquerade as improved overall accuracy.
