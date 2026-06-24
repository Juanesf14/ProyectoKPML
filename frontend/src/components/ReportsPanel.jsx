import { useState, useEffect } from 'react'
import api from '../services/api'

/**
 * ReportsPanel
 *
 * Lightweight, opt-in reports modal. Focused on the one stat that matters here:
 * which medical providers recur across renamed documents. Opened from a discreet
 * button in the top bar; not a primary navigation tab.
 */
export default function ReportsPanel({ onClose }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let alive = true
    api.get('/history/report')
      .then(res => { if (alive) setData(res.data) })
      .catch(() => { if (alive) setError('Could not load reports') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const providers = data?.providers || []
  const repeated  = providers.filter(p => p.count > 1)

  const fmtDate = (s) => {
    if (!s) return ''
    const d = new Date(s.replace(' ', 'T'))
    return isNaN(d) ? '' : d.toLocaleDateString()
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.panel} onClick={e => e.stopPropagation()}>
        <div style={s.header}>
          <div>
            <div style={s.title}>Reports</div>
            <div style={s.sub}>Repeated medical providers</div>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={s.body}>
          {loading && <p style={s.muted}>Loading…</p>}
          {error && <p style={{ ...s.muted, color: '#fc8181' }}>{error}</p>}

          {!loading && !error && (
            <>
              <div style={s.summary}>
                <span style={s.summaryNum}>{data.total}</span>
                <span style={s.summaryLbl}>documents renamed</span>
              </div>

              <div style={s.sectionTitle}>
                Providers that repeat ({repeated.length})
              </div>

              {repeated.length === 0 ? (
                <p style={s.muted}>
                  No provider has appeared more than once yet. As you rename more
                  documents, recurring providers will show up here.
                </p>
              ) : (
                <div style={s.list}>
                  {repeated.map((p, i) => (
                    <div key={i} style={s.row}>
                      <span style={s.provName} title={p.provider}>{p.provider}</span>
                      <span style={s.meta}>
                        {p.last_used && <span style={s.last}>last {fmtDate(p.last_used)}</span>}
                        <span style={s.count}>×{p.count}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {providers.length > repeated.length && (
                <details style={s.details}>
                  <summary style={s.summaryToggle}>
                    Show all providers ({providers.length})
                  </summary>
                  <div style={s.list}>
                    {providers.map((p, i) => (
                      <div key={i} style={s.rowAll}>
                        <span style={s.provName} title={p.provider}>{p.provider}</span>
                        <span style={s.countMuted}>×{p.count}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const s = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.55)',
  },
  panel: {
    width: 460, maxWidth: '92vw', maxHeight: '82vh',
    background: '#1B2D42', border: '1px solid #2E4057', borderRadius: 6,
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '14px 16px', borderBottom: '2px solid rgba(201,168,76,0.3)',
    background: '#0D1B2A', borderRadius: '6px 6px 0 0',
  },
  title: {
    color: '#C9A84C', fontWeight: 700, fontSize: 14,
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    letterSpacing: '0.06em', textTransform: 'uppercase',
  },
  sub: { color: '#8B95A1', fontSize: 11, marginTop: 3 },
  closeBtn: {
    background: 'transparent', border: 'none', color: '#556270',
    fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1,
  },
  body: { padding: '16px', overflowY: 'auto' },
  muted: { color: '#8B95A1', fontSize: 13, lineHeight: 1.5 },
  summary: {
    display: 'flex', alignItems: 'baseline', gap: 8,
    paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid #2E4057',
  },
  summaryNum: { color: '#F5F0E8', fontSize: 26, fontWeight: 700 },
  summaryLbl: { color: '#8B95A1', fontSize: 12 },
  sectionTitle: {
    color: '#a0aec0', fontSize: 11, fontWeight: 700,
    letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10,
  },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    background: '#243447', border: '1px solid #2E4057', borderRadius: 4,
    padding: '8px 12px',
  },
  rowAll: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '6px 12px', borderBottom: '1px solid #22303f',
  },
  provName: {
    color: '#F5F0E8', fontSize: 13, fontWeight: 500,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%',
  },
  meta: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  last: { color: '#556270', fontSize: 11 },
  count: {
    background: '#C9A84C', color: '#0D1B2A', borderRadius: 10,
    fontSize: 12, fontWeight: 700, padding: '2px 9px',
  },
  countMuted: { color: '#8B95A1', fontSize: 12, fontWeight: 600 },
  details: { marginTop: 16 },
  summaryToggle: { color: '#7BB3D9', fontSize: 12, cursor: 'pointer', marginBottom: 8 },
}
