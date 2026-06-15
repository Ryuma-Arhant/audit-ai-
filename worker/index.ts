import { SQLiteQueue } from './queue'
import { runPipeline } from './pipeline'
import { db } from '../lib/db'
import logger from '../lib/logger'

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
    if (r.count > 0) logger.info({ count: r.count }, 'Reset stuck running audit(s) to failed')
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, 'Failed to reset stuck audits')
  }

  logger.info('Started — polling every 2s')

  setInterval(async () => {
    if (active >= MAX_CONCURRENT_AUDITS) return

    const auditId = await queue.dequeue()
    if (!auditId) return

    active++
    logger.info({ auditId, active }, 'Picked up audit')

    runPipeline(auditId)
      .catch(err => {
        logger.error({ auditId, err: err.message }, 'Audit failed')
        return queue.fail(auditId, err.message)
      })
      .finally(() => {
        active--
        logger.info({ auditId, active }, 'Audit done')
      })
  }, 2000)
})()
