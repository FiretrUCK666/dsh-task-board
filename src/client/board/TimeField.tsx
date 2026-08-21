/**
 * TimeField: a date-time field that reads like a plain text input — focus
 * selects all, type `YYYY-MM-DD HH:mm` (or the short forms `MM-DD HH:mm` /
 * `HH:mm`) and press Enter or blur; unparseable text flags inline and is
 * never swallowed. The calendar button opens the native date picker
 * (`showPicker`) and merges its chosen date with the field's current time
 * (09:00 when empty). Value is epoch ms; undefined = empty. Used by the
 * cruise window editor (start / optional end).
 */
import { useEffect, useRef, useState } from 'react'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { formatTimeInput, parseTimeText } from './time-parse.ts'
import { Icon } from './ui.tsx'

export function TimeField({ label, hint, placeholder, value, onChange, allowEmpty = true }: {
  label: string
  /** Quiet helper text under the field (e.g. "留空=一直保持"). */
  hint?: string
  /** Input placeholder; falls back to the shared format example. */
  placeholder?: string
  value: number | undefined
  onChange: (ms: number | undefined) => void
  /** Whether clearing the field is legal (undefined value allowed). */
  allowEmpty?: boolean
}) {
  const [text, setText] = useState<string>(value !== undefined ? formatTimeInput(value) : '')
  const [error, setError] = useState(false)
  const dateRef = useRef<HTMLInputElement | null>(null)

  // A value that changed from outside (prefill, another surface edit) syncs
  // into the field and normalizes the text; typing never reaches the parent
  // value until commit, so this cannot clobber in-progress input.
  useEffect(() => {
    setText(value !== undefined ? formatTimeInput(value) : '')
    setError(false)
  }, [value])

  const commit = (): void => {
    const parsed = parseTimeText(text)
    if (parsed === undefined) {
      if (text.trim() === '' && allowEmpty) {
        onChange(undefined)
        setError(false)
      } else {
        setError(true)
      }
      return
    }
    setError(false)
    onChange(parsed)
  }

  /** Open the native date picker through the invisible date input. */
  const pickDate = (): void => {
    const input = dateRef.current
    if (input === null) return
    try {
      input.showPicker()
    } catch {
      // showPicker is a user-gesture API; when unsupported the field is
      // still fully usable by typing.
    }
  }

  return (
    <span className={css.timeField}>
      <span className={css.timeFieldLabel}>{label}</span>
      <span className={css.timeFieldRow}>
        <input
          className={`${css.input}${error ? ` ${css.inputInvalid}` : ''}`}
          value={text}
          placeholder={placeholder ?? t('board.cruiseTimePlaceholder')}
          aria-label={label}
          onFocus={event => { event.target.select() }}
          onChange={event => { setText(event.target.value); setError(false) }}
          onBlur={commit}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
              event.currentTarget.blur()
            }
          }}
        />
        <button
          type="button"
          className={css.timeFieldCalendar}
          title={t('board.cruiseCalendar')}
          aria-label={t('board.cruiseCalendar')}
          onClick={pickDate}
        >
          <Icon name="calendar" />
        </button>
        {/* The invisible native datetime-local input exists only to drive
            showPicker — the native picker carries YEAR/MONTH/DAY/HOUR/MINUTE,
            so the popup calendar can pick a time too. */}
        <input
          ref={dateRef}
          type="datetime-local"
          tabIndex={-1}
          aria-hidden="true"
          className={css.timeFieldHiddenDate}
          onChange={event => {
            const value = event.target.value
            if (value === '') return
            const [datePart, clock] = value.split('T')
            const [year, month, day] = datePart.split('-').map(Number)
            const [hour, minute] = clock.split(':').map(Number)
            const picked = new Date(year, month - 1, day, hour, minute)
            onChange(picked.getTime())
            setText(formatTimeInput(picked.getTime()))
            setError(false)
          }}
        />
      </span>
      {error
        ? <span className={css.timeFieldError}>{t('board.cruiseTimeInvalid')}</span>
        : hint !== undefined && <span className={css.timeFieldHint}>{hint}</span>}
    </span>
  )
}