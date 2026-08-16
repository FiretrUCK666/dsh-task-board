/**
 * Prompt input with slash-command autocomplete: typing '/' pops a menu of
 * live slash candidates — host commands plus skills, the same merged
 * catalog the native composer's '/' menu reads — navigable with ArrowUp/
 * Down, accepted with Enter/Tab, dismissed with Escape or by clicking
 * elsewhere; picking inserts the candidate text. The menu opens downward by
 * default and flips upward when the space below the field within its
 * clipping container is insufficient (the review page's composer sits at
 * the bottom of the modal, so this is the normal case there). The textarea
 * auto-grows with its content up to a cap and then scrolls internally —
 * the native composer's pattern (resize: none), which eliminates the
 * unreachable resize-handle trap of a bottom-pinned input. Shared by the
 * new-task modal, the detail edit mode and the review page's composer.
 */
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type SyntheticEvent } from 'react'
import type { BoardController, SlashCandidate } from '../../core/controller.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { commandTokenAt, filterSlashCandidates, insertCommand, type CommandToken } from './slash-token.ts'
import { shouldFlipMenuUp } from './menu-direction.ts'

/** Menu row cap: keeps the list scannable and scrollbar-free. */
const MAX_ROWS = 8

/** Auto-grow cap: taller content scrolls inside the textarea instead of
 *  stretching the modal. */
const TEXTAREA_MAX_HEIGHT = 160

/** The open menu: the triggering token span plus its filtered candidates. */
interface SlashMenuState {
  token: CommandToken
  rows: readonly SlashCandidate[]
  highlight: number
  /** Whether the menu opens upward (insufficient space below the field). */
  flip: boolean
}

/** The nearest ancestor that clips overflow (the modal shell), if any. */
function clippingAncestorOf(element: HTMLElement): HTMLElement | undefined {
  let current = element.parentElement
  while (current !== null) {
    const style = getComputedStyle(current)
    if (style.overflow !== 'visible' || style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      return current
    }
    current = current.parentElement
  }
  return undefined
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
  const fieldRef = useRef<HTMLDivElement | null>(null)
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

  // Auto-grow: the textarea matches its content up to a cap, then scrolls
  // internally. No manual resize handle (native composer pattern) — a
  // bottom-pinned input's handle would slide past the modal edge and become
  // unreachable.
  useEffect(() => {
    const element = textareaRef.current
    if (element === null) return
    element.style.height = 'auto'
    const next = Math.min(element.scrollHeight, TEXTAREA_MAX_HEIGHT)
    element.style.height = `${next}px`
    element.style.overflowY = element.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
  }, [value])

  /** Recompute the menu from the latest text/caret (no-op without a slash token). */
  const syncMenu = (): void => {
    const token = commandTokenAt(valueRef.current, caretRef.current)
    if (token === undefined || catalog === undefined || catalog === null) {
      setMenu(undefined)
      return
    }
    const rows = filterSlashCandidates(catalog, token.query, token.leading).slice(0, MAX_ROWS)
    let flip = false
    const field = fieldRef.current
    if (field !== null) {
      const fieldRect = field.getBoundingClientRect()
      const clip = clippingAncestorOf(field)
      flip = shouldFlipMenuUp(
        fieldRect,
        clip !== undefined ? clip.getBoundingClientRect() : undefined,
        window.innerHeight,
      )
    }
    setMenu(previous =>
      previous !== undefined
        && previous.token.start === token.start
        && previous.token.end === token.end
        && previous.token.query === token.query
        ? previous // same span: keep the keyboard highlight
        : { token, rows, highlight: 0, flip })
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
    <div className={css.promptField} ref={fieldRef}>
      <textarea
        ref={textareaRef}
        className={`${css.input} ${css.promptTextarea}`}
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
        <div className={css.slashMenu} data-direction={menu.flip ? 'up' : 'down'} role="listbox" aria-label={t('prompt.commandList')}>
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