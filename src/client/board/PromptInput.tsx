/**
 * Prompt input with slash-command autocomplete: typing '/' pops a menu of
 * live slash candidates — host commands plus skills, the same merged
 * catalog the native composer's '/' menu reads — navigable with ArrowUp/
 * Down, accepted with Enter/Tab, dismissed with Escape or by clicking
 * elsewhere; picking inserts the candidate text. Shared by the new-task
 * modal and the detail edit mode through TaskForm.
 */
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type SyntheticEvent } from 'react'
import type { BoardController, SlashCandidate } from '../../core/controller.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { commandTokenAt, filterSlashCandidates, insertCommand, type CommandToken } from './slash-token.ts'

/** Menu row cap: keeps the list scannable and scrollbar-free. */
const MAX_ROWS = 8

/** The open menu: the triggering token span plus its filtered candidates. */
interface SlashMenuState {
  token: CommandToken
  rows: readonly SlashCandidate[]
  highlight: number
}

/** Prompt textarea with a slash-command dropdown. */
export function PromptInput({ value, onChange, placeholder, rows, controller }: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  rows?: number
  controller: BoardController
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  // Latest text/caret read by the sync pass (props/state settle a tick late).
  const valueRef = useRef(value)
  const caretRef = useRef(0)
  // undefined = still loading; null = unavailable (no menu); array = ready.
  const [catalog, setCatalog] = useState<readonly SlashCandidate[] | undefined | null>(undefined)
  const [menu, setMenu] = useState<SlashMenuState | undefined>(undefined)

  // Load the live slash catalog once per mount; unavailable surfaces
  // degrade to no menu.
  useEffect(() => {
    let alive = true
    void (async () => {
      const rows = await controller.runCatalog()?.listSlashCandidates()
      if (!alive) return
      setCatalog(rows ?? null)
    })()
    return () => { alive = false }
  }, [controller])

  /** Recompute the menu from the latest text/caret (no-op without a slash token). */
  const syncMenu = (): void => {
    const token = commandTokenAt(valueRef.current, caretRef.current)
    if (token === undefined || catalog === undefined || catalog === null) {
      setMenu(undefined)
      return
    }
    const rows = filterSlashCandidates(catalog, token.query, token.leading).slice(0, MAX_ROWS)
    setMenu(previous =>
      previous !== undefined
        && previous.token.start === token.start
        && previous.token.end === token.end
        && previous.token.query === token.query
        ? previous // same span: keep the keyboard highlight
        : { token, rows, highlight: 0 })
  }

  // The catalog may land after the user already typed '/': reopen the menu
  // against the stored caret once it is ready.
  useEffect(() => {
    if (catalog === undefined || catalog === null) return
    syncMenu()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog])

  /** Insert the picked candidate over the token span and restore focus/caret. */
  const accept = (row: SlashCandidate | undefined): void => {
    if (menu === undefined || row === undefined) {
      setMenu(undefined)
      return
    }
    const result = insertCommand(valueRef.current, menu.token, row)
    setMenu(undefined)
    valueRef.current = result.text
    caretRef.current = result.caret
    onChange(result.text)
    requestAnimationFrame(() => {
      const element = textareaRef.current
      if (element === null) return
      element.focus()
      element.setSelectionRange(result.caret, result.caret)
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (menu === undefined) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setMenu({
        ...menu,
        highlight: menu.rows.length === 0
          ? 0
          : (menu.highlight + delta + menu.rows.length) % menu.rows.length,
      })
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      accept(menu.rows[menu.highlight])
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setMenu(undefined)
    }
  }

  const onInput = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const element = event.currentTarget
    caretRef.current = element.selectionStart
    valueRef.current = element.value
    onChange(element.value)
    syncMenu()
  }

  const onSelect = (event: SyntheticEvent<HTMLTextAreaElement>): void => {
    const element = event.currentTarget
    caretRef.current = element.selectionStart
    syncMenu()
  }

  const onBlur = (): void => { setMenu(undefined) }

  return (
    <div className={css.promptField}>
      <textarea
        ref={textareaRef}
        className={css.input}
        rows={rows}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        aria-label={t('new.prompt')}
        onKeyDown={onKeyDown}
        onChange={onInput}
        onSelect={onSelect}
        onBlur={onBlur}
      />
      {menu !== undefined && (
        <div className={css.slashMenu} role="listbox" aria-label={t('prompt.commandList')}>
          {menu.rows.length === 0 ? (
            <div className={css.slashMenuEmpty} role="option">{t('prompt.noCommands')}</div>
          ) : menu.rows.map((row, index) => (
            <button
              key={row.name}
              type="button"
              role="option"
              aria-selected={index === menu.highlight}
              className={`${css.slashMenuRow}${index === menu.highlight ? ` ${css.slashMenuRowActive}` : ''}`}
              onMouseDown={event => { event.preventDefault() }}
              onClick={() => { accept(row) }}
            >
              <span className={css.slashMenuName}>/{row.name}</span>
              <span className={css.slashMenuDesc}>{row.description}</span>
              {row.hint !== undefined && <span className={css.slashMenuHint}>{row.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
