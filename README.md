# filler

Meeting intelligence for noisy, overlapping conversations — a DNE Labs research project.

## Goal

Turn meetings with 4–8 participants into speaker-labelled transcripts, action items, decisions, disagreements, explicit consensus, and unresolved questions, each traceable to the original conversation.

**Status: foundation only.** This repository currently validates structured meeting records and renders an evidence-linked report from a synthetic fixture. It does not yet transcribe audio, identify speakers, extract insights automatically, or stream live meetings. Robust overlapping-speech recognition remains a research and evaluation objective, not a claimed capability.

## Run the foundation demo

Python 3.11+; no external dependencies or GPU required.

```bash
python -m filler examples/meeting.json
python -m unittest discover -s tests -v
```

The CLI prints Markdown to stdout. Input must contain finite timestamps, known speaker IDs (or null for unknown), unique segment and insight IDs, and valid evidence references. Overlapping intervals are deliberately allowed. Insight ownership is an explicit field: the person speaking is not automatically the task owner. Validation checks structure and references, not factual correctness of an insight.

## Layout

- `filler/`: meeting contract, validation, report CLI
- `examples/meeting.json`: synthetic meeting with overlapping speech and uncertain attribution
- `tests/`: contract and report checks
- `docs/PLAN.md`: phases, architecture, and evaluation gates

Start with recorded audio, measure the baseline, then add streaming. Preserve separate microphone channels when available. Speaker labels such as S1 are anonymous until a participant confirms the mapping to a name.
