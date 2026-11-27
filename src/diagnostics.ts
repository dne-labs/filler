/** Public errors are allowlisted summaries, never raw stderr, tokens or paths. */
export class InferenceError extends Error {}
export function processFailure(command:string, stderr:string, code:number|null):InferenceError {
 const tool=command.split(/[\\/]/).at(-1)??'worker';
 let reason='Speech worker failed. Run npm run doctor and check model access.';
 if(/No module named ['"](?:faster_whisper|ctranslate2|numpy|huggingface_hub)/.test(stderr)) reason='Speech dependencies are missing in FILLER_PYTHON. Install workers/speech/requirements-asr-tested.txt using that Python executable.';
 else if(/No module named ['"](?:pyannote|torch)/.test(stderr)) reason='Diarization dependencies are missing. Install workers/speech/requirements-diarization.txt in the same Python environment, or set FILLER_DIARIZE=0 for transcription only.';
 else if(/requires HF_TOKEN|GatedRepoError|401 Client Error|403 Client Error|gated repo/i.test(stderr)) reason='Model access denied. For diarization, accept Community-1 model conditions and set HF_TOKEN. Check the configured model and token permissions.';
 else if(/socksio|SOCKS proxy/i.test(stderr)) reason='The Python proxy requires socksio. Install socksio in the FILLER_PYTHON environment.';
 else if(/ConnectionError|ConnectError|timed out|Network is unreachable|LocalEntryNotFoundError|certificate verify failed/i.test(stderr)) reason='Model download failed. Check network/proxy access and certificate configuration; do not disable certificate verification.';
 else if(/out of memory|bad_alloc/i.test(stderr)) reason='Speech inference ran out of memory. Try FILLER_ASR_MODEL=Systran/faster-whisper-tiny.en for an English smoke test.';
 else if(/ffmpeg|ffprobe/.test(tool)) reason='Audio decoding failed. Check FFmpeg/ffprobe installation and the recording format.';
 return new InferenceError(`Inference exited with code ${code}. ${reason}`);
}
export function missingExecutable(command:string):InferenceError {
 const tool=command.split(/[\\/]/).at(-1);
 return new InferenceError(tool==='ffmpeg'||tool==='ffprobe' ? 'FFmpeg/ffprobe executable not found. Install FFmpeg and ensure both commands are on PATH.' : 'Python executable could not start. Set FILLER_PYTHON to the absolute path of your virtual environment Python and run npm run doctor.');
}
export function publicFailure(error:unknown):string {
 return error instanceof InferenceError?error.message:'Inference returned an invalid result. Run npm run doctor; check model compatibility and audio input.';
}
