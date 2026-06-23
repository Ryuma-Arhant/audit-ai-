# PromptProof

Autonomous QA and trust-scoring for AI-generated web apps. Paste a URL, and PromptProof crawls every page, runs deterministic checks plus an agentic exploration pipeline, and returns a severity-ranked report with confidence scores, screenshots, and a 0–100 trust score.

## How it works

1. **Crawl** — headless Chromium (Playwright) does a same-origin BFS crawl (up to 16 pages), capturing HTTP status, console errors, network errors, links, forms, and screenshots per page.
2. **Deterministic checks** — run in parallel against the crawl data: HTTP status sweep, console error capture, broken-link detection, action testing (buttons/modals/forms), persistence checks, and stall detection (frozen UI, infinite spinners).
3. **Agent pipeline** — a phased set of LLM-backed agents infers UI intent, generates and executes test flows, classifies and root-causes failures, and judges UX from screenshots. Each agent fails independently without blocking the rest of the pipeline.
4. **Score** — findings are deduplicated and ranked into a `reliabilityScore`, `uxScore`, and a composite `trustScore`.

The Next.js app and the worker are two separate processes that communicate through the database (an `Audit` job queue). The worker polls for queued audits, runs the pipeline, and writes results back; the app serves the report UI and polls for status.

## Tech stack

- **Framework:** Next.js (App Router) + React 19
- **Browser automation:** Playwright (headless Chromium)
- **Database/ORM:** SQLite + Prisma
- **LLM:** NVIDIA NIM (OpenAI-compatible API) via LangChain — `nemotron-3-ultra` for reasoning, `llama-3.1-8b` for fast classification, `llama-3.2-90b-vision` for screenshot/vision tasks
- **Validation:** Zod
- **Logging/monitoring:** Pino + Sentry

## Getting started

### Prerequisites

- Node.js 20+
- An NVIDIA API key (for the LLM agent pipeline) — see [build.nvidia.com](https://build.nvidia.com)

### Setup

```bash
npm install
cp .env.example .env   # then fill in DATABASE_URL, NVIDIA_API_KEY, PROMPTPROOF_API_KEY, SENTRY_DSN
npx prisma migrate dev
```

### Run

The app and worker are separate processes — run both:

```bash
npm run dev:all       # Next.js dev server + worker, concurrently
```

Or run them individually:

```bash
npm run dev           # Next.js app on http://localhost:3000
npm run worker        # worker process (polls the audit queue every 2s)
```

### Test

```bash
npm test
npm run test:watch
```

## Project structure

```
app/                    # Next.js app (UI + API routes)
  page.tsx              # Home — URL input, starts an audit
  audits/[id]/          # Report page (score, findings, screenshots)
  api/                  # POST /api/audits, GET /api/audits/[id], /api/health
worker/
  index.ts              # Queue poller
  pipeline.ts           # Orchestrates the full audit pipeline
  crawler.ts            # Playwright BFS crawler
  scoring.ts            # Aggregates findings into scores
  checks/               # Deterministic checks (HTTP, console, links, actions, persistence, stalls)
  agents/               # LLM-backed agents (ui-inferrer, test-generator, ai-judge, etc.)
lib/                     # Shared DB client, LLM client, config parsing
prisma/schema.prisma     # Audit / Page / Finding / AgentRun / TokenLog models
```

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite connection string (e.g. `file:./dev.db`) |
| `NVIDIA_API_KEY` | Auth for the LLM agent pipeline |
| `PROMPTPROOF_API_KEY` | API key required on audit API routes |
| `SENTRY_DSN` | Error reporting (optional) |

## Non-goals (current scope)

Security/penetration testing, visual regression diffing, load testing, and authenticated-app crawling are out of scope for now.
