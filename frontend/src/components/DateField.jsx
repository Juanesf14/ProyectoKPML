import { useState, useEffect } from 'react'

/**
 * DateField
 *
 * Drop-in replacement for <input type="date"> that ALWAYS displays dates
 * in MM/DD/YYYY format regardless of the operating system locale.
 *
 * Why: HTML <input type="date"> renders in the system locale (DD/MM/AAAA on
 * Spanish systems). This component fixes that by using a text input whose
 * display is fully under our control.
 *
 * Interface — identical to <input type="date">:
 *   value    {string}    ISO date string "YYYY-MM-DD" (or empty string)
 *   onChange {function}  called with a synthetic { target: { name, value } }
 *                        where value is "YYYY-MM-DD" or ""
 *   name     {string}    forwarded in the onChange event
 *   style    {object}    applied to the visible text input
 *   disabled {boolean}
 *
 * Features:
 *   - Auto-formats digits as the user types → MM/DD/YYYY
 *   - Calendar icon opens the native date-picker for click-based selection
 *   - Reacts to external value changes (auto-fill from document analysis)
 */
export default function DateField({ name, value, onChange, style, disabled }) {
  const [text, setText] = useState('')

  /** YYYY-MM-DD → MM/DD/YYYY */
  const toDisplay = (iso) => {
    if (!iso) return ''
    const [y, m, d] = iso.split('-')
    return `${m}/${d}/${y}`
  }

  // Keep the text in sync whenever the parent updates value (e.g. auto-fill).
  useEffect(() => {
    setText(toDisplay(value))
  }, [value])

  const emit = (iso) => {
    if (onChange) onChange({ target: { name: name || '', value: iso } })
  }

  /**
   * As the user types, strip non-digit characters and re-insert slashes
   * at the right positions so the field always looks like MM/DD/YYYY.
   * Only fires onChange when all 8 digits are present and the date is valid.
   */
  const handleTextChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 8)

    let formatted = digits
    if (digits.length > 2) formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`
    if (digits.length > 4) formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`

    setText(formatted)

    if (digits.length === 8) {
      // MM DD YYYY → YYYY-MM-DD
      const iso = `${digits.slice(4)}-${digits.slice(0, 2)}-${digits.slice(2, 4)}`
      // Validate: new Date() on an invalid date returns NaN
      if (!isNaN(new Date(`${iso}T00:00:00`).getTime())) emit(iso)
    } else if (digits.length === 0) {
      emit('')
    }
  }

  /** Native date-picker selection → update both display text and parent state. */
  const handleDatePickerChange = (e) => {
    const iso = e.target.value // always YYYY-MM-DD from the native picker
    setText(toDisplay(iso))
    emit(iso)
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Visible text field */}
      <input
        type="text"
        value={text}
        onChange={handleTextChange}
        placeholder="MM/DD/YYYY"
        maxLength={10}
        style={{ ...style, paddingRight: 30, boxSizing: 'border-box' }}
        disabled={disabled}
        autoComplete="off"
      />

      {/* Calendar icon — purely visual, pointer-events disabled */}
      <span style={{
        position: 'absolute',
        right: 9,
        top: '50%',
        transform: 'translateY(-50%)',
        fontSize: 12,
        color: disabled ? '#2E4057' : '#556270',
        pointerEvents: 'none',
        userSelect: 'none',
        lineHeight: 1,
      }}>
        📅
      </span>

      {/* Hidden native date-picker overlapping the icon area.
          Clicking the right side of the field opens the system calendar. */}
      <input
        type="date"
        value={value || ''}
        onChange={handleDatePickerChange}
        disabled={disabled}
        tabIndex={-1}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: 30,
          height: '100%',
          opacity: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
          border: 'none',
        }}
      />
    </div>
  )
}
