# Contributing to Filler

Thank you for helping improve Filler. The project is an experimental meeting-intelligence system, so contributions should be honest about accuracy and preserve evidence for every generated claim.

## Before you start

- Search existing issues and pull requests before beginning work.
- For a small bug, test, or documentation correction, you can open a pull request directly.
- For a new model, dependency, API, schema change, or major architecture change, open an issue first and describe the intended trade-offs.
- Use only audio you are legally allowed to process. Prefer synthetic, public, or explicitly consented recordings.
- Never commit secrets, private recordings, real meeting transcripts, participant information, downloaded model weights, caches, or local environment files.

## Development setup

Requirements:

- Node.js 22 or newer
- npm
- FFmpeg and ffprobe
- Python 3.11 or 3.12 for speech-model work

Clone your fork and install the TypeScript dependencies:

```bash
git clone https://github.com/YOUR_USERNAME/filler.git
cd filler
npm ci
npm run check
npm test
npm run web:check
npm run web:build
```

The TypeScript tests do not require speech-model downloads.

For ASR work, create an isolated Python environment:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r workers/speech/requirements-asr-tested.txt
npm run worker:test
```

Speaker diarization is optional and substantially larger. Install it only when your contribution requires it:

```bash
.venv/bin/python -m pip install -r workers/speech/requirements-diarization.txt
```

Diarization also requires accepting the upstream model conditions and configuring `HF_TOKEN` locally. Do not include tokens in issues, logs, screenshots, commits, or pull requests.

## Project boundaries

- Keep application and orchestration code in TypeScript.
- Use Python only where speech or ML libraries require it.
- Do not label uncertain speaker identities as confirmed.
- AI notes must retain transcript evidence IDs.
- Do not claim noisy-room, overlap, latency, or accuracy improvements without a reproducible evaluation.
- Preserve localhost-only and privacy-safe defaults unless a reviewed security design replaces them.

## Making a change

1. Create a focused branch from the latest `main`.
2. Add or update tests that demonstrate the behavior.
3. Keep unrelated formatting and refactors out of the change.
4. Update documentation when behavior, configuration, or limitations change.
5. Run the relevant validation commands.

```bash
npm run check
npm run web:check
npm test
npm run worker:test
npm run web:build
```

Model-dependent tests may be documented separately when they require gated weights or special hardware.

## Commit and pull request guidance

Use a short conventional commit where practical:

```text
feat: add speaker review control
fix: preserve names across transcript revisions
test: cover ambiguous diarization clusters
docs: explain CPU-only setup
```

A pull request should include:

- What changed and why
- The user-visible effect
- Tests and commands executed
- Before/after measurements for performance or accuracy changes
- Screenshots for UI changes
- Known limitations and untested environments
- Confirmation that no private data or secrets are included

Keep pull requests small enough to review. Review feedback may request additional evidence, tests, or narrower scope.

## Useful contribution areas

- Annotated synthetic overlap fixtures
- Word error rate and diarization error rate evaluation
- Stable speaker reconciliation across rolling windows
- Transcript correction and speaker-confirmation UX
- CPU memory and latency reductions
- Accessibility and keyboard navigation
- Clear failure messages and setup diagnostics
- Documentation for reproducible local experiments

## Reporting bugs

Include the operating system, Node and Python versions, the command used, sanitized logs, and a minimal reproduction. For speech-quality bugs, describe the audio conditions without uploading a private recording. If a public or synthetic clip reproduces the issue, link it and include the expected transcript or speaker labels.
