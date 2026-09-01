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
import { Markdown } from './Markdown.tsx'
import { formatDateTime } from './format-time.ts'

/** Renders the task's comment views (oldest first) with cancel affordances. */
export function CommentsThread({ task, views, onCancel }: {
  task: TaskRecord
  views: readonly CommentView[]
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
              {/* A round without renderable text (legacy external records)
                  never draws an empty body: the state chip alone carries the
                  row, and the settle path backfills the body. A picture-only
                  externally observed message shows its image placeholder —
                  never stale text from an older message. */}
              {view.round.comment !== undefined && view.round.comment !== '' && <Markdown text={view.round.comment} />}
              {view.round.imageOnly === true && <span className={css.reviewCommentImage}>{t('review.commentImage')}</span>}
              {/* A queued comment that carries pictures says so (the images
                  ride the round and go out with it when the lane frees). */}
              {view.round.promptImages !== undefined && view.round.promptImages.length > 0 && (
                <span className={css.reviewCommentImage}>{t('review.commentImages', { n: String(view.round.promptImages.length) })}</span>
              )}
            </span>
            <span className={css.reviewCommentMeta}>
              {/* 来源不再分家：直发/驱动/原生会话已并轨为一种「会话活动」，
                  每行统一为 文本 + 状态 chip + 时间；回合的真实性质由数据
                  (direct/external) 承载，界面上不并排来源标签。 */}
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
              <span className={css.reviewCommentError}>{view.round.error}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
