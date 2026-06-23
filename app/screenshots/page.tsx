'use client'
import { useEffect, useState } from 'react'
import { AppShell } from '@/components/AppShell'

type PageData = { url: string; screenshotPath: string | null }
type AuditSummary = { id: string; url: string; status: string }
type AuditDetail = { pages: PageData[] }

type DeviceTab = 'desktop' | 'mobile'

export default function ScreenshotsPage() {
  const [audits, setAudits] = useState<AuditSummary[]>([])
  const [detail, setDetail] = useState<AuditDetail | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [device, setDevice] = useState<DeviceTab>('desktop')
  const [enlarged, setEnlarged] = useState<string | null>(null)
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

  const pages = (detail?.pages ?? []).filter(p => p.screenshotPath)

  return (
    <AppShell activeNav="screenshots">
      {/* Lightbox */}
      {enlarged && (
        <div
          onClick={() => setEnlarged(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}
        >
          <div style={{ position: 'relative', maxWidth: '1100px', width: '100%' }}>
            <img src={enlarged} alt="Screenshot" style={{ width: '100%', borderRadius: '12px', border: '1px solid var(--border)' }} />
            <button
              onClick={() => setEnlarged(null)}
              style={{ position: 'absolute', top: '-14px', right: '-14px', width: '32px', height: '32px', borderRadius: '50%', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}
            >×</button>
          </div>
        </div>
      )}

      <div style={{ padding: '28px 28px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--serif)', fontSize: '28px', fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 4px' }}>Screenshots</h1>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)', margin: 0 }}>Captured pages across device viewports.</p>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {/* Device toggle */}
            <div style={{ display: 'flex', gap: '3px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '9px', padding: '3px' }}>
              {(['desktop', 'mobile'] as DeviceTab[]).map(d => (
                <button key={d} onClick={() => setDevice(d)} style={{ padding: '6px 14px', borderRadius: '7px', fontSize: '12px', cursor: 'pointer', border: 'none', color: device === d ? 'var(--text)' : 'var(--muted)', background: device === d ? 'var(--surface2)' : 'transparent', fontFamily: 'var(--sans)' }}>
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </button>
              ))}
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
        </div>

        {loading && (
          <div style={{ padding: '60px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)' }}>Loading screenshots…</div>
        )}

        {!loading && pages.length === 0 && (
          <div style={{ padding: '60px', textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)' }}>
            No screenshots captured for this audit.
          </div>
        )}

        {pages.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: device === 'desktop' ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: '16px' }}>
            {pages.map((p, i) => (
              <div
                key={i}
                onClick={() => p.screenshotPath && setEnlarged(p.screenshotPath)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '13px', overflow: 'hidden', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-strong)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                {/* Device frame header */}
                <div style={{ background: 'var(--surface2)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'rgba(255,255,255,0.12)' }} />
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'rgba(255,255,255,0.12)' }} />
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'rgba(255,255,255,0.12)' }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)', marginLeft: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.url}</span>
                </div>
                {p.screenshotPath ? (
                  <img src={p.screenshotPath} alt={p.url} style={{ width: '100%', display: 'block', aspectRatio: device === 'desktop' ? '16/10' : '9/19.5', objectFit: 'cover', objectPosition: 'top' }} />
                ) : (
                  <div style={{ aspectRatio: device === 'desktop' ? '16/10' : '9/19.5', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontFamily: 'var(--mono)', fontSize: '11px' }}>
                    No screenshot
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
