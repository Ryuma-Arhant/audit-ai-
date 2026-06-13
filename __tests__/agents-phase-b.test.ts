import http from 'http'
import { AddressInfo } from 'net'
import { testGenerator } from '../worker/agents/test-generator'
import { agenticExplorer } from '../worker/agents/agentic-explorer'
import { db } from '../lib/db'
import type { InferredIntent, AgentFlowSpec } from '../worker/agents/types'
import type { LLMResponse } from '../lib/claude'

jest.setTimeout(60000)

jest.mock('../lib/claude', () => ({
  callClaude: jest.fn(),
  CostCapError: class CostCapError extends Error {
    constructor(m: string) { super(m); this.name = 'CostCapError' }
  },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { callClaude } = require('../lib/claude') as { callClaude: jest.MockedFunction<() => Promise<LLMResponse>> }

function claudeResp(text: string): LLMResponse {
  return { content: [{ type: 'text', text }], usage: { input_tokens: 50, output_tokens: 30 } } as unknown as LLMResponse
}

async function clearDb() {
  await db.finding.deleteMany()
  await db.page.deleteMany()
  await db.agentRun.deleteMany()
  await db.tokenLog.deleteMany()
  await db.audit.deleteMany()
}

beforeEach(async () => {
  jest.clearAllMocks()
  await clearDb()
})
afterAll(() => db.$disconnect())

const SAMPLE_INTENTS: InferredIntent[] = [
  { pageUrl: 'http://localhost/', elementSelector: '#btn', purpose: 'submit-form', elementType: 'button', confidence: 0.9 },
]

// ─── test-generator ───

describe('testGenerator', () => {
  test('parses AgentFlowSpec[] from Claude response', async () => {
    const audit = await db.audit.create({
      data: { url: 'https://example.com', status: 'running', config: JSON.stringify({}) },
    })

    const specs: AgentFlowSpec[] = [{
      name: 'test-submit',
      pageUrl: 'https://example.com/',
      steps: [
        { action: 'click', selector: '#btn', description: 'Click submit' },
        { action: 'assert', description: 'Page changed' },
      ],
    }]

    callClaude.mockResolvedValueOnce(claudeResp(JSON.stringify(specs)))

    const result = await testGenerator(audit.id, SAMPLE_INTENTS)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('test-submit')
    expect(result[0].steps).toHaveLength(2)

    const run = await db.agentRun.findFirst({ where: { auditId: audit.id, agentName: 'test-generator' } })
    expect(run?.status).toBe('complete')
    expect(run?.phase).toBe(2)
  })

  test('returns empty array when no intents provided', async () => {
    const audit = await db.audit.create({
      data: { url: 'https://example.com', status: 'running', config: JSON.stringify({}) },
    })

    const result = await testGenerator(audit.id, [])

    expect(result).toHaveLength(0)
    expect(callClaude).not.toHaveBeenCalled()
  })
})

// ─── agentic-explorer ───

describe('agenticExplorer', () => {
  function startServer(pages: Record<string, string>): Promise<{ server: http.Server; baseUrl: string }> {
    return new Promise(resolve => {
      const server = http.createServer((req, res) => {
        const body = pages[req.url ?? '/'] ?? '<h1>404</h1>'
        res.writeHead(pages[req.url ?? '/'] ? 200 : 404, { 'Content-Type': 'text/html' })
        res.end(body)
      })
      server.listen(0, '127.0.0.1', () => {
        resolve({ server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })
      })
    })
  }

  test('executes flow spec and returns FlowResult with success=true', async () => {
    const { server, baseUrl } = await startServer({
      '/': `<html><body><button id="btn">Click</button><div id="result"></div>
        <script>document.getElementById('btn').onclick = () => document.getElementById('result').textContent = 'done';</script>
      </body></html>`,
    })
    try {
      const audit = await db.audit.create({
        data: { url: baseUrl, status: 'running', config: JSON.stringify({}) },
      })

      const specs: AgentFlowSpec[] = [{
        name: 'test-click',
        pageUrl: baseUrl + '/',
        steps: [
          { action: 'navigate', value: baseUrl + '/', description: 'Navigate to home' },
          { action: 'click', selector: '#btn', description: 'Click button' },
          { action: 'assert', description: 'Result appeared' },
        ],
      }]

      const results = await agenticExplorer(audit.id, specs)

      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(true)
      expect(results[0].specName).toBe('test-click')
      expect(results[0].completedSteps).toBe(3)

      const run = await db.agentRun.findFirst({ where: { auditId: audit.id, agentName: 'agentic-explorer' } })
      expect(run?.status).toBe('complete')
      expect(run?.phase).toBe(2)
    } finally {
      server.close()
    }
  })

  test('records success=false when selector not found', async () => {
    const { server, baseUrl } = await startServer({
      '/': `<html><body><p>No button here</p></body></html>`,
    })
    try {
      const audit = await db.audit.create({
        data: { url: baseUrl, status: 'running', config: JSON.stringify({}) },
      })

      const specs: AgentFlowSpec[] = [{
        name: 'test-missing',
        pageUrl: baseUrl + '/',
        steps: [
          { action: 'navigate', value: baseUrl + '/', description: 'Navigate' },
          { action: 'click', selector: '#nonexistent', description: 'Click missing element' },
        ],
      }]

      const results = await agenticExplorer(audit.id, specs)

      expect(results[0].success).toBe(false)
      expect(results[0].error).toBeDefined()
    } finally {
      server.close()
    }
  })

  test('returns empty array when no specs provided', async () => {
    const audit = await db.audit.create({
      data: { url: 'https://example.com', status: 'running', config: JSON.stringify({}) },
    })

    const results = await agenticExplorer(audit.id, [])

    expect(results).toHaveLength(0)
  })
})
