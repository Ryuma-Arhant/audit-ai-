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
    expect(JSON.parse(stored?.config as string)).toMatchObject({ maxPages: 15, costLimitUsd: 0.50 })
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
        config: JSON.stringify({}),
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
