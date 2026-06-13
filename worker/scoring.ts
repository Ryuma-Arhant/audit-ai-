import { db } from '../lib/db'

export interface ScoreResult {
  reliabilityScore: number
  uxScore: number | null
  trustScore: number
  scoreBreakdown: Record<string, number>
}

const DEDUCTIONS: Record<string, { each: number; cap: number }> = {
  critical: { each: 20, cap: 60 },
  high:     { each: 10, cap: 30 },
  medium:   { each:  5, cap: 15 },
  low:      { each:  2, cap: 10 },
}

const DATA_LOSS_TYPES = new Set(['persistence_loss', 'auth_dead_end'])

export async function computeScores(auditId: string, uxScoreOverride: number | null = null): Promise<ScoreResult> {
  const findings = await db.finding.findMany({
    where: { auditId },
    select: { severity: true, confidence: true, type: true, unverified: true },
  })

  const confirmed  = findings.filter(f => !f.unverified && f.confidence >= 0.7)
  const suspicious = findings.filter(f => !f.unverified && f.confidence <  0.7)

  let score = 100
  const breakdown: Record<string, number> = {}

  for (const sev of ['critical', 'high', 'medium', 'low']) {
    const matching = confirmed.filter(f => f.severity === sev)
    const d = DEDUCTIONS[sev]
    score -= Math.min(matching.length * d.each, d.cap)
    breakdown[sev] = matching.length
  }

  score -= Math.min(suspicious.length, 10)
  const reliabilityScore = Math.max(0, score)

  const confirmedCriticals = confirmed.filter(f => f.severity === 'critical')
  const hasDataLoss = confirmedCriticals.some(f => DATA_LOSS_TYPES.has(f.type))

  let ceiling = 100
  if (confirmedCriticals.length >= 2 || hasDataLoss) ceiling = 39
  else if (confirmedCriticals.length === 1) ceiling = 59

  const uxScore = uxScoreOverride
  const rawTrust = uxScore !== null
    ? Math.round(reliabilityScore * 0.7 + uxScore * 0.3)
    : reliabilityScore
  const trustScore = Math.min(rawTrust, ceiling)

  return { reliabilityScore, uxScore, trustScore, scoreBreakdown: breakdown }
}
