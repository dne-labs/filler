import { VoiceScheduler, type Priority } from '@filler/scheduler';
import { CpuVoiceWorker } from '@filler/worker';
const args=process.argv.slice(2).filter(value=>value!=='--'); const arg=(key:string,fallback:number)=>{const i=args.indexOf(key); return i>=0?Number(args[i+1]):fallback;};
const requests=arg('--requests',100), workers=arg('--workers',1), failRate=arg('--fail-rate',0.03);
const scheduler=new VoiceScheduler({maxRetries:2});
for(let i=0;i<workers;i++) scheduler.registerWorker(new CpuVoiceWorker({id:`cpu-${i+1}`,speedMsPerAudioSecond:8,failRate}));
const completed=new Promise<void>(resolve=>{
 let done=0;
 for(let i=0;i<requests;i++) {
  const priority:Priority=i%20===0?'urgent':i%5===0?'low':'normal';
  const job=scheduler.submit({clientId:`client-${i+1}`,audioMs:500+((i*791)%4500),priority});
  scheduler.onUpdate(job.id,updated=>{if(['completed','failed','cancelled'].includes(updated.status)){done++;if(done===requests)resolve();}});
 }
 if(requests===0)resolve();
});
const start=Date.now(); await completed; const elapsed=Date.now()-start;
const jobs=[...scheduler.jobs.values()]; const ok=jobs.filter(j=>j.status==='completed'); const failed=jobs.filter(j=>j.status==='failed');
const latencies=ok.map(j=>(j.finishedAt??0)-j.createdAt).sort((a,b)=>a-b);
const percentile=(p:number)=>latencies[Math.min(latencies.length-1,Math.ceil(latencies.length*p)-1)]??0;
const summary={scenario:'CPU scheduler simulation (no real ASR)',requests,workers,failRate,elapsedMs:elapsed,completed:ok.length,failed:failed.length,attempts:jobs.reduce((n,j)=>n+j.attempts,0),retried:jobs.filter(j=>j.attempts>1).length,throughputPerSecond:Number((requests/(elapsed/1000||1)).toFixed(2)),latencyMs:{p50:percentile(.5),p95:percentile(.95),max:latencies.at(-1)??0}};
console.log(JSON.stringify(summary,null,2));
