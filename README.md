# Filler Voice Inference Scheduler

A TypeScript-first Turborepo for coordinating voice inference jobs. The first milestone runs locally with one CPU worker and can simulate concurrent callers and additional workers without requiring a GPU.

> The built-in worker is a **scheduler simulation**. It models service time and transient failures and returns a placeholder transcript; it does not run speech recognition. The benchmark output is measured from the local simulation and must not be read as production ASR performance.

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
2. **Next:** Redis-backed durable queues and distributed worker leases; keep the in-memory adapter for local demos.
3. **Then:** Kafka lifecycle events, worker autoscaling simulation, tenant rate limits, circuit breaker controls, and load shedding policies.
4. **Inference:** connect a real speech model and measure real audio quality, real-time factor, queue delay, and resource use separately from scheduler simulation.

## Limitations

The first version is a single-process in-memory scheduler. A process restart loses jobs, multiple API processes do not share state, and an active worker cannot be force-stopped by cancellation. The CPU worker is a simulation, not a transcription engine. Redis, Kafka, production autoscaling, and distributed guarantees are roadmap items, not implemented claims.
