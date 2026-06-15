import { NextResponse } from 'next/server'

const API_KEY = process.env.PROMPTPROOF_API_KEY

if (!API_KEY) {
  console.warn('[auth] PROMPTPROOF_API_KEY not set — running without authentication')
}

export function checkAuth(req: Request): NextResponse | null {
  if (!API_KEY) return null // dev mode: unauthenticated allowed
  const provided = req.headers.get('x-api-key')
  if (!provided || provided !== API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
