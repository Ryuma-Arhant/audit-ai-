import { db } from '../lib/db'
import { crawl } from './crawler'
import { checkHttpStatus } from './checks/http-status'
import { checkConsoleErrors } from './checks/console-errors'
import { checkBrokenLinks } from './checks/broken-links'
import { checkActions } from './checks/action-testing'
import { checkStalls } from './checks/stall-detection'
import { checkPersistence } from './checks/persistence'
import { uiInferrer } from './agents/ui-inferrer'
import { errorClassifier } from './agents/error-classifier'
import { testGenerator } from './agents/test-generator'
import { agenticExplorer } from './agents/agentic-explorer'
import { rootCauseAnalyzer } from './agents/root-cause-analyzer'
import { aiJudge } from './agents/ai-judge'
import { reportSynthesizer } from './agents/report-synthesizer'
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
      data: { status: 'failed', errorMessage: `Crawl failed: ${crawlError.message}`, completedAt: new Date() },
    })
    return
  }

  // Phase 2: Deterministic checks — all 6 in parallel
  const checkResults = await Promise.allSettled([
    checkHttpStatus(auditId),
    checkConsoleErrors(auditId),
    checkBrokenLinks(auditId),
    checkActions(auditId),
    checkStalls(auditId),
    checkPersistence(auditId),
  ])
  for (const [i, r] of checkResults.entries()) {
    if (r.status === 'rejected') console.error(`[pipeline] check ${CHECK_NAMES[i]} failed:`, r.reason?.message ?? r.reason)
  }

  // Phase A: ui-inferrer + error-classifier in parallel
  const [uiResult] = await Promise.allSettled([
    uiInferrer(auditId),
    errorClassifier(auditId),
  ])
  const intents = uiResult.status === 'fulfilled' ? uiResult.value : []

  // Phase B: test-generator → agentic-explorer (sequential, skip if no intents)
  if (uiResult.status === 'fulfilled' && intents.length > 0) {
    try {
      const specs = await testGenerator(auditId, intents)
      await agenticExplorer(auditId, specs)
    } catch (err) {
      console.error('[pipeline] Phase B failed:', err instanceof Error ? err.message : err)
    }
  }

  // Phase C: root-cause-analyzer + ai-judge in parallel
  const [, judgeResult] = await Promise.allSettled([
    rootCauseAnalyzer(auditId),
    uiResult.status === 'fulfilled' ? aiJudge(auditId, intents) : Promise.resolve(null),
  ])
  const uxScore = judgeResult.status === 'fulfilled' ? judgeResult.value : null

  // Phase D: report-synthesizer
  try {
    await reportSynthesizer(auditId)
  } catch (err) {
    console.error('[pipeline] report-synthesizer failed:', err instanceof Error ? err.message : err)
  }

  // Final scoring + write result
  const scores = await computeScores(auditId, uxScore)
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
