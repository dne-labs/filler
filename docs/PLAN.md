# Filler implementation plan

## Problem and scope

Target meetings contain 4–8 participants, room noise, reverberation, interruptions, and simultaneous speakers. Four to eight attendees does not imply recoverable transcription of eight simultaneous voices from one microphone. The system must retain uncertainty and permit corrections instead of inventing missing speech or owners.

## Planned architecture

Audio ingestion → timestamped ASR + diarization → overlap-aware word/speaker alignment → versioned transcript → evidence-grounded insight extraction → review UI.

Preserve original audio and channel/time offsets. ASR words and diarization turns are separate records; overlapping intervals must not be collapsed into a single speaker. Speaker embeddings and clustering provide anonymous identities, not real names. A confirmed participant mapping supplies names.

Every insight includes a kind, text, evidence segment IDs, optional owner, and review status. Never infer consensus from silence, equate a proposal with a decision, or assign a task to its speaker by default. Model suggestions remain reviewable; evidence links alone do not establish entailment.

## Phases and completion gates

### 0 — Contracts and reproducible fixture (implemented in TypeScript)
- Structured meeting JSON; anonymous or unknown speakers; overlapping turns.
- Action, decision, disagreement, consensus, and unresolved insight types.
- Reference validation, Markdown report, synthetic demo, regression tests.
- Gate: local tests pass; demo explicitly labelled synthetic.

### 1 — Recorded-audio baseline (in progress)
- TypeScript CLI, audio preparation, validation, alignment, reports, and evaluation. Python is confined to speech model inference. ASR adapter implemented; optional diarization adapter awaits gated-model validation.
- Candidate experiments: Whisper-family ASR and pyannote diarization; evaluate alternatives before selecting defaults.
- Normalize audio without losing channel provenance; export word timestamps and speaker turns separately.
- Align words against turns; retain unknown/ambiguous assignments in overlaps.
- Measure a short, consented, annotated recording on CPU or Colab T4; record hardware, precision, model revisions, wall time, and peak memory.
- Gate: reproducible audio-to-transcript run and measured baseline, not synthetic output.

### 2 — Overlap and noise experiments
- Establish test strata: clean/noisy, near/far microphone, 4/6/8 participants, low/high overlap, single/multiple channels, English and separately evaluated Hindi/code-switching.
- Compare overlap detection and selective separation against the unseparated baseline. Separation may distort audio or swap identities; evaluate both errors.
- Gate: measured gains on held-out overlap clips without unacceptable regression on clean speech. Report failures, including unintelligible simultaneous speech.

### 3 — Grounded meeting reasoning
- Add a structured-output LLM adapter with exact evidence references and nullable ownership/deadlines.
- Retrieve full transcript evidence when merging window summaries; track proposals, decisions, reversals, disputes, and unresolved threads across a meeting.
- Revalidate insights when transcripts or speaker mappings are corrected.
- Gate: manually annotated insight precision/recall, owner accuracy, unsupported-claim rate, and evidence correctness on held-out meetings.

### 4 — Streaming and review UI (near-live local prototype implemented)
- Implemented: Express/TypeScript localhost session API and a TypeScript browser dashboard using cumulative WAV snapshots over HTTP. AI notes and contextual name hypotheses use a configurable compatible model endpoint. See docs/LIVE.md.
- Still planned: persistent model workers, true streaming events, rolling context, and a production review dashboard. Keep Python behind the TypeScript service.
- Sequence-numbered audio chunks, bounded queues, reconnect/replay, partial/final transcript revisions, speaker corrections, evidence playback.
- Separate live provisional output from slower finalized reconciliation.
- Gate: replay tests for duplicate/missing/out-of-order chunks and speaker changes; p50/p95 partial and final latency under concurrent sessions.

### 5 — Inference efficiency and realistic demo
- Profile stage latency and GPU memory; experiment with batching, quantization, silence skipping, and cancellation before choosing optimizations.
- Gate: accuracy-versus-latency-versus-cost report, including concurrency and queue delays; no unsupported real-time or savings claims.

## Evaluation contract

Report WER plus speaker-attributed transcription errors; diarization error rate with overlap included and explicit collar/scoring settings. Freeze reference annotations, split by meeting/room/speaker to reduce leakage, and record alignment and speaker-permutation conventions. WER alone cannot establish correct attribution. Keep overlap-only and overall results separate.

Track real-time factor (processing seconds / audio seconds), p50/p95 latency, peak VRAM, and compute cost per audio hour (GPU hourly price × GPU processing hours / audio hours, plus other billed services). Define hardware and concurrency for every result. Numerical acceptance thresholds will be set after a representative annotated dataset exists. See experiments/results and docs/EXPERIMENTS.md for the limited baseline experiments actually run.

## Data handling

Use consented or appropriately licensed recordings. Keep audio, credentials, participant identities, embeddings, and generated transcripts out of git. Define retention/deletion and session isolation before hosting other people's meetings. The committed demo contains fictional names and text only.
