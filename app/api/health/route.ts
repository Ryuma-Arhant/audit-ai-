import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  let dbStatus: 'ok' | 'error' = 'ok'
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ])
  } catch {
    dbStatus = 'error'
  }

  const status = dbStatus === 'ok' ? 'ok' : 'degraded'
  return NextResponse.json(
    { status, db: dbStatus, ts: new Date().toISOString() },
    { status: dbStatus === 'ok' ? 200 : 503 }
  )
}
