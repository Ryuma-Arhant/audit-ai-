import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'

const schema = z.object({
  url: z.string().url('Must be a valid URL'),
})

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 }
    )
  }

  const audit = await db.audit.create({
    data: {
      url: parsed.data.url,
      status: 'queued',
      config: JSON.stringify({ maxPages: 15, costLimitUsd: 0.50, timeLimitMs: 600_000 }),
    },
  })

  return NextResponse.json({ id: audit.id, status: audit.status })
}
