import { db } from '../lib/db'
import { crawl } from './crawler'

const MAX_CRAWL_RETRIES = 2

export async function runPipeline(auditId: string): Promise<void> {
  const audit = await db.audit.findUniqueOrThrow({ where: { id: auditId } })
  const config = JSON.parse(audit.config ?? '{}') as { maxPages?: number }
  const maxPages = config.maxPages ?? 15

  // Phase 1: Crawl — retry up to MAX_CRAWL_RETRIES times on failure
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

  // Phases 2–5: deterministic checks + agents + scoring (stubs — implemented in Plans 3 & 4)
  await db.audit.update({
    where: { id: auditId },
    data: {
      status: 'complete',
      trustScore: 0,
      reliabilityScore: 0,
      uxScore: null,
      durationMs: 0,
      costUsd: 0,
      completedAt: new Date(),
    },
  })
}
