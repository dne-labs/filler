import {run} from './process.js';
const python=process.env.FILLER_PYTHON??'python';
let failed=false;
for(const tool of ['ffmpeg','ffprobe']){try{await run(tool,['-version'],{timeoutMs:10000});console.log(`${tool}: OK`);}catch(e){failed=true;console.error((e as Error).message);}}
try{
 const script="import importlib.util,json,sys; print(json.dumps({'python':sys.version.split()[0], 'modules':{p:importlib.util.find_spec(p) is not None for p in ['faster_whisper','numpy','torch','pyannote']}}))";
 const result=JSON.parse(await run(python,['-c',script],{timeoutMs:10000}));console.log(result);
 for(const p of ['faster_whisper','numpy',...(process.env.FILLER_DIARIZE==='1'?['torch','pyannote']:[])]) if(!result.modules[p])failed=true;
}catch(e){failed=true;console.error((e as Error).message);}
console.log('Diarization enabled:',process.env.FILLER_DIARIZE==='1');
if(process.env.FILLER_DIARIZE==='1'&&!process.env.HF_TOKEN){failed=true;console.error('HF_TOKEN missing for diarization.');}
const asrModel=process.env.FILLER_ASR_MODEL??'Systran/faster-whisper-small';
console.log('ASR model:',asrModel);
if(/tiny/i.test(asrModel))console.warn('Accuracy warning: tiny models are smoke-test models. Use Systran/faster-whisper-small for names, accents and technical meetings.');
if(process.env.FILLER_DIARIZE!=='1')console.warn('Speaker-name warning: diarization is disabled, so voices cannot be assigned stable speaker IDs or names.');
console.log('AI configured:',!!process.env.FILLER_LLM_URL&&!!process.env.FILLER_LLM_MODEL,'API key present:',!!process.env.FILLER_LLM_KEY);
console.log('This checks local setup only, not model downloads, credentials or inference accuracy.');
process.exitCode=failed?1:0;
