import { useState, useEffect } from 'react'
import api from '../services/api'

// Account + user-management modal.
// Every user can change their own password. Admins also get a user list with
// create / reset-password / delete actions (local password recovery without email).
export default function AccountPanel({ user, onClose }) {
  const isAdmin = user.role === 'admin'
  const [tab, setTab] = useState('password') // 'password' | 'users' | 'backup'

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Account</h2>
          <button style={styles.close} onClick={onClose}>✕</button>
        </div>

        {isAdmin && (
          <div style={styles.tabs}>
            <button
              style={tab === 'password' ? styles.tabActive : styles.tab}
              onClick={() => setTab('password')}
            >
              My password
            </button>
            <button
              style={tab === 'users' ? styles.tabActive : styles.tab}
              onClick={() => setTab('users')}
            >
              Users
            </button>
            <button
              style={tab === 'backup' ? styles.tabActive : styles.tab}
              onClick={() => setTab('backup')}
            >
              Backup
            </button>
          </div>
        )}

        {tab === 'password'
          ? <ChangePassword />
          : tab === 'users'
            ? <UserManagement currentUser={user} />
            : <BackupRestore />}
      </div>
    </div>
  )
}

// Admin-only manual database backup/restore. Runs through the Electron bridge;
// shows a clear warning that restore replaces all data and restarts the app.
function BackupRestore() {
  const [msg, setMsg]   = useState(null)
  const [busy, setBusy] = useState(false)

  const api = typeof window !== 'undefined' ? window.electronAPI : null

  const doExport = async () => {
    if (!api) return
    setBusy(true); setMsg(null)
    try {
      const res = await api.backupDatabase()
      if (res?.success)        setMsg({ type: 'ok',  text: `Backup saved to ${res.path}` })
      else if (res?.canceled)  setMsg(null)
      else                     setMsg({ type: 'err', text: res?.error || 'Backup failed' })
    } finally {
      setBusy(false)
    }
  }

  const doRestore = async () => {
    if (!api) return
    setBusy(true); setMsg(null)
    try {
      const res = await api.restoreDatabase()
      // On success the app relaunches, so this rarely renders.
      if (res && !res.success && !res.canceled)
        setMsg({ type: 'err', text: res.error || 'Restore failed' })
    } finally {
      setBusy(false)
    }
  }

  if (!api) {
    return <div style={styles.errBanner}>Backup is only available in the desktop app.</div>
  }

  return (
    <div style={styles.form}>
      <p style={{ color: '#8B95A1', fontSize: 13, lineHeight: 1.5, margin: 0 }}>
        Export a copy of the database to keep it safe (e.g. on a USB drive or network folder).
        Restore replaces all current data with a backup file and restarts the app.
      </p>
      {msg && <div style={msg.type === 'ok' ? styles.okBanner : styles.errBanner}>{msg.text}</div>}
      <button style={styles.button} onClick={doExport} disabled={busy}>
        {busy ? 'Working…' : 'Export backup'}
      </button>
      <button
        style={{ ...styles.button, background: '#7a3b3b' }}
        onClick={doRestore}
        disabled={busy}
      >
        Restore from backup…
      </button>
    </div>
  )
}

function ChangePassword() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [msg, setMsg] = useState(null) // { type: 'ok'|'err', text }
  const [loading, setLoading] = useState(false)
  const change = e => setForm({ ...form, [e.target.name]: e.target.value })

  const submit = async e => {
    e.preventDefault()
    setMsg(null)
    if (form.newPassword !== form.confirm)
      return setMsg({ type: 'err', text: 'New passwords do not match' })
    setLoading(true)
    try {
      await api.post('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      })
      setMsg({ type: 'ok', text: 'Password updated' })
      setForm({ currentPassword: '', newPassword: '', confirm: '' })
    } catch (err) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Could not update password' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} style={styles.form}>
      <input style={styles.input} type="password" name="currentPassword"
        placeholder="Current password" value={form.currentPassword} onChange={change} required />
      <input style={styles.input} type="password" name="newPassword"
        placeholder="New password (min. 8 characters)" value={form.newPassword} onChange={change} required />
      <input style={styles.input} type="password" name="confirm"
        placeholder="Confirm new password" value={form.confirm} onChange={change} required />
      {msg && <div style={msg.type === 'ok' ? styles.okBanner : styles.errBanner}>{msg.text}</div>}
      <button style={styles.button} type="submit" disabled={loading}>
        {loading ? 'Saving…' : 'Update password'}
      </button>
    </form>
  )
}

function UserManagement({ currentUser }) {
  const [users, setUsers] = useState([])
  const [msg, setMsg] = useState(null)
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'user' })
  const [resetFor, setResetFor] = useState(null) // user id being reset
  const [resetPw, setResetPw] = useState('')

  const load = () => api.get('/auth/users').then(({ data }) => setUsers(data)).catch(() => {})
  useEffect(() => { load() }, [])

  const create = async e => {
    e.preventDefault()
    setMsg(null)
    try {
      await api.post('/auth/register', newUser)
      setNewUser({ name: '', email: '', password: '', role: 'user' })
      setMsg({ type: 'ok', text: 'User created' })
      load()
    } catch (err) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Could not create user' })
    }
  }

  const doReset = async (id) => {
    setMsg(null)
    try {
      await api.post('/auth/reset-password', { userId: id, newPassword: resetPw })
      setResetFor(null); setResetPw('')
      setMsg({ type: 'ok', text: 'Password reset' })
    } catch (err) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Could not reset password' })
    }
  }

  const remove = async (id) => {
    setMsg(null)
    try {
      await api.delete(`/auth/users/${id}`)
      load()
    } catch (err) {
      setMsg({ type: 'err', text: err.response?.data?.error || 'Could not delete user' })
    }
  }

  return (
    <div>
      {msg && <div style={msg.type === 'ok' ? styles.okBanner : styles.errBanner}>{msg.text}</div>}

      <div style={styles.userList}>
        {users.map(u => (
          <div key={u.id} style={styles.userRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.userName}>
                {u.name} {u.role === 'admin' && <span style={styles.adminTag}>ADMIN</span>}
              </div>
              <div style={styles.userEmail}>{u.email}</div>
            </div>
            {resetFor === u.id ? (
              <div style={styles.resetRow}>
                <input style={styles.inlineInput} type="password" placeholder="New password"
                  value={resetPw} onChange={e => setResetPw(e.target.value)} autoFocus />
                <button style={styles.smallBtn} onClick={() => doReset(u.id)}>Save</button>
                <button style={styles.smallGhost} onClick={() => { setResetFor(null); setResetPw('') }}>✕</button>
              </div>
            ) : (
              <div style={styles.actions}>
                <button style={styles.smallGhost} onClick={() => { setResetFor(u.id); setResetPw('') }}>
                  Reset password
                </button>
                {u.id !== currentUser.id && (
                  <button style={styles.smallDanger} onClick={() => remove(u.id)}>Delete</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={create} style={styles.createForm}>
        <div style={styles.createTitle}>Add user</div>
        <input style={styles.input} placeholder="Full name" value={newUser.name}
          onChange={e => setNewUser({ ...newUser, name: e.target.value })} required />
        <input style={styles.input} type="email" placeholder="Email" value={newUser.email}
          onChange={e => setNewUser({ ...newUser, email: e.target.value })} required />
        <input style={styles.input} type="password" placeholder="Temp password (min. 8 characters)"
          value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} required />
        <select style={styles.input} value={newUser.role}
          onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <button style={styles.button} type="submit">Create user</button>
      </form>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  modal: {
    background: '#1B2D42', borderRadius: 5, width: 460, maxHeight: '85vh', overflowY: 'auto',
    padding: '1.5rem', borderTop: '3px solid #C9A84C', boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { color: '#C9A84C', margin: 0, fontSize: 20, fontFamily: "'Cormorant Garamond', Georgia, serif" },
  close: { background: 'none', border: 'none', color: '#8B95A1', fontSize: 18, cursor: 'pointer' },
  tabs: { display: 'flex', gap: 2, background: '#0D1B2A', borderRadius: 3, padding: 2, marginBottom: 16, border: '1px solid #2E4057' },
  tab: { flex: 1, padding: '6px', border: 'none', background: 'transparent', color: '#556270', fontSize: 12.5, cursor: 'pointer', borderRadius: 2 },
  tabActive: { flex: 1, padding: '6px', border: 'none', background: '#C9A84C', color: '#0D1B2A', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', borderRadius: 2 },
  form: { display: 'flex', flexDirection: 'column', gap: 10 },
  input: {
    padding: '9px 12px', borderRadius: 3, border: '1px solid #2E4057',
    background: '#243447', color: '#F5F0E8', fontSize: 13.5, outline: 'none',
  },
  button: {
    marginTop: 4, padding: '10px', borderRadius: 3, border: 'none', background: '#C9A84C',
    color: '#0D1B2A', fontSize: 13, fontWeight: 600, cursor: 'pointer',
    letterSpacing: '0.05em', textTransform: 'uppercase',
  },
  okBanner: { background: 'rgba(104,211,145,0.10)', border: '1px solid rgba(104,211,145,0.4)', color: '#68d391', borderRadius: 3, padding: '8px 12px', fontSize: 13, marginBottom: 10 },
  errBanner: { background: 'rgba(252,129,129,0.08)', border: '1px solid rgba(252,129,129,0.35)', color: '#fc8181', borderRadius: 3, padding: '8px 12px', fontSize: 13, marginBottom: 10 },
  userList: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 },
  userRow: { display: 'flex', alignItems: 'center', gap: 8, background: '#243447', borderRadius: 3, padding: '9px 12px' },
  userName: { color: '#F5F0E8', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 6 },
  userEmail: { color: '#8B95A1', fontSize: 12 },
  adminTag: { fontSize: 9, fontWeight: 700, color: '#C9A84C', border: '1px solid #C9A84C', borderRadius: 2, padding: '1px 4px', letterSpacing: '0.05em' },
  actions: { display: 'flex', gap: 6, flexShrink: 0 },
  resetRow: { display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 },
  inlineInput: { padding: '6px 8px', borderRadius: 3, border: '1px solid #2E4057', background: '#0D1B2A', color: '#F5F0E8', fontSize: 12.5, width: 130, outline: 'none' },
  smallBtn: { padding: '6px 10px', borderRadius: 3, border: 'none', background: '#C9A84C', color: '#0D1B2A', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  smallGhost: { padding: '6px 10px', borderRadius: 3, border: '1px solid #2E4057', background: 'transparent', color: '#8B95A1', fontSize: 12, cursor: 'pointer' },
  smallDanger: { padding: '6px 10px', borderRadius: 3, border: '1px solid rgba(252,129,129,0.4)', background: 'transparent', color: '#fc8181', fontSize: 12, cursor: 'pointer' },
  createForm: { display: 'flex', flexDirection: 'column', gap: 9, borderTop: '1px solid #2E4057', paddingTop: 16 },
  createTitle: { color: '#8B95A1', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' },
}
