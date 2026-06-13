import { db } from '../../lib/db'

export async function checkHttpStatus(auditId: string): Promise<void> {
  const pages = await db.page.findMany({
    where: { auditId, httpStatus: { gte: 400 } },
  })

  if (pages.length === 0) return

  await db.finding.createMany({
    data: pages.map(page => ({
      auditId,
      pageId: page.id,
      source: 'deterministic',
      type: 'http_error',
      severity: page.httpStatus >= 500 ? 'critical' : 'high',
      confidence: 1.0,
      unverified: false,
      pageUrl: page.url,
      description: `Page returned HTTP ${page.httpStatus}`,
      networkEvidence: JSON.stringify([{ url: page.url, status: page.httpStatus, method: 'GET' }]),
    })),
  })
}
