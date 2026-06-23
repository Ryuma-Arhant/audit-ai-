'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'

export default function Home() {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to start audit'); return }
      router.push(`/audits/${data.id}`)
    } catch {
      setError('Network error — check your connection')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppShell activeNav="dashboard">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100%', padding: '60px 28px' }}>
        <div style={{ width: '100%', maxWidth: '560px', textAlign: 'center' }}>
          <div style={{ marginBottom: '32px' }}>
            <h1 style={{ fontFamily: 'var(--serif)', fontSize: '36px', fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 10px', color: 'var(--text)' }}>
              Audit any AI-generated app in seconds.
            </h1>
            <p style={{ fontSize: '14px', color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
              Paste a URL → we crawl every page, run automated checks, and score the result.
            </p>
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '16px', padding: '28px' }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--faint)', letterSpacing: '0.06em', marginBottom: '16px', textAlign: 'left' }}>
              NEW AUDIT
            </p>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://myapp.emergent.sh"
                  required
                  style={{ flex: 1, background: 'var(--bg2)', border: '1px solid var(--border-strong)', borderRadius: '10px', padding: '11px 14px', color: 'var(--text)', fontSize: '14px', fontFamily: 'var(--mono)', outline: 'none' }}
                />
                <button
                  type="submit"
                  disabled={loading}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap', padding: '11px 22px', borderRadius: '10px', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '14px', color: '#fff', background: 'linear-gradient(180deg,#9A8FF0,#7468DC)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28),0 0 0 1px rgba(139,127,232,0.4),0 4px 14px rgba(139,127,232,0.22)', opacity: loading ? 0.7 : 1, fontFamily: 'var(--sans)' }}
                >
                  {loading && (
                    <span style={{ width: '12px', height: '12px', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                  )}
                  {loading ? 'Starting…' : 'Run audit'}
                </button>
              </div>
              {error && <p style={{ color: 'var(--coral)', fontSize: '12px', marginTop: '8px', textAlign: 'left' }}>{error}</p>}
            </form>
          </div>

          <p style={{ marginTop: '20px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--faint)', letterSpacing: '0.02em' }}>
            Crawls every page · scores UX, a11y, performance, security · powered by LLM review
          </p>
        </div>
      </div>
    </AppShell>
  )
}
