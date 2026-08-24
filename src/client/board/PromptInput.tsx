/**
 * Prompt input with trigger autocomplete: typing '/' pops the live slash
 * candidates (host commands plus skills — the same merged catalog the native
 * composer's '/' menu reads), and typing '@' pops the OFFICIAL reference
 * candidates (workspace files AND sessions — the same two Remote namespaces
 * the harness's own ui-reference source calls, see reference-source.ts).
 * Both menus share one navigation (ArrowUp/Down, Enter/Tab, Escape,
 * click-away), the same insertion grammar and the same direction logic: the
 * menu opens downward by default and flips upward when the space below the
 * field within its clipping container is insufficient (the review page's
 * composer sits at the bottom of the modal, so this is the normal case
 * there). The textarea auto-grows with its content up to a cap and then
 * scrolls internally — the native composer's pattern (resize: none), which
 * eliminates the unreachable resize-handle trap of a bottom-pinned input.
 * Shared by the new-task modal, the detail edit mode, the review page's
 * composer, the session panel, the refine answer and the interaction card.
 */
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type SyntheticEvent } from 'react'
import type { BoardController, SlashCandidate } from '../../core/controller.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import {
  commandTokenAt, insertCommand, insertMention, mentionTokenAt, filterSlashCandidates,
  type CommandToken,
} from './slash-token.ts'
import { listReferenceRows, type ReferenceRow } from './reference-source.ts'
import { shouldFlipMenuUp } from './menu-direction.ts'

/** Menu row cap: keeps the list scannable and scrollbar-free. */
const MAX_ROWS = 8

/** Auto-grow cap: taller content scrolls inside the textarea instead of
 *  stretching the modal. */
const TEXTAREA_MAX_HEIGHT = 160

/** The open menu: the triggering token span plus its filtered candidates. */
interface TriggerMenuState {
  token: CommandToken
  /** '/' rows when `sessionId` is undefined, '@' rows otherwise. */
  kind: 'slash' | 'mention'
  rows: readonly (SlashCandidate | ReferenceRow)[]
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

/** Whether two '@' tokens describe the same span (query included). */
function sameMentionSpan(a: CommandToken, b: CommandToken): boolean {
  return a.start === b.start && a.end === b.end && a.query === b.query && (a.quoted ?? false) === (b.quoted ?? false)
}

/** Prompt textarea with a slash-command and official-reference dropdown. */
export function PromptInput({ value, onChange, placeholder, rows, controller, sessionId, invalid }: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  rows?: number
  controller: BoardController
  /** The target session scoping the '@' reference menu (file cwd + session
   *  discovery). undefined = '@' stays closed (no menu); '/' is unaffected. */
  sessionId?: string
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
  // The active '@' token driving the official candidate fetch (span-change
  // keyed; the effect aborts the previous fetch on every change).
  const [mentionReq, setMentionReq] = useState<CommandToken | undefined>(undefined)

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

  // The official reference candidates (files + sessions) for the active '@'
  // token — the SAME two Remote namespaces the harness's ui-reference source
  // calls; every keystroke supersedes the previous fetch (abort).
  useEffect(() => {
    if (mentionReq === undefined || sessionId === undefined) return
    const controllerRef = new AbortController()
    let alive = true
    void listReferenceRows(
      controller.referenceSources(),
      sessionId,
      mentionReq.query,
      mentionReq.quoted === true,
      controllerRef.signal,
    ).then(rows => {
      if (!alive || controllerRef.signal.aborted) return
      setMenu(previous => previous !== undefined && previous.kind === 'mention' && sameMentionSpan(previous.token, mentionReq)
        ? { ...previous, rows }
        : previous)
    })
    return () => { alive = false; controllerRef.abort() }
  }, [mentionReq, sessionId, controller])

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
    const text = valueRef.current
    const caret = caretRef.current
    // '@' only when the caller supplied a target session; '/' needs the
    // catalog ready. A typed '@' wins over a '/' when both could match (the
    // '/' scan would otherwise treat '@foo' as a non-slash word).
    const mentionToken = sessionId !== undefined ? mentionTokenAt(text, caret) : undefined
    const slashToken = commandTokenAt(text, caret)
    let kind: 'mention' | 'slash' | undefined
    let token: CommandToken | undefined
    if (mentionToken !== undefined) { kind = 'mention'; token = mentionToken }
    else if (slashToken !== undefined) { kind = 'slash'; token = slashToken }
    if (token === undefined || kind === undefined) {
      setMenu(undefined)
      setMentionReq(undefined)
      return
    }
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
    if (kind === 'mention') {
      // Same span: keep the keyboard highlight and the rows in flight.
      // Otherwise reset the rows and re-request the candidates (the fetch
      // effect keys on the token object change).
      setMenu(previous =>
        previous !== undefined && previous.kind === 'mention' && sameMentionSpan(previous.token, token)
          ? previous
          : { token, kind, rows: previous?.kind === 'mention' ? previous.rows : [], highlight: 0, flip })
      setMentionReq(token)
      return
    }
    if (catalog === undefined || catalog === null) {
      setMenu(undefined)
      setMentionReq(undefined)
      return
    }
    const rows = filterSlashCandidates(catalog, token.query, token.leading).slice(0, MAX_ROWS)
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
  const accept = (row: SlashCandidate | ReferenceRow | undefined): void => {
    if (menu === undefined || row === undefined) {
      setMenu(undefined)
      return
    }
    const result = menu.kind === 'mention'
      ? insertMention(valueRef.current, menu.token, (row as ReferenceRow).insert)
      : insertCommand(valueRef.current, menu.token, row as SlashCandidate)
    setMenu(undefined)
    setMentionReq(undefined)
    valueRef.current = result.text
    caretRef.current = result.caret
    onChange(result.text)
    requestAnimationFrame(() => {
      const element = textareaRef.current
      if (element === null) return
      element.focus()
      element.setSelectionRange(result.caret, result.caret)
      // Re-sync after the splice: a directory's open quote (`@"path/`)
      // re-opens the '@' menu for the next level (official descent).
      syncMenu()
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

  const onBlur = (): void => {
    setMenu(undefined)
    setMentionReq(undefined)
  }

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
            (() => {
              let lastSection: ReferenceRow['section'] | undefined
              const items: React.ReactNode[] = []
              menu.rows.forEach((row, index) => {
                const mention = row as ReferenceRow
                if (mention.section !== lastSection) {
                  lastSection = mention.section
                  items.push(
                    <div key={`section:${mention.section}`} className={css.slashMenuSection}>
                      {t(mention.section === 'files' ? 'ref.section.files' : 'ref.section.sessions')}
                    </div>,
                  )
                }
                items.push(
                  <button
                    key={mention.key}
                    type="button"
                    role="option"
                    aria-selected={index === menu.highlight}
                    className={`${css.slashMenuRow}${index === menu.highlight ? ` ${css.slashMenuRowActive}` : ''}`}
                    onMouseDown={event => { event.preventDefault() }}
                    onClick={() => { accept(mention) }}
                  >
                    <span className={css.slashMenuName}>{mention.name}</span>
                    {mention.description !== undefined && (
                      <span className={css.slashMenuDesc}>{mention.description}</span>
                    )}
                  </button>,
                )
              })
              return items
            })()
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