# Live meeting prototype

## Start

1. Install Node 22+, Python 3.11/3.12 and FFmpeg/ffprobe.
2. `npm ci` and `npm run web:build`.
3. Create `.venv` and install `workers/speech/requirements-asr-tested.txt` as described in README.
4. Copy `.env.example` to `.env`; set the Python executable.
5. For speakers: install `requirements-diarization.txt`, accept Community-1 conditions, supply HF_TOKEN, and set FILLER_DIARIZE=1. Without this, transcription works but speaker identities remain unknown.
6. For AI notes/name hypotheses: set FILLER_LLM_URL to a complete compatible chat-completions endpoint and FILLER_LLM_MODEL to an available model. Set FILLER_LLM_KEY if required. JSON response format must be supported. Local or hosted endpoints work through the adapter; no model is bundled. A hosted endpoint receives transcript text.
7. `npm start`, open http://localhost:3000, inform participants, and click Start meeting. Grant microphone access.

Click Stop & finish to process the final snapshot; inference already in flight completes first. Failed final updates can be retried. Download notes exports the current meeting JSON. Clear session deletes in-memory transcript/name state. Audio snapshots are temporary and removed after inference; browser audio stays in memory until the page is cleared/closed. Nothing survives server restart. Use localhost; the unauthenticated local prototype deliberately rejects remote hosts and foreign origins.

## Implemented behavior

- AudioWorklet continuously captures mono PCM. The browser builds valid cumulative WAV snapshots approximately every 15 seconds, without restarting the microphone or cutting the recording into independently diarized fragments.
- Only one inference job runs at once. While busy, intermediate updates are coalesced; the next snapshot contains all captured audio. Sequences reject old/replayed successful snapshots.
- ASR and optional diarization run on the full captured recording each time. The meeting state is replaced atomically with a new revision. Earlier text may change. All snapshots remain reviewable/provisional, including the stopped recording's AI suggestions.
- Anonymous labels are reconciled across revisions using temporal overlap with the previous transcript. Ambiguous merges/splits get fresh IDs instead of inheriting confirmed names. This is a temporal heuristic, not a persistent biometric identity guarantee.
- An LLM proposes notes and names using transcript evidence. Name suggestions never auto-confirm. Confirm/edit a person's name in People; confirmations are revision-checked. Suggestions based on an addressed name and the following response can be wrong if another person interrupts.
- AI evidence references and owner IDs are validated. This prevents dangling references, not semantic hallucination. Review notes against transcript/audio. Old insights are removed on each revision rather than retaining stale word IDs.
- Overlapping words remain unassigned with candidate labels in exported data. No speech-separation model is implemented.

## Practical limits

This is **near-live repeated batch inference**, not a production streaming ASR/diarization engine. Full-recording reprocessing and fresh model processes increase latency and compute cost as the meeting grows. Limit: 10 minutes, mono PCM16, 64MB upload, one active inference job, ten in-memory sessions. The UI automatically stops near ten minutes. It does not track physical seating or board position, and it cannot guarantee transcription of simultaneous voices.

Next engineering step: persistent model worker, rolling windows with overlap and stable speaker embeddings, transcript revision events, context retrieval, and realistic multi-speaker evaluation. The current app intentionally labels its uncertainty rather than claiming those capabilities.

## Validation

Static checks: `npm run check` and `npm run web:check`. UI build: `npm run web:build`. Regression tests: `npm test`. Tests cover cluster renumbering, identity ambiguity, AI evidence validation, suggestion-only names, and a mock compatible LLM response. Mock tests do not establish real model reasoning quality. See experiments/results/live-http.json for the actual local HTTP audio smoke test, if present.

A physical microphone meeting, gated pyannote inference, and a configured live LLM still need end-to-end evaluation. No claim of noisy multi-speaker accuracy is made.
