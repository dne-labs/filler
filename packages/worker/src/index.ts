import type { Job, WorkerAdapter } from '@filler/scheduler';
export interface CpuWorkerOptions { id: string; speedMsPerAudioSecond?: number; failRate?: number; jitterMs?: number; }
/** Deterministic CPU simulation worker. It models a transcription workload; it does not call a real ASR model. */
export class CpuVoiceWorker implements WorkerAdapter {
  healthy=true;
  constructor(readonly options: CpuWorkerOptions) {}
  get id() { return this.options.id; }
  async process(job: Job) {
    const serviceMs=(job.audioMs/1000)*(this.options.speedMsPerAudioSecond??30);
    const jitter=Math.random()*(this.options.jitterMs??8);
    await new Promise(resolve=>setTimeout(resolve,Math.max(1,serviceMs+jitter)));
    if(Math.random()<(this.options.failRate??0)) throw new Error('simulated transient worker failure');
    return { transcript:`[simulated transcript for ${job.audioMs}ms audio]`, audioMs:job.audioMs, workerId:this.id };
  }
}

/** Per-process breaker used by Redis-backed workers. An open circuit rejects work until one probe is allowed. */
export class WorkerCircuitBreaker {
  private failures=0; private openedAt=0; private probeActive=false;
  constructor(readonly threshold=5,readonly cooldownMs=10_000){}
  get state(): 'closed'|'open'|'half-open' {if(!this.openedAt)return 'closed';return Date.now()-this.openedAt>=this.cooldownMs?'half-open':'open';}
  acquire(){const state=this.state;if(state==='open'||(state==='half-open'&&this.probeActive))return false;if(state==='half-open')this.probeActive=true;return true;}
  success(){this.failures=0;this.openedAt=0;this.probeActive=false;}
  failure(){this.probeActive=false;this.failures++;if(this.failures>=this.threshold)this.openedAt=Date.now();}
}
