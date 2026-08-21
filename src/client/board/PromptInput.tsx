/**
 * Prompt input with trigger autocomplete: typing '/' pops the live slash
 * candidates (host commands plus skills — the same merged catalog the native
 * composer's '/' menu reads), and typing '@' pops the mention candidates
 * (related sessions of the current task). Both menus share one navigation
 * (ArrowUp/Down, Enter/Tab, Escape, click-away), the same insertion grammar
 * and the same direction logic: the menu opens downward by default and flips
 * upward when the space below the field within its clipping container is
 * insufficient (the review page's composer sits at the bottom of the modal,
 * so this is the normal case there). The textarea auto-grows with its content
 * up to a cap and then scrolls internally — the native composer's pattern
 * (resize: none), which eliminates the unreachable resize-handle trap of a
 * bottom-pinned input. Shared by the new-task modal, the detail edit mode,
 * the review page's composer and the session panel.
 */
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type SyntheticEvent } from 'react'
import type { BoardController, SlashCandidate } from '../../core/controller.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import {
  commandTokenAt, insertCommand, mentionTokenAt, filterMentionCandidates, filterSlashCandidates,
  mentionCompletion, type CommandToken, type MentionCandidate,
} from './slash-token.ts'
import { shouldFlipMenuUp } from './menu-direction.ts'

/** Menu row cap: keeps the list scannable and scrollbar-free. */
const MAX_ROWS = 8

/** Auto-grow cap: taller content scrolls inside the textarea instead of
 *  stretching the modal. */
const TEXTAREA_MAX_HEIGHT = 160

/** The open menu: the triggering token span plus its filtered candidates. */
interface TriggerMenuState {
  token: CommandToken
  /** '/' rows when `mentions` is undefined, '@' rows otherwise. */
  kind: 'slash' | 'mention'
  rows: readonly (SlashCandidate | MentionCandidate)[]
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

/** Prompt textarea with a slash-command and mention dropdown. */
export function PromptInput({ value, onChange, placeholder, rows, controller, mentions, invalid }: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  rows?: number
  controller: BoardController
  /** Optional '@' candidates (related sessions); when absent only '/' opens. */
  mentions?: readonly MentionCandidate[]
  /** Validation error state: the field's invalid border. */
  invalid?: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fieldRef = useRef<HTMLDivElement | null>(null)
  // Latest text/caret read by the sync pass (props/state settle a tick late).
  const valueRef = useRef(value)
  const caretRef = useRef(0)
  // undefined = still loading; null = unavailable (no menu); array = ready.
  const [catalog, setCatalog] = useState<readonly SlashCandidate[] | undefined | null>(undefined)
  const [menu, setMenu] = useState<TriggerMenuState | undefined>(undefined)

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

  /** Recompute the menu from the latest text/caret (no-op without a trigger token). */
  const syncMenu = (): void => {
    // '@' only when the caller supplied mention candidates; the '/' menu
    // needs the catalog ready.
    const mentionToken = mentions !== undefined && mentions.length > 0 ? mentionTokenAt(valueRef.current, caretRef.current) : undefined
    const slashToken = commandTokenAt(valueRef.current, caretRef.current)
    // A typed '@' wins over a '/' when both could match (the '/' scan would
    // otherwise treat '@foo' as a non-slash word).
    let kind: 'mention' | 'slash' | undefined
    let token: CommandToken | undefined
    if (mentionToken !== undefined) { kind = 'mention'; token = mentionToken }
    else if (slashToken !== undefined) { kind = 'slash'; token = slashToken }
    if (token === undefined || kind === undefined || catalog === undefined || catalog === null) {
      setMenu(undefined)
      return
    }
    const rows = kind === 'slash' && catalog !== null
      ? filterSlashCandidates(catalog, token.query, token.leading).slice(0, MAX_ROWS)
      : kind === 'mention' && mentions !== undefined
        ? filterMentionCandidates(mentions, token.query).slice(0, MAX_ROWS)
        : []
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
        && previous.kind === kind
        && previous.token.start === token.start
        && previous.token.end === token.end
        && previous.token.query === token.query
        ? previous // same span: keep the keyboard highlight
        : { token, kind, rows, highlight: 0, flip })
  }

  // The catalog may land after the user already typed '/': reopen the menu
  // against the stored caret once it is ready.
  useEffect(() => {
    if (catalog === undefined || catalog === null) return
    syncMenu()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog])

  /** Insert the picked candidate over the token span and restore focus/caret. */
  const accept = (row: SlashCandidate | MentionCandidate | undefined): void => {
    if (menu === undefined || row === undefined) {
      setMenu(undefined)
      return
    }
    // Slash completion goes through the ONE insertion helper (insertCommand);
    // a mention is a plain prefix replacement (no candidate grammar).
    const result = menu.kind === 'mention'
      ? (() => {
        const insertion = mentionCompletion((row as MentionCandidate).title)
        return {
          text: `${valueRef.current.slice(0, menu.token.start)}${insertion}${valueRef.current.slice(menu.token.end)}`,
          caret: menu.token.start + insertion.length,
        }
      })()
      : insertCommand(valueRef.current, menu.token, row as SlashCandidate)
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
        className={`${css.input} ${css.promptTextarea}${invalid === true ? ` ${css.inputInvalid}` : ''}`}
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
          ) : menu.kind === 'mention' ? (
            menu.rows.map((row, index) => {
              const mention = row as MentionCandidate
              return (
                <button
                  key={mention.id}
                  type="button"
                  role="option"
                  aria-selected={index === menu.highlight}
                  className={`${css.slashMenuRow}${index === menu.highlight ? ` ${css.slashMenuRowActive}` : ''}`}
                  onMouseDown={event => { event.preventDefault() }}
                  onClick={() => { accept(mention) }}
                >
                  <span className={css.slashMenuName}>@{mention.title}</span>
                </button>
              )
            })
          ) : menu.rows.map((row, index) => {
            const slash = row as SlashCandidate
            return (
              <button
                key={slash.name}
                type="button"
                role="option"
                aria-selected={index === menu.highlight}
                className={`${css.slashMenuRow}${index === menu.highlight ? ` ${css.slashMenuRowActive}` : ''}`}
                onMouseDown={event => { event.preventDefault() }}
                onClick={() => { accept(slash) }}
              >
                <span className={css.slashMenuName}>/{slash.name}</span>
                <span className={css.slashMenuDesc}>{slash.description}</span>
                {slash.hint !== undefined && <span className={css.slashMenuHint}>{slash.hint}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}