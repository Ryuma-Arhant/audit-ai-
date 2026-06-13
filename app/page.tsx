'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type AuditSummary = {
  id: string
  url: string
  status: string
  trustScore: number | null
  pagesCrawled: number
  durationMs: number | null
  createdAt: string
}

const STATUS_STYLES: Record<string, string> = {
  complete: 'bg-green-100 text-green-700',
  running:  'bg-blue-100 text-blue-700',
  queued:   'bg-gray-100 text-gray-500',
  failed:   'bg-red-100 text-red-600',
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-600'
  if (score >= 60) return 'text-yellow-600'
  if (score >= 40) return 'text-orange-500'
  return 'text-red-600'
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function Home() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<AuditSummary[]>([])
  const router = useRouter()

  useEffect(() => {
    fetch('/api/audits')
      .then(r => r.ok ? r.json() : [])
      .then(setHistory)
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to start audit')
        return
      }
      router.push(`/audits/${data.id}`)
    } catch {
      setError('Network error — check your connection')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-4xl font-bold mb-2 tracking-tight">PromptProof</h1>
          <p className="text-gray-500">Autonomous QA for AI-generated apps</p>
        </div>

        {/* URL form */}
        <form onSubmit={handleSubmit} className="flex gap-2 mb-2">
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://myapp.emergent.sh"
            required
            className="flex-1 border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors"
          >
            {loading ? 'Starting…' : 'Audit'}
          </button>
        </form>
        {error && <p className="mb-6 text-red-600 text-sm">{error}</p>}

        {/* History */}
        {history.length > 0 && (
          <div className="mt-10">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
              Recent audits
            </h2>
            <div className="space-y-2">
              {history.map(audit => (
                <a
                  key={audit.id}
                  href={`/audits/${audit.id}`}
                  className="flex items-center gap-3 p-4 bg-white border border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-sm transition-all group"
                >
                  {/* Score badge */}
                  <div className="w-12 text-center shrink-0">
                    {audit.trustScore !== null ? (
                      <span className={`text-xl font-bold tabular-nums ${scoreColor(audit.trustScore)}`}>
                        {audit.trustScore}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xl">—</span>
                    )}
                  </div>

                  {/* URL + meta */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate group-hover:text-blue-600 transition-colors">
                      {audit.url}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {audit.pagesCrawled > 0 ? `${audit.pagesCrawled} pages` : '—'}
                      {audit.durationMs ? ` · ${(audit.durationMs / 1000).toFixed(1)}s` : ''}
                      {' · '}{timeAgo(audit.createdAt)}
                    </p>
                  </div>

                  {/* Status chip */}
                  <span className={`text-xs px-2 py-1 rounded-full font-medium shrink-0 ${STATUS_STYLES[audit.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {audit.status}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
