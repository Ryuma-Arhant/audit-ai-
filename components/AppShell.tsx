'use client'
import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'

type RecentAudit = {
  id: string
  url: string
  status: string
  trustScore: number | null
}

function scoreColor(s: number | null) {
  if (s === null) return 'var(--faint)'
  if (s >= 80) return 'var(--teal)'
  if (s >= 60) return 'var(--amber)'
  return 'var(--coral)'
}

function dotColor(s: number | null) {
  if (s === null) return 'var(--faint)'
  if (s >= 80) return 'var(--teal)'
  if (s >= 60) return 'var(--amber)'
  return 'var(--coral)'
}

const NAV = [
  {
    key: 'dashboard', label: 'Dashboard', href: '/',
    svg: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="10" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="2" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><rect x="10" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/></svg>,
  },
  {
    key: 'audits', label: 'Audits', href: '/audits',
    svg: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M4 2h7l3 3v11H4z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M6 9h6M6 12h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  },
  {
    key: 'findings', label: 'Findings', href: '/findings',
    svg: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M9 2L16 14.5H2L9 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M9 7v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>,
  },
  {
    key: 'journey', label: 'Journey map', href: '/journey',
    svg: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.4"/><circle cx="14" cy="9" r="2" stroke="currentColor" strokeWidth="1.4"/><circle cx="5" cy="14" r="2" stroke="currentColor" strokeWidth="1.4"/><path d="M6 5l6 3M12 10l-6 3" stroke="currentColor" strokeWidth="1.3"/></svg>,
  },
  {
    key: 'ux', label: 'UX review', href: '/ux-review',
    svg: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M9 4l1.2 2.8L13 7l-2 1.9.6 3-2.6-1.5L6.4 12 7 9 5 7l2.8-.2L9 4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>,
  },
  {
    key: 'screenshots', label: 'Screenshots', href: '/screenshots',
    svg: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><rect x="2" y="4" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.4"/><circle cx="9" cy="9.5" r="2.4" stroke="currentColor" strokeWidth="1.4"/><path d="M6 4l1-1.5h4L12 4" stroke="currentColor" strokeWidth="1.3"/></svg>,
  },
  {
    key: 'regression', label: 'Regression', href: '/regression',
    svg: <svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M2 13l4-4 3 2 6-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M11 4h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  },
]

export function AppShell({ children, activeNav }: { children: React.ReactNode; activeNav?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [recents, setRecents] = useState<RecentAudit[]>([])
  const [running, setRunning] = useState(false)
  const [showRunModal, setShowRunModal] = useState(false)
  const [runUrl, setRunUrl] = useState('')
  const [runError, setRunError] = useState('')

  useEffect(() => {
    fetch('/api/audits')
      .then(r => r.ok ? r.json() : [])
      .then((data: RecentAudit[]) => setRecents(data.slice(0, 5)))
      .catch(() => {})
  }, [])

  const currentNav = activeNav ?? (
    pathname === '/' ? 'dashboard'
    : pathname.startsWith('/audits') ? 'audits'
    : pathname.startsWith('/findings') ? 'findings'
    : ''
  )

  async function handleRun(e: React.FormEvent) {
    e.preventDefault()
    setRunning(true)
    setRunError('')
    try {
      const res = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: runUrl }),
      })
      const data = await res.json()
      if (!res.ok) { setRunError(data.error ?? 'Failed'); setRunning(false); return }
      setShowRunModal(false)
      setRunUrl('')
      router.push(`/audits/${data.id}`)
    } catch {
      setRunError('Network error')
      setRunning(false)
    }
  }

  return (
    <div style={{ display: 'flex', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--sans)', height: '100vh', overflow: 'hidden', fontSize: '15px' }}>

      {/* Run modal */}
      {showRunModal && (
        <div
          onClick={() => { setShowRunModal(false); setRunError('') }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: '16px', padding: '28px', width: '480px', maxWidth: '90vw' }}
          >
            <div style={{ fontFamily: 'var(--serif)', fontSize: '22px', marginBottom: '6px' }}>Run audit</div>
            <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '18px' }}>Enter the URL of the app you want to audit.</div>
            <form onSubmit={handleRun}>
              <input
                type="url"
                value={runUrl}
                onChange={e => setRunUrl(e.target.value)}
                placeholder="https://myapp.example.com"
                required
                autoFocus
                style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--border-strong)', borderRadius: '10px', padding: '11px 14px', color: 'var(--text)', fontSize: '14px', fontFamily: 'var(--mono)', marginBottom: '12px', outline: 'none' }}
              />
              {runError && <p style={{ color: 'var(--coral)', fontSize: '12px', marginBottom: '10px' }}>{runError}</p>}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => { setShowRunModal(false); setRunError('') }}
                  style={{ padding: '9px 18px', borderRadius: '9px', border: '1px solid var(--border-strong)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: '13px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={running}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '9px 20px', borderRadius: '9px', border: 'none', cursor: 'pointer', fontSize: '13px', color: '#fff', background: 'linear-gradient(180deg,#9A8FF0,#7468DC)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25)', opacity: running ? 0.7 : 1 }}
                >
                  {running && <span style={{ width: '11px', height: '11px', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />}
                  {running ? 'Starting…' : 'Run audit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside style={{ width: '248px', flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg2)', height: '100vh', position: 'sticky', top: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Brand */}
        <div style={{ padding: '18px 18px 16px', display: 'flex', alignItems: 'center', gap: '11px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '9px', background: 'linear-gradient(160deg,#9A8FF0,#6F62D6)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)', flexShrink: 0 }}>
            <svg width="17" height="17" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.4" stroke="#fff" strokeWidth="1.5"/><path d="M10.4 10.4 L14 14" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/><path d="M5.2 7 L6.6 8.4 L9 5.4" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div style={{ flex: 1, lineHeight: 1.2 }}>
            <div style={{ fontFamily: 'var(--serif)', fontSize: '18px', letterSpacing: '-0.01em' }}>AuditAI</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--faint)', letterSpacing: '0.02em', marginTop: '1px' }}>Audit workspace</div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {NAV.map(item => {
            const active = currentNav === item.key
            return (
              <button
                key={item.key}
                onClick={() => router.push(item.href)}
                style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '8px 8px', borderRadius: '9px', fontSize: '13.5px', cursor: 'pointer', color: active ? 'var(--text)' : 'var(--muted)', background: active ? 'var(--surface)' : 'transparent', border: 'none', textAlign: 'left', width: '100%' }}
              >
                <span style={{ width: '3px', height: '16px', borderRadius: '2px', background: active ? 'var(--violet)' : 'transparent', flexShrink: 0 }} />
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '18px', color: active ? 'var(--text)' : 'var(--muted)' }}>{item.svg}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Recent audits */}
        <div style={{ padding: '18px 18px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--faint)', letterSpacing: '0.06em' }}>RECENT AUDITS</span>
          {recents.length > 0 && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--muted)', background: 'var(--surface)', padding: '1px 7px', borderRadius: '5px' }}>{recents.length}</span>
          )}
        </div>
        <div style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: '1px', overflowY: 'auto', flex: 1 }}>
          {recents.length === 0 ? (
            <div style={{ padding: '8px 8px', fontSize: '12px', color: 'var(--faint)', fontFamily: 'var(--mono)' }}>No audits yet</div>
          ) : recents.map(r => (
            <button
              key={r.id}
              onClick={() => router.push(`/audits/${r.id}`)}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 8px', borderRadius: '8px', cursor: 'pointer', background: 'transparent', border: 'none', width: '100%', textAlign: 'left' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: dotColor(r.trustScore), flexShrink: 0, boxShadow: `0 0 6px ${dotColor(r.trustScore)}` }} />
              <span style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{new URL(r.url).hostname}</span>
              {r.trustScore !== null && (
                <span style={{ fontFamily: 'var(--serif)', fontSize: '15px', color: scoreColor(r.trustScore), flexShrink: 0 }}>{r.trustScore}</span>
              )}
            </button>
          ))}
        </div>

        {/* Upgrade card */}
        <div style={{ margin: '12px', borderRadius: '13px', padding: '16px', background: 'linear-gradient(165deg,rgba(139,127,232,0.16),rgba(139,127,232,0.04))', border: '1px solid rgba(139,127,232,0.2)' }}>
          <div style={{ fontFamily: 'var(--serif)', fontSize: '16px', marginBottom: '5px' }}>Upgrade to Pro</div>
          <div style={{ fontSize: '12px', color: 'var(--muted)', lineHeight: 1.45, marginBottom: '13px' }}>Unlimited audits, scheduled re-scans and team workspaces.</div>
          <button style={{ width: '100%', fontFamily: 'var(--sans)', fontSize: '13px', color: '#fff', padding: '9px', borderRadius: '9px', border: 'none', cursor: 'pointer', background: 'linear-gradient(180deg,#9A8FF0,#7468DC)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25),0 0 0 1px rgba(139,127,232,0.35)' }}>
            Upgrade now
          </button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', height: '100vh' }}>
        {/* Topbar */}
        <header style={{ position: 'sticky', top: 0, zIndex: 30, height: '62px', borderBottom: '1px solid var(--border)', background: 'rgba(20,20,20,0.88)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', gap: '16px', padding: '0 24px', flexShrink: 0 }}>
          {/* Account pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '5px 10px 5px 6px', cursor: 'pointer' }}>
            <div style={{ width: '26px', height: '26px', borderRadius: '7px', background: 'linear-gradient(150deg,#3DD9A0,#2BA37A)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: '#0c1410', fontWeight: 500 }}>AI</div>
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--muted)' }}>@workspace</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--violet)', background: 'rgba(139,127,232,0.15)', padding: '1px 5px', borderRadius: '4px' }}>PRO</span>
              </div>
              <div style={{ fontSize: '12.5px' }}>AuditAI</div>
            </div>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--faint)' }}><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>

          {/* Run audit */}
          <button
            onClick={() => setShowRunModal(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap', fontFamily: 'var(--sans)', fontSize: '13.5px', color: '#fff', padding: '9px 17px', borderRadius: '10px', border: 'none', cursor: 'pointer', background: 'linear-gradient(180deg,#9A8FF0,#7468DC)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28),0 0 0 1px rgba(139,127,232,0.4),0 4px 14px rgba(139,127,232,0.28)' }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M3 2.5L11 7l-8 4.5z" fill="#fff"/></svg>
            Run audit
          </button>

          <div style={{ flex: 1 }} />

          {/* Notifications */}
          <div style={{ position: 'relative', cursor: 'pointer', color: 'var(--muted)' }}>
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 2.5a4.5 4.5 0 00-4.5 4.5c0 3.5-1.5 5-1.5 5h12s-1.5-1.5-1.5-5A4.5 4.5 0 0010 2.5zM8.5 16a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span style={{ position: 'absolute', top: '-1px', right: 0, width: '6px', height: '6px', borderRadius: '50%', background: 'var(--coral)', border: '1.5px solid var(--bg2)' }} />
          </div>

          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '7px 10px', width: '220px' }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--faint)', flexShrink: 0 }}><circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.4"/><path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            <span style={{ flex: 1, fontSize: '12.5px', color: 'var(--faint)' }}>Search findings…</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--faint)', border: '1px solid var(--border)', borderRadius: '5px', padding: '1px 5px' }}>⌘K</span>
          </div>

          {/* Settings */}
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style={{ color: 'var(--muted)', cursor: 'pointer' }}><circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.4"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
        </header>

        {/* Canvas */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {children}
        </div>
      </main>
    </div>
  )
}
