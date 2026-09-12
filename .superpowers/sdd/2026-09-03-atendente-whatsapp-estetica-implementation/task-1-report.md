# Task 1 Report: Bootstrap repository and runtime

## Delivered

- Strict TypeScript project with Fastify runtime and npm scripts for web and worker entrypoints.
- `/healthz` endpoint returning `{ "status": "ok" }`.
- Required `DATABASE_URL` validation and validated port configuration.
- Graceful SIGTERM/SIGINT shutdown handling.
- Multi-stage Node 22 Docker image.
- Docker Compose services for web, worker, and PostgreSQL, with the web and worker using the same image and no public database port.
- Focused smoke tests for health and missing configuration behavior.

## Verification

- `npm test -- tests/smoke/app.test.ts`: passed (2 tests).
- `npm run build`: passed.
- `git diff --check`: passed.
- Compose validation could not be executed because Docker is not installed in the execution environment (`docker: command not found`).

## Concerns

- The worker command currently starts the shared Fastify bootstrap; worker processing is intentionally not implemented until the queue/jobs tasks.

## Round 1 Fix: distinct worker runtime

### Files changed

- `apps/server/src/app.ts`: added `startWorker`, a non-listening worker lifecycle with graceful shutdown and heartbeat; `main` now branches on `--worker`.
- `tests/smoke/app.test.ts`: added regression coverage asserting worker mode has no bound HTTP address.

### Verification

- `npm test -- tests/smoke/app.test.ts`: passed (3 tests).
- `npm run build`: passed.
- `git diff --check`: passed.

### Output

Worker mode now stays alive for background consumers without binding an HTTP listener; web mode remains unchanged.
