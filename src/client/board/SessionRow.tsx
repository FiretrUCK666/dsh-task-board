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
import { AttentionDot, Button, Icon } from './ui.tsx'

/** The unified session row (one grammar for every session of a task). */
export function SessionRow({ state, chip, leading, meta, footer, unviewed, unviewedTitle, handle, sessionId, onActivate, onOpenSession, onHide, hideTitle, draggable, onDragStart, onDragEnd, onRename, renameTitle }: {
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
  /** Unread reminder (execution kind): attention dot + inner breathing halo. */
  unviewed?: boolean
  unviewedTitle?: string
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
}) {
  // ONE state-bound glow: waiting / running / settled-unread rows breathe
  // attention; viewed / idle rows are quiet — the halo never toggles with the
  // per-render unviewed boolean, so no row can flicker.
  const glow = state === 'waiting' || state === 'running' || unviewed === true ? 'attention' : 'none'
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
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActivate() } }}
    >
      <div className={css.sessionRowTop}>
        {unviewed === true && <AttentionDot title={unviewedTitle ?? ''} />}
        {leading}
        {chip !== undefined && (
          <Chip
            kind={chip.kind}
            title={chip.title}
            icon={chip.spinner === true ? <span className={css.spinner} aria-hidden="true" /> : undefined}
          >
            {chip.label}
          </Chip>
        )}
        <span className={css.sessionRowActions}>
          {handle !== undefined ? (
            <button
              type="button"
              className={css.sessionRowHandle}
              onClick={event => { event.stopPropagation(); onOpenSession() }}
              title={sessionId}
            >
              {handle} →
            </button>
          ) : sessionId !== undefined && (
            <Button
              size="sm"
              onClick={event => { event.stopPropagation(); onOpenSession() }}
              title={sessionId}
            >
              {t('detail.viewSession')} →
            </Button>
          )}
          {onRename !== undefined && sessionId !== undefined && !renaming && (
            <button
              type="button"
              className={css.rowHide}
              title={renameTitle}
              onClick={event => { event.stopPropagation(); startRename() }}
            >
              <Icon name="copy" />
            </button>
          )}
          <button
            type="button"
            className={css.rowHide}
            onClick={event => { event.stopPropagation(); onHide() }}
            title={hideTitle}
          >
            {t('detail.hide')}
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
              if (event.key === 'Escape') { event.preventDefault(); setRenaming(false) }
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
