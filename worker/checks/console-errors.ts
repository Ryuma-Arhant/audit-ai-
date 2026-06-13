import { Prisma } from '@prisma/client'
import { db } from '../../lib/db'

interface ConsoleEntry { level: string; message: string; source: string }

export async function checkConsoleErrors(auditId: string): Promise<void> {
  const pages = await db.page.findMany({ where: { auditId } })

  const findings: Prisma.FindingCreateManyInput[] = []
  for (const page of pages) {
    const errors: ConsoleEntry[] = JSON.parse(page.consoleErrors)
    for (const err of errors) {
      const isUncaught = /uncaught|unhandled/i.test(err.message)
      findings.push({
        auditId,
        pageId: page.id,
        source: 'deterministic',
        type: 'console_error',
        severity: isUncaught ? 'high' : 'medium',
        confidence: 1.0,
        unverified: false,
        pageUrl: page.url,
        description: `Console error: ${err.message.slice(0, 200)}`,
        consoleEvidence: JSON.stringify([err]),
      })
    }
  }

  if (findings.length > 0) {
    await db.finding.createMany({ data: findings })
  }
}
