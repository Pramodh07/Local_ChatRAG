# Copilot instructions — Atlas

Start with [`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md). It is the handoff document:
architecture, key paths, green baseline, and the list of genuinely open issues. The
dated reports in [`audits/`](../audits/) are historical; each now has a remediation
appendix with the current status of every finding.

## This Next.js is not the one in training data

`AGENTS.md` warns that this repo uses a Next.js version with breaking changes. Before
changing App Router, route-handler, or config code, read the relevant guide under
`node_modules/next/dist/docs/`. Do not rely on memory of older Next.js APIs.

## Verify with the bundled runner

Prefer the agent runner over hand-running checks:

- `pnpm verify:agent` — typecheck, lint, generated-type check, tests, build; compact summary.
- `pnpm verify:fast` — typecheck, lint, generated-type check only.
- `pnpm verify:json` — machine-readable result.
- Targeted tests: `pnpm verify:agent --only test --test <file>`.

Full logs land in `.agent-logs/<timestamp>/`. Read `summary.json` or one step log only
when the compact output is insufficient. A change is not done until `pnpm verify:agent`
passes.

## Project conventions

- **Provider keys are server env only.** Never put a key in `NEXT_PUBLIC_*`, browser
  storage, or a request header. `OPENAI_API_KEY` is also required for embeddings.
- **Migrations are append-only.** `0001`–`0012` may already be applied. Add a new
  `supabase/migrations/00NN_*.sql`; do not edit old migrations. Then run `pnpm db:types`
  and commit the regenerated `database.generated.ts`.
- **Worker RPCs are `service_role`-only.** The type generator intentionally includes
  functions executable by `authenticated` **or** `service_role`; do not narrow it back.
- **Documents always use the private `document-uploads` bucket.** The name is fixed
  because the storage policies hardcode it.
- **Message ordering is `created_at_ms, id`.** Do not reintroduce ordering by `sequence`.
- **PGlite is development-only.** Tests apply the real SQL to PGlite with auth stubs;
  hosted Supabase grants, Storage, pg_cron, and Vault are not emulated.
- **Local mode has no RAG.** Document upload, citations, and ingestion require Supabase.
- **Keep docs in sync.** Update `PROJECT_CONTEXT.md` and `README.md` when behavior,
  commands, migrations, or the test count change. Do not rewrite the audit bodies;
  append or update their remediation appendix.
- **Accessibility:** keep the transcript out of `aria-live`; use the short `role="status"`
  announcement. Dialogs need `role="dialog"`, `aria-modal`, Escape, and focus return.

## Where to look

- Runtime/config decisions: `src/modules/shared/config/providers.ts`
- Chat orchestration: `src/modules/chat/chat-service.ts`, `src/app/api/chat/stream/route.ts`
- Client chat state: `src/modules/chat/chat-workspace.tsx`, `save-outbox.ts`, `stream-parser.ts`
- Ingestion: `src/modules/rag/ingestion-service.ts`, `rag-repository.ts`,
  `src/app/api/internal/ingestion-worker/route.ts`
- RAG answers/citations: `src/modules/rag/answer-question.ts`
- DB types: `scripts/generate-db-types.mjs`
- Test fidelity: `tests/db/harness.ts`
