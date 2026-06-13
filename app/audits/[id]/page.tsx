'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type Finding = {
  id: string
  severity: string
  confidence: number
  source: string
  type: string
  description: string
  pageUrl: string
  unverified: boolean
  reproduction: string | null
  screenshotPath: string | null
}

type Audit = {
  id: string
  url: string
  status: string
  trustScore: number | null
  reliabilityScore: number | null
  uxScore: number | null
  pagesCrawled: number
  costUsd: number | null
  durationMs: number | null
  findings: Finding[]
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'border-red-500 bg-red-50',
  high:     'border-orange-500 bg-orange-50',
  medium:   'border-yellow-500 bg-yellow-50',
  low:      'border-blue-500 bg-blue-50',
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const [audit, setAudit] = useState<Audit | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let active = true

    async function poll() {
      const res = await fetch(`/api/audits/${id}`)
      if (!active) return
      if (res.status === 404) { setNotFound(true); return }
      if (!res.ok) return
      const data: Audit = await res.json()
      setAudit(data)
      if (data.status !== 'complete' && data.status !== 'failed') {
        setTimeout(poll, 3000)
      }
    }

    poll()
    return () => { active = false }
  }, [id])

  if (notFound) return (
    <main className="p-8">
      <p className="text-red-600">Audit not found.</p>
      <a href="/" className="text-blue-600 hover:underline text-sm">← Back</a>
    </main>
  )

  if (!audit) return <div className="p-8 text-gray-400">Loading…</div>

  const confirmed  = audit.findings.filter(f => !f.unverified)
  const unverified = audit.findings.filter(f =>  f.unverified)

  return (
    <main className="max-w-2xl mx-auto p-8">
      <a href="/" className="text-sm text-blue-600 hover:underline">← New audit</a>

      <h1 className="text-2xl font-bold mt-4 mb-1">Audit Report</h1>
      <p className="text-gray-500 text-sm mb-6 break-all">{audit.url}</p>

      {(audit.status === 'queued' || audit.status === 'running') && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
          Auditing…{audit.pagesCrawled > 0 ? ` ${audit.pagesCrawled} pages crawled` : ''}
        </div>
      )}

      {audit.status === 'failed' && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          Audit failed
        </div>
      )}

      {audit.trustScore !== null && (
        <div className="mb-8 py-8 text-center bg-white border rounded-xl">
          <div className="text-7xl font-bold tabular-nums">{audit.trustScore}</div>
          <div className="text-gray-500 mt-1 text-sm">Trust Score</div>
          <div className="mt-2 text-xs text-gray-400 space-x-3">
            <span>Reliability: {audit.reliabilityScore ?? '—'}</span>
            <span>UX: {audit.uxScore ?? '—'}</span>
            {audit.costUsd    !== null && <span>${audit.costUsd.toFixed(4)}</span>}
            {audit.durationMs !== null && <span>{(audit.durationMs / 1000).toFixed(1)}s</span>}
          </div>
        </div>
      )}

      {confirmed.length > 0 && (
        <div className="space-y-3 mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Findings ({confirmed.length})
          </h2>
          {confirmed.map(f => (
            <div
              key={f.id}
              className={`p-4 rounded-lg border-l-4 ${SEVERITY_STYLES[f.severity] ?? 'border-gray-300 bg-gray-50'}`}
            >
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide mb-1">
                <span>{f.severity}</span>
                <span className="opacity-30">·</span>
                <span className="font-normal normal-case opacity-60">
                  {f.confidence.toFixed(1)} confidence
                </span>
                <span className="opacity-30">·</span>
                <span className="font-normal normal-case opacity-60">{f.source}</span>
              </div>
              <p className="text-sm">{f.description}</p>
              <p className="text-xs text-gray-400 mt-1 break-all">{f.pageUrl}</p>
            </div>
          ))}
        </div>
      )}

      {unverified.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-gray-400 hover:text-gray-600">
            {unverified.length} unverified finding{unverified.length > 1 ? 's' : ''} (not scored)
          </summary>
          <div className="mt-2 space-y-2">
            {unverified.map(f => (
              <div key={f.id} className="p-3 rounded border border-gray-200 bg-gray-50">
                <div className="text-xs text-amber-600 font-medium mb-1 uppercase">
                  Unverified · {f.source}
                </div>
                <p className="text-sm text-gray-600">{f.description}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </main>
  )
}
