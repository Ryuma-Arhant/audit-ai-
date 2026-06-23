'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'

type Finding = {
  id: string
  severity: string
  type: string
  description: string
  pageUrl: string
  source: string
  confidence: number
  reproduction: string | null
  unverified: boolean
  auditId: string
  auditUrl: string
}

type AuditSummary = {
  id: string
  url: string
  status: string
  findings: Finding[]
}

const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

function sevStyle(s: string) {
  switch (s) {
    case 'critical': return { c: '#E2574C', bg: 'rgba(226,87,76,0.13)' }
    case 'high':     return { c: '#E5A33D', bg: 'rgba(229,163,61,0.13)' }
    case 'medium':   return { c: '#E8D26B', bg: 'rgba(232,210,107,0.13)' }
    case 'low':      return { c: '#808AA0', bg: 'rgba(128,138,160,0.13)' }
    default:         return { c: '#9A9A9A', bg: 'rgba(154,154,154,0.13)' }
  }
}

type SevFilter = 'all' | 'critical' | 'high' | 'medium' | 'low'

export default function FindingsPage() {
  const router = useRouter()
  const [findings, setFindings] = useState<Finding[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<SevFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const list: AuditSummary[] = await fetch('/api/audits').then(r => r.ok ? r.json() : [])
      const completed = list.filter(a => a.status === 'complete').slice(0, 10)
      const all: Finding[] = []
      await Promise.all(completed.map(async a => {
        const detail = await fetch(`/api/audits/${a.id}`).then(r => r.ok ? r.json() : null)
        if (!detail) return
        for (const f of (detail.findings ?? [])) {
          if (!f.unverified) all.push({ ...f, auditId: a.id, auditUrl: a.url })
        }
      }))
      all.sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9))
      setFindings(all)
      setLoading(false)
    }
    load()
  }, [])

  const visible = filter === 'all' ? findings : findings.filter(f => f.severity === filter)

  const counts: Record<SevFilter, number> = {
    all:      findings.length,
    critical: findings.filter(f => f.severity === 'critical').length,
    high:     findings.filter(f => f.severity === 'high').length,
    medium:   findings.filter(f => f.severity === 'medium').length,
    low:      findings.filter(f => f.severity === 'low').length,
  }

  return (
    <AppShell activeNav="findings">
      <div style={{ padding: '28px 28px 60px' }}>
        <div style={{ marginBottom: '20px' }}>
          <h1 style={{ fontFamily: 'var(--serif)', fontSize: '28px', fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 4px' }}>Findings</h1>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)', margin: 0 }}>All confirmed issues across every completed audit.</p>
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: '7px', marginBottom: '20px' }}>
          {(['all', 'critical', 'high', 'medium', 'low'] as SevFilter[]).map(f => {
            const on = filter === f
            const st = f === 'all' ? { c: 'var(--text)', bg: 'var(--surface2)' } : sevStyle(f)
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{ padding: '6px 13px', borderRadius: '99px', fontSize: '12.5px', cursor: 'pointer', border: `1px solid ${on ? 'var(--border-strong)' : 'var(--border)'}`, color: on ? st.c : 'var(--muted)', background: on ? st.bg : 'transparent', fontFamily: 'var(--sans)' }}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: on ? st.c : 'var(--faint)', marginLeft: '6px' }}>{counts[f]}</span>
              </button>
            )
          })}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', overflow: 'hidden' }}>
          {loading && (
            <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)' }}>Loading findings…</div>
          )}
          {!loading && visible.length === 0 && (
            <div style={{ padding: '60px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)' }}>No {filter === 'all' ? '' : filter} findings.</div>
          )}
          {visible.map((f, i) => {
            const st = sevStyle(f.severity)
            const open = expanded === f.id
            return (
              <div
                key={f.id}
                style={{ borderBottom: i === visible.length - 1 ? 'none' : '1px solid var(--border)' }}
              >
                <div
                  onClick={() => setExpanded(open ? null : f.id)}
                  style={{ padding: '14px 18px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '0' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: st.c, background: st.bg, padding: '2px 7px', borderRadius: '5px', letterSpacing: '0.03em', flexShrink: 0, textTransform: 'uppercase' }}>{f.severity}</span>
                    <span style={{ flex: 1, fontFamily: 'var(--serif)', fontSize: '16px', letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.description}</span>
                    <button
                      onClick={e => { e.stopPropagation(); router.push(`/audits/${f.auditId}`) }}
                      style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--violet)', background: 'transparent', border: 'none', cursor: 'pointer', flexShrink: 0, padding: '2px 6px' }}
                    >
                      view audit →
                    </button>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--faint)', flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
                      <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '7px', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--bluegray)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.pageUrl}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)', flexShrink: 0 }}>{f.type.replace(/_/g, ' ')}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)', flexShrink: 0 }}>{f.confidence.toFixed(1)} conf</span>
                  </div>
                </div>
                {open && f.reproduction && (
                  <div style={{ padding: '0 18px 14px' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)', letterSpacing: '0.04em', marginBottom: '6px' }}>REPRODUCTION STEPS</div>
                    <pre style={{ background: '#101010', border: '1px solid var(--border)', borderRadius: '8px', padding: '11px 13px', fontFamily: 'var(--mono)', fontSize: '11.5px', lineHeight: 1.7, color: 'var(--muted)', overflowX: 'auto', whiteSpace: 'pre-wrap', margin: 0 }}>{f.reproduction}</pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </AppShell>
  )
}
