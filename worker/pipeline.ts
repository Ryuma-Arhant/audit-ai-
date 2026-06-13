import { db } from '../lib/db'
import { crawl } from './crawler'
import { checkHttpStatus } from './checks/http-status'
import { checkConsoleErrors } from './checks/console-errors'
import { checkBrokenLinks } from './checks/broken-links'
import { checkActions } from './checks/action-testing'
import { checkStalls } from './checks/stall-detection'
import { checkPersistence } from './checks/persistence'
import { computeScores } from './scoring'

const MAX_CRAWL_RETRIES = 2
const CHECK_NAMES = ['http-status', 'console-errors', 'broken-links', 'action-testing', 'stall-detection', 'persistence']

export async function runPipeline(auditId: string): Promise<void> {
  const t0 = Date.now()
  const audit = await db.audit.findUniqueOrThrow({ where: { id: auditId } })
  const config = JSON.parse(audit.config ?? '{}') as { maxPages?: number }
  const maxPages = config.maxPages ?? 15

  // Phase 1: Crawl — retry up to MAX_CRAWL_RETRIES on failure
  let crawlError: Error | null = null
  for (let attempt = 1; attempt <= MAX_CRAWL_RETRIES; attempt++) {
    try {
      await crawl({ auditId, startUrl: audit.url, maxPages })
      crawlError = null
      break
    } catch (err) {
      crawlError = err instanceof Error ? err : new Error(String(err))
      console.error(`[pipeline] crawl attempt ${attempt}/${MAX_CRAWL_RETRIES} failed:`, crawlError.message)
    }
  }

  if (crawlError) {
    await db.audit.update({
      where: { id: auditId },
      data: {
        status: 'failed',
        errorMessage: `Crawl failed after ${MAX_CRAWL_RETRIES} attempts: ${crawlError.message}`,
        completedAt: new Date(),
      },
    })
    return
  }

  // Phase 2: Deterministic checks — all 6 in parallel, each independently recoverable
  const checkResults = await Promise.allSettled([
    checkHttpStatus(auditId),
    checkConsoleErrors(auditId),
    checkBrokenLinks(auditId),
    checkActions(auditId),
    checkStalls(auditId),
    checkPersistence(auditId),
  ])

  for (const [i, result] of checkResults.entries()) {
    if (result.status === 'rejected') {
      console.error(`[pipeline] check ${CHECK_NAMES[i]} failed:`, result.reason?.message ?? result.reason)
    }
  }

  // Phase 3: Score
  const scores = await computeScores(auditId)

  // Phases 4–5: agents + synthesis (stubs — Plan 4)
  const tokenAgg = await db.tokenLog.aggregate({ where: { auditId }, _sum: { costUsd: true } })

  await db.audit.update({
    where: { id: auditId },
    data: {
      status: 'complete',
      trustScore: scores.trustScore,
      reliabilityScore: scores.reliabilityScore,
      uxScore: scores.uxScore,
      scoreBreakdown: JSON.stringify(scores.scoreBreakdown),
      durationMs: Date.now() - t0,
      costUsd: tokenAgg._sum.costUsd ?? 0,
      completedAt: new Date(),
    },
  })
}
