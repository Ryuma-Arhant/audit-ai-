'use client'
import { useEffect, useState } from 'react'
import { AppShell } from '@/components/AppShell'

type AuditSummary = {
  id: string
  url: string
  status: string
  trustScore: number | null
  reliabilityScore: number | null
  uxScore: number | null
  pagesCrawled: number
  durationMs: number | null
  createdAt: string
}

function scoreColor(s: number | null) {
  if (s === null) return 'var(--faint)'
  if (s >= 80) return 'var(--teal)'
  if (s >= 60) return 'var(--amber)'
  return 'var(--coral)'
}

function delta(a: number | null, b: number | null) {
  if (a === null || b === null) return null
  return b - a
}

function DeltaBadge({ d }: { d: number | null }) {
  if (d === null) return <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--faint)' }}>—</span>
  const up = d >= 0
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontFamily: 'var(--mono)', fontSize: '11px', color: up ? 'var(--teal)' : 'var(--coral)', background: up ? 'rgba(61,217,160,0.1)' : 'rgba(226,87,76,0.1)', padding: '2px 7px', borderRadius: '5px' }}>
      {up ? '▲' : '▼'} {Math.abs(d)}
    </span>
  )
}

export default function RegressionPage() {
  const [audits, setAudits] = useState<AuditSummary[]>([])
  const [groupedUrl, setGroupedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/audits').then(r => r.ok ? r.json() : []).then((d: AuditSummary[]) => {
      const done = d.filter(a => a.status === 'complete')
      setAudits(done)
      if (done.length > 0) {
        const urls = [...new Set(done.map(a => { try { return new URL(a.url).hostname } catch { return a.url } }))]
        setGroupedUrl(urls[0])
      }
      setLoading(false)
    })
  }, [])

  const uniqueHosts = [...new Set(audits.map(a => { try { return new URL(a.url).hostname } catch { return a.url } }))]

  const groupAudits = audits
    .filter(a => { try { return new URL(a.url).hostname === groupedUrl } catch { return a.url === groupedUrl } })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  const scores = groupAudits.map(a => ({ score: a.trustScore, label: a.id.slice(-6), date: new Date(a.createdAt).toLocaleDateString() }))

  const latest  = groupAudits[groupAudits.length - 1]
  const previous = groupAudits[groupAudits.length - 2]

  const W = 560, H = 120
  const pts = scores.filter(s => s.score !== null)
  const minS = Math.min(...pts.map(p => p.score!)) - 5
  const maxS = Math.max(...pts.map(p => p.score!)) + 5
  const toY  = (s: number) => H - ((s - minS) / (maxS - minS)) * (H - 20) - 10
  const toX  = (i: number) => pts.length < 2 ? W / 2 : (i / (pts.length - 1)) * (W - 40) + 20
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(p.score!)}`).join(' ')

  return (
    <AppShell activeNav="regression">
      <div style={{ padding: '28px 28px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--serif)', fontSize: '28px', fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 4px' }}>Regression</h1>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)', margin: 0 }}>Score trends and diff between audit runs.</p>
          </div>
          {uniqueHosts.length > 0 && (
            <select
              value={groupedUrl ?? ''}
              onChange={e => setGroupedUrl(e.target.value)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '9px', padding: '7px 12px', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '12px', cursor: 'pointer' }}
            >
              {uniqueHosts.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          )}
        </div>

        {loading && <div style={{ padding: '60px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)' }}>Loading…</div>}

        {!loading && groupAudits.length === 0 && (
          <div style={{ padding: '60px', textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)' }}>
            No completed audits for this domain.
          </div>
        )}

        {groupAudits.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Trend chart */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', padding: '24px' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--faint)', letterSpacing: '0.06em', marginBottom: '16px' }}>SCORE TREND — {groupedUrl}</div>
              {pts.length >= 2 ? (
                <>
                  <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
                    <defs>
                      <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="rgba(61,217,160,0.18)"/>
                        <stop offset="1" stopColor="rgba(61,217,160,0)"/>
                      </linearGradient>
                    </defs>
                    <path d={`${path} L${toX(pts.length-1)},${H} L${toX(0)},${H} Z`} fill="url(#rg)"/>
                    <path d={path} fill="none" stroke="var(--teal)" strokeWidth="2"/>
                    {pts.map((p, i) => (
                      <circle key={i} cx={toX(i)} cy={toY(p.score!)} r="4" fill="var(--teal)"/>
                    ))}
                  </svg>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)', marginTop: '8px' }}>
                    {pts.map((p, i) => <span key={i}>{p.date}</span>)}
                  </div>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '30px', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)' }}>Need at least 2 audits to show trend.</div>
              )}
            </div>

            {/* Diff */}
            {latest && previous && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', padding: '22px' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--faint)', letterSpacing: '0.06em', marginBottom: '16px' }}>SCORE COMPARISON</div>
                  {[
                    { label: 'Overall', prev: previous.trustScore, cur: latest.trustScore },
                    { label: 'UX',          prev: previous.uxScore,          cur: latest.uxScore },
                    { label: 'Reliability', prev: previous.reliabilityScore, cur: latest.reliabilityScore },
                  ].map(row => (
                    <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--muted)', width: '80px', flexShrink: 0 }}>{row.label}</span>
                      <span style={{ fontFamily: 'var(--serif)', fontSize: '20px', color: scoreColor(row.prev), minWidth: '36px' }}>{row.prev ?? '—'}</span>
                      <span style={{ color: 'var(--faint)', fontFamily: 'var(--mono)', fontSize: '12px' }}>→</span>
                      <span style={{ fontFamily: 'var(--serif)', fontSize: '20px', color: scoreColor(row.cur), minWidth: '36px' }}>{row.cur ?? '—'}</span>
                      <DeltaBadge d={delta(row.prev, row.cur)} />
                    </div>
                  ))}
                </div>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', padding: '22px' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--faint)', letterSpacing: '0.06em', marginBottom: '16px' }}>RUN HISTORY</div>
                  {groupAudits.slice().reverse().map((a, i) => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)', width: '80px', flexShrink: 0 }}>{new Date(a.createdAt).toLocaleDateString()}</span>
                      <span style={{ fontFamily: 'var(--serif)', fontSize: '20px', color: scoreColor(a.trustScore) }}>{a.trustScore ?? '—'}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)', flex: 1 }}>{a.pagesCrawled} pages</span>
                      {i === 0 && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--violet)', background: 'rgba(139,127,232,0.13)', padding: '1px 6px', borderRadius: '4px' }}>LATEST</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
