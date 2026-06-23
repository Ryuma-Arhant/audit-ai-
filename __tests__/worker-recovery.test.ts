import { db } from '../lib/db'

async function clearDb() {
  await db.tokenLog.deleteMany()
  await db.agentRun.deleteMany()
  await db.finding.deleteMany()
  await db.page.deleteMany()
  await db.audit.deleteMany()
}

beforeEach(clearDb)
afterAll(() => db.$disconnect())

// Mirrors the crash-recovery block in worker/index.ts
async function recoverStuckAudits() {
  return db.audit.updateMany({
    where: { status: 'running' },
    data: { status: 'failed', errorMessage: 'Worker restarted — audit did not complete', completedAt: new Date() },
  })
}

describe('worker crash recovery', () => {
  test('resets running audits to failed on restart', async () => {
    await db.audit.createMany({
      data: [
        { url: 'https://a.com', status: 'running', config: '{}' },
        { url: 'https://b.com', status: 'running', config: '{}' },
      ],
    })

    const result = await recoverStuckAudits()
    expect(result.count).toBe(2)

    const audits = await db.audit.findMany()
    for (const a of audits) {
      expect(a.status).toBe('failed')
      expect(a.errorMessage).toBe('Worker restarted — audit did not complete')
      expect(a.completedAt).not.toBeNull()
    }
  })

  test('leaves queued and complete audits untouched', async () => {
    await db.audit.create({ data: { url: 'https://q.com', status: 'queued',   config: '{}' } })
    await db.audit.create({ data: { url: 'https://c.com', status: 'complete', config: '{}' } })
    await db.audit.create({ data: { url: 'https://f.com', status: 'failed',   config: '{}' } })

    const result = await recoverStuckAudits()
    expect(result.count).toBe(0)

    const statuses = (await db.audit.findMany()).map(a => a.status)
    expect(statuses).toContain('queued')
    expect(statuses).toContain('complete')
    expect(statuses).toContain('failed')
  })

  test('handles empty database gracefully', async () => {
    const result = await recoverStuckAudits()
    expect(result.count).toBe(0)
  })

  test('recovery does not affect queue ordering for queued audits', async () => {
    const queued = await db.audit.create({ data: { url: 'https://q.com', status: 'queued', config: '{}' } })
    await db.audit.create({ data: { url: 'https://r.com', status: 'running', config: '{}' } })

    await recoverStuckAudits()

    const q = await db.audit.findUnique({ where: { id: queued.id } })
    expect(q?.status).toBe('queued')
  })
})
