import { useState } from 'react'
import api from '../services/api'
import BillingCalculator from './BillingCalculator'

/**
 * BillingPanel
 *
 * Full-screen modal with a split view:
 *   Left  — PDF preview (reuses the readFileBase64 IPC + iframe pattern from FileRenamer)
 *   Right — BillingCalculator with editable claim table + AI banner
 *
 * Props:
 *   caseData  {object}   The case row from CaseTracker
 *   onClose   {function}
 */
export default function BillingPanel({ caseData, onClose }) {
  const [file, setFile]             = useState(null)
  const [previewData, setPreviewData] = useState(null) // { base64, mimeType } | 'loading' | null
  const [zoom, setZoom]             = useState(1)

  // Analysis state
  const [claims, setClaims]                   = useState([])
  const [confidence, setConfidence]           = useState(null)
  const [confidenceIssues, setConfidenceIssues] = useState([])
  const [usedOcr, setUsedOcr]                 = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [aiUsed, setAiUsed]                   = useState(false)
  const [aiLoading, setAiLoading]             = useState(false)
  const [analyzing, setAnalyzing]             = useState(false)
  const [saving, setSaving]                   = useState(false)
  const [debugText, setDebugText]             = useState('')
  const [parserUsed, setParserUsed]           = useState(null)
  const [debugOpen, setDebugOpen]             = useState(false)

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Converts backend claim objects to editable frontend state
  const normalizeClaimsForState = (raw) =>
    (raw || []).map(c => ({
      claimId:     c.claimId,
      charge:      c.charge      ?? 0,
      adjustments: c.adjustments ?? 0,
      pipPaid:     c.pipPaid     ?? c.payments?.find(p => p.source === 'pip')?.amount     ?? 0,
      healthPaid:  c.healthPaid  ?? c.payments?.filter(p => p.source === 'health').reduce((s, p) => s + p.amount, 0) ?? 0,
      patientPaid: c.patientPaid ?? c.payments?.filter(p => p.source === 'patient').reduce((s, p) => s + p.amount, 0) ?? 0,
    }))

  const applyResult = (data) => {
    setClaims(normalizeClaimsForState(data.claims))
    setConfidence(data.confidence ?? null)
    setConfidenceIssues(data.issues || [])
    setUsedOcr(data.usedOcr || false)
    setDebugText(data.debugText || '')
    setParserUsed(data.parserUsed || null)
  }

  // ── File selection ─────────────────────────────────────────────────────────
  const handleSelectFile = async () => {
    const selected = await window.electronAPI.selectFile()
    if (!selected) return

    setFile(selected)
    resetAnalysisState()

    // Load preview in background
    setPreviewData('loading')
    try {
      const result = await window.electronAPI.readFileBase64(selected.path)
      setPreviewData(result || null)
    } catch {
      setPreviewData(null)
    }

    // Run analysis
    await runAnalysis(selected.path, false)
  }

  const resetAnalysisState = () => {
    setClaims([])
    setConfidence(null)
    setConfidenceIssues([])
    setUsedOcr(false)
    setBannerDismissed(false)
    setAiUsed(false)
    setAiLoading(false)
    setDebugText('')
    setParserUsed(null)
    setDebugOpen(false)
  }

  // ── Analysis ───────────────────────────────────────────────────────────────
  const runAnalysis = async (filePath, allowAI) => {
    setAnalyzing(!allowAI)
    if (allowAI) setAiLoading(true)
    try {
      const { data } = await api.post('/billing/analyze', { filePath, allowAI })
      applyResult(data)
      if (allowAI && data.source === 'ai') setAiUsed(true)
    } catch (err) {
      console.error('Billing analysis error:', err)
    } finally {
      setAnalyzing(false)
      setAiLoading(false)
    }
  }

  const handleUseAI = () => {
    if (!file) return
    setBannerDismissed(false)
    runAnalysis(file.path, true)
  }

  // ── Claim editing ──────────────────────────────────────────────────────────
  const handleClaimChange = (idx, field, value) => {
    setClaims(prev => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c))
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    try {
      const totals = claims.reduce(
        (t, c) => ({
          totalCharges:     +(t.totalCharges     + (parseFloat(c.charge)      || 0)).toFixed(2),
          totalAdjustments: +(t.totalAdjustments + (parseFloat(c.adjustments) || 0)).toFixed(2),
          pipPaid:          +(t.pipPaid          + (parseFloat(c.pipPaid)     || 0)).toFixed(2),
          healthPaid:       +(t.healthPaid       + (parseFloat(c.healthPaid)  || 0)).toFixed(2),
          patientPaid:      +(t.patientPaid      + (parseFloat(c.patientPaid) || 0)).toFixed(2),
        }),
        { totalCharges: 0, totalAdjustments: 0, pipPaid: 0, healthPaid: 0, patientPaid: 0 }
      )
      totals.outstanding = +(totals.totalCharges - totals.totalAdjustments - totals.pipPaid - totals.healthPaid - totals.patientPaid).toFixed(2)

      await api.post('/billing/save', {
        case_num:   caseData?.num  || null,
        file_path:  file?.path     || null,
        totals,
        confidence: confidence     ?? 0,
        source:     aiUsed ? 'ai' : 'local',
      })
      alert('Billing summary saved.')
    } catch (err) {
      console.error('Save error:', err)
      alert('Error saving billing summary.')
    } finally {
      setSaving(false)
    }
  }

  // ── Preview helpers ────────────────────────────────────────────────────────
  const zoomIn    = () => setZoom(z => Math.min(3,    +(z + 0.25).toFixed(2)))
  const zoomOut   = () => setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))
  const resetZoom = () => setZoom(1)

  const pdfSrc = previewData && previewData !== 'loading'
    ? `data:${previewData.mimeType};base64,${previewData.base64}#zoom=${Math.round(zoom * 100)}`
    : null

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={s.overlay}>
      <div style={s.modal}>

        {/* Header */}
        <div style={s.header}>
          <div style={s.headerLeft}>
            <span style={s.headerTitle}>Billing Calculator</span>
            {caseData && (
              <span style={s.headerCase}>
                {caseData.num} · {caseData.last}, {caseData.first}
              </span>
            )}
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Debug bar — only shown after a file has been analyzed */}
        {parserUsed !== null && (
          <div style={s.debugBar}>
            <div style={s.debugBarRow}>
              <span style={s.debugLabel}>
                Parser: <strong style={s.debugValue}>{PARSER_LABELS[parserUsed] ?? parserUsed}</strong>
              </span>
              {usedOcr && <span style={s.debugChip}>OCR</span>}
              <button style={s.debugToggle} onClick={() => setDebugOpen(o => !o)}>
                {debugOpen ? '▲ Hide extracted text' : '▼ Show extracted text'}
              </button>
            </div>
            {debugOpen && (
              <textarea
                readOnly
                style={s.debugTextarea}
                value={debugText || '(no text extracted)'}
              />
            )}
          </div>
        )}

        {/* Split view body */}
        <div style={s.body}>

          {/* ── Left: PDF Preview ─────────────────────────────────────── */}
          <div style={s.leftPanel}>
            {/* Drop zone (always visible when no file) */}
            {!file ? (
              <div style={s.dropZone} onClick={handleSelectFile}>
                <span style={s.dropIcon}>📄</span>
                <p style={s.dropTitle}>Select billing PDF</p>
                <p style={s.dropHint}>Supports Athena and other billing formats</p>
              </div>
            ) : (
              <div style={s.previewWrap}>
                {/* Toolbar */}
                <div style={s.previewToolbar}>
                  <span style={s.fileName}>{file.name}</span>
                  <div style={s.zoomRow}>
                    <button style={s.zoomBtn} onClick={zoomOut} disabled={zoom <= 0.25}>−</button>
                    <button style={s.zoomLabel} onClick={resetZoom}>{Math.round(zoom * 100)}%</button>
                    <button style={s.zoomBtn} onClick={zoomIn}  disabled={zoom >= 3}>+</button>
                  </div>
                  <button style={s.changeFileBtn} onClick={handleSelectFile}>Change</button>
                </div>

                {previewData === 'loading' && (
                  <div style={s.previewLoading}>Loading preview…</div>
                )}
                {pdfSrc && (
                  <iframe
                    key={pdfSrc}
                    src={pdfSrc}
                    style={s.iframe}
                    title={file.name}
                  />
                )}
                {!previewData && previewData !== 'loading' && (
                  <div style={s.previewLoading}>Preview not available</div>
                )}
              </div>
            )}
          </div>

          {/* ── Right: Calculator ─────────────────────────────────────── */}
          <div style={s.rightPanel}>
            {analyzing ? (
              <div style={s.analyzingMsg}>
                <span style={s.dropIcon}>⏳</span>
                <p style={{ color: '#a0aec0', margin: 0 }}>Analyzing document…</p>
              </div>
            ) : (
              <BillingCalculator
                claims={claims}
                confidence={confidence}
                confidenceIssues={confidenceIssues}
                bannerDismissed={bannerDismissed}
                aiLoading={aiLoading}
                aiUsed={aiUsed}
                usedOcr={usedOcr}
                onClaimChange={handleClaimChange}
                onUseAI={handleUseAI}
                onDismissBanner={() => setBannerDismissed(true)}
                onSave={handleSave}
                saving={saving}
              />
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

const PARSER_LABELS = {
  'athena-raw':     'Athena Raw (Claim blocks)',
  'summary-table':  'Athena Summary Table',
  'cpt-lines':      'CPT Line Items',
  'hospital-totals':'Hospital / UB-04 Totals',
  'none':           'No parser matched',
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,.72)',
    display: 'flex', alignItems: 'stretch', justifyContent: 'center',
    zIndex: 2000,
    padding: 16,
    boxSizing: 'border-box',
  },
  modal: {
    background: '#1a1a2e',
    borderRadius: 10,
    border: '1px solid #2d3748',
    width: '100%', maxWidth: 1300,
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },

  // Header
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 18px',
    borderBottom: '1px solid #2d3748',
    background: '#16213e',
    flexShrink: 0,
  },
  headerLeft:  { display: 'flex', alignItems: 'center', gap: 14 },
  headerTitle: { fontWeight: 700, fontSize: 15, color: '#e2e8f0' },
  headerCase:  { fontSize: 12, color: '#718096' },
  closeBtn: {
    background: 'none', border: 'none',
    color: '#718096', fontSize: 18, cursor: 'pointer', padding: '2px 6px',
  },

  // Split body
  body: {
    flex: 1, display: 'flex', overflow: 'hidden', gap: 0,
  },

  // Left panel (PDF)
  leftPanel: {
    flex: 1, display: 'flex', flexDirection: 'column',
    borderRight: '1px solid #2d3748',
    overflow: 'hidden', background: '#0d1b2a',
  },
  dropZone: {
    flex: 1,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    gap: 8, cursor: 'pointer',
    border: '2px dashed #2d3748',
    margin: 20, borderRadius: 8,
    padding: 40,
    transition: 'border-color .2s',
  },
  dropIcon:  { fontSize: 36 },
  dropTitle: { color: '#a0aec0', margin: 0, fontSize: 14, fontWeight: 600 },
  dropHint:  { color: '#4a5568', margin: 0, fontSize: 12 },

  previewWrap: {
    flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 10, gap: 8,
  },
  previewToolbar: {
    display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
  },
  fileName: {
    color: '#718096', fontSize: 11, flex: 1,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  zoomRow:   { display: 'flex', gap: 2, alignItems: 'center' },
  zoomBtn: {
    width: 26, height: 22, borderRadius: 3, border: '1px solid #2d3748',
    background: '#243447', color: '#e2e8f0', fontSize: 15,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'monospace',
  },
  zoomLabel: {
    minWidth: 44, height: 22, borderRadius: 3,
    border: '1px solid #2d3748', background: 'transparent',
    color: '#a0aec0', fontSize: 11, cursor: 'pointer', textAlign: 'center',
    fontFamily: 'system-ui',
  },
  changeFileBtn: {
    padding: '3px 10px', borderRadius: 4,
    border: '1px solid #2d3748', background: 'transparent',
    color: '#a0aec0', fontSize: 11, cursor: 'pointer', flexShrink: 0,
  },
  previewLoading: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#4a5568', fontSize: 13,
  },
  iframe: {
    flex: 1, width: '100%', border: '1px solid #2d3748',
    borderRadius: 4, background: '#fff', display: 'block',
    minHeight: 0,
  },

  // Debug bar
  debugBar: {
    background: '#0d1117',
    borderBottom: '1px solid #2d3748',
    padding: '6px 14px',
    flexShrink: 0,
  },
  debugBarRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  debugLabel: {
    color: '#4a5568',
    fontSize: 11,
    flex: 1,
  },
  debugValue: {
    color: '#63b3ed',
    fontWeight: 600,
  },
  debugChip: {
    padding: '1px 6px',
    borderRadius: 3,
    background: '#1a2840',
    color: '#63b3ed',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.05em',
  },
  debugToggle: {
    background: 'none',
    border: 'none',
    color: '#4a5568',
    fontSize: 11,
    cursor: 'pointer',
    padding: '2px 4px',
    flexShrink: 0,
  },
  debugTextarea: {
    width: '100%',
    height: 180,
    marginTop: 6,
    background: '#0a0f14',
    color: '#68d391',
    border: '1px solid #1a2840',
    borderRadius: 4,
    padding: '8px 10px',
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 1.5,
    resize: 'vertical',
    boxSizing: 'border-box',
  },

  // Right panel (calculator)
  rightPanel: {
    width: 540, flexShrink: 0,
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden', padding: 14, gap: 10,
  },
  analyzingMsg: {
    flex: 1, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
}
