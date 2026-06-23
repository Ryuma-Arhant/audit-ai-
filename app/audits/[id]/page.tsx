'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { PipelineStatus } from '@/components/PipelineStatus'
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
  durationMs: number | null
  findings: FindingData[]
  agentRuns: AgentRun[]
  pages: PageData[]
}

type CategoryFilter = 'all' | 'ux' | 'a11y' | 'perf' | 'security' | 'mobile'
type ScoreLayout = 'radial' | 'banner'

function scoreToGrade(s: number): string {
  if (s >= 90) return 'A+'
  if (s >= 85) return 'A'
  if (s >= 80) return 'B+'
  if (s >= 75) return 'B'
  if (s >= 70) return 'C+'
  if (s >= 60) return 'C'
  if (s >= 50) return 'D'
  return 'F'
}

function scoreLabel(s: number): string {
  if (s >= 80) return 'Good'
  if (s >= 60) return 'Fair'
  if (s >= 40) return 'Poor'
  return 'Critical'
}

function scoreColor(s: number | null): string {
  if (s === null) return 'var(--muted)'
  if (s >= 80) return 'var(--teal)'
  if (s >= 60) return 'var(--amber)'
  return 'var(--coral)'
}

function tint(hex: string, a: number): string {
  const n = parseInt(hex.replace('#',''), 16)
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`
}

function sevColor(sev: string) {
  switch (sev) {
    case 'critical': return { color: '#E2574C', tint: tint('#E2574C', 0.13) }
    case 'high':     return { color: '#E5A33D', tint: tint('#E5A33D', 0.13) }
    case 'medium':   return { color: '#E8D26B', tint: tint('#E8D26B', 0.13) }
    case 'low':      return { color: '#808AA0', tint: tint('#808AA0', 0.13) }
    default:         return { color: '#9A9A9A', tint: 'rgba(154,154,154,0.13)' }
  }
}

function Sparkline({ color, d }: { color: string; d: string }) {
  const pts = d.trim().split(' ')
  const last = pts[pts.length - 1].split(',')
  const cy = last[1]
  return (
    <svg width="100%" height="30" viewBox="0 0 130 30" preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth="1.7"/>
      <circle cx="128" cy={cy} r="2.4" fill={color}/>
    </svg>
  )
}

function RadialGauge({ score }: { score: number }) {
  const r = 86
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - score / 100)
  const color = scoreColor(score)
  return (
    <div style={{ position: 'relative', width: '200px', height: '200px', margin: '12px auto 0' }}>
      <svg width="200" height="200" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="11"/>
        <circle
          cx="100" cy="100" r={r} fill="none" stroke={color} strokeWidth="11"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          transform="rotate(-90 100 100)"
          style={{ filter: `drop-shadow(0 0 8px ${color}44)` }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: 'var(--serif)', fontSize: '66px', lineHeight: 1, letterSpacing: '-0.02em', color: 'var(--text)' }}>{score}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color, marginTop: '4px', letterSpacing: '0.05em' }}>
          {scoreLabel(score).toUpperCase()} · {scoreToGrade(score)}
        </div>
      </div>
    </div>
  )
}

const CATS = [
  { key: 'ux',          name: 'UX & design',   color: '#8B7FE8', badge: 'LLM',      spk: 'M0,22 C16,20 26,12 42,14 C58,16 70,8 86,9 C102,10 114,5 128,6',    metricKey: 'design quality', scoreField: 'uxScore',          icon: <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M10 3l1.6 3.6L15.5 7l-2.8 2.6.8 4-3.5-2-3.5 2 .8-4L4.5 7l3.9-.4L10 3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg> },
  { key: 'a11y',        name: 'Accessibility',  color: '#E5A33D', badge: 'WCAG AA',  spk: 'M0,10 C16,12 26,18 42,16 C58,14 70,19 86,17 C102,15 114,18 128,14',  metricKey: 'violations',     scoreField: null,               icon: <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="4" r="1.6" fill="currentColor"/><path d="M3 7H17M10 7V13M10 13L7 17.5M10 13L13 17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  { key: 'perf',        name: 'Performance',    color: '#3DD9A0', badge: 'CWV',      spk: 'M0,24 C16,22 26,16 42,14 C58,12 70,8 86,7 C102,6 114,4 128,3',      metricKey: 'LCP',            scoreField: null,               icon: <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M3 14a7 7 0 1114 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M10 14L13 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
  { key: 'security',    name: 'Security',       color: '#E2574C', badge: 'SEC',      spk: 'M0,8 C16,10 26,13 42,12 C58,11 70,16 86,18 C102,20 114,17 128,21',   metricKey: 'critical',       scoreField: null,               icon: <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M10 2.5L16 5V10C16 14 13.3 16.5 10 17.5C6.7 16.5 4 14 4 10V5L10 2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg> },
  { key: 'reliability', name: 'Reliability',    color: '#3DD9A0', badge: 'OK',       spk: 'M0,16 C16,15 26,13 42,14 C58,15 70,11 86,12 C102,13 114,9 128,10',   metricKey: 'broken links',   scoreField: 'reliabilityScore', icon: <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M3 10a7 7 0 0114 0M3 10a7 7 0 0014 0" stroke="currentColor" strokeWidth="1.4"/><circle cx="10" cy="10" r="2" fill="currentColor"/></svg> },
  { key: 'mobile',      name: 'Mobile',         color: '#808AA0', badge: 'RESP',     spk: 'M0,12 C16,14 26,11 42,13 C58,15 70,12 86,14 C102,16 114,11 128,12',  metricKey: 'layout breaks',  scoreField: null,               icon: <svg width="16" height="16" viewBox="0 0 20 20" fill="none"><rect x="6" y="2.5" width="8" height="15" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M9 15h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg> },
]

function CategoryCard({ cat, score, findings }: { cat: typeof CATS[0]; score: number | null; findings: FindingData[] }) {
  const catCount = findings.filter(f =>
    !f.unverified && (
      cat.key === 'ux' ? ['ux_incoherence', 'auth_dead_end'].includes(f.type)
      : cat.key === 'reliability' ? ['broken_link', 'http_error', 'console_error', 'stall'].includes(f.type)
      : cat.key === 'a11y' ? false
      : false
    )
  ).length

  const displayScore = score
  const colorVal = cat.color

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', padding: '18px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '8px', background: 'var(--surface2)', border: '1px solid var(--border)', color: colorVal, flexShrink: 0 }}>
          {cat.icon}
        </span>
        <span style={{ flex: 1, fontSize: '14px' }}>{cat.name}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '9.5px', color: colorVal, background: tint(colorVal, 0.13), padding: '2px 7px', borderRadius: '5px', letterSpacing: '0.03em' }}>{cat.badge}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '9px' }}>
        <span style={{ fontFamily: 'var(--serif)', fontSize: '42px', lineHeight: 0.9, letterSpacing: '-0.02em', color: displayScore !== null ? scoreColor(displayScore) : 'var(--faint)' }}>
          {displayScore !== null ? displayScore : '—'}
        </span>
        {catCount > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11.5px', color: 'var(--coral)', background: tint('#E2574C', 0.12), padding: '2px 6px', borderRadius: '5px', marginBottom: '4px' }}>
            {catCount} issue{catCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <span style={{ display: 'block', marginTop: '10px' }}>
        <Sparkline color={colorVal} d={cat.spk} />
      </span>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--faint)', marginTop: '10px', borderTop: '1px solid var(--border)', paddingTop: '9px' }}>
        <span>{cat.metricKey}</span>
        <span style={{ color: colorVal }}>{displayScore !== null ? displayScore : '—'}</span>
      </div>
    </div>
  )
}

function IssueRow({ finding, expanded, onToggle }: { finding: FindingData; expanded: boolean; onToggle: () => void }) {
  const { color, tint: tintVal } = sevColor(finding.severity)
  return (
    <div
      onClick={onToggle}
      style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color, background: tintVal, padding: '2px 7px', borderRadius: '5px', letterSpacing: '0.03em', flexShrink: 0, textTransform: 'uppercase' }}>
          {finding.severity}
        </span>
        <span style={{ flex: 1, fontFamily: 'var(--serif)', fontSize: '16px', letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {finding.description}
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--muted)', background: 'var(--bg)', padding: '2px 6px', borderRadius: '5px', flexShrink: 0 }}>
          {finding.type.replace(/_/g, ' ')}
        </span>
        <svg
          width="13" height="13" viewBox="0 0 14 14" fill="none"
          style={{ color: 'var(--faint)', flexShrink: 0, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform .15s' }}
        >
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--bluegray)', marginTop: '7px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {finding.pageUrl}
      </div>
      {expanded && (
        <div style={{ marginTop: '12px' }}>
          {finding.reproduction && (
            <div style={{ marginTop: '10px', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)', letterSpacing: '0.04em', marginBottom: '6px' }}>REPRODUCTION STEPS</div>
          )}
          {finding.reproduction && (
            <div style={{ background: '#101010', border: '1px solid var(--border)', borderRadius: '8px', padding: '11px 13px', fontFamily: 'var(--mono)', fontSize: '11.5px', lineHeight: 1.7, color: 'var(--muted)', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
              {finding.reproduction}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [audit, setAudit] = useState<Audit | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [scoreLayout, setScoreLayout] = useState<ScoreLayout>('radial')
  const [catFilter, setCatFilter] = useState<CategoryFilter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
    <AppShell activeNav="audits">
      <div style={{ padding: '48px 28px', color: 'var(--coral)' }}>Audit not found.</div>
    </AppShell>
  )

  if (!audit) return (
    <AppShell activeNav="audits">
      <div style={{ padding: '48px 28px', color: 'var(--faint)', fontFamily: 'var(--mono)', fontSize: '13px' }}>Loading…</div>
    </AppShell>
  )

  const isLive = audit.status === 'queued' || audit.status === 'running'
  const confirmed = audit.findings.filter(f => !f.unverified)

  const CAT_FILTER_MAP: Record<CategoryFilter, string[]> = {
    all:      [],
    ux:       ['ux_incoherence', 'auth_dead_end', 'hallucinated_route'],
    a11y:     [],
    perf:     ['stall'],
    security: [],
    mobile:   [],
  }

  const visibleFindings = catFilter === 'all'
    ? confirmed
    : confirmed.filter(f => {
        const types = CAT_FILTER_MAP[catFilter]
        return types.length === 0 ? false : types.includes(f.type)
      })

  const hostname = (() => { try { return new URL(audit.url).hostname } catch { return audit.url } })()
  const overallScore = audit.trustScore

  const statusStyle: Record<string, string> = {
    complete: 'var(--teal)',
    running:  'var(--violet)',
    queued:   'var(--faint)',
    failed:   'var(--coral)',
  }
  const statusBg: Record<string, string> = {
    complete: 'rgba(61,217,160,0.12)',
    running:  'rgba(139,127,232,0.12)',
    queued:   'rgba(102,102,102,0.12)',
    failed:   'rgba(226,87,76,0.12)',
  }

  const getScoreForCat = (cat: typeof CATS[0]): number | null => {
    if (cat.scoreField === 'uxScore') return audit.uxScore
    if (cat.scoreField === 'reliabilityScore') return audit.reliabilityScore
    return overallScore
  }

  return (
    <AppShell activeNav="audits">
      <div style={{ padding: '24px 28px 60px' }}>

        {/* Tabs + filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', gap: '4px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '3px' }}>
            {(['all', 'ux', 'a11y', 'perf', 'security', 'mobile'] as CategoryFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setCatFilter(f)}
                style={{ padding: '6px 13px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', border: 'none', color: catFilter === f ? 'var(--text)' : 'var(--muted)', background: catFilter === f ? 'var(--surface2)' : 'transparent' }}
              >
                {f === 'all' ? 'All' : f === 'a11y' ? 'A11y' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          {/* Score view toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--faint)' }}>score view</span>
            <div style={{ display: 'flex', gap: '3px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '9px', padding: '3px' }}>
              {(['radial', 'banner'] as ScoreLayout[]).map(l => (
                <button
                  key={l}
                  onClick={() => setScoreLayout(l)}
                  style={{ padding: '6px 12px', borderRadius: '7px', fontSize: '12px', cursor: 'pointer', border: 'none', color: scoreLayout === l ? 'var(--text)' : 'var(--muted)', background: scoreLayout === l ? 'var(--surface2)' : 'transparent' }}
                >
                  {l === 'radial' ? 'Radial gauge' : 'Score banner'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Section header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '11.5px', color: 'var(--faint)', letterSpacing: '0.04em' }}>
                {audit.pagesCrawled > 0 ? `Audited ${audit.pagesCrawled} pages` : 'Auditing…'}
                {audit.durationMs ? ` · ${(audit.durationMs / 1000).toFixed(1)}s` : ''}
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: statusStyle[audit.status] ?? 'var(--muted)', background: statusBg[audit.status] ?? 'rgba(154,154,154,0.12)', padding: '2px 8px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: statusStyle[audit.status] ?? 'var(--muted)', animation: isLive ? 'blink 1.2s infinite' : undefined }} />
                {audit.status}
              </span>
            </div>
            <h1 style={{ fontFamily: 'var(--serif)', fontSize: '34px', fontWeight: 400, letterSpacing: '-0.02em', margin: 0 }}>
              Health report — {hostname}
            </h1>
          </div>
        </div>

        {/* Failed state */}
        {audit.status === 'failed' && (
          <div style={{ marginBottom: '16px', padding: '16px', background: tint('#E2574C', 0.08), border: '1px solid var(--coral)', borderRadius: '12px', color: 'var(--coral)', fontSize: '14px' }}>
            Audit failed. Check that the URL is accessible and try again.
          </div>
        )}

        {/* Radial gauge hero */}
        {scoreLayout === 'radial' && overallScore !== null && (
          <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '16px', marginBottom: '16px' }}>
            {/* Gauge card */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--faint)', letterSpacing: '0.06em', alignSelf: 'flex-start' }}>OVERALL HEALTH</div>
              <RadialGauge score={overallScore} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: scoreColor(overallScore), marginTop: '14px' }}>
                {scoreLabel(overallScore)} · {scoreToGrade(overallScore)}
              </div>
              <div style={{ width: '100%', borderTop: '1px solid var(--border)', marginTop: '18px', paddingTop: '14px', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--faint)' }}>
                <span>{audit.pagesCrawled} pages</span>
                <span>{audit.findings.filter(f => !f.unverified).length} findings</span>
                <span style={{ color: 'var(--coral)' }}>{audit.findings.filter(f => !f.unverified && f.severity === 'critical').length} critical</span>
              </div>
            </div>
            {/* Category grid 2×3 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gridTemplateRows: '1fr 1fr', gap: '16px' }}>
              {CATS.map(cat => (
                <CategoryCard key={cat.key} cat={cat} score={getScoreForCat(cat)} findings={audit.findings} />
              ))}
            </div>
          </div>
        )}

        {/* Score banner hero */}
        {scoreLayout === 'banner' && overallScore !== null && (
          <>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', padding: '24px 26px', marginBottom: '16px', display: 'grid', gridTemplateColumns: '280px 1px 1fr', gap: '26px', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--faint)', letterSpacing: '0.06em', marginBottom: '8px' }}>OVERALL HEALTH</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                  <span style={{ fontFamily: 'var(--serif)', fontSize: '84px', lineHeight: 0.85, letterSpacing: '-0.03em', color: scoreColor(overallScore) }}>{overallScore}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: scoreColor(overallScore) }}>{scoreLabel(overallScore).toUpperCase()} · {scoreToGrade(overallScore)}</span>
                  </div>
                </div>
                <div style={{ height: '8px', borderRadius: '99px', marginTop: '18px', background: 'linear-gradient(90deg,var(--coral) 0%,var(--amber) 50%,var(--teal) 100%)', position: 'relative', opacity: 0.85 }}>
                  <div style={{ position: 'absolute', top: '50%', left: `${overallScore}%`, transform: 'translate(-50%,-50%)', width: '14px', height: '14px', borderRadius: '50%', background: '#fff', border: '3px solid var(--bg2)', boxShadow: '0 1px 4px rgba(0,0,0,0.5)' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)', marginTop: '7px' }}>
                  <span>0</span><span>50</span><span>100</span>
                </div>
              </div>
              <div style={{ width: '1px', height: '120px', background: 'var(--border)' }} />
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--faint)', letterSpacing: '0.04em' }}>SCORE TREND</span>
                  <div style={{ display: 'flex', gap: '14px', fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--faint)' }}>
                    <span>{audit.pagesCrawled} pages</span>
                    <span style={{ color: 'var(--coral)' }}>{confirmed.filter(f => f.severity === 'critical').length} critical</span>
                  </div>
                </div>
                <svg width="100%" height="96" viewBox="0 0 560 96" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="tf" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="rgba(61,217,160,0.22)"/>
                      <stop offset="1" stopColor="rgba(61,217,160,0)"/>
                    </linearGradient>
                  </defs>
                  <path d="M0,74 C70,72 100,64 160,66 C220,68 250,52 320,48 C390,44 430,30 480,26 C520,23 540,18 560,16 L560,96 L0,96 Z" fill="url(#tf)"/>
                  <path d="M0,74 C70,72 100,64 160,66 C220,68 250,52 320,48 C390,44 430,30 480,26 C520,23 540,18 560,16" fill="none" stroke="var(--teal)" strokeWidth="2"/>
                  <circle cx="560" cy="16" r="4" fill="var(--teal)"/>
                </svg>
              </div>
            </div>
            {/* Category 3×2 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px', marginBottom: '16px' }}>
              {CATS.map(cat => (
                <CategoryCard key={cat.key} cat={cat} score={getScoreForCat(cat)} findings={audit.findings} />
              ))}
            </div>
          </>
        )}

        {/* Live progress (while running, before score) */}
        {isLive && audit.agentRuns.length > 0 && (
          <div style={{ marginBottom: '16px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', overflow: 'hidden' }}>
            <div style={{ padding: '16px 18px 0' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--faint)', letterSpacing: '0.06em', marginBottom: '12px' }}>PIPELINE PROGRESS</div>
            </div>
            <PipelineStatus auditStatus={audit.status} pagesCrawled={audit.pagesCrawled} agentRuns={audit.agentRuns} />
          </div>
        )}

        {/* Bottom: Issues + Live panel */}
        {(confirmed.length > 0 || isLive) && (
          <div style={{ display: 'grid', gridTemplateColumns: isLive ? '1.5fr 1fr' : '1fr', gap: '16px', marginTop: overallScore !== null ? '16px' : '0' }}>

            {/* Top issues */}
            {confirmed.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
                  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" style={{ color: 'var(--coral)' }}><path d="M9 2L16.5 15.5H1.5L9 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M9 7v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="9" cy="13" r="0.9" fill="currentColor"/></svg>
                  <span style={{ fontSize: '15px' }}>Top issues</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--muted)', background: 'var(--bg)', padding: '2px 7px', borderRadius: '5px' }}>
                    {visibleFindings.length}
                  </span>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => router.push('/findings')} style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--violet)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>view all →</button>
                </div>
                <div>
                  {visibleFindings.slice(0, 8).map(f => (
                    <IssueRow
                      key={f.id}
                      finding={f}
                      expanded={expandedId === f.id}
                      onToggle={() => setExpandedId(expandedId === f.id ? null : f.id)}
                    />
                  ))}
                  {visibleFindings.length === 0 && (
                    <div style={{ padding: '24px', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)', textAlign: 'center' }}>
                      No findings for this filter.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Live audit panel */}
            {isLive && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
                  <svg width="16" height="16" viewBox="0 0 18 18" fill="none" style={{ color: 'var(--violet)' }}><path d="M1 9h3l2-5 3 10 2-7 1.5 2H17" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span style={{ fontSize: '15px' }}>Active audit</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--coral)', background: 'rgba(226,87,76,0.13)', padding: '2px 8px', borderRadius: '5px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--coral)', animation: 'blink 1.2s infinite' }} />
                    LIVE
                  </span>
                </div>
                <div style={{ padding: '18px', flex: 1 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--faint)' }}>
                    {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                  <div style={{ fontFamily: 'var(--serif)', fontSize: '22px', margin: '6px 0 14px', letterSpacing: '-0.01em' }}>{hostname}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '6px' }}>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: '48px', lineHeight: 0.9 }}>
                      {audit.pagesCrawled}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--muted)' }}>pages crawled</span>
                  </div>
                  <div style={{ height: '6px', background: 'var(--surface2)', borderRadius: '99px', overflow: 'hidden', marginBottom: '18px' }}>
                    <div style={{ width: audit.pagesCrawled > 0 ? `${Math.min(100, (audit.pagesCrawled / 16) * 100)}%` : '10%', height: '100%', background: 'linear-gradient(90deg,#7468DC,#9A8FF0)', borderRadius: '99px' }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '18px' }}>
                    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '11px' }}>
                      <div style={{ fontFamily: 'var(--serif)', fontSize: '22px' }}>{audit.pagesCrawled}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)', marginTop: '3px' }}>pages</div>
                    </div>
                    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '10px', padding: '11px' }}>
                      <div style={{ fontFamily: 'var(--serif)', fontSize: '22px', color: audit.findings.filter(f=>!f.unverified).length > 0 ? 'var(--coral)' : 'var(--text)' }}>
                        {audit.findings.filter(f => !f.unverified).length}
                      </div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)', marginTop: '3px' }}>issues found</div>
                    </div>
                  </div>
                  {audit.agentRuns.length > 0 && (
                    <>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--faint)', letterSpacing: '0.04em', marginBottom: '8px' }}>PIPELINE</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', fontFamily: 'var(--mono)', fontSize: '11.5px' }}>
                        {audit.agentRuns.slice(-4).map(run => (
                          <div key={run.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: run.status === 'complete' ? 'var(--muted)' : run.status === 'running' ? 'var(--text)' : 'var(--faint)' }}>
                            {run.status === 'complete' ? (
                              <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l2.5 2.5L10 3" stroke="var(--teal)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            ) : run.status === 'running' ? (
                              <span style={{ width: '11px', height: '11px', border: '2px solid rgba(139,127,232,0.4)', borderTopColor: 'var(--violet)', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                            ) : (
                              <span style={{ width: '11px', height: '11px', border: '1.5px solid var(--faint)', borderRadius: '50%', flexShrink: 0 }} />
                            )}
                            {run.agentName}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* No findings empty state */}
        {audit.status === 'complete' && confirmed.length === 0 && (
          <div style={{ padding: '60px', textAlign: 'center', color: 'var(--faint)', fontFamily: 'var(--mono)', fontSize: '13px' }}>
            No issues found — clean audit.
          </div>
        )}

      </div>
    </AppShell>
  )
}
