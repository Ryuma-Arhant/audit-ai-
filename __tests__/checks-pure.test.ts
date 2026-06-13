import { checkHttpStatus } from '../worker/checks/http-status'
import { checkConsoleErrors } from '../worker/checks/console-errors'
import { checkBrokenLinks } from '../worker/checks/broken-links'
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
      actions: JSON.stringify([]),
      ...overrides,
    },
  })
}

beforeEach(clearDb)
afterAll(() => db.$disconnect())

// --- http-status ---

describe('checkHttpStatus', () => {
  test('creates critical finding for 5xx page', async () => {
    const audit = await makeAudit()
    await makePage(audit.id, { url: 'https://example.com/crash', urlRaw: 'https://example.com/crash', httpStatus: 500 })

    await checkHttpStatus(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('critical')
    expect(findings[0].type).toBe('http_error')
    expect(findings[0].confidence).toBe(1.0)
    expect(findings[0].source).toBe('deterministic')
  })

  test('creates high finding for 4xx page', async () => {
    const audit = await makeAudit()
    await makePage(audit.id, { url: 'https://example.com/missing', urlRaw: 'https://example.com/missing', httpStatus: 404 })

    await checkHttpStatus(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings[0].severity).toBe('high')
  })

  test('ignores 200 pages', async () => {
    const audit = await makeAudit()
    await makePage(audit.id)

    await checkHttpStatus(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings).toHaveLength(0)
  })
})

// --- console-errors ---

describe('checkConsoleErrors', () => {
  test('creates high finding for uncaught exception', async () => {
    const audit = await makeAudit()
    await makePage(audit.id, {
      consoleErrors: JSON.stringify([
        { level: 'error', message: 'Uncaught TypeError: cannot read property', source: 'console' },
      ]),
    })

    await checkConsoleErrors(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('high')
    expect(findings[0].type).toBe('console_error')
    expect(findings[0].confidence).toBe(1.0)
    const evidence = JSON.parse(findings[0].consoleEvidence!)
    expect(evidence).toHaveLength(1)
  })

  test('creates medium finding for plain error log', async () => {
    const audit = await makeAudit()
    await makePage(audit.id, {
      consoleErrors: JSON.stringify([
        { level: 'error', message: 'Failed to load resource', source: 'console' },
      ]),
    })

    await checkConsoleErrors(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings[0].severity).toBe('medium')
  })

  test('no findings for page with empty console errors', async () => {
    const audit = await makeAudit()
    await makePage(audit.id, { consoleErrors: JSON.stringify([]) })

    await checkConsoleErrors(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings).toHaveLength(0)
  })

  test('creates one finding per error', async () => {
    const audit = await makeAudit()
    await makePage(audit.id, {
      consoleErrors: JSON.stringify([
        { level: 'error', message: 'Error A', source: 'console' },
        { level: 'error', message: 'Error B', source: 'console' },
      ]),
    })

    await checkConsoleErrors(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings).toHaveLength(2)
  })
})

// --- broken-links ---

describe('checkBrokenLinks', () => {
  test('creates medium finding for link to crawled 404 page', async () => {
    const audit = await makeAudit()
    const brokenUrl = 'https://example.com/dead'
    await makePage(audit.id, {
      links: JSON.stringify([{ href: brokenUrl, text: 'Dead link' }]),
    })
    await makePage(audit.id, {
      url: brokenUrl,
      urlRaw: brokenUrl,
      httpStatus: 404,
    })

    await checkBrokenLinks(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings).toHaveLength(1)
    expect(findings[0].type).toBe('broken_link')
    expect(findings[0].severity).toBe('medium')
    expect(findings[0].confidence).toBe(1.0)
    expect(findings[0].description).toContain('Dead link')
  })

  test('no findings for links to healthy crawled pages', async () => {
    const audit = await makeAudit()
    await makePage(audit.id, {
      links: JSON.stringify([{ href: 'https://example.com/about', text: 'About' }]),
    })
    await makePage(audit.id, {
      url: 'https://example.com/about',
      urlRaw: 'https://example.com/about',
      httpStatus: 200,
    })

    await checkBrokenLinks(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings).toHaveLength(0)
  })

  test('ignores links to uncrawled URLs', async () => {
    const audit = await makeAudit()
    await makePage(audit.id, {
      links: JSON.stringify([{ href: 'https://external.com/page', text: 'External' }]),
    })

    await checkBrokenLinks(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings).toHaveLength(0)
  })
})
