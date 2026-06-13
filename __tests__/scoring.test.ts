import { computeScores } from '../worker/scoring'
import { db } from '../lib/db'

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

async function makeFinding(
  auditId: string,
  severity: string,
  confidence: number,
  type = 'http_error'
) {
  return db.finding.create({
    data: {
      auditId,
      source: 'deterministic',
      type,
      severity,
      confidence,
      unverified: false,
      pageUrl: 'https://example.com/',
      description: `Test finding: ${severity}`,
    },
  })
}

beforeEach(clearDb)
afterAll(() => db.$disconnect())

test('returns 100 with no findings', async () => {
  const audit = await makeAudit()
  const scores = await computeScores(audit.id)
  expect(scores.reliabilityScore).toBe(100)
  expect(scores.trustScore).toBe(100)
  expect(scores.uxScore).toBeNull()
})

test('deducts 20 per critical confirmed finding', async () => {
  const audit = await makeAudit()
  await makeFinding(audit.id, 'critical', 1.0)
  const scores = await computeScores(audit.id)
  expect(scores.reliabilityScore).toBe(80)
})

test('caps critical deduction at -60', async () => {
  const audit = await makeAudit()
  for (let i = 0; i < 4; i++) await makeFinding(audit.id, 'critical', 1.0)
  const scores = await computeScores(audit.id)
  expect(scores.reliabilityScore).toBe(40)
})

test('deducts 10 per high confirmed finding, cap -30', async () => {
  const audit = await makeAudit()
  for (let i = 0; i < 4; i++) await makeFinding(audit.id, 'high', 1.0)
  const scores = await computeScores(audit.id)
  expect(scores.reliabilityScore).toBe(70)
})

test('deducts 5 per medium confirmed, cap -15', async () => {
  const audit = await makeAudit()
  for (let i = 0; i < 4; i++) await makeFinding(audit.id, 'medium', 1.0)
  const scores = await computeScores(audit.id)
  expect(scores.reliabilityScore).toBe(85)
})

test('score floor is 0', async () => {
  const audit = await makeAudit()
  // caps: critical -60, high -30, medium -15 = -105 total → floor at 0
  for (let i = 0; i < 5; i++) await makeFinding(audit.id, 'critical', 1.0)
  for (let i = 0; i < 3; i++) await makeFinding(audit.id, 'high', 1.0)
  for (let i = 0; i < 3; i++) await makeFinding(audit.id, 'medium', 1.0)
  const scores = await computeScores(audit.id)
  expect(scores.reliabilityScore).toBe(0)
})

test('ceiling 59 with 1 confirmed critical', async () => {
  const audit = await makeAudit()
  await makeFinding(audit.id, 'critical', 1.0)
  const scores = await computeScores(audit.id)
  // raw = 80, ceiling = 59
  expect(scores.trustScore).toBe(59)
})

test('ceiling 39 with 2+ confirmed criticals', async () => {
  const audit = await makeAudit()
  await makeFinding(audit.id, 'critical', 1.0)
  await makeFinding(audit.id, 'critical', 1.0)
  const scores = await computeScores(audit.id)
  expect(scores.trustScore).toBe(39)
})

test('ceiling 39 for data-loss finding regardless of count', async () => {
  const audit = await makeAudit()
  await makeFinding(audit.id, 'critical', 1.0, 'persistence_loss')
  const scores = await computeScores(audit.id)
  expect(scores.trustScore).toBe(39)
})

test('suspicious findings (confidence < 0.7) deduct 1 each, max 10', async () => {
  const audit = await makeAudit()
  for (let i = 0; i < 15; i++) await makeFinding(audit.id, 'high', 0.5)
  const scores = await computeScores(audit.id)
  expect(scores.reliabilityScore).toBe(90)
})

test('unverified findings are excluded from score', async () => {
  const audit = await makeAudit()
  await db.finding.create({
    data: {
      auditId: audit.id,
      source: 'llm_judge',
      type: 'ux_incoherence',
      severity: 'critical',
      confidence: 0.3,
      unverified: true,
      pageUrl: 'https://example.com/',
      description: 'Unverified finding',
    },
  })
  const scores = await computeScores(audit.id)
  expect(scores.reliabilityScore).toBe(100)
})

test('trustScore equals reliabilityScore when uxScore is null', async () => {
  const audit = await makeAudit()
  await makeFinding(audit.id, 'high', 1.0)
  const scores = await computeScores(audit.id)
  expect(scores.trustScore).toBe(scores.reliabilityScore)
  expect(scores.uxScore).toBeNull()
})
