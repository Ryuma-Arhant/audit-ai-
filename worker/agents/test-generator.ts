import { callClaude } from '../../lib/claude'
import { trackAgentRun } from './run-tracker'
import type { InferredIntent, AgentFlowSpec } from './types'

export async function testGenerator(auditId: string, intents: InferredIntent[]): Promise<AgentFlowSpec[]> {
  return trackAgentRun(auditId, 'test-generator', 2, { intentsCount: intents.length }, async () => {
    if (intents.length === 0) return []

    const response = await callClaude({
      auditId,
      agentName: 'test-generator',
      model: 'claude-haiku-4-5-20251001',
      messages: [{
        role: 'user',
        content: `Generate realistic Playwright test flows for these UI intents.

Intents:
${JSON.stringify(intents.slice(0, 10), null, 2)}

Return a JSON array of AgentFlowSpec:
[
  {
    "name": "test-login",
    "pageUrl": "https://...",
    "steps": [
      { "action": "navigate", "value": "https://...", "description": "Go to page" },
      { "action": "fill", "selector": "#email", "value": "test@example.com", "description": "Enter email" },
      { "action": "click", "selector": "#btn-login", "description": "Click login" },
      { "action": "assert", "description": "Check page changed" }
    ]
  }
]

Actions: click, fill, navigate, wait, assert
Generate 1-3 flows for the most important user journeys. Start each flow with a navigate step.
Return ONLY the JSON array.`,
      }],
      system: 'You are a test engineer. Return only valid JSON.',
      maxTokens: 2048,
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? '[]'
    try {
      return JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as AgentFlowSpec[]
    } catch {
      return []
    }
  })
}
