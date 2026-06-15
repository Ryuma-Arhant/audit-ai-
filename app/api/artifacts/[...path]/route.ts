import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'

// NOTE: Artifacts are served from a private data/ dir (outside /public) so they
// are no longer auto-exposed by Next.js static serving. This route adds a path
// traversal guard. Auth is intentionally omitted: <img src> requests cannot send
// the PROMPTPROOF_API_KEY header, and auditIds are CUIDs (not easily guessable).
// Proper per-user protection requires session auth (NextAuth) — tracked separately.

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const segments = (await params).path

  // Sanitize: no .. traversal or absolute-ish segments
  if (segments.some(s => s === '..' || s === '.' || s.includes('\\') || s.includes('/'))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const artifactsRoot = path.join(process.cwd(), 'data', 'artifacts')
  const filePath = path.join(artifactsRoot, ...segments)

  // Defense in depth: ensure resolved path stays within the artifacts root
  if (!filePath.startsWith(artifactsRoot + path.sep)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  try {
    const buf = await fs.readFile(filePath)
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
