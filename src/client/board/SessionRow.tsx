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
import type { ReactNode } from 'react'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Chip, type ChipKind } from './Chip.tsx'
import { AttentionDot, Button } from './ui.tsx'

/** The row's status chip data (the chip rendering grammar lives here once). */
export type SessionRowChip = {
  kind: ChipKind
  label: string
  /** Show the activity spinner (running / waiting). */
  spinner?: boolean
}

/** The row's live session state (execution kind): the data-state hook. */
export type SessionRowState = 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'

/** The unified session row (one grammar for every session of a task). */
export function SessionRow({ state, chip, leading, meta, footer, unviewed, unviewedTitle, handle, sessionId, onActivate, onOpenSession, onHide, hideTitle }: {
  /** Live session state (execution kind): rendered as data-state/data-waiting. */
  state?: SessionRowState
  /** Status chip on the top line (undefined = no chip). */
  chip: SessionRowChip | undefined
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
}) {
  return (
    <li
      className={css.sessionRow}
      data-state={state}
      data-waiting={state === 'waiting' ? 'true' : undefined}
      data-unviewed={unviewed === true ? 'true' : undefined}
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActivate() } }}
    >
      <div className={css.sessionRowTop}>
        {unviewed === true && <AttentionDot title={unviewedTitle ?? ''} />}
        {leading}
        {chip !== undefined && (
          <Chip
            kind={chip.kind}
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
      <span className={css.sessionRowMeta}>{meta}</span>
      {footer}
    </li>
  )
}
