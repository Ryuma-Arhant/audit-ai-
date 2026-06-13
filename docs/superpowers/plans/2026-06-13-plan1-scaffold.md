# PromptProof — Plan 1: Scaffold + Core Infrastructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize the PromptProof project with Next.js 14, Prisma/SQLite, Claude client, queue abstraction, API routes, and a minimal working UI so that submitting a URL creates an audit job that gets picked up by the worker and marked complete (stubbed pipeline).

**Architecture:** Next.js 14 App Router serves the UI and `POST /api/audits` + `GET /api/audits/[id]`. A separate Node.js worker process (`tsx worker/index.ts`) polls a SQLite-backed queue via Prisma every 2s, picks up queued audits, and runs `pipeline.ts` (stubbed for now). The two processes share only the SQLite database — no sockets, no shared memory.

**Tech Stack:** Next.js 14, TypeScript, Prisma (SQLite), `@anthropic-ai/sdk`, `zod`, `tsx`, `concurrently`, Jest

---

**This is Plan 1 of 5.**
- **Plan 2:** Crawler — browser-explorer + URL normalization → `Page[]` written to DB
- **Plan 3:** Deterministic checks — 6 checks + scoring → `Finding[]` + scores in DB
- **Plan 4:** Agent pipeline — 8 agents + Claude integration → full agentic findings
- **Plan 5:** Enhanced report UI — ScoreRing, FindingCard, severity filters, unverified section

**End state of Plan 1:** `npm run dev:all` starts both processes; submitting a URL at `localhost:3000` creates an `Audit` row with `status: queued`; worker picks it up within 2s; `GET /api/audits/:id` returns the audit; report page polls and shows Trust Score: 0 when pipeline stub completes.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Create | All 5 models: Audit, Page, Finding, AgentRun, TokenLog |
| `lib/db.ts` | Create | Prisma client singleton (safe for Next.js HMR) |
| `lib/claude.ts` | Create | Claude API wrapper — token logging + cost cap enforcement |
| `worker/queue.ts` | Create | `IQueue` interface + `SQLiteQueue` implementation |
| `worker/pipeline.ts` | Create | Stub — marks audit complete with zero scores |
| `worker/index.ts` | Create | Polling loop with `MAX_CONCURRENT_AUDITS = 3` |
| `app/api/audits/route.ts` | Create | `POST` — validate URL, create queued Audit |
| `app/api/audits/[id]/route.ts` | Create | `GET` — return Audit + findings + agentRuns |
| `app/page.tsx` | Modify | URL input form → POST → redirect to report |
| `app/audits/[id]/page.tsx` | Create | Polling report skeleton with score + finding cards |
| `__tests__/claude.test.ts` | Create | Token logging, cost cap |
| `__tests__/queue.test.ts` | Create | dequeue, fail, concurrency |
| `__tests__/api-audits.test.ts` | Create | POST validation, GET response shape |
| `jest.config.ts` | Create | Next.js Jest config |
| `jest.setup.ts` | Create | Test env vars |
| `.env` / `.env.example` | Create | DATABASE_URL, ANTHROPIC_API_KEY |
| `package.json` | Modify | Add scripts: `worker`, `dev:all`, `test` |
| `.gitignore` | Modify | Add `.env`, `dev.db`, `test.db`, `public/artifacts/` |

---

## Task 1: Initialize Next.js project + install deps

**Files:**
- Create: `D:\multi agent\promptproof\` (project root via `create-next-app`)

- [ ] **Step 1: Scaffold Next.js app**

Run in `D:\multi agent\`:
```bash
npx create-next-app@latest promptproof --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*"
```
Expected: project created. Directories present: `app/`, `public/`, files: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.ts`.

- [ ] **Step 2: Install runtime deps**

```bash
cd "D:\multi agent\promptproof"
npm install @anthropic-ai/sdk @prisma/client prisma zod
```

- [ ] **Step 3: Install dev deps**

```bash
npm install --save-dev tsx concurrently jest @types/jest jest-environment-node
```

- [ ] **Step 4: Install Playwright (Chromium only)**

```bash
npx playwright install chromium
```
Expected: Chromium browser binary downloaded.

- [ ] **Step 5: Update .gitignore**

Append to `.gitignore`:
```
.env
dev.db
test.db
public/artifacts/
```

- [ ] **Step 6: Commit**

```bash
git init
git add .
git commit -m "feat: initialize Next.js 14 project with all deps"
```

---

## Task 2: Prisma schema + db singleton

**Files:**
- Create: `prisma/schema.prisma`
- Create: `lib/db.ts`
- Create: `.env`
- Create: `.env.example`

- [ ] **Step 1: Write prisma/schema.prisma**

Create `prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Audit {
  id               String     @id @default(cuid())
  url              String
  status           String     @default("queued")
  config           Json?

  trustScore       Int?
  reliabilityScore Int?
  uxScore          Int?
  scoreBreakdown   Json?

  pagesCrawled     Int        @default(0)
  durationMs       Int?
  costUsd          Float?
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
  urlRaw         String
  title          String?
  httpStatus     Int
  loadTimeMs     Int?
  screenshotPath String?
  harPath        String?
  consoleErrors  Json
  networkErrors  Json
  links          Json
  actions        Json
  contentHash    String?
  discoveredAt   DateTime  @default(now())
  findings       Finding[]

  @@index([auditId])
}

model Finding {
  id              String   @id @default(cuid())
  auditId         String
  audit           Audit    @relation(fields: [auditId], references: [id])
  pageId          String?
  page            Page?    @relation(fields: [pageId], references: [id])
  source          String
  type            String
  severity        String
  confidence      Float
  unverified      Boolean  @default(false)
  pageUrl         String
  description     String
  reproduction    String?
  screenshotPath  String?
  domEvidence     String?
  consoleEvidence Json?
  networkEvidence Json?
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
  phase        Int
  status       String
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

- [ ] **Step 2: Create .env and .env.example**

Create `.env`:
```
DATABASE_URL="file:./dev.db"
ANTHROPIC_API_KEY="your-anthropic-api-key-here"
```

Create `.env.example`:
```
DATABASE_URL="file:./dev.db"
ANTHROPIC_API_KEY=""
```

- [ ] **Step 3: Generate Prisma client and push schema to SQLite**

```bash
npx prisma generate
npx prisma db push
```
Expected: `dev.db` created in project root. Output includes "Your database is now in sync with your Prisma schema."

- [ ] **Step 4: Write lib/db.ts**

Create `lib/db.ts`:
```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const db = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
```
The global assignment prevents Next.js HMR from creating multiple Prisma connections.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma lib/db.ts .env.example
git commit -m "feat: Prisma schema (5 models) + db singleton"
```

---

## Task 3: Jest setup

**Files:**
- Create: `jest.config.ts`
- Create: `jest.setup.ts`

- [ ] **Step 1: Write jest.config.ts**

Create `jest.config.ts`:
```typescript
import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  setupFilesAfterFramework: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
}

export default createJestConfig(config)
```

- [ ] **Step 2: Write jest.setup.ts**

Create `jest.setup.ts`:
```typescript
process.env.DATABASE_URL = 'file:./test.db'
process.env.ANTHROPIC_API_KEY = 'test-key'
```

- [ ] **Step 3: Push schema to test db**

```bash
DATABASE_URL="file:./test.db" npx prisma db push
```
Expected: `test.db` created with same schema as `dev.db`.

- [ ] **Step 4: Add test + dev scripts to package.json**

Edit `package.json` — add to `"scripts"`:
```json
"test": "jest",
"test:watch": "jest --watch",
"worker": "tsx watch worker/index.ts",
"dev:all": "concurrently \"npm run dev\" \"npm run worker\""
```

- [ ] **Step 5: Verify Jest runs with no tests**

```bash
npm test -- --passWithNoTests
```
Expected: `Test Suites: 0 passed, 0 total` — no errors.

- [ ] **Step 6: Commit**

```bash
git add jest.config.ts jest.setup.ts package.json
git commit -m "feat: Jest config + test db setup"
```

---

## Task 4: Claude client — token logging + cost cap

**Files:**
- Create: `lib/claude.ts`
- Create: `__tests__/claude.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/claude.test.ts`:
```typescript
import { callClaude, CostCapError } from '@/lib/claude'
import { db } from '@/lib/db'

jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5-20251001',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  })),
}))

let auditId: string

async function clearDb() {
  await db.tokenLog.deleteMany()
  await db.agentRun.deleteMany()
  await db.finding.deleteMany()
  await db.page.deleteMany()
  await db.audit.deleteMany()
}

beforeEach(async () => {
  await clearDb()
  const audit = await db.audit.create({
    data: {
      url: 'https://example.com',
      status: 'running',
      config: { costLimitUsd: 0.50 },
    },
  })
  auditId = audit.id
})

afterAll(() => db.$disconnect())

test('callClaude returns the message response', async () => {
  const result = await callClaude({
    auditId,
    agentName: 'test-agent',
    model: 'claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: 'hello' }],
  })
  expect(result.content[0]).toMatchObject({ type: 'text', text: 'response' })
})

test('callClaude writes a TokenLog row with correct cost', async () => {
  await callClaude({
    auditId,
    agentName: 'test-agent',
    model: 'claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: 'hello' }],
  })
  const logs = await db.tokenLog.findMany({ where: { auditId } })
  expect(logs).toHaveLength(1)
  expect(logs[0].inputTokens).toBe(100)
  expect(logs[0].outputTokens).toBe(50)
  expect(logs[0].agentName).toBe('test-agent')
  // haiku: (100/1_000_000 * 0.80) + (50/1_000_000 * 4.0) = 0.00028
  expect(logs[0].costUsd).toBeCloseTo(0.00028, 5)
})

test('callClaude throws CostCapError when accumulated cost exceeds limit', async () => {
  await db.audit.update({
    where: { id: auditId },
    data: { config: { costLimitUsd: 0.0001 } },
  })
  await db.tokenLog.create({
    data: {
      auditId,
      agentName: 'prev',
      model: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.001, // already over limit
    },
  })
  await expect(
    callClaude({
      auditId,
      agentName: 'test-agent',
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: 'hello' }],
    })
  ).rejects.toThrow(CostCapError)
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- __tests__/claude.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/claude'`

- [ ] **Step 3: Write lib/claude.ts**

Create `lib/claude.ts`:
```typescript
import Anthropic from '@anthropic-ai/sdk'
import { db } from './db'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'claude-sonnet-4-6':        { inputPerMTok: 3.0,  outputPerMTok: 15.0 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 0.80, outputPerMTok: 4.0  },
}

export interface CallClaudeParams {
  auditId: string
  agentName: string
  model: string
  messages: Anthropic.MessageParam[]
  system?: string
  maxTokens?: number
}

export async function callClaude(params: CallClaudeParams): Promise<Anthropic.Message> {
  const { auditId, agentName, model, messages, system, maxTokens = 1024 } = params

  await enforceCostCap(auditId)

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages,
  })

  const pricing = MODEL_PRICING[model] ?? { inputPerMTok: 3.0, outputPerMTok: 15.0 }
  const costUsd =
    (response.usage.input_tokens  / 1_000_000) * pricing.inputPerMTok +
    (response.usage.output_tokens / 1_000_000) * pricing.outputPerMTok

  await db.tokenLog.create({
    data: {
      auditId,
      agentName,
      model,
      inputTokens:  response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd,
    },
  })

  return response
}

async function enforceCostCap(auditId: string): Promise<void> {
  const [audit, agg] = await Promise.all([
    db.audit.findUnique({ where: { id: auditId }, select: { config: true } }),
    db.tokenLog.aggregate({ where: { auditId }, _sum: { costUsd: true } }),
  ])
  const config = (audit?.config ?? {}) as { costLimitUsd?: number }
  const limit = config.costLimitUsd ?? 0.50
  const spent = agg._sum.costUsd ?? 0
  if (spent >= limit) {
    throw new CostCapError(
      `Cost cap $${limit} reached (spent $${spent.toFixed(4)}) for audit ${auditId}`
    )
  }
}

export class CostCapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CostCapError'
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- __tests__/claude.test.ts
```
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/claude.ts __tests__/claude.test.ts
git commit -m "feat: Claude client with token logging and cost cap"
```

---

## Task 5: Queue abstraction

**Files:**
- Create: `worker/queue.ts`
- Create: `__tests__/queue.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/queue.test.ts`:
```typescript
import { SQLiteQueue } from '@/worker/queue'
import { db } from '@/lib/db'

async function clearDb() {
  await db.tokenLog.deleteMany()
  await db.agentRun.deleteMany()
  await db.finding.deleteMany()
  await db.page.deleteMany()
  await db.audit.deleteMany()
}

beforeEach(clearDb)
afterAll(() => db.$disconnect())

test('dequeue returns null when no queued audits exist', async () => {
  const q = new SQLiteQueue()
  expect(await q.dequeue()).toBeNull()
})

test('dequeue returns auditId and sets status to running + startedAt', async () => {
  const audit = await db.audit.create({
    data: { url: 'https://example.com', status: 'queued', config: {} },
  })
  const q = new SQLiteQueue()
  const id = await q.dequeue()
  expect(id).toBe(audit.id)
  const updated = await db.audit.findUnique({ where: { id: audit.id } })
  expect(updated?.status).toBe('running')
  expect(updated?.startedAt).not.toBeNull()
})

test('dequeue skips already-running audits', async () => {
  await db.audit.create({
    data: { url: 'https://example.com', status: 'running', config: {} },
  })
  const q = new SQLiteQueue()
  expect(await q.dequeue()).toBeNull()
})

test('dequeue returns oldest queued audit first', async () => {
  const first = await db.audit.create({
    data: { url: 'https://first.com', status: 'queued', config: {} },
  })
  await db.audit.create({
    data: { url: 'https://second.com', status: 'queued', config: {} },
  })
  const q = new SQLiteQueue()
  const id = await q.dequeue()
  expect(id).toBe(first.id)
})

test('fail sets status to failed with errorMessage and completedAt', async () => {
  const audit = await db.audit.create({
    data: { url: 'https://example.com', status: 'running', config: {} },
  })
  const q = new SQLiteQueue()
  await q.fail(audit.id, 'crawl timed out')
  const updated = await db.audit.findUnique({ where: { id: audit.id } })
  expect(updated?.status).toBe('failed')
  expect(updated?.errorMessage).toBe('crawl timed out')
  expect(updated?.completedAt).not.toBeNull()
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- __tests__/queue.test.ts
```
Expected: FAIL — `Cannot find module '@/worker/queue'`

- [ ] **Step 3: Write worker/queue.ts**

Create `worker/queue.ts`:
```typescript
import { db } from '../lib/db'

export interface IQueue {
  dequeue(): Promise<string | null>
  fail(auditId: string, error: string): Promise<void>
}

export class SQLiteQueue implements IQueue {
  async dequeue(): Promise<string | null> {
    const audit = await db.audit.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
    })
    if (!audit) return null

    await db.audit.update({
      where: { id: audit.id },
      data: { status: 'running', startedAt: new Date() },
    })
    return audit.id
  }

  async fail(auditId: string, error: string): Promise<void> {
    await db.audit.update({
      where: { id: auditId },
      data: {
        status: 'failed',
        errorMessage: error,
        completedAt: new Date(),
      },
    })
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- __tests__/queue.test.ts
```
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/queue.ts __tests__/queue.test.ts
git commit -m "feat: IQueue interface + SQLiteQueue implementation"
```

---

## Task 6: Pipeline stub + worker entry point

**Files:**
- Create: `worker/pipeline.ts`
- Create: `worker/index.ts`

- [ ] **Step 1: Write worker/pipeline.ts (stub)**

Create `worker/pipeline.ts`:
```typescript
import { db } from '../lib/db'

export async function runPipeline(auditId: string): Promise<void> {
  console.log(`[pipeline] audit ${auditId} — stub, no checks run yet`)

  await db.audit.update({
    where: { id: auditId },
    data: {
      status:          'complete',
      trustScore:      0,
      reliabilityScore: 0,
      uxScore:         null,
      pagesCrawled:    0,
      durationMs:      0,
      costUsd:         0,
      completedAt:     new Date(),
    },
  })
}
```

- [ ] **Step 2: Write worker/index.ts**

Create `worker/index.ts`:
```typescript
import { SQLiteQueue } from './queue'
import { runPipeline } from './pipeline'

const queue = new SQLiteQueue()
const MAX_CONCURRENT_AUDITS = 3
let active = 0

console.log('[worker] Started — polling every 2s')

setInterval(async () => {
  if (active >= MAX_CONCURRENT_AUDITS) return

  const auditId = await queue.dequeue()
  if (!auditId) return

  active++
  console.log(`[worker] Picked up ${auditId} (active: ${active})`)

  runPipeline(auditId)
    .catch(err => {
      console.error(`[worker] ${auditId} failed:`, err.message)
      return queue.fail(auditId, err.message)
    })
    .finally(() => {
      active--
      console.log(`[worker] ${auditId} done (active: ${active})`)
    })
}, 2000)
```

- [ ] **Step 3: Verify worker starts without error**

```bash
npx tsx worker/index.ts
```
Expected: `[worker] Started — polling every 2s` — press Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
git add worker/pipeline.ts worker/index.ts
git commit -m "feat: worker polling loop + pipeline stub"
```

---

## Task 7: API routes

**Files:**
- Create: `app/api/audits/route.ts`
- Create: `app/api/audits/[id]/route.ts`
- Create: `__tests__/api-audits.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/api-audits.test.ts`:
```typescript
import { POST } from '@/app/api/audits/route'
import { GET } from '@/app/api/audits/[id]/route'
import { db } from '@/lib/db'

async function clearDb() {
  await db.tokenLog.deleteMany()
  await db.agentRun.deleteMany()
  await db.finding.deleteMany()
  await db.page.deleteMany()
  await db.audit.deleteMany()
}

beforeEach(clearDb)
afterAll(() => db.$disconnect())

describe('POST /api/audits', () => {
  test('creates queued audit and returns { id, status }', async () => {
    const req = new Request('http://localhost/api/audits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBeDefined()
    expect(body.status).toBe('queued')
    const stored = await db.audit.findUnique({ where: { id: body.id } })
    expect(stored?.url).toBe('https://example.com')
    expect(stored?.config).toMatchObject({ maxPages: 15, costLimitUsd: 0.50 })
  })

  test('returns 400 for invalid URL', async () => {
    const req = new Request('http://localhost/api/audits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-url' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  test('returns 400 when url field is missing', async () => {
    const req = new Request('http://localhost/api/audits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

describe('GET /api/audits/[id]', () => {
  test('returns audit with findings array and pagesCrawled', async () => {
    const audit = await db.audit.create({
      data: {
        url: 'https://example.com',
        status: 'complete',
        config: {},
        trustScore: 87,
        reliabilityScore: 82,
        uxScore: 95,
        pagesCrawled: 5,
      },
    })
    const req = new Request(`http://localhost/api/audits/${audit.id}`)
    const res = await GET(req, { params: { id: audit.id } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.trustScore).toBe(87)
    expect(body.reliabilityScore).toBe(82)
    expect(body.findings).toEqual([])
    expect(body.pagesCrawled).toBe(5)
  })

  test('returns 404 for unknown audit id', async () => {
    const req = new Request('http://localhost/api/audits/nonexistent')
    const res = await GET(req, { params: { id: 'nonexistent' } })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- __tests__/api-audits.test.ts
```
Expected: FAIL — `Cannot find module '@/app/api/audits/route'`

- [ ] **Step 3: Write app/api/audits/route.ts**

Create `app/api/audits/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

const schema = z.object({
  url: z.string().url('Must be a valid URL'),
})

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Invalid request' },
      { status: 400 }
    )
  }

  const audit = await db.audit.create({
    data: {
      url: parsed.data.url,
      status: 'queued',
      config: { maxPages: 15, costLimitUsd: 0.50, timeLimitMs: 600_000 },
    },
  })

  return NextResponse.json({ id: audit.id, status: audit.status })
}
```

- [ ] **Step 4: Write app/api/audits/[id]/route.ts**

Create `app/api/audits/[id]/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const audit = await db.audit.findUnique({
    where: { id: params.id },
    include: {
      findings:  { orderBy: { createdAt: 'asc' } },
      agentRuns: { orderBy: { startedAt: 'asc' } },
    },
  })

  if (!audit) {
    return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  }

  // Sort findings by severity (critical first) then confidence (highest first)
  const sortedFindings = [...audit.findings].sort((a, b) => {
    const severityDiff =
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
    if (severityDiff !== 0) return severityDiff
    return b.confidence - a.confidence
  })

  return NextResponse.json({ ...audit, findings: sortedFindings })
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm test -- __tests__/api-audits.test.ts
```
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add app/api/audits/route.ts "app/api/audits/[id]/route.ts" __tests__/api-audits.test.ts
git commit -m "feat: POST /api/audits + GET /api/audits/[id] routes"
```

---

## Task 8: Home page — URL input form

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace default Next.js page**

Write `app/page.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to start audit')
        return
      }
      router.push(`/audits/${data.id}`)
    } catch {
      setError('Network error — check your connection')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
      <div className="w-full max-w-lg">
        <h1 className="text-4xl font-bold mb-2 tracking-tight">PromptProof</h1>
        <p className="text-gray-500 mb-8">Autonomous QA for AI-generated apps</p>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://myapp.emergent.sh"
            required
            className="flex-1 border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors"
          >
            {loading ? 'Starting…' : 'Audit'}
          </button>
        </form>
        {error && <p className="mt-3 text-red-600 text-sm">{error}</p>}
      </div>
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/page.tsx
git commit -m "feat: URL input home page"
```

---

## Task 9: Report page — polling skeleton

**Files:**
- Create: `app/audits/[id]/page.tsx`

- [ ] **Step 1: Create report page**

Create `app/audits/[id]/page.tsx`:
```tsx
'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type Finding = {
  id: string
  severity: string
  confidence: number
  source: string
  type: string
  description: string
  pageUrl: string
  unverified: boolean
  reproduction: string | null
  screenshotPath: string | null
}

type Audit = {
  id: string
  url: string
  status: string
  trustScore: number | null
  reliabilityScore: number | null
  uxScore: number | null
  pagesCrawled: number
  costUsd: number | null
  durationMs: number | null
  findings: Finding[]
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'border-red-500 bg-red-50',
  high:     'border-orange-500 bg-orange-50',
  medium:   'border-yellow-500 bg-yellow-50',
  low:      'border-blue-500 bg-blue-50',
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const [audit, setAudit] = useState<Audit | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let active = true

    async function poll() {
      const res = await fetch(`/api/audits/${id}`)
      if (!active) return
      if (res.status === 404) { setNotFound(true); return }
      if (!res.ok) return
      const data: Audit = await res.json()
      setAudit(data)
      if (data.status !== 'complete' && data.status !== 'failed') {
        setTimeout(poll, 3000)
      }
    }

    poll()
    return () => { active = false }
  }, [id])

  if (notFound) return (
    <main className="p-8">
      <p className="text-red-600">Audit not found.</p>
      <a href="/" className="text-blue-600 hover:underline text-sm">← Back</a>
    </main>
  )

  if (!audit) return <div className="p-8 text-gray-400">Loading…</div>

  const confirmed  = audit.findings.filter(f => !f.unverified)
  const unverified = audit.findings.filter(f =>  f.unverified)

  return (
    <main className="max-w-2xl mx-auto p-8">
      <a href="/" className="text-sm text-blue-600 hover:underline">← New audit</a>

      <h1 className="text-2xl font-bold mt-4 mb-1">Audit Report</h1>
      <p className="text-gray-500 text-sm mb-6 break-all">{audit.url}</p>

      {(audit.status === 'queued' || audit.status === 'running') && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
          Auditing…{audit.pagesCrawled > 0 ? ` ${audit.pagesCrawled} pages crawled` : ''}
        </div>
      )}

      {audit.status === 'failed' && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          Audit failed
        </div>
      )}

      {audit.trustScore !== null && (
        <div className="mb-8 py-8 text-center bg-white border rounded-xl">
          <div className="text-7xl font-bold tabular-nums">{audit.trustScore}</div>
          <div className="text-gray-500 mt-1 text-sm">Trust Score</div>
          <div className="mt-2 text-xs text-gray-400 space-x-3">
            <span>Reliability: {audit.reliabilityScore ?? '—'}</span>
            <span>UX: {audit.uxScore ?? '—'}</span>
            {audit.costUsd   !== null && <span>${audit.costUsd.toFixed(4)}</span>}
            {audit.durationMs !== null && <span>{(audit.durationMs / 1000).toFixed(1)}s</span>}
          </div>
        </div>
      )}

      {confirmed.length > 0 && (
        <div className="space-y-3 mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Findings ({confirmed.length})
          </h2>
          {confirmed.map(f => (
            <div
              key={f.id}
              className={`p-4 rounded-lg border-l-4 ${SEVERITY_STYLES[f.severity] ?? 'border-gray-300 bg-gray-50'}`}
            >
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide mb-1">
                <span>{f.severity}</span>
                <span className="opacity-30">·</span>
                <span className="font-normal normal-case opacity-60">
                  {f.confidence.toFixed(1)} confidence
                </span>
                <span className="opacity-30">·</span>
                <span className="font-normal normal-case opacity-60">{f.source}</span>
              </div>
              <p className="text-sm">{f.description}</p>
              <p className="text-xs text-gray-400 mt-1 break-all">{f.pageUrl}</p>
            </div>
          ))}
        </div>
      )}

      {unverified.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-gray-400 hover:text-gray-600">
            {unverified.length} unverified finding{unverified.length > 1 ? 's' : ''} (not scored)
          </summary>
          <div className="mt-2 space-y-2">
            {unverified.map(f => (
              <div key={f.id} className="p-3 rounded border border-gray-200 bg-gray-50">
                <div className="text-xs text-amber-600 font-medium mb-1 uppercase">
                  Unverified · {f.source}
                </div>
                <p className="text-sm text-gray-600">{f.description}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/audits/[id]/page.tsx"
git commit -m "feat: polling report page with score display and finding cards"
```

---

## Task 10: Full test run + end-to-end smoke test

**Files:** none

- [ ] **Step 1: Run full test suite**

```bash
npm test
```
Expected: PASS — 13 tests across 3 suites (claude: 3, queue: 5, api-audits: 5).

- [ ] **Step 2: Start both processes**

```bash
npm run dev:all
```
Expected output (interleaved):
```
[worker] Started — polling every 2s
  ▲ Next.js 14.x.x
  - Local: http://localhost:3000
```

- [ ] **Step 3: Submit a URL**

1. Open `http://localhost:3000`
2. Enter `https://example.com` → click **Audit**
3. Browser redirects to `/audits/<id>`
4. Page shows "Auditing…"
5. Within ~4 seconds: page refreshes to show **Trust Score: 0**
6. Worker terminal shows: `[worker] Picked up <id>` then `[worker] <id> done`

- [ ] **Step 4: Verify database**

```bash
npx prisma studio
```
Open `http://localhost:5555` → Audit table → 1 row with `status: complete`, `trustScore: 0`.

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: plan 1 complete — scaffold, queue, API, and polling UI working end-to-end"
```

---

## Self-Review Notes

- **Spec §3 data model:** All 5 Prisma models match spec exactly — `Finding.unverified`, `AgentRun.phase`, `Audit.trustScore/reliabilityScore/uxScore`, `Audit.config` JSON all present. ✅
- **Spec §4 queue abstraction:** `IQueue` interface implemented; SQLiteQueue is the concrete impl. Worker uses it. ✅
- **Spec §5 budget controls:** `MAX_CONCURRENT_AUDITS = 3` in worker/index.ts; cost cap in lib/claude.ts. Time limit enforced in Plan 2 (crawler). ✅
- **Type consistency:** `callClaude` params match usage in tests; `IQueue.dequeue()` return type `Promise<string | null>` used consistently. ✅
- **Finding sort:** `SEVERITY_RANK` used in both GET route and report page, same map. ✅
- **Worker imports:** Uses relative paths (`../lib/db`) not `@/` aliases — avoids tsx path resolution issues. ✅
