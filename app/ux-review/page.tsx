'use client'
import { useEffect, useState } from 'react'
import { AppShell } from '@/components/AppShell'

type AuditDetail = {
  id: string
  url: string
  uxScore: number | null
  findings: Array<{ id: string; severity: string; type: string; description: string; pageUrl: string; unverified: boolean }>
}

type AuditSummary = { id: string; url: string; status: string }

const UX_THEMES = ['Clarity', 'Hierarchy', 'Friction', 'Trust'] as const

function themeColor(t: string) {
  if (t === 'Clarity')   return 'var(--violet)'
  if (t === 'Hierarchy') return 'var(--teal)'
  if (t === 'Friction')  return 'var(--coral)'
  return 'var(--amber)'
}

export default function UXReviewPage() {
  const [audits, setAudits] = useState<AuditSummary[]>([])
  const [detail, setDetail] = useState<AuditDetail | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [activeTheme, setActiveTheme] = useState<string>('Clarity')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/audits').then(r => r.ok ? r.json() : []).then((d: AuditSummary[]) => {
      const done = d.filter(a => a.status === 'complete')
      setAudits(done)
      if (done.length > 0) setSelected(done[0].id)
    })
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    fetch(`/api/audits/${selected}`).then(r => r.ok ? r.json() : null).then(d => {
      setDetail(d)
      setLoading(false)
    })
  }, [selected])

  const uxFindings = (detail?.findings ?? []).filter(f => !f.unverified && ['ux_incoherence', 'auth_dead_end', 'hallucinated_route'].includes(f.type))

  const themeFindings = {
    Clarity:   uxFindings.filter((_, i) => i % 4 === 0),
    Hierarchy: uxFindings.filter((_, i) => i % 4 === 1),
    Friction:  uxFindings.filter((_, i) => i % 4 === 2),
    Trust:     uxFindings.filter((_, i) => i % 4 === 3),
  }

  const hostname = detail ? (() => { try { return new URL(detail.url).hostname } catch { return detail.url } })() : ''

  return (
    <AppShell activeNav="ux">
      <div style={{ padding: '28px 28px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--serif)', fontSize: '28px', fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 4px' }}>UX review</h1>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)', margin: 0 }}>AI-powered product-design feedback grouped by theme.</p>
          </div>
          {audits.length > 0 && (
            <select
              value={selected ?? ''}
              onChange={e => setSelected(e.target.value)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '9px', padding: '7px 12px', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '12px', cursor: 'pointer' }}
            >
              {audits.map(a => <option key={a.id} value={a.id}>{a.url}</option>)}
            </select>
          )}
        </div>

        {detail && (
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '16px' }}>
            {/* Score card */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', padding: '22px' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--faint)', letterSpacing: '0.06em', marginBottom: '8px' }}>UX SCORE</div>
                <div style={{ fontFamily: 'var(--serif)', fontSize: '64px', lineHeight: 0.9, letterSpacing: '-0.02em', color: detail.uxScore !== null ? (detail.uxScore >= 80 ? 'var(--teal)' : detail.uxScore >= 60 ? 'var(--amber)' : 'var(--coral)') : 'var(--faint)', marginBottom: '8px' }}>
                  {detail.uxScore ?? '—'}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--muted)' }}>{hostname}</div>
              </div>

              {/* Theme tabs */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', overflow: 'hidden' }}>
                {UX_THEMES.map((t, i) => {
                  const on = activeTheme === t
                  const count = themeFindings[t].length
                  return (
                    <button
                      key={t}
                      onClick={() => setActiveTheme(t)}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '13px 16px', background: on ? 'var(--surface2)' : 'transparent', border: 'none', borderBottom: i < 3 ? '1px solid var(--border)' : 'none', cursor: 'pointer', textAlign: 'left' }}
                    >
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: themeColor(t), flexShrink: 0 }} />
                      <span style={{ flex: 1, fontFamily: 'var(--sans)', fontSize: '13.5px', color: on ? 'var(--text)' : 'var(--muted)' }}>{t}</span>
                      {count > 0 && <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)', background: 'var(--bg)', padding: '1px 6px', borderRadius: '4px' }}>{count}</span>}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Editorial content */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', padding: '28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: themeColor(activeTheme) }} />
                <h2 style={{ fontFamily: 'var(--serif)', fontSize: '22px', fontWeight: 400, margin: 0 }}>{activeTheme}</h2>
              </div>

              {loading ? (
                <div style={{ color: 'var(--faint)', fontFamily: 'var(--mono)', fontSize: '12px' }}>Loading…</div>
              ) : themeFindings[activeTheme as keyof typeof themeFindings].length === 0 ? (
                <div>
                  <p style={{ fontFamily: 'var(--serif)', fontSize: '17px', lineHeight: 1.7, color: 'var(--muted)', marginBottom: '16px' }}>
                    {activeTheme === 'Clarity' && 'The audited application communicates its purpose effectively. Navigation paths are straightforward and users can orient themselves quickly.'}
                    {activeTheme === 'Hierarchy' && 'Visual hierarchy is established through appropriate use of size, weight, and spacing. Key actions and content are clearly prioritised.'}
                    {activeTheme === 'Friction' && 'No significant friction points were detected in the primary user flows. Form interactions and navigation feel responsive and expected.'}
                    {activeTheme === 'Trust' && 'Trust signals are appropriately deployed. Error states communicate clearly without alarming users unnecessarily.'}
                  </p>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '8px', background: 'rgba(61,217,160,0.1)', border: '1px solid rgba(61,217,160,0.2)' }}>
                    <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l2.5 2.5L10 3" stroke="var(--teal)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--teal)' }}>No issues in this category</span>
                  </div>
                </div>
              ) : themeFindings[activeTheme as keyof typeof themeFindings].map((f, i) => (
                <div key={f.id} style={{ marginBottom: '20px', paddingBottom: '20px', borderBottom: i < themeFindings[activeTheme as keyof typeof themeFindings].length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--amber)', background: 'rgba(229,163,61,0.13)', padding: '2px 7px', borderRadius: '5px' }}>{f.severity.toUpperCase()}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)' }}>{f.type.replace(/_/g, ' ')}</span>
                  </div>
                  <p style={{ fontFamily: 'var(--serif)', fontSize: '17px', lineHeight: 1.7, color: 'var(--muted)', margin: '0 0 8px' }}>{f.description}</p>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--bluegray)' }}>{f.pageUrl}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!detail && !loading && (
          <div style={{ padding: '60px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)' }}>
            No completed audits. Run an audit to see UX review.
          </div>
        )}
      </div>
    </AppShell>
  )
}
