import { callClaude, MODEL_CAPABLE } from '../../lib/claude'
import { db } from '../../lib/db'
import { trackAgentRun } from './run-tracker'

export async function rootCauseAnalyzer(auditId: string): Promise<void> {
  return trackAgentRun(auditId, 'root-cause-analyzer', 3, { auditId }, async () => {
    const findings = await db.finding.findMany({
      where: { auditId, unverified: false },
      select: { id: true, type: true, severity: true, description: true, pageUrl: true, consoleEvidence: true, networkEvidence: true },
    })
    if (findings.length === 0) return

    const response = await callClaude({
      auditId,
      agentName: 'root-cause-analyzer',
      model: MODEL_CAPABLE,
      messages: [{
        role: 'user',
        content: `Provide detailed reproduction steps and root cause descriptions for these findings.

Findings:
${JSON.stringify(findings.slice(0, 10), null, 2)}

Return a JSON array:
[
  {
    "id": "finding-id",
    "reproduction": "1. Navigate to {url}\\n2. {specific action}\\n3. Observe: {issue}",
    "description": "Specific root cause description"
  }
]

Return ONLY the JSON array.`,
      }],
      system: 'You are a QA root-cause engineer. Return only valid JSON.',
      maxTokens: 2048,
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? '[]'
    try {
      const enrichments = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as Array<{
        id: string; reproduction?: string; description?: string
      }>
      await Promise.all(
        enrichments.map((e) => {
          const data: Record<string, string> = {}
          if (e.reproduction) data.reproduction = e.reproduction
          if (e.description) data.description = e.description
          if (Object.keys(data).length === 0) return undefined
          return db.finding.update({ where: { id: e.id }, data })
        })
      )
    } catch { /* malformed JSON — skip */ }
  })
}
