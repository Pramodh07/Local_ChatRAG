# Atlas — Project Context (read this first)

> **Handoff document.** Read this file, then jump only to the files under "Where to dig deeper".
> Last verified: 2026-11-27. Git is **not installed on PATH** (F18 blocked, see §7); no repo yet.
> Dev server is running at `http://localhost:3000`.

## 1. What the project is

**Atlas** is a pre-release AI chat workspace. Users upload documents; the app extracts,
chunks, and embeds them; questions are answered with citations to the user's own source
passages. Two runtime profiles:

- **Supabase mode (production path):** Supabase Auth + RLS-scoped Postgres/Storage,
  owner-isolated RAG, durable async ingestion via a scheduled worker, multi-provider streaming.
- **Local mode (development):** local accounts with scrypt hashes, JSON stores or embedded
  PGlite, direct multi-provider chat — **no documents, no citations**. PGlite is dev-only.

All user data is owner-scoped (RLS + owner-prefixed Storage keys + in-function owner checks).

## 2. Tech stack

Next.js 16 (App Router, `proxy.ts` middleware) · React 19 · TypeScript 5 strict ·
Tailwind CSS 4 · Supabase Postgres + RLS + Storage + pgvector · PGlite (dev only) ·
OpenAI SDK + Anthropic/Gemini/Ollama adapters · Vitest (node + jsdom for `.tsx`) ·
ESLint + `eslint-plugin-react-hooks` (rules-of-hooks, exhaustive-deps only) ·
pnpm 11 · Node ≥ 24 (`@types/node` ^24, resolved 24.19.4).

## 3. Codebase map (key paths)

| Area | Location | Role |
|---|---|---|
| App Router pages + API routes | `src/app/` | Thin handlers; `api/chat/stream/route.ts` (NDJSON SSE), `api/chat/route.ts` (compat JSON), `api/health/route.ts`, pages for chat/knowledge/account/models/settings/usage |
| Runtime config | `src/modules/shared/config/providers.ts`, `src/proxy.ts` | Fail-closed provider resolution; session-cookie refresh middleware |
| Auth | `src/modules/auth/` | `local-auth.ts` (scrypt + hashed session tokens), `supabase-server.ts` (`getUser()`), `current-account.ts` |
| Chat | `src/modules/chat/` | `chat-service.ts`, `chat-workspace.tsx`, `stream-parser.ts`, `save-outbox.ts`, `conversation-diff.ts`, 3 repositories with `listMessages` (messages ordered by `created_at_ms, id`) |
| RAG | `src/modules/rag/` | `upload-request.ts`, `document-processing.ts`, `ingestion-service.ts` (15 s lease heartbeat), `rag-repository.ts` (`renewLease`), `answer-question.ts`, `supabase-object-storage.ts` (fixed bucket) |
| Account | `src/modules/account/` | `model-options.ts` (client-safe catalogue), `model-catalogue.ts` (re-export + pricing), `model-stream.ts` (server-key streaming), `local-model-runtime.ts`, `provider-connection.ts`, read-only `provider-api-key-section.tsx`, `account-models-section.tsx`, `usage.ts` |
| Shared | `src/modules/shared/` | `lib/errors.ts`, `lib/api-response.ts`, `lib/logger.ts`, `lib/json-store.ts`, `integrations/api-rate-limit.ts`, `integrations/pglite-*.ts`, `integrations/database.generated.ts` (incl. `renew_ingestion_lease`); `lib/provider-api-key.ts` **deleted** |
| Database | `supabase/migrations/0001–0012.sql`, `supabase/schedules/ingestion-worker.sql` (fallback), `db/local-migrations/0001_local_store.sql` | Schema, RLS, RPCs, self-applying worker schedule, local bootstrap |
| Tests | `tests/` | **259 tests / 0 failed across 99 files**; `.test.ts` + jsdom `.test.tsx`; component tests: `provider-api-key-section`, `chat-a11y`; `tests/db/harness.ts` documents PGlite-vs-hosted fidelity gap |
| Tooling | `scripts/`, `.github/workflows/`, `.github/dependabot.yml`, `vitest.config.mts`, `eslint.config.mjs` | DB type generator, local importer, agent verify runner, CI + migrations + weekly dependency updates |

## 4. Architecture essentials

**Runtime selection** — `resolveProviderConfig(env)` in `src/modules/shared/config/providers.ts`
is the single decision point. `AUTH_PROVIDER` overrides legacy `AUTH_MODE`. Valid pairings:
`local+local` (JSON), `local+postgres` (PGlite), `supabase+supabase`. Unsupported mixes and
local auth outside development fail closed. `src/proxy.ts` refreshes Supabase cookies only;
authorization is per-route via `auth.getUser()`.

**Auth** — Local: salted scrypt hashes, SHA-256-hashed session tokens in httpOnly
`SameSite=Lax` cookie, constant-time verify, 7-day TTL. Supabase: `@supabase/ssr` cookies,
`supabase.auth.getUser()` (never `getSession()`), profile synced from `auth.users` by a
trigger in `0002`.

**Chat flow** — Primary path is `POST /api/chat/stream`; `POST /api/chat` (JSON) remains for
compatibility. The stream route emits NDJSON frames `delta` / `result` / `error` with
`application/x-ndjson`, `no-cache`, `X-Accel-Buffering: no`, and returns 499 on abort.
`streamLocalModelAnswer()` (`account/model-stream.ts`) streams OpenAI/Anthropic/Gemini/Ollama
using **server env keys only**. The client parses lines with `createLineParser()`; submit and
regenerate share one path.
- Local: provider/model come from account preferences; `citations: []`.
- Supabase: `consumeApiRateLimit` (20/min), RAG retrieval via `buildRagCompletion()` /
  `buildRagSystemPrompt()` (`NO_DOCUMENTS_ANSWER` when empty), then the answer is streamed with
  the request-selected provider/model. Client preference `atlas-chat-model-preference` is
  editable in `SupabaseModelSection`; catalogue in client-safe `model-options.ts` (re-exported
  by `model-catalogue.ts`). **Embeddings remain OpenAI-only** (`text-embedding-3-small`).
- Conversations persist incrementally (`conversation-diff.ts`); `save-outbox.ts` persists
  failed writes with idempotent replay, a 10 s retry loop and `pagehide`/`keepalive` flush.
- History pagination: `ConversationRepository.listMessages()`; `GET /api/conversations` returns
  metadata only (`messages: []`), `GET /api/conversations?id=<uuid>` returns `{ messages }`;
  the client lazy-loads per conversation and filters by reference, not array position (P05).

**RAG pipeline** — Upload → rate-limit check before body buffering → 4 MB / multipart
validation → SHA-256 dedupe → private Storage key `{ownerId}/{documentId}/{versionId}` →
`ingestion_jobs` row → HTTP 202. Worker `POST /api/internal/ingestion-worker` (Bearer
secret ≥ 32 chars, server `OPENAI_API_KEY`) claims jobs with `FOR UPDATE SKIP LOCKED`, extracts
(PDF/TXT/MD; ≤200 pages; ≤250k chars; `%PDF-` sniff), chunks, embeds with
`text-embedding-3-small` (1536 dims), inserts chunks in batches of 50, marks `ready`. A
15 s heartbeat calls `renewLease(jobId)` → service-role-only `renew_ingestion_lease(uuid)`
(0011) during extraction/embedding so stale-lock recovery cannot reclaim a live job.
Deletion uses a storage-cleanup outbox. **Schedule:** migration 0012 self-applies the every-minute
pg_cron + pg_net job when the extensions and both Vault secrets exist; otherwise no-op and
`supabase/schedules/ingestion-worker.sql` remains the manual fallback.

**Database migrations (`0001`–`0012`)** — 0001: pgvector schema + RLS; 0002: owner scoping
+ profile sync trigger; 0003: avatar; 0004: DB rate limits; 0005: scoped profile updates +
owner index; 0006: conversations/messages; 0007: durable ingestion, document versions, cleanup
queue, private bucket + policies, RPCs; 0008: retrieval indexes; 0009: incremental
`upsert_conversation_messages`, revokes `replace_conversations`; 0010 (append-only): service_role
table/sequence grants, worker RPCs service-role-only, forces `document-uploads` private; 0011:
service-role-only `renew_ingestion_lease(uuid)`; 0012: self-applying pg_cron schedule (no-op
without prerequisites). `scripts/generate-db-types.mjs` includes functions executable by
`authenticated` **or** `service_role`, throws on duplicate return columns; regenerated
`database.generated.ts` has `upsert_conversation_messages` and `renew_ingestion_lease`, omits
`replace_conversations`, and has a single `owner_id` in `claim_ingestion_jobs.Returns`.

**Ops surface** — `next.config.ts` sends CSP (`'unsafe-inline'` script-src for the theme
script, plus dev-only `'unsafe-eval'` to stop Next dev refresh loops; production CSP unchanged),
`Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy` and
production-only HSTS; `poweredByHeader: false`; no hardcoded dev origin. `.env.example` lists
server-only `SUPABASE_SERVICE_ROLE_KEY` and `ATLAS_INGESTION_WORKER_SECRET`. The document bucket
is fixed to `document-uploads` (`documentBucketName()`); `SUPABASE_DOCUMENT_BUCKET` was removed
because 0007 policies hardcode that id. `errorResponse()` logs via `logStructured()`;
`GET /api/health` reports non-secret provider config + timestamp. Provider keys are **server env
only**; Ollama needs none; `provider-api-key-section.tsx` is a read-only connection card.

**Correctness / a11y hardening** — UUID validation on conversation ids, corrupt rows skipped and
logged, shared `DOCUMENT_STATUSES`/`JOB_STATUSES` constants, bounded RAG queries, message order
by `created_at_ms, id` (no `sequence` reliance) in both repositories and SQL, unused `ownerId`
args removed from RagRepository/ingestion/document-service call chains, `aria-live` limited to a
short status `announcement`, SourcePanel `role="dialog"`/`aria-modal` with Escape/focus;
covered by `tests/components/chat-a11y.test.tsx`. ESLint enables only `rules-of-hooks` and
`exhaustive-deps` as errors (no `set-state-in-effect`); flagged chat-workspace deps were fixed
with `useMemo` for `latestCitations` and an extracted `lastMessageContent`.

## 5. Running & verifying

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

Default env selects local auth. Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm test:db`, `pnpm build`, `pnpm check` (all), `pnpm db:types` / `:check`,
`pnpm local:import[:dry]`, `pnpm verify:agent` / `verify:fast` / `verify:json` (compact
runner; full logs in `.agent-logs/<timestamp>/`).
`vitest.config.mts` includes `.test.ts` and `.test.tsx` (jsdom via docblock).
Configuration: provider keys come from server env; Supabase chat sends `provider`/`model` in
the request body with local preference `atlas-chat-model-preference`; the bucket name is not
configurable. CI: `ci.yml` runs `pnpm audit --prod --audit-level high` then `pnpm check`;
`dependabot.yml` does weekly npm/Actions updates; `migrations.yml` pushes to `main` migrate
**staging only** (production needs manual `workflow_dispatch` + environment approval).
`README.md` mirrors the green status and lists migrations 0001–0012.

## 6. Current status — green baseline (verified 2026-11-27)

| Check | Result |
|---|---|
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm db:types:check` | Pass — generated types match |
| `pnpm test` | Pass — **259 tests / 0 failed across 99 files** (`vitest.json`) |
| `pnpm build` | Pass |
| `pnpm verify:agent` | **Pass — all 5 steps** (latest `.agent-logs/2026-11-27T11-01-19-409Z`) |
| `pnpm audit --prod --audit-level high` | Pass (last run 2026-11-25) |

Earlier baselines (TS errors, stale types, failing tests, 230/256 tests) are resolved.
Green checks do **not** mean release-ready — open gaps are in §7.

## 7. Known issues & traps (still open)

- **Account deletion/export deferred** by user decision; no self-serve data export/deletion.
- **Git init blocked (F18/P9):** `git` is not installed on PATH; `winget install Git.Git` needs
  an admin/UAC prompt that cannot be answered non-interactively. No repo exists → no reviewable
  commits.
- **PGlite is dev-only** (`local+postgres`); not a production database profile.
- **Scanned PDFs need OCR** — extraction requires selectable text.
- **Hosted Supabase verification pending:** DB tests run real migrations on PGlite with auth
  stubs (`tests/db/harness.ts`); hosted grants, Storage policies and Vault/cron behaviour are
  not exercised there.
- **No full E2E tests** — coverage is unit/service/route plus two jsdom component tests.
- **Worker throughput bounded by cron cadence:** 1 job/min; the 15 s lease heartbeat protects
  long jobs but does not increase concurrency.

Earlier audit findings (stale types, worker grants/BYOK keys, fake streaming, save loss,
sequence ordering, custom bucket override, dev refresh loop, P05/P09/P11/P12/P16/P17/P20/P22)
are resolved. Both audit reports now end with a **2026-11-27 remediation appendix** that
maps every finding to its status and evidence; the original bodies are historical.

## 8. Where to dig deeper (jump straight to these)

- Provider matrix / config: `src/modules/shared/config/providers.ts`, `src/modules/account/model-options.ts`
- Local auth internals: `src/modules/auth/local-auth.ts`
- Chat orchestration: `src/modules/chat/chat-service.ts`, `src/app/api/chat/route.ts`,
  `src/app/api/chat/stream/route.ts`
- Client chat state machine: `src/modules/chat/chat-workspace.tsx`
- Streaming + save resilience: `src/modules/chat/stream-parser.ts`, `src/modules/chat/save-outbox.ts`,
  `src/modules/account/model-stream.ts`
- RAG answer + citations: `src/modules/rag/answer-question.ts`
- Ingestion lifecycle + lease heartbeat: `src/modules/rag/ingestion-service.ts`,
  `src/modules/rag/rag-repository.ts`
- Queue RPC semantics: `supabase/migrations/0007_durable_ingestion.sql`,
  `0009_incremental_chat_and_worker.sql`, `0010_worker_grants_and_bucket_privacy.sql`,
  `0011_ingestion_lease_heartbeat.sql`, `0012_ingestion_worker_schedule.sql`
- Worker endpoint: `src/app/api/internal/ingestion-worker/route.ts`
- DB type generator: `scripts/generate-db-types.mjs`
- Security headers / liveness: `next.config.ts`, `src/app/api/health/route.ts`
- Structured logging: `src/modules/shared/lib/logger.ts`, `src/modules/shared/lib/api-response.ts`
- Test config / fidelity / component tests: `vitest.config.mts`, `tests/db/harness.ts`,
  `tests/components/chat-a11y.test.tsx`, `tests/components/provider-api-key-section.test.tsx`
- Verification runner: `scripts/agent/README.md`
- Detailed (historical) audits: `audits/phase-1-audit-2026-11-24.md`,
  `audits/phase-2-audit-2026-11-24.md`
- Production-readiness vs. competitors and 2027 standards (scorecard, gap register):
  `audits/production-readiness-2027-2026-11-27.md`
