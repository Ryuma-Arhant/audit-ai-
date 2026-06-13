# PromptProof — Design Spec

**Date:** 2026-06-13  
**Status:** Approved  
**Location:** `D:\multi agent\promptproof\`

---

## 1. What We're Building

Autonomous QA and trust-scoring system for AI-generated web apps. URL in → crawl → deterministic checks + full agentic pipeline → severity-ranked report with confidence scores and screenshots.

Full build: deterministic core + all 8 new pipeline agents + LLM judge. No feature flags — everything ships together.

---

## 2. Architecture

**Two-process model:**

- **Next.js app** (`app/`) — URL input, API routes, report UI
- **Worker process** (`worker/`) — Playwright crawler, deterministic checks, agent pipeline

They communicate through a **SQLite jobs table** (Audit rows with `status: queued | running | complete | failed`). Worker polls every 2s, picks oldest queued job, runs pipeline, writes results back. Next.js API reads results and serves the report.

### Folder Structure

```
promptproof/
├── app/
│   ├── page.tsx                      # Home — URL input form
│   ├── audits/[id]/page.tsx          # Report page (score-first)
│   └── api/
│       ├── audits/route.ts           # POST — create audit job
│       └── audits/[id]/route.ts      # GET — poll status + results
├── worker/
│   ├── index.ts                      # Queue poller (2s interval)
│   ├── pipeline.ts                   # Orchestrates all steps
│   ├── crawler.ts                    # Playwright BFS crawler
│   ├── scoring.ts                    # Aggregate findings → 0–100
│   ├── checks/
│   │   ├── http-status.ts
│   │   ├── console-errors.ts
│   │   ├── broken-links.ts
│   │   ├── action-testing.ts        # buttons/modals/toggles/wizards + HTML forms
│   │   ├── persistence.ts
│   │   └── stall-detection.ts       # infinite spinners, frozen UI, no network after action
│   └── agents/
│       ├── browser-explorer.ts
│       ├── ui-inferrer.ts
│       ├── test-generator.ts
│       ├── agentic-explorer.ts
│       ├── error-classifier.ts
│       ├── root-cause-analyzer.ts
│       ├── ai-judge.ts
│       └── report-synthesizer.ts
├── lib/
│   ├── db.ts                         # Prisma client singleton
│   └── claude.ts                     # Claude API client + token logging
├── prisma/schema.prisma
├── public/artifacts/                 # Screenshots (S3-compatible path later)
└── re-use-agents/                    # Modified copies from re-use-agent/
```

---

## 3. Data Model

```prisma
model Audit {
  id               String     @id @default(cuid())
  url              String
  status           String     @default("queued")  // queued | running | complete | failed
  config           Json?                           // { maxPages, costLimitUsd, timeLimitMs }

  // Three scores — all null until complete
  trustScore       Int?       // composite: (reliabilityScore × 0.7) + (uxScore × 0.3)
  reliabilityScore Int?       // technical quality — deterministic + agentic findings only
  uxScore          Int?       // LLM judge output only

  scoreBreakdown   Json?      // { http, console, links, forms, persistence, ux }
  pagesCrawled     Int        @default(0)
  durationMs       Int?
  costUsd          Float?     // sum of TokenLog.costUsd
  errorMessage     String?
  createdAt        DateTime   @default(now())
  startedAt        DateTime?
  completedAt      DateTime?
  pages            Page[]
  findings         Finding[]
  agentRuns        AgentRun[]
  tokenLogs        TokenLog[]
}

model Page {
  id             String    @id @default(cuid())
  auditId        String
  audit          Audit     @relation(fields: [auditId], references: [id])
  url            String
  title          String?
  httpStatus     Int
  loadTimeMs     Int?
  screenshotPath String?
  harPath        String?
  consoleErrors  Json      // { level, message, source }[]
  networkErrors  Json      // { url, status, method }[]
  links          Json      // { href, text, status: int|null }[]
  forms          Json      // { action, method, fields: string[] }[]
  findings       Finding[]
  discoveredAt   DateTime  @default(now())

  @@index([auditId])
}

model Finding {
  id              String   @id @default(cuid())
  auditId         String
  audit           Audit    @relation(fields: [auditId], references: [id])
  pageId          String?
  page            Page?    @relation(fields: [pageId], references: [id])
  source          String   // deterministic | agentic | llm_judge
  type            String   // http_error | console_error | broken_link | action_failure
                           // persistence_loss | auth_dead_end | ux_incoherence | hallucinated_route | stall
  severity        String   // critical | high | medium | low
  confidence      Float    // must be one of: 1.0 | 0.9 | 0.7 | 0.5 | 0.3
  unverified      Boolean  @default(false)  // true = LLM finding with no evidence → excluded from score
  pageUrl         String
  description     String
  reproduction    String?
  // Evidence fields — at least one required for LLM findings (else unverified=true)
  screenshotPath  String?
  domEvidence     String?  // relevant DOM snippet
  consoleEvidence Json?    // { level, message, source }[]
  networkEvidence Json?    // { url, status, method }[]
  createdAt       DateTime @default(now())

  @@index([auditId])
  @@index([severity])
  @@index([unverified])
}

model AgentRun {
  id           String    @id @default(cuid())
  auditId      String
  audit        Audit     @relation(fields: [auditId], references: [id])
  agentName    String
  phase        Int       // 1–4 (pipeline phase)
  status       String    // running | complete | failed | skipped | partial
  inputJson    Json?
  outputJson   Json?
  durationMs   Int?
  errorMessage String?
  startedAt    DateTime  @default(now())
  completedAt  DateTime?

  @@index([auditId])
}

model TokenLog {
  id           String   @id @default(cuid())
  auditId      String
  audit        Audit    @relation(fields: [auditId], references: [id])
  agentName    String
  model        String
  inputTokens  Int
  outputTokens Int
  costUsd      Float
  createdAt    DateTime @default(now())

  @@index([auditId])
}
```

**Scoring (`scoring.ts`):**

Three scores, all computed at the end of the pipeline:

| Score | Formula |
|---|---|
| **Reliability Score** | Deduction-based from deterministic + agentic findings (see table) |
| **UX Score** | Output of `ai-judge` (0–100, returned directly) |
| **Trust Score** | `(reliabilityScore × 0.7) + (uxScore × 0.3)` — headline number |

**Reliability deductions (start at 100):**

| Finding | Deduction | Per-severity cap |
|---|---|---|
| Critical confirmed | −20 each | −60 total |
| High confirmed | −10 each | −30 total |
| Medium confirmed | −5 each | −15 total |
| Low confirmed | −2 each | −10 total |
| Suspicious (confidence < 0.7) | −1 each | −10 total |

Floor: 0. `confirmed` derived at read time: `confidence >= 0.7`.

**Score ceilings (override formula — take whichever is lower):**

| Condition | Max Trust Score |
|---|---|
| 1 critical confirmed | 59 |
| 2+ critical confirmed | 39 |
| Data-loss or broken-auth critical | 39 |

**Confidence tiers (agents must use exactly — no interpolation):**

| Value | Meaning | How assigned |
|---|---|---|
| 1.0 | Deterministic proof | HTTP 4xx/5xx, network error, console exception — machine-verifiable |
| 0.9 | Reproduced 2+ times | Agentic explorer confirmed same failure on retry |
| 0.7 | Evidence-supported | Screenshot + console or network evidence both present |
| 0.5 | Single observation | Seen once, no corroborating evidence |
| 0.3 | Suspicion only | LLM flagged, no evidence — shown as unverified, excluded from score |

**Budget controls (enforced in `lib/claude.ts` and `worker/index.ts`):**

```
MAX_CONCURRENT_AUDITS  = 3          // reject 4th job until a slot frees
MAX_BROWSER_SESSIONS   = 5          // crawler + agentic-explorer combined
MAX_COST_PER_AUDIT     = $0.50      // hard abort on cost ceiling — finalize with available data
MAX_DURATION_PER_AUDIT = 10 min     // hard abort on time ceiling
MAX_CLAUDE_RPM         = 60         // rolling 60s window in claude.ts
```

---

## 4. Worker Pipeline

`pipeline.ts` runs these steps in sequence per audit:

### Step 1 — Crawl (`browser-explorer.ts`)
- Playwright headless Chromium, BFS from start URL, same-origin only, max 15 pages
- Per page: HTTP status, screenshot, HAR, console errors, network errors, links, forms
- Write Page rows to DB as discovered (live `pagesCrawled` count)
- On auth wall → record `could_not_authenticate`, stop that branch

### Step 2 — Deterministic Checks (parallel)
All 6 run against crawl data simultaneously. Each is fully isolated — one failing does not affect others.

| Check | File | Severity |
|---|---|---|
| HTTP status sweep | `http-status.ts` | critical (5xx) / high (4xx) |
| Console error capture | `console-errors.ts` | high (uncaught) / medium (error-level) |
| Broken link detection | `broken-links.ts` | medium |
| Action testing | `action-testing.ts` | critical (silent fail) — covers buttons, toggles, modals, drawers, wizards, multi-step flows, and HTML forms |
| Persistence check | `persistence.ts` | critical (state lost on reload) |
| Stall detection | `stall-detection.ts` | high — detects: infinite spinners (>5s), no DOM change after user action (>3s), no network activity after click (>3s), `loading...` text that never clears |

### URL Normalization (crawler.ts)

Applied before deduplication:
- Strip: `utm_*`, `fbclid`, `gclid`, `ref`, `source` query params
- Strip: `?page=N`, `?p=N`, `?offset=N`, `?filter=*`, `?sort=*`, `?order=*`
- Strip: session params (`?sid=`, `?session=`, `?token=`)
- Parametric routes (`/chat/1`, `/chat/2`) → crawl first instance, skip rest
- Store raw URL in `Page.urlRaw`, normalized in `Page.url`

### Step 3 — Agent Pipeline (phase-based, each agent independently recovering)

```
Phase A — parallel, independent (both can fail without blocking each other):
  ui-inferrer       (reads Page[] from DB, infers element intents)
  error-classifier  (classifies deterministic raw findings → typed Finding[])

Phase B — sequential, depends on ui-inferrer output:
  test-generator    (inferred intents → AgentFlowSpec[])
  → agentic-explorer (executes flows via Playwright → FlowResult[])
  [skipped if ui-inferrer failed]

Phase C — parallel, independent:
  root-cause-analyzer  (enriches findings: reproduction steps + adjusted confidence)
  ai-judge             (UX score 0–100 from screenshots + inferred intents)
  [ai-judge skipped if ui-inferrer failed]

Phase D — synthesis:
  report-synthesizer   (deduplicates, merges all Finding[], ranks, writes to DB)
```

**Independent failure recovery:** each agent is wrapped in its own try/catch. On failure it writes `AgentRun { status: "failed", errorMessage }` and returns an empty result — the orchestrator continues with whatever the other agents produced. A `partial` status is written when an agent returns fewer results than expected (e.g., agentic-explorer completes 2 of 5 flows before cost ceiling hits).

**Mandatory evidence for LLM findings:** `ai-judge` and `error-classifier` must populate at least one of `screenshotPath`, `domEvidence`, `consoleEvidence`, `networkEvidence` per finding. Without evidence → `unverified = true`, `confidence = 0.3`, excluded from score. Shown in report as "Unverified — not scored."

### Step 4 — Score
`scoring.ts` → computes `reliabilityScore`, `uxScore`, `trustScore` + `scoreBreakdown`.
If `ai-judge` skipped: `uxScore = null`, `trustScore = reliabilityScore` (full weight on reliability).

### Step 5 — Finalize
`Audit.status = "complete"`, `completedAt`, `durationMs`, `costUsd = sum(TokenLog.costUsd)`

### Failure Handling
- Crawl failure → only case that sets `Audit.status = "failed"` (nothing to check)
- All other failures → `status = "complete"` with partial data; `AgentRun` records show what failed
- Cost/time budget hit mid-pipeline → remaining agents marked `skipped`, finalize runs immediately
- Worker retries crawl max 2× before giving up

---

## 5. Agent Contracts

All agents are TypeScript functions: `(input, auditId) => output`. LLM calls go through `lib/claude.ts` → writes `TokenLog` per call.

| Agent | Model | I/O |
|---|---|---|
| `browser-explorer` | None (Playwright) | `{url, maxPages}` → `Page[]` |
| `ui-inferrer` | claude-sonnet-4-6 (vision) | `Page[]` → inferred element purposes |
| `test-generator` | claude-haiku-4-5-20251001 | inferred intents → `AgentFlowSpec[]` |
| `agentic-explorer` | None (Playwright) | `AgentFlowSpec[]` → `FlowResult[]` |
| `error-classifier` | claude-haiku-4-5-20251001 | `FlowResult[]` → typed `Finding[]` |
| `root-cause-analyzer` | claude-sonnet-4-6 | `Finding[]` + evidence → `Finding[]` with reproduction + adjusted confidence |
| `ai-judge` | claude-sonnet-4-6 (vision) | screenshots + inferred intents → UX `Finding[]` |
| `report-synthesizer` | None (pure logic) | all `Finding[]` → deduplicated, ranked `Finding[]` written to DB |

**Re-use agents referenced (not invoked as agents — used as implementation guides):**
- `specialized-agents-orchestrator` → `pipeline.ts` orchestration pattern
- `testing-evidence-collector` → `browser-explorer.ts` crawl strategy
- `testing-reality-checker` → `root-cause-analyzer.ts` cross-validation logic
- `specialized-document-generator` → report UI component structure

---

## 6. Report UI

**`app/page.tsx`** — URL input + Audit button. POST → redirect to `/audits/[id]`.

**`app/audits/[id]/page.tsx`** — Score-first layout (basic, to be improved later):
- Score ring (0–100, green/amber/red)
- Severity badge filter chips
- Finding cards: severity dot, confidence, source tag, description, page URL, screenshot link, reproduction steps
- Suspicious label (⚠) when `confidence < 0.7`
- Polls `GET /api/audits/[id]` every 3s while `status !== complete | failed`
- Live `pagesCrawled` counter during audit

**Components:** `ScoreRing`, `SeverityBadges`, `FindingCard`, `SuspiciousLabel`, `SourceFilter`

---

## 7. Tech Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (end to end) |
| Web framework | Next.js 14 App Router |
| Browser automation | Playwright (headless Chromium) |
| ORM | Prisma |
| Database | SQLite (dev/MVP) |
| Queue | SQLite Audit table (swap to BullMQ + Redis later) |
| Artifact storage | `public/artifacts/` local FS (swap to S3 later) |
| LLM | Claude via `@anthropic-ai/sdk` |
| Models | claude-sonnet-4-6 (vision tasks), claude-haiku-4-5-20251001 (classification/generation) |

---

## 8. Non-Goals (MVP)

- Security / penetration testing
- Visual regression / pixel diffing
- Performance / load testing
- Authenticated app support (credentials supplied) — v1
- Auto-fix suggestions — later
- BullMQ / Redis queue — later
- S3 artifact storage — later
