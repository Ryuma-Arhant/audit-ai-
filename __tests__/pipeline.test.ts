import { runPipeline } from '../worker/pipeline'
import { db } from '../lib/db'

// Mock every heavy dependency so pipeline runs in-process with no I/O
jest.mock('../worker/crawler', () => ({ crawl: jest.fn() }))
jest.mock('../worker/checks/http-status',   () => ({ checkHttpStatus:  jest.fn() }))
jest.mock('../worker/checks/console-errors', () => ({ checkConsoleErrors: jest.fn() }))
jest.mock('../worker/checks/broken-links',   () => ({ checkBrokenLinks:  jest.fn() }))
jest.mock('../worker/checks/action-testing', () => ({ checkActions:      jest.fn() }))
jest.mock('../worker/checks/stall-detection',() => ({ checkStalls:       jest.fn() }))
jest.mock('../worker/checks/persistence',    () => ({ checkPersistence:  jest.fn() }))
jest.mock('../worker/agents/ui-inferrer',    () => ({ uiInferrer:        jest.fn() }))
jest.mock('../worker/agents/error-classifier',  () => ({ errorClassifier:   jest.fn() }))
jest.mock('../worker/agents/test-generator',    () => ({ testGenerator:     jest.fn() }))
jest.mock('../worker/agents/agentic-explorer',  () => ({ agenticExplorer:   jest.fn() }))
jest.mock('../worker/agents/root-cause-analyzer',() => ({ rootCauseAnalyzer: jest.fn() }))
jest.mock('../worker/agents/ai-judge',          () => ({ aiJudge:           jest.fn() }))
jest.mock('../worker/agents/report-synthesizer',() => ({ reportSynthesizer: jest.fn() }))
jest.mock('../worker/scoring', () => ({
  computeScores: jest.fn().mockResolvedValue({
    trustScore: 82,
    reliabilityScore: 78,
    uxScore: 90,
    scoreBreakdown: { critical: 0, high: 1, medium: 0, low: 0 },
  }),
}))
jest.mock('../lib/claude', () => ({ clearAuditCostCache: jest.fn() }))
jest.mock('../lib/logger', () => {
  const l = { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
  return { __esModule: true, default: l }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { crawl }          = require('../worker/crawler')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { uiInferrer }     = require('../worker/agents/ui-inferrer')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { testGenerator }  = require('../worker/agents/test-generator')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { agenticExplorer }= require('../worker/agents/agentic-explorer')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { aiJudge }        = require('../worker/agents/ai-judge')

async function clearDb() {
  await db.tokenLog.deleteMany()
  await db.agentRun.deleteMany()
  await db.finding.deleteMany()
  await db.page.deleteMany()
  await db.audit.deleteMany()
}

async function makeAudit(overrides: Record<string, unknown> = {}) {
  return db.audit.create({
    data: { url: 'https://example.com', status: 'running', config: JSON.stringify({}), ...overrides },
  })
}

beforeEach(async () => {
  jest.clearAllMocks()
  await clearDb()
})
afterAll(() => db.$disconnect())

describe('runPipeline — happy path', () => {
  test('marks audit complete with scores when all phases succeed', async () => {
    const audit = await makeAudit()
    crawl.mockResolvedValue(undefined)
    uiInferrer.mockResolvedValue([
      { pageUrl: 'https://example.com/', elementSelector: '#btn', purpose: 'submit-form', elementType: 'button', confidence: 0.9 },
    ])
    testGenerator.mockResolvedValue([])
    agenticExplorer.mockResolvedValue([])
    aiJudge.mockResolvedValue(90)

    await runPipeline(audit.id)

    const updated = await db.audit.findUnique({ where: { id: audit.id } })
    expect(updated?.status).toBe('complete')
    expect(updated?.trustScore).toBe(82)
    expect(updated?.reliabilityScore).toBe(78)
    expect(updated?.uxScore).toBe(90)
    expect(updated?.completedAt).not.toBeNull()
    expect(updated?.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('Phase B runs when uiInferrer returns intents', async () => {
    const audit = await makeAudit()
    crawl.mockResolvedValue(undefined)
    uiInferrer.mockResolvedValue([
      { pageUrl: 'https://example.com/', elementSelector: '#btn', purpose: 'submit-form', elementType: 'button', confidence: 0.9 },
    ])
    testGenerator.mockResolvedValue([{ name: 'flow', pageUrl: 'https://example.com/', steps: [] }])
    agenticExplorer.mockResolvedValue([])
    aiJudge.mockResolvedValue(75)

    await runPipeline(audit.id)

    expect(testGenerator).toHaveBeenCalledTimes(1)
    expect(agenticExplorer).toHaveBeenCalledTimes(1)
  })
})

describe('runPipeline — crawl failure', () => {
  test('marks audit failed after MAX_CRAWL_RETRIES (2)', async () => {
    const audit = await makeAudit()
    crawl.mockRejectedValue(new Error('Timeout 30000ms exceeded'))

    await runPipeline(audit.id)

    const updated = await db.audit.findUnique({ where: { id: audit.id } })
    expect(updated?.status).toBe('failed')
    expect(updated?.errorMessage).toContain('Crawl failed')
    expect(updated?.errorMessage).toContain('Timeout')
    expect(updated?.completedAt).not.toBeNull()
    // crawl must have been retried exactly MAX_CRAWL_RETRIES (2) times
    expect(crawl).toHaveBeenCalledTimes(2)
  })

  test('succeeds if crawl fails once then succeeds on retry', async () => {
    const audit = await makeAudit()
    crawl
      .mockRejectedValueOnce(new Error('cold-start timeout'))
      .mockResolvedValueOnce(undefined)
    uiInferrer.mockResolvedValue([])
    aiJudge.mockResolvedValue(null)

    await runPipeline(audit.id)

    expect(crawl).toHaveBeenCalledTimes(2)
    const updated = await db.audit.findUnique({ where: { id: audit.id } })
    expect(updated?.status).toBe('complete')
  })
})

describe('runPipeline — Phase B skip', () => {
  test('skips testGenerator and agenticExplorer when uiInferrer returns no intents', async () => {
    const audit = await makeAudit()
    crawl.mockResolvedValue(undefined)
    uiInferrer.mockResolvedValue([])
    aiJudge.mockResolvedValue(null)

    await runPipeline(audit.id)

    expect(testGenerator).not.toHaveBeenCalled()
    expect(agenticExplorer).not.toHaveBeenCalled()
    const updated = await db.audit.findUnique({ where: { id: audit.id } })
    expect(updated?.status).toBe('complete')
  })

  test('skips Phase B when uiInferrer throws', async () => {
    const audit = await makeAudit()
    crawl.mockResolvedValue(undefined)
    uiInferrer.mockRejectedValue(new Error('LLM error'))
    aiJudge.mockResolvedValue(null)

    await runPipeline(audit.id)

    expect(testGenerator).not.toHaveBeenCalled()
    expect(agenticExplorer).not.toHaveBeenCalled()
    const updated = await db.audit.findUnique({ where: { id: audit.id } })
    // Pipeline continues to completion despite uiInferrer failure
    expect(updated?.status).toBe('complete')
  })
})
