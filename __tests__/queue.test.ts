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
    data: { url: 'https://example.com', status: 'queued', config: JSON.stringify({}) },
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
    data: { url: 'https://example.com', status: 'running', config: JSON.stringify({}) },
  })
  const q = new SQLiteQueue()
  expect(await q.dequeue()).toBeNull()
})

test('dequeue returns oldest queued audit first', async () => {
  const first = await db.audit.create({
    data: { url: 'https://first.com', status: 'queued', config: JSON.stringify({}) },
  })
  await db.audit.create({
    data: { url: 'https://second.com', status: 'queued', config: JSON.stringify({}) },
  })
  const q = new SQLiteQueue()
  const id = await q.dequeue()
  expect(id).toBe(first.id)
})

test('concurrent dequeue on a single queued audit returns distinct results', async () => {
  const audit = await db.audit.create({
    data: { url: 'https://example.com', status: 'queued', config: JSON.stringify({}) },
  })
  const q = new SQLiteQueue()

  const [a, b] = await Promise.all([q.dequeue(), q.dequeue()])

  // Exactly one caller claims the audit; the other gets null.
  const results = [a, b]
  expect(results).toContain(audit.id)
  expect(results).toContain(null)
  expect(a).not.toBe(b)

  const updated = await db.audit.findUnique({ where: { id: audit.id } })
  expect(updated?.status).toBe('running')
})

test('fail sets status to failed with errorMessage and completedAt', async () => {
  const audit = await db.audit.create({
    data: { url: 'https://example.com', status: 'running', config: JSON.stringify({}) },
  })
  const q = new SQLiteQueue()
  await q.fail(audit.id, 'crawl timed out')
  const updated = await db.audit.findUnique({ where: { id: audit.id } })
  expect(updated?.status).toBe('failed')
  expect(updated?.errorMessage).toBe('crawl timed out')
  expect(updated?.completedAt).not.toBeNull()
})
