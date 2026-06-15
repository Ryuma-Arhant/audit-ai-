import { callClaude, MODEL_CAPABLE } from '../../lib/claude'
import type { ContentBlock } from '../../lib/claude'
import { db } from '../../lib/db'
import { trackAgentRun } from './run-tracker'
import type { InferredIntent } from './types'
import logger from '../../lib/logger'

export async function aiJudge(auditId: string, intents: InferredIntent[]): Promise<number | null> {
  return trackAgentRun(auditId, 'ai-judge', 3, { intents: intents.length }, async () => {
    logger.info({ auditId }, 'ai-judge running in text-only mode')

    const pages = await db.page.findMany({ where: { auditId } })
    if (pages.length === 0) return null

    const textBlock = `You are a UX quality judge for AI-generated web apps.

IMPORTANT: No screenshot images are available. Evaluate UX based solely on page structure, titles, and interactive elements listed below.

Pages crawled: ${pages.length}
Inferred UI intents: ${JSON.stringify(intents.slice(0, 10), null, 2)}

Rate UX quality (0-100) and identify specific UX issues.

Return JSON:
{
  "uxScore": 75,
  "rationale": "Brief assessment",
  "findings": [
    { "type": "ux_incoherence", "severity": "medium", "confidence": 0.7, "pageUrl": "${pages[0]?.url ?? ''}", "description": "Specific UX issue" }
  ]
}

UX score: 90-100 excellent, 70-89 good, 50-69 fair, 30-49 poor, 0-29 broken
Types: ux_incoherence, auth_dead_end, hallucinated_route

NOTE: Visual coherence and layout aesthetics cannot be assessed without screenshots. Focus evaluation on functional UX issues: broken navigation flows, missing expected UI elements, inconsistent state handling, and interaction problems.

Return ONLY the JSON object.`

    const content: ContentBlock[] = [{ type: 'text', text: textBlock }]

    const response = await callClaude({
      auditId,
      agentName: 'ai-judge',
      model: MODEL_CAPABLE,
      messages: [{ role: 'user', content }],
      system: 'You are a UX quality judge. Return only valid JSON.',
      maxTokens: 1024,
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? '{}'
    try {
      const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as {
        uxScore?: number
        findings?: Array<{ type: string; severity: string; confidence: number; pageUrl: string; description: string }>
      }

      const uxScore = typeof parsed.uxScore === 'number' ? Math.max(0, Math.min(100, parsed.uxScore)) : null

      if (parsed.findings?.length) {
        await db.finding.createMany({
          data: parsed.findings.map(f => ({
            auditId,
            source: 'llm_judge',
            type: f.type ?? 'ux_incoherence',
            severity: f.severity ?? 'medium',
            confidence: f.confidence ?? 0.7,
            unverified: !f.description,
            pageUrl: f.pageUrl ?? pages[0]?.url ?? '',
            description: f.description ?? '',
          })),
        })
      }

      return uxScore
    } catch {
      return null
    }
  })
}
