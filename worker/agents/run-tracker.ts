import { db } from '../../lib/db'

export async function trackAgentRun<T>(
  auditId: string,
  agentName: string,
  phase: number,
  input: unknown,
  fn: () => Promise<T>
): Promise<T> {
  const run = await db.agentRun.create({
    data: { auditId, agentName, phase, status: 'running', inputJson: JSON.stringify(input) },
  })
  const t0 = Date.now()
  try {
    const result = await fn()
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: 'complete',
        outputJson: JSON.stringify(result),
        durationMs: Date.now() - t0,
        completedAt: new Date(),
      },
    })
    return result
  } catch (err) {
    await db.agentRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
        completedAt: new Date(),
      },
    })
    throw err
  }
}
