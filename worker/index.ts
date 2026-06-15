import { SQLiteQueue } from './queue'
import { runPipeline } from './pipeline'
import { db } from '../lib/db'

const queue = new SQLiteQueue()
const MAX_CONCURRENT_AUDITS = 3
let active = 0

// Reset audits stuck in 'running' from a previous worker crash, then start polling
;(async () => {
  try {
    const r = await db.audit.updateMany({
      where: { status: 'running' },
      data: { status: 'failed', errorMessage: 'Worker restarted — audit did not complete', completedAt: new Date() },
    })
    if (r.count > 0) console.log(`[worker] Reset ${r.count} stuck running audit(s) to failed`)
  } catch (err) {
    console.error('[worker] Failed to reset stuck audits:', err instanceof Error ? err.message : err)
  }

  console.log('[worker] Started — polling every 2s')

  setInterval(async () => {
    if (active >= MAX_CONCURRENT_AUDITS) return

    const auditId = await queue.dequeue()
    if (!auditId) return

    active++
    console.log(`[worker] Picked up ${auditId} (active: ${active})`)

    runPipeline(auditId)
      .catch(err => {
        console.error(`[worker] ${auditId} failed:`, err.message)
        return queue.fail(auditId, err.message)
      })
      .finally(() => {
        active--
        console.log(`[worker] ${auditId} done (active: ${active})`)
      })
  }, 2000)
})()
