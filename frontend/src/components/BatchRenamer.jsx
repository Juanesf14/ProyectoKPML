import { useState, useEffect, useRef } from 'react'
import api from '../services/api'
import DateField from './DateField'

const DOC_TYPES = [
  { code: 'B',   label: 'Medical Bills' },
  { code: 'MR',  label: 'Medical Records' },
  { code: 'HL',  label: 'Health Lien' },
  { code: 'PIP', label: 'PIP Log' },
]

// Formats yyyy-mm-dd (from <input type="date">) to MM/DD/YYYY for file names.
const formatDate = (dateStr) => {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  // mm.dd.yy with dots — "/" is a path separator and is invalid in filenames.
  return `${m}.${d}.${y.slice(-2)}`
}

// Replaces characters invalid in file names so a "/" in a name can't break the rename.
const sanitizeFilename = (n) => n.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()

// Medical types follow fixed templates; everything else is a general document
// (category 4): named exactly as titled, preceded by entity, optional date.
const MEDICAL_TYPES = ['B', 'MR', 'HL', 'PIP']

const buildName = ({ docType, entityName, dosStart, dosEnd, updateDate, pipExhausted, title, docDate }) => {
  if (!docType) return ''
  const ds = formatDate(dosStart)
  const de = formatDate(dosEnd)
  const ud = formatDate(updateDate)
  const range = de ? `${ds}-${de}` : ds

  // General documents — free-text title, entity optional, optional date.
  if (!MEDICAL_TYPES.includes(docType)) {
    const t = (title || '').trim()
    if (!t) return ''
    const datePart = docDate ? `-${formatDate(docDate)}` : ''
    const general = entityName ? `${entityName}-${t}${datePart}` : `${t}${datePart}`
    return sanitizeFilename(general)
  }

  if (!entityName) return ''

  let name = ''
  if (docType === 'B')   name = (dosStart && updateDate) ? `Bills-${entityName}-DOS ${range}-updated as of ${ud}` : ''
  else if (docType === 'MR')  name = dosStart ? `Records-${entityName}-DOS ${range}` : ''
  else if (docType === 'HL')  name = updateDate ? `${entityName} Health Lien-updated as of ${ud}` : ''
  else if (docType === 'PIP') {
    // Exhausted PIP logs carry no "updated as of" date per convention.
    if (pipExhausted === 'Y') name = `${entityName} PIP Log-exhausted`
    else name = updateDate ? `${entityName} PIP Log-updated as of ${ud}` : ''
  }
  return name ? sanitizeFilename(name) : ''
}

let idCounter = 0
const uid = () => String(++idCounter)

export default function BatchRenamer() {
  const [folderPath, setFolderPath]   = useState(null)
  const [queue, setQueue]             = useState([])
  const [analyzing, setAnalyzing]     = useState(false)
  const [renamingIds, setRenamingIds] = useState(new Set())
  const [docTypes, setDocTypes]       = useState([])
  const abortRef = useRef(false)

  useEffect(() => {
    api.get('/document-types').then(({ data }) => setDocTypes(data))
  }, [])

  const updateItem = (id, patch) =>
    setQueue(q => q.map(item => item.id === id ? { ...item, ...patch } : item))

  const updateForm = (id, patch) =>
    setQueue(q => q.map(item => {
      if (item.id !== id) return item
      const form = { ...item.form, ...patch }
      return { ...item, form, newName: buildName(form) }
    }))

  const handleSelectFolder = async () => {
    const path = await window.electronAPI.selectFolder()
    if (!path) return
    setFolderPath(path)

    const allFiles = await window.electronAPI.readFolder(path)
    const pdfs = allFiles.filter(f => f.name.toLowerCase().endsWith('.pdf'))

    setQueue(pdfs.map(f => ({
      id: uid(),
      file: f,
      status: 'pending',
      selected: true,
      suggestion: null,
      usedOcr: false,
      form: { docType: '', entityName: '', dosStart: '', dosEnd: '', updateDate: '', pipExhausted: 'N', title: '', docDate: '' },
      newName: '',
      error: null,
    })))
  }

  const handleAnalyzeAll = async () => {
    setAnalyzing(true)
    abortRef.current = false

    for (const item of queue) {
      if (abortRef.current) break
      if (item.status === 'done') continue

      updateItem(item.id, { status: 'analyzing', error: null })

      try {
        const { data } = await api.post('/analyze', { filePath: item.file.path })
        const form = { ...item.form }

        if (data.suggestion) {
          form.entityName = data.suggestion.name
        }
        if (data.docType)            form.docType    = data.docType
        if (data.dates?.dosStart)    form.dosStart   = data.dates.dosStart
        if (data.dates?.dosEnd)      form.dosEnd     = data.dates.dosEnd
        if (data.dates?.updateDate)  form.updateDate = data.dates.updateDate

        setQueue(q => q.map(i => {
          if (i.id !== item.id) return i
          return {
            ...i,
            status: 'ready',
            suggestion: data.suggestion || null,
            usedOcr: data.usedOcr || false,
            form,
            newName: buildName(form),
          }
        }))
      } catch {
        updateItem(item.id, { status: 'error', error: 'Analysis failed' })
      }
    }

    setAnalyzing(false)
  }

  const handleRenameSelected = async () => {
    const selected = queue.filter(i => i.selected && i.newName && i.status !== 'done')
    if (selected.length === 0) return

    for (const item of selected) {
      setRenamingIds(s => new Set([...s, item.id]))
      try {
        const ext = item.file.name.split('.').pop()
        const dir = item.file.path.slice(0, item.file.path.lastIndexOf('/') + 1)
        const newFullName = `${item.newName}.${ext}`
        const newPath = `${dir}${newFullName}`

        await window.electronAPI.renameFile({ oldPath: item.file.path, newPath })

        const docType = docTypes.find(dt => dt.code === item.form.docType)
        await api.post('/history', {
          provider_id:    item.suggestion?.provider_id || null,
          doc_type_id:    docType?.id || null,
          original_name:  item.file.name,
          new_name:       newFullName,
          entity_name:    item.form.entityName || null,
          dos_start:      item.form.dosStart || null,
          dos_end:        item.form.dosEnd   || null,
          update_date:    item.form.updateDate || null,
          pip_exhausted:  item.form.pipExhausted === 'Y',
        })

        updateItem(item.id, { status: 'done' })
      } catch {
        updateItem(item.id, { status: 'error', error: 'Rename failed' })
      } finally {
        setRenamingIds(s => { const n = new Set(s); n.delete(item.id); return n })
      }
    }
  }

  const selectedCount = queue.filter(i => i.selected && i.newName && i.status !== 'done').length
  const readyCount    = queue.filter(i => i.status === 'ready' || i.status === 'done').length
  const allSelected   = queue.length > 0 && queue.every(i => i.selected)

  const toggleAll = () => setQueue(q => q.map(i => ({ ...i, selected: !allSelected })))

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <button style={styles.btnFolder} onClick={handleSelectFolder} disabled={analyzing}>
            Select Folder
          </button>
          {folderPath && (
            <span style={styles.folderPath} title={folderPath}>
              {folderPath.split('/').slice(-2).join('/')}
            </span>
          )}
        </div>

        <div style={styles.headerRight}>
          {queue.length > 0 && (
            <span style={styles.counter}>
              {readyCount}/{queue.length} analyzed
            </span>
          )}
          {queue.length > 0 && !analyzing && (
            <button style={styles.btnAnalyze} onClick={handleAnalyzeAll}>
              Analyze All
            </button>
          )}
          {analyzing && (
            <button style={styles.btnStop} onClick={() => { abortRef.current = true }}>
              Stop
            </button>
          )}
          <button
            style={{ ...styles.btnRename, opacity: selectedCount === 0 ? 0.4 : 1 }}
            onClick={handleRenameSelected}
            disabled={selectedCount === 0}
          >
            Rename Selected ({selectedCount})
          </button>
        </div>
      </div>

      {/* Empty state */}
      {queue.length === 0 && (
        <div style={styles.emptyState}>
          <p style={styles.emptyText}>Select a folder to load PDFs</p>
        </div>
      )}

      {/* Table */}
      {queue.length > 0 && (
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                </th>
                <th style={styles.th}>File</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Provider / Entity</th>
                <th style={styles.th}>Doc Type</th>
                <th style={styles.th}>Title</th>
                <th style={styles.th}>DOS Start</th>
                <th style={styles.th}>DOS End</th>
                <th style={styles.th}>Update / Date</th>
                <th style={styles.th}>New Name</th>
              </tr>
            </thead>
            <tbody>
              {queue.map(item => (
                <BatchRow
                  key={item.id}
                  item={item}
                  docTypes={docTypes}
                  renaming={renamingIds.has(item.id)}
                  onToggle={() => updateItem(item.id, { selected: !item.selected })}
                  onFormChange={(patch) => updateForm(item.id, patch)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function BatchRow({ item, docTypes, renaming, onToggle, onFormChange }) {
  const { file, status, form, newName, suggestion, usedOcr, error, selected } = item
  const typeOptions = docTypes.length ? docTypes : DOC_TYPES
  const isGeneral = form.docType && !MEDICAL_TYPES.includes(form.docType)

  const statusColor = {
    pending:   '#718096',
    analyzing: '#f6ad55',
    ready:     '#68d391',
    done:      '#4299e1',
    error:     '#fc8181',
  }[status]

  const statusLabel = {
    pending:   'Pending',
    analyzing: 'Analyzing…',
    ready:     'Ready',
    done:      'Done',
    error:     error || 'Error',
  }[status]

  const rowBg = status === 'done' ? '#0d2a1a' : status === 'error' ? '#2a1010' : 'transparent'

  return (
    <tr style={{ background: rowBg, opacity: renaming ? 0.6 : 1 }}>
      <td style={styles.td}>
        <input type="checkbox" checked={selected} onChange={onToggle} disabled={status === 'done'} />
      </td>

      <td style={{ ...styles.td, maxWidth: 180 }}>
        <span style={styles.fileName} title={file.name}>{file.name}</span>
        {usedOcr && <span style={styles.ocrBadge}>OCR</span>}
        {suggestion && (
          <span style={styles.confidenceBadge}>
            {Math.round(suggestion.confidence * 100)}%
          </span>
        )}
      </td>

      <td style={styles.td}>
        <span style={{ color: statusColor, fontSize: 11, fontWeight: 600 }}>{statusLabel}</span>
      </td>

      <td style={styles.td}>
        <input
          style={styles.cellInput}
          value={form.entityName}
          placeholder="Provider name…"
          onChange={e => onFormChange({ entityName: e.target.value })}
          disabled={status === 'done'}
        />
      </td>

      <td style={styles.td}>
        <select
          style={styles.cellInput}
          value={form.docType}
          onChange={e => onFormChange({ docType: e.target.value })}
          disabled={status === 'done'}
        >
          <option value="">Type…</option>
          {typeOptions.map(dt => (
            <option key={dt.code} value={dt.code}>{dt.code}</option>
          ))}
        </select>
      </td>

      <td style={styles.td}>
        {isGeneral && (
          <input
            style={styles.cellInput}
            value={form.title || ''}
            placeholder="Title…"
            onChange={e => onFormChange({ title: e.target.value })}
            disabled={status === 'done'}
          />
        )}
      </td>

      <td style={styles.td}>
        {(form.docType === 'B' || form.docType === 'MR') && (
          <DateField
            value={form.dosStart}
            style={styles.cellInput}
            onChange={e => onFormChange({ dosStart: e.target.value })}
            disabled={status === 'done'}
          />
        )}
      </td>

      <td style={styles.td}>
        {(form.docType === 'B' || form.docType === 'MR') && (
          <DateField
            value={form.dosEnd}
            style={styles.cellInput}
            onChange={e => onFormChange({ dosEnd: e.target.value })}
            disabled={status === 'done'}
          />
        )}
      </td>

      <td style={styles.td}>
        {(form.docType === 'B' || form.docType === 'HL' || form.docType === 'PIP') && (
          <DateField
            value={form.updateDate}
            style={styles.cellInput}
            onChange={e => onFormChange({ updateDate: e.target.value })}
            disabled={status === 'done'}
          />
        )}
        {isGeneral && (
          <DateField
            value={form.docDate || ''}
            style={styles.cellInput}
            onChange={e => onFormChange({ docDate: e.target.value })}
            disabled={status === 'done'}
          />
        )}
      </td>

      <td style={{ ...styles.td, maxWidth: 240 }}>
        <span style={{ ...styles.newName, color: newName ? '#68d391' : '#4a5568' }}>
          {newName || '—'}
        </span>
      </td>
    </tr>
  )
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#16213e',
    borderRadius: 10,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    borderBottom: '1px solid #2d3748',
    gap: 10,
    flexShrink: 0,
  },
  headerLeft:  { display: 'flex', alignItems: 'center', gap: 10 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
  folderPath: {
    color: '#718096',
    fontSize: 12,
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  counter: { color: '#718096', fontSize: 12 },
  btnFolder: {
    padding: '6px 12px', borderRadius: 6, border: '1px solid #4a5568',
    background: 'transparent', color: '#e2e8f0', fontSize: 12, cursor: 'pointer',
  },
  btnAnalyze: {
    padding: '6px 12px', borderRadius: 6, border: 'none',
    background: '#2d6a4f', color: '#68d391', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  btnStop: {
    padding: '6px 12px', borderRadius: 6, border: 'none',
    background: '#744210', color: '#f6ad55', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  btnRename: {
    padding: '6px 14px', borderRadius: 6, border: 'none',
    background: '#e94560', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
  emptyState: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  emptyText: { color: '#4a5568', fontSize: 14 },
  tableWrapper: { flex: 1, overflowY: 'auto', overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    padding: '8px 10px',
    textAlign: 'left',
    color: '#718096',
    fontWeight: 600,
    borderBottom: '1px solid #2d3748',
    whiteSpace: 'nowrap',
    position: 'sticky',
    top: 0,
    background: '#16213e',
    zIndex: 1,
  },
  td: {
    padding: '6px 8px',
    borderBottom: '1px solid #1a2744',
    verticalAlign: 'middle',
  },
  fileName: {
    color: '#a0aec0',
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 160,
  },
  ocrBadge: {
    display: 'inline-block', marginLeft: 4,
    padding: '1px 4px', background: '#744210', color: '#f6ad55',
    borderRadius: 3, fontSize: 9, fontWeight: 600,
  },
  confidenceBadge: {
    display: 'inline-block', marginLeft: 4,
    padding: '1px 4px', background: '#1a3a2a', color: '#68d391',
    borderRadius: 3, fontSize: 9,
  },
  cellInput: {
    width: '100%', padding: '4px 6px', borderRadius: 4,
    border: '1px solid #2d3748', background: '#0f3460',
    color: '#e2e8f0', fontSize: 11, outline: 'none',
    boxSizing: 'border-box',
  },
  newName: {
    display: 'block', fontSize: 11,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    maxWidth: 220,
  },
}
