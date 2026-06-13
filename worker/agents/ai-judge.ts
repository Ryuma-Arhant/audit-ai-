import path from 'path'
import fs from 'fs/promises'
import type { ContentBlockParam } from '@anthropic-ai/sdk'
import { callClaude } from '../../lib/claude'
import { db } from '../../lib/db'
import { trackAgentRun } from './run-tracker'
import type { InferredIntent } from './types'

export async function aiJudge(auditId: string, intents: InferredIntent[]): Promise<number | null> {
  return trackAgentRun(auditId, 'ai-judge', 3, { intents: intents.length }, async () => {
    const pages = await db.page.findMany({ where: { auditId } })
    if (pages.length === 0) return null

    const imageBlocks: ContentBlockParam[] = []
    for (const pageRecord of pages.slice(0, 3)) {
      if (!pageRecord.screenshotPath) continue
      try {
        const buf = await fs.readFile(path.join(process.cwd(), 'public', pageRecord.screenshotPath))
        imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: buf.toString('base64') } })
      } catch { /* no screenshot */ }
    }

    const textBlock = `You are a UX quality judge for AI-generated web apps.

Pages crawled: ${pages.length}
Inferred UI intents: ${JSON.stringify(intents.slice(0, 10), null, 2)}
${imageBlocks.length > 0 ? '[Screenshots attached above]' : '(No screenshots available)'}

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
Return ONLY the JSON object.`

    const content: ContentBlockParam[] = [...imageBlocks, { type: 'text', text: textBlock }]

    const response = await callClaude({
      auditId,
      agentName: 'ai-judge',
      model: 'claude-sonnet-4-6',
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
