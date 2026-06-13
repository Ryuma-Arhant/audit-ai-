import { Prisma } from '@prisma/client'
import { db } from '../../lib/db'

interface LinkEntry { href: string; text: string }

export async function checkBrokenLinks(auditId: string): Promise<void> {
  const pages = await db.page.findMany({ where: { auditId } })

  const statusMap = new Map<string, number>()
  for (const page of pages) {
    statusMap.set(page.url, page.httpStatus)
    statusMap.set(page.urlRaw, page.httpStatus)
  }

  const findings: Prisma.FindingCreateManyInput[] = []
  for (const page of pages) {
    const links: LinkEntry[] = JSON.parse(page.links)
    for (const link of links) {
      const status = statusMap.get(link.href)
      if (status !== undefined && status >= 400) {
        findings.push({
          auditId,
          pageId: page.id,
          source: 'deterministic',
          type: 'broken_link',
          severity: 'medium',
          confidence: 1.0,
          unverified: false,
          pageUrl: page.url,
          description: `Broken link${link.text ? ` "${link.text}"` : ''} → ${link.href} (HTTP ${status})`,
          domEvidence: `<a href="${link.href}">${link.text}</a>`,
          networkEvidence: JSON.stringify([{ url: link.href, status, method: 'GET' }]),
        })
      }
    }
  }

  if (findings.length > 0) {
    await db.finding.createMany({ data: findings })
  }
}
