<div align="center">

# Atlas

**Turn documents into a searchable knowledge base and get answers that cite their sources.**

Atlas is an AI chat workspace built with Next.js, React, and Supabase. It combines
owner-scoped retrieval-augmented generation (RAG), durable document ingestion, and a
multi-provider chat experience in one application.

<p>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white">
  <img alt="TypeScript 5" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="Tailwind CSS 4" src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white">
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3FCF8E?logo=supabase&logoColor=white">
</p>

</div>

> [!IMPORTANT]
> **Project status: pre-release.** Atlas is under active development and is not yet
> approved for production. The automated check suite (`pnpm check`) is green, and the
> historical audit reports in [`audits/`](./audits/) now carry a per-finding remediation
> appendix; remaining product and operational gaps are listed in
> [Known limitations](#known-limitations) and [Project status](#project-status).

## Table of contents

- [Overview](#overview)
- [Capabilities](#capabilities)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Supabase setup](#supabase-setup)
- [Development commands](#development-commands)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Security and privacy](#security-and-privacy)
- [Operational limits](#operational-limits)
- [Known limitations](#known-limitations)
- [Project status](#project-status)
- [Further reading](#further-reading)

## Overview

Atlas has two purposes:

1. **Grounded answers (Supabase mode).** Upload documents, and Atlas extracts, chunks,
   and embeds them. Questions are matched against the signed-in user's own passages,
   and answers include citations to the retrieved sources.
2. **Development without infrastructure (local mode).** Run the UI, account flows, and
   model providers without Supabase credentials. Local chat is model-only: it does not
   index documents or produce citations.

All user data is owner-scoped. In Supabase mode this is enforced by row-level security
(RLS) in PostgreSQL, private Storage policies, and owner checks inside the retrieval
and ingestion functions.

## Capabilities

**Knowledge base**

- Upload PDF, TXT, and Markdown documents (4 MB, 200 PDF pages, 250,000 extracted
  characters per file).
- Durable ingestion: original bytes go to private Supabase Storage, work is queued in
  `ingestion_jobs`, and a scheduled worker processes jobs with retries and backoff.
- Semantic retrieval over owner-scoped chunks with configurable result count and
  similarity threshold.
- Browse ingestion status, read errors, and delete documents from the Knowledge Base.

**Chat**

- Answers grounded in retrieved passages, with a citation list and source panel.
- Conversations persisted incrementally: only changed messages are written, so two
  tabs can add messages without replacing each other's transcripts.
- Search, filter by date, archive, and delete conversations.
- Token-by-token streamed answers (NDJSON stream), stop generation, copy, and regenerate.

**Accounts and providers**

- Supabase Auth, or local development accounts with salted `scrypt` password hashes.
- OpenAI, Anthropic, Google Gemini, and Ollama for model-only chat.
- Provider keys from server environment variables only (never stored in the browser).
- Profile, avatar, password, model preferences, theme, and usage estimates.
- Light and ultra-dark themes.

## Architecture

### Runtime modes

`AUTH_PROVIDER` and `DATABASE_PROVIDER` select the runtime. The legacy `AUTH_MODE`
variable remains supported as a shorthand that sets both.

| `AUTH_PROVIDER` | `DATABASE_PROVIDER` | Purpose | Persistence |
| --- | --- | --- | --- |
| `local` | `local` | UI, account, and provider development | JSON stores under `.local-data/` |
| `local` | `postgres` | Development against a real SQL engine | PGlite under `.local-data/pglite/` |
| `supabase` | `supabase` | Document ingestion, RAG, and hosted chat history | Supabase Postgres, Storage, and Auth |

Unsupported pairings fail closed instead of mixing identities. Local authentication and
the embedded PostgreSQL runtime are disabled outside development. If no provider is
configured, development defaults to local JSON when Supabase is not set; production
requires Supabase.

### RAG pipeline

1. The user uploads a document from the Knowledge Base.
2. The server validates the request, checks the upload rate limit, and stores the
   original bytes in the private `document-uploads` bucket.
3. A document, immutable version, and queued ingestion job are created in one
   transaction.
4. The scheduled worker claims a job, downloads the source, extracts text, chunks it,
   and creates embeddings with `text-embedding-3-small`.
5. Chunks are stored with the document version in `document_chunks` (pgvector).
6. A question is embedded and matched against the user's ready chunks through the
   owner-scoped `match_documents` function.
7. The retrieved passages are sent to the selected answer model (OpenAI, Anthropic,
   Gemini, or Ollama), streamed back token by token, and returned with citations.
   Embeddings always use OpenAI's `text-embedding-3-small` on the server.

### Conversation persistence

The client batches changed messages and sends only those messages to the
`upsert_conversation_messages` RPC. Each message is upserted by ID, so writes are
idempotent and do not replace another tab's transcript. Display order uses
`created_at_ms` then `id`; the `sequence` column is advisory only. Conversations and
messages are protected by owner-scoped RLS.

### Ingestion worker

`POST /api/internal/ingestion-worker` is a server-only endpoint:

- Requires `Authorization: Bearer <ATLAS_INGESTION_WORKER_SECRET>`; the secret must be
  at least 32 characters and is compared in constant time.
- Uses the Supabase service-role client to claim and process jobs across owners.
- Processes one job per invocation, with a 60-second function budget, and drains the
  storage-cleanup queue.
- Renews the job's lease every 15 seconds during extraction and embedding, so a
  long-running document is not reclaimed by stale-lock recovery mid-processing.
- Requires `OPENAI_API_KEY` on the server for embeddings.

See [Run the ingestion worker](#6-run-the-ingestion-worker) for scheduling.

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Route Handlers, `proxy.ts`) |
| UI | React 19, Tailwind CSS 4, custom components |
| Language | TypeScript 5 (strict) |
| Data | Supabase Postgres, RLS, Storage, Auth; pgvector |
| Local SQL | PGlite with pgvector |
| AI | OpenAI SDK; Anthropic, Google Gemini, and Ollama adapters |
| Markdown | `react-markdown` with `remark-gfm` |
| Tooling | pnpm 11, ESLint, Vitest, GitHub Actions |

## Getting started

### Requirements

- Node.js 24 or newer
- pnpm 11 or newer
- Supabase and OpenAI credentials only if you want document ingestion and RAG

### Install and run

Run these commands from the `web/` project directory.

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

On macOS or Linux, copy the environment file with:

```sh
cp .env.example .env.local
```

Open [http://localhost:3000](http://localhost:3000). The example environment selects
local authentication. Create a local account, then configure a provider and model under
**Account → Models**.

Local chat requires a configured model provider; see
[Provider credentials](#provider-credentials). For document upload and RAG, complete
[Supabase setup](#supabase-setup).

## Configuration

Atlas reads configuration from `.env.local` during development and from the deployment
environment in production.

| Variable | Values / default | Purpose |
| --- | --- | --- |
| `AUTH_PROVIDER` | `local`, `supabase` | Selects local sign-in or Supabase Auth |
| `DATABASE_PROVIDER` | `local`, `postgres`, `supabase` | Selects JSON stores, embedded PGlite, or Supabase Postgres |
| `AUTH_MODE` | `local`, `supabase` | Deprecated shorthand; explicit providers take precedence |
| `PGLITE_DATA_DIR` | `.local-data/pglite` | PGlite data directory |
| `OPENAI_API_KEY` | empty | OpenAI chat, embeddings, and ingestion worker |
| `ANTHROPIC_API_KEY` | empty | Anthropic chat |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | empty | Google Gemini chat; either variable is accepted |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint |
| `NEXT_PUBLIC_SUPABASE_URL` | empty | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | empty | Browser-safe Supabase key |
| `SUPABASE_SERVICE_ROLE_KEY` | empty | Server-only key for the ingestion worker; never expose to the browser |
| `ATLAS_INGESTION_WORKER_SECRET` | empty | Bearer secret for the worker endpoint; at least 32 characters |

> [!WARNING]
> Never prefix `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, or other secrets with
> `NEXT_PUBLIC_`. Next.js embeds public variables into browser bundles at build time.

### Provider credentials

Provider keys are read from server environment variables only. Use **Settings → Provider
connection** to verify that a provider is reachable; the UI never stores or transmits a
key. The selected answer model is chosen under **Models** (stored locally in the browser;
no credentials are involved).

| Provider | Environment variable | Notes |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | Used for Supabase embeddings and RAG answers, and for OpenAI chat |
| Anthropic | `ANTHROPIC_API_KEY` | Uses the selected supported Claude model |
| Google Gemini | `GOOGLE_API_KEY` or `GEMINI_API_KEY` | Either variable is accepted |
| Ollama | None required | Run Ollama, pull a model (for example, `ollama pull gemma4`), and keep the service running |

Ollama defaults to `http://localhost:11434`; set `OLLAMA_BASE_URL` to override it.

In deployments, serve Atlas over HTTPS. Keep the server environment free of browser
exposure: never prefix a key variable with `NEXT_PUBLIC_`, since Next.js embeds public
variables in the browser bundle.

### Embedded PostgreSQL runtime

`DATABASE_PROVIDER=postgres` runs PGlite inside the Next.js server process. It applies
the shared migrations plus `db/local-migrations/`, stores validated auth and account
documents in `local.json_stores`, and stores conversations and messages in normalized
tables.

Import existing JSON records before switching:

```bash
pnpm local:import:dry   # validate .local-data and print counts
pnpm local:import       # copy into .local-data/pglite
```

The importer never modifies `.local-data/*.json`. It refuses to overwrite an existing
target unless you pass `--force`. After a successful import, set:

```dotenv
AUTH_PROVIDER=local
DATABASE_PROVIDER=postgres
```

Then restart `pnpm dev`. PGlite is single-process: do not point two development servers
at the same `PGLITE_DATA_DIR`. Document upload and RAG still require Supabase.

## Supabase setup

### 1. Create a project

Create a Supabase project and collect the project URL, publishable key, and service-role
key. The publishable key is intended for the browser; the service-role key is
server-only and is used by the ingestion worker.

### 2. Apply migrations

Apply the migrations in order. They are idempotent where practical, but order matters.

| Migration | Purpose |
| --- | --- |
| [`0001_init_rag.sql`](./supabase/migrations/0001_init_rag.sql) | Core RAG schema: `documents`, `document_chunks`, vector index, RLS |
| [`0002_secure_user_access.sql`](./supabase/migrations/0002_secure_user_access.sql) | Owner-scoped access and ownership guard for existing documents |
| [`0003_add_avatar_url.sql`](./supabase/migrations/0003_add_avatar_url.sql) | Adds `avatar_url` to profiles |
| [`0004_api_rate_limits.sql`](./supabase/migrations/0004_api_rate_limits.sql) | Database-backed API rate limits |
| [`0005_phase0_profile_updates_and_owner_index.sql`](./supabase/migrations/0005_phase0_profile_updates_and_owner_index.sql) | Scoped profile updates and document owner index |
| [`0006_conversations_and_messages.sql`](./supabase/migrations/0006_conversations_and_messages.sql) | Conversations and messages with owner-scoped RLS |
| [`0007_durable_ingestion.sql`](./supabase/migrations/0007_durable_ingestion.sql) | Document versions, ingestion jobs, cleanup queue, Storage bucket and policies, retrieval RPCs |
| [`0008_retrieval_performance.sql`](./supabase/migrations/0008_retrieval_performance.sql) | Retrieval indexes and updated `match_documents` |
| [`0009_incremental_chat_and_worker.sql`](./supabase/migrations/0009_incremental_chat_and_worker.sql) | Incremental conversation upserts and service-role worker grants |
| [`0010_worker_grants_and_bucket_privacy.sql`](./supabase/migrations/0010_worker_grants_and_bucket_privacy.sql) | Explicit service-role table grants, service-role-only worker RPCs, private upload bucket |
| [`0011_ingestion_lease_heartbeat.sql`](./supabase/migrations/0011_ingestion_lease_heartbeat.sql) | Service-role lease renewal RPC for long-running jobs |
| [`0012_ingestion_worker_schedule.sql`](./supabase/migrations/0012_ingestion_worker_schedule.sql) | Self-applies the pg_cron schedule when Vault secrets are configured |

Choose one of these methods:

- **SQL Editor:** run each file in order.
- **Supabase CLI:** link the project once, then push the migrations.

  ```bash
  pnpm exec supabase link --project-ref <project-ref>
  pnpm db:push
  ```

- **GitHub Actions:** `.github/workflows/migrations.yml` applies migrations to the
  `staging` environment and then `production` on pushes to `main`, using
  `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and `SUPABASE_PROJECT_REF`.

> [!NOTE]
> If `0001` is already applied and `public.documents` contains rows, assign each
> document to its verified owner before running `0002`. The security migration stops if
> any document is unowned. Do not assign records to an account unless that ownership is
> correct.

### 3. Configure authentication

In Supabase Auth settings:

- Set the site URL to your application origin.
- Add your application origin and `/auth/callback` to the allowed redirect URLs. For
  local development, include `http://localhost:3000/auth/callback`.
- Configure email confirmation to match your deployment policy.

### 4. Configure Storage

Migration `0007` creates a private bucket named `document-uploads` and policies that
compare the first path segment of each object key with `auth.uid()`. Objects are stored
as `{ownerId}/{documentId}/{versionId}`.

The bucket name is fixed: the storage policies hardcode `document-uploads`, so a custom
bucket name is not supported. Migration `0010` keeps the bucket private even if it was
created outside `0007`.

### 5. Configure environment variables

```dotenv
AUTH_PROVIDER=supabase
DATABASE_PROVIDER=supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ATLAS_INGESTION_WORKER_SECRET=a-random-secret-of-at-least-32-characters
OPENAI_API_KEY=your-openai-key
```

Restart the development server, create an account, and confirm the email if confirmation
is enabled. Then upload a document from the Knowledge Base.

### 6. Run the ingestion worker

Uploads are only queued by the web application; the worker performs extraction,
embedding, and cleanup. Without a running worker, documents remain queued.

1. Deploy the application so `POST /api/internal/ingestion-worker` is reachable over
   HTTPS.
2. Store two secrets in Supabase Vault:
   - `atlas_ingestion_worker_url` — the full worker URL, for example
     `https://your-app.example.com/api/internal/ingestion-worker`
   - `atlas_ingestion_worker_secret` — the same value as
     `ATLAS_INGESTION_WORKER_SECRET`
3. Migration `0012` schedules one invocation per minute automatically once both Vault
   secrets exist (and `pg_cron`/`pg_net` are available). If your project cannot enable
   those extensions during migrations, run
   [`supabase/schedules/ingestion-worker.sql`](./supabase/schedules/ingestion-worker.sql)
   in the SQL Editor instead.

### 7. Verify the setup

Upload a PDF, TXT, or Markdown file from the Knowledge Base and confirm that its status
moves from queued to ready. Then ask a question about it and open the citations.

## Development commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the development server with Next.js Turbopack |
| `pnpm build` | Create an optimized production build |
| `pnpm start` | Run the production server after building |
| `pnpm typecheck` | Run the TypeScript type check |
| `pnpm lint` | Run ESLint |
| `pnpm test` | Run all automated tests |
| `pnpm test:db` | Run only the database migration and RLS tests |
| `pnpm db:types` | Regenerate TypeScript database types from the migrations |
| `pnpm db:types:check` | Fail if the generated types are stale |
| `pnpm db:push` | Push migrations to the linked Supabase project |
| `pnpm local:import:dry` | Validate `.local-data` for the embedded PostgreSQL runtime |
| `pnpm local:import` | Copy `.local-data` records into `.local-data/pglite` |
| `pnpm check` | Run typecheck, lint, generated-type check, tests, and production build |
| `pnpm verify:agent` | Run the same workflow with a compact, token-efficient summary |
| `pnpm verify:fast` | Run typecheck, lint, and generated-type check only |
| `pnpm verify:json` | Print the verification result as compact JSON |

Run the same check sequence from a shell without an AI assistant:

```powershell
.\scripts\verify.ps1
```

```sh
sh ./scripts/verify.sh
```

GitHub Actions runs `pnpm check` on every push and pull request
([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)).

## Testing

- `pnpm test` runs Vitest across service logic, request schemas, route contracts, and
  database behavior.
- `pnpm test:db` runs the in-process PostgreSQL suite, which applies the shared
  migrations and verifies RLS and two-user isolation.
- The database harness uses PGlite, not hosted Supabase. Verify RLS and migration
  behavior against a staging project before production.
- Component tests use jsdom and React Testing Library; there are no full end-to-end browser tests.

## Project structure

```text
src/
├── app/                      # App Router pages and API route handlers
│   ├── api/                  # auth, chat, conversations, documents, account, worker
│   ├── account/              # Account, preferences, and profile pages
│   ├── knowledge/            # Knowledge Base page
│   ├── models/               # Model configuration page
│   ├── settings/             # Chat and retrieval settings
│   └── usage/                # Usage and cost estimates
├── modules/                  # Domain-oriented application modules
│   ├── account/              # Preferences, models, providers, usage
│   ├── auth/                 # Supabase and local authentication
│   ├── chat/                 # Chat services, schemas, UI, conversation storage
│   ├── rag/                  # Upload, ingestion, retrieval, embeddings, Storage
│   └── shared/               # Errors, API responses, guards, integrations
└── proxy.ts                  # Supabase session refresh

supabase/
├── migrations/               # Ordered shared database migrations (0001–0012)
└── schedules/                # pg_cron/pg_net ingestion worker schedule

db/
└── local-migrations/         # Local-only embedded PostgreSQL migrations

scripts/
├── generate-db-types.mjs     # Database type generation
├── import-local-data.mjs     # JSON-to-PGlite importer
├── verify.ps1                # Full check sequence (PowerShell)
└── verify.sh                 # Full check sequence (POSIX shell)

tests/
├── db/                       # Migration, RLS, and ingestion tests
├── routes/                   # API route contract tests
├── helpers/                  # Test harnesses
├── fixtures/                 # Test data
├── stubs/                    # Test-only module stubs
└── *.test.ts                 # Unit and service tests

audits/                       # Dated production-readiness audit reports
```

Route handlers authenticate, validate input, call one module service, and map typed
errors. Business rules, request schemas, and data-access seams live under
`src/modules/`.

## Security and privacy

- **Owner isolation.** RLS scopes profiles, documents, versions, chunks, ingestion jobs,
  conversations, and messages to the authenticated user. Retrieval and ingestion
  functions verify ownership as well.
- **Storage isolation.** Uploads live in a private bucket, addressed by
  `{ownerId}/{documentId}/{versionId}`; Storage policies compare the first path segment
  with `auth.uid()`.
- **Server-only secrets.** The service-role key is read only on the server. The worker
  endpoint requires a Bearer secret of at least 32 characters, compared in constant
  time.
- **Database rate limits.** Chat allows 20 requests per account per minute; document
  uploads allow 5 per account per hour. These are fixed windows enforced in PostgreSQL.
- **Local credentials.** Local account passwords are stored as salted `scrypt` hashes,
  not plaintext.
- **Local data.** Local accounts, conversations, preferences, and usage records are
  written under `.local-data/`, which is ignored by Git. Conversation contents are
  plaintext on disk; use local mode only for development and protect the folder.
- **Third-party processing.** In Supabase mode, uploaded document text is sent to
  OpenAI for embeddings and answer generation.
- **Deletion.** Deleting a document removes its indexed data and queues deletion of the
  stored original from Storage.

Before a public deployment, add deployment-level abuse protection, monitoring, data
retention, backups, and account deletion/export. See
[Known limitations](#known-limitations).

## Operational limits

| Limit | Value |
| --- | --- |
| Upload size | 4 MB per file |
| PDF pages | 200 per file |
| Extracted text | 250,000 characters per file |
| Chat rate limit | 20 requests per account per minute |
| Upload rate limit | 5 uploads per account per hour |
| Worker invocation | One job per run, 60-second function budget, 15-second lease renewal |
| Worker schedule | Once per minute (self-applied by migration `0012`; manual fallback in `supabase/schedules/`) |

## Known limitations

- Local authentication, JSON persistence, and the embedded PostgreSQL runtime are for
  development only.
- Local mode does not provide document indexing, retrieval, or citations.
- Supabase RAG embeddings are fixed to `text-embedding-3-small` for vector compatibility.
  The answer model can be any configured provider, but each provider requires its server
  key to be set.
- Scanned PDFs require OCR before upload.
- Changing chunk size applies only to new uploads; existing documents are not re-chunked
  automatically.
- PGlite is single-process and stores auth/account records as validated JSONB documents
  rather than normalized tables.
- RLS is verified locally with PGlite. Hosted Supabase verification is still required
  before production.
- Account deletion and data export are not implemented.
- `/api/health` and structured stdout logging exist, but there is no metrics, tracing, or
  external monitoring integration.
- Migrations are applied by CLI or CI; there is no in-app migration runner.
- Local JSON storage is not suitable for production or multi-instance deployments.

## Project status

Atlas is pre-release. The automated checks are green as of 2026-11-27; the remaining
work is product and operational hardening rather than a broken build.

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm db:types:check` | Pass — types regenerated from migrations 0001–0012 |
| `pnpm test` | Pass — 259 tests |
| `pnpm build` | Pass |
| `pnpm audit --prod` | Pass — no known vulnerabilities at 2026-11-25 |

The dated reports in [`audits/`](./audits/) contain the original findings and severity,
plus a 2026-11-27 remediation appendix with the current status of every finding. Most
Phase 1 and Phase 2 findings are fixed; account deletion/export is deferred, Git
initialization is blocked, and a few items are intentionally partial (worker throughput,
`chat-workspace` split, hosted-Supabase test fidelity). Treat the original findings as
historical context, not a current defect list.

## Further reading

- [`audits/phase-1-audit-2026-11-24.md`](./audits/phase-1-audit-2026-11-24.md) —
  production blockers: checks, security, ingestion, and operations.
- [`audits/phase-2-audit-2026-11-24.md`](./audits/phase-2-audit-2026-11-24.md) —
  performance, test architecture, accessibility, data integrity, and tooling.
- [`audits/production-readiness-2027-2026-11-27.md`](./audits/production-readiness-2027-2026-11-27.md) —
  production-readiness score, competitor comparison, 2027 standards mapping, and the
  P0/P1/P2 gap register.
