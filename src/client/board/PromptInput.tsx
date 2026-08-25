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
  referenceMenuAvailable, continueAfterPick, type CommandToken,
} from './slash-token.ts'
import { fallbackSessionRowsOf, listReferenceRows, type ReferenceDiag, type ReferenceRow } from './reference-source.ts'
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
  /** Why a '@' candidate half produced no rows (honest empty state). */
  diag: ReferenceDiag
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
  // calls; every keystroke supersedes the previous fetch (abort). The bridge
  // never rejects (per-domain failure guarantee), and this catch is the
  // last-resort net: a surprise failure keeps the previous rows instead of
  // leaving a dead empty menu stuck open.
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
    ).then(({ rows, diag }) => {
      if (!alive || controllerRef.signal.aborted) return
      let nextRows = rows
      let nextDiag = diag
      // Host sessions-half unavailable (e.g. the target session is
      // subagent-owned and the gateway refuses the lookup): degrade to the
      // board's own session catalog with the OFFICIAL mention grammar —
      // a picked row still resolves through the host's pre-step parser.
      if (diag.sessions !== undefined && rows.every(row => (row as ReferenceRow).section !== 'sessions')) {
        const fallback = fallbackSessionRowsOf(controller.referenceSessionCatalog(), sessionId)
        if (fallback.length > 0) {
          nextRows = [...rows, ...fallback]
          nextDiag = { ...diag, sessions: { ...diag.sessions, fallback: true } }
        }
      }
      if (nextDiag.files !== undefined || nextDiag.sessions !== undefined) {
        console.warn('[dsh-task-board] @ reference menu degraded:', JSON.stringify(nextDiag))
      }
      setMenu(previous => previous !== undefined && previous.kind === 'mention' && sameMentionSpan(previous.token, mentionReq)
        ? { ...previous, rows: nextRows, diag: nextDiag }
        : previous)
    }).catch(() => {
      if (alive) console.warn('[dsh-task-board] @ reference fetch failed unexpectedly')
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
    // '@' needs BOTH a target session and the official reference bridge —
    // a missing capability never opens an empty menu (the same gate as '/'
    // needing the slash catalog). A typed '@' wins over a '/' when both
    // could match (the '/' scan would otherwise treat '@foo' as a non-slash
    // word).
    const bridgePresent = controller.referenceSources() !== undefined
    const mentionToken = referenceMenuAvailable(sessionId, bridgePresent)
      ? mentionTokenAt(text, caret)
      : undefined
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
          : { token, kind, rows: previous?.kind === 'mention' ? previous.rows : [], diag: previous?.kind === 'mention' ? previous.diag : {}, highlight: 0, flip })
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
        : { token, kind, rows, diag: {}, highlight: 0, flip })
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
      // Re-sync ONLY on the official directory descent (`@"path/` keeps its
      // quote open for the next level). A plain file, a session mention and
      // every slash completion close the menu for good — their splices leave
      // the caret inside a live token, which would otherwise instantly
      // re-open the menu the user just used.
      if (menu.kind === 'mention' && continueAfterPick(row as ReferenceRow)) {
        syncMenu()
      }
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

  /** The '@' menu items: the official sections in order (files, then
   *  sessions). A half that failed shows its notice in its own section
   *  slot — the bare "no match" line appears only when both halves
   *  genuinely returned nothing. */
  const mentionMenu = (menu: TriggerMenuState): React.ReactNode[] => {
    const bySection: Record<'files' | 'sessions', ReferenceRow[]> = { files: [], sessions: [] }
    for (const row of menu.rows as readonly ReferenceRow[]) bySection[row.section].push(row)
    const items: React.ReactNode[] = []
    let rowIndex = -1
    for (const section of ['files', 'sessions'] as const) {
      const sectionRows = bySection[section]
      const failed = menu.diag[section]
      if (sectionRows.length === 0 && failed === undefined) continue
      items.push(
        <div key={`section:${section}`} className={css.slashMenuSection}>
          {t(section === 'files' ? 'ref.section.files' : 'ref.section.sessions')}
        </div>,
      )
      // A failed half reports its notice IN its section — above the rows when
      // the board catalog substituted them (honest: the rows are not the host
      // candidates), instead of a bare "no match".
      if (failed !== undefined && (sectionRows.length === 0 || failed.fallback === true)) {
        items.push(
          <div key={`fail:${section}`} className={css.slashMenuEmpty} role="option" aria-disabled="true">
            {t(section === 'files' ? 'ref.fail.files' : 'ref.fail.sessions')}
            {failed.code !== undefined ? ` (${failed.code})` : ''}
            {failed.fallback === true ? ` · ${t('ref.fail.fallback')}` : ''}
          </div>,
        )
      }
      if (sectionRows.length > 0) {
        for (const mention of sectionRows) {
          rowIndex += 1
          items.push(
            <button
              key={mention.key}
              type="button"
              role="option"
              aria-selected={rowIndex === menu.highlight}
              className={`${css.slashMenuRow}${rowIndex === menu.highlight ? ` ${css.slashMenuRowActive}` : ''}`}
              onMouseDown={event => { event.preventDefault() }}
              onClick={() => { accept(mention) }}
            >
              <span className={css.slashMenuName}>{mention.name}</span>
              {mention.description !== undefined && (
                <span className={css.slashMenuDesc}>{mention.description}</span>
              )}
            </button>,
          )
        }
      }
    }
    if (items.length === 0) {
      items.push(
        <div className={css.slashMenuEmpty} role="option">
          {t('prompt.noReferences')}
        </div>,
      )
    }
    return items
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
          {menu.kind === 'mention'
            ? mentionMenu(menu)
            : menu.rows.length === 0
              ? (
                <div className={css.slashMenuEmpty} role="option">
                  {t('prompt.noCommands')}
                </div>
              )
              : menu.rows.map((row, index) => {
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