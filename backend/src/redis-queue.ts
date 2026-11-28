import { Queue, QueueEvents, Worker, type Job as BullJob } from 'bullmq';
import { Redis } from 'ioredis';
import { Kafka, type Producer } from 'kafkajs';
import { CpuVoiceWorker, WorkerCircuitBreaker } from '@filler/worker';

export type Priority='urgent'|'normal'|'low';
type Payload={clientId:string;audioMs:number;priority:Priority};
const PRIORITY:Record<Priority,number>={urgent:1,normal:5,low:10};

/** Durable Redis queue plus optional Kafka lifecycle event publisher. */
export class RedisVoiceQueue {
  private redis: Redis;
  private queue: Queue<Payload>;
  private events: QueueEvents;
  private worker: Worker<Payload>;
  private producer?: Producer;
  private closed=false;
  private breaker=new WorkerCircuitBreaker(Number(process.env.BREAKER_THRESHOLD??5),Number(process.env.BREAKER_COOLDOWN_MS??10_000));
  constructor(redisUrl: string, kafkaBrokers: string[] = []) {
    this.redis=new Redis(redisUrl,{maxRetriesPerRequest:null});
    this.queue=new Queue<Payload>('voice-inference',{connection:this.redis,defaultJobOptions:{attempts:3,backoff:{type:'exponential',delay:500},removeOnComplete:{age:86400,count:10000},removeOnFail:{age:604800,count:10000}}});
    this.events=new QueueEvents('voice-inference',{connection:this.redis.duplicate()});
    this.worker=new Worker<Payload>('voice-inference',async job=>{
      if(!this.breaker.acquire())throw new Error(`worker circuit breaker is ${this.breaker.state}`);
      try {
        const result=await new CpuVoiceWorker({id:`redis-worker-${process.pid}`,speedMsPerAudioSecond:Number(process.env.SIM_SPEED_MS_PER_AUDIO_SECOND??30),failRate:Number(process.env.SIM_FAIL_RATE??0)}).process({id:job.id??'',clientId:job.data.clientId,audioMs:job.data.audioMs,priority:job.data.priority,status:'running',attempts:job.attemptsMade,maxAttempts:job.opts.attempts??3,createdAt:job.timestamp});
        this.breaker.success(); return result;
      } catch(error) { this.breaker.failure(); throw error; }
    },{connection:this.redis.duplicate(),concurrency:Number(process.env.WORKER_CONCURRENCY??1),limiter:process.env.WORKER_RATE_LIMIT?{max:Number(process.env.WORKER_RATE_LIMIT),duration:1000}:undefined});
    const brokers=kafkaBrokers.filter(Boolean);
    if(brokers.length){const kafka=new Kafka({clientId:'filler-voice-scheduler',brokers});this.producer=kafka.producer();}
    for(const event of ['waiting','active','completed','failed','stalled'] as const) this.events.on(event,(payload: { jobId?: string; prev?: string; failedReason?: string })=>void this.publish({type:event,at:Date.now(),...payload}));
  }
  async start(){await this.queue.waitUntilReady(); await this.events.waitUntilReady(); await this.worker.waitUntilReady(); if(this.producer)await this.producer.connect();}
  private async publish(event:Record<string,unknown>){if(!this.producer)return; try{await this.producer.send({topic:process.env.KAFKA_TOPIC??'voice-inference.lifecycle',messages:[{key:String(event.jobId??''),value:JSON.stringify(event)}]});}catch(error){console.error('Kafka lifecycle publish failed',error);}}
  async admit(clientId:string,limit:number,windowMs:number){const key=`voice:rate:${clientId}`; const count=await this.redis.incr(key); if(count===1)await this.redis.pexpire(key,windowMs); return count<=limit;}
  async submit(input:Payload,maxWaiting:number){const waiting=await this.queue.getWaitingCount(); if(waiting>=maxWaiting)throw new Error('queue is full (load shedding)');const job=await this.queue.add('transcribe',input,{priority:PRIORITY[input.priority],jobId:undefined});return {id:job.id!,status:await job.getState(),clientId:input.clientId};}
  async get(id:string){const job=await this.queue.getJob(id);if(!job)return null;return {id:job.id,clientId:job.data.clientId,audioMs:job.data.audioMs,priority:job.data.priority,status:await job.getState(),attempts:job.attemptsMade,createdAt:job.timestamp,startedAt:job.processedOn,finishedAt:job.finishedOn,result:job.returnvalue,error:job.failedReason};}
  async cancel(id:string){const job=await this.queue.getJob(id);if(!job)return false;const state=await job.getState();if(state==='completed'||state==='failed'||state==='unknown')return false;if(state==='active')return false;await job.remove();return true;}
  async health(){return {status:'ok',backend:'redis',queue:{waiting:await this.queue.getWaitingCount(),active:await this.queue.getActiveCount(),delayed:await this.queue.getDelayedCount(),failed:await this.queue.getFailedCount()},worker:{running:this.worker.isRunning(),concurrency:this.worker.concurrency},kafka:!!this.producer,circuitState:this.breaker.state};}
  async close(){if(this.closed)return;this.closed=true;await this.worker.close();await this.events.close();await this.queue.close();if(this.producer)await this.producer.disconnect();await this.redis.quit();}
}
