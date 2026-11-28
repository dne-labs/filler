# Filler — Voice Inference Scheduler

Filler is a TypeScript-first Turborepo for coordinating concurrent voice inference requests. It accepts jobs, orders them by priority, assigns work to healthy workers, tracks each request through completion, and returns results to the client that submitted it. The simulator models bursts such as 100 users submitting audio at once, so queueing and scaling behavior can be measured without a GPU.

The project includes an HTTP API, an in-memory scheduler for local use, a Redis-backed BullMQ queue for durable jobs, optional Kafka lifecycle events, worker retry and circuit-breaker controls, per-client rate limiting, and load shedding when the queue is full. A workload simulator can add or remove CPU workers based on backlog and reports measured throughput, retries, and request latency.

**Current inference boundary:** the CPU worker simulates service time and failures and returns a placeholder transcript. It does not perform speech recognition. Measurements describe scheduler behavior only; connect a real ASR model before making claims about transcription quality or inference performance.

## Monorepo

- `apps/api` — HTTP API for submitting, checking, and cancelling requests.
- `apps/simulator` — repeatable workload runner with worker-count and failure-rate controls.
- `packages/scheduler` — priority queue, worker assignment, job lifecycle, retries, cancellation, health state, and optional circuit breaker.
- `packages/worker` — CPU simulation worker adapter. Replace its `process` implementation with an ASR backend when ready.

## Run

Requirements: Node.js 22+ and pnpm 10+.

```bash
pnpm install
pnpm simulate                         # 100 requests, one worker
pnpm simulate -- --workers 4 --requests 100 --fail-rate 0.03
pnpm --filter @filler/api dev         # http://localhost:3001
```

Submit a request (audio duration metadata only in this milestone):

```bash
curl -X POST http://localhost:3001/v1/voice-requests \
  -H 'content-type: application/json' \
  -d '{"clientId":"client-1","audioMs":2500,"priority":"urgent"}'
```

Use returned `requestId` with `GET /v1/voice-requests/:id`; cancel with `DELETE /v1/voice-requests/:id`. `GET /health` reports workers and queue depth. Priorities are `urgent`, `normal`, and `low`; ordering applies to queued jobs, while running work is not preempted.

## What the simulator measures

Each run reports elapsed wall time, completed/failed jobs, total attempts, jobs retried, throughput, and p50/p95/max submit-to-completion latency. Service time is derived from simulated audio duration, plus small random jitter. Failures and retries are simulated. Results vary by run and machine; preserve the emitted JSON when comparing configurations.

## Roadmap

1. **Current:** in-memory priority queues, one CPU simulation worker, API, retries, cancellation, worker health, and workload simulation.
2. **Available in optional mode:** Redis-backed BullMQ queue, Kafka lifecycle events, worker concurrency controls, per-client rate limiting, circuit breakers, and load shedding.
3. **Available locally:** simulated worker autoscaling and multiple-worker workload experiments.
4. **Next:** connect a real speech model and measure real audio quality, real-time factor, queue delay, and resource use separately from scheduler simulation.

## Limitations

The first version is a single-process in-memory scheduler. A process restart loses jobs, multiple API processes do not share state, and an active worker cannot be force-stopped by cancellation. The CPU worker is a simulation, not a transcription engine. Redis mode requires an external Redis service; Kafka is optional and requires an external broker. Autoscaling is only simulated: production orchestration, worker lease tuning, and high-availability guarantees are not provided.

## Optional distributed mode

The default is an in-memory queue. To use the Redis-backed BullMQ queue and worker in the API process, set `REDIS_URL`. Kafka lifecycle events are published when `KAFKA_BROKERS` is set (comma-separated host:port list).

```bash
REDIS_URL=redis://localhost:6379 \\
KAFKA_BROKERS=localhost:9092 \\
KAFKA_TOPIC=voice-inference.lifecycle \\
RATE_LIMIT_PER_CLIENT=30 \\
RATE_LIMIT_WINDOW_MS=60000 \\
MAX_QUEUE=1000 \\
WORKER_CONCURRENCY=2 \\
pnpm --filter @filler/api dev
```

Redis mode persists and prioritizes queued jobs, retries failures with exponential backoff, and supports cancellation while a job is waiting. Completed results remain queryable for one day. Active jobs cannot be force-stopped by the HTTP cancellation endpoint. Each API process starts a BullMQ worker; increase concurrency or run more API worker replicas to add capacity. Kafka is an optional lifecycle-event sink; events include waiting, active, completed, failed, and stalled transitions. If Kafka is configured, the API requires a successful Kafka connection at startup.

The API also applies a per-client fixed-window rate limit (Redis counters in Redis mode, process-local counters in memory mode) and sheds new work with HTTP 503 when the waiting queue reaches `MAX_QUEUE`. `WORKER_RATE_LIMIT` can cap worker starts per second. Worker circuit breakers trip after consecutive inference errors and allow a probe after `BREAKER_COOLDOWN_MS`.

## Autoscaling simulation

```bash
pnpm simulate:autoscale
# or tune the workload
pnpm --filter @filler/simulator build
node apps/simulator/dist/index.js --requests 100 --workers 1 --autoscale --max-workers 6
```

The simulator starts with one CPU worker, adds simulated workers as backlog grows, and removes idle workers when the queue drains. It reports the observed peak, scale-up/down counts, latency, retries, and throughput. It does not provision cloud compute.

Start local Redis and Kafka dependencies with `pnpm infra:up`, then use the environment variables above. Stop the containers with `pnpm infra:down`. Redis data is kept in a named Docker volume.
