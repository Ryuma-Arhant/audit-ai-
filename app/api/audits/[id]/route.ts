import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { checkAuth } from '@/lib/auth'

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = checkAuth(req)
  if (authErr) return authErr

  const { id } = await params

  const audit = await db.audit.findUnique({
    where: { id },
    include: {
      findings:  { orderBy: { createdAt: 'asc' } },
      agentRuns: { orderBy: { startedAt: 'asc' } },
      pages: {
        orderBy: { discoveredAt: 'asc' },
        select: {
          id:             true,
          url:            true,
          title:          true,
          httpStatus:     true,
          loadTimeMs:     true,
          screenshotPath: true,
          actions:        true,
          findings: { select: { id: true, severity: true, unverified: true } },
        },
      },
    },
  })

  if (!audit) {
    return NextResponse.json({ error: 'Audit not found' }, { status: 404 })
  }

  const sortedFindings = [...audit.findings].sort((a, b) => {
    const severityDiff =
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
    if (severityDiff !== 0) return severityDiff
    return b.confidence - a.confidence
  })

  return NextResponse.json({ ...audit, findings: sortedFindings })
}
