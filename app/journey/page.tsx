'use client'
import { useEffect, useState } from 'react'
import { AppShell } from '@/components/AppShell'

type AuditSummary = { id: string; url: string; status: string; trustScore: number | null }

export default function JourneyPage() {
  const [audits, setAudits] = useState<AuditSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/audits').then(r => r.ok ? r.json() : []).then(d => {
      const done = d.filter((a: AuditSummary) => a.status === 'complete')
      setAudits(done)
      if (done.length > 0) setSelected(done[0].id)
    })
  }, [])

  const NODES = [
    { id: 'home', label: '/', x: 120, y: 200, color: 'var(--violet)' },
    { id: 'about', label: '/about', x: 320, y: 100, color: 'var(--teal)' },
    { id: 'pricing', label: '/pricing', x: 320, y: 300, color: 'var(--teal)' },
    { id: 'signup', label: '/signup', x: 520, y: 200, color: 'var(--amber)' },
    { id: 'dash', label: '/dashboard', x: 700, y: 200, color: 'var(--teal)' },
    { id: 'dead', label: '/404', x: 520, y: 340, color: 'var(--coral)' },
  ]
  const EDGES = [
    { from: 'home', to: 'about' }, { from: 'home', to: 'pricing' },
    { from: 'about', to: 'signup' }, { from: 'pricing', to: 'signup' },
    { from: 'pricing', to: 'dead', friction: true },
    { from: 'signup', to: 'dash' },
  ]

  function nodePos(id: string) {
    return NODES.find(n => n.id === id) ?? { x: 0, y: 0 }
  }

  return (
    <AppShell activeNav="journey">
      <div style={{ padding: '28px 28px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--serif)', fontSize: '28px', fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 4px' }}>Journey map</h1>
            <p style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--faint)', margin: 0 }}>User navigation flow across audited pages.</p>
          </div>
          {audits.length > 0 && (
            <select
              value={selected ?? ''}
              onChange={e => setSelected(e.target.value)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '9px', padding: '7px 12px', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '12px', cursor: 'pointer' }}
            >
              {audits.map(a => (
                <option key={a.id} value={a.id}>{new URL(a.url).hostname} — {a.trustScore ?? '?'}</option>
              ))}
            </select>
          )}
        </div>

        <div style={{ display: 'flex', gap: '16px' }}>
          {/* Graph */}
          <div style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '15px', padding: '24px', minHeight: '480px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--faint)', letterSpacing: '0.06em', marginBottom: '16px' }}>PAGE FLOW</div>
            <svg width="100%" height="420" viewBox="0 0 840 420">
              {/* Edges */}
              {EDGES.map((e, i) => {
                const f = nodePos(e.from), t = nodePos(e.to)
                return (
                  <g key={i}>
                    <line x1={f.x + 50} y1={f.y + 18} x2={t.x} y2={t.y + 18}
                      stroke={e.friction ? 'var(--coral)' : 'rgba(255,255,255,0.12)'}
                      strokeWidth={e.friction ? 1.5 : 1.5}
                      strokeDasharray={e.friction ? '5,4' : undefined}
                    />
                    {e.friction && (
                      <text x={(f.x + t.x) / 2 + 25} y={(f.y + t.y) / 2 + 14} fontSize="9" fill="var(--coral)" fontFamily="var(--mono)" textAnchor="middle">friction</text>
                    )}
                  </g>
                )
              })}
              {/* Nodes */}
              {NODES.map(n => (
                <g key={n.id}>
                  <rect x={n.x} y={n.y} width={100} height={36} rx={8}
                    fill="var(--surface2)" stroke={n.color} strokeWidth="1.5"
                  />
                  <text x={n.x + 50} y={n.y + 22} textAnchor="middle" fontSize="12"
                    fill={n.color} fontFamily="var(--mono)">
                    {n.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          {/* Legend */}
          <div style={{ width: '200px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '13px', padding: '16px' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--faint)', letterSpacing: '0.06em', marginBottom: '12px' }}>LEGEND</div>
              {[
                { color: 'var(--violet)', label: 'Entry point' },
                { color: 'var(--teal)',   label: 'Healthy page' },
                { color: 'var(--amber)',  label: 'Friction point' },
                { color: 'var(--coral)', label: 'Dead end / error' },
              ].map(l => (
                <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: l.color, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--muted)' }}>{l.label}</span>
                </div>
              ))}
            </div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '13px', padding: '16px' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--faint)', letterSpacing: '0.06em', marginBottom: '8px' }}>FRICTION POINTS</div>
              <div style={{ fontFamily: 'var(--serif)', fontSize: '32px', color: 'var(--coral)' }}>1</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>detected flows</div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
