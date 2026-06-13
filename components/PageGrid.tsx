'use client'
import { useState } from 'react'

type PageFinding = { id: string; severity: string; unverified: boolean }

export type PageData = {
  id: string
  url: string
  title: string | null
  httpStatus: number
  loadTimeMs: number | null
  screenshotPath: string | null
  actions: string      // JSON string
  findings: PageFinding[]
}

const HTTP_COLOR: (s: number) => string = s =>
  s >= 500 ? 'bg-red-100 text-red-700'
  : s >= 400 ? 'bg-orange-100 text-orange-700'
  : s >= 300 ? 'bg-yellow-100 text-yellow-700'
  : 'bg-green-100 text-green-700'

const SEV_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-400',
  medium:   'bg-yellow-400',
  low:      'bg-blue-400',
}

function findingDots(findings: PageFinding[]) {
  const confirmed = findings.filter(f => !f.unverified)
  const counts: Record<string, number> = {}
  for (const f of confirmed) counts[f.severity] = (counts[f.severity] ?? 0) + 1
  return Object.entries(counts).sort((a, b) => {
    const order = ['critical','high','medium','low']
    return order.indexOf(a[0]) - order.indexOf(b[0])
  })
}

interface Props { pages: PageData[] }

export function PageGrid({ pages }: Props) {
  const [full, setFull] = useState<string | null>(null)

  if (pages.length === 0) return null

  return (
    <div className="mt-8">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
        Pages crawled ({pages.length})
      </div>

      <div className="grid grid-cols-2 gap-3">
        {pages.map(page => {
          const dots = findingDots(page.findings)
          const actionCount = (() => {
            try { return (JSON.parse(page.actions) as unknown[]).length }
            catch { return 0 }
          })()

          return (
            <div
              key={page.id}
              className="border border-gray-200 rounded-xl overflow-hidden bg-white hover:border-blue-300 hover:shadow-sm transition-all"
            >
              {/* Screenshot */}
              <div
                className="relative bg-gray-100 h-32 cursor-pointer overflow-hidden"
                onClick={() => page.screenshotPath && setFull(page.screenshotPath)}
              >
                {page.screenshotPath ? (
                  <img
                    src={page.screenshotPath}
                    alt={page.title ?? page.url}
                    className="w-full h-full object-cover object-top"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">
                    No screenshot
                  </div>
                )}
                {/* HTTP status badge over screenshot */}
                <span className={`absolute top-2 right-2 text-xs font-semibold px-1.5 py-0.5 rounded ${HTTP_COLOR(page.httpStatus)}`}>
                  {page.httpStatus}
                </span>
              </div>

              {/* Meta */}
              <div className="p-3">
                <p className="text-xs font-medium text-gray-700 truncate" title={page.url}>
                  {page.title ?? page.url}
                </p>
                <p className="text-xs text-gray-400 truncate mb-2" title={page.url}>
                  {page.url}
                </p>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Load time */}
                  {page.loadTimeMs !== null && (
                    <span className="text-xs text-gray-400">
                      {(page.loadTimeMs / 1000).toFixed(1)}s
                    </span>
                  )}
                  {/* Interactive elements */}
                  {actionCount > 0 && (
                    <span className="text-xs text-gray-400">
                      {actionCount} element{actionCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {/* Finding severity dots */}
                  {dots.length > 0 && (
                    <div className="flex gap-1 items-center ml-auto">
                      {dots.map(([sev, count]) => (
                        <span key={sev} className="flex items-center gap-0.5">
                          <span className={`w-2 h-2 rounded-full inline-block ${SEV_DOT[sev] ?? 'bg-gray-400'}`} />
                          <span className="text-xs text-gray-500">{count}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {dots.length === 0 && page.findings.length === 0 && (
                    <span className="text-xs text-green-600 ml-auto">✓ clean</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Lightbox */}
      {full && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-start justify-center p-8 overflow-auto"
          onClick={() => setFull(null)}
        >
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setFull(null)}
              className="absolute -top-8 right-0 text-white text-sm hover:text-gray-300"
            >
              ✕ close
            </button>
            <img src={full} alt="Page screenshot" className="max-w-3xl w-full rounded-lg shadow-2xl" />
          </div>
        </div>
      )}
    </div>
  )
}
