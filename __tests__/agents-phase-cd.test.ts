import Anthropic from '@anthropic-ai/sdk'
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
const { callClaude } = require('../lib/claude') as { callClaude: jest.MockedFunction<() => Promise<Anthropic.Message>> }

function claudeResp(text: string): Anthropic.Message {
  return { content: [{ type: 'text', text }], usage: { input_tokens: 50, output_tokens: 30 } } as unknown as Anthropic.Message
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

beforeEach(async () => {
  jest.clearAllMocks()
  await clearDb()
})
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

    const f1 = await makeFinding(audit.id, { confidence: 0.7, description: 'HTTP 404 on /about — broken route' })
    const f2 = await makeFinding(audit.id, { confidence: 1.0, description: 'HTTP 404 on /about — broken route' })

    await reportSynthesizer(audit.id)

    const remaining = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(f2.id)
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
