import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const path=process.argv[2];if(!path)throw Error('Pass a canonical mono PCM16 WAV fixture');
const server=spawn(process.execPath,['--import','tsx','src/live/server.ts'],{env:{...process.env,PORT:'3010',FILLER_DIARIZE:'0',FILLER_LLM_URL:'',FILLER_LLM_MODEL:'',FILLER_ASR_MODEL:'Systran/faster-whisper-tiny.en'},stdio:['ignore','pipe','pipe']});
try{
 const base='http://127.0.0.1:3010';let ready=false;
 for(let i=0;i<50;i++){try{ready=(await fetch(base+'/api/config')).ok;}catch{}if(ready)break;await delay(100);}
 if(!ready)throw Error('Server did not become reachable');
 const page=await fetch(base);
 const {id}=await (await fetch(base+'/api/sessions',{method:'POST'})).json();
 const bytes=await readFile(path);const options={method:'POST',headers:{'Content-Type':'audio/wav'},body:bytes};
 const response=await fetch(`${base}/api/sessions/${id}/audio?sequence=0`,options);const result=await response.json();if(!response.ok)throw Error(JSON.stringify(result));
 const stale=await fetch(`${base}/api/sessions/${id}/audio?sequence=0`,options);
 const foreign=await fetch(base+'/api/sessions',{method:'POST',headers:{Origin:'https://example.com'}});
 const deleted=await fetch(`${base}/api/sessions/${id}`,{method:'DELETE'});
 const metrics={scope:'Real HTTP smoke test, public JFK speech fixture. ASR only; no microphone, diarization or LLM.',uiStatus:page.status,audioStatus:response.status,words:result.meeting.segments.length,unknownSpeakers:result.meeting.segments.filter((s:{speaker:unknown})=>s.speaker===null).length,aiStatus:result.aiError,staleStatus:stale.status,foreignOriginStatus:foreign.status,deleteStatus:deleted.status};
 if(metrics.words!==22||stale.status!==409||foreign.status!==403||deleted.status!==204)throw Error(JSON.stringify(metrics));
 await writeFile('experiments/results/live-http.json',JSON.stringify(metrics,null,2)+'\n');console.log(metrics);
}finally{server.kill('SIGTERM');}
