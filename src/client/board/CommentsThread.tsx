/**
 * Shared comment-thread rendering for every surface that shows comment
 * rounds: the execution review page (execution-anchored comments) and the
 * linked-session panel (session-anchored, drive-mode comments). One item
 * grammar — comment text, state chip, submission time, pending-round cancel,
 * the slash-command marker and the settled outcome text — so both panels
 * always read as the same widget.
 */
import { t } from '../locales.ts'
import css from '../board.module.css'
import type { TaskRecord } from '../../core/tasks.ts'
import { Chip } from './Chip.tsx'
import { commentKindOf, commentStateKey, queuePositionOf, type CommentView } from './comment-thread.ts'
import { formatDateTime } from './TaskCard.tsx'

/** Renders the task's comment views (oldest first) with cancel affordances. */
export function CommentsThread({ task, views, onCancel }: {
  task: TaskRecord
  views: CommentView[]
  /** Cancel a pending round (a saved/queued round is removed on true). */
  onCancel: (roundId: string) => boolean
}) {
  if (views.length === 0) return <p className={css.detailText}>{t('review.noComments')}</p>
  return (
    <ul className={css.reviewComments}>
      {views.map(view => {
        const position = queuePositionOf(task, view.round.id)
        const cancellable = view.state === 'saved' || view.state === 'queued'
        return (
          <li key={view.round.id} className={css.reviewComment}>
            <span className={css.reviewCommentText}>
              {view.round.command === true && <span className={css.reviewCommentCommand} aria-hidden="true">/</span>}
              {view.round.comment}
            </span>
            <span className={css.reviewCommentMeta}>
              <Chip kind={commentKindOf(view.state)}>
                {view.state === 'queued'
                  ? t('review.commentQueued', { n: String(position) })
                  : t(commentStateKey(view.state))}
              </Chip>
              <span className={css.reviewCommentTime}>{formatDateTime(view.round.startedAt)}</span>
              {cancellable && (
                <button
                  type="button"
                  className={css.reviewCommentCancel}
                  onClick={() => { onCancel(view.round.id) }}
                >
                  {t('review.commentCancel')}
                </button>
              )}
            </span>
            {/* A settled command round carries its registry outcome (e.g.
                "/permission read-only" → "preset read-only", or an
                unknown-preset error). */}
            {view.round.command === true && view.round.error !== undefined && view.round.error !== '' && (
              <span className={`${css.executionError}${view.state === 'succeeded' ? ` ${css.reviewCommandOutcome}` : ''}`}>{view.round.error}</span>
            )}
            {view.state === 'failed' && view.round.command !== true && view.round.error !== undefined && view.round.error !== '' && (
              <span className={css.executionError}>{view.round.error}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
