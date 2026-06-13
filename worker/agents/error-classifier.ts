import { callClaude } from '../../lib/claude'
import { db } from '../../lib/db'
import { trackAgentRun } from './run-tracker'

export async function errorClassifier(auditId: string): Promise<void> {
  return trackAgentRun(auditId, 'error-classifier', 1, { auditId }, async () => {
    const findings = await db.finding.findMany({
      where: { auditId, source: 'deterministic' },
      select: { id: true, type: true, severity: true, description: true, confidence: true },
    })
    if (findings.length === 0) return

    const response = await callClaude({
      auditId,
      agentName: 'error-classifier',
      model: 'claude-haiku-4-5-20251001',
      messages: [{
        role: 'user',
        content: `Review these deterministic findings. Identify any that are false positives or incorrectly classified.

Findings:
${JSON.stringify(findings, null, 2)}

Return a JSON array of adjustments (only include findings that need changes):
[
  { "id": "finding-id", "action": "keep" | "downgrade" | "unverified", "reason": "brief reason" }
]

Return ONLY the JSON array.`,
      }],
      system: 'You are a QA engineer. Return only valid JSON.',
      maxTokens: 1024,
    })

    const text = response.content.find(b => b.type === 'text')?.text ?? '[]'
    try {
      const adjustments = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as Array<{
        id: string; action: 'keep' | 'downgrade' | 'unverified'; reason: string
      }>

      const DOWNGRADE: Record<string, string> = { critical: 'high', high: 'medium', medium: 'low', low: 'low' }
      for (const adj of adjustments) {
        if (adj.action === 'unverified') {
          await db.finding.update({ where: { id: adj.id }, data: { unverified: true, confidence: 0.3 } })
        } else if (adj.action === 'downgrade') {
          const f = findings.find(f => f.id === adj.id)
          if (f) await db.finding.update({ where: { id: adj.id }, data: { severity: DOWNGRADE[f.severity] ?? f.severity } })
        }
      }
    } catch { /* malformed JSON — skip */ }
  })
}
