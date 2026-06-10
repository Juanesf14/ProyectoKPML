import { useState } from 'react'

/**
 * FilePreview
 *
 * Renders a live preview of the currently loaded document with zoom controls.
 *
 * PDFs  → <iframe> with Chromium's built-in PDF viewer.
 *         Zoom is passed via the #zoom=X URL fragment so the PDF engine
 *         re-renders at the requested DPI — no CSS pixel-scaling, no blur.
 *
 * Images → <img> whose width changes proportionally; the browser uses
 *          bicubic interpolation so it stays sharp.
 *
 * Props:
 *   file        {object|null}
 *   previewData {null | 'loading' | { base64, mimeType }}
 */
export default function FilePreview({ file, previewData }) {
  const [zoom, setZoom] = useState(1)

  const zoomIn    = () => setZoom(z => Math.min(3,    +(z + 0.25).toFixed(2)))
  const zoomOut   = () => setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))
  const resetZoom = () => setZoom(1)

  /* ── No file selected ──────────────────────────────────────────────── */
  if (!file) {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyIcon}>📄</span>
        <p style={styles.emptyTitle}>No file selected</p>
        <p style={styles.emptyHint}>
          Select a file in the <strong style={styles.hint}>Rename</strong> tab to preview it here.
        </p>
      </div>
    )
  }

  /* ── Loading ────────────────────────────────────────────────────────── */
  if (previewData === 'loading') {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyIcon}>⏳</span>
        <p style={styles.emptyTitle}>Loading preview…</p>
      </div>
    )
  }

  /* ── Load failed / unsupported ─────────────────────────────────────── */
  if (!previewData) {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyIcon}>🚫</span>
        <p style={styles.emptyTitle}>Preview not available</p>
        <p style={styles.emptyHint}>This file type cannot be previewed.</p>
      </div>
    )
  }

  const { base64, mimeType } = previewData
  const dataUrl = `data:${mimeType};base64,${base64}`

  /* ── Shared zoom toolbar ───────────────────────────────────────────── */
  const toolbar = (
    <div style={styles.toolbar}>
      <span style={styles.fileName}>{file.name}</span>
      <div style={styles.zoomControls}>
        <button style={styles.zoomBtn} onClick={zoomOut} disabled={zoom <= 0.25} title="Zoom out">−</button>
        <button style={styles.zoomLabel} onClick={resetZoom} title="Reset zoom">
          {Math.round(zoom * 100)}%
        </button>
        <button style={styles.zoomBtn} onClick={zoomIn}  disabled={zoom >= 3}    title="Zoom in">+</button>
      </div>
    </div>
  )

  /* ── PDF ────────────────────────────────────────────────────────────── */
  if (mimeType === 'application/pdf') {
    // Pass zoom via the #zoom fragment so Chromium's PDF engine renders
    // at that resolution — sharp text at any zoom level, no pixel scaling.
    const pdfSrc = `${dataUrl}#zoom=${Math.round(zoom * 100)}`

    return (
      <div style={styles.outerWrap}>
        {toolbar}
        {/* iframe fills all remaining height; the PDF viewer handles its own scroll */}
        <iframe
          key={pdfSrc}        /* force remount on zoom change so the fragment is honoured */
          src={pdfSrc}
          style={styles.frame}
          title={file.name}
        />
      </div>
    )
  }

  /* ── Image ──────────────────────────────────────────────────────────── */
  if (mimeType.startsWith('image/')) {
    return (
      <div style={styles.outerWrap}>
        {toolbar}
        <div style={styles.scrollArea}>
          <img
            src={dataUrl}
            alt={file.name}
            style={{ ...styles.image, width: `${zoom * 100}%` }}
          />
        </div>
      </div>
    )
  }

  /* ── Fallback ───────────────────────────────────────────────────────── */
  return (
    <div style={styles.empty}>
      <span style={styles.emptyIcon}>🚫</span>
      <p style={styles.emptyTitle}>Preview not available</p>
      <p style={styles.emptyHint}>This file type cannot be previewed.</p>
    </div>
  )
}

const styles = {
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '2rem',
    background: '#0D1B2A',
    borderRadius: 3,
    border: '1px dashed #2E4057',
    minHeight: 300,
  },
  emptyIcon:  { fontSize: 32, lineHeight: 1 },
  emptyTitle: { color: '#556270', margin: 0, fontSize: 13, fontWeight: 600 },
  emptyHint:  { color: '#3A4A5A', margin: 0, fontSize: 12, textAlign: 'center', lineHeight: 1.5 },
  hint:       { color: '#C9A84C', fontWeight: 600 },

  outerWrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minHeight: 0,
  },

  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexShrink: 0,
  },
  fileName: {
    color: '#8B95A1',
    fontSize: 11,
    letterSpacing: '0.04em',
    wordBreak: 'break-all',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  zoomControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  zoomBtn: {
    width: 28,
    height: 24,
    borderRadius: 3,
    border: '1px solid #2E4057',
    background: '#243447',
    color: '#F5F0E8',
    fontSize: 16,
    lineHeight: 1,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'monospace',
  },
  zoomLabel: {
    minWidth: 46,
    height: 24,
    borderRadius: 3,
    border: '1px solid #2E4057',
    background: 'transparent',
    color: '#8B95A1',
    fontSize: 11,
    cursor: 'pointer',
    textAlign: 'center',
    fontFamily: "'Inter', system-ui, sans-serif",
  },

  /* PDF iframe — fills remaining height, PDF viewer manages its own scroll */
  frame: {
    flex: 1,
    width: '100%',
    minHeight: 500,
    border: '1px solid #2E4057',
    borderRadius: 3,
    display: 'block',
    background: '#fff',
  },

  /* Image scroll container */
  scrollArea: {
    flex: 1,
    overflow: 'auto',
    border: '1px solid #2E4057',
    borderRadius: 3,
    background: '#1a1a1a',
    minHeight: 400,
  },
  image: {
    display: 'block',
    maxWidth: '100%',
    background: '#fff',
  },
}
