import { SQLiteQueue } from './queue'
import { runPipeline } from './pipeline'

const queue = new SQLiteQueue()
const MAX_CONCURRENT_AUDITS = 3
let active = 0

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
