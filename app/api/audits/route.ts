import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { checkAuth } from '@/lib/auth'

export async function GET(req: Request) {
  const authErr = checkAuth(req)
  if (authErr) return authErr

  const audits = await db.audit.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id:              true,
      url:             true,
      status:          true,
      trustScore:      true,
      reliabilityScore: true,
      uxScore:         true,
      pagesCrawled:    true,
      durationMs:      true,
      costUsd:         true,
      createdAt:       true,
      completedAt:     true,
    },
  })
  return NextResponse.json(audits)
}

const schema = z.object({
  url: z.string().url('Must be a valid URL'),
})

// Block SSRF: reject private/internal/link-local hosts and non-http(s) protocols.
export function validateCrawlTarget(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Invalid URL'
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return 'Only http/https URLs allowed'
  }
  // Strip IPv6 brackets if present (e.g. "[::1]" -> "::1").
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost') return 'URL not allowed'
  if (/^127\./.test(host)) return 'URL not allowed'             // loopback
  if (/^10\./.test(host)) return 'URL not allowed'              // private class A
  if (/^192\.168\./.test(host)) return 'URL not allowed'        // private class C
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return 'URL not allowed' // private class B
  if (/^169\.254\./.test(host)) return 'URL not allowed'        // link-local / cloud metadata
  if (host === '::1') return 'URL not allowed'                  // IPv6 loopback
  return null
}

export async function POST(req: Request) {
  const authErr = checkAuth(req)
  if (authErr) return authErr

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

  const ssrfError = validateCrawlTarget(parsed.data.url)
  if (ssrfError) {
    return NextResponse.json({ error: ssrfError }, { status: 400 })
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
