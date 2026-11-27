# Phase 1 Audit — Atlas RAG Chat

- **Date:** 2026-11-24
- **Scope:** Read-only production-readiness audit of the Atlas RAG chat app (Next.js 16, React 19, TypeScript, Tailwind 4, Supabase/RLS, multi-provider chat).
- **Status:** Phase 1 only. No code changes were made. Phase 2 starts only after approval.
- **Remediation update (2026-11-27):** Findings have since been remediated. The original
  findings and baselines below are preserved as history; current per-finding status is in
  [Appendix A](#appendix-a--remediation-status-2026-11-27).

## 1. Executive verdict

Atlas has a real security substrate: RLS on every owner-scoped table, owner-prefixed storage keys, fail-closed provider resolution, timing-safe worker auth, DB-backed rate limits, and a durable ingestion queue.
But it is not shippable: `pnpm check` is red — typecheck/build fail, generated DB types are stale, and 12 of 216 tests fail.
Two functional gaps will bite a real deployment: uploads are only enqueued and the documented setup never runs the worker, and RAG silently answers with `gpt-4.1-mini` regardless of the selected provider.
The rest is operational hardening — no security headers, no account deletion/export, no health endpoint or structured logging, and README/docs that describe a schema and workflow that no longer exist.
This is unfinished refactor plus missing ops polish, not architectural rot. Fix the red checks and worker grants first, then streaming, key handling, and docs.

**Production readiness: NOT READY.**
Blockers: red typecheck/build/generated types (F01–F02), red tests (F03), unproven `service_role` grants (F05), uploads not processed in the documented setup (F04), no security headers (F08), no account deletion/export (F10), no health/observability (F14).

## 2. Checks run (real output)

| Check | Result |
|---|---|
| `pnpm typecheck` | ❌ exit 2 — TS2345 at `supabase-conversation-repository.ts:105`; TS2300 ×2 at `database.generated.ts:288-289`; TS2741 at `tests/ingestion-service.test.ts:80` |
| `pnpm lint` | ✅ exit 0 |
| `pnpm db:types:check` | ❌ “Database types are stale. Run `pnpm db:types` and commit the regenerated file.” |
| `pnpm test` | ❌ 12 failed / 204 passed (216), 8 of 31 files failed |
| `pnpm test:db` | ❌ 3 failed / 42 passed (45) |
| `pnpm build` | ❌ compiles, then “Failed to type check” with the same 4 TS errors |
| `pnpm check` | ❌ cannot pass (typecheck → db:types → test → build) |

Failing test files: `tests/ingestion-service.test.ts` (3), `tests/supabase-conversation-repository.test.ts` (2), `tests/routes/document-jobs-route.test.ts` (2), `tests/pglite-conversation-repository.test.ts` (1), `tests/pglite-runtime.test.ts` (1), `tests/db/generated-types.test.ts` (1), `tests/db/ingestion.test.ts` (1), `tests/db/migration-guard.test.ts` (1).

## 3. Findings

| ID | Severity | Area | File:lines | Evidence | Impact | Fix | Effort |
|---|---|---|---|---|---|---|---|
| F01 | Critical | Build / types | `src/modules/chat/supabase-conversation-repository.ts:105`; `src/modules/shared/integrations/database.generated.ts:288-289`; `tests/ingestion-service.test.ts:80` | `pnpm typecheck` fails with TS2345, TS2300 ×2, TS2741; `pnpm build` fails at TypeScript. | No production build; CI red. | Fix generator + regenerate types + update fixture. | 2–4h |
| F02 | Critical | DB types | `scripts/generate-db-types.mjs`; `database.generated.ts:288-289`; `supabase/migrations/0009_incremental_chat_and_worker.sql:14-97` | `pnpm db:types:check` says stale; generated `claim_ingestion_jobs` Returns contains `owner_id` twice; `upsert_conversation_messages` missing. | Type safety and build broken; drift will recur. | Dedupe returned columns in generator; regenerate and commit. | 2–4h |
| F03 | High | Tests | `tests/routes/document-jobs-route.test.ts:114-147`; `tests/pglite-conversation-repository.test.ts:141`; `tests/supabase-conversation-repository.test.ts:27-31`; `tests/pglite-runtime.test.ts:55`; `tests/db/ingestion.test.ts:478-499`; `tests/db/migration-guard.test.ts:26-52` | 12 failures: stale route expectations, single-`.order()` fake client, leftover DB rows, migration count 9 vs 10, service-role grant error. | Red suite masks real regressions; no trustworthy signal. | Update stale fixtures; reset DB per test; extend fake client; fix harness grants. | 4–6h |
| F04 | High | Functional / ingestion | `src/modules/chat/chat-workspace.tsx:648-655`; `src/app/api/documents/jobs/route.ts:84-86`; `src/modules/rag/ingestion-service.ts:120-187`; `supabase/schedules/ingestion-worker.sql:1-32`; `README.md:76` | Upload only enqueues; chat UI posts `{}` to `/api/documents/jobs`, which now returns 400; README never mentions the worker/schedule. | Fresh deployment following README leaves documents “queued” forever. | Document + schedule worker; remove the dead `{}` call; or restore a safe processing trigger. | 2–4h docs/schedule; 1d code |
| F05 | High | Reliability / DB privileges | `supabase/migrations/0009_incremental_chat_and_worker.sql:103-176`; `tests/db/ingestion.test.ts:478-499` | Functions are `security invoker`; only `grant execute` is added; `document_versions` has no explicit `service_role` grant; DB test fails “permission denied for table document_versions”. | Background ingestion may fail in production if Supabase default grants differ or are revoked. | Add explicit `grant select, update on public.document_versions, public.documents, public.ingestion_jobs to service_role`; mirror in test harness. | 1–2h |
| F06 | High | Performance / UX | `src/app/api/chat/route.ts:50-55`; `src/modules/chat/chat-workspace.tsx:440-499` | Route returns `jsonOk(fullResponse)`; UI sets `status: "streaming"` but replaces content only after full JSON. No `ReadableStream`/SSE anywhere. | Time-to-first-token equals full generation (up to 60s); fake “streaming” state. | Implement SSE streaming, or rename status and show honest indeterminate loading. | 1–2d SSE; 2h honest state |
| F07 | High | Product correctness | `src/modules/rag/answer-question.ts:85-86`; `src/modules/chat/chat-workspace.tsx:470`; `src/modules/chat/chat-service.ts:155-176` | RAG hardcodes `gpt-4.1-mini`; Supabase mode always sends the OpenAI key; `answerWithRag` ignores provider/model preferences. | Multi-provider UI is misleading; Anthropic/Gemini/Ollama selection does nothing for RAG. | Route RAG through the provider abstraction, or gate model selection to local mode and document it. | 1–2d implement; 1h gate |
| F08 | High | Security headers | `next.config.ts:3-9` | No `headers()`, no CSP/HSTS/X-Frame-Options/Referrer-Policy. | Weaker XSS/clickjacking defense, especially with browser-stored API keys. | Add security headers and a CSP compatible with the inline theme script. | 2–4h |
| F09 | High | Secrets / XSS blast radius | `src/modules/shared/lib/provider-api-key.ts:12,19,25`; `src/modules/chat/chat-workspace.tsx:470` | Provider keys stored in `localStorage` under `atlas-provider-key:*`, sent via `x-atlas-provider-key`. | Any XSS exfiltrates long-lived provider keys; keys persist across sessions. | Prefer server env keys; if BYOK is required, use session-scoped storage and document the risk. | 0.5–1d |
| F10 | High | Compliance | `src/app/api/conversations/route.ts:91`; no `/api/account/delete` or export route | Only conversation deletion exists; no account deletion, data export, or retention policy. | GDPR/CCPA gap for a multi-tenant product. | Add account deletion (cascade documents/conversations/storage) + export. | 1–2d |
| F11 | High | Deployment / migrations | `.github/workflows/migrations.yml:43-72` | On `main`, `supabase db push --yes` runs against production immediately after staging. | Destructive migration can reach prod without review/approval. | Require manual approval environment, dry-run, or separate release workflow. | 1h |
| F12 | Medium | Docs accuracy | `README.md:144-150`; `README.md:278-288`; `README.md:298-299` | README lists migrations 0001–0006 only (0007–0009 exist); links `docs/architecture/*` that do not exist; claims no migration runner while `migrations.yml` runs one. | Operators apply incomplete schema; RAG/chat break in non-obvious ways. | Phase 3 README rewrite + create `docs/`; verify every command. | 1–2d |
| F13 | Medium | Setup / env | `.env.example:1-13`; `src/modules/shared/integrations/supabase-service-client.ts:9`; `src/app/api/internal/ingestion-worker/route.ts:24` | Missing `SUPABASE_SERVICE_ROLE_KEY` and `ATLAS_INGESTION_WORKER_SECRET`, both required at runtime. | Worker fails closed with a confusing setup error. | Add both with comments and generation guidance. | 15m |
| F14 | Medium | Observability / ops | `src/modules/shared/lib/api-response.ts:67-84`; no health route | Only `console.error`; no request IDs, structured logs, metrics, or `/api/health`. | No liveness/readiness probe; incidents are hard to diagnose. | Add health endpoint, structured logger, and basic request/latency metrics. | 0.5–1d |
| F15 | Medium | Input validation | `src/modules/rag/document-processing.ts:26-43` | Type detection trusts extension/MIME only; no magic-byte sniffing. | Renamed non-PDF reaches `unpdf`; validation is weaker than it looks. | Sniff `%PDF-` for PDFs and reject mismatches. | 2h |
| F16 | Medium | Code quality / tests | `src/modules/chat/chat-workspace.tsx` (822 lines); `vitest.config.mts:11-13` | One god component; Vitest is `node` env and includes only `*.test.ts` — no `.tsx` component tests. | UI logic is hard to test/refactor; regressions likely. | Extract hooks/state machine; add jsdom + React Testing Library. | 2–3d |
| F17 | Low | Prompt safety | `src/modules/rag/answer-question.ts:81` | `title="${chunk.doc_title}"` interpolates unescaped filename into XML attributes. | Crafted filename can break out of `title`/`page` attributes; mitigated by untrusted-context instruction. | Escape `"`/`<`/`>` in attributes. | 30m |
| F18 | Medium | Process | Environment: “Is directory a git repo: no” | No Git repository, so Phase 2 “small reviewable commits” is impossible. | Cannot review/revert changes safely. | `git init`, commit baseline, then branch. | 15m |
| F19 | Low | Tooling | `package.json:6-7,42` | Requires Node `>=24` but `@types/node` is `^22.10.0`. | Type definitions lag runtime APIs. | Bump `@types/node` to 24. | 10m |
| F20 | Low | Dev config | `next.config.ts:5` | `allowedDevOrigins: ["192.168.10.87"]` hardcoded personal LAN IP. | Breaks other devs; leaks internal address. | Move to env or remove. | 10m |

### Unverified items (with verification method)

- **U1 — Hosted Supabase grants for `service_role`.** The local harness proves the gap, but hosted Supabase may grant all via default privileges. Verify: `select has_table_privilege('service_role','public.document_versions','select'), has_table_privilege('service_role','public.document_versions','update');` on the hosted DB.
- **U2 — Worker actually scheduled in staging/prod.** Verify: `select jobname, schedule, active from cron.job where jobname = 'atlas-ingestion-worker';` and check `net.http_post` history.
- **U3 — Deployment platform honors `maxDuration = 60`.** Verify against the chosen platform (Vercel plan, container, etc.).
- **U4 — Compliance obligations.** GDPR/CCPA/HIPAA/retention requirements are unknown. Verify with product/legal.
- **U5 — Rate-limit atomicity under concurrency.** The fixed-window function is DB-side, but concurrent behavior is untested. Verify with a parallel DB test.
- **U6 — Storage bucket policy on `storage.objects`.** The app prefixes keys with owner UUIDs, but the hosted bucket policy itself was not read. Verify in the Supabase dashboard/SQL.
- **U7 — Whether PGlite is intended beyond local dev.** `providers.ts:113-117` blocks it outside development; confirm that matches product intent.

## 4. Top 10 fixes by risk-reduced-per-hour

1. **Regenerate DB types + fix the generator (F01/F02)** — 2–4h. Unblocks typecheck, build, and `db:types:check`; everything else is noise until this is green.
2. **Update stale tests + per-test DB reset (F03)** — 4–6h. Restores a trustworthy suite; currently 12 failures hide real regressions.
3. **Add explicit `service_role` grants + harness grants (F05)** — 1–2h. Prevents a silent ingestion outage and makes the privilege model intentional.
4. **Complete `.env.example` (F13)** — 15m. Prevents the most common setup failure.
5. **Fix upload→worker path and document the schedule (F04/F12)** — 2–4h. Makes RAG actually work after upload; the current in-app trigger is a guaranteed 400.
6. **Add security headers + CSP (F08)** — 2–4h. Cheap, high-value hardening.
7. **Gate or implement RAG provider consistency (F07)** — 1h gate / 1–2d implement. Removes a misleading product promise.
8. **Add `/api/health` + structured logging (F14)** — 0.5–1d. Required for any real deployment.
9. **Move provider keys server-side or reduce persistence (F09)** — 0.5–1d. Shrinks XSS blast radius.
10. **Add account deletion + export (F10)** — 1–2d. Closes the compliance gap before public launch.

## 5. Things genuinely good

- **Server-validated identity.** `getSupabaseUser` uses `supabase.auth.getUser()`, not `getSession()` (`src/modules/auth/supabase-server.ts:37-46`).
- **Fail-closed provider resolution.** Local auth is development-only; unsupported auth/database pairings return `unconfigured` instead of mixing identities (`src/modules/shared/config/providers.ts:51-120`).
- **Worker auth is done correctly.** Bearer token compared with `timingSafeEqual`, and the secret must be ≥32 chars (`src/app/api/internal/ingestion-worker/route.ts:12-32`).
- **Rate limits are DB-backed and checked before body buffering.** Upload limit is consumed before reading the multipart body (`src/app/api/documents/route.ts:88-92`); the function is `security definer` with `search_path=''` (`supabase/migrations/0004_api_rate_limits.sql:84`).
- **Durable queue with real concurrency semantics.** `FOR UPDATE SKIP LOCKED`, bounded batch size, exponential backoff (`supabase/migrations/0007_durable_ingestion.sql`; `0009:326-334`).
- **Storage isolation is defense-in-depth.** Keys are server-generated and owner-prefixed, with UUID validation (`src/modules/rag/object-storage.ts:26-38`); bucket is private.
- **Prompt-injection framing is thoughtful.** Document excerpts are wrapped in `<untrusted_document_context>`, the system prompt says to treat them as data, and citations/abstention are post-processed (`src/modules/rag/answer-question.ts:92-108`).
- **Bounded inputs everywhere.** Chat body 64 KB, message 4,000 chars, 8 history turns (`src/modules/chat/chat-request.ts:7-9`); upload 4 MB + 64 KB request overhead (`upload-request.ts:12-27`); avatar 2 MB (`avatar-request.ts:6-8`).
- **Centralized error mapping without stack leakage.** `errorResponse` maps `AppError` subclasses to safe messages (`src/modules/shared/lib/api-response.ts:60-85`).
- **No raw HTML rendering.** Only one `dangerouslySetInnerHTML`, for a static theme script (`src/app/layout.tsx:25`); markdown is rendered via `react-markdown` without `rehype-raw` (`chat-message-list.tsx:23-34`).
- **Migration guard for legacy data.** `0002` refuses to run when existing documents have no owner (`tests/db/migration-guard.test.ts:4-24`).
- **Real migrations in the test harness.** PGlite applies the same SQL as Supabase, with `auth.uid()` stubs (`src/modules/shared/integrations/pglite-bootstrap.ts`, `tests/db/harness.ts`).

## 6. Roadmap

### Week 1 — Blockers (make it green and safe to deploy)

- F01/F02: fix generator, regenerate `database.generated.ts`, commit.
- F03: update stale tests; reset DB per test; extend the Supabase fake client; fix migration-count expectations.
- F05: add explicit `service_role` grants; mirror in harness; add a DB test that proves the worker can claim across owners.
- F04: remove the dead `{}` call from `chat-workspace.tsx`; document and apply `supabase/schedules/ingestion-worker.sql`; add worker env vars.
- F13: complete `.env.example`.
- F08: add security headers + CSP.
- F11: gate production migrations behind manual approval.
- F18: `git init` + baseline commit.
- **Exit:** `pnpm check` green; worker documented and scheduled; headers live.

### Week 2–3 — Quality and performance

- F06: implement SSE streaming (or explicitly downgrade the “streaming” state and show an honest loader).
- F07: decide OpenAI-only vs multi-provider RAG; implement or gate the UI.
- F09: move provider keys server-side, or scope them to the session and document the BYOK risk.
- F10: account deletion + data export.
- F14: `/api/health`, structured logger, request IDs, basic latency/error metrics.
- F15/F17: magic-byte sniffing; escape prompt attributes.
- F16: split `chat-workspace.tsx` into hooks/state + components; add jsdom/RTL tests.
- **Exit:** p95 time-to-first-token acceptable; UI logic covered; security review passed.

### Week 4 — Polish

- F12: rewrite README, create `docs/` (architecture, ADRs, runbook), `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`.
- Verify every documented command on a clean checkout.
- Accessibility pass (keyboard/focus/ARIA), dependency audit, deployment runbook.
- **Defer:** multi-provider RAG if OpenAI-only is acceptable; OCR for scanned PDFs; horizontal scaling of PGlite (it is dev-only); full CSP nonce migration if it risks the theme script.

## 7. Questions before Phase 2

1. **RAG provider scope:** Is production RAG intentionally OpenAI-only, or must it support the same providers as local chat? This determines whether F07 is a 1-hour gate or a 1–2-day feature.
2. **Streaming:** Is token streaming a launch requirement, or can Atlas ship request/response with an honest loading state? This is the biggest UX decision.
3. **Key ownership:** Should provider keys live in server env (recommended) or remain user-supplied BYOK in the browser? If BYOK, what is the accepted XSS risk?
4. **Compliance:** Are GDPR/CCPA/HIPAA or data-retention requirements in scope? If yes, F10 becomes a Week 1 blocker.
5. **Deployment target:** Vercel, Docker, or something else? This affects health checks, `maxDuration`, headers, and Node 24 support.
6. **Git:** May I initialize a Git repository and commit the current state as a baseline before Phase 2? Without it, “small reviewable commits” are impossible.
7. **Supabase environments:** Which project refs are staging vs production? Can I get a safe branch or dry-run path for migrations?
8. **PGlite:** Is `DATABASE_PROVIDER=postgres` strictly local dev, or is it expected to run anywhere else? If the latter, it is not production-safe.
9. **Stale tests:** Were the `document-jobs` route and `ClaimedIngestionJob.ownerId` changes intentional (worker-only processing), or should inline processing be restored?
10. **Latency budget:** What is the acceptable p95 answer latency and maximum answer length? This decides how urgently streaming must land.

## Appendix A — Remediation status (2026-11-27)

Verified with `pnpm verify:agent`: **PASS 5/5** (typecheck, lint, generated-type check,
tests, build), **259 tests passed / 0 failed across 99 files** (`.agent-logs/2026-11-27T11-01-19-409Z`).
The §2 baselines are historical; the repository is green as of this date.

| ID | Status | Evidence |
|---|---|---|
| F01 | **Fixed** | `scripts/generate-db-types.mjs` dedupes returned columns; `database.generated.ts` regenerated; `pnpm typecheck` and `pnpm build` pass. |
| F02 | **Fixed** | `pnpm db:types:check` passes. Generator now includes functions executable by `authenticated` **or** `service_role`; `claim_ingestion_jobs` has a single `owner_id`. |
| F03 | **Fixed** | Stale fixtures repaired (fake Supabase client chaining, per-test DB reset, migration counts). Suite is 259/259. |
| F04 | **Fixed** | Dead `{}` job call removed; worker path documented; migration `0012` self-applies the schedule when prerequisites exist, with `supabase/schedules/ingestion-worker.sql` as fallback. |
| F05 | **Fixed (hosted still U1)** | Migration `0010` adds explicit `service_role` table/sequence grants and service-role-only worker RPCs; `tests/db/ingestion.test.ts` proves cross-owner claiming. Hosted Supabase default grants remain unverified (U1). |
| F06 | **Fixed** | `POST /api/chat/stream` streams NDJSON `delta`/`result`/`error` frames; the JSON route remains for compatibility. |
| F07 | **Fixed** | RAG uses `buildRagCompletion`/`buildRagSystemPrompt` and honors the request-selected provider/model; embeddings remain OpenAI `text-embedding-3-small`. |
| F08 | **Fixed** | `next.config.ts` sends CSP, Referrer-Policy, X-Content-Type-Options, X-Frame-Options, Permissions-Policy, and production-only HSTS. |
| F09 | **Fixed** | Provider keys are server env only; `provider-api-key.ts` and the `x-atlas-provider-key` header were removed; the settings UI is a read-only connection card. |
| F10 | **Deferred** | Product decision: account deletion/export is not implemented. Remains a launch gap for regulated deployments. |
| F11 | **Fixed** | `migrations.yml` auto-pushes staging on `main`; production requires `workflow_dispatch` plus the `production` environment approval. |
| F12 | **Fixed** | README rewritten to match the current schema and workflow; migration table covers `0001`–`0012`; broken `docs/` links removed. |
| F13 | **Fixed** | `.env.example` lists `SUPABASE_SERVICE_ROLE_KEY` and `ATLAS_INGESTION_WORKER_SECRET` with generation guidance. |
| F14 | **Fixed** | `GET /api/health` plus `logStructured()` in `api-response.ts`; no external metrics/tracing yet. |
| F15 | **Fixed** | PDF uploads require a `%PDF-` magic-byte match in `document-processing.ts`. |
| F16 | **Partially fixed** | jsdom + React Testing Library component tests added (chat accessibility, provider key card). `chat-workspace.tsx` is still ~987 lines, but submit/regenerate share `runCompletion`; a full component split remains. |
| F17 | **Fixed** | Prompt `title`/attribute values are XML-escaped in `answer-question.ts`; covered by tests. |
| F18 | **Blocked** | `git` is not installed on PATH and the installer needs an interactive admin/UAC prompt. No repository exists yet. |
| F19 | **Fixed** | `@types/node` bumped to `^24.19.4`, matching the Node ≥ 24 engine. |
| F20 | **Fixed** | Hardcoded `allowedDevOrigins` removed; `poweredByHeader: false` set. |

Remaining open items are tracked in `PROJECT_CONTEXT.md` §7: account deletion/export
(deferred), Git initialization (blocked), PGlite dev-only, OCR for scanned PDFs, hosted
Supabase verification, no full E2E browser suite, and worker throughput bounded by the
one-job-per-minute cron cadence.
