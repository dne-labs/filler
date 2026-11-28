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
