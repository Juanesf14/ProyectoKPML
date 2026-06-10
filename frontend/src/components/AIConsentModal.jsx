/**
 * AIConsentModal
 *
 * Shown before any document is sent to the Gemini API for AI analysis.
 * Required because documents may contain Protected Health Information (PHI/PII).
 * The user must explicitly accept before data leaves the local environment.
 *
 * Consent is stored in component state for the session — it is NOT persisted
 * to localStorage so each app session requires a fresh acknowledgement.
 */
export default function AIConsentModal({ onAccept, onCancel }) {
  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>

        <div style={styles.iconRow}>🔒</div>

        <h2 style={styles.title}>AI Analysis — Data Privacy Notice</h2>

        <p style={styles.body}>
          This document may contain <strong style={styles.highlight}>Protected Health Information (PHI)</strong> and
          other personally identifiable data (PII).
        </p>

        <p style={styles.body}>
          To improve provider matching accuracy, the document text may be sent to
          <strong style={styles.highlight}> Google Gemini API</strong> — an external service outside
          this application.
        </p>

        <div style={styles.warningBox}>
          <span style={styles.warningText}>
            ⚠ By continuing you confirm that you are authorized to share this
            document's contents with a third-party AI service, and that doing so
            complies with your firm's data handling policies.
          </span>
        </div>

        <div style={styles.actions}>
          <button style={styles.btnCancel} onClick={onCancel}>
            Cancel — Analyze locally only
          </button>
          <button style={styles.btnAccept} onClick={onAccept}>
            I Accept — Enable AI Analysis
          </button>
        </div>

      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 2000,
    background: 'rgba(0,0,0,0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
  },
  modal: {
    background: '#1B2D42',
    border: '1px solid #2E4057',
    borderTop: '3px solid #C9A84C',
    borderRadius: 4,
    padding: '2rem',
    maxWidth: 480,
    width: '100%',
    boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  iconRow: {
    fontSize: 28,
    textAlign: 'center',
  },
  title: {
    color: '#C9A84C',
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
    textAlign: 'center',
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    letterSpacing: '0.04em',
  },
  body: {
    color: '#8B95A1',
    fontSize: 13,
    lineHeight: 1.6,
    margin: 0,
  },
  highlight: {
    color: '#F5F0E8',
    fontWeight: 600,
  },
  warningBox: {
    background: 'rgba(201,168,76,0.08)',
    border: '1px solid rgba(201,168,76,0.3)',
    borderRadius: 3,
    padding: '10px 14px',
  },
  warningText: {
    color: '#C9A84C',
    fontSize: 12,
    lineHeight: 1.6,
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginTop: 4,
  },
  btnAccept: {
    padding: '11px',
    borderRadius: 3,
    border: 'none',
    background: '#C9A84C',
    color: '#0D1B2A',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  btnCancel: {
    padding: '11px',
    borderRadius: 3,
    border: '1px solid #2E4057',
    background: 'transparent',
    color: '#8B95A1',
    fontSize: 13,
    cursor: 'pointer',
  },
}
