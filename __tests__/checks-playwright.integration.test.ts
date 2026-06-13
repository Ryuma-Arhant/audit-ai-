import http from 'http'
import { AddressInfo } from 'net'
import { checkActions } from '../worker/checks/action-testing'
import { checkStalls } from '../worker/checks/stall-detection'
import { checkPersistence } from '../worker/checks/persistence'
import { db } from '../lib/db'

jest.setTimeout(90000)

// Button that does nothing when clicked
const DEAD_BUTTON_HTML = `<!DOCTYPE html><html><head><title>Dead Button</title></head><body>
  <button id="noop">Save</button>
  <script>document.getElementById('noop').addEventListener('click', () => {});</script>
</body></html>`

// Loading spinner that never clears
const SPINNER_HTML = `<!DOCTYPE html><html><head><title>Stalled</title></head><body>
  <div id="spinner" class="loading">Loading...</div>
  <div id="content" style="display:none">Content</div>
</body></html>`

// Form that doesn't persist on reload
const FORM_NO_PERSIST_HTML = `<!DOCTYPE html><html><head><title>Form</title></head><body>
  <form id="f">
    <input id="name" name="name" placeholder="Name" />
    <button type="submit">Submit</button>
  </form>
  <div id="result"></div>
  <script>
    document.getElementById('f').addEventListener('submit', function(e) {
      e.preventDefault();
      document.getElementById('result').textContent = 'Submitted!';
    });
  </script>
</body></html>`

// Form that persists via localStorage
const FORM_PERSIST_HTML = `<!DOCTYPE html><html><head><title>Persist Form</title></head><body>
  <form id="f">
    <input id="name" name="name" placeholder="Name" />
    <button type="submit">Submit</button>
  </form>
  <script>
    var input = document.getElementById('name');
    var saved = localStorage.getItem('name');
    if (saved) input.value = saved;
    document.getElementById('f').addEventListener('submit', function(e) {
      e.preventDefault();
      localStorage.setItem('name', input.value);
    });
  </script>
</body></html>`

function startServer(
  pages: Record<string, string>
): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const body = pages[req.url ?? '/'] ?? '<h1>404</h1>'
      const status = pages[req.url ?? '/'] !== undefined ? 200 : 404
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

async function seedPage(auditId: string, url: string, overrides: Record<string, unknown> = {}) {
  return db.page.create({
    data: {
      auditId,
      url,
      urlRaw: url,
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

// ─── action-testing ───

test('action-testing: detects button that produces no DOM change', async () => {
  const { server, baseUrl } = await startServer({ '/': DEAD_BUTTON_HTML })
  try {
    const audit = await db.audit.create({
      data: { url: baseUrl, status: 'running', config: JSON.stringify({}) },
    })
    await seedPage(audit.id, baseUrl + '/', {
      actions: JSON.stringify([{ type: 'button', label: 'Save', selector: '#noop' }]),
    })

    await checkActions(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0].type).toBe('action_failure')
    expect(findings[0].severity).toBe('critical')
    expect(findings[0].confidence).toBe(0.7)
  } finally {
    server.close()
  }
})

test('action-testing: no finding for page with no interactive elements', async () => {
  const { server, baseUrl } = await startServer({
    '/': `<html><body><p>Just text</p></body></html>`,
  })
  try {
    const audit = await db.audit.create({
      data: { url: baseUrl, status: 'running', config: JSON.stringify({}) },
    })
    await seedPage(audit.id, baseUrl + '/', { actions: JSON.stringify([]) })

    await checkActions(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings).toHaveLength(0)
  } finally {
    server.close()
  }
})

// ─── stall-detection ───

test('stall-detection: detects persistent loading element', async () => {
  const { server, baseUrl } = await startServer({ '/': SPINNER_HTML })
  try {
    const audit = await db.audit.create({
      data: { url: baseUrl, status: 'running', config: JSON.stringify({}) },
    })
    await seedPage(audit.id, baseUrl + '/')

    await checkStalls(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0].type).toBe('stall')
    expect(findings[0].severity).toBe('high')
  } finally {
    server.close()
  }
})

test('stall-detection: no finding for page that loads cleanly', async () => {
  const { server, baseUrl } = await startServer({
    '/': `<html><body><p>Loaded content</p></body></html>`,
  })
  try {
    const audit = await db.audit.create({
      data: { url: baseUrl, status: 'running', config: JSON.stringify({}) },
    })
    await seedPage(audit.id, baseUrl + '/')

    await checkStalls(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings).toHaveLength(0)
  } finally {
    server.close()
  }
})

// ─── persistence ───

test('persistence: detects data loss — form data absent after reload', async () => {
  const { server, baseUrl } = await startServer({ '/': FORM_NO_PERSIST_HTML })
  try {
    const audit = await db.audit.create({
      data: { url: baseUrl, status: 'running', config: JSON.stringify({}) },
    })
    await seedPage(audit.id, baseUrl + '/', {
      actions: JSON.stringify([
        { type: 'input', label: 'Name', selector: '#name' },
        { type: 'button', label: 'Submit', selector: 'button[type="submit"]' },
      ]),
    })

    await checkPersistence(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0].type).toBe('persistence_loss')
    expect(findings[0].severity).toBe('critical')
  } finally {
    server.close()
  }
})

test('persistence: no finding when data survives reload via localStorage', async () => {
  const { server, baseUrl } = await startServer({ '/': FORM_PERSIST_HTML })
  try {
    const audit = await db.audit.create({
      data: { url: baseUrl, status: 'running', config: JSON.stringify({}) },
    })
    await seedPage(audit.id, baseUrl + '/', {
      actions: JSON.stringify([
        { type: 'input', label: 'Name', selector: '#name' },
        { type: 'button', label: 'Submit', selector: 'button[type="submit"]' },
      ]),
    })

    await checkPersistence(audit.id)

    const findings = await db.finding.findMany({ where: { auditId: audit.id } })
    expect(findings).toHaveLength(0)
  } finally {
    server.close()
  }
})
