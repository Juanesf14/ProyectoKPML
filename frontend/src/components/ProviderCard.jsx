import { useState, useEffect, useCallback } from 'react'
import api from '../services/api'

export default function ProviderCard({ provider, refreshTrigger }) {
  const [detail, setDetail] = useState(null)

  const fetchDetail = useCallback(async () => {
    if (!provider) return
    try {
      const { data } = await api.get(`/providers/${provider.id}`)
      setDetail(data)
    } catch (err) {
      console.error('Failed to load provider detail', err)
    }
  }, [provider])

  useEffect(() => {
    setDetail(null)
    fetchDetail()
  }, [fetchDetail, refreshTrigger])

  if (!provider) return (
    <div style={styles.empty}>
      <p>Select a provider to view its details</p>
    </div>
  )

  if (!detail) return <div style={styles.empty}><p>Loading...</p></div>

  const { provider: p, history } = detail

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.icon}>🏥</span>
        <div>
          <h3 style={styles.name}>{p.name}</h3>
          <p style={styles.type}>{p.type}</p>
        </div>
      </div>

      <div style={styles.info}>
        {p.phone && <p style={styles.row}>📞 {p.phone}</p>}
        {p.fax && <p style={styles.row}>📠 {p.fax}</p>}
        {p.email && <p style={styles.row}>✉️ {p.email}</p>}
        {p.address && <p style={styles.row}>📍 {p.address}</p>}
        {p.hours && <p style={styles.row}>🕐 {p.hours}</p>}
        {p.portal_url && (
          <p style={styles.row}>
            🔗 <a href={p.portal_url} style={styles.link} target="_blank" rel="noreferrer">
              Provider portal
            </a>
          </p>
        )}
        {p.notes && <p style={styles.notes}>{p.notes}</p>}
      </div>

      <div style={styles.historySection}>
        <p style={styles.historyTitle}>Rename history</p>
        {history.length === 0 ? (
          <p style={styles.historyEmpty}>No files renamed yet</p>
        ) : (
          history.map(h => (
            <div key={h.id} style={styles.historyItem}>
              <p style={styles.historyName}>{h.new_name}</p>
              <p style={styles.historySub}>DOS: {h.dos_start} → {h.dos_end}</p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const styles = {
  container: {
    height: '100%',
    padding: '1rem',
    background: '#1B2D42',
    borderRadius: 4,
    overflowY: 'auto',
  },
  empty: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#556270',
    fontSize: 13,
    background: '#1B2D42',
    borderRadius: 4,
  },
  header: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: '1px solid rgba(201,168,76,0.25)',
  },
  icon: { fontSize: 28 },
  name: {
    color: '#F5F0E8',
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
    fontFamily: "'Cormorant Garamond', Georgia, serif",
  },
  type: {
    color: '#8B95A1',
    margin: 0,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  info: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 },
  row: { color: '#8B95A1', margin: 0, fontSize: 12 },
  link: { color: '#C9A84C', textDecoration: 'none' },
  notes: {
    color: '#8B95A1',
    fontSize: 12,
    fontStyle: 'italic',
    background: '#243447',
    padding: '8px 10px',
    borderRadius: 3,
    margin: 0,
    borderLeft: '2px solid rgba(201,168,76,0.3)',
  },
  historySection: { borderTop: '1px solid #2E4057', paddingTop: 12 },
  historyTitle: {
    color: '#556270',
    fontSize: 10,
    margin: '0 0 8px 0',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  historyEmpty: { color: '#556270', fontSize: 12, margin: 0 },
  historyItem: {
    background: '#243447',
    borderRadius: 3,
    padding: '8px 10px',
    marginBottom: 4,
    borderLeft: '2px solid rgba(201,168,76,0.2)',
  },
  historyName: { color: '#F5F0E8', margin: 0, fontSize: 11, fontWeight: 600 },
  historySub: { color: '#556270', margin: '2px 0 0 0', fontSize: 11 },
}