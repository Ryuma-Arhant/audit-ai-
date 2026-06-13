import http from 'http'
import { AddressInfo } from 'net'
import { crawl } from '../worker/crawler'
import { db } from '../lib/db'

jest.setTimeout(60000)

const SITE: Record<string, string> = {
  '/': `<!DOCTYPE html><html><head><title>Home</title></head><body>
    <h1>Home</h1>
    <a href="/about">About</a>
    <a href="https://external.example.com/page">External</a>
    <button>Click me</button>
  </body></html>`,
  '/about': `<!DOCTYPE html><html><head><title>About Us</title></head><body>
    <h1>About Us</h1>
    <a href="/">Home</a>
    <form action="/submit" method="post">
      <input name="email" placeholder="Email" />
      <button type="submit">Submit</button>
    </form>
  </body></html>`,
}

function startServer(
  site: Record<string, string> = SITE
): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const body = site[req.url ?? '/'] ?? '<h1>Not Found</h1>'
      const status = site[req.url ?? '/'] !== undefined ? 200 : 404
      res.writeHead(status, { 'Content-Type': 'text/html' })
      res.end(body)
    })
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` })
    })
  })
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

test('crawls two pages and writes Page rows to DB', async () => {
  const { server, baseUrl } = await startServer()
  try {
    const audit = await db.audit.create({
      data: { url: baseUrl, status: 'running', config: JSON.stringify({ maxPages: 5 }) },
    })

    await crawl({ auditId: audit.id, startUrl: baseUrl, maxPages: 5 })

    const pages = await db.page.findMany({ where: { auditId: audit.id } })
    expect(pages).toHaveLength(2)

    const home = pages.find(p => new URL(p.url).pathname === '/')
    expect(home).toBeDefined()
    expect(home!.title).toBe('Home')
    expect(home!.httpStatus).toBe(200)
    expect(home!.urlRaw).toBe(baseUrl)

    const about = pages.find(p => new URL(p.url).pathname === '/about')
    expect(about).toBeDefined()
    expect(about!.title).toBe('About Us')
    expect(about!.httpStatus).toBe(200)

    // External link must NOT be crawled
    const external = pages.find(p => p.url.includes('external'))
    expect(external).toBeUndefined()

    // Live counter
    const updated = await db.audit.findUnique({ where: { id: audit.id } })
    expect(updated!.pagesCrawled).toBe(2)
  } finally {
    server.close()
  }
})

test('respects maxPages limit', async () => {
  const site: Record<string, string> = {
    '/':  `<html><body><a href="/a">A</a><a href="/b">B</a></body></html>`,
    '/a': `<html><body><a href="/">Home</a></body></html>`,
    '/b': `<html><body><a href="/">Home</a></body></html>`,
  }
  const { server, baseUrl } = await startServer(site)
  try {
    const audit = await db.audit.create({
      data: { url: baseUrl, status: 'running', config: JSON.stringify({ maxPages: 1 }) },
    })

    await crawl({ auditId: audit.id, startUrl: baseUrl, maxPages: 1 })

    const pages = await db.page.findMany({ where: { auditId: audit.id } })
    expect(pages).toHaveLength(1)

    const updated = await db.audit.findUnique({ where: { id: audit.id } })
    expect(updated!.pagesCrawled).toBe(1)
  } finally {
    server.close()
  }
})

test('captures links array including external links', async () => {
  const { server, baseUrl } = await startServer()
  try {
    const audit = await db.audit.create({
      data: { url: baseUrl, status: 'running', config: JSON.stringify({ maxPages: 5 }) },
    })

    await crawl({ auditId: audit.id, startUrl: baseUrl, maxPages: 5 })

    const home = await db.page.findFirst({
      where: { auditId: audit.id },
      orderBy: { discoveredAt: 'asc' },
    })
    expect(home).toBeDefined()

    const links = JSON.parse(home!.links) as Array<{ href: string; text: string }>
    const aboutLink = links.find(l => l.href.includes('/about'))
    expect(aboutLink).toBeDefined()
    expect(aboutLink!.text).toBe('About')

    const externalLink = links.find(l => l.href.includes('external.example.com'))
    expect(externalLink).toBeDefined() // captured in links array but not followed
  } finally {
    server.close()
  }
})

test('deduplicates parametric routes — crawls first instance, skips rest', async () => {
  const site: Record<string, string> = {
    '/':       `<html><body><a href="/chat/1">Chat 1</a><a href="/chat/2">Chat 2</a></body></html>`,
    '/chat/1': `<html><head><title>Chat 1</title></head><body>Chat one</body></html>`,
    '/chat/2': `<html><head><title>Chat 2</title></head><body>Chat two</body></html>`,
  }
  const { server, baseUrl } = await startServer(site)
  try {
    const audit = await db.audit.create({
      data: { url: baseUrl, status: 'running', config: JSON.stringify({ maxPages: 10 }) },
    })

    await crawl({ auditId: audit.id, startUrl: baseUrl, maxPages: 10 })

    const pages = await db.page.findMany({ where: { auditId: audit.id } })
    // / and /chat/1 only — /chat/2 skipped (same :id pattern)
    expect(pages).toHaveLength(2)
    const chatPages = pages.filter(p => p.url.includes('/chat/'))
    expect(chatPages).toHaveLength(1)
  } finally {
    server.close()
  }
})
