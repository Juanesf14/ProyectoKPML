import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../services/api'
import ProviderForm from './ProviderForm'

// Minimal CSV parser: handles quoted fields with embedded commas and newlines.
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim())
  return lines.slice(1).map(line => {
    const values = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQ = !inQ }
      else if (line[i] === ',' && !inQ) { values.push(cur); cur = '' }
      else cur += line[i]
    }
    values.push(cur)
    const obj = {}
    headers.forEach((h, i) => { obj[h] = (values[i] || '').trim() })
    return obj
  })
}

export default function ProviderList({ onSelect, selectedId }) {
  const [providers, setProviders] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingProvider, setEditingProvider] = useState(null)
  const [importing, setImporting] = useState(false)
  const csvInputRef = useRef(null)

  const fetchProviders = useCallback(async (q = '') => {
    try {
      const { data } = await api.get('/providers', { params: { q } })
      setProviders(data)
    } catch (err) {
      console.error('Failed to load providers', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const handleSearch = e => {
    setSearch(e.target.value)
    fetchProviders(e.target.value)
  }

  const handleSave = () => {
    setShowForm(false)
    setEditingProvider(null)
    fetchProviders(search)
  }

  const handleEdit = (e, provider) => {
    e.stopPropagation()
    setEditingProvider(provider)
    setShowForm(true)
  }

  const handleDelete = async (e, provider) => {
    e.stopPropagation()
    if (!confirm('Delete ' + provider.name + '?')) return
    try {
      await api.delete('/providers/' + provider.id)
      fetchProviders(search)
    } catch (err) {
      console.error('Failed to delete provider', err)
    }
  }

  const handleImportCsv = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''   // reset so the same file can be re-selected
    setImporting(true)
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      if (rows.length === 0) { alert('No valid rows found in CSV.'); return }
      const { data } = await api.post('/providers/import', { providers: rows })
      alert(`✅ Import complete: ${data.imported} added, ${data.skipped} skipped.`)
      fetchProviders(search)
    } catch (err) {
      console.error('Import error', err)
      alert('❌ Failed to import CSV.')
    } finally {
      setImporting(false)
    }
  }

  const typeIcon = type => {
  const icons = {
    'Medical Provider': '🏥',
    'Insurance': '🛡️',
    'Legal': '⚖️'
  }
  return icons[type] || '📋'
  }

  return (
    <div style={styles.container}>
      {/* Hidden CSV file input */}
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={handleImportCsv}
      />

      <div style={styles.header}>
        <h3 style={styles.title}>Medical Contacts</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={styles.btnImport}
            onClick={() => csvInputRef.current?.click()}
            disabled={importing}
            title="Import providers from CSV"
          >
            {importing ? '…' : '⬆ CSV'}
          </button>
          <button style={styles.btnNew} onClick={() => { setEditingProvider(null); setShowForm(true) }}>
            + New
          </button>
        </div>
      </div>

      <input
        style={styles.search}
        placeholder="Search providers..."
        value={search}
        onChange={handleSearch}
      />

      {loading ? (
        <p style={styles.empty}>Loading...</p>
      ) : providers.length === 0 ? (
        <p style={styles.empty}>No providers registered yet</p>
      ) : (
        <div style={styles.list}>
          {providers.map(p => (
            <div
              key={p.id}
              style={{ ...styles.item, ...(selectedId === p.id ? styles.itemActive : {}) }}
              onClick={() => onSelect(p)}
            >
              <span style={styles.icon}>{typeIcon(p.type)}</span>
              <div style={{ flex: 1 }}>
                <p style={styles.name}>{p.name}</p>
                {p.specialty && <p style={styles.sub}>{p.specialty}</p>}
                {p.phone && <p style={styles.sub}>📞 {p.phone}</p>}
              </div>
              <div style={styles.itemActions}>
                <button style={styles.btnEdit} onClick={e => handleEdit(e, p)}>✏️</button>
                <button style={styles.btnDelete} onClick={e => handleDelete(e, p)}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <ProviderForm
          provider={editingProvider}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingProvider(null) }}
        />
      )}
    </div>
  )
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    padding: '1rem',
    background: '#1B2D42',
    borderRadius: 4,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    color: '#C9A84C',
    margin: 0,
    fontSize: 14,
    fontStyle: 'italic',
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    fontWeight: 600,
    letterSpacing: '0.03em',
  },
  btnImport: {
    padding: '4px 10px',
    borderRadius: 3,
    border: '1px solid #2E4057',
    background: 'transparent',
    color: '#8B95A1',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.04em',
  },
  btnNew: {
    padding: '4px 12px',
    borderRadius: 3,
    border: '1px solid #C9A84C',
    background: 'transparent',
    color: '#C9A84C',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.06em',
  },
  search: {
    padding: '7px 12px',
    borderRadius: 3,
    border: '1px solid #2E4057',
    background: '#243447',
    color: '#F5F0E8',
    fontSize: 13,
    marginBottom: 10,
    outline: 'none',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  list: { overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 12px',
    borderRadius: 3,
    cursor: 'pointer',
    background: '#243447',
    border: '1px solid transparent',
    transition: 'border-color 0.15s',
  },
  itemActive: {
    background: 'rgba(201,168,76,0.1)',
    border: '1px solid rgba(201,168,76,0.4)',
  },
  icon: { fontSize: 18 },
  name: { color: '#F5F0E8', margin: 0, fontSize: 13, fontWeight: 600 },
  sub: { color: '#8B95A1', margin: '2px 0 0 0', fontSize: 11 },
  empty: { color: '#556270', fontSize: 13, textAlign: 'center', marginTop: 20 },
  itemActions: { display: 'flex', gap: 4, marginLeft: 'auto' },
  btnEdit: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    padding: '2px 4px',
    borderRadius: 3,
    opacity: 0.7,
  },
  btnDelete: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    padding: '2px 4px',
    borderRadius: 3,
    opacity: 0.7,
  },
}
