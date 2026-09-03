# Atendente WhatsApp Estética Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a mobile-first WhatsApp booking attendant for facial-esthetics services.

**Architecture:** A TypeScript modular monolith runs as web and worker processes against PostgreSQL. The public Meta webhook only persists events; a PostgreSQL-backed queue serializes/debounces conversations and invokes GPT-5.6 Luna through typed tools. The administrative panel is protected by Cloudflare Access; the Meta webhook remains public and signature-validated.

**Tech Stack:** TypeScript, Fastify, Kysely, PostgreSQL, pg-boss, Nunjucks, HTMX, SSE, PWA/Web Push, FullCalendar, OpenAI Responses API, WhatsApp Cloud API, Docker Compose/Portainer.

**Spec:** `docs/superpowers/specs/2026-09-03-atendente-whatsapp-estetica-design.md`

## Global Constraints

- Use `America/Sao_Paulo` for wall-clock schedules and UTC `timestamptz` for instants.
- PostgreSQL is the sole source of truth for appointments, inbound events, outbound messages and jobs.
- No Redis, BullMQ, Prisma, unofficial WhatsApp client, or public database port.
- `/webhooks/meta` is public; the administrative UI is protected by Cloudflare Access.
- GPT-5.6 Luna is the only automatic model in the first release; human handoff is the fallback.
- The model cannot directly mutate appointment data; all mutations pass through validated tools.
- Prices, dates, times and confirmations are rendered by application templates, not generated facts.
- Do not request, diagnose or infer clinical information; unsolicited sensitive content is restricted and routed to the professional.
- Every task must have focused automated tests and a reproducible Docker/Portainer deployment check.

## Files and Responsibilities

- `apps/server/src/http/`: Fastify routes, webhook verification and Cloudflare Access identity.
- `apps/server/src/domain/`: appointments, services, professionals, customers and state transitions.
- `apps/server/src/conversation/`: debounce, locks, intent orchestration and typed model tools.
- `apps/server/src/messaging/`: WhatsApp client, templates, interactive messages and delivery status.
- `apps/server/src/jobs/`: pg-boss jobs, reminders, expiration and retries.
- `apps/server/src/db/`: Kysely types, SQL migrations and transaction helpers.
- `apps/web/`: Nunjucks/HTMX pages, SSE client and PWA service worker.
- `tests/`: unit, integration, contract, security and end-to-end tests.
- `deploy/`: Dockerfiles, Compose file, environment contract and backup scripts.

### Task 1: Bootstrap repository and runtime

**Files:** Create `package.json`, `tsconfig.json`, `apps/server/src/app.ts`, `apps/server/src/config.ts`, `apps/server/Dockerfile`, `deploy/compose.yml`, `.env.example`, `tests/smoke/app.test.ts`.

- [ ] Write a failing smoke test asserting `/healthz` returns `{status:"ok"}` and rejects missing required configuration.
- [ ] Run `npm test -- tests/smoke/app.test.ts`; verify failure before implementation.
- [ ] Implement Fastify bootstrap, strict environment parsing, graceful shutdown and health endpoint.
- [ ] Add web and worker commands using the same image, with Postgres-only dependencies.
- [ ] Run unit tests and `docker compose -f deploy/compose.yml config`; verify both pass.
- [ ] Commit `chore: bootstrap booking attendant runtime`.

### Task 2: PostgreSQL schema and migration system

**Files:** Create `apps/server/src/db/types.ts`, `apps/server/src/db/migrations/001_initial.sql`, `apps/server/src/db/client.ts`, `tests/db/schema.test.ts`.

- [ ] Test required tables, service-professional overrides, UTC timestamps, customer consent fields and audit records.
- [ ] Add SQL for users, professionals, services, service_professionals, customers, conversations, messages, appointments, schedule_blocks, inbound_events, outbox_messages and audit_log.
- [ ] Add `hold`, `confirmed`, `cancelled`, `completed`, `no_show` and `expired` constraints.
- [ ] Add generated occupied range including copied before/after buffers and a GiST exclusion constraint for active holds/appointments.
- [ ] Add indexes for conversation ordering, outbox delivery and reminder due times.
- [ ] Run migrations against an ephemeral PostgreSQL container and pass schema tests.
- [ ] Commit `feat: add transactional appointment schema`.

### Task 3: Deterministic scheduling domain

**Files:** Create `apps/server/src/domain/schedule.ts`, `apps/server/src/domain/appointments.ts`, `apps/server/src/domain/services.ts`, `apps/server/src/domain/state-machine.ts`, `tests/domain/schedule.test.ts`, `tests/domain/appointments.test.ts`.

- [ ] Test wall-clock expediente, blocks, buffers, past dates and service-professional overrides.
- [ ] Test legal state transitions and reject illegal transitions.
- [ ] Implement availability queries using `America/Sao_Paulo` conversion and transactional inserts.
- [ ] Implement five-minute holds with expiration and atomic promotion to confirmation.
- [ ] Implement manual administrator/professional booking, cancellation, completion and no-show.
- [ ] Run domain tests including concurrent confirmation integration tests.
- [ ] Commit `feat: implement conflict-free scheduling domain`.

### Task 4: Durable message ingestion, debounce and outbox

**Files:** Create `apps/server/src/messaging/whatsapp-client.ts`, `apps/server/src/messaging/outbox.ts`, `apps/server/src/conversation/debounce.ts`, `apps/server/src/jobs/queue.ts`, `apps/server/src/http/meta-webhook.ts`, `tests/messaging/debounce.test.ts`, `tests/http/meta-webhook.test.ts`.

- [ ] Test Meta signature rejection, duplicate event idempotency and immediate webhook acknowledgement.
- [ ] Test grouping messages from one phone inside a four-second debounce window and isolation between phones.
- [ ] Persist every inbound event before enqueueing a job.
- [ ] Use pg-boss plus a PostgreSQL advisory transaction lock keyed by conversation id.
- [ ] Implement outbox records and retryable WhatsApp delivery with provider message IDs and delivery statuses.
- [ ] Run webhook contract tests with signed and tampered payloads.
- [ ] Commit `feat: add durable WhatsApp ingestion and conversation serialization`.

### Task 5: Luna tool orchestration and safe response rendering

**Files:** Create `apps/server/src/ai/luna-client.ts`, `apps/server/src/ai/tools.ts`, `apps/server/src/ai/prompt.ts`, `apps/server/src/conversation/orchestrator.ts`, `apps/server/src/messaging/renderers.ts`, `tests/ai/tools.test.ts`, `tests/conversation/orchestrator.test.ts`.

- [ ] Test tool schemas for service search, availability, hold creation, cancellation, rescheduling and human handoff.
- [ ] Test that invalid model arguments never reach domain mutations.
- [ ] Implement GPT-5.6 Luna client with low reasoning effort, stable cached prompt prefix, bounded history and conversation summary.
- [ ] Implement deterministic renderers for price, date, time, professional and confirmation messages.
- [ ] Implement WhatsApp list messages for available times and buttons for confirmation/alternate times.
- [ ] Route ambiguity, clinical content, unsupported requests and model failure to human handoff.
- [ ] Run mocked model contract tests and a 100-scenario Portuguese evaluation set.
- [ ] Commit `feat: add guarded Luna conversation orchestration`.

### Task 6: Reminders, templates and degraded mode

**Files:** Create `apps/server/src/jobs/reminders.ts`, `apps/server/src/jobs/holds.ts`, `apps/server/src/messaging/templates.ts`, `apps/server/src/operations/degraded-mode.ts`, `tests/jobs/reminders.test.ts`, `tests/operations/degraded-mode.test.ts`.

- [ ] Test reminder timing, timezone conversion, duplicate suppression and retry behavior.
- [ ] Add approved utility-template identifiers and variable validation without hard-coding current Meta prices.
- [ ] Expire holds and release occupied ranges through a scheduled job.
- [ ] Add per-phone/global rate limits and daily token/message budgets.
- [ ] On Luna failure, persist the turn, send a deterministic status message, alert the professional and retry later; never silently drop it.
- [ ] Verify behavior across the Meta 24-hour window and future billing changes.
- [ ] Commit `feat: add reminders limits and degraded operation`.

### Task 7: Admin panel and human takeover

**Files:** Create `apps/web/templates/`, `apps/web/public/app.js`, `apps/web/public/sw.js`, `apps/server/src/http/admin.ts`, `apps/server/src/http/sse.ts`, `tests/http/admin.test.ts`, `tests/http/sse.test.ts`.

- [ ] Test Cloudflare Access JWT identity mapping for `administradora` and `profissional` roles.
- [ ] Implement mobile-first agenda, service, professional, customer and conversation pages using Nunjucks/HTMX.
- [ ] Implement SSE updates, PWA installation metadata and Web Push subscription storage.
- [ ] Implement assume/pause/resume AI controls, one-tap approval in shadow mode and manual message sending.
- [ ] Implement service-professional price/duration overrides, blocks, holds and no-show closure.
- [ ] Verify keyboard and mobile layouts with browser automation.
- [ ] Commit `feat: add mobile admin panel and human takeover`.

### Task 8: Audio, media and privacy controls

**Files:** Create `apps/server/src/media/whatsapp-media.ts`, `apps/server/src/media/transcription.ts`, `apps/server/src/privacy/sensitive-content.ts`, `tests/media/transcription.test.ts`, `tests/privacy/sensitive-content.test.ts`.

- [ ] Test audio duration limits, transcription timeout and text fallback.
- [ ] Implement WhatsApp media download with signed/short-lived storage references and cleanup.
- [ ] Use OpenAI transcription for short voice notes; route long/failed audio to the professional.
- [ ] Detect likely clinical data and images, restrict automatic processing and create a human handoff.
- [ ] Add privacy notice, consent capture, export/delete operations and retention cleanup.
- [ ] Commit `feat: handle audio media and sensitive-content routing`.

### Task 9: Backups, monitoring and deployment

**Files:** Create `deploy/backup.sh`, `deploy/restore-check.sh`, `deploy/monitoring.md`, `deploy/portainer-stack.yml`, `tests/ops/backup.test.ts`.

- [ ] Test encrypted dump creation and restoration into an isolated PostgreSQL container.
- [ ] Implement daily local dump to RAID1_WD and encrypted offsite copy to R2/B2 with daily/weekly/monthly retention.
- [ ] Add health endpoints for web, worker, database, queue and webhook freshness.
- [ ] Add external uptime check and alert path independent of the homelab.
- [ ] Produce Portainer Stack with secrets, local database volume, Cloudflare route and no public database ports.
- [ ] Verify restart persistence, backup restore and deployment configuration.
- [ ] Commit `ops: add encrypted backups monitoring and Portainer deployment`.

### Task 10: Shadow rollout and production acceptance

**Files:** Create `tests/evals/scenarios.json`, `tests/evals/run-eval.ts`, `docs/runbook.md`, `docs/meta-onboarding.md`, `docs/operations.md`.

- [ ] Add 100 deterministic scenarios covering Portuguese dates, corrections, multiple services, audio, ambiguity, cancellation, concurrency and clinical handoff.
- [ ] Run shadow mode for at least 30 real conversations with one-tap professional approval.
- [ ] Require zero critical booking/fact errors and 20 consecutive clean supervised conversations before autonomous mode.
- [ ] Test Meta number onboarding, templates, webhook signature, optional coexistence and outbound delivery.
- [ ] Test Cloudflare Access, PWA push, human takeover, restart, restore and no-show closure.
- [ ] Record final acceptance results and enable automatic mode only after all gates pass.
- [ ] Commit `release: graduate booking attendant to production`.

## Plan Self-Review

- Schema, buffer constraints, state machine, debounce, deterministic rendering, templates, handoff, audio, privacy, backups, offsite recovery and acceptance criteria each have a dedicated task.
- No Redis, BullMQ, Prisma or unofficial WhatsApp dependency remains.
- No unresolved placeholders are present.
- The same public webhook/private panel boundary is applied consistently across deployment and tests.
- The plan deliberately keeps payment, marketing campaigns, clinical intake and receptionist roles outside the first release.
