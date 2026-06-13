type AgentRun = {
  agentName: string
  phase: number
  status: string
  durationMs: number | null
  errorMessage: string | null
}

type PhaseState = 'waiting' | 'running' | 'complete' | 'partial' | 'failed'

interface PhaseRow {
  label: string
  agents: string
  state: PhaseState
  durationMs: number | null
}

function derivePhaseState(runs: AgentRun[]): PhaseState {
  if (runs.length === 0) return 'waiting'
  if (runs.some(r => r.status === 'running')) return 'running'
  const allComplete = runs.every(r => r.status === 'complete')
  if (allComplete) return 'complete'
  const anyFailed = runs.some(r => r.status === 'failed')
  const anyComplete = runs.some(r => r.status === 'complete')
  if (anyFailed && anyComplete) return 'partial'
  if (anyFailed) return 'failed'
  return 'waiting'
}

function totalDuration(runs: AgentRun[]): number | null {
  if (runs.length === 0) return null
  const valid = runs.map(r => r.durationMs ?? 0)
  if (valid.length === 0) return null
  return Math.max(...valid)
}

const STATE_ICON: Record<PhaseState, string> = {
  waiting:  '○',
  running:  '●',
  complete: '✓',
  partial:  '⚠',
  failed:   '✗',
}

const STATE_COLOR: Record<PhaseState, string> = {
  waiting:  'text-gray-300',
  running:  'text-blue-500 animate-pulse',
  complete: 'text-green-500',
  partial:  'text-amber-500',
  failed:   'text-red-500',
}

const LABEL_COLOR: Record<PhaseState, string> = {
  waiting:  'text-gray-400',
  running:  'text-blue-700 font-medium',
  complete: 'text-gray-700',
  partial:  'text-amber-700',
  failed:   'text-red-600',
}

function fmt(ms: number | null): string {
  if (ms === null) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface Props {
  auditStatus: string
  pagesCrawled: number
  agentRuns: AgentRun[]
}

export function PipelineStatus({ auditStatus, pagesCrawled, agentRuns }: Props) {
  const phaseRuns = (n: number) => agentRuns.filter(r => r.phase === n)

  // Derive crawl state
  const crawlState: PhaseState =
    pagesCrawled > 0  ? 'complete'
    : auditStatus === 'running' ? 'running'
    : auditStatus === 'failed'  ? 'failed'
    : 'waiting'

  // Checks run before any agentRun exists; complete once phase-1 runs appear
  const checksState: PhaseState =
    phaseRuns(1).length > 0 ? 'complete'
    : crawlState === 'complete' && auditStatus === 'running' ? 'running'
    : crawlState === 'complete' && auditStatus !== 'running' ? 'complete'
    : 'waiting'

  const rows: PhaseRow[] = [
    {
      label:    'Crawl',
      agents:   `${pagesCrawled > 0 ? pagesCrawled + ' pages' : '—'}`,
      state:    crawlState,
      durationMs: null,
    },
    {
      label:    'Checks',
      agents:   'http · console · links · actions · stall · persistence',
      state:    checksState,
      durationMs: null,
    },
    {
      label:    'Phase A',
      agents:   'ui-inferrer · error-classifier',
      state:    derivePhaseState(phaseRuns(1)),
      durationMs: totalDuration(phaseRuns(1)),
    },
    {
      label:    'Phase B',
      agents:   'test-generator · agentic-explorer',
      state:    derivePhaseState(phaseRuns(2)),
      durationMs: totalDuration(phaseRuns(2)),
    },
    {
      label:    'Phase C',
      agents:   'root-cause-analyzer · ai-judge',
      state:    derivePhaseState(phaseRuns(3)),
      durationMs: totalDuration(phaseRuns(3)),
    },
    {
      label:    'Synthesis',
      agents:   'report-synthesizer',
      state:    derivePhaseState(phaseRuns(4)),
      durationMs: totalDuration(phaseRuns(4)),
    },
  ]

  const failed = agentRuns.filter(r => r.status === 'failed' && r.errorMessage)

  return (
    <div className="mb-8 border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Pipeline
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(row => (
          <div key={row.label} className="flex items-center gap-3 px-4 py-2.5">
            <span className={`w-4 text-center font-bold text-sm ${STATE_COLOR[row.state]}`}>
              {STATE_ICON[row.state]}
            </span>
            <span className={`w-20 text-sm ${LABEL_COLOR[row.state]}`}>
              {row.label}
            </span>
            <span className="flex-1 text-xs text-gray-400 truncate">
              {row.agents}
            </span>
            {row.durationMs !== null && (
              <span className="text-xs text-gray-400 tabular-nums">
                {fmt(row.durationMs)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Agent errors */}
      {failed.length > 0 && (
        <div className="border-t border-gray-200 px-4 py-3 bg-red-50">
          {failed.map(r => (
            <p key={r.agentName} className="text-xs text-red-600">
              <span className="font-medium">{r.agentName}:</span> {r.errorMessage}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
