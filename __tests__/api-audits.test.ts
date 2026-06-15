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

  describe('SSRF protection', () => {
    const blocked = [
      'http://localhost/',
      'http://LOCALHOST/',
      'http://127.0.0.1/',
      'http://127.1.2.3/',
      'http://10.0.0.1/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://172.20.5.5/',
      'http://172.31.255.255/',
      'http://169.254.169.254/latest/meta-data/', // AWS metadata
      'http://[::1]/',
      'file:///etc/passwd',
      'ftp://example.com/',
    ]

    test.each(blocked)('blocks %s with 400 and does not create audit', async (url) => {
      const req = new Request('http://localhost/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const res = await POST(req)
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBeDefined()
      expect(await db.audit.count()).toBe(0)
    })

    const allowed = [
      'https://example.com',
      'http://example.com/path',
      'https://172.15.0.1/',  // just outside private class B range
      'https://172.32.0.1/',  // just outside private class B range
    ]

    test.each(allowed)('allows public URL %s', async (url) => {
      const req = new Request('http://localhost/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const res = await POST(req)
      expect(res.status).toBe(200)
    })
  })
})

describe('API key authentication', () => {
  // lib/auth.ts reads PROMPTPROOF_API_KEY at module load time, so we must set
  // the env var and re-import the route module in an isolated module registry.
  const ORIGINAL_KEY = process.env.PROMPTPROOF_API_KEY

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.PROMPTPROOF_API_KEY
    } else {
      process.env.PROMPTPROOF_API_KEY = ORIGINAL_KEY
    }
  })

  async function loadRoute() {
    let mod: typeof import('@/app/api/audits/route')
    await jest.isolateModulesAsync(async () => {
      mod = await import('@/app/api/audits/route')
    })
    return mod!
  }

  test('GET returns 401 when API key is set and no header provided', async () => {
    process.env.PROMPTPROOF_API_KEY = 'test-key'
    const { GET: GuardedGet } = await loadRoute()
    const req = new Request('http://localhost/api/audits')
    const res = await GuardedGet(req)
    expect(res.status).toBe(401)
  })

  test('GET returns 200 when correct X-Api-Key header is provided', async () => {
    process.env.PROMPTPROOF_API_KEY = 'test-key'
    const { GET: GuardedGet } = await loadRoute()
    const req = new Request('http://localhost/api/audits', {
      headers: { 'X-Api-Key': 'test-key' },
    })
    const res = await GuardedGet(req)
    expect(res.status).toBe(200)
  })

  test('POST returns 401 when API key is set and no header provided', async () => {
    process.env.PROMPTPROOF_API_KEY = 'test-key'
    const { POST: GuardedPost } = await loadRoute()
    const req = new Request('http://localhost/api/audits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    })
    const res = await GuardedPost(req)
    expect(res.status).toBe(401)
    expect(await db.audit.count()).toBe(0)
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
    const res = await GET(req, { params: Promise.resolve({ id: audit.id }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.trustScore).toBe(87)
    expect(body.reliabilityScore).toBe(82)
    expect(body.findings).toEqual([])
    expect(body.pagesCrawled).toBe(5)
  })

  test('returns 404 for unknown audit id', async () => {
    const req = new Request('http://localhost/api/audits/nonexistent')
    const res = await GET(req, { params: Promise.resolve({ id: 'nonexistent' }) })
    expect(res.status).toBe(404)
  })
})
