/**
 * Review page: one execution's review surface. Opened by clicking an
 * execution-history row, it shows the session's recent conversation
 * (the transcript tail, folded from raw history events following the
 * native harness rules) and a comment composer that continues the
 * conversation — each comment becomes a fresh turn in the same session.
 * Comments are injected when the auto-cruise is on; while it is off they
 * are saved as pending and injected once the cruise starts. The native
 * session page remains the place for the full transcript ("查看会话"), so
 * this page only ever shows the tail and never duplicates the full
 * conversation view.
 */
import { useEffect, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import type { ExecutionRecord, TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import { formatDateTime } from './TaskCard.tsx'
import { foldTranscript, type TranscriptLine } from './review-transcript.ts'

/** One comment round rendered in the thread, with its live state. */
interface CommentView {
  round: ExecutionRecord
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
}

/** Build the comment thread of a task for one session, oldest first. */
function commentsOf(task: TaskRecord, sessionId: string | undefined): CommentView[] {
  if (sessionId === undefined) return []
  return task.executions
    .filter(round => round.comment !== undefined && round.sessionId === sessionId)
    .map(round => ({
      round,
      state: round.endedAt !== undefined
        ? (round.result ?? 'cancelled')
        : task.status === 'running' ? 'running' : 'pending',
    }))
}

/** Comment-round state → chip color + label key. */
function commentStateOf(state: CommentView['state']): { kind: 'success' | 'error' | 'warn' | 'muted'; label: string } {
  switch (state) {
    case 'succeeded': return { kind: 'success', label: t('review.commentSucceeded') }
    case 'failed': return { kind: 'error', label: t('review.commentFailed') }
    case 'running': return { kind: 'warn', label: t('review.commentRunning') }
    case 'cancelled': return { kind: 'muted', label: t('review.commentCancelled') }
    case 'pending': return { kind: 'muted', label: t('review.commentPending') }
  }
}

/** The review page (see module doc). */
export function ReviewDetail({ controller, task, execution, onClose }: {
  controller: BoardController
  /** The task owning the execution (re-read from the controller snapshot on updates). */
  task: TaskRecord
  /** The execution row that was clicked (its session is reviewed and continued). */
  execution: ExecutionRecord
  onClose: () => void
}) {
  const [snapshot, setSnapshot] = useState(controller.getSnapshot())
  useEffect(() => controller.subscribe(() => setSnapshot(controller.getSnapshot())), [controller])
  // The live task record: the clicked execution may have been superseded.
  const current = snapshot.tasks.find(candidate => candidate.id === task.id) ?? task
  const sessionId = execution.sessionId
  const comments = commentsOf(current, sessionId)

  const [lines, setLines] = useState<readonly TranscriptLine[] | undefined>(undefined)
  const [transcriptError, setTranscriptError] = useState(false)
  const [draft, setDraft] = useState('')
  const [lastCommentId, setLastCommentId] = useState<string | undefined>(undefined)

  // Load the transcript tail; reload when the task's run history changes
  // (a comment injected or settled) so the conversation stays current.
  useEffect(() => {
    if (sessionId === undefined) return
    let alive = true
    setTranscriptError(false)
    void controller.loadTranscript(sessionId).then(events => {
      if (!alive) return
      if (events === undefined) {
        setTranscriptError(true)
        return
      }
      setLines(foldTranscript(events))
    })
    return () => { alive = false }
  }, [controller, sessionId, current.executions.length, current.status])

  const submit = (): void => {
    const text = draft.trim()
    if (text === '') return
    const round = controller.submitComment(current.id, execution.id, text)
    if (round !== undefined) {
      setLastCommentId(round.id)
      setDraft('')
    }
  }

  // The run's sequence among the task's plain runs (comment rounds excluded).
  const runIndex = current.executions
    .filter(candidate => candidate.comment === undefined)
    .indexOf(execution) + 1

  return (
    <div className={css.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className={css.review} role="dialog" aria-label={t('review.title')}>
        <header className={css.reviewHeader}>
          <h2 className={css.reviewTitle}>
            {current.title}
            <span className={css.reviewBadge}>
              {t('detail.executionNo', { n: String(runIndex) })}
            </span>
          </h2>
          <div className={css.reviewActions}>
            {sessionId !== undefined && (
              <button
                type="button"
                className={css.ghostButton}
                onClick={() => { controller.openSession(sessionId) }}
              >
                {t('detail.viewSession')} →
              </button>
            )}
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('detail.close')}
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        <div className={css.reviewBody}>
          {/* The run's outcome banner: what the agent came back with. */}
          <div className={css.reviewOutcome}>
            <Chip kind={execution.result === 'failed' ? 'error' : execution.result === 'succeeded' ? 'success' : 'muted'}>
              {execution.result === undefined ? t('detail.result.running') : t(`detail.result.${execution.result}` as 'detail.result.succeeded')}
            </Chip>
            <span className={css.reviewOutcomeMeta}>
              {t('detail.executionEnded')} {execution.endedAt !== undefined ? formatDateTime(execution.endedAt) : '—'}
            </span>
          </div>

          {/* The conversation tail: native-style user bubbles and assistant
              columns; context injections render as weak rows. */}
          <section className={css.reviewSection}>
            <h4>{t('review.transcript')}</h4>
            {sessionId === undefined ? (
              <p className={css.detailText}>{t('review.noSession')}</p>
            ) : transcriptError ? (
              <p className={css.detailText}>{t('review.transcriptUnavailable')}</p>
            ) : lines === undefined ? (
              <p className={css.detailText}>{t('review.loading')}</p>
            ) : lines.length === 0 ? (
              <p className={css.detailText}>{t('review.transcriptEmpty')}</p>
            ) : (
              <ul className={css.reviewTranscript}>
                {lines.map(line => line.kind === 'context' ? (
                  <li key={line.id} className={css.reviewContext} title={line.summary}>
                    {t('review.contextInjection')} · {line.plugin}
                  </li>
                ) : (
                  <li key={line.id} className={css.reviewMessage} data-role={line.role}>
                    <span className={css.reviewMessageText}>{line.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* The comment thread: every comment on this session, with its live state. */}
          <section className={css.reviewSection}>
            <h4>{t('review.comments')}</h4>
            {comments.length === 0 ? (
              <p className={css.detailText}>{t('review.noComments')}</p>
            ) : (
              <ul className={css.reviewComments}>
                {comments.map(view => {
                  const state = commentStateOf(view.state)
                  return (
                    <li key={view.round.id} className={css.reviewComment}>
                      <span className={css.reviewCommentText}>{view.round.comment}</span>
                      <span className={css.reviewCommentMeta}>
                        <Chip kind={state.kind}>{state.label}</Chip>
                        <span className={css.reviewCommentTime}>{formatDateTime(view.round.startedAt)}</span>
                      </span>
                      {view.state === 'failed' && view.round.error !== undefined && view.round.error !== '' && (
                        <span className={css.executionError}>{view.round.error}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {/* The composer: a comment continues the conversation in-session. */}
            <div className={css.reviewComposer}>
              <textarea
                className={css.input}
                rows={3}
                value={draft}
                placeholder={t('review.commentPlaceholder')}
                onChange={event => { setDraft(event.target.value) }}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
              <div className={css.reviewComposerRow}>
                <button type="button" className={css.primaryButton} disabled={draft.trim() === ''} onClick={submit}>
                  {t('review.commentSend')}
                </button>
                {lastCommentId !== undefined && !current.executions.some(round => round.id === lastCommentId && round.endedAt !== undefined) && (
                  <span className={css.reviewComposerHint}>
                    {current.status === 'running' ? t('review.commentInjected') : t('review.commentPendingHint')}
                  </span>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
