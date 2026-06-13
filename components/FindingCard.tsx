'use client'
import { useState } from 'react'

const SEVERITY_STYLES: Record<string, { border: string; badge: string }> = {
  critical: { border: 'border-l-red-500',    badge: 'bg-red-100 text-red-700' },
  high:     { border: 'border-l-orange-500', badge: 'bg-orange-100 text-orange-700' },
  medium:   { border: 'border-l-yellow-500', badge: 'bg-yellow-100 text-yellow-700' },
  low:      { border: 'border-l-blue-500',   badge: 'bg-blue-100 text-blue-700' },
}

const TYPE_LABELS: Record<string, string> = {
  http_error:         'HTTP Error',
  console_error:      'Console Error',
  broken_link:        'Broken Link',
  action_failure:     'Action Failure',
  stall:              'Stall',
  persistence_loss:   'Persistence Loss',
  ux_incoherence:     'UX Incoherence',
  auth_dead_end:      'Auth Dead End',
  hallucinated_route: 'Hallucinated Route',
}

const SOURCE_LABELS: Record<string, string> = {
  deterministic: 'deterministic',
  llm_agent:     'agent',
  llm_judge:     'ai-judge',
}

export interface FindingData {
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

export function FindingCard({ finding }: { finding: FindingData }) {
  const [open, setOpen] = useState(false)
  const styles = SEVERITY_STYLES[finding.severity] ?? { border: 'border-l-gray-300', badge: 'bg-gray-100 text-gray-700' }
  const typeLabel = TYPE_LABELS[finding.type] ?? finding.type

  return (
    <div className={`border border-gray-200 border-l-4 ${styles.border} rounded-lg bg-white shadow-sm`}>
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded ${styles.badge}`}>
            {finding.severity}
          </span>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
            {typeLabel}
          </span>
          <span className="text-xs text-gray-400 ml-auto">
            {SOURCE_LABELS[finding.source] ?? finding.source} · {finding.confidence.toFixed(1)} conf
          </span>
        </div>

        {/* Description */}
        <p className="text-sm text-gray-800 leading-relaxed">{finding.description}</p>

        {/* Page URL */}
        <p className="text-xs text-gray-400 mt-1 truncate" title={finding.pageUrl}>
          {finding.pageUrl}
        </p>

        {/* Reproduction toggle */}
        {finding.reproduction && (
          <button
            onClick={() => setOpen(o => !o)}
            className="mt-3 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            <span>{open ? '▾' : '▸'}</span>
            <span>Reproduction steps</span>
          </button>
        )}
      </div>

      {/* Expanded reproduction */}
      {open && finding.reproduction && (
        <div className="px-4 pb-4">
          <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 whitespace-pre-wrap font-mono text-gray-700 leading-relaxed">
            {finding.reproduction}
          </pre>
        </div>
      )}
    </div>
  )
}

export function UnverifiedCard({ finding }: { finding: FindingData }) {
  const typeLabel = TYPE_LABELS[finding.type] ?? finding.type
  return (
    <div className="border border-gray-200 border-l-4 border-l-gray-300 rounded-lg bg-gray-50 opacity-70 p-3">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-xs font-semibold text-amber-600 uppercase">Unverified</span>
        <span className="text-xs text-gray-400 bg-white px-2 py-0.5 rounded border border-gray-200">{typeLabel}</span>
        <span className="text-xs text-gray-400 ml-auto">{SOURCE_LABELS[finding.source] ?? finding.source}</span>
      </div>
      <p className="text-sm text-gray-600">{finding.description}</p>
      <p className="text-xs text-gray-400 mt-1 truncate" title={finding.pageUrl}>{finding.pageUrl}</p>
    </div>
  )
}
