/**
 * Shared comment-thread rendering for every surface that shows comment
 * rounds: the execution review page (execution-anchored comments) and the
 * linked-session panel (session-anchored, drive-mode comments). One item
 * grammar — comment text, state chip, submission time, pending-round cancel,
 * the slash-command marker and the settled outcome text — so both panels
 * always read as the same widget.
 */
import { memo } from 'react'
import { t } from '../locales.ts'
import css from '../board.module.css'
import type { TaskRecord } from '../../core/tasks.ts'
import { attachmentCountsOf, attachmentsOf } from '../../core/attachment.ts'
import { Chip } from '../design/Chip.tsx'
import { commentKindOf, commentStateKey, queuePositionsOf, type CommentView } from './comment-thread.ts'
import { Markdown } from './Markdown.tsx'
import { formatDateTime } from './format-time.ts'

/** Renders the task's comment views (oldest first) with cancel affordances. */
/* MEMOISED ON THE THREAD'S CONTENT, NOT ON OBJECT IDENTITY.
 *
 * The panel re-renders on its own schedule (a poll every 3s, state row updates,
 * fold toggles) and every one of those re-renders walked this list — one <li> per
 * comment, each with markdown, chips and its own attachment bookkeeping. The
 * comment rows did not change; the parent's props objects did.
 *
 * The comparison is by VALUE (round ids and their states), because the props
 * themselves are rebuilt upstream: `views` is a fresh array each poll and `task`
 * is a document row. Comparing identities would never hit; comparing the shape
 * that is actually drawn does. `onCancel` is compared by identity — it is a
 * useCallback upstream, and a genuinely different handler must re-render.
 *
 * `task` is compared by id: the rows read its queue positions, which move only
 * when the thread's own states move — and those are compared above. */
export const CommentsThread = memo(function CommentsThread({ task, views, onCancel }: {
  task: TaskRecord
  views: readonly CommentView[]
  /** Cancel a pending round (a saved/queued round is removed on true). */
  onCancel: (roundId: string) => boolean
}) {
  if (views.length === 0) return <p className={css.detailText}>{t('review.noComments')}</p>
  /* ONE pass for the whole list — see `queuePositionsOf`. Asking per row costs the
     square of the row count, and this list re-renders on every 3s poll. */
  const positions = queuePositionsOf(task)
  return (
    <ul className={css.reviewComments}>
      {views.map(view => {
        const position = positions.get(view.round.id) ?? 0
        const cancellable = view.state === 'saved' || view.state === 'queued'
        const counts = attachmentCountsOf(attachmentsOf(view.round))
        return (
          <li key={view.round.id} className={css.reviewComment}>
            <span className={css.reviewCommentText}>
              {view.round.command === true && <span className={css.reviewCommentCommand} aria-hidden="true">/</span>}
              {/* A round without renderable text (legacy external records)
                  never draws an empty body: the state chip alone carries the
                  row, and the settle path backfills the body. A picture-only
                  externally observed message shows its image placeholder —
                  never stale text from an older message. */}
              {view.round.comment !== undefined && view.round.comment !== '' && <Markdown text={view.round.comment} />}
              {view.round.imageOnly === true && <span className={css.reviewCommentImage}>{t('review.commentImage')}</span>}
              {/* What this round carries, whatever moved it: a queued comment, a
                  steer (插话), a rule's own round, or a native turn the board
                  observed. ONE reader (`attachmentsOf`) so the two lanes cannot
                  be counted differently — the old per-lane fields were exactly
                  how a steered picture left no trace in the thread. */}
              {counts.images > 0 && (
                <span className={css.reviewCommentImage}>{t('review.commentImages', { n: String(counts.images) })}</span>
              )}
              {counts.files > 0 && (
                <span className={css.reviewCommentImage}>{t('review.commentFiles', { n: String(counts.files) })}</span>
              )}
            </span>
            <span className={css.reviewCommentMeta}>
              {/* 来源不再分家：直发/驱动/原生会话已并轨为一种「会话活动」，
                  每行统一为 文本 + 状态 chip + 时间；回合的真实性质由数据
                  (direct/external) 承载，界面上不并排来源标签。 */}
              <Chip kind={commentKindOf(view.state)} className={css.reviewCommentChip}>
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
              <span className={css.reviewCommentError}>{view.round.error}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}, (a, b) => {
  if (a.onCancel !== b.onCancel) return false
  if (a.task.id !== b.task.id) return false
  if (a.views.length !== b.views.length) return false
  for (let i = 0; i < a.views.length; i += 1) {
    const x = a.views[i]
    const y = b.views[i]
    if (x.round.id !== y.round.id || x.state !== y.state) return false
  }
  return true
})
