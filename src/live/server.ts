import {publicFailure} from '../diagnostics.js';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {z} from 'zod';
import {transcribe} from '../pipeline.js';
import {createSession,reconcile} from './state.js';
import {analyze} from './intelligence.js';
import {PersistentSpeechWorker} from './speech-worker.js';
const app=express();
const port=Number(process.env.PORT??3000);
const sessions=new Map<string,ReturnType<typeof createSession>>();
const speechWorker=new PersistentSpeechWorker(process.env.FILLER_PYTHON??'python');
let processing=false;
app.use((req,res,next)=>{
 const allowed=[`localhost:${port}`,`127.0.0.1:${port}`];
 if(!allowed.includes(req.headers.host??'')) {res.status(403).json({error:'Local access only'});return;}
 if(req.headers.origin&&!allowed.some(h=>req.headers.origin===`http://${h}`)){res.status(403).json({error:'Origin rejected'});return;}
 res.setHeader('Cache-Control','no-store'); next();
});
app.get('/api/config',(_req,res)=>res.json({diarization:process.env.FILLER_DIARIZE==='1',ai:!!process.env.FILLER_LLM_URL&&!!process.env.FILLER_LLM_MODEL,asrModel:process.env.FILLER_ASR_MODEL??'Systran/faster-whisper-small'}));
const setupSchema=z.object({participants:z.array(z.string().trim().min(1).max(80)).max(12).default([]),vocabulary:z.array(z.string().trim().min(1).max(80)).max(40).default([]),topic:z.string().trim().max(200).optional()});
app.post('/api/sessions',express.json({limit:'8kb'}),(req,res)=>{if(sessions.size>=10){res.status(429).json({error:'Delete an old session first'});return;}const parsed=setupSchema.safeParse(req.body??{});if(!parsed.success){res.status(400).json({error:'Invalid meeting setup'});return;}const id=randomUUID();sessions.set(id,createSession(parsed.data));res.json({id});});
app.post('/api/sessions/:id/audio',express.raw({type:'audio/wav',limit:'64mb'}),async(req,res)=>{
 const session=sessions.get(req.params.id); if(!session){res.sendStatus(404);return;}
 const sequence=Number(req.query.sequence);
 if(!Number.isSafeInteger(sequence)||sequence<0||sequence<=session.sequence){res.status(409).json({error:'Stale snapshot'});return;}
 if(processing){res.status(429).json({error:'Inference busy; retry the latest snapshot'});return;}
 if(!Buffer.isBuffer(req.body)||req.body.length<44){res.status(400).json({error:'WAV body required'});return;}
 // Browser protocol: canonical mono PCM16 WAV. Validate lengths and duration before decoding.
 const b:Buffer=req.body; const rate=b.readUInt32LE(24);
 if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE'||b.toString('ascii',12,16)!=='fmt '||b.readUInt32LE(16)!==16||b.readUInt16LE(20)!==1||b.readUInt16LE(22)!==1||b.readUInt16LE(34)!==16||b.toString('ascii',36,40)!=='data'||![16000,44100,48000].includes(rate)||b.readUInt32LE(40)!==b.length-44||(b.length-44)%2||b.length-44>rate*2*600){res.status(400).json({error:'Expected mono PCM16 WAV, maximum 10 minutes'});return;}
 processing=true;session.busy=true;
 let temp:string|undefined;
 try{
 temp=await mkdtemp(join(tmpdir(),'filler-live-'));const path=join(temp,'snapshot.wav');await writeFile(path,b);
 const context=[session.setup.topic?`Meeting topic: ${session.setup.topic}.`:'',session.setup.participants.length?`Participants: ${session.setup.participants.join(', ')}.`:'',session.setup.vocabulary.length?`Important vocabulary: ${session.setup.vocabulary.join(', ')}.`:''].filter(Boolean).join(' ');
 const hotwords=[...session.setup.participants,...session.setup.vocabulary].join(', ');
 const {meeting}=await transcribe(path,{diarize:process.env.FILLER_DIARIZE==='1',model:process.env.FILLER_ASR_MODEL??'Systran/faster-whisper-small',language:process.env.FILLER_LANGUAGE,initialPrompt:context||undefined,hotwords:hotwords||undefined,beamSize:Number(process.env.FILLER_BEAM_SIZE??3),workerRunner:speechWorker.run.bind(speechWorker)});
 meeting.metadata={...meeting.metadata,participants:session.setup.participants,topic:session.setup.topic,vocabulary:session.setup.vocabulary};
 const updated=reconcile(session,meeting);
 let names:unknown[]=[];let aiError:string|undefined;
 try{const result=await analyze(updated);updated.insights=result.insights;names=result.names;}catch(e){aiError=e instanceof Error?e.message:'AI unavailable';}
 session.meeting=updated;session.sequence=sequence;session.revision++;
 res.json({meeting:updated,names,aiError,revision:session.revision,sequence,provisional:true});
 }catch(error){const message=publicFailure(error);console.error(message);res.status(500).json({error:message});}
 finally{session.busy=false;processing=false;if(temp)await rm(temp,{recursive:true,force:true});}
});
app.post('/api/sessions/:id/name',express.json({limit:'4kb'}),(req,res)=>{
 const session=sessions.get(req.params.id);if(!session?.meeting){res.sendStatus(404);return;}
 if(session.busy){res.status(409).json({error:'Wait for the current update, then confirm'});return;}
 const parsed=z.object({speaker:z.string(),name:z.string().trim().min(1).max(80),revision:z.number().int()}).safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:'Invalid name'});return;}
 const {speaker,name,revision}=parsed.data;
 if(revision!==session.revision||!Object.hasOwn(session.meeting.speakers,speaker)){res.status(409).json({error:'Transcript changed; review the latest speaker first'});return;}
 session.names[speaker]=name;session.meeting.speakers[speaker]=name;res.json({ok:true});
});
app.delete('/api/sessions/:id',(req,res)=>{const s=sessions.get(req.params.id);if(s?.busy){res.status(409).json({error:'Wait for inference to finish'});return;}sessions.delete(req.params.id);res.sendStatus(204);});
app.use(express.static('dist/web'));
app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(400).json({error:'Invalid or oversized request'});});
app.listen(port,'127.0.0.1',()=>console.log(`Filler meeting room: http://localhost:${port}`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{speechWorker.close();process.exit(0);});
