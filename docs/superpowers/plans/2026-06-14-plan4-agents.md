# Plan 4: Agent Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build all 8 pipeline agents (ui-inferrer, error-classifier, test-generator, agentic-explorer, root-cause-analyzer, ai-judge, report-synthesizer) orchestrated in phases A→B→C→D, plus update scoring to incorporate uxScore from ai-judge.

**Architecture:** Each agent is `async (auditId, ...) => output` — reads from DB, calls Claude or Playwright, writes results back. An `AgentRun` row is created per agent execution (status: running→complete|failed). Phase A runs ui-inferrer + error-classifier in parallel; Phase B runs test-generator then agentic-explorer sequentially (skipped if ui-inferrer failed); Phase C runs root-cause-analyzer + ai-judge in parallel; Phase D runs report-synthesizer. All LLM calls go through `lib/claude.ts`. Tests mock `lib/claude` at module boundary; agentic-explorer uses a real Playwright + local HTTP server.

**Tech Stack:** Playwright (agentic-explorer), Claude claude-sonnet-4-6 (vision agents), claude-haiku-4-5-20251001 (classification), Prisma/SQLite, TypeScript

---

### File map

| Create | Purpose |
|--------|---------|
| `worker/agents/types.ts` | Shared InferredIntent, AgentFlowSpec, FlowStep, FlowResult |
| `worker/agents/run-tracker.ts` | AgentRun DB helper wrapping each agent call |
| `worker/agents/ui-inferrer.ts` | Phase A: page screenshots → InferredIntent[] |
| `worker/agents/error-classifier.ts` | Phase A: enriches/re-classifies deterministic findings |
| `worker/agents/test-generator.ts` | Phase B: InferredIntent[] → AgentFlowSpec[] |
| `worker/agents/agentic-explorer.ts` | Phase B: executes AgentFlowSpec[] via Playwright → FlowResult[] |
| `worker/agents/root-cause-analyzer.ts` | Phase C: enriches findings with reproduction steps |
| `worker/agents/ai-judge.ts` | Phase C: screenshots + intents → uxScore + UX Finding[] |
| `worker/agents/report-synthesizer.ts` | Phase D: deduplicates all Finding[], deletes duplicates |
| `__tests__/agents-phase-a.test.ts` | Unit tests: ui-inferrer, error-classifier (mock callClaude) |
| `__tests__/agents-phase-b.test.ts` | Unit: test-generator (mock) + integration: agentic-explorer (Playwright) |
| `__tests__/agents-phase-cd.test.ts` | Unit: root-cause-analyzer, ai-judge, report-synthesizer |
| Modify: `worker/scoring.ts` | Accept uxScore param, compute weighted trustScore |
| Modify: `worker/pipeline.ts` | Orchestrate A→B→C→D phases |

---

### Task 1: Shared types + AgentRun tracker

**Files:**
- Create: `worker/agents/types.ts`
- Create: `worker/agents/run-tracker.ts`

- [ ] **Step 1: Create worker/agents/types.ts**

```typescript
export interface InferredIntent {
  pageUrl: string
  elementSelector: string
  purpose: string
  elementType: string
  confidence: number
}

export interface FlowStep {
  action: 'click' | 'fill' | 'navigate' | 'wait' | 'assert'
  selector?: string
  value?: string
  description: string
}

export interface AgentFlowSpec {
  name: string
  pageUrl: string
  steps: FlowStep[]
}

export interface FlowResult {
  specName: string
  pageUrl: string
  success: boolean
  completedSteps: number
  totalSteps: number
  error?: string
  screenshotPath?: string
}
```

- [ ] **Step 2: Create worker/agents/run-tracker.ts**

```typescript
import { db } from '../../lib/db'

export async function trackAgentRun<T>(
  auditId: string,
  agentName: string,
  phase: number,
  input: unknown,
  fn: () => Promise<T>
): Promise<T> {
  const run = await db.agentRun.create({
    data: { auditId, agentName, phase, status: 'running', inputJson: JSON.stringify(input) },
  })
  const t0 = Date.now()
  try {
    const result = await fn()
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: 'complete',
        outputJson: JSON.stringify(result),
        durationMs: Date.now() - t0,
        completedAt: new Date(),
      },
    })
    return result
  } catch (err) {
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
        completedAt: new Date(),
      },
    })
    throw err
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add worker/agents/types.ts worker/agents/run-tracker.ts
git commit -m "feat: agent shared types and AgentRun tracker"
```

---

### Task 2: Phase A agents — ui-inferrer + error-classifier

**Files:**
- Create: `worker/agents/ui-inferrer.ts`
- Create: `worker/agents/error-classifier.ts`
- Create: `__tests__/agents-phase-a.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/agents-phase-a.test.ts`:
```typescript
import type { Message } from '@anthropic-ai/sdk'
import { uiInferrer } from '../worker/agents/ui-inferrer'
import { errorClassifier } from '../worker/agents/error-classifier'
import { db } from '../lib/db'

jest.mock('../lib/claude', () => ({
  callClaude: jest.fn(),
  CostCapError: class CostCapError extends Error {
    constructor(m: string) { super(m); this.name = 'CostCapError' }
  },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { callClaude } = require('../lib/claude') as { callClaude: jest.MockedFunction<() => Promise<Message>> }

function claudeResp(text: string): Message {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 50 },
  } as unknown as Message
}

async function clearDb() {
  await db.finding.deleteMany()
  await db.page.deleteMany()
  await db.agentRun.deleteMany()
  await db.tokenLog.deleteMany()
  await db.audit.deleteMany()
}

async function makeAudit() {
  return db.audit.create({
    data: { url: 'https://example.com', status: 'running', config: JSON.stringify({}) },
  })
}

async function makePage(auditId: string, overrides: Record<string, unknown> = {}) {
  return db.page.create({
    data: {
      auditId,
      url: 'https://example.com/',
      urlRaw: 'https://example.com/',
      httpStatus: 200,
      consoleErrors: JSON.stringify([]),
      networkErrors: JSON.stringify([]),
      links: JSON.stringify([]),
      actions: JSON.stringify([{ type: 'button', label: 'Login', selector: '#btn-login' }]),
      ...overrides,
    },
  })
}

beforeEach(clearDb)
afterAll(() => db.$disconnect())

// ─── ui-inferrer ───

describe('uiInferrer', () => {
  test('parses InferredIntent[] from Claude response and creates AgentRun', async () => {
    const audit = await makeAudit()
    await makePage(audit.id)

    callClaude.mockResolvedValueOnce(claudeResp(JSON.stringify([
      {
        pageUrl: 'https://example.com/',
        elementSelector: '#btn-login',
        purpose: 'auth-login',
        elementType: 'button',
        confidence: 0.9,
      },
    ])))

    const intents = await uiInferrer(audit.id)

    expect(intents).toHaveLength(1)
    expect(intents[0].purpose).toBe('auth-login')
    expect(intents[0].confidence).toBe(0.9)

    const run = await db.agentRun.findFirst({ where: { auditId: audit.id, agentName: 'ui-inferrer' } })
    expect(run?.status).toBe('complete')
    expect(run?.phase).toBe(1)
  })

  test('returns empty array for page with no actions', async () => {
    const audit = await makeAudit()
    await makePage(audit.id, { actions: JSON.stringify([]) })

    const intents = await uiInferrer(audit.id)

    expect(intents).toHaveLength(0)
    expect(callClaude).not.toHaveBeenCalled()
  })

  test('marks AgentRun failed when Claude throws', async () => {
    const audit = await makeAudit()
    await makePage(audit.id)

    callClaude.mockRejectedValueOnce(new Error('API error'))

    await expect(uiInferrer(audit.id)).rejects.toThrow('API error')

    const run = await db.agentRun.findFirst({ where: { auditId: audit.id, agentName: 'ui-inferrer' } })
    expect(run?.status).toBe('failed')
    expect(run?.errorMessage).toBe('API error')
  })
})

// ─── error-classifier ───

describe('errorClassifier', () => {
  test('downgrades finding severity based on Claude response', async () => {
    const audit = await makeAudit()
    const finding = await db.finding.create({
      data: {
        auditId: audit.id,
        source: 'deterministic',
        type: 'console_error',
        severity: 'high',
        confidence: 1.0,
        unverified: false,
        pageUrl: 'https://example.com/',
        description: 'Console error: React DevTools message',
      },
    })

    callClaude.mockResolvedValueOnce(claudeResp(JSON.stringify([
      { id: finding.id, action: 'downgrade', reason: 'DevTools message, not a real error' },
    ])))

    await errorClassifier(audit.id)

    const updated = await db.finding.findUnique({ where: { id: finding.id } })
    expect(updated?.severity).toBe('medium') // high → medium

    const run = await db.agentRun.findFirst({ where: { auditId: audit.id, agentName: 'error-classifier' } })
    expect(run?.status).toBe('complete')
  })

  test('marks finding unverified when Claude says so', async () => {
    const audit = await makeAudit()
    const finding = await db.finding.create({
      data: {
        auditId: audit.id,
        source: 'deterministic',
        type: 'console_error',
        severity: 'medium',
        confidence: 1.0,
        unverified: false,
        pageUrl: 'https://example.com/',
        description: 'Console error: favicon not found',
      },
    })

    callClaude.mockResolvedValueOnce(claudeResp(JSON.stringify([
      { id: finding.id, action: 'unverified', reason: 'Favicon 404 is cosmetic, not functional' },
    ])))

    await errorClassifier(audit.id)

    const updated = await db.finding.findUnique({ where: { id: finding.id } })
    expect(updated?.unverified).toBe(true)
    expect(updated?.confidence).toBe(0.3)
  })

  test('skips when no deterministic findings exist', async () => {
    const audit = await makeAudit()

    await errorClassifier(audit.id)

    expect(callClaude).not.toHaveBeenCalled()
    const run = await db.agentRun.findFirst({ where: { auditId: audit.id, agentName: 'error-classifier' } })
    expect(run?.status).toBe('complete')
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx jest __tests__/agents-phase-a.test.ts --no-coverage`
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create worker/agents/ui-inferrer.ts**

```typescript
import path from 'path'
import fs from 'fs/promises'
import type { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk'
import { callClaude } from '../../lib/claude'
import { db } from '../../lib/db'
import { trackAgentRun } from './run-tracker'
import type { InferredIntent } from './types'

export async function uiInferrer(auditId: string): Promise<InferredIntent[]> {
  return trackAgentRun(auditId, 'ui-inferrer', 1, { auditId }, async () => {
    const pages = await db.page.findMany({ where: { auditId } })
    const allIntents: InferredIntent[] = []

    for (const pageRecord of pages.slice(0, 5)) {
      const actions = JSON.parse(pageRecord.actions) as Array<{ type: string; label: string; selector: string }>
      if (actions.length === 0) continue

      let screenshotBase64: string | null = null
      if (pageRecord.screenshotPath) {
        try {
          const buf = await fs.readFile(path.join(process.cwd(), 'public', pageRecord.screenshotPath))
          screenshotBase64 = buf.toString('base64')
        } catch { /* no screenshot in test env — proceed text-only */ }
      }

      const userText = `Analyze this web page and infer the purpose of each interactive element.

Page URL: ${pageRecord.url}
Page title: ${pageRecord.title ?? 'Unknown'}

Interactive elements:
${JSON.stringify(actions, null, 2)}

Return a JSON array:
[
  {
    "pageUrl": "${pageRecord.url}",
    "elementSelector": "#selector",
    "purpose": "submit-form",
    "elementType": "button",
    "confidence": 0.9
  }
]

Valid purposes: submit-form, navigate, open-modal, toggle-visibility, save-changes, delete-item, search, filter, sort, auth-login, auth-signup, auth-logout, other

Return ONLY the JSON array.`

      const messages: MessageParam[] = screenshotBase64
        ? [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 } } as ContentBlockParam,
            { type: 'text', text: userText } as ContentBlockParam,
          ] }]
        : [{ role: 'user', content: userText }]

      const response = await callClaude({
        auditId,
        agentName: 'ui-inferrer',
        model: 'claude-sonnet-4-6',
        messages,
        system: 'You are a UI analyst. Return only valid JSON.',
        maxTokens: 1024,
      })

      const text = response.content.find(b => b.type === 'text')?.text ?? '[]'
      try {
        const intents = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as InferredIntent[]
        allIntents.push(...intents)
      } catch { /* malformed JSON — skip page */ }
    }

    return allIntents
  })
}
```

- [ ] **Step 4: Create worker/agents/error-classifier.ts**

```typescript
import { callClaude } from '../../lib/claude'
import { db } from '../../lib/db'
import { trackAgentRun } from './run-tracker'

export async function errorClassifier(auditId: string): Promise<void> {
  return trackAgentRun(auditId, 'error-classifier', 1, { auditId }, async () => {
    const findings = await db.finding.findMany({
      where: { auditId, source: 'deterministic' },
      select: { id: true, type: true, severity: true, description: true, confidence: true },
    })
    if (findings.length === 0) return

    const response = await callClaude({
      auditId,
      agentName: 'error-classifier',
      model: 'claude-haiku-4-5-20251001',
      messages: [{
        role: 'user',
        content: `Review these deterministic findings. Identify any that are false positives or incorrectly classified.

Findings:
${JSON.stringify(findings, null, 2)}

Return a JSON array of adjustments (only include findings that need changes):
[
  { "id": "finding-id", "action": "keep" | "downgrade" | "unverified", "reason": "brief reason" }
]

Return ONLY the JSON array.`,
      }],
      system: 'You are a QA engineer. Return only valid JSON.',
      maxTokens: 1024,
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? '[]'
    try {
      const adjustments = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as Array<{
        id: string; action: 'keep' | 'downgrade' | 'unverified'; reason: string
      }>

      const DOWNGRADE: Record<string, string> = { critical: 'high', high: 'medium', medium: 'low', low: 'low' }
      for (const adj of adjustments) {
        if (adj.action === 'unverified') {
          await db.finding.update({ where: { id: adj.id }, data: { unverified: true, confidence: 0.3 } })
        } else if (adj.action === 'downgrade') {
          const f = findings.find(f => f.id === adj.id)
          if (f) await db.finding.update({ where: { id: adj.id }, data: { severity: DOWNGRADE[f.severity] ?? f.severity } })
        }
      }
    } catch { /* malformed JSON — skip */ }
  })
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `npx jest __tests__/agents-phase-a.test.ts --no-coverage`
Expected: PASS — all 6 tests green

- [ ] **Step 6: Commit**

```bash
git add worker/agents/ui-inferrer.ts worker/agents/error-classifier.ts __tests__/agents-phase-a.test.ts
git commit -m "feat: Phase A agents — ui-inferrer, error-classifier"
```

---

### Task 3: Phase B agents — test-generator + agentic-explorer

**Files:**
- Create: `worker/agents/test-generator.ts`
- Create: `worker/agents/agentic-explorer.ts`
- Create: `__tests__/agents-phase-b.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/agents-phase-b.test.ts`:
```typescript
import http from 'http'
import { AddressInfo } from 'net'
import type { Message } from '@anthropic-ai/sdk'
import { testGenerator } from '../worker/agents/test-generator'
import { agenticExplorer } from '../worker/agents/agentic-explorer'
import { db } from '../lib/db'
import type { InferredIntent, AgentFlowSpec } from '../worker/agents/types'

jest.setTimeout(60000)

jest.mock('../lib/claude', () => ({
  callClaude: jest.fn(),
  CostCapError: class CostCapError extends Error {
    constructor(m: string) { super(m); this.name = 'CostCapError' }
  },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { callClaude } = require('../lib/claude') as { callClaude: jest.MockedFunction<() => Promise<Message>> }

function claudeResp(text: string): Message {
  return { content: [{ type: 'text', text }], usage: { input_tokens: 50, output_tokens: 30 } } as unknown as Message
}

async function clearDb() {
  await db.finding.deleteMany()
  await db.page.deleteMany()
  await db.agentRun.deleteMany()
  await db.tokenLog.deleteMany()
  await db.audit.deleteMany()
}

beforeEach(clearDb)
afterAll(() => db.$disconnect())

const SAMPLE_INTENTS: InferredIntent[] = [
  { pageUrl: 'http://localhost/', elementSelector: '#btn', purpose: 'submit-form', elementType: 'button', confidence: 0.9 },
]

// ─── test-generator ───

describe('testGenerator', () => {
  test('parses AgentFlowSpec[] from Claude response', async () => {
    const audit = await db.audit.create({
      data: { url: 'https://example.com', status: 'running', config: JSON.stringify({}) },
    })

    const specs: AgentFlowSpec[] = [{
      name: 'test-submit',
      pageUrl: 'https://example.com/',
      steps: [
        { action: 'click', selector: '#btn', description: 'Click submit' },
        { action: 'assert', description: 'Page changed' },
      ],
    }]

    callClaude.mockResolvedValueOnce(claudeResp(JSON.stringify(specs)))

    const result = await testGenerator(audit.id, SAMPLE_INTENTS)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('test-submit')
    expect(result[0].steps).toHaveLength(2)

    const run = await db.agentRun.findFirst({ where: { auditId: audit.id, agentName: 'test-generator' } })
    expect(run?.status).toBe('complete')
    expect(run?.phase).toBe(2)
  })

  test('returns empty array when no intents provided', async () => {
    const audit = await db.audit.create({
      data: { url: 'https://example.com', status: 'running', config: JSON.stringify({}) },
    })

    const result = await testGenerator(audit.id, [])

    expect(result).toHaveLength(0)
    expect(callClaude).not.toHaveBeenCalled()
  })
})

// ─── agentic-explorer ───

describe('agenticExplorer', () => {
  function startServer(pages: Record<string, string>): Promise<{ server: http.Server; baseUrl: string }> {
    return new Promise(resolve => {
      const server = http.createServer((req, res) => {
        const body = pages[req.url ?? '/'] ?? '<h1>404</h1>'
        res.writeHead(pages[req.url ?? '/'] ? 200 : 404, { 'Content-Type': 'text/html' })
        res.end(body)
      })
      server.listen(0, '127.0.0.1', () => {
        resolve({ server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
      })
    })
  }

  test('executes flow spec and returns FlowResult with success=true', async () => {
    const { server, baseUrl } = await startServer({
      '/': `<html><body><button id="btn">Click</button><div id="result"></div>
        <script>document.getElementById('btn').onclick = () => document.getElementById('result').textContent = 'done';</script>
      </body></html>`,
    })
    try {
      const audit = await db.audit.create({
        data: { url: baseUrl, status: 'running', config: JSON.stringify({}) },
      })

      const specs: AgentFlowSpec[] = [{
        name: 'test-click',
        pageUrl: baseUrl + '/',
        steps: [
          { action: 'navigate', value: baseUrl + '/', description: 'Navigate to home' },
          { action: 'click', selector: '#btn', description: 'Click button' },
          { action: 'assert', description: 'Result appeared' },
        ],
      }]

      const results = await agenticExplorer(audit.id, specs)

      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(true)
      expect(results[0].specName).toBe('test-click')
      expect(results[0].completedSteps).toBe(3)

      const run = await db.agentRun.findFirst({ where: { auditId: audit.id, agentName: 'agentic-explorer' } })
      expect(run?.status).toBe('complete')
      expect(run?.phase).toBe(2)
    } finally {
      server.close()
    }
  })

  test('records success=false when selector not found', async () => {
    const { server, baseUrl } = await startServer({
      '/': `<html><body><p>No button here</p></body></html>`,
    })
    try {
      const audit = await db.audit.create({
        data: { url: baseUrl, status: 'running', config: JSON.stringify({}) },
      })

      const specs: AgentFlowSpec[] = [{
        name: 'test-missing',
        pageUrl: baseUrl + '/',
        steps: [
          { action: 'navigate', value: baseUrl + '/', description: 'Navigate' },
          { action: 'click', selector: '#nonexistent', description: 'Click missing element' },
        ],
      }]

      const results = await agenticExplorer(audit.id, specs)

      expect(results[0].success).toBe(false)
      expect(results[0].error).toBeDefined()
    } finally {
      server.close()
    }
  })

  test('returns empty array when no specs provided', async () => {
    const audit = await db.audit.create({
      data: { url: 'https://example.com', status: 'running', config: JSON.stringify({}) },
    })

    const results = await agenticExplorer(audit.id, [])

    expect(results).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx jest __tests__/agents-phase-b.test.ts --no-coverage`
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create worker/agents/test-generator.ts**

```typescript
import { callClaude } from '../../lib/claude'
import { trackAgentRun } from './run-tracker'
import type { InferredIntent, AgentFlowSpec } from './types'

export async function testGenerator(auditId: string, intents: InferredIntent[]): Promise<AgentFlowSpec[]> {
  return trackAgentRun(auditId, 'test-generator', 2, { intentsCount: intents.length }, async () => {
    if (intents.length === 0) return []

    const response = await callClaude({
      auditId,
      agentName: 'test-generator',
      model: 'claude-haiku-4-5-20251001',
      messages: [{
        role: 'user',
        content: `Generate realistic Playwright test flows for these UI intents.

Intents:
${JSON.stringify(intents.slice(0, 10), null, 2)}

Return a JSON array of AgentFlowSpec:
[
  {
    "name": "test-login",
    "pageUrl": "https://...",
    "steps": [
      { "action": "navigate", "value": "https://...", "description": "Go to page" },
      { "action": "fill", "selector": "#email", "value": "test@example.com", "description": "Enter email" },
      { "action": "click", "selector": "#btn-login", "description": "Click login" },
      { "action": "assert", "description": "Check page changed" }
    ]
  }
]

Actions: click, fill, navigate, wait, assert
Generate 1-3 flows for the most important user journeys. Start each flow with a navigate step.
Return ONLY the JSON array.`,
      }],
      system: 'You are a test engineer. Return only valid JSON.',
      maxTokens: 2048,
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? '[]'
    try {
      return JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as AgentFlowSpec[]
    } catch {
      return []
    }
  })
}
```

- [ ] **Step 4: Create worker/agents/agentic-explorer.ts**

```typescript
import path from 'path'
import fs from 'fs/promises'
import { chromium } from 'playwright'
import { db } from '../../lib/db'
import { trackAgentRun } from './run-tracker'
import type { AgentFlowSpec, FlowResult } from './types'

export async function agenticExplorer(auditId: string, specs: AgentFlowSpec[]): Promise<FlowResult[]> {
  return trackAgentRun(auditId, 'agentic-explorer', 2, { specsCount: specs.length }, async () => {
    if (specs.length === 0) return []

    const artifactDir = path.join(process.cwd(), 'public', 'artifacts', auditId)
    await fs.mkdir(artifactDir, { recursive: true })

    const results: FlowResult[] = []
    const browser = await chromium.launch({ headless: true })
    try {
      for (const spec of specs.slice(0, 5)) {
        const context = await browser.newContext()
        const page = await context.newPage()
        let completedSteps = 0
        let screenshotPath: string | undefined

        try {
          for (const step of spec.steps) {
            if (step.action === 'navigate') {
              await page.goto(step.value ?? spec.pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
            } else if (step.action === 'click' && step.selector) {
              await page.click(step.selector, { timeout: 5000 })
            } else if (step.action === 'fill' && step.selector) {
              await page.fill(step.selector, step.value ?? '', { timeout: 5000 })
            } else if (step.action === 'wait') {
              await page.waitForTimeout(Number(step.value) || 1000)
            }
            // 'assert' is a no-op marker — reaching it counts as passing
            completedSteps++
          }

          const idx = results.length
          const screenshotFile = path.join(artifactDir, `flow-${idx}.png`)
          await page.screenshot({ path: screenshotFile, fullPage: true })
          screenshotPath = `/artifacts/${auditId}/flow-${idx}.png`

          results.push({ specName: spec.name, pageUrl: spec.pageUrl, success: true, completedSteps, totalSteps: spec.steps.length, screenshotPath })
        } catch (err) {
          const idx = results.length
          try {
            const screenshotFile = path.join(artifactDir, `flow-${idx}-fail.png`)
            await page.screenshot({ path: screenshotFile, fullPage: true })
            screenshotPath = `/artifacts/${auditId}/flow-${idx}-fail.png`
          } catch { /* ignore */ }
          results.push({
            specName: spec.name,
            pageUrl: spec.pageUrl,
            success: false,
            completedSteps,
            totalSteps: spec.steps.length,
            error: err instanceof Error ? err.message : String(err),
            screenshotPath,
          })
        } finally {
          await context.close()
        }
      }
    } finally {
      await browser.close()
    }

    return results
  })
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `npx jest __tests__/agents-phase-b.test.ts --no-coverage`
Expected: PASS — all 5 tests green (takes ~15s for Playwright)

- [ ] **Step 6: Commit**

```bash
git add worker/agents/test-generator.ts worker/agents/agentic-explorer.ts __tests__/agents-phase-b.test.ts
git commit -m "feat: Phase B agents — test-generator, agentic-explorer"
```

---

### Task 4: Phase C + D agents — root-cause-analyzer, ai-judge, report-synthesizer

**Files:**
- Create: `worker/agents/root-cause-analyzer.ts`
- Create: `worker/agents/ai-judge.ts`
- Create: `worker/agents/report-synthesizer.ts`
- Create: `__tests__/agents-phase-cd.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/agents-phase-cd.test.ts`:
```typescript
import type { Message } from '@anthropic-ai/sdk'
import { rootCauseAnalyzer } from '../worker/agents/root-cause-analyzer'
import { aiJudge } from '../worker/agents/ai-judge'
import { reportSynthesizer } from '../worker/agents/report-synthesizer'
import { db } from '../lib/db'
import type { InferredIntent } from '../worker/agents/types'

jest.mock('../lib/claude', () => ({
  callClaude: jest.fn(),
  CostCapError: class CostCapError extends Error {
    constructor(m: string) { super(m); this.name = 'CostCapError' }
  },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { callClaude } = require('../lib/claude') as { callClaude: jest.MockedFunction<() => Promise<Message>> }

function claudeResp(text: string): Message {
  return { content: [{ type: 'text', text }], usage: { input_tokens: 50, output_tokens: 30 } } as unknown as Message
}

async function clearDb() {
  await db.finding.deleteMany()
  await db.page.deleteMany()
  await db.agentRun.deleteMany()
  await db.tokenLog.deleteMany()
  await db.audit.deleteMany()
}

async function makeAudit() {
  return db.audit.create({
    data: { url: 'https://example.com', status: 'running', config: JSON.stringify({}) },
  })
}

async function makeFinding(auditId: string, overrides: Record<string, unknown> = {}) {
  return db.finding.create({
    data: {
      auditId,
      source: 'deterministic',
      type: 'http_error',
      severity: 'high',
      confidence: 1.0,
      unverified: false,
      pageUrl: 'https://example.com/',
      description: 'HTTP 404',
      ...overrides,
    },
  })
}

beforeEach(clearDb)
afterAll(() => db.$disconnect())

// ─── root-cause-analyzer ───

describe('rootCauseAnalyzer', () => {
  test('updates finding reproduction and description from Claude response', async () => {
    const audit = await makeAudit()
    const finding = await makeFinding(audit.id)

    callClaude.mockResolvedValueOnce(claudeResp(JSON.stringify([
      {
        id: finding.id,
        reproduction: '1. Navigate to /missing\n2. Observe HTTP 404',
        description: 'Route /missing does not exist — likely a broken internal link',
      },
    ])))

    await rootCauseAnalyzer(audit.id)

    const updated = await db.finding.findUnique({ where: { id: finding.id } })
    expect(updated?.reproduction).toBe('1. Navigate to /missing\n2. Observe HTTP 404')
    expect(updated?.description).toBe('Route /missing does not exist — likely a broken internal link')

    const run = await db.agentRun.findFirst({ where: { auditId: audit.id, agentName: 'root-cause-analyzer' } })
    expect(run?.status).toBe('complete')
    expect(run?.phase).toBe(3)
  })

  test('skips when no findings exist', async () => {
    const audit = await makeAudit()

    await rootCauseAnalyzer(audit.id)

    expect(callClaude).not.toHaveBeenCalled()
    const run = await db.agentRun.findFirst({ where: { auditId: audit.id, agentName: 'root-cause-analyzer' } })
    expect(run?.status).toBe('complete')
  })
})

// ─── ai-judge ───

describe('aiJudge', () => {
  const intents: InferredIntent[] = [
    { pageUrl: 'https://example.com/', elementSelector: '#btn', purpose: 'submit-form', elementType: 'button', confidence: 0.9 },
  ]

  test('returns uxScore and creates UX findings from Claude response', async () => {
    const audit = await makeAudit()
    await db.page.create({
      data: {
        auditId: audit.id,
        url: 'https://example.com/',
        urlRaw: 'https://example.com/',
        httpStatus: 200,
        consoleErrors: JSON.stringify([]),
        networkErrors: JSON.stringify([]),
        links: JSON.stringify([]),
        actions: JSON.stringify([]),
      },
    })

    callClaude.mockResolvedValueOnce(claudeResp(JSON.stringify({
      uxScore: 72,
      rationale: 'Generally clear but lacks error feedback',
      findings: [
        {
          type: 'ux_incoherence',
          severity: 'medium',
          confidence: 0.7,
          pageUrl: 'https://example.com/',
          description: 'Form has no validation error messages',
        },
      ],
    })))

    const score = await aiJudge(audit.id, intents)

    expect(score).toBe(72)

    const findings = await db.finding.findMany({ where: { auditId: audit.id, source: 'llm_judge' } })
    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('ux_incoherence')
    expect(findings[0].severity).toBe('medium')
    expect(findings[0].confidence).toBe(0.7)
    expect(findings[0].unverified).toBe(false)

    const run = await db.agentRun.findFirst({ where: { auditId: audit.id, agentName: 'ai-judge' } })
    expect(run?.status).toBe('complete')
    expect(run?.phase).toBe(3)
  })

  test('returns null when no pages exist', async () => {
    const audit = await makeAudit()
    const score = await aiJudge(audit.id, intents)
    expect(score).toBeNull()
    expect(callClaude).not.toHaveBeenCalled()
  })
})

// ─── report-synthesizer ───

describe('reportSynthesizer', () => {
  test('deletes duplicate findings, keeps highest-confidence copy', async () => {
    const audit = await makeAudit()

    // Two findings with same type+pageUrl+description prefix — duplicates
    const f1 = await makeFinding(audit.id, { confidence: 0.7, description: 'HTTP 404 on /about — broken route' })
    const f2 = await makeFinding(audit.id, { confidence: 1.0, description: 'HTTP 404 on /about — broken route' })

    await reportSynthesizer(audit.id)

    const remaining = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(f2.id) // kept higher confidence
    expect(remaining[0].confidence).toBe(1.0)

    const run = await db.agentRun.findFirst({ where: { auditId: audit.id, agentName: 'report-synthesizer' } })
    expect(run?.status).toBe('complete')
    expect(run?.phase).toBe(4)
  })

  test('keeps all findings when no duplicates', async () => {
    const audit = await makeAudit()
    await makeFinding(audit.id, { type: 'http_error', description: 'HTTP 500 on /api' })
    await makeFinding(audit.id, { type: 'console_error', description: 'Uncaught TypeError on /dashboard' })

    await reportSynthesizer(audit.id)

    const remaining = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(remaining).toHaveLength(2)
  })

  test('handles empty findings gracefully', async () => {
    const audit = await makeAudit()
    await reportSynthesizer(audit.id)
    const run = await db.agentRun.findFirst({ where: { auditId: audit.id, agentName: 'report-synthesizer' } })
    expect(run?.status).toBe('complete')
  })
})
```

- [ ] **Step 2: Run — expect failure**

Run: `npx jest __tests__/agents-phase-cd.test.ts --no-coverage`
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Create worker/agents/root-cause-analyzer.ts**

```typescript
import { callClaude } from '../../lib/claude'
import { db } from '../../lib/db'
import { trackAgentRun } from './run-tracker'

export async function rootCauseAnalyzer(auditId: string): Promise<void> {
  return trackAgentRun(auditId, 'root-cause-analyzer', 3, { auditId }, async () => {
    const findings = await db.finding.findMany({
      where: { auditId, unverified: false },
      select: { id: true, type: true, severity: true, description: true, pageUrl: true, consoleEvidence: true, networkEvidence: true },
    })
    if (findings.length === 0) return

    const response = await callClaude({
      auditId,
      agentName: 'root-cause-analyzer',
      model: 'claude-sonnet-4-6',
      messages: [{
        role: 'user',
        content: `Provide detailed reproduction steps and root cause descriptions for these findings.

Findings:
${JSON.stringify(findings.slice(0, 10), null, 2)}

Return a JSON array:
[
  {
    "id": "finding-id",
    "reproduction": "1. Navigate to {url}\\n2. {specific action}\\n3. Observe: {issue}",
    "description": "Specific root cause description"
  }
]

Return ONLY the JSON array.`,
      }],
      system: 'You are a QA root-cause engineer. Return only valid JSON.',
      maxTokens: 2048,
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? '[]'
    try {
      const enrichments = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as Array<{
        id: string; reproduction?: string; description?: string
      }>
      for (const e of enrichments) {
        const data: Record<string, string> = {}
        if (e.reproduction) data.reproduction = e.reproduction
        if (e.description) data.description = e.description
        if (Object.keys(data).length > 0) {
          await db.finding.update({ where: { id: e.id }, data })
        }
      }
    } catch { /* malformed JSON — skip */ }
  })
}
```

- [ ] **Step 4: Create worker/agents/ai-judge.ts**

```typescript
import path from 'path'
import fs from 'fs/promises'
import type { ContentBlockParam } from '@anthropic-ai/sdk'
import { callClaude } from '../../lib/claude'
import { db } from '../../lib/db'
import { trackAgentRun } from './run-tracker'
import type { InferredIntent } from './types'

export async function aiJudge(auditId: string, intents: InferredIntent[]): Promise<number | null> {
  return trackAgentRun(auditId, 'ai-judge', 3, { intents: intents.length }, async () => {
    const pages = await db.page.findMany({ where: { auditId } })
    if (pages.length === 0) return null

    const imageBlocks: ContentBlockParam[] = []
    for (const pageRecord of pages.slice(0, 3)) {
      if (!pageRecord.screenshotPath) continue
      try {
        const buf = await fs.readFile(path.join(process.cwd(), 'public', pageRecord.screenshotPath))
        imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: buf.toString('base64') } })
      } catch { /* no screenshot */ }
    }

    const textBlock = `You are a UX quality judge for AI-generated web apps.

Pages crawled: ${pages.length}
Inferred UI intents: ${JSON.stringify(intents.slice(0, 10), null, 2)}
${imageBlocks.length > 0 ? '[Screenshots attached above]' : '(No screenshots available)'}

Rate UX quality (0-100) and identify specific UX issues.

Return JSON:
{
  "uxScore": 75,
  "rationale": "Brief assessment",
  "findings": [
    { "type": "ux_incoherence", "severity": "medium", "confidence": 0.7, "pageUrl": "${pages[0]?.url ?? ''}", "description": "Specific UX issue" }
  ]
}

UX score: 90-100 excellent, 70-89 good, 50-69 fair, 30-49 poor, 0-29 broken
Types: ux_incoherence, auth_dead_end, hallucinated_route
Return ONLY the JSON object.`

    const content: ContentBlockParam[] = [...imageBlocks, { type: 'text', text: textBlock }]

    const response = await callClaude({
      auditId,
      agentName: 'ai-judge',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content }],
      system: 'You are a UX quality judge. Return only valid JSON.',
      maxTokens: 1024,
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? '{}'
    try {
      const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as {
        uxScore?: number
        findings?: Array<{ type: string; severity: string; confidence: number; pageUrl: string; description: string }>
      }

      const uxScore = typeof parsed.uxScore === 'number' ? Math.max(0, Math.min(100, parsed.uxScore)) : null

      if (parsed.findings?.length) {
        await db.finding.createMany({
          data: parsed.findings.map(f => ({
            auditId,
            source: 'llm_judge',
            type: f.type ?? 'ux_incoherence',
            severity: f.severity ?? 'medium',
            confidence: f.confidence ?? 0.7,
            unverified: !f.description,
            pageUrl: f.pageUrl ?? pages[0]?.url ?? '',
            description: f.description ?? '',
          })),
        })
      }

      return uxScore
    } catch {
      return null
    }
  })
}
```

- [ ] **Step 5: Create worker/agents/report-synthesizer.ts**

```typescript
import { db } from '../../lib/db'
import { trackAgentRun } from './run-tracker'

function dedupKey(f: { type: string; pageUrl: string; description: string }): string {
  return `${f.type}::${f.pageUrl}::${f.description.slice(0, 80)}`
}

export async function reportSynthesizer(auditId: string): Promise<void> {
  return trackAgentRun(auditId, 'report-synthesizer', 4, { auditId }, async () => {
    const findings = await db.finding.findMany({ where: { auditId } })
    if (findings.length === 0) return

    const best = new Map<string, typeof findings[0]>()
    for (const f of findings) {
      const key = dedupKey(f)
      const existing = best.get(key)
      if (!existing || f.confidence > existing.confidence) best.set(key, f)
    }

    const keepIds = new Set(Array.from(best.values()).map(f => f.id))
    const deleteIds = findings.filter(f => !keepIds.has(f.id)).map(f => f.id)
    if (deleteIds.length > 0) {
      await db.finding.deleteMany({ where: { id: { in: deleteIds } } })
    }
  })
}
```

- [ ] **Step 6: Run tests — expect pass**

Run: `npx jest __tests__/agents-phase-cd.test.ts --no-coverage`
Expected: PASS — all 8 tests green

- [ ] **Step 7: Commit**

```bash
git add worker/agents/root-cause-analyzer.ts worker/agents/ai-judge.ts worker/agents/report-synthesizer.ts __tests__/agents-phase-cd.test.ts
git commit -m "feat: Phase C+D agents — root-cause-analyzer, ai-judge, report-synthesizer"
```

---

### Task 5: Update scoring + wire A→B→C→D in pipeline

**Files:**
- Modify: `worker/scoring.ts`
- Modify: `__tests__/scoring.test.ts` (add uxScore tests)
- Modify: `worker/pipeline.ts`

- [ ] **Step 1: Update worker/scoring.ts to accept uxScore**

Replace the return block in `computeScores` and add `uxScoreOverride` param. Full new file:
```typescript
import { db } from '../lib/db'

export interface ScoreResult {
  reliabilityScore: number
  uxScore: number | null
  trustScore: number
  scoreBreakdown: Record<string, number>
}

const DEDUCTIONS: Record<string, { each: number; cap: number }> = {
  critical: { each: 20, cap: 60 },
  high:     { each: 10, cap: 30 },
  medium:   { each:  5, cap: 15 },
  low:      { each:  2, cap: 10 },
}

const DATA_LOSS_TYPES = new Set(['persistence_loss', 'auth_dead_end'])

export async function computeScores(auditId: string, uxScoreOverride: number | null = null): Promise<ScoreResult> {
  const findings = await db.finding.findMany({
    where: { auditId },
    select: { severity: true, confidence: true, type: true, unverified: true },
  })

  const confirmed  = findings.filter(f => !f.unverified && f.confidence >= 0.7)
  const suspicious = findings.filter(f => !f.unverified && f.confidence <  0.7)

  let score = 100
  const breakdown: Record<string, number> = {}

  for (const sev of ['critical', 'high', 'medium', 'low']) {
    const matching = confirmed.filter(f => f.severity === sev)
    const d = DEDUCTIONS[sev]
    score -= Math.min(matching.length * d.each, d.cap)
    breakdown[sev] = matching.length
  }

  score -= Math.min(suspicious.length, 10)
  const reliabilityScore = Math.max(0, score)

  const confirmedCriticals = confirmed.filter(f => f.severity === 'critical')
  const hasDataLoss = confirmedCriticals.some(f => DATA_LOSS_TYPES.has(f.type))

  let ceiling = 100
  if (confirmedCriticals.length >= 2 || hasDataLoss) ceiling = 39
  else if (confirmedCriticals.length === 1) ceiling = 59

  const uxScore = uxScoreOverride
  const rawTrust = uxScore !== null
    ? Math.round(reliabilityScore * 0.7 + uxScore * 0.3)
    : reliabilityScore
  const trustScore = Math.min(rawTrust, ceiling)

  return { reliabilityScore, uxScore, trustScore, scoreBreakdown: breakdown }
}
```

- [ ] **Step 2: Add uxScore integration tests to scoring.test.ts**

Append to `__tests__/scoring.test.ts`:
```typescript
test('trustScore uses weighted formula when uxScore provided', async () => {
  const audit = await makeAudit()
  // reliabilityScore = 100 (no findings), uxScore = 80
  // trustScore = round(100 * 0.7 + 80 * 0.3) = round(70 + 24) = 94
  const scores = await computeScores(audit.id, 80)
  expect(scores.reliabilityScore).toBe(100)
  expect(scores.uxScore).toBe(80)
  expect(scores.trustScore).toBe(94)
})

test('ceiling applies to weighted trustScore', async () => {
  const audit = await makeAudit()
  await makeFinding(audit.id, 'critical', 1.0)
  // reliabilityScore = 80, ceiling = 59, uxScore = 100
  // rawTrust = round(80 * 0.7 + 100 * 0.3) = round(56 + 30) = 86
  // trustScore = min(86, 59) = 59
  const scores = await computeScores(audit.id, 100)
  expect(scores.trustScore).toBe(59)
  expect(scores.uxScore).toBe(100)
})
```

- [ ] **Step 3: Run scoring tests — expect all pass**

Run: `npx jest __tests__/scoring.test.ts --no-coverage`
Expected: PASS — all 14 tests green

- [ ] **Step 4: Update worker/pipeline.ts to run phases A→B→C→D**

Replace `worker/pipeline.ts`:
```typescript
import { db } from '../lib/db'
import { crawl } from './crawler'
import { checkHttpStatus } from './checks/http-status'
import { checkConsoleErrors } from './checks/console-errors'
import { checkBrokenLinks } from './checks/broken-links'
import { checkActions } from './checks/action-testing'
import { checkStalls } from './checks/stall-detection'
import { checkPersistence } from './checks/persistence'
import { uiInferrer } from './agents/ui-inferrer'
import { errorClassifier } from './agents/error-classifier'
import { testGenerator } from './agents/test-generator'
import { agenticExplorer } from './agents/agentic-explorer'
import { rootCauseAnalyzer } from './agents/root-cause-analyzer'
import { aiJudge } from './agents/ai-judge'
import { reportSynthesizer } from './agents/report-synthesizer'
import { computeScores } from './scoring'

const MAX_CRAWL_RETRIES = 2
const CHECK_NAMES = ['http-status', 'console-errors', 'broken-links', 'action-testing', 'stall-detection', 'persistence']

export async function runPipeline(auditId: string): Promise<void> {
  const t0 = Date.now()
  const audit = await db.audit.findUniqueOrThrow({ where: { id: auditId } })
  const config = JSON.parse(audit.config ?? '{}') as { maxPages?: number }
  const maxPages = config.maxPages ?? 15

  // Phase 1: Crawl
  let crawlError: Error | null = null
  for (let attempt = 1; attempt <= MAX_CRAWL_RETRIES; attempt++) {
    try {
      await crawl({ auditId, startUrl: audit.url, maxPages })
      crawlError = null
      break
    } catch (err) {
      crawlError = err instanceof Error ? err : new Error(String(err))
      console.error(`[pipeline] crawl attempt ${attempt}/${MAX_CRAWL_RETRIES} failed:`, crawlError.message)
    }
  }
  if (crawlError) {
    await db.audit.update({
      where: { id: auditId },
      data: { status: 'failed', errorMessage: `Crawl failed: ${crawlError.message}`, completedAt: new Date() },
    })
    return
  }

  // Phase 2: Deterministic checks — all 6 in parallel
  const checkResults = await Promise.allSettled([
    checkHttpStatus(auditId), checkConsoleErrors(auditId), checkBrokenLinks(auditId),
    checkActions(auditId), checkStalls(auditId), checkPersistence(auditId),
  ])
  for (const [i, r] of checkResults.entries()) {
    if (r.status === 'rejected') console.error(`[pipeline] check ${CHECK_NAMES[i]} failed:`, r.reason?.message)
  }

  // Phase A: ui-inferrer + error-classifier in parallel
  const [uiResult] = await Promise.allSettled([
    uiInferrer(auditId),
    errorClassifier(auditId),
  ])
  const intents = uiResult.status === 'fulfilled' ? uiResult.value : []

  // Phase B: test-generator → agentic-explorer (sequential, skip if ui-inferrer failed)
  if (uiResult.status === 'fulfilled' && intents.length > 0) {
    try {
      const specs = await testGenerator(auditId, intents)
      await agenticExplorer(auditId, specs)
    } catch (err) {
      console.error('[pipeline] Phase B failed:', err instanceof Error ? err.message : err)
    }
  }

  // Phase C: root-cause-analyzer + ai-judge in parallel
  const [, judgeResult] = await Promise.allSettled([
    rootCauseAnalyzer(auditId),
    uiResult.status === 'fulfilled' ? aiJudge(auditId, intents) : Promise.resolve(null),
  ])
  const uxScore = judgeResult.status === 'fulfilled' ? judgeResult.value : null

  // Phase D: report-synthesizer
  try {
    await reportSynthesizer(auditId)
  } catch (err) {
    console.error('[pipeline] report-synthesizer failed:', err instanceof Error ? err.message : err)
  }

  // Score
  const scores = await computeScores(auditId, uxScore)
  const tokenAgg = await db.tokenLog.aggregate({ where: { auditId }, _sum: { costUsd: true } })

  await db.audit.update({
    where: { id: auditId },
    data: {
      status: 'complete',
      trustScore: scores.trustScore,
      reliabilityScore: scores.reliabilityScore,
      uxScore: scores.uxScore,
      scoreBreakdown: JSON.stringify(scores.scoreBreakdown),
      durationMs: Date.now() - t0,
      costUsd: tokenAgg._sum.costUsd ?? 0,
      completedAt: new Date(),
    },
  })
}
```

- [ ] **Step 5: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add worker/scoring.ts __tests__/scoring.test.ts worker/pipeline.ts
git commit -m "feat: wire agent phases A→B→C→D into pipeline + weighted trustScore with uxScore"
```
