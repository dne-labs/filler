# Contributing

Thanks for contributing to Filler. Keep the scheduler and worker boundaries small so the local in-memory implementation can later be swapped for distributed adapters.

## Development

- Node.js 22+ and pnpm 10+
- `pnpm install`
- `pnpm check` for TypeScript checks
- `pnpm simulate -- --workers 1 --requests 100` for a local scheduler workload

## Changes

- Keep job lifecycle transitions explicit and preserve client/request correlation.
- Avoid describing simulated timings as real model inference performance.
- Add or update focused tests when changing scheduling, cancellation, retry, or worker health behavior.
- Document any changed API shape and include the exact simulation command and output when reporting performance.

Open a pull request with a short problem statement, implementation notes, and verification results.
