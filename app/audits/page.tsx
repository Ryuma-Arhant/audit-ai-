'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'

type AuditSummary = {
  id: string
  url: string
  status: string
  trustScore: number | null
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

function statusColor(st: string) {
  if (st === 'complete') return { c: 'var(--teal)', bg: 'rgba(61,217,160,0.12)' }
  if (st === 'running')  return { c: 'var(--violet)', bg: 'rgba(139,127,232,0.12)' }
  if (st === 'queued')   return { c: 'var(--faint)', bg: 'rgba(102,102,102,0.12)' }
  return { c: 'var(--coral)', bg: 'rgba(226,87,76,0.12)' }
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function AuditsPage() {
  const router = useRouter()
  const [audits, setAudits] = useState<AuditSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/audits')
      .then(r => r.ok ? r.json() : [])
      .then(d => { setAudits(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <AppShell activeNav="audits">
      <div style={{ padding: '28px 28px 60px' }}>
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontFamily: 'var(--serif)', fontSize: '28px', fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 4px' }}>Audits</h1>
          <p style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)', margin: 0 }}>All audit runs across every workspace.</p>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', overflow: 'hidden' }}>
          {/* Header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 80px 80px 80px 100px', gap: '16px', padding: '11px 18px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--faint)', letterSpacing: '0.05em' }}>
            <span>URL</span>
            <span>STATUS</span>
            <span>SCORE</span>
            <span>PAGES</span>
            <span>DURATION</span>
            <span>WHEN</span>
          </div>

          {loading && (
            <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)' }}>Loading…</div>
          )}

          {!loading && audits.length === 0 && (
            <div style={{ padding: '60px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)' }}>
              No audits yet. Run your first audit to get started.
            </div>
          )}

          {audits.map((a, i) => {
            const st = statusColor(a.status)
            const isLast = i === audits.length - 1
            return (
              <div
                key={a.id}
                onClick={() => router.push(`/audits/${a.id}`)}
                style={{ display: 'grid', gridTemplateColumns: '1fr 100px 80px 80px 80px 100px', gap: '16px', padding: '14px 18px', borderBottom: isLast ? 'none' : '1px solid var(--border)', cursor: 'pointer', alignItems: 'center' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg2)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.url}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)', marginTop: '2px' }}>{a.id.slice(0, 16)}…</div>
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: st.c, background: st.bg, padding: '2px 8px', borderRadius: '5px', display: 'inline-flex', alignItems: 'center', gap: '5px', width: 'fit-content' }}>
                  <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: st.c }} />
                  {a.status}
                </span>
                <span style={{ fontFamily: 'var(--serif)', fontSize: '22px', color: scoreColor(a.trustScore) }}>
                  {a.trustScore ?? '—'}
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--muted)' }}>{a.pagesCrawled > 0 ? a.pagesCrawled : '—'}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--muted)' }}>
                  {a.durationMs ? `${(a.durationMs / 1000).toFixed(0)}s` : '—'}
                </span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--faint)' }}>{timeAgo(a.createdAt)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </AppShell>
  )
}
