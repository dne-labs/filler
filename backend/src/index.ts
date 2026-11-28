import express from 'express';
import { VoiceScheduler, type Priority } from '@filler/scheduler';
import { CpuVoiceWorker } from '@filler/worker';
import { RedisVoiceQueue } from './redis-queue.js';

const app=express(); app.use(express.json({limit:'1mb'}));
const redisUrl=process.env.REDIS_URL;
const maxQueue=Number(process.env.MAX_QUEUE??1000);
const rateLimit=Number(process.env.RATE_LIMIT_PER_CLIENT??30);
const rateWindowMs=Number(process.env.RATE_LIMIT_WINDOW_MS??60_000);
const scheduler=new VoiceScheduler({maxQueue,maxRetries:2,breakerThreshold:Number(process.env.BREAKER_THRESHOLD??5),breakerCooldownMs:Number(process.env.BREAKER_COOLDOWN_MS??5000)});
let redisQueue:RedisVoiceQueue|undefined;
if(redisUrl) redisQueue=new RedisVoiceQueue(redisUrl,(process.env.KAFKA_BROKERS??'').split(',').map(x=>x.trim()).filter(Boolean));
else scheduler.registerWorker(new CpuVoiceWorker({id:'cpu-1',speedMsPerAudioSecond:30,failRate:Number(process.env.SIM_FAIL_RATE??0)}));
const localRate=new Map<string,{start:number;count:number}>();
async function allowed(clientId:string){if(redisQueue)return redisQueue.admit(clientId,rateLimit,rateWindowMs);const now=Date.now();let entry=localRate.get(clientId);if(!entry||now-entry.start>=rateWindowMs){entry={start:now,count:0};localRate.set(clientId,entry);}entry.count++;return entry.count<=rateLimit;}
app.get('/health',async(_req,res)=>{if(redisQueue){try{res.json(await redisQueue.health());}catch{res.status(503).json({status:'unhealthy',backend:'redis'});}return;}res.json({status:'ok',backend:'memory',...scheduler.snapshot()});});
app.post('/v1/voice-requests',async(req,res)=>{try{const {clientId,audioMs,priority='normal'}=req.body as {clientId:string;audioMs:number;priority?:Priority};if(!clientId||!Number.isFinite(audioMs)||audioMs<=0)return res.status(400).json({error:'clientId and positive audioMs are required'});if(!await allowed(clientId))return res.status(429).json({error:'client rate limit exceeded',retryAfterMs:rateWindowMs});if(redisQueue){const job=await redisQueue.submit({clientId,audioMs,priority},maxQueue);return res.status(202).json({requestId:job.id,status:job.status,clientId});}const job=scheduler.submit({clientId,audioMs,priority});return res.status(202).json({requestId:job.id,status:job.status,clientId});}catch(e){const message=e instanceof Error?e.message:'invalid request';return res.status(message.includes('queue is full')?503:400).json({error:message});}});
app.get('/v1/voice-requests/:id',async(req,res)=>{if(redisQueue){const job=await redisQueue.get(req.params.id);return job?res.json(job):res.status(404).json({error:'request not found'});}const job=scheduler.get(req.params.id);return job?res.json(job):res.status(404).json({error:'request not found'});});
app.delete('/v1/voice-requests/:id',async(req,res)=>{const cancelled=redisQueue?await redisQueue.cancel(req.params.id):scheduler.cancel(req.params.id);res.status(cancelled?202:409).json({cancelled});});
const port=Number(process.env.PORT??3001);
async function main(){if(redisQueue)await redisQueue.start();const server=app.listen(port,()=>console.log(`voice scheduler API listening on :${port} (${redisQueue?'redis':'memory'})`));const shutdown=async()=>{server.close();if(redisQueue)await redisQueue.close();};process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());}
void main().catch(error=>{console.error('scheduler startup failed',error);process.exitCode=1;});
