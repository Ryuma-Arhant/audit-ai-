import { Prisma } from '@prisma/client'
import { db } from '../lib/db'

export interface IQueue {
  dequeue(): Promise<string | null>
  fail(auditId: string, error: string): Promise<void>
}

export class SQLiteQueue implements IQueue {
  async dequeue(): Promise<string | null> {
    try {
      return await db.$transaction(async (tx) => {
        const audit = await tx.audit.findFirst({
          where: { status: 'queued' },
          orderBy: { createdAt: 'asc' },
        })
        if (!audit) return null

        // Compound-key guard: the update only matches if the row is still
        // 'queued'. If another worker claimed it between the findFirst and
        // this update, Prisma matches 0 rows and throws P2025 (caught below).
        await tx.audit.update({
          where: { id: audit.id, status: 'queued' },
          data: { status: 'running', startedAt: new Date() },
        })
        return audit.id
      })
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        // Lost the race: another worker claimed the audit first.
        return null
      }
      throw err
    }
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
