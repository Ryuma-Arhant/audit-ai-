import { db } from '../../lib/db'
import { trackAgentRun } from './run-tracker'

function dedupKey(f: { type: string; pageUrl: string; description: string }): string {
  return `${f.type}::${f.pageUrl}::${f.description.slice(0, 80)}`
}

export async function reportSynthesizer(auditId: string): Promise<void> {
  return trackAgentRun(auditId, 'report-synthesizer', 4, { auditId }, async () => {
    const findings = await db.finding.findMany({ where: { auditId } })
    if (findings.length === 0) return

    const best = new Map<string, typeof findings[0]>()
    for (const f of findings) {
      const key = dedupKey(f)
      const existing = best.get(key)
      if (!existing || f.confidence > existing.confidence) best.set(key, f)
    }

    const keepIds = new Set(Array.from(best.values()).map(f => f.id))
    const deleteIds = findings.filter(f => !keepIds.has(f.id)).map(f => f.id)
    if (deleteIds.length > 0) {
      await db.finding.deleteMany({ where: { id: { in: deleteIds } } })
    }
  })
}
