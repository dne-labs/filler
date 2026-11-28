import { randomUUID } from 'node:crypto';

export type Priority = 'urgent' | 'normal' | 'low';
export type JobStatus = 'queued' | 'running' | 'retrying' | 'completed' | 'failed' | 'cancelled';
export interface VoiceRequest { clientId: string; audioMs: number; priority?: Priority; maxAttempts?: number; }
export interface Job { id: string; clientId: string; audioMs: number; priority: Priority; status: JobStatus; attempts: number; maxAttempts: number; createdAt: number; startedAt?: number; finishedAt?: number; workerId?: string; result?: { transcript: string; audioMs: number; workerId: string }; error?: string; }
export interface WorkerAdapter { id: string; healthy: boolean; process(job: Job): Promise<{ transcript: string; audioMs: number; workerId: string }>; }
export type LifecycleEvent = { type: 'queued'|'started'|'retrying'|'completed'|'failed'|'cancelled'; at: number; job: Job };
const rank: Record<Priority, number> = { urgent: 0, normal: 1, low: 2 };

/** Per-client fixed-window limiter for the local simulation. Production API uses Redis counters. */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(readonly limit: number, readonly windowMs: number) {}
  allow(clientId: string, now=Date.now()) {
    const current=this.windows.get(clientId);
    if(!current || now-current.start>=this.windowMs) { this.windows.set(clientId,{start:now,count:1}); return true; }
    if(current.count>=this.limit) return false;
    current.count++; return true;
  }
}

export class CircuitBreaker {
  private failures=0; private openedAt=0; private probeInFlight=false;
  constructor(readonly threshold=5, readonly cooldownMs=5000) {}
  get state(): 'closed'|'open'|'half-open' { if(!this.openedAt)return 'closed'; return Date.now()-this.openedAt>=this.cooldownMs?'half-open':'open'; }
  canPass() { const state=this.state; if(state==='closed')return true; if(state==='open'||this.probeInFlight)return false; this.probeInFlight=true; return true; }
  success() { this.failures=0; this.openedAt=0; this.probeInFlight=false; }
  failure() { this.probeInFlight=false; this.failures++; if(this.failures>=this.threshold)this.openedAt=Date.now(); }
}

export class VoiceScheduler {
  readonly jobs = new Map<string, Job>();
  readonly workers = new Map<string, WorkerAdapter>();
  private queue: Job[] = [];
  private busy = new Set<string>();
  private listeners = new Map<string, Set<(job: Job) => void>>();
  private eventListeners = new Set<(event: LifecycleEvent) => void>();
  private breaker: CircuitBreaker;
  constructor(readonly options: { maxQueue?: number; maxRetries?: number; breakerThreshold?: number; breakerCooldownMs?: number; rateLimit?: number; rateWindowMs?: number; } = {}) {
    this.breaker=new CircuitBreaker(options.breakerThreshold??5,options.breakerCooldownMs??5000);
  }
  registerWorker(worker: WorkerAdapter) { this.workers.set(worker.id, worker); this.dispatch(); }
  unregisterWorker(id: string) { this.workers.delete(id); this.busy.delete(id); this.dispatch(); }
  setWorkerHealth(id: string, healthy: boolean) { const w=this.workers.get(id); if(w) w.healthy=healthy; this.dispatch(); }
  submit(input: VoiceRequest): Job {
    if (!input.clientId || !Number.isFinite(input.audioMs) || input.audioMs <= 0) throw new Error('clientId and positive audioMs are required');
    if (this.queue.length >= (this.options.maxQueue ?? 1000)) throw new Error('queue is full (load shedding)');
    const job: Job = { id: randomUUID(), clientId: input.clientId, audioMs: input.audioMs, priority: input.priority ?? 'normal', status: 'queued', attempts: 0, maxAttempts: input.maxAttempts ?? this.options.maxRetries ?? 2, createdAt: Date.now() };
    this.jobs.set(job.id, job); this.queue.push(job); this.sortQueue(); this.emit(job,'queued'); this.dispatch(); return job;
  }
  get(id: string) { return this.jobs.get(id); }
  cancel(id: string) { const j=this.jobs.get(id); if(!j || ['completed','failed','cancelled'].includes(j.status)) return false; j.status='cancelled'; this.queue=this.queue.filter(x=>x.id!==id); this.emit(j,'cancelled'); return true; }
  onUpdate(id: string, cb: (job: Job)=>void) { const set=this.listeners.get(id) ?? new Set(); set.add(cb); this.listeners.set(id,set); return ()=>set.delete(cb); }
  onEvent(cb: (event: LifecycleEvent)=>void) { this.eventListeners.add(cb); return ()=>this.eventListeners.delete(cb); }
  snapshot() { return { queued:this.queue.length, running:[...this.jobs.values()].filter(j=>j.status==='running').length, workers:[...this.workers.values()].map(w=>({id:w.id,healthy:w.healthy,busy:this.busy.has(w.id)})), circuitState:this.breaker.state }; }
  private sortQueue() { this.queue.sort((a,b)=>rank[a.priority]-rank[b.priority] || a.createdAt-b.createdAt); }
  private emit(j: Job,type: LifecycleEvent['type']) { for(const cb of this.listeners.get(j.id)??[]) cb({...j}); const event={type,at:Date.now(),job:{...j}}; for(const cb of this.eventListeners)cb(event); }
  private dispatch() {
    if(this.breaker.state==='open') return;
    for(const w of this.workers.values()) {
      if(!w.healthy || this.busy.has(w.id)) continue;
      const j=this.queue.shift(); if(!j) break; if(j.status==='cancelled') continue;
      if(!this.breaker.canPass()) { this.queue.unshift(j); break; }
      this.busy.add(w.id); j.status='running'; j.startedAt ??= Date.now(); j.attempts++; j.workerId=w.id; this.emit(j,'started');
      void w.process(j).then(result=>{ if(j.status==='cancelled') return; this.breaker.success(); j.status='completed'; j.result=result; j.finishedAt=Date.now(); this.emit(j,'completed'); }).catch(e=>{
        if(j.status==='cancelled') return; this.breaker.failure(); j.error=e instanceof Error?e.message:String(e);
        if(j.attempts<=j.maxAttempts) { j.status='retrying'; this.emit(j,'retrying'); j.status='queued'; this.queue.push(j); this.sortQueue(); }
        else { j.status='failed'; j.finishedAt=Date.now(); this.emit(j,'failed'); }
      }).finally(()=>{this.busy.delete(w.id); if(this.breaker.state==='open') setTimeout(()=>this.dispatch(),this.options.breakerCooldownMs??5000); else this.dispatch();});
    }
  }
}
