import Anthropic from '@anthropic-ai/sdk'
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
const { callClaude } = require('../lib/claude') as { callClaude: jest.MockedFunction<() => Promise<Anthropic.Message>> }

function claudeResp(text: string): Anthropic.Message {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 50 },
  } as unknown as Anthropic.Message
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

beforeEach(async () => {
  jest.clearAllMocks()
  await clearDb()
})
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
