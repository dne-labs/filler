# Live meeting prototype

## Start

1. Install Node 22+, Python 3.11/3.12 and FFmpeg/ffprobe.
2. `npm ci` and `npm run web:build`.
3. Create `.venv` and install `workers/speech/requirements-asr-tested.txt` as described in README.
4. Copy `.env.example` to `.env`; set the Python executable.
5. For speakers: install `requirements-diarization.txt`, accept Community-1 conditions, supply HF_TOKEN, and set FILLER_DIARIZE=1. Without this, transcription works but speaker identities remain unknown.
6. For AI notes/name hypotheses: set FILLER_LLM_URL to a complete compatible chat-completions endpoint and FILLER_LLM_MODEL to an available model. Set FILLER_LLM_KEY if required. JSON response format must be supported. Local or hosted endpoints work through the adapter; no model is bundled. A hosted endpoint receives transcript text.
7. `npm start`, open http://localhost:3000, inform participants, enter the creator's name, and click Start meeting. Grant microphone access. When prompted, the creator speaks alone for about six seconds. After enrollment, ask every other participant to introduce themselves one at a time.

Click Stop & finish to process the final snapshot; inference already in flight completes first. Failed final updates can be retried. Download notes exports the current meeting JSON. Clear session deletes in-memory transcript/name state. Audio snapshots are temporary and removed after inference; browser audio stays in memory until the page is cleared/closed. Nothing survives server restart. Use localhost; the unauthenticated local prototype deliberately rejects remote hosts and foreign origins.

## Creator and participant identity

With diarization enabled, the meeting creator records a 6-second enrollment sample before the meeting timer begins. The sample is converted to a WeSpeaker voice embedding and kept only in server memory. For each update, the system compares the enrollment with at least two seconds of clean, non-overlapping speech from each detected voice. It assigns the creator name only when the similarity passes both `FILLER_CREATOR_THRESHOLD` (default 0.72) and `FILLER_CREATOR_MARGIN` (default 0.08) over the next-best voice. These defaults are prototype calibration values, not universal biometric guarantees. Confirm or correct every identity in the UI.

“Voices heard so far” counts distinct diarized voices that have spoken. A center laptop microphone cannot count silent people or reliably infer where someone is seated. Other participants are named from the configured roster and evidence such as introductions or addressed responses; those names remain suggestions until confirmed.

## Implemented behavior

- Before recording, add participant names, the topic, and important vocabulary. They are passed to Whisper as context and hotwords. This can improve uncommon names such as Shubham and terms such as “model”, but it cannot guarantee the spelling of unclear speech.
- AudioWorklet continuously captures mono PCM. The browser builds valid cumulative WAV snapshots approximately every 8 seconds, without restarting the microphone or cutting the recording into independently diarized fragments.
- Only one inference job runs at once. While busy, intermediate updates are coalesced; the next snapshot contains all captured audio. Sequences reject old/replayed successful snapshots.
- ASR and optional diarization run on the full captured recording each time. A persistent Python worker keeps the ASR model loaded between updates, reducing repeated model-startup delay. The meeting state is replaced atomically with a new revision, so earlier text may change. All snapshots remain reviewable/provisional, including the stopped recording's AI suggestions.
- DeepSeek receives grouped utterances with evidence IDs instead of isolated word objects. This improves note coherence and reduces prompt size. It still cannot restore words that speech recognition never heard correctly.
- Anonymous labels are reconciled across revisions using temporal overlap with the previous transcript. Ambiguous merges/splits get fresh IDs instead of inheriting confirmed names. This is a temporal heuristic, not a persistent biometric identity guarantee.
- An LLM proposes notes and names using transcript evidence. Name suggestions never auto-confirm. Confirm/edit a person's name in People; confirmations are revision-checked. Suggestions based on an addressed name and the following response can be wrong if another person interrupts.
- AI evidence references and owner IDs are validated. This prevents dangling references, not semantic hallucination. Review notes against transcript/audio. Old insights are removed on each revision rather than retaining stale word IDs.
- Overlapping words remain unassigned with candidate labels in exported data. No speech-separation model is implemented.

## Practical limits

This is **near-live repeated batch inference**, not a production streaming ASR/diarization engine. Full-recording reprocessing still increases latency and compute cost as the meeting grows, although the model now stays loaded. Limit: 10 minutes, mono PCM16, 64MB upload, one active inference job, ten in-memory sessions. The UI automatically stops near ten minutes. It does not track physical seating or board position, and it cannot guarantee transcription of simultaneous voices.

Next engineering step: rolling windows with overlap, calibrated multi-session speaker verification, transcript revision events, context retrieval, and realistic multi-speaker evaluation. The current app intentionally labels its uncertainty rather than claiming those capabilities.

## Validation

Static checks: `npm run check` and `npm run web:check`. UI build: `npm run web:build`. Regression tests: `npm test`. Tests cover cluster renumbering, identity ambiguity, AI evidence validation, suggestion-only names, and a mock compatible LLM response. Mock tests do not establish real model reasoning quality. See experiments/results/live-http.json for the actual local HTTP audio smoke test, if present.

A physical microphone meeting, gated pyannote inference, and a configured live LLM still need end-to-end evaluation. No claim of noisy multi-speaker accuracy is made.

## DeepSeek notes and name suggestions

Set these in your local `.env` and restart the server:

```dotenv
FILLER_LLM_URL=https://api.deepseek.com/chat/completions
FILLER_LLM_MODEL=deepseek-flash
FILLER_LLM_KEY=your_actual_key_here
```

DeepSeek receives transcript text to propose notes and speaker names. It does not replace the local speech worker. Keep the key out of source control and chat. No real DeepSeek request was run during development without a user key. Model names follow https://api-docs.deepseek.com/ (checked 2026-11-27); choose a model available to your account that supports JSON output.

## Diagnosing an inference failure

Run `npm run doctor` from the repository root. It loads `.env`, checks FFmpeg/ffprobe, and tests imports in the exact Python interpreter used by the server. It does not print API keys or verify model access. The UI now reports known failures with an actionable summary rather than discarding every worker error.

For a new local environment:

```bash
python -m venv .venv
.venv/bin/python -m pip install -r workers/speech/requirements-asr-tested.txt
```

Set `FILLER_PYTHON` to the virtual-environment path such as `/home/krishna/filler/.venv/bin/python`; do not replace it with `realpath`, which may resolve to the base interpreter. Use `FILLER_ASR_MODEL=Systran/faster-whisper-small` for real meetings. Tiny models are suitable only for setup smoke tests and frequently damage names and technical terms. Leave `FILLER_LANGUAGE` unset for multilingual/Hinglish detection. Enable diarization after installing its dependencies and confirming gated-model access. Without diarization, Filler can transcribe and write notes but cannot determine which voice belongs to Krishna or Shubham.
