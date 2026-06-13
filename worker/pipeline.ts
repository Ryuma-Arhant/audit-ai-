import { db } from '../lib/db'

export async function runPipeline(auditId: string): Promise<void> {
  console.log(`[pipeline] audit ${auditId} — stub, no checks run yet`)

  await db.audit.update({
    where: { id: auditId },
    data: {
      status:           'complete',
      trustScore:       0,
      reliabilityScore: 0,
      uxScore:          null,
      pagesCrawled:     0,
      durationMs:       0,
      costUsd:          0,
      completedAt:      new Date(),
    },
  })
}
