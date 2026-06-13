import { db } from '../lib/db'

export interface IQueue {
  dequeue(): Promise<string | null>
  fail(auditId: string, error: string): Promise<void>
}

export class SQLiteQueue implements IQueue {
  async dequeue(): Promise<string | null> {
    const audit = await db.audit.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
    })
    if (!audit) return null

    await db.audit.update({
      where: { id: audit.id },
      data: { status: 'running', startedAt: new Date() },
    })
    return audit.id
  }

  async fail(auditId: string, error: string): Promise<void> {
    await db.audit.update({
      where: { id: auditId },
      data: {
        status: 'failed',
        errorMessage: error,
        completedAt: new Date(),
      },
    })
  }
}
