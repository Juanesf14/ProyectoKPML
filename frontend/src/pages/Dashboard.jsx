import { useState } from 'react'
import ProviderList from '../components/ProviderList'
import ProviderCard from '../components/ProviderCard'
import FileRenamer from '../components/FileRenamer'
import BatchRenamer from '../components/BatchRenamer'
import CaseTracker from '../components/CaseTracker'
import BillingPanel from '../components/BillingPanel'

export default function Dashboard({ user, onLogout }) {
  const [selectedProvider, setSelectedProvider] = useState(null)
  const [refreshTrigger, setRefreshTrigger]     = useState(0)
  const [mode, setMode]                         = useState('single') // 'single' | 'batch' | 'cases'
  const [billingOpen, setBillingOpen]           = useState(false)
  const [renamerInitialFile, setRenamerInitialFile] = useState(null)

  const handleRenameSuccess = () => setRefreshTrigger(prev => prev + 1)

  const handleSendToRenamer = (file) => {
    setBillingOpen(false)
    setMode('single')
    setRenamerInitialFile(file)
  }

  return (
    <div style={styles.container}>
      <div style={styles.topbar}>
        <div style={styles.topbarLeft}>
          <span style={styles.logo}>K&P · RenamerJF</span>
          <span style={styles.appName}>Medical Records Manager</span>

          <div style={styles.modeToggle}>
            <button
              style={mode === 'single' ? styles.modeActive : styles.modeInactive}
              onClick={() => setMode('single')}
            >
              Single File
            </button>
            <button
              style={mode === 'batch' ? styles.modeActive : styles.modeInactive}
              onClick={() => setMode('batch')}
            >
              Batch
            </button>
            <button
              style={mode === 'cases' ? styles.modeActive : styles.modeInactive}
              onClick={() => setMode('cases')}
            >
              📋 Cases
            </button>
          </div>

          <button style={styles.billingNavBtn} onClick={() => setBillingOpen(true)}>
            $ Billing
          </button>
        </div>

        <div style={styles.topbarRight}>
          <span style={styles.welcome}>👤 {user.name}</span>
          <button style={styles.logout} onClick={onLogout}>Log Out</button>
        </div>
      </div>

      {billingOpen && (
        <BillingPanel
          caseData={null}
          onClose={() => setBillingOpen(false)}
          onSendToRenamer={handleSendToRenamer}
        />
      )}

      {mode === 'single' ? (
        <div style={styles.layout}>
          <div style={styles.panel}>
            <FileRenamer
              selectedProvider={selectedProvider}
              onRenameSuccess={handleRenameSuccess}
              initialFile={renamerInitialFile}
              onInitialFileConsumed={() => setRenamerInitialFile(null)}
            />
          </div>
          <div style={styles.panel}>
            <ProviderList
              onSelect={setSelectedProvider}
              selectedId={selectedProvider?.id}
            />
          </div>
          <div style={styles.panel}>
            <ProviderCard
              provider={selectedProvider}
              refreshTrigger={refreshTrigger}
            />
          </div>
        </div>
      ) : mode === 'batch' ? (
        <div style={styles.batchLayout}>
          <BatchRenamer />
        </div>
      ) : (
        <div style={styles.casesLayout}>
          <CaseTracker />
        </div>
      )}
    </div>
  )
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    background: '#0D1B2A',
    overflow: 'hidden',
  },
  topbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 20px',
    height: 52,
    background: '#1B2D42',
    borderBottom: '2px solid #C9A84C',
    flexShrink: 0,
  },
  topbarLeft:  { display: 'flex', alignItems: 'center', gap: 16 },
  logo: {
    color: '#C9A84C',
    fontSize: 17,
    fontWeight: 700,
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    letterSpacing: '0.06em',
  },
  appName: {
    color: '#556270',
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    borderLeft: '1px solid #2E4057',
    paddingLeft: 14,
  },
  topbarRight: { display: 'flex', alignItems: 'center', gap: 12 },
  welcome:     { color: '#8B95A1', fontSize: 13 },
  logout: {
    padding: '5px 14px',
    borderRadius: 3,
    border: '1px solid #C9A84C',
    background: 'transparent',
    color: '#C9A84C',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  modeToggle: {
    display: 'flex',
    background: '#0D1B2A',
    borderRadius: 3,
    padding: 2,
    gap: 2,
    border: '1px solid #2E4057',
  },
  modeActive: {
    padding: '4px 14px',
    borderRadius: 2,
    border: 'none',
    background: '#C9A84C',
    color: '#0D1B2A',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  modeInactive: {
    padding: '4px 14px',
    borderRadius: 2,
    border: 'none',
    background: 'transparent',
    color: '#556270',
    fontSize: 12,
    cursor: 'pointer',
  },
  billingNavBtn: {
    padding: '4px 14px',
    borderRadius: 3,
    border: '1px solid #2b6cb0',
    background: '#1a365d',
    color: '#63b3ed',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '0.04em',
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 10,
    padding: 10,
    flex: 1,
    overflow: 'hidden',
  },
  batchLayout: {
    flex: 1,
    padding: 10,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  casesLayout: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  panel: {
    overflow: 'hidden',
    borderRadius: 4,
    display: 'flex',
    flexDirection: 'column',
  },
}
