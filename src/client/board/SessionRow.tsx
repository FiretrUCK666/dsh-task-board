/**
 * One session row in a task's detail — THE single row component for every
 * session of a task (run sessions and bound external sessions alike). One
 * skeleton, written once: an identity slot + status chip + right-aligned
 * actions on the top line, a meta line below, and the run-row-only extras
 * (comment summary / live dynamics / error) as the footer slot. Clicking the
 * row activates it — the review page for a run row, the session panel
 * otherwise — while the row's own affordances stay on the row and never
 * bubble into the click. Row-specific data (run index vs workspace label,
 * times vs last-updated) is computed by the caller and passed in; the grammar
 * (chip + spinner, ghost "查看会话", quiet "隐藏", keyboard activation)
 * lives here once.
 */
import { useState, type ReactNode } from 'react'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import type { SessionChipShape, SessionRowState } from './session-chip.ts'
import { Button, Icon } from './ui.tsx'

/** The unified session row (one grammar for every session of a task). */
export function SessionRow({ state, chip, leading, meta, footer, handle, sessionId, onActivate, onOpenSession, onHide, hideTitle, draggable, onDragStart, onDragEnd, onRename, renameTitle, unviewed }: {
  /** Live session state (execution kind): rendered as data-state/data-waiting. */
  state?: SessionRowState
  /** Status chip on the top line (undefined = no chip). */
  chip: SessionChipShape | undefined
  /** Top-line identity slot (session title + run note / workspace label). */
  leading: ReactNode
  /** Meta line below the top line (times / last-updated). */
  meta: ReactNode
  /** Execution-only slots below the meta line (comments, dynamics, error). */
  footer?: ReactNode
  /** Waiting-state amber "处理" label; replaces the ghost "查看会话" button. */
  handle?: string
  /** The native session id; undefined suppresses the session affordances. */
  sessionId: string | undefined
  /** Row activation (review page for a run row, session panel otherwise). */
  onActivate: () => void
  /** Open the native session page (the ghost button / amber handle). */
  onOpenSession: () => void
  /** Hide the row from display only (non-destructive; numbering stays stable). */
  onHide: () => void
  /** Tooltip of the quiet hide affordance. */
  hideTitle: string
  /** Make the row draggable (the detail's manual 会话 reorder). */
  draggable?: boolean
  onDragStart?: (event: React.DragEvent) => void
  onDragEnd?: () => void
  /** Rename affordance (the quiet pencil in the action group): submits the
   *  new title; a rejection throws so the row can surface it inline. */
  onRename?: (title: string) => Promise<void>
  /** Tooltip of the rename affordance. */
  renameTitle?: string
  /**
   * This session has a finished run the user has not reviewed yet (the
   * per-session read clock — run rows pass `TaskSessionRow.unviewed`). The
   * row then wears the amber `unread` breath, so "which session just
   * finished" is answerable inside the list, not only from the card's edge.
   * Absent = no read state (linked external rows) — quiet, honestly.
   */
  unviewed?: boolean
}) {
  // ONE state-bound glow, two semantic values, one amber breath:
  // 'attention' — the session is live right now (waiting / running);
  // 'unread'    — a finished run awaiting its first review (same clock the
  //               card's session dot reads), so the row and the dot can
  //               never disagree about which conversation just finished.
  // A live state outranks unread — one glow, one loudest truth; read and
  // idle rows stay quiet. The animation pauses (never cancels) between the
  // states, so a settle mid-pulse fades instead of tearing a frame.
  const glow = state === 'waiting' || state === 'running'
    ? 'attention'
    : unviewed === true ? 'unread' : 'none'
  // Inline rename state: idle → editing → (saving). The pencil flips the
  // identity slot into a small input prefilled with the current title; the
  // input lives ON the row (no modal), Enter commits, Escape cancels.
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [renameError, setRenameError] = useState<string | undefined>(undefined)
  const startRename = (): void => {
    setDraft('')
    setRenameError(undefined)
    setRenaming(true)
  }
  const commitRename = (): void => {
    if (saving) return
    const trimmed = draft.trim()
    if (trimmed === '') {
      setRenameError(t('detail.renameEmpty'))
      return
    }
    setSaving(true)
    setRenameError(undefined)
    void onRename?.(trimmed).then(
      () => {
        setSaving(false)
        setRenaming(false)
      },
      (error: unknown) => {
        setSaving(false)
        setRenameError(String(error))
      },
    )
  }
  return (
    <li
      className={css.sessionRow}
      data-state={state}
      data-waiting={state === 'waiting' ? 'true' : undefined}
      data-glow={glow}
      data-session-id={sessionId ?? undefined}
      role="button"
      tabIndex={0}
      draggable={draggable === true}
      onClick={onActivate}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={event => {
        // Editable descendants own their keys: an input/textarea/select (or
        // any nested control) inside the row must never trigger the row's
        // Enter/Space activation (spaces must type, Enter must commit the
        // edit — never both commit AND navigate). Buttons exempt themselves
        // via stopPropagation at their own handlers; this is the backstop
        // for editors that do not stop propagation themselves.
        const target = event.target
        if (target instanceof HTMLElement
          && target.closest('input, textarea, select, [contenteditable="true"], button') !== null
          && target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActivate() }
      }}
    >
      <div className={css.sessionRowTop}>
        {/* Named grid slots (lead / chip / act): the columns are STRUCTURAL, so
            the chip and actions sit at the SAME x on every row regardless of
            title length — the content-driven flex-wrap that made the cluster
            "跳来跳去、没对齐" is gone. The attention dot rides inside the lead
            slot (no reserved column, so titles never shift right). */}
        <span className={css.sessionRowLead}>
          {leading}
        </span>
        {chip !== undefined && (
          <span className={css.sessionRowChip}>
            <Chip
              kind={chip.kind}
              title={chip.title}
              icon={chip.spinner === true ? <span className={css.spinner} aria-hidden="true" /> : undefined}
            >
              {chip.label}
            </Chip>
          </span>
        )}
        <span className={css.sessionRowActions}>
          {handle !== undefined ? (
            <button
              type="button"
              className={css.sessionRowHandle}
              onClick={event => { event.stopPropagation(); onOpenSession() }}
              title={sessionId}
            >
              <span className={css.rowActionText}>{handle}</span>
              <Icon name="arrowRight" className={css.rowActionIcon} />
            </button>
          ) : sessionId !== undefined && (
            <Button
              size="sm"
              onClick={event => { event.stopPropagation(); onOpenSession() }}
              title={sessionId}
            >
              <span className={css.rowActionText}>{t('detail.viewSession')}</span>
              <Icon name="arrowRight" className={css.rowActionIcon} />
            </Button>
          )}
          {/* Every row action is the SAME text/glyph pair: wide shows the
              word, narrow shows the glyph (the tooltip always keeps the
              words). The rename glyph is a PENCIL — the copy icon that
              renamed was a lie, and a bare glyph with only a `title` is
              unreachable on touch. */}
          {onRename !== undefined && sessionId !== undefined && !renaming && (
            <button
              type="button"
              className={css.rowHide}
              title={renameTitle}
              onClick={event => { event.stopPropagation(); startRename() }}
            >
              <span className={css.rowActionText}>{t('detail.rename')}</span>
              <Icon name="pencil" className={css.rowActionIcon} />
            </button>
          )}
          <button
            type="button"
            className={css.rowHide}
            onClick={event => { event.stopPropagation(); onHide() }}
            title={hideTitle}
          >
            <span className={css.rowActionText}>{t('detail.hide')}</span>
            <Icon name="eyeOff" className={css.rowActionIcon} />
          </button>
        </span>
      </div>
      {renaming ? (
        /* The rename editor rides where the meta line sits — one row, no
           modal, no layout jump; the row click is suppressed while editing. */
        <span className={css.sessionRenameRow} onClick={event => { event.stopPropagation() }}>
          <input
            className={`${css.input} ${css.sessionRenameInput}`}
            value={draft}
            autoFocus
            disabled={saving}
            placeholder={renameTitle}
            aria-label={renameTitle}
            onChange={event => { setDraft(event.target.value) }}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); commitRename() }
              // Editing owns Escape: cancel the rename WITHOUT closing the
              // panel (the shared Escape stack must never hear it — one key,
              // one owner, never two closers).
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenaming(false) }
            }}
          />
          <Button size="sm" variant="primary" disabled={saving} onClick={commitRename}>
            {t('detail.renameOk')}
          </Button>
          <Button size="sm" disabled={saving} onClick={() => { setRenaming(false) }}>
            {t('detail.renameCancel')}
          </Button>
        </span>
      ) : (
        <span className={css.sessionRowMeta}>{meta}</span>
      )}
      {renameError !== undefined && <span className={css.executionError}>{renameError}</span>}
      {footer}
    </li>
  )
}
