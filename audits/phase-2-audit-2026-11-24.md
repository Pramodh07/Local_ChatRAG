# Phase 2 Audit — Atlas RAG Chat

- **Date:** 2026-11-25 (Phase 2 pass; Phase 1 dated 2026-11-24)
- **Scope:** Deeper read-only audit. Phase 1 covered production blockers. Phase 2 covers test architecture, maintainability, performance, accessibility, data-integrity edges, dependency/tooling risk, migration safety, and the U1–U7 items Phase 1 could not verify.
- **Status:** Read-only. No source files were changed. This report is written to `audits/` only.
- **Remediation update (2026-11-27):** Findings have since been remediated. The original
  findings and baselines below are preserved as history; current per-finding status is in
  [Appendix B](#appendix-b--remediation-status-2026-11-27).
- **Relationship to Phase 1:** Phase 1's blockers (F01–F05, F08, F10, F14) still stand. Phase 2 adds 26 findings (P01–P26), none of which replace the Phase 1 blockers. Where Phase 2 re-checked a Phase 1 claim, the correction is listed in §7.

## 1. Executive verdict

The architecture is sound but the *edges* are where this will hurt: the client loads every conversation and every message on page load, the Knowledge Base polls in a tight loop while a job is pending, and the chat save queue silently drops failed writes.
The test suite cannot see any of that because there are no component tests and the DB harness only approximates Supabase.
The most dangerous Phase 2 issue is structural: the type generator only emits functions that `authenticated` may execute, while the worker RPCs are meant to be `service_role`-only — so the correct security fix (revoking `authenticated`) will silently break the worker's typed client.
Nothing here is architectural rot. It is a set of bounded, mostly independent fixes that should be sequenced *after* Phase 1 turns the repo green.

**Production readiness: NOT READY** (unchanged from Phase 1).
Phase 2 adds no new release blocker, but P01, P03, P04, and P11 are the four that will produce user-visible failures under real load or a real deployment.

## 2. Current check baseline (re-run 2026-11-25)

| Check | Result |
|---|---|
| `pnpm typecheck` | ❌ exit 2 — TS2345 `supabase-conversation-repository.ts:105`; TS2300 ×2 `database.generated.ts:288-289`; TS2741 `tests/ingestion-service.test.ts:80` |
| `pnpm lint` | ✅ exit 0 |
| `pnpm db:types:check` | ❌ “Database types are stale. Run `pnpm db:types` and commit the regenerated file.” |
| `pnpm audit --prod` | ✅ exit 0 — no known vulnerabilities (2026-11-25) |
| `pnpm test` | ❌ 12 failed / 205 passed (217), 8 of 31 files |
| `pnpm build` | Not re-run in Phase 2. Phase 1 result stands: compiles, then fails at type check with the same errors. |
| `pnpm check` | ❌ cannot pass (typecheck → db:types → test → build) |

Current failing files (re-run, not carried over):

- `tests/ingestion-service.test.ts` — 3
- `tests/supabase-conversation-repository.test.ts` — 2
- `tests/routes/document-jobs-route.test.ts` — 2
- `tests/pglite-conversation-repository.test.ts` — 1
- `tests/pglite-runtime.test.ts` — 1
- `tests/db/generated-types.test.ts` — 1
- `tests/db/ingestion.test.ts` — 1
- `tests/db/migration-guard.test.ts` — 1

Note: the suite is now 217 tests (Phase 1 recorded 216). The failure count is unchanged, so the extra test passes.

## 3. Findings

Severity: **High** = user-visible failure or data loss at normal scale; **Medium** = real defect with a workaround or a maintainability trap that will cause one; **Low** = hygiene.

| ID | Severity | Area | File:lines | Evidence | Impact | Fix | Effort |
|---|---|---|---|---|---|---|---|
| P01 | High | Performance / correctness | `src/modules/chat/supabase-conversation-repository.ts:65-101`; `src/modules/chat/conversation-validation.ts:4-6`; `src/app/api/conversations/route.ts:33-49` | `list()` fetches every conversation, then every message for those conversations, with no `.range()` or pagination. Validation permits 500 conversations × 2,000 messages. Supabase's default PostgREST row cap is 1,000, so a batched `.in()` message query silently truncates beyond 1,000 rows. | Slow first paint, multi-MB JSON, memory growth, and **silently missing messages** once a user passes the cap. The UI has no way to know history was truncated. | Return conversation metadata from `GET /api/conversations`; add `GET /api/conversations/:id/messages` (or a `?conversationId=` parameter) and load messages lazily. Add explicit `.range()` loops for any bulk read. | 1–2d |
| P02 | High | Performance / reliability | `src/modules/rag/components/knowledge-base-dashboard.tsx:81-100,106-127` | The polling effect depends on `documents`. `loadDocuments()` calls `setDocuments(payload.documents)` with a fresh array every tick, so the effect cleanup runs and re-arms the 600 ms timer on every poll. The intended 2,500 ms delay at line 119 is effectively unreachable; the loop is ~600 ms plus request time. There is no backoff and no maximum duration. | One `GET /api/documents` (two DB reads) roughly every 0.6–1 s per open tab while any document is `queued`/`processing`. A stuck job polls forever. This is the largest avoidable load source in the app. | Drive polling from an interval/ref that does not depend on `documents`, or compare a status signature before re-arming. Add exponential backoff and stop after N minutes with a manual “Refresh”. | 2–4h |
| P03 | High | Types / security sequencing | `scripts/generate-db-types.mjs:247-257`; `supabase/migrations/0009_incremental_chat_and_worker.sql:175-176`; `supabase/migrations/0007_durable_ingestion.sql:453,513,575,653,702,744,778`; `src/modules/shared/integrations/supabase-service-client.ts:4` | The generator introspects only functions where `has_function_privilege('authenticated', p.oid, 'execute')`. `0007` granted the worker RPCs to `authenticated`; `0009` replaced them and added `service_role` grants but did not revoke `authenticated`. The worker client is typed from `database.generated`. | If you do the security-correct thing and revoke `authenticated` from `claim_ingestion_jobs` et al., the next `pnpm db:types` **removes those RPCs from `Database`**, and the worker's `supabase.rpc(...)` calls stop compiling. The current grants are therefore load-bearing by accident. | Generate types for all `public` functions (or union `authenticated` + `service_role`). Then revoke `authenticated` from worker RPCs in a new migration. Do the generator fix **before** the grant fix. | 2h |
| P04 | High | Reliability / data loss | `src/modules/chat/chat-workspace.tsx:244-283,346`; `src/app/api/conversations/route.ts:52-75` | `pendingSaveRef` is cleared before the request runs. On failure the batch is dropped; only a toast is shown (`:280-282`). The unmount cleanup calls `flushPendingSave()` with a normal `fetch` (no `keepalive`), so closing/navigating the tab can cancel the last write. | Messages can be lost silently on a flaky network, a 5xx, or a tab close. This contradicts the “durable” framing of the rest of the app. | Add a client outbox (IndexedDB/localStorage) keyed by message id; retry with backoff; use `fetch(..., { keepalive: true })` or `navigator.sendBeacon` on `pagehide`; show a persistent “not saved” state until acknowledged. | 1d |
| P05 | Medium | Performance | `src/modules/chat/chat-workspace.tsx:50-52,304-325` | Every `conversations` change stringifies every message of every conversation (`sameMessage`) and runs `findIndex` per message inside a `flatMap`, which is O(n²) per conversation. | UI jank and CPU burn on large histories; worst case approaches the 500 × 2,000 limits in P01. | Track a `dirtyMessageIds` set (or compare object references) instead of deep-diffing the whole tree. Keep the snapshot map only for the fields that need it. | 4–6h |
| P06 | Medium | Accessibility | `src/modules/chat/chat-workspace.tsx:743-747`; `src/modules/chat/components/source-panel.tsx:20-28` | Mobile overlays are `<div onClick>` with `aria-hidden="true"`, and the Sources panel is a fixed `<aside>` with no `role="dialog"`, `aria-modal`, focus trap, Escape handler, or focus return. | Keyboard and screen-reader users can tab into content behind the overlay and cannot dismiss it with Escape. Clicking the backdrop is the only pointer-only path. | Use native `<dialog>` (or add `role="dialog"` + `aria-modal` + focus trap + Escape + restore focus). Make the backdrop a `<button aria-label="Close">`. | 3–4h |
| P07 | Medium | Accessibility | `src/modules/chat/components/chat-message-list.tsx:299` | `aria-live="polite"` wraps the entire transcript. Any re-render that changes the subtree (copy state, regenerate, status change) re-announces the whole conversation. | Screen-reader users get flooded with repeated transcript content and may miss the actual new answer. | Keep the transcript out of the live region. Add one visually-hidden `role="status"` region that announces only “Searching…”, “Answer ready”, and errors. | 2h |
| P08 | Medium | Maintainability | `src/modules/chat/chat-workspace.tsx:392-482,484-582` | `submitPrompt` and `regenerateResponse` are near-identical ~90-line blocks (fetch, header construction, error mapping, message patch). They already diverge: regenerate does not clear `archivedAt`, and neither shares the request-building code. | Every chat behavior change must be made twice; the two paths will drift further. | Extract `runCompletion({ conversationId, assistantId, text, history, replace })` and a `useChatCompletion` hook. Behavior-preserving refactor with the existing tests as the safety net. | 1d |
| P09 | Medium | Tooling / process | `eslint.config.mjs:5-31`; `src/modules/account/components/account-dashboard.tsx:129-201` | ESLint runs `@eslint/js` + `typescript-eslint` + prettier only. There is no `eslint-plugin-react-hooks`, so `exhaustive-deps` is not enforced. The account effect at `:129-201` reads `account.id` but depends on `[localMode, section]`; the P02 loop is the same class of bug. | Hook dependency bugs recur and are invisible to `pnpm lint`. | Add `eslint-plugin-react-hooks` (new dev dep, justified) and fix the reported dependencies. Do this before the P02/P05 refactors so the fixes stay fixed. | 2–4h |
| P10 | Medium | Reliability / ops | `src/app/api/internal/ingestion-worker/route.ts:8,41-45`; `src/modules/rag/document-processing.ts:5-8`; `supabase/migrations/0009_incremental_chat_and_worker.sql:136-138`; `supabase/migrations/0007_durable_ingestion.sql:83,611-617` | The cron calls the worker every minute; the route processes `limit: 1` and has `maxDuration = 60`. A single upload can be 4 MB / 200 PDF pages / 250k extracted characters (~250 chunks at the default 1,200-char chunk size). Stale-lock recovery is 10 minutes and each reclaim increments `attempts`; `max_attempts` is 3. | A slow-but-valid document can exceed 60 s three times and be permanently marked failed. Throughput is capped at one document per minute per project. | Add a lease heartbeat (extend `locked_at` during embedding) or move processing to a long-running worker/queue. Until then, raise the per-invocation limit, lower the max upload/chunk count, and make `maxDuration` a documented platform requirement. | 1–2d |
| P11 | Medium | Deployment / ops | `supabase/schedules/ingestion-worker.sql:1-32`; `.github/workflows/migrations.yml:39-41,70-72`; `.env.example:1-13`; `README.md` | The schedule lives outside `supabase/migrations`, so `supabase db push` never applies it. The migrations workflow only pushes migrations. `.env.example` omits `SUPABASE_SERVICE_ROLE_KEY` and `ATLAS_INGESTION_WORKER_SECRET`. | A fresh deployment following the repo has no worker: every upload stays `queued` forever. This is Phase 1 F04/F13, but Phase 2 confirms there is no automated path that fixes it. | Add a documented “apply schedules” step (or a migration that calls `cron.schedule`), add the two env vars with generation guidance, and add a health check that reports queued-job age. | 2h + docs |
| P12 | Medium | Config / storage | `src/modules/rag/supabase-object-storage.ts:13-19`; `supabase/migrations/0007_durable_ingestion.sql:833-862` | `SUPABASE_DOCUMENT_BUCKET` allows any valid bucket name, but the storage policies hardcode `bucket_id = 'document-uploads'`. The bucket insert uses `on conflict (id) do nothing`, so an existing public bucket is never flipped to private. | A custom bucket makes every upload/download fail RLS (or, if the operator also creates permissive policies, may expose files). A pre-existing public `document-uploads` bucket stays public. | Either remove the bucket-name override, or generate policies for the configured bucket. Add an assertion/migration that sets `public = false` on conflict. | 1–2h |
| P13 | Medium | Input validation | `src/modules/chat/conversation-validation.ts:25-27,49-51`; `supabase/migrations/0009_incremental_chat_and_worker.sql:42,63`; `src/modules/chat/pglite-conversation-repository.ts:141-158` | Validation accepts any 1–128 character message/conversation id. The SQL casts those ids to `uuid`. A malformed id reaches Postgres as `22P02 invalid input syntax for type uuid`. | Hand-crafted or corrupted requests produce a 500 and a generic error instead of a 400. Logs fill with database cast errors. | Validate UUID format in `isMessage`/`isConversation` (or switch the columns to `text`). Add a route test for a non-UUID id. | 1h |
| P14 | Medium | Reliability | `src/modules/chat/supabase-conversation-repository.ts:50-52`; `src/modules/chat/pglite-conversation-repository.ts:58-60` | `toConversation` throws when `isConversation` fails. One row with an unknown `status`/`role` (e.g., after a partial deploy) aborts the whole `list()`. | The entire chat history fails to load because of one bad message. The UI shows “Chat history could not be loaded” and the user cannot reach any conversation. | Skip and log invalid rows, or quarantine them into a per-conversation error marker. Never let one row fail the list. | 2h |
| P15 | Medium | Product coherence | `src/modules/rag/ingestion-service.ts:120-126`; `src/app/api/internal/ingestion-worker/route.ts:34-39`; `src/modules/chat/chat-workspace.tsx:584-632`; `src/modules/rag/components/knowledge-base-dashboard.tsx:129-144` | Upload accepts a user key but `upload()` discards it (`apiKey: _apiKey`). The worker hard-requires `process.env.OPENAI_API_KEY`. Chat uses the user-supplied key, and the chat composer's upload sends it (`:594`), but the Knowledge Base upload does not (`:140-142`). | A deployment that relies on user-supplied keys can chat but can never ingest. The UI does not explain this split. | Decide the key model (Phase 1 Q3). If BYOK stays, store it server-side encrypted per owner and use it in the worker; otherwise remove the upload header and state that ingestion needs a server key. | 1–2d |
| P16 | Medium | Test architecture | `vitest.config.mts:11-14`; `tests/**/*.test.ts` (no `.tsx`) | Vitest is `environment: "node"` and includes only `tests/**/*.test.ts`. There are zero component/DOM tests, so every Phase 2 finding in `.tsx` (P02, P04, P05, P06, P07, P08) is untestable today. | UI regressions are invisible to CI. The 205 passing tests create false confidence about the parts users actually touch. | Add `jsdom` + `@testing-library/react` (or Playwright smoke tests) and cover: send/stop/regenerate, save failure, pending-document polling, source panel keyboard close. | 1–2d |
| P17 | Medium | Test fidelity | `tests/db/harness.ts:56-92`; `tests/db/ingestion.test.ts:478-499`; `tests/supabase-conversation-repository.test.ts:11-38` | The harness recreates `auth.users`, `auth.uid()`, and roles, but not PostgREST, Storage, `pg_cron`, `vault`, or Supabase's default table grants. The fake Supabase client's `order()` returns a Promise immediately, so a second `.order()` throws; `.in()` is ignored. | DB tests can fail for harness-only reasons (the `service_role` claim test) and pass while hosted behavior differs. Repository tests cannot catch cross-conversation leaks because `.in()` is not filtered. | Document the divergence. Add explicit `service_role` table grants to the harness (and to a migration). Replace the ad-hoc fake with a builder that models chaining/filters, or test the repository against PGlite. | 4–8h |
| P18 | Low | RAG correctness | `src/modules/rag/answer-question.ts:33-50` | If the answer contains no `[n]` marker and no abstention phrase, `extractCitedSources` returns **all** retrieved chunks as citations. | The UI shows sources the model never cited, which undermines the “verify citations” promise and can imply support that is not there. | Return `[]` when no marker is found; keep the abstention special case only for the empty-source message. Add a unit test. | 30m |
| P19 | Low | Performance | `src/modules/rag/rag-repository.ts:292-333` | `listDocuments` selects every ingestion job the owner has ever had (`:302-306`) and reduces to the latest per document in JS. | Unbounded growth with retries/versions; the documents page gets slower over time for no reason. | Use a lateral/`distinct on (document_id)` query or a `latest_job_id` column. | 2h |
| P20 | Low | Maintainability | `src/modules/rag/ingestion-service.ts:120-126`; `src/modules/rag/rag-repository.ts:222,259-265`; `supabase/migrations/0009_incremental_chat_and_worker.sql:11-12` | `UploadDocumentInput.apiKey` is unused; `insertChunks(_ownerId, ...)` ignores its owner; `retryJob`/`getJob` take `ownerId` but the RPCs ignore it (they use `auth.uid()`/service-role); `replace_conversations` is revoked but never dropped. | Callers believe `ownerId` scopes these calls when it does not. The dead parameters invite a future cross-tenant bug. | Remove unused parameters or enforce them in SQL. Drop `replace_conversations`. | 2h |
| P21 | Low | Maintainability | `src/modules/rag/rag-repository.ts:74-79`; `src/modules/rag/components/knowledge-base-dashboard.tsx:19-24`; `src/modules/rag/ingestion-types.ts:7-11` | `DocumentStatus`/`JobStatus` sets are re-declared in three places. `ingestion-types.ts` already exports the const arrays. | Adding a status requires three edits; a missed one silently maps the new value to `"failed"`. | Import the const arrays from `ingestion-types.ts` everywhere. | 1h |
| P22 | Low | Data model | `supabase/migrations/0009_incremental_chat_and_worker.sql:4-9` | `0009` drops `messages_conversation_id_sequence_key` and replaces it with a non-unique index. The client still sends `sequence` from array position. | Two messages can share a sequence; ordering falls back to `created_at_ms`/`id`, so a transcript can reorder unexpectedly. | Either restore uniqueness on `(conversation_id, sequence)` or stop using `sequence` for ordering and sort by `created_at_ms, id`. | 2h |
| P23 | Low | Robustness | `src/modules/chat/chat-workspace.tsx:88`; `tsconfig.json:11` | `active = conversations.find(...) ?? conversations[0]` is typed non-null because `noUncheckedIndexedAccess` is off. The delete/archive flows briefly replace the list. | A transient empty list would crash on `active.messages`. Low probability, high blast radius. | Add an explicit empty state / guard. Consider enabling `noUncheckedIndexedAccess` in a follow-up. | 1h |
| P24 | Low | Config hygiene | `next.config.ts:3-9` | `allowedDevOrigins: ["192.168.10.87"]` hardcodes one developer's LAN IP; `X-Powered-By` is not disabled. | Breaks other developers' dev origins and leaks an internal address. | Move to an env var or remove; set `poweredByHeader: false`. | 15m |
| P25 | Low | Tooling | `package.json:7,42` | `engines.node` is `>=24`, `@types/node` is `^22.10.0`. | Type definitions lag the runtime; new Node APIs are untyped or wrongly typed. | Bump `@types/node` to 24. | 10m |
| P26 | Low | Dependencies / supply chain | `package.json:25-51`; `.github/workflows/ci.yml:28-32` | All 23 dependencies use caret ranges; `pnpm-lock.yaml` exists and CI installs with `--frozen-lockfile`. There is no `pnpm audit` step, no Dependabot, and no Renovate config. `pnpm audit --prod` on 2026-11-25 reported no known vulnerabilities. | The tree is clean today, but nothing detects the next advisory or opens update PRs; upgrades happen ad hoc and can drift a minor version. | Add `pnpm audit --prod --audit-level high` to CI and add Dependabot (or Renovate) for weekly updates. Keep the lockfile as the deploy source of truth. | 1h |

## 4. Deep dives

### 4.1 P01 — the history endpoint is the app's scalability ceiling

`createSupabaseConversationRepository().list()` does two things that do not compose at scale:

1. It selects all conversations for the owner (`:66-71`).
2. It batches conversation IDs by 100 and selects **all** messages for each batch (`:75-90`), then groups in memory.

The validation layer explicitly allows 500 conversations and 2,000 messages each (`conversation-validation.ts:4-6`), so the code's own contract says “up to 1,000,000 messages”. The route returns the entire structure as JSON (`route.ts:41-43`).

The silent part is PostgREST. Supabase's REST API applies a default `max-rows` (1,000). Unless the project raises it, each 100-conversation batch is capped at 1,000 message rows, and the code has no way to detect the truncation. A user with a long history would see older messages vanish — not an error, just missing data.

This is a contract change, not a query tweak: split metadata from messages, paginate, and add a test that asserts an explicit range loop.

### 4.2 P02 — the polling loop is a self-inflicted load test

The effect at `knowledge-base-dashboard.tsx:107-127` is a classic “dependency on the data you fetch” loop:

```ts
useEffect(() => {
  const pending = documents.some(...);
  if (!pending) return;
  timer = setTimeout(tick, 600);          // first tick
  async function tick() {
    await loadDocuments();                 // setDocuments(new array)
    if (!cancelled) timer = setTimeout(tick, 2_500);
  }
  return () => { cancelled = true; clearTimeout(timer); };
}, [documents, loadDocuments]);
```

Because `documents` is a new array after every fetch, the cleanup runs before the 2,500 ms timer ever fires. The effective interval is 600 ms + request time. With one request per tick, one open Knowledge Base tab can generate ~80–100 requests/minute. If the worker is not running (P11), this never stops.

Fix the effect shape first, then add a cap. The cap matters as much as the interval: a permanently `processing` job must not poll forever.

### 4.3 P03 — the type generator and the worker grants are coupled in the wrong direction

The generator's function query is:

```sql
where n.nspname = 'public'
  and p.prokind = 'f'
  and has_function_privilege('authenticated', p.oid, 'execute')
```

That is a reasonable filter for a user-facing client. It is the wrong filter for a project with a service-role worker. Today the worker RPCs still appear in the generated types only because `0007` granted them to `authenticated` and `0009` never revoked that grant. The moment someone tightens the grant (the security-correct change), `pnpm db:types` deletes `claim_ingestion_jobs`, `begin_ingestion_attempt`, etc. from `Database`, and `supabase-service-client.ts` stops compiling.

Sequence the fix:

1. Change the generator to include all `public` functions (or `authenticated` ∪ `service_role`).
2. Regenerate and commit.
3. Add a new migration that revokes `authenticated` from worker RPCs and grants `service_role` explicitly.
4. Regenerate again.

Doing step 3 first creates a build break that looks unrelated to the security change.

### 4.4 P04 — “save” is fire-and-forget with a toast

The save queue is well-intentioned: it serializes writes and coalesces bursts with an 800 ms debounce. But the failure path is lossy:

- `pendingSaveRef.current = null` happens before the request (`:250-251`).
- On a non-OK response it throws (`:273-275`); the queue's `.catch` only sets an error banner (`:280-282`).
- The unmount cleanup (`:346`) calls `flushPendingSave()` with a normal `fetch`. Browsers may cancel that request during navigation.

There is no retry, no outbox, and no durable “unsaved” marker. A user who sends a message on a train and closes the tab can lose it with no way to recover. The server-side `upsert_conversation_messages` is idempotent (`on conflict (id)`), so a client outbox is safe to retry.

### 4.5 P10/P11 — ingestion works in code, not in a fresh deployment

The worker route is correct in isolation: constant-time secret check, service-role client, bounded limit, cleanup drain. The operational path is incomplete:

- The cron schedule is a standalone file, not a migration, and the CI workflow only runs `db push`.
- `.env.example` does not mention the two variables the worker needs.
- The worker processes one job per minute with a 60 s request budget.
- A slow document burns an attempt every 10 minutes (stale-lock reclaim) and dies after three.

A 4 MB / 200-page PDF is a supported input by the code's own limits. It is not obviously compatible with a 60 s serverless request. Either lower the supported ceiling or give the worker a lease it can renew.

### 4.6 P16/P17 — the test suite is broad but shallow where it matters

The suite is genuinely good at pure functions and SQL: 205 tests, real migrations, RLS isolation, request validation. It is weak exactly where the Phase 2 bugs live:

- No `.tsx` tests, so the workspace, dashboards, and overlays are unverified.
- The fake Supabase client is a single `order()` that resolves immediately; it cannot model chained ordering or `.in()` filtering.
- The DB harness is plain Postgres plus stubs; it cannot exercise Storage policies, `pg_cron`, `vault`, or hosted default grants.

This is why P02, P04, P05, P06, P07, and P08 survived to Phase 2 despite 205 green tests.

## 5. Top 10 Phase 2 fixes by risk-reduced-per-hour

Do these **after** the Phase 1 blockers are green. Effort is engineering time, not calendar time.

1. **P02 — fix the Knowledge Base polling loop (2–4h).** Largest avoidable request amplification; one effect change.
2. **P03 — widen the type generator before tightening grants (2h).** Prevents the security fix from breaking the worker build.
3. **P11 — apply the worker schedule + document the env vars (2h).** Makes ingestion work in a fresh deployment.
4. **P13 — UUID validation (1h).** Removes a class of 500s with a one-function change.
5. **P09 — add `eslint-plugin-react-hooks` (2–4h).** Stops P02/P05-class regressions from recurring.
6. **P14 — skip corrupt rows instead of failing history (2h).** Converts a total outage into a degraded row.
7. **P12 — remove or honor the bucket-name override (1–2h).** Prevents a storage outage from a plausible config choice.
8. **P07 — move `aria-live` off the transcript (2h).** Cheap, high-value accessibility fix.
9. **P06 — dialog semantics for overlays (3–4h).** Completes the mobile keyboard path.
10. **P04 — client outbox + keepalive (1d).** The only fix that prevents silent message loss.

P01 (history pagination) is the highest-value *large* fix; it is ranked outside the top 10 only because it is a 1–2 day contract change, not an hour-scale win.

## 6. Things genuinely good (Phase 2 additions)

Phase 1's list still stands. These are the Phase 2-specific strengths:

- **Incremental, conflict-aware conversation writes.** `upsert_conversation_messages` writes only changed messages, guards with `where conversations.updated_at_ms <= excluded.updated_at_ms`, and checks `messages.owner_id = v_owner` on conflict (`0009:40-88`). Two tabs cannot clobber a newer transcript.
- **Storage isolation is enforced in the database, not just the app.** The private bucket and owner-path policies are real SQL (`0007:830-865`), not a comment.
- **The worker secret check is correct.** Length check + `timingSafeEqual` (`internal/ingestion-worker/route.ts:12-20`).
- **Request body readers stream with byte caps.** `readJsonBody` and `readMultipartFormData` count bytes while reading rather than trusting `Content-Length` alone (`request.ts`, `multipart.ts`).
- **Error exposure is centralized.** `AppError.expose` defaults to `status < 500`, so internal messages do not leak (`errors.ts:17-31`).
- **Local auth is not a toy.** scrypt hashes, hashed session tokens, 7-day TTL, `httpOnly` + `SameSite=Lax` + conditional `Secure` cookies (`local-auth.ts:18,102-120,303-307`).
- **The JSON store serializes mutations and writes atomically.** A per-store promise queue plus `rename` prevents interleaved writes (`json-store.ts:146-161`).
- **Bounded extraction.** PDF page cap, 250k-character cap, empty-text detection (`document-processing.ts:5-8,57-90`).
- **CI exists and runs the real check.** `.github/workflows/ci.yml` runs `pnpm check` on push/PR with `--frozen-lockfile`.

## 7. Phase 1 claims re-checked

| Phase 1 claim | Phase 2 result |
|---|---|
| F01/F02: typecheck, stale generated types, duplicate `owner_id` | **Confirmed** on 2026-11-25. Same 4 TS errors; `db:types:check` still fails. |
| F03: 12 failing tests | **Confirmed**, now 12 failed / 205 passed (217 tests). Same 8 files. |
| F04: uploads only enqueue; chat posts `{}` to `/api/documents/jobs` | **Confirmed.** `chat-workspace.tsx:613-620` still posts `{}`; `jobs/route.ts:84-86` returns 400. |
| F05: `service_role` grant gap | **Confirmed in the harness** (`tests/db/ingestion.test.ts:478`). Hosted behavior remains UNVERIFIED (U1). |
| F08: no security headers | **Confirmed** (`next.config.ts:3-9`). |
| F11: migrations auto-push to production | **Refined:** `migrations.yml` does push staging → production on `main`, and it is a separate workflow from `ci.yml`; a red CI does not block the push. |
| F13: `.env.example` missing worker vars | **Confirmed** (`.env.example:1-13`). |
| F16: `chat-workspace.tsx` is 822 lines | **Drift:** it is now 831 lines. The conclusion is unchanged. |
| F18: no Git repository | **Confirmed** by the environment. |
| “Real migrations in the test harness” | **Qualified:** the SQL is real, the platform is not. See P17. |

Two working notes from the investigation did not survive re-checking and are recorded here so they are not carried forward:

- **“Delete-all chats is broken: `PUT` returns 405, and the feature is local-mode only.”** Disproved on both counts. `src/app/api/conversations/route.ts:101-135` exports `PUT`, validates `{ ownerId, conversations: [] }`, and calls `repository.deleteAll`; `account-dashboard.tsx:249-274` uses that route in every mode. This is not a Phase 1 or Phase 2 finding.
- **“The chat composer's upload omits the provider key.”** Disproved. `chat-workspace.tsx:584-632` sends `providerApiKeyHeader(...)` on the upload (`:594`). The key gap is the Knowledge Base upload only (`knowledge-base-dashboard.tsx:136-144`, P15).

## 8. U1–U7 verification status

| ID | Status | What Phase 2 did / how to finish |
|---|---|---|
| U1 — hosted `service_role` table grants | **UNVERIFIED** | The PGlite harness proves the gap, but hosted Supabase may grant `service_role` via default privileges. Run on staging: `select has_table_privilege('service_role','public.document_versions','select'), has_table_privilege('service_role','public.document_versions','update');` |
| U2 — worker actually scheduled | **UNVERIFIED** | The schedule file exists but is not applied by migrations (P11). Check staging: `select jobname, schedule, active from cron.job where jobname = 'atlas-ingestion-worker';` and `cron.job_run_details`. |
| U3 — `maxDuration = 60` honored | **UNVERIFIED** | Platform-dependent. Confirm against the deployment target (Vercel plan, container, etc.) and record the real limit in the runbook. |
| U4 — compliance obligations | **UNVERIFIED** | Product/legal decision. Determines whether Phase 1 F10 is a launch blocker. |
| U5 — rate-limit atomicity | **NOT VERIFIED** | PGlite is single-connection, so it cannot model concurrent `consume_api_rate_limit` calls. Run N parallel calls against staging and assert exactly `limit` are allowed. |
| U6 — storage bucket policy | **PARTIALLY VERIFIED by inspection** | `0007:830-865` creates a private bucket with owner-path select/insert/delete policies. Remaining risk: an existing public bucket is not flipped to private (`on conflict do nothing`), and a custom bucket is not covered (P12). Check: `select id, public from storage.buckets where id = 'document-uploads';` |
| U7 — PGlite scope | **VERIFIED by code** | `providers.ts:113-117` rejects `DATABASE_PROVIDER=postgres` outside development, so it is dev-only by construction. Whether that matches product intent is still a question. |

## 9. Remediation sequencing and risk register

### Order

1. **Phase 1 blockers first.** `pnpm check` green, worker grants, headers, `.env.example`, git baseline. Do not start Phase 2 refactors on a red tree.
2. **Generator + grants (P03).** Widen the generator, regenerate, *then* revoke `authenticated` from worker RPCs in a new migration.
3. **Cheap correctness (P02, P11, P13, P14, P12).** Each is ≤4h and independently revertible.
4. **Accessibility (P06, P07).** Independent of the data work; can land in parallel.
5. **History contract (P01) + save outbox (P04).** These are the two larger changes; do them with new tests.
6. **Refactors (P05, P08, P09, P26).** Only after the behavior is covered by the new component tests (P16).

### Risks / traps

- **Migrations are append-only.** `0001`–`0009` may already be applied in staging/production. Editing `0007`/`0009` will make the PGlite harness pass (it applies from scratch) while deployed databases stay broken. All grant/index/policy fixes must be a new `0010_*.sql`.
- **Regenerating types will surface new errors.** The generator hardcodes nullable return columns only for `match_documents` (`generate-db-types.mjs:112-114`). New functions with nullable table returns will be typed non-null. Expect to extend that map or mark all table returns nullable.
- **Tightening grants before fixing the generator breaks the build** (P03). Sequence matters.
- **P01 changes an internal API contract.** The web client is the only consumer today, but confirm no external caller uses `GET /api/conversations` before changing its shape.
- **P04 changes the save protocol.** Keep `upsert_conversation_messages` idempotent; an outbox replay must be safe.
- **P10 is a platform decision.** If the deployment cannot run a >60 s request, the fix is a smaller supported ceiling or a real worker, not a code tweak.
- **P17 is a test-trust issue.** Fixing the harness to add `service_role` grants may turn the currently failing test green without proving anything about hosted Supabase. Add a staging smoke test.

## 10. Questions before Phase 2 remediation

1. **Phase 1 approval:** Do you approve the Phase 1 findings so remediation can start? Phase 2 does not change that answer.
2. **Git:** May I run `git init` and commit the current state as a baseline? Without it, “small reviewable commits” is not possible.
3. **History API (P01):** May `GET /api/conversations` return metadata only, with messages loaded per conversation? This is the clean fix but changes the response shape.
4. **Worker model (P10):** Stay on `pg_cron` → HTTP with a 60 s budget, or move ingestion to a long-running worker/queue? This decides whether the fix is a lease or a rewrite.
5. **PostgREST row cap (P01):** Is `max-rows` still the default 1,000 in staging/production? If it is raised, P01 is a performance issue; if not, it is a silent data-loss issue.
6. **Key model (P15):** Server-side `OPENAI_API_KEY` only, or encrypted per-user BYOK? The current code is a hybrid that only half-works.
7. **Custom buckets (P12):** Is `SUPABASE_DOCUMENT_BUCKET` a supported deployment option? If not, remove it and delete the ambiguity.
8. **Accessibility target (P06/P07):** Is WCAG 2.1 AA the bar, or “best effort”? This scopes the overlay/live-region work.
9. **Component tests (P16):** Add `jsdom` + React Testing Library, or Playwright smoke tests? RTL is cheaper; Playwright catches the real browser behaviors (focus trap, `pagehide`).
10. **Local auth scope:** Is `AUTH_PROVIDER=local` ever expected outside development? `providers.ts` currently blocks it; confirm that is intentional.

## Appendix — commands run in Phase 2

```
pnpm typecheck      # exit 2, 4 TS errors
pnpm lint           # exit 0
pnpm db:types:check # exit 1, stale types
pnpm test           # exit 1, 12 failed / 205 passed (217), 8/31 files
pnpm audit --prod   # exit 0, no known vulnerabilities (2026-11-25)
```

`pnpm build`, `pnpm test:db`, and `pnpm check` were not re-run in Phase 2; their Phase 1 results still apply because `typecheck` (a prerequisite) is unchanged.

## Appendix B — Remediation status (2026-11-27)

Verified with `pnpm verify:agent`: **PASS 5/5** (typecheck, lint, generated-type check,
tests, build), **259 tests passed / 0 failed across 99 files** (`.agent-logs/2026-11-27T11-01-19-409Z`).
The §2 baselines are historical; the repository is green as of this date.

| ID | Status | Evidence |
|---|---|---|
| P01 | **Fixed** | `GET /api/conversations` returns metadata only (`messages: []`); `GET /api/conversations?id=<uuid>` loads messages lazily; bulk reads use explicit ranges. |
| P02 | **Fixed** | Knowledge Base polling is driven by `hasPendingDocuments`, not the `documents` array, with 5s→30s backoff and no tight re-arm loop. |
| P03 | **Fixed** | Type generator includes functions executable by `authenticated` **or** `service_role`; migration `0010` revokes `authenticated` from worker RPCs; types regenerate cleanly. |
| P04 | **Fixed** | `save-outbox.ts` persists failed writes with idempotent replay, a 10s retry loop, and `pagehide`/`keepalive` flush; the UI keeps an unsaved state until acknowledged. |
| P05 | **Fixed** | Client diffs by reference and `conversation-diff.ts` is O(messages); no per-conversation deep stringify/flatMap. |
| P06 | **Fixed** | `SourcePanel` uses `role="dialog"` + `aria-modal`, Escape handling, focus trap, and focus return; backdrop is a labelled close control. |
| P07 | **Fixed** | Transcript is out of the live region; one visually hidden `role="status"` announces short status text. Covered by `tests/components/chat-a11y.test.tsx`. |
| P08 | **Partially fixed** | `runCompletion` is shared by submit and regenerate (request building, streaming, error mapping). The two wrappers remain separate, so some behavior still lives twice. |
| P09 | **Fixed** | `eslint-plugin-react-hooks` added; `rules-of-hooks` and `exhaustive-deps` are errors. Flagged `chat-workspace` dependencies fixed. The aggressive v7 `set-state-in-effect` rule is deliberately not enabled. |
| P10 | **Partially fixed** | Migration `0011` adds service-role-only `renew_ingestion_lease(uuid)`; the worker renews every 15s during extraction/embedding so long jobs are not reclaimed. Throughput is still one job per invocation/minute. |
| P11 | **Fixed** | Migration `0012` self-applies the every-minute pg_cron + pg_net schedule when both Vault secrets and extensions exist; the manual SQL file remains a fallback. |
| P12 | **Fixed** | Bucket name is fixed to `document-uploads` (`documentBucketName()`); the `SUPABASE_DOCUMENT_BUCKET` override and README entry were removed; `0010` forces the bucket private. |
| P13 | **Fixed** | Conversation and message ids are UUID-validated before reaching Postgres; route tests cover non-UUID input. |
| P14 | **Fixed** | Invalid rows are skipped and logged instead of failing the whole list. |
| P15 | **Fixed** | Product decision: server env keys only. Upload no longer accepts a user key; the worker and chat both use server keys. |
| P16 | **Fixed** | jsdom + React Testing Library added; `.test.tsx` included; component tests cover chat accessibility and the provider connection card. |
| P17 | **Partially fixed** | Explicit `service_role` grants moved into migration `0010`; `tests/db/harness.ts` documents the PGlite-vs-hosted fidelity gap. Storage/pg_cron/Vault/PostgREST are still not emulated. |
| P18 | **Fixed** | `extractCitedSources` returns `[]` when the model cites nothing; only the abstention path keeps the empty-source message. |
| P19 | **Fixed** | `listDocuments` uses a bounded/lateral latest-job read instead of loading every historical job. |
| P20 | **Fixed** | Unused `ownerId` parameters removed from `RagRepository`, `ingestion-service`, and `document-service` call chains. |
| P21 | **Fixed** | `DOCUMENT_STATUSES`/`JOB_STATUSES` are imported from `ingestion-types.ts`; no duplicate status sets. |
| P22 | **Fixed** | Message ordering uses `created_at_ms, id` in both repositories and SQL; `sequence` is no longer relied on for ordering. |
| P23 | **Fixed** | `EMPTY_CONVERSATION` guard prevents a crash when the active list is transiently empty. |
| P24 | **Fixed** | Hardcoded dev origin removed; `poweredByHeader: false`. |
| P25 | **Fixed** | `@types/node` bumped to `^24.19.4`. |
| P26 | **Fixed** | CI runs `pnpm audit --prod --audit-level high`; `.github/dependabot.yml` enables weekly npm/Actions updates. |

Remaining open items are tracked in `PROJECT_CONTEXT.md` §7. The largest still-open
engineering item is P10 throughput: the lease heartbeat protects long jobs but does not
process more than one job per invocation.
