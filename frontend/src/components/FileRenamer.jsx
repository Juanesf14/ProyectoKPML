import { useState, useEffect } from 'react'
import api from '../services/api'
import ChatPanel from './ChatPanel'
import AIConsentModal from './AIConsentModal'
import FilePreview from './FilePreview'
import DateField from './DateField'

export default function FileRenamer({ selectedProvider, onRenameSuccess, initialFile, onInitialFileConsumed }) {
  const [docTypes, setDocTypes] = useState([])
  const [form, setForm] = useState({
    docType: '',
    dosStart: '',
    dosEnd: '',
    updateDate: '',
    pipExhausted: 'N',
  })
  const [currentFile, setCurrentFile] = useState(null)
  const [newName, setNewName] = useState('')
  const [entityName, setEntityName] = useState('')
  const [suggestedProvider, setSuggestedProvider] = useState(null)
  const [detectedEntity, setDetectedEntity] = useState(null)
  const [autoFilledFields, setAutoFilledFields] = useState({})
  const [flags, setFlags] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [chatOpen, setChatOpen] = useState(false)

  // Active tab: 'rename' shows the form, 'preview' shows the document viewer.
  const [activeTab, setActiveTab] = useState('rename')

  // Preview data loaded from main process via read-file-base64 IPC.
  // null = not loaded, 'loading' = in-flight, object = ready.
  const [previewData, setPreviewData] = useState(null)

  // AI consent is tracked for the session (not persisted to localStorage).
  // The modal appears AFTER local analysis returns with low confidence — not
  // when the file is loaded — so the form already shows what was found locally.
  // null = not asked yet | 'pending' = modal open | 'granted' | 'denied'
  const [aiConsent, setAiConsent] = useState(null)
  const [pendingFile, setPendingFile] = useState(null) // file waiting for AI consent

  useEffect(() => {
    api.get('/document-types').then(({ data }) => setDocTypes(data))
  }, [])

  useEffect(() => {
    if (selectedProvider) setEntityName(selectedProvider.name)
  }, [selectedProvider])

  // When BillingPanel sends a file after saving, auto-load it here
  useEffect(() => {
    if (!initialFile) return
    setCurrentFile(initialFile)
    setSuggestedProvider(null)
    setDetectedEntity(null)
    setAutoFilledFields({})
    setFlags(null)
    setSessionId(null)
    setAiConsent(null)
    setPendingFile(null)
    loadPreview(initialFile)
    runAnalysis(initialFile)
    if (onInitialFileConsumed) onInitialFileConsumed()
  }, [initialFile])

  useEffect(() => {
    buildName()
  }, [form, entityName])

  const handleChange = e => setForm({ ...form, [e.target.name]: e.target.value })

  // Formats yyyy-mm-dd (from <input type="date">) to MM/DD/YYYY for file names.
  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    const [y, m, d] = dateStr.split('-')
    return `${m}/${d}/${y}`
  }

  const buildName = () => {
    if (!form.docType || !entityName) {
      setNewName('')
      return
    }

    const facility   = entityName
    const dosStart   = formatDate(form.dosStart)
    const dosEnd     = formatDate(form.dosEnd)
    const updateDate = formatDate(form.updateDate)
    const dosRange   = dosEnd ? `${dosStart}-${dosEnd}` : dosStart

    let name = ''

    if (form.docType === 'B') {
      if (!form.dosStart || !form.updateDate) { setNewName(''); return }
      name = `Bills-${facility}-DOS ${dosRange}-updated as of ${updateDate}`
    } else if (form.docType === 'MR') {
      if (!form.dosStart) { setNewName(''); return }
      name = `Records-${facility}-DOS ${dosRange}`
    } else if (form.docType === 'HL') {
      if (!form.updateDate) { setNewName(''); return }
      name = `${facility} Health Lien-updated as of ${updateDate}`
    } else if (form.docType === 'PIP') {
      if (!form.updateDate) { setNewName(''); return }
      if (form.pipExhausted === 'Y') {
        name = `${facility} PIP Log-exhausted-updated as of ${updateDate}`
      } else {
        name = `${facility} PIP Log-updated as of ${updateDate}`
      }
    }

    setNewName(name)
  }

  /**
   * Loads the file bytes from the main process and stores a base64 data-URL
   * so the Preview tab can render without needing file:// access.
   */
  const loadPreview = async (file) => {
    setPreviewData('loading')
    try {
      const result = await window.electronAPI.readFileBase64(file.path)
      setPreviewData(result || null)
    } catch {
      setPreviewData(null)
    }
  }

  /**
   * Sends the file to the backend for text extraction + provider matching.
   *
   * allowAI (default false) controls whether the backend is permitted to call
   * Gemini.  When false and confidence < 25%, the server returns needsAI=true
   * instead of calling Gemini, and this function shows the consent modal.
   * When the user accepts, this is called again with allowAI=true.
   */
  const runAnalysis = async (file, allowAI = false) => {
    try {
      const { data } = await api.post('/analyze', { filePath: file.path, allowAI })
      const filled = {}

      if (data.sessionId) setSessionId(data.sessionId)

      // Open extraction: the document's own entity name (DB-independent).
      if (data.detectedEntity) setDetectedEntity(data.detectedEntity)

      if (data.suggestion) {
        // Detected name mapped to a REGISTERED provider — use the canonical name.
        const { provider_id, name, confidence, method } = data.suggestion
        setEntityName(name)
        setSuggestedProvider({ provider_id, name, confidence, method, usedOcr: data.usedOcr })
      } else if (data.detectedEntity?.name) {
        // Detected but not registered — still fill the field with the raw name.
        setEntityName(data.detectedEntity.name)
      }

      if (data.dates) {
        const updates = {}
        if (data.dates.dosStart)   { updates.dosStart   = data.dates.dosStart;   filled.dosStart   = true }
        if (data.dates.dosEnd)     { updates.dosEnd     = data.dates.dosEnd;     filled.dosEnd     = true }
        if (data.dates.updateDate) { updates.updateDate = data.dates.updateDate; filled.updateDate = true }
        if (Object.keys(updates).length > 0) setForm(f => ({ ...f, ...updates }))
      }

      setAutoFilledFields(filled)
      if (data.flags) setFlags(data.flags)

      // Server says local confidence is below 25% and AI could help.
      // Only ask for consent if the user hasn't decided yet this session.
      if (data.needsAI && aiConsent === null) {
        setPendingFile(file)
        setAiConsent('pending')
      }
    } catch (err) {
      console.error('Analysis error:', err)
    }
  }

  const handleSelectFile = async () => {
    const file = await window.electronAPI.selectFile()
    if (!file) return

    setCurrentFile(file)
    setSuggestedProvider(null)
    setDetectedEntity(null)
    setAutoFilledFields({})
    setFlags(null)
    setSessionId(null)

    // Start loading the preview in the background for all file types.
    loadPreview(file)

    // Only PDF and image files can be analyzed.
    const ext = file.name.split('.').pop().toLowerCase()
    const analyzable = ['pdf', 'jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'webp']
    if (!analyzable.includes(ext)) return

    // If the user already granted AI consent this session, run the full pipeline.
    if (aiConsent === 'granted') {
      runAnalysis(file, true)
      return
    }

    // For all other cases (first-time or previously denied) run local-only first.
    // If confidence is low AND consent hasn't been decided, runAnalysis will
    // set aiConsent='pending' and show the modal after the result comes back.
    runAnalysis(file, false)
  }

  const handleConsentAccept = () => {
    setAiConsent('granted')
    // Re-run with AI enabled — this replaces the local-only result in state.
    if (pendingFile) runAnalysis(pendingFile, true)
    setPendingFile(null)
  }

  const handleConsentCancel = () => {
    setAiConsent('denied')
    setPendingFile(null)
    // Local-only result is already in state from the first runAnalysis call — nothing to redo.
  }

  const handleRename = async () => {
    if (!currentFile || !newName) return
    const ext = currentFile.name.split('.').pop()
    const dir = currentFile.path.replace(currentFile.name, '')
    const newFullName = `${newName}.${ext}`

    try {
      await window.electronAPI.renameFile({
        oldPath: currentFile.path,
        newPath: `${dir}${newFullName}`
      })

      const docType = docTypes.find(dt => dt.code === form.docType)
      await api.post('/history', {
        provider_id: selectedProvider?.id || suggestedProvider?.provider_id || null,
        doc_type_id: docType?.id || null,
        original_name: currentFile.name,
        new_name: newFullName,
        dos_start: form.dosStart || null,
        dos_end: form.dosEnd || null,
        update_date: form.updateDate || null,
        pip_exhausted: form.pipExhausted === 'Y'
      })

      setCurrentFile(null)
      setNewName('')
      setEntityName('')
      setSuggestedProvider(null)
      setDetectedEntity(null)
      setAutoFilledFields({})
      setFlags(null)
      setSessionId(null)
      setChatOpen(false)
      setPreviewData(null)
      setActiveTab('rename')
      alert(`✅ File renamed: ${newFullName}`)
      setForm({ docType: '', dosStart: '', dosEnd: '', updateDate: '', pipExhausted: 'N' })
      if (onRenameSuccess) onRenameSuccess()

    } catch (err) {
      console.error('Rename error:', err)
      alert('❌ Failed to rename the file')
    }
  }

  const handleClear = () => {
    setForm({ docType: '', dosStart: '', dosEnd: '', updateDate: '', pipExhausted: 'N' })
    setCurrentFile(null)
    setNewName('')
    setEntityName('')
    setSuggestedProvider(null)
    setDetectedEntity(null)
    setAutoFilledFields({})
    setFlags(null)
    setSessionId(null)
    setChatOpen(false)
    setPreviewData(null)
    setActiveTab('rename')
  }

  return (
    <div style={styles.container}>
      {aiConsent === 'pending' && (
        <AIConsentModal
          onAccept={handleConsentAccept}
          onCancel={handleConsentCancel}
        />
      )}

      <h3 style={styles.title}>File Renamer</h3>

      {/* ── Tab bar ────────────────────────────────────────────────── */}
      <div style={styles.tabs}>
        <button
          style={activeTab === 'rename' ? styles.tabActive : styles.tabInactive}
          onClick={() => setActiveTab('rename')}
        >
          Rename
        </button>
        <button
          style={activeTab === 'preview'
            ? styles.tabActive
            : currentFile ? styles.tabInactive : styles.tabDisabled}
          onClick={() => currentFile && setActiveTab('preview')}
          disabled={!currentFile}
          title={!currentFile ? 'Select a file first' : undefined}
        >
          Preview {previewData === 'loading' ? '…' : ''}
        </button>
      </div>

      {/* ── PREVIEW tab ────────────────────────────────────────────── */}
      {activeTab === 'preview' && (
        <FilePreview file={currentFile} previewData={previewData} />
      )}

      {/* ── RENAME tab ─────────────────────────────────────────────── */}
      {activeTab === 'rename' && <>

      <div style={styles.dropZone} onClick={handleSelectFile}>
        {currentFile
          ? <p style={styles.previewText}>📄 {currentFile.name}</p>
          : <p style={styles.previewPlaceholder}>Click to select a file</p>
        }
      </div>

      {suggestedProvider && (
        <div style={styles.suggestion}>
          <span>🤖 Suggested: <strong>{suggestedProvider.name}</strong></span>
          <span style={styles.confidence}>
            {Math.round(suggestedProvider.confidence * 100)}% — {suggestedProvider.method}
            {suggestedProvider.usedOcr && <span style={styles.ocrBadge}>OCR</span>}
          </span>
        </div>
      )}

      {!suggestedProvider && detectedEntity?.name && (
        <div style={styles.detected}>
          <span>🔎 Detected: <strong>{detectedEntity.name}</strong></span>
          <span style={styles.detectedHint}>Not in your provider list — edit or add it</span>
        </div>
      )}

      {flags?.hasAmbulance && (
        <div style={{ ...styles.flagBanner, borderColor: '#B8860B', background: '#2A1F08' }}>
          <span style={{ color: '#C9A84C', fontWeight: 600, fontSize: 12 }}>🚑 Ambulance transport detected</span>
          <span style={{ color: '#8B95A1', fontSize: 11 }}>
            {flags.ambulanceCompany
              ? <>Company: <strong style={{ color: '#E8C96A' }}>{flags.ambulanceCompany}</strong></>
              : 'Verify if this affects billing or document type'
            }
          </span>
        </div>
      )}

      {flags?.hasReferral && (
        <div style={{ ...styles.flagBanner, borderColor: '#2E6DA4', background: '#0A1E32' }}>
          <span style={{ color: '#7BB3D9', fontWeight: 600, fontSize: 12 }}>↗ Referral detected</span>
          {flags.referrals?.length > 0 && (
            <span style={{ color: '#8B95A1', fontSize: 11 }}>
              {flags.referrals.join(' · ')}
            </span>
          )}
        </div>
      )}

      <div style={styles.field}>
        <label style={styles.label}>Document Type</label>
        <select name="docType" value={form.docType} onChange={handleChange} style={styles.input}>
          <option value="">Select...</option>
          {docTypes.map(dt => (
            <option key={dt.id} value={dt.code}>{dt.code} – {dt.label}</option>
          ))}
        </select>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Entity (hospital/insurance)</label>
        <input
          style={styles.input}
          placeholder="Type or select a provider..."
          value={entityName}
          onChange={e => setEntityName(e.target.value)}
        />
      </div>

      {(form.docType === 'B' || form.docType === 'MR') && (
        <div style={styles.row}>
          <div style={styles.field}>
            <label style={styles.label}>
              DOS Start {autoFilledFields.dosStart && <span style={styles.autoBadge}>auto</span>}
            </label>
            <DateField
              name="dosStart"
              value={form.dosStart}
              style={{ ...styles.input, ...(autoFilledFields.dosStart ? styles.inputAuto : {}) }}
              onChange={e => { handleChange(e); setAutoFilledFields(f => ({ ...f, dosStart: false })) }}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>
              DOS End {autoFilledFields.dosEnd && <span style={styles.autoBadge}>auto</span>}
            </label>
            <DateField
              name="dosEnd"
              value={form.dosEnd}
              style={{ ...styles.input, ...(autoFilledFields.dosEnd ? styles.inputAuto : {}) }}
              onChange={e => { handleChange(e); setAutoFilledFields(f => ({ ...f, dosEnd: false })) }}
            />
          </div>
        </div>
      )}

      {(form.docType === 'B' || form.docType === 'HL' || form.docType === 'PIP') && (
        <div style={styles.field}>
          <label style={styles.label}>
            Updated as of {autoFilledFields.updateDate && <span style={styles.autoBadge}>auto</span>}
          </label>
          <DateField
            name="updateDate"
            value={form.updateDate}
            style={{ ...styles.input, ...(autoFilledFields.updateDate ? styles.inputAuto : {}) }}
            onChange={e => { handleChange(e); setAutoFilledFields(f => ({ ...f, updateDate: false })) }}
          />
        </div>
      )}

      {form.docType === 'PIP' && (
        <div style={styles.field}>
          <label style={styles.label}>PIP Exhausted? (Y/N)</label>
          <select name="pipExhausted" value={form.pipExhausted} onChange={handleChange} style={styles.input}>
            <option value="N">N</option>
            <option value="Y">Y</option>
          </select>
        </div>
      )}

      <div style={styles.namePreview}>
        <p style={styles.nameLabel}>Current: <span style={styles.nameCurrent}>{currentFile?.name || '—'}</span></p>
        <p style={styles.nameLabel}>New: <span style={styles.nameNew}>{newName ? `${newName}.${currentFile?.name.split('.').pop() || 'pdf'}` : '—'}</span></p>
      </div>

      <div style={styles.actions}>
        <button style={styles.btnPrimary} onClick={handleRename} disabled={!currentFile || !newName}>
          Rename
        </button>
        <button style={styles.btnSecondary} onClick={handleClear}>Clear Fields</button>
      </div>

      {sessionId && (
        <button style={styles.chatBtn} onClick={() => setChatOpen(true)}>
          💬 Ask AI about this document
        </button>
      )}

      {chatOpen && sessionId && (
        <ChatPanel
          sessionId={sessionId}
          documentName={currentFile?.name}
          onClose={() => setChatOpen(false)}
        />
      )}

      </> /* end Rename tab */}
    </div>
  )
}

const styles = {
  container: {
    flex: 1,
    minHeight: 0,
    padding: '1rem',
    background: '#1B2D42',
    borderRadius: 4,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  title: {
    color: '#C9A84C',
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  tabs: { display: 'flex', gap: 6 },
  tabActive: {
    color: '#F5F0E8',
    fontSize: 12,
    padding: '4px 14px',
    background: '#243447',
    borderRadius: 2,
    border: '1px solid #C9A84C',
    cursor: 'pointer',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  tabInactive: {
    color: '#8B95A1',
    fontSize: 12,
    padding: '4px 14px',
    background: 'transparent',
    borderRadius: 2,
    border: '1px solid #2E4057',
    cursor: 'pointer',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  tabDisabled: {
    color: '#3A4A5A',
    fontSize: 12,
    padding: '4px 14px',
    background: 'transparent',
    borderRadius: 2,
    border: '1px solid #1E2D3D',
    cursor: 'not-allowed',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  dropZone: {
    minHeight: 76,
    background: '#243447',
    borderRadius: 3,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    border: '1px dashed #2E4057',
    padding: '8px',
    textAlign: 'center',
    transition: 'border-color 0.2s',
  },
  previewText: { color: '#F5F0E8', margin: 0, fontSize: 12, wordBreak: 'break-all' },
  previewPlaceholder: { color: '#556270', margin: 0, fontSize: 12 },
  suggestion: {
    background: 'rgba(201,168,76,0.08)',
    border: '1px solid rgba(201,168,76,0.35)',
    borderRadius: 3,
    padding: '8px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 12,
    color: '#C9A84C',
  },
  confidence: {
    color: '#8B95A1',
    fontSize: 11,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  detected: {
    background: 'rgba(123,179,217,0.08)',
    border: '1px solid rgba(123,179,217,0.35)',
    borderRadius: 3,
    padding: '8px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    fontSize: 12,
    color: '#7BB3D9',
  },
  detectedHint: {
    color: '#8B95A1',
    fontSize: 11,
  },
  ocrBadge: {
    display: 'inline-block',
    padding: '1px 5px',
    background: '#2A1F08',
    color: '#C9A84C',
    borderRadius: 2,
    fontSize: 10,
    fontWeight: 600,
  },
  flagBanner: {
    borderRadius: 3,
    border: '1px solid',
    padding: '8px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    fontSize: 12,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { color: '#8B95A1', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' },
  input: {
    padding: '7px 10px',
    borderRadius: 3,
    border: '1px solid #2E4057',
    background: '#243447',
    color: '#F5F0E8',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  row: { display: 'flex', gap: 8 },
  autoBadge: {
    display: 'inline-block',
    marginLeft: 4,
    padding: '1px 5px',
    background: 'rgba(201,168,76,0.15)',
    color: '#C9A84C',
    borderRadius: 2,
    fontSize: 10,
    fontWeight: 600,
    verticalAlign: 'middle',
  },
  inputAuto: {
    borderColor: 'rgba(201,168,76,0.4)',
    background: 'rgba(201,168,76,0.06)',
  },
  namePreview: {
    background: '#0D1B2A',
    borderRadius: 3,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    border: '1px solid #2E4057',
  },
  nameLabel: { color: '#556270', margin: 0, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' },
  nameCurrent: { color: '#8B95A1', wordBreak: 'break-all', fontSize: 12 },
  nameNew: { color: '#C9A84C', fontWeight: 600, wordBreak: 'break-all', fontSize: 12 },
  actions: { display: 'flex', gap: 8, paddingBottom: '1rem' },
  btnPrimary: {
    flex: 1,
    padding: '9px',
    borderRadius: 3,
    border: 'none',
    background: '#C9A84C',
    color: '#0D1B2A',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  btnSecondary: {
    flex: 1,
    padding: '9px',
    borderRadius: 3,
    border: '1px solid #2E4057',
    background: 'transparent',
    color: '#8B95A1',
    fontSize: 13,
    cursor: 'pointer',
  },
  chatBtn: {
    width: '100%',
    padding: '9px',
    borderRadius: 3,
    border: '1px solid rgba(201,168,76,0.35)',
    background: 'rgba(201,168,76,0.08)',
    color: '#C9A84C',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    marginBottom: '0.5rem',
    letterSpacing: '0.04em',
  },
}