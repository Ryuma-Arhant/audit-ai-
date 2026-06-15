import { callClaude, CostCapError, MODEL_FAST } from '@/lib/claude'
import { parseConfig } from '@/lib/config'
import { db } from '@/lib/db'

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({
      content: 'response',
      usage_metadata: { input_tokens: 100, output_tokens: 50 },
    }),
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
      config: JSON.stringify({ costLimitUsd: 0.50 }),
    },
  })
  auditId = audit.id
})

afterAll(() => db.$disconnect())

test('callClaude returns the message response', async () => {
  const result = await callClaude({
    auditId,
    agentName: 'test-agent',
    model: MODEL_FAST,
    messages: [{ role: 'user', content: 'hello' }],
  })
  expect(result.content[0]).toMatchObject({ type: 'text', text: 'response' })
})

test('callClaude writes a TokenLog row with correct cost', async () => {
  await callClaude({
    auditId,
    agentName: 'test-agent',
    model: MODEL_FAST,
    messages: [{ role: 'user', content: 'hello' }],
  })
  const logs = await db.tokenLog.findMany({ where: { auditId } })
  expect(logs).toHaveLength(1)
  expect(logs[0].inputTokens).toBe(100)
  expect(logs[0].outputTokens).toBe(50)
  expect(logs[0].agentName).toBe('test-agent')
  // nemotron-550b: (100/1M * 8.0) + (50/1M * 8.0) = 0.0008 + 0.0004 = 0.0012
  expect(logs[0].costUsd).toBeCloseTo(0.0012, 5)
})

test('callClaude throws CostCapError when accumulated cost exceeds limit', async () => {
  await db.audit.update({
    where: { id: auditId },
    data: { config: JSON.stringify({ costLimitUsd: 0.0001 }) },
  })
  await db.tokenLog.create({
    data: {
      auditId,
      agentName: 'prev',
      model: MODEL_FAST,
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: 0.001, // already over limit
    },
  })
  await expect(
    callClaude({
      auditId,
      agentName: 'test-agent',
      model: MODEL_FAST,
      messages: [{ role: 'user', content: 'hello' }],
    })
  ).rejects.toThrow(CostCapError)
})

test('parseConfig returns {} on malformed JSON', () => {
  expect(parseConfig('{bad')).toEqual({})
  expect(parseConfig(null)).toEqual({})
  expect(parseConfig(undefined)).toEqual({})
  expect(parseConfig('{"key": 1}')).toEqual({ key: 1 })
})
