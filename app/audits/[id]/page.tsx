'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ScoreRing } from '@/components/ScoreRing'
import { FindingCard, UnverifiedCard } from '@/components/FindingCard'
import { PipelineStatus } from '@/components/PipelineStatus'
import { PageGrid } from '@/components/PageGrid'
import type { FindingData } from '@/components/FindingCard'
import type { PageData } from '@/components/PageGrid'

type AgentRun = {
  id: string
  agentName: string
  phase: number
  status: string
  durationMs: number | null
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
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
  findings: FindingData[]
  agentRuns: AgentRun[]
  pages: PageData[]
}

type Filter = 'all' | 'critical' | 'high' | 'medium' | 'low' | 'unverified'

function countBySeverity(findings: FindingData[]) {
  const confirmed = findings.filter(f => !f.unverified)
  return {
    all:        confirmed.length,
    critical:   confirmed.filter(f => f.severity === 'critical').length,
    high:       confirmed.filter(f => f.severity === 'high').length,
    medium:     confirmed.filter(f => f.severity === 'medium').length,
    low:        confirmed.filter(f => f.severity === 'low').length,
    unverified: findings.filter(f => f.unverified).length,
  }
}

const FILTER_LABELS: Array<{ key: Filter; label: string }> = [
  { key: 'all',        label: 'All' },
  { key: 'critical',   label: 'Critical' },
  { key: 'high',       label: 'High' },
  { key: 'medium',     label: 'Medium' },
  { key: 'low',        label: 'Low' },
  { key: 'unverified', label: 'Unverified' },
]

const FILTER_ACTIVE: Record<Filter, string> = {
  all:        'bg-gray-800 text-white',
  critical:   'bg-red-600 text-white',
  high:       'bg-orange-500 text-white',
  medium:     'bg-yellow-500 text-white',
  low:        'bg-blue-500 text-white',
  unverified: 'bg-amber-500 text-white',
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const [audit, setAudit] = useState<Audit | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

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

  const isLive = audit.status === 'queued' || audit.status === 'running'
  const counts = countBySeverity(audit.findings)
  const confirmed  = audit.findings.filter(f => !f.unverified)
  const unverified = audit.findings.filter(f =>  f.unverified)

  const visibleFindings = filter === 'unverified'
    ? []
    : filter === 'all'
      ? confirmed
      : confirmed.filter(f => f.severity === filter)

  const showUnverified = filter === 'unverified' || filter === 'all'

  return (
    <main className="max-w-2xl mx-auto p-8">
      <a href="/" className="text-sm text-blue-600 hover:underline">← New audit</a>

      <h1 className="text-2xl font-bold mt-4 mb-1">Audit Report</h1>
      <p className="text-gray-500 text-sm mb-6 break-all">{audit.url}</p>

      {audit.status === 'failed' && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          Audit failed
        </div>
      )}

      {/* Pipeline progress — always show while live, collapsible when done */}
      {audit.status !== 'failed' && (isLive || audit.agentRuns.length > 0) && (
        <PipelineStatus
          auditStatus={audit.status}
          pagesCrawled={audit.pagesCrawled}
          agentRuns={audit.agentRuns}
        />
      )}

      {audit.trustScore !== null && (
        <ScoreRing
          trustScore={audit.trustScore}
          reliabilityScore={audit.reliabilityScore}
          uxScore={audit.uxScore}
          durationMs={audit.durationMs}
        />
      )}

      {audit.findings.length > 0 && (
        <>
          <div className="flex gap-2 flex-wrap mb-5">
            {FILTER_LABELS.map(({ key, label }) => {
              const count = counts[key]
              if (count === 0 && key !== 'all') return null
              const isActive = filter === key
              return (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                    isActive
                      ? FILTER_ACTIVE[key]
                      : 'border-gray-200 text-gray-600 hover:border-gray-400 bg-white'
                  }`}
                >
                  {label}
                  {count > 0 && (
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${
                      isActive ? 'bg-white/20' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {visibleFindings.length > 0 ? (
            <div className="space-y-3 mb-6">
              {visibleFindings.map(f => <FindingCard key={f.id} finding={f} />)}
            </div>
          ) : filter !== 'unverified' && filter !== 'all' && (
            <p className="text-sm text-gray-400 mb-6">No {filter} findings.</p>
          )}

          {showUnverified && unverified.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
                Unverified ({unverified.length}) — not scored
              </div>
              <div className="space-y-2">
                {unverified.map(f => <UnverifiedCard key={f.id} finding={f} />)}
              </div>
            </div>
          )}
        </>
      )}

      {audit.status === 'complete' && audit.findings.length === 0 && (
        <div className="py-12 text-center text-gray-400 text-sm">
          No issues found.
        </div>
      )}

      <PageGrid pages={audit.pages ?? []} />
    </main>
  )
}
