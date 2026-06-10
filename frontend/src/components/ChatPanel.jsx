import { useState, useRef, useEffect } from 'react'
import api from '../services/api'

export default function ChatPanel({ sessionId, documentName, onClose }) {
  const [messages, setMessages] = useState([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = async () => {
    if (!input.trim() || loading) return

    const userMsg    = { role: 'user', content: input.trim() }
    const newHistory = [...messages, userMsg]
    setMessages(newHistory)
    setInput('')
    setLoading(true)

    try {
      const { data } = await api.post('/chat', { sessionId, messages: newHistory })
      setMessages(m => [...m, { role: 'assistant', content: data.reply }])
    } catch (err) {
      const errMsg = err.response?.data?.error || 'Failed to connect to AI service'
      setMessages(m => [...m, { role: 'assistant', content: `❌ ${errMsg}` }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <div style={styles.headerTitle}>AI Document Chat</div>
            {documentName && (
              <div style={styles.headerSub} title={documentName}>
                {documentName.length > 35 ? documentName.slice(0, 35) + '…' : documentName}
              </div>
            )}
          </div>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        {/* Messages */}
        <div style={styles.messages}>
          {messages.length === 0 && (
            <div style={styles.emptyState}>
              <div style={styles.emptyIcon}>🤖</div>
              <div style={styles.emptyText}>Ask anything about this medical record</div>
              <div style={styles.suggestions}>
                {[
                  'What is the total amount billed?',
                  'What procedures were performed?',
                  'Who is the treating physician?',
                  'What is the date of service?',
                ].map(s => (
                  <button
                    key={s}
                    style={styles.suggestionChip}
                    onClick={() => { setInput(s); }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              style={msg.role === 'user' ? styles.userBubble : styles.assistantBubble}
            >
              {msg.content}
            </div>
          ))}

          {loading && (
            <div style={styles.assistantBubble}>
              <span style={styles.typing}>●●●</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={styles.inputRow}>
          <textarea
            style={styles.input}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this document… (Enter to send)"
            rows={2}
            disabled={loading}
          />
          <button
            style={{ ...styles.sendBtn, opacity: !input.trim() || loading ? 0.4 : 1 }}
            onClick={send}
            disabled={!input.trim() || loading}
          >
            ↑
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
    zIndex: 1000,
    display: 'flex',
    justifyContent: 'flex-end',
    background: 'rgba(0,0,0,0.55)',
  },
  panel: {
    width: 390,
    height: '100vh',
    background: '#1B2D42',
    borderLeft: '1px solid #2E4057',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '-8px 0 32px rgba(0,0,0,0.6)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '14px 16px',
    borderBottom: '2px solid rgba(201,168,76,0.3)',
    background: '#0D1B2A',
    flexShrink: 0,
  },
  headerTitle: {
    color: '#C9A84C',
    fontWeight: 700,
    fontSize: 13,
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  headerSub: {
    color: '#556270',
    fontSize: 11,
    marginTop: 3,
    maxWidth: 300,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#556270',
    fontSize: 16,
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 14,
    padding: '28px 8px',
  },
  emptyIcon: { fontSize: 32 },
  emptyText: {
    color: '#8B95A1',
    fontSize: 13,
    textAlign: 'center',
  },
  suggestions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    width: '100%',
  },
  suggestionChip: {
    background: '#243447',
    border: '1px solid #2E4057',
    borderRadius: 3,
    color: '#8B95A1',
    fontSize: 12,
    padding: '8px 12px',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  userBubble: {
    alignSelf: 'flex-end',
    background: '#C9A84C',
    color: '#0D1B2A',
    borderRadius: '8px 8px 2px 8px',
    padding: '8px 12px',
    fontSize: 13,
    maxWidth: '85%',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontWeight: 500,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    background: '#243447',
    color: '#F5F0E8',
    borderRadius: '8px 8px 8px 2px',
    padding: '8px 12px',
    fontSize: 13,
    maxWidth: '85%',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    border: '1px solid #2E4057',
  },
  typing: {
    color: '#556270',
    letterSpacing: 3,
    fontSize: 14,
  },
  inputRow: {
    display: 'flex',
    gap: 8,
    padding: '12px 14px',
    borderTop: '1px solid #2E4057',
    background: '#0D1B2A',
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    padding: '8px 10px',
    borderRadius: 3,
    border: '1px solid #2E4057',
    background: '#1B2D42',
    color: '#F5F0E8',
    fontSize: 13,
    outline: 'none',
    resize: 'none',
    lineHeight: 1.4,
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 3,
    border: 'none',
    background: '#C9A84C',
    color: '#0D1B2A',
    fontSize: 18,
    fontWeight: 800,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
}
