import { VoiceScheduler, type Priority } from '@filler/scheduler';
import { CpuVoiceWorker } from '@filler/worker';
const args=process.argv.slice(2).filter(value=>value!=='--'); const arg=(key:string,fallback:number)=>{const i=args.indexOf(key); return i>=0?Number(args[i+1]):fallback;};
const has=(key:string)=>args.includes(key);
const requests=arg('--requests',100), initialWorkers=arg('--workers',1), maxWorkers=arg('--max-workers',6), failRate=arg('--fail-rate',0.03), autoscale=has('--autoscale');
const scheduler=new VoiceScheduler({maxRetries:2,breakerThreshold:5,breakerCooldownMs:500});
let workerCount=0, scaleUps=0, scaleDowns=0, peakWorkers=0;
const addWorker=()=>{workerCount++;scheduler.registerWorker(new CpuVoiceWorker({id:`cpu-${workerCount}`,speedMsPerAudioSecond:8,failRate})); peakWorkers=Math.max(peakWorkers,scheduler.workers.size);};
for(let i=0;i<initialWorkers;i++)addWorker();
const start=Date.now();
let done=0;
const completed=new Promise<void>(resolve=>{
 for(let i=0;i<requests;i++) {
  const priority:Priority=i%20===0?'urgent':i%5===0?'low':'normal';
  const job=scheduler.submit({clientId:`client-${i+1}`,audioMs:500+((i*791)%4500),priority});
  scheduler.onUpdate(job.id,updated=>{if(['completed','failed','cancelled'].includes(updated.status)){done++;if(done===requests)resolve();}});
 }
 if(requests===0)resolve();
});
const scaleTimer=autoscale?setInterval(()=>{
 const state=scheduler.snapshot();
 if(state.queued>=Math.max(2,scheduler.workers.size*2)&&scheduler.workers.size<maxWorkers){addWorker();scaleUps++;}
 else if(state.queued===0&&scheduler.workers.size>initialWorkers){const idle=[...scheduler.snapshot().workers].reverse().find(w=>!w.busy);if(idle){scheduler.unregisterWorker(idle.id);scaleDowns++;}}
},20):undefined;
await completed;
if(scaleTimer)clearInterval(scaleTimer);
const elapsed=Date.now()-start;
const jobs=[...scheduler.jobs.values()]; const ok=jobs.filter(j=>j.status==='completed'); const failed=jobs.filter(j=>j.status==='failed');
const latencies=ok.map(j=>(j.finishedAt??0)-j.createdAt).sort((a,b)=>a-b);
const percentile=(p:number)=>latencies[Math.min(latencies.length-1,Math.ceil(latencies.length*p)-1)]??0;
const summary={scenario:'CPU scheduler simulation (no real ASR)',requests,initialWorkers,autoscale,maxWorkers:autoscale?maxWorkers:initialWorkers,peakWorkers,scaleUps,scaleDowns,failRate,elapsedMs:elapsed,completed:ok.length,failed:failed.length,attempts:jobs.reduce((n,j)=>n+j.attempts,0),retried:jobs.filter(j=>j.attempts>1).length,throughputPerSecond:Number((requests/(elapsed/1000||1)).toFixed(2)),latencyMs:{p50:percentile(.5),p95:percentile(.95),max:latencies.at(-1)??0}};
console.log(JSON.stringify(summary,null,2));
