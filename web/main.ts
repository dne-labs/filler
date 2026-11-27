import './style.css';
import type { Meeting } from '../src/schema.js';
const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const start=element<HTMLButtonElement>('start'),stop=element<HTMLButtonElement>('stop'),download=element<HTMLButtonElement>('download'),clear=element<HTMLButtonElement>('clear');
const status=element('status');
let session='',revision=0,sequence=0,recording=false,busy=false,finishing=false,creatorRecognition=false;
let context:AudioContext|undefined,stream:MediaStream|undefined,node:AudioWorkletNode|undefined;
let blocks:Float32Array[]=[];let samples=0,rate=16000;let timer:ReturnType<typeof setInterval>|undefined;let latest:Meeting|undefined;
async function api(path:string,options:RequestInit={}){const r=await fetch(path,options);if(!r.ok){let message=`HTTP ${r.status}`;try{message=(await r.json()).error??message;}catch{}throw Error(message);}return r.status===204?null:r.json();}
function wav(){const buffer=new ArrayBuffer(44+samples*2),v=new DataView(buffer);const word=(p:number,s:string)=>[...s].forEach((c,i)=>v.setUint8(p+i,c.charCodeAt(0)));word(0,'RIFF');v.setUint32(4,36+samples*2,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,samples*2,true);let p=44;for(const b of blocks)for(const x of b){v.setInt16(p,Math.max(-1,Math.min(1,x))*(x<0?32768:32767),true);p+=2;}return buffer;}
function text(tag:string,value:string,className=''){const e=document.createElement(tag);e.textContent=value;e.className=className;return e;}
async function confirmName(speaker:string,name:string){try{await api(`/api/sessions/${session}/name`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({speaker,name,revision})});if(latest){latest.speakers[speaker]=name;render(latest,[]);}status.textContent=`Name confirmed: ${name}`;}catch(e){status.textContent=String(e);}}
function render(m:Meeting,names:{speaker:string;name:string;reason:string}[]){
 const transcript=element('transcript');transcript.replaceChildren();
 // Display adjacent word records together while retaining individual evidence anchors.
 let row:HTMLElement|undefined,previous:string|undefined;
 for(const s of m.segments){const key=`${s.speaker}/${s.attribution}`;if(key!==previous||!row){row=text('div','','utterance');row.append(text('div',`${s.start.toFixed(1)}s · ${s.speaker?m.speakers[s.speaker]:'Unknown'}${s.attribution&&s.attribution!=='assigned'?` · ${s.attribution}`:''}`,'label'));transcript.append(row);previous=key;}const span=text('span',s.text+' ');span.id=`word-${s.id}`;row.append(span);}
 const people=element('people');people.replaceChildren();for(const [id,name]of Object.entries(m.speakers)){const row=text('div','','person');row.append(text('span',id));const input=document.createElement('input');input.value=name;input.setAttribute('aria-label',`Name for ${id}`);const button=text('button','Confirm');button.onclick=()=>void confirmName(id,input.value);row.append(input,button);people.append(row);}
 const suggestions=element('suggestions');suggestions.replaceChildren();for(const n of names){const row=text('div',`${n.speaker} may be ${n.name}: ${n.reason}`,'note');const b=text('button','Confirm name');b.onclick=()=>void confirmName(n.speaker,n.name);row.append(b);suggestions.append(row);}
 const notes=element('notes');notes.replaceChildren();if(!m.insights.length)notes.append(text('p','No supported notes yet.'));for(const i of m.insights){const row=text('div','','note');row.append(text('strong',`${i.kind} · suggested`),text('p',i.text));if(i.owner)row.append(text('p',`Owner: ${m.speakers[i.owner]}`));for(const id of i.evidence){const a=document.createElement('a');a.href=`#word-${encodeURIComponent(id)}`;a.textContent=`${id} `;row.append(a);}notes.append(row);}
 element('speaker-count').textContent=`Voices heard so far: ${Object.keys(m.speakers).length}`;
 download.disabled=false;
}
async function snapshot(){if(!samples&&finishing){finishing=false;clear.disabled=false;stop.disabled=true;status.textContent="Stopped before any audio was captured.";return;}if(busy||!session||!samples)return;busy=true;const final=finishing;status.textContent=final?'Finishing transcript and notes…':'Listening · updating transcript and notes…';try{const result=await api(`/api/sessions/${session}/audio?sequence=${sequence++}`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav()});latest=result.meeting;revision=result.revision;render(latest!,result.names);element('speaker-count').textContent=`Voices heard so far: ${result.speakerCount}`;if(result.creatorMatch){const c=result.creatorMatch;const score=c.similarity==null?'not enough clean speech':Number(c.similarity).toFixed(2);element('creator-status').textContent=c.confident?`Creator voice recognized · score ${score}`:`Creator match uncertain · ${score} · confirm names below`;}element('ai-status').textContent=result.aiError??'AI suggestions · verify before sharing';status.textContent=final?'Recording stopped. Review the final snapshot; AI content remains suggested.':'Listening · latest snapshot ready';}catch(e){status.textContent=`Update failed: ${e}. ${final?'You can retry finishing.':'The next update will retry with all audio.'}`;}finally{busy=false;if(final){finishing=false;clear.disabled=false;stop.disabled=false;stop.textContent='Retry final update';}else if(finishing)void snapshot();}}
async function finish(){if(finishing)return;recording=false;finishing=true;if(timer)clearInterval(timer);node?.disconnect();stream?.getTracks().forEach(t=>t.stop());await context?.close();context=undefined;stop.disabled=true;void snapshot();}
start.onclick=async()=>{start.disabled=true;try{
 const list=(id:string)=>element<HTMLInputElement>(id).value.split(',').map(v=>v.trim()).filter(Boolean);
 const creatorName=element<HTMLInputElement>('creator').value.trim();
 if(!creatorName)throw Error('Enter the meeting creator name.');
 const participants=Array.from(new Set([creatorName,...list('participants')]));
 const setup={creatorName,participants,vocabulary:list('vocabulary'),topic:element<HTMLInputElement>('topic').value.trim()||undefined};
 session=(await api('/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(setup)})).id;
 element('setup').querySelectorAll('input').forEach(input=>(input as HTMLInputElement).disabled=true);
 stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
 context=new AudioContext({sampleRate:16000});rate=context.sampleRate;
 await context.audioWorklet.addModule('/capture.js');node=new AudioWorkletNode(context,'filler-capture');
 const source=context.createMediaStreamSource(stream);source.connect(node);const mute=context.createGain();mute.gain.value=0;node.connect(mute).connect(context.destination);
 node.port.onmessage=e=>{if(!recording)return;const block=e.data as Float32Array;blocks.push(block);samples+=block.length;const seconds=Math.floor(samples/rate);element('clock').textContent=`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;if(samples>=rate*599)void finish();};
 await context.resume();
 if(creatorRecognition){
   status.textContent=`${creatorName}, speak alone for 6 seconds: “My name is ${creatorName}, and I created this meeting.”`;
   element('creator-status').textContent='Creator voice: enrolling…';recording=true;
   await new Promise(resolve=>setTimeout(resolve,6500));recording=false;
   await api(`/api/sessions/${session}/creator`,{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav()});
   element('creator-status').textContent=`Creator voice enrolled: ${creatorName} · matching remains reviewable`;
   blocks=[];samples=0;element('clock').textContent='00:00';
 }else element('creator-status').textContent='Creator recognition disabled · enable diarization and HF access';
 recording=true;stop.disabled=false;
 status.textContent='Meeting started. Ask each other participant to introduce themselves one at a time.';
 timer=setInterval(()=>void snapshot(),8000);
 }catch(e){status.textContent=String(e);recording=false;stream?.getTracks().forEach(t=>t.stop());await context?.close();if(session)await api(`/api/sessions/${session}`,{method:'DELETE'}).catch(()=>{});session='';start.disabled=false;element('setup').querySelectorAll('input').forEach(input=>(input as HTMLInputElement).disabled=false);}};
stop.onclick=()=>{if(recording)void finish();else{finishing=true;void snapshot();}};
clear.onclick=async()=>{try{await api(`/api/sessions/${session}`,{method:'DELETE'});location.reload();}catch(e){status.textContent=String(e);}};
download.onclick=()=>{if(!latest)return;const blob=new Blob([JSON.stringify(latest,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='filler-meeting.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
api('/api/config').then(c=>{creatorRecognition=Boolean(c.creatorRecognition);element('config').textContent=`Speech model: ${c.asrModel} · Speaker recognition: ${c.diarization?'enabled':'disabled — names cannot be attached to voices'} · AI notes: ${c.ai?'enabled — transcript sent to your configured model endpoint':'not configured'}`;}).catch(e=>{status.textContent=String(e);});
