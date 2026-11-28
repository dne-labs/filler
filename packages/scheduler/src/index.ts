import { randomUUID } from 'node:crypto';

export type Priority = 'urgent' | 'normal' | 'low';
export type JobStatus = 'queued' | 'running' | 'retrying' | 'completed' | 'failed' | 'cancelled';
export interface VoiceRequest { clientId: string; audioMs: number; priority?: Priority; maxAttempts?: number; }
export interface Job { id: string; clientId: string; audioMs: number; priority: Priority; status: JobStatus; attempts: number; maxAttempts: number; createdAt: number; startedAt?: number; finishedAt?: number; workerId?: string; result?: { transcript: string; audioMs: number; workerId: string }; error?: string; }
export interface WorkerAdapter { id: string; healthy: boolean; process(job: Job): Promise<{ transcript: string; audioMs: number; workerId: string }>; }
const rank: Record<Priority, number> = { urgent: 0, normal: 1, low: 2 };

export class VoiceScheduler {
  readonly jobs = new Map<string, Job>();
  readonly workers = new Map<string, WorkerAdapter>();
  private queue: Job[] = [];
  private busy = new Set<string>();
  private listeners = new Map<string, Set<(job: Job) => void>>();
  private breakerUntil = 0;
  constructor(readonly options: { maxQueue?: number; maxRetries?: number; breakerThreshold?: number; breakerCooldownMs?: number } = {}) {}
  registerWorker(worker: WorkerAdapter) { this.workers.set(worker.id, worker); this.dispatch(); }
  unregisterWorker(id: string) { this.workers.delete(id); this.busy.delete(id); this.dispatch(); }
  setWorkerHealth(id: string, healthy: boolean) { const w=this.workers.get(id); if(w) w.healthy=healthy; this.dispatch(); }
  submit(input: VoiceRequest): Job {
    if (!input.clientId || !Number.isFinite(input.audioMs) || input.audioMs <= 0) throw new Error('clientId and positive audioMs are required');
    if (this.queue.length >= (this.options.maxQueue ?? 1000)) throw new Error('queue is full');
    const job: Job = { id: randomUUID(), clientId: input.clientId, audioMs: input.audioMs, priority: input.priority ?? 'normal', status: 'queued', attempts: 0, maxAttempts: input.maxAttempts ?? this.options.maxRetries ?? 2, createdAt: Date.now() };
    this.jobs.set(job.id, job); this.queue.push(job); this.sortQueue(); this.emit(job); this.dispatch(); return job;
  }
  get(id: string) { return this.jobs.get(id); }
  cancel(id: string) { const j=this.jobs.get(id); if(!j || ['completed','failed','cancelled'].includes(j.status)) return false; j.status='cancelled'; this.queue=this.queue.filter(x=>x.id!==id); this.emit(j); return true; }
  onUpdate(id: string, cb: (job: Job)=>void) { const set=this.listeners.get(id) ?? new Set(); set.add(cb); this.listeners.set(id,set); return ()=>set.delete(cb); }
  snapshot() { return { queued:this.queue.length, running:[...this.jobs.values()].filter(j=>j.status==='running').length, workers:[...this.workers.values()].map(w=>({id:w.id,healthy:w.healthy,busy:this.busy.has(w.id)})), circuitOpen:Date.now()<this.breakerUntil }; }
  private sortQueue() { this.queue.sort((a,b)=>rank[a.priority]-rank[b.priority] || a.createdAt-b.createdAt); }
  private emit(j: Job) { for(const cb of this.listeners.get(j.id)??[]) cb({...j}); }
  private dispatch() {
    if(Date.now()<this.breakerUntil) return;
    for(const w of this.workers.values()) {
      if(!w.healthy || this.busy.has(w.id)) continue;
      const j=this.queue.shift(); if(!j) break; if(j.status==='cancelled') continue;
      this.busy.add(w.id); j.status='running'; j.startedAt ??= Date.now(); j.attempts++; j.workerId=w.id; this.emit(j);
      void w.process(j).then(result=>{ if(j.status==='cancelled') return; j.status='completed'; j.result=result; j.finishedAt=Date.now(); this.emit(j); }).catch(e=>{
        if(j.status==='cancelled') return; j.error=e instanceof Error?e.message:String(e);
        if(j.attempts<=j.maxAttempts) { j.status='retrying'; this.emit(j); j.status='queued'; this.queue.push(j); this.sortQueue(); }
        else { j.status='failed'; j.finishedAt=Date.now(); this.emit(j); }
        const failures=[...this.jobs.values()].filter(x=>x.status==='failed').length;
        if((this.options.breakerThreshold??0)>0 && failures>=(this.options.breakerThreshold??Infinity)) this.breakerUntil=Date.now()+(this.options.breakerCooldownMs??5000);
      }).finally(()=>{this.busy.delete(w.id); this.dispatch();});
    }
  }
}
