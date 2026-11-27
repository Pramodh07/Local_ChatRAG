# Production-Readiness Evaluation — Atlas vs. Competitors and 2027 Standards

- **Date:** 2026-11-27
- **Scope:** Atlas repository snapshot with `pnpm verify:agent` green (259 tests / 99 files),
  evaluated against (a) enterprise RAG/AI-assistant competitors and (b) the regulatory,
  procurement, and engineering bars that will be expected in 2027.
- **Method:** Repository inspection (routes, migrations, auth, retrieval, worker, CI, docs)
  plus current public sources for competitor capabilities and standards. No code changes
  were made for this report.
- **Companion documents:** [`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md),
  [`phase-1-audit`](./phase-1-audit-2026-11-24.md), [`phase-2-audit`](./phase-2-audit-2026-11-24.md).

## 1. Verdict

**Atlas is a strong prototype with unusually good engineering hygiene. It is not yet an
enterprise-production product, and it is not competitive with Glean/Copilot/ChatGPT
Enterprise on enterprise table stakes.**

Three different bars matter, and Atlas sits at different points on each:

| Bar | Score | Meaning |
|---|---:|---|
| **Deployable today** (single trusted team, self-managed Supabase, technical operator) | **~65/100** | Can run a real pilot. Green build, owner isolation, streaming, durable ingestion, citations. |
| **Enterprise-procurable SaaS** (what a 2027 buyer expects) | **~53/100** | Missing orgs, SSO/SCIM, audit logs, DLP/retention, certifications, evals, observability, data residency. |
| **Competitive product** vs. Glean / M365 Copilot / ChatGPT Enterprise / NotebookLM | **~40/100** | Missing connectors, permission-aware sync, collaboration/admin, quality evidence, and ecosystem. |

**Recommendation:** position Atlas as a **design-partner / private-pilot** product now.
Do **not** market it as production-ready or enterprise-ready until the P0 gap register in
§8 is closed. A focused team can reach credible enterprise-pilot grade in **6–9 months**;
head-to-head competition with Glean/Copilot for large organisations is a **12–18 month**
programme, not a release.

## 2. Scorecard

Weights reflect what blocks a 2027 enterprise purchase, not what is easy to build.

| Dimension | Weight | Score /5 | Weighted | Rationale |
|---|---:|---:|---:|---|
| Security & AI security | 20% | 3.5 | 14.0 | Real RLS, private Storage, timing-safe worker auth, server-only keys, CSP, rate limits, no raw HTML. Missing SSO/MFA enforcement, audit logs, pen test, SAST/DAST, SBOM, DLP, and formal prompt-injection/guardrail testing. |
| Privacy & compliance | 15% | 2.0 | 6.0 | Owner-scoped data and document deletion exist. No account deletion/export, retention policy, DPA/subprocessor list, DPIA, data residency, PII redaction, or AI disclosure. |
| Reliability & observability | 15% | 2.5 | 7.5 | Health endpoint, structured logs, retries, lease heartbeat, CI. No metrics, tracing, request IDs in responses, SLOs, alerting, backups/DR runbook, or load tests. |
| AI quality & evaluation | 15% | 2.5 | 7.5 | Citations, abstention, streaming, multi-provider answers. No golden set, RAGAS-style eval gate, red teaming, moderation, reranker, hybrid search, or feedback loop. |
| Enterprise readiness | 15% | 1.5 | 4.5 | Multi-provider and owner isolation. No orgs/teams, RBAC, sharing, SSO/SCIM, admin console, audit/SIEM, connectors, SLA, or support model. |
| Scalability & performance | 10% | 3.0 | 6.0 | Pagination, bounded queries, streaming, DB rate limits. Worker is 1 job/min with a 60 s budget; no autoscaling, caching, hybrid index, or capacity evidence. |
| Accessibility & UX | 5% | 3.0 | 3.0 | Dialog semantics, focus return, Escape, scoped live region. No WCAG 2.2 AA audit/VPAT, reduced-motion/contrast verification, i18n, or full keyboard matrix. |
| Engineering & supply chain | 5% | 4.0 | 4.0 | 259 tests, typecheck, lint, generated DB types, CI audit, Dependabot, migrations, docs. No E2E, coverage gate, SAST/DAST, SBOM/SLSA, or Git repository (blocked). |
| **Total** | **100%** | — | **52.5/100** | **Pilot-grade, not enterprise-grade.** |

A separate view for the **self-hosted single-team** case would score roughly **65/100**:
the security and engineering foundations are good; the missing pieces are mostly
enterprise identity, governance, and evidence.

## 3. What “production ready in 2027” means

Three bars are often conflated. Atlas must be judged against all three.

### 3.1 Deployable (engineering)
- Reproducible build, pinned dependencies, migrations, health checks, rollback, backups.
- No single point of failure in ingestion; bounded queues; observable failures.
- Clear runbook and on-call ownership.

### 3.2 Procurable (enterprise buyer)
- SSO (OIDC/SAML), SCIM, MFA enforcement, RBAC, audit logs/SIEM export.
- DPA, subprocessor list, retention/legal hold, data export/deletion, data residency.
- SOC 2 Type II (North America) and ISO/IEC 27001 (international); pen test summary.
- Support/SLA, status page, incident communication, security questionnaire answers.

### 3.3 Regulated (EU and sectoral)
- GDPR: lawful basis, DPIA, international transfers, data-subject rights, breach process.
- EU AI Act: Article 50 transparency from **2 Aug 2026**; high-risk rules from
  **2 Dec 2027** for Annex III systems (likely N/A for general productivity RAG, but the
  use case must be classified).
- CRA: main obligations from **11 Dec 2027**; assess scope (web-only SaaS is generally
  outside the “product with digital elements” definition, but self-hosted/on-prem
  distribution and remote data processing can change that).
- NIS2: assess whether Atlas is a medium/large “cloud computing service” provider.
- EAA/WCAG 2.2 AA: applies to in-scope consumer services; increasingly requested in B2B
  procurement even when not legally mandatory.
- PQC: plan now; NIST IR 8547 targets deprecation of RSA/ECC by 2030 and disallowance by
  2035; CNSA 2.0 is tighter for national-security customers.

## 4. Competitor comparison

Indicative, negotiated pricing; verify before quoting. “Permission-aware” means retrieval
respects source-system ACLs, not just tenant isolation.

| Capability | **Atlas** | ChatGPT Enterprise | Claude Enterprise | M365 Copilot | NotebookLM / Gemini Enterprise | Glean | Onyx (OSS/self-host) |
|---|---|---|---|---|---|---|---|
| Primary grounding | Uploaded PDF/TXT/MD + pgvector | Connectors + company knowledge | MCP connectors | Microsoft Graph | Drive/Workspace + uploaded sources | 100+ connectors, indexed graph | 45+ connectors, hybrid index |
| Permission-aware retrieval | Owner-only (no org ACLs) | Yes (source permissions) | Yes (user permissions) | Yes (Graph) | Yes (Google permissions) | Yes | Yes |
| Orgs / teams / RBAC | **No** | Yes | Yes | Yes | Yes | Yes | Yes |
| SSO / SCIM | **No** | Yes | Yes | Yes (Entra ID) | Yes (Google) | Yes | Yes (OIDC/SAML, SCIM) |
| Audit logs / SIEM | **No** | Yes (Compliance API) | Yes | Yes (Purview) | Yes | Yes | Yes |
| DLP / retention / legal hold | **No** | Yes (custom retention) | Yes | Yes (Purview) | Yes | Yes | Partial |
| Data residency | Provider-dependent | EU option | EU option | EU Data Boundary | Region/CMEK | EU hosting | Self-host / your region |
| Model choice | Multi-provider (OpenAI/Anthropic/Gemini/Ollama) | OpenAI only | Anthropic only | Microsoft/OpenAI | Gemini | Model-agnostic | Model-agnostic |
| Self-host / on-prem | Possible, **not packaged** | No | No | No | No | No | Yes |
| Public eval transparency | **None** | Vendor system cards | Vendor model cards | Case studies | Vendor | 280-query blind study | Public scripts |
| Certifications (verify scope) | **None** | SOC 2 Type 2, CSA STAR | SOC 2, ISO 27001, ISO 42001 | Broad Microsoft compliance | Google Cloud compliance | SOC 2, ISO 27001, ISO 42001, HIPAA | SOC 2, ISO 27001 |
| Indicative price | Infra + tokens | ~$60/user/mo, 150-seat min | Enterprise quote | $30/user/mo + M365 | ~$9–14/user/mo | ~$50/user/mo + add-on, ~100-seat min | Free OSS + paid |
| Best fit | Teams wanting an ownable, model-neutral RAG workspace | OpenAI-centric enterprises | Anthropic-centric enterprises | Microsoft-centric enterprises | Google-centric teams with a bounded corpus | Large orgs with many connectors | Security-sensitive self-hosters |

### 4.1 Where Atlas genuinely wins
- **Ownable stack.** Next.js + Supabase + pgvector is understandable, portable, and can be
  self-hosted. Competitors are closed SaaS or require their ecosystem.
- **Model neutrality for answers.** OpenAI, Anthropic, Gemini, and Ollama are selectable;
  embeddings stay OpenAI-only for vector compatibility, which is a documented trade-off.
- **No per-seat AI tax.** Cost is infrastructure + tokens, not a seat minimum.
- **Transparent citations and abstention.** The RAG prompt and citation post-processing are
  visible and testable, unlike closed vendor pipelines.
- **Good security fundamentals for its size.** RLS, private Storage, timing-safe worker
  auth, server-only keys, CSP, rate limits, no browser-stored credentials.
- **Engineering hygiene.** 259 tests, generated DB types, CI audit, Dependabot, migrations,
  and a real handoff document.

### 4.2 Where Atlas loses today
- **Connectors and permission-aware sync.** Atlas only ingests files a user uploads. Glean
  and Copilot answer across Drive/SharePoint/Confluence/Slack/Jira/GitHub with source ACLs.
- **Org model.** There is no organisation, team, role, sharing, or admin surface; every
  record is `owner_id`-scoped. This blocks multi-user enterprise sales.
- **Identity.** No SSO/SAML/OIDC, SCIM provisioning, or enforced MFA.
- **Governance.** No audit log, retention/legal hold, DLP, eDiscovery, or SIEM export.
- **Evidence.** No SOC 2/ISO 27001/ISO 42001, no public eval, no pen-test summary.
- **Quality.** No golden set, RAGAS-style metrics, red teaming, moderation, reranker, or
  hybrid search. Retrieval is cosine-only over a single embedding model.
- **Operations.** Worker throughput is one job per minute; no autoscaling, metrics,
  tracing, SLOs, backups/DR runbook, or load tests.
- **Compliance.** No account deletion/export, retention policy, DPA, subprocessor list,
  DPIA, data residency, or AI disclosure.

## 5. Competitive strategy implication

Atlas should **not** try to out-connector Glean or out-suite Microsoft. That is a losing
race with a 12–18 month head start and a partner ecosystem.

The defensible wedge is: **“the ownable, model-neutral RAG workspace for teams that will
not send their corpus to a closed vendor.”** That means prioritising:

1. **Deployment ownership** — first-class Docker/Helm/Terraform for Supabase + app,
   including VPC/on-prem and air-gapped options.
2. **Verifiable grounding** — span-level citations, retrieval debug view, eval dashboard,
   and a “why this answer” audit trail. This is a real differentiator against black-box
   vendors.
3. **Model and cost neutrality** — server-side keys, per-tenant budgets, provider fallback,
   and no seat-based AI tax.
4. **Regulated-team readiness** — SSO/SCIM, audit/SIEM, retention, DLP hooks, data
   residency, and a credible security package.
5. **Vertical depth** — legal, healthcare, finance, or public sector templates with the
   compliance artifacts those buyers need.

Without items 1–4, the wedge is not sellable. With them, Atlas can win accounts that
Glean/Copilot cannot serve on ownership or cost grounds.

## 6. 2027 standards mapping

Legend: **Mandatory** = legal obligation if in scope; **Procurement** = de facto enterprise
gate; **Best practice** = engineering/quality bar.

| Standard / regulation | Type | 2027 bar | Atlas status | Gap / action |
|---|---|---|---|---|
| **EU AI Act Art. 50** (from 2 Aug 2026) | Mandatory (EU) | Disclose AI interaction (Art. 50(1)); machine-readable marking of generated content where required (Art. 50(2)) | **Not met** — no explicit AI disclosure or provenance | Add a persistent “You are interacting with AI” notice, output provenance/metadata, and an AI-literacy note (Art. 4) in the UI/docs. |
| **EU AI Act high-risk** (Annex III, 2 Dec 2027) | Mandatory (EU) | Risk management, data governance, logging, human oversight, conformity assessment | **Not classified** | Classify intended use; document why general productivity RAG is not high-risk; keep a use-case register. |
| **GDPR** | Mandatory (EU) | Lawful basis, DPIA, DPA, transfers, retention, data-subject rights, breach process | **Partial** — owner isolation and document deletion; no account deletion/export, DPA, DPIA, retention | Add deletion/export, privacy policy, DPA, subprocessor list, SCC/transfer review, DPIA template, breach runbook. |
| **CRA** (reporting from 11 Sep 2026; main obligations 11 Dec 2027) | Mandatory if in scope | Secure-by-default, vulnerability handling, SBOM, coordinated disclosure, support period, 24/72 h incident reporting | **Not met** — no SBOM/provenance/VDP/incident reporting | Confirm scope (web-only SaaS may be out; self-hosted/on-prem may be in). Add SBOM, VDP, security-update policy, support-period statement, and a CRA reporting path if in scope. |
| **NIS2** | Mandatory if in scope | Risk management, incident reporting, supply-chain security, business continuity | **Not assessed** | Determine whether Atlas is a medium/large cloud-computing service; if yes, implement ISMS, 24/72 h reporting, supplier controls. |
| **SOC 2 Type II** | Procurement | 6–12 month observation of security/availability/confidentiality controls | **None** | Start readiness now; controls for access, change management, monitoring, incident response, vendor management, backups. |
| **ISO/IEC 27001:2022** | Procurement | Certified ISMS, 93 controls | **None** | Build on the same control set as SOC 2; 6–12 months to certification. |
| **ISO/IEC 42001:2023** | Procurement (AI) | AI management system, AI risk assessment, model inventory, supplier management | **None** | Add AI governance, model/provider inventory, impact assessments, monitoring, and incident process. |
| **OWASP ASVS 5.0** | Best practice | L2 verification for a business app | **Partial** | Run an ASVS L2 checklist; close gaps; pair with a pen test. |
| **OWASP LLM Top 10 2026** | Best practice | Prompt injection, sensitive disclosure, excessive agency, supply chain, poisoning, unbounded consumption, misinformation, hidden context, vector weaknesses, output handling | **Partial** — see §7 | Add guardrails, eval/red-team corpus, cost quotas, output sanitisation tests, and a documented risk register. |
| **OWASP Agentic Top 10 2026** | Best practice (future) | Goal hijack, tool misuse, identity abuse, supply chain, RCE, memory poisoning, inter-agent comms, cascading failures, trust exploitation, rogue agents | **N/A today** — no tools/agents | If adding connectors/actions, design tool allowlists, per-action authorization, sandboxing, and human approval. |
| **NIST AI RMF + GenAI Profile** | Best practice / procurement | Govern, Map, Measure, Manage; 12 GenAI risks | **Not formalised** | Adopt a lightweight AI risk register and map controls to the RMF functions. |
| **WCAG 2.2 AA / EAA** | Mandatory if in scope; procurement | Perceivable, operable, understandable, robust; EN 301 549 | **Partial** — dialog/live region/focus done; no audit/VPAT | Full WCAG 2.2 AA audit, keyboard/screen-reader/contrast/reduced-motion fixes, VPAT/accessibility statement. |
| **SLSA / SBOM** | Procurement / CRA | Build provenance, dependency inventory, signed artifacts | **Partial** — lockfile, audit, Dependabot; no SBOM/provenance | Emit CycloneDX/SPDX SBOM in CI; target SLSA Build L2/L3; sign release artifacts. |
| **OpenTelemetry GenAI semconv** | Best practice | `gen_ai.*` spans/metrics for model calls, tokens, latency, tools | **Not met** | Instrument chat/embedding/ingestion; add trace IDs, token/cost metrics, dashboards, alerts. |
| **PQC (NIST IR 8547 / CNSA 2.0)** | Best practice → mandatory for some | Hybrid PQC key establishment; crypto inventory; 2030/2035 deadlines | **Not assessed** | Inventory TLS/crypto dependencies; prefer providers with hybrid X25519MLKem768; plan crypto agility. |

## 7. OWASP LLM Top 10 (2026) assessment

| Risk | Status | Evidence | What is missing |
|---|---|---|---|
| **LLM01 Prompt Injection** | Partial | Document text is wrapped in `<untrusted_document_context>` and the system prompt says to treat it as data | No input/output classifier, no instruction-hierarchy tests, no red-team corpus, no tool isolation (no tools today). |
| **LLM02 Sensitive Information Disclosure** | Partial | RLS/owner scoping, server-only keys, private Storage | No PII redaction, DLP, data classification, or prompt/response logging policy. |
| **LLM03 Excessive Agency** | Good (today) | No tools, agents, or actions | Future risk if connectors/actions are added; design least-privilege tool calls. |
| **LLM04 Supply Chain** | Partial | pnpm lockfile, `pnpm audit`, Dependabot | No SBOM, build provenance, signed artifacts, or model-provider risk assessment. |
| **LLM05 Data and Model Poisoning** | Partial | Tenant-isolated uploads; no cross-tenant retrieval | No content provenance, anomaly detection, or embedding-integrity checks. |
| **LLM06 Unbounded Consumption** | Partial | 20 chat/min, 5 uploads/hour, 4 MB/200-page/250k-char caps | No per-tenant token/cost budget, global anomaly detection, or spend alerts. |
| **LLM07 Misinformation** | Partial | Citations, `extractCitedSources`, abstention path | No golden set, faithfulness/answer-relevance metrics, confidence display, or human review. |
| **LLM08 Hidden Context Exposure** | Partial | System prompt contains no secrets | No prompt-leakage tests, hidden-context redaction, or output filtering. |
| **LLM09 Vector and Embedding Weaknesses** | Partial | RLS on chunks, owner-scoped `match_documents` | No embedding-inversion testing, cross-tenant retrieval tests beyond RLS, or index-poisoning controls. |
| **LLM10 Improper Output Handling** | Good | `react-markdown` without `rehype-raw`; one static theme `dangerouslySetInnerHTML`; escaped prompt attributes | Add explicit output-sanitisation tests and a CSP nonce to remove `'unsafe-inline'`. |

## 8. Gap register

Effort is engineering time, not calendar time. P0 blocks any external production claim.

### P0 — before external production / enterprise pilot (0–90 days)

| # | Gap | Why it blocks | Effort |
|---|---|---|---|
| 1 | **No Git repository** (F18) | No reviewable history, branch protection, signed commits, or rollback | 1 day (install Git; currently blocked by admin prompt) |
| 2 | **No AI disclosure / content provenance** | EU AI Act Art. 50 applies from 2 Aug 2026 | 2–3 days |
| 3 | **No account deletion/export** | GDPR/CCPA data-subject rights | 5–8 days |
| 4 | **No privacy package** (policy, DPA, subprocessors, DPIA, transfers) | Enterprise security review and GDPR | 5–10 days + legal |
| 5 | **No audit log / SIEM export** | SOC 2, enterprise procurement, incident forensics | 5–8 days |
| 6 | **No org/team/RBAC model** | Multi-user enterprise sale is impossible with `owner_id` only | 2–3 weeks |
| 7 | **No SSO/SCIM/MFA enforcement** | Every enterprise buyer asks for it | 2–4 weeks (Supabase SSO/SCIM plan-dependent) |
| 8 | **No metrics/tracing/alerting/SLOs** | Cannot operate or prove reliability | 1–2 weeks |
| 9 | **No backups/DR/incident runbook** | Data-loss and outage risk | 3–5 days |
| 10 | **No eval harness / red-team corpus** | Cannot prove answer quality or regression safety | 2–3 weeks |
| 11 | **No guardrails / PII redaction** | OWASP LLM01/02/07; regulated data | 1–2 weeks |
| 12 | **No pen test / SAST / DAST / secret scanning / SBOM** | Procurement and CRA expectations | 2–4 weeks |
| 13 | **Worker throughput 1 job/min** | Upload backlog under real load | 1–2 weeks |
| 14 | **No WCAG 2.2 AA audit/VPAT** | EAA and enterprise accessibility questionnaires | 2–4 weeks |

### P1 — enterprise-pilot grade (3–6 months)

- SOC 2 Type II readiness and observation window; ISO/IEC 27001 certification.
- Data residency (EU region) and customer-managed keys where the platform allows.
- Connectors: Google Drive, SharePoint/OneDrive, Confluence, Slack, Jira, Notion, GitHub.
- Permission-aware sync (source ACLs), incremental re-index, deletion propagation.
- Hybrid retrieval (BM25 + vector) and a reranker; query rewriting; multi-hop.
- Admin console: users, roles, usage, cost, model policy, retention.
- Per-tenant budgets and cost anomaly alerts.
- Load testing and capacity plan; queue autoscaling or a real worker.
- Model fallback/routing and provider health checks.
- OCR for scanned PDFs; more formats (DOCX, PPTX, HTML).
- Status page, support/SLA, security questionnaire pack.

### P2 — competitive scale (6–12 months)

- ISO/IEC 42001 AI management system.
- Agentic workflows with OWASP Agentic Top 10 controls (tool allowlists, approvals,
  sandboxing, per-action authorization, audit).
- First-class on-prem/VPC packaging (Docker Compose, Helm, Terraform, air-gap).
- Mobile/desktop clients; offline capture.
- Connector marketplace and partner ecosystem.
- Multi-region deployment and disaster-recovery exercises.

## 9. Roadmap and exit criteria

### 0–90 days
Close P0. Publish an internal “production readiness” statement that is honest about scope.
**Exit:** Git history + branch protection; AI disclosure live; deletion/export shipped;
privacy package published; audit log + export; SSO/SCIM design approved; OTel metrics and
alerts; eval harness in CI; pen test booked; WCAG audit booked.

### 3–6 months
Enterprise identity and governance; SOC 2 Type II observation starts; connectors and
permission-aware sync; hybrid retrieval + reranker; admin/cost controls; load tests.
**Exit:** design-partner deployments with real users; no P0/P1 security findings open;
99.9% SLO demonstrated for 30 days; eval thresholds met.

### 6–12 months
SOC 2 Type II report; ISO 27001; data residency; on-prem packaging; agentic features with
controls; accessibility VPAT.
**Exit:** enterprise procurement pack complete; two reference customers; support/SLA live.

### Go/no-go criteria for a GA claim
1. All P0 closed and verified.
2. Pen test: no open critical/high.
3. SOC 2 Type II report (or bridge letter) and ISO 27001 certificate.
4. 99.9% availability SLO with an error budget and on-call.
5. Eval gates: faithfulness ≥ 0.90, answer relevancy ≥ 0.85, context recall ≥ 0.80 on a
   versioned golden set; prompt-injection red-team pass rate documented.
6. WCAG 2.2 AA audit and VPAT.
7. DPA, subprocessor list, DPIA template, retention policy, deletion/export verified.
8. Incident response runbook, status page, and breach-notification process.
9. Load test at 10× expected peak with bounded queue latency.
10. AI disclosure and content-provenance controls live.

## 10. Bottom line

Atlas has the hard part many prototypes never get: a coherent owner-scoped data model,
real migrations, a durable ingestion queue, streaming answers, citations, and a green test
suite. That is a credible foundation.

What it does not yet have is the **enterprise product envelope**: identity, orgs, audit,
governance, evidence, connectors, evaluation, and operations. Those are not cosmetic; they
are the difference between “a good RAG app” and “a product a 2027 enterprise can buy.”

The fastest credible path is not to chase Glean feature-for-feature. It is to make Atlas
the **ownable, model-neutral, verifiable RAG workspace** for teams that cannot or will not
send their corpus to a closed vendor — and to earn that position with the P0/P1 controls
above.

## 11. Sources

Standards and regulation:
- OWASP Top 10 for LLM Applications 2026 — https://genai.owasp.org/top-10-for-llm-applications-2026/
- OWASP Top 10 for Agentic Applications 2026 — https://genai.owasp.org/top-10-for-agentic-applications-2026/
- OWASP ASVS 5.0.0 (May 2025) — https://asvs.owasp.org/
- NIST AI RMF Generative AI Profile (NIST AI 600-1, July 2024) — https://nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence
- ISO/IEC 42001:2023 — https://iso.org/insights/iso-42001-explained
- EU AI Act implementation timeline — https://ai-act-service-desk.ec.europa.eu/en/ai-act/eu-ai-act-implementation-timeline
- EU AI Act Article 50 transparency FAQ — https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act
- EU Cyber Resilience Act — https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act
- NIS2 Directive FAQ — https://digital-strategy.ec.europa.eu/en/faqs/directive-measures-high-common-level-cybersecurity-across-union-nis2-directive-faqs
- European Accessibility Act — https://commission.europa.eu/strategy-and-policy/policies/justice-and-fundamental-rights/disability/european-accessibility-act-eaa_en
- NIST IR 8547 PQC transition — https://nvlpubs.nist.gov/nistpubs/ir/2026/NIST.IR.8547.pdf
- SLSA specification 1.0 — https://slsa.dev/spec/v1.0/
- OpenTelemetry GenAI semantic conventions — https://opentelemetry.io/docs/specs/semconv/gen-ai/

Competitors:
- ChatGPT Enterprise compliance/admin — https://openai.com/index/new-tools-for-chatgpt-enterprise
- Anthropic Trust Center — https://trust.anthropic.com/
- Glean Trust Center — https://trust.glean.com/
- Glean enterprise search evaluation — https://www.glean.com/blog/enterprise-search-evaluation-2026
- Microsoft 365 Copilot privacy — https://learn.microsoft.com/en-us/copilot/plan/microsoft-365-copilot-privacy
- NotebookLM Enterprise overview — https://docs.cloud.google.com/agentspace/notebooklm-enterprise/docs/overview
- Onyx security/compliance — https://docs.onyx.app/security/architecture/faq
- Onyx self-hosted overview — https://onyx.app/solutions/secure-ai

Pricing and market context (indicative, verify):
- Enterprise AI search comparison 2026 — https://ai.blocksize.hr/blog/en/enterprise-ai-search-knowledge-management-2026
- Onyx pricing — https://onyx.app/pricing
- ChatGPT Enterprise pricing/features — https://getdeployed.ai/blog/chatgpt-enterprise
