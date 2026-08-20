/**
 * Session detail: the linked-session panel opened by clicking a "链接会话"
 * row. It shares the exact shell (SessionFrame) and the full right-rail
 * experience (SessionRailHead: context meter + live config + session facts)
 * with the execution review page — one panel grammar for every session.
 *
 * The one deliberate difference is the composer semantics, split into two
 * explicit modes (one switch, default drive):
 * - 「驱动任务」(drive, default): a comment here is a session-anchored comment
 *   round — it enters the task's per-task FIFO queue and, under the cruise/
 *   budget rule, is injected into this very session, exactly like a comment
 *   from an execution's review page. It moves the card (任务 → 运行中 → 待审核)
 *   and is fully cancellable while pending. The panel shows this session's
 *   own comment thread with live states.
 * - 「直发会话」(direct): sends a message DIRECTLY to the native session (as
 *   if typed in its own conversation) — it never creates execution records,
 *   never enters the dispatcher, never changes task state, cruise, chain or
 *   schedules, and needs the native direct-message faces.
 * The mode's boundary is stated plainly under the composer, so a user never
 * guesses which send drives the task.
 */
import { useState, type ReactNode } from 'react'
import type { BoardController, TranscriptProjectionsShape } from '../../core/controller.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import { PromptInput } from './PromptInput.tsx'
import { formatDateTime } from './TaskCard.tsx'
import { CommentsThread } from './CommentsThread.tsx'
import { sessionCommentsOf } from './comment-thread.ts'
import { commentDraftKey, draftStore } from './drafts.ts'
import { SessionFrame } from './SessionFrame.tsx'
import { SessionRailHead, SessionTranscript } from './session-panel.tsx'
import { useTranscriptTail } from './use-transcript.tsx'
import { Button } from './ui.tsx'

/** The linked-session panel (see module doc). */
export function SessionDetail({ controller, task, sessionId, onClose }: {
  controller: BoardController
  /** The task owning the binding (re-read from the controller snapshot on updates). */
  task: TaskRecord
  /** The linked row that was clicked. */
  sessionId: string
  onClose: () => void
}) {
  // The live row, re-derived every render from the native snapshots
  // (undefined once the session is hidden, archived or deleted — the panel
  // then degrades to the raw id and disables the composer).
  const row = controller.linkedOf(task).find(candidate => candidate.sessionId === sessionId)
  const waiting = row?.pendingInteraction
  // Native projections (context pressure / breakdown / permissions) ride the
  // history tail page — the same source as the execution review page.
  const [projections, setProjections] = useState<TranscriptProjectionsShape | undefined>(undefined)
  // The live row is the poll gate: once the session is gone the tail stops
  // polling — there is nothing left to follow, and the main area shows the
  // unavailable note instead of an endless "loading".
  const liveSessionId = row === undefined ? undefined : sessionId
  // The same live transcript tail as every other session surface (load /
  // watermark-gated poll / auto-follow / 滑到最新) — one mechanism everywhere.
  const {
    lines,
    error: transcriptError,
    atBottom,
    scrollRef,
    onScroll,
    jumpToBottom,
    reload,
  } = useTranscriptTail(
    controller,
    liveSessionId,
    undefined,
    (result) => { setProjections(result.projections) },
  )

  // Composer mode: drive (default) vs direct. One explicit switch — the
  // mode's boundary is stated in the panel, never guessed.
  const [drive, setDrive] = useState(true)
  const cruiseOn = controller.getSnapshot().cruise.enabled
  // The session's own comment thread (the session-scoped model — drive-mode
  // rounds from this panel AND comments submitted from an execution's review
  // page land in the same thread when they share this session), live states.
  const thread = sessionCommentsOf(task, sessionId, cruiseOn)
  const [lastCommentId, setLastCommentId] = useState<string | undefined>(undefined)

  // Direct-composer state: sending is immediate (no queue), a failure keeps
  // the draft so the user can retry. Draft memory: the text survives switching
  // away (and is shared with the execution review page for this session) via
  // the per-session comment draft slot; it is cleared once a send lands.
  const [draft, setDraft] = useState<string>(() => draftStore.get(commentDraftKey(task.id, sessionId)) ?? '')
  const [busy, setBusy] = useState(false)
  const [sendError, setSendError] = useState<string | undefined>(undefined)
  const liveGone = row === undefined
  const directUnavailable = liveGone || !controller.directMessageAvailable()
  const taskDone = task.status === 'done'

  const submit = (): void => {
    const text = draft.trim()
    if (text === '' || busy) return
    if (drive) {
      // Drive: a session-anchored comment round — same queue, same
      // dispatcher, same injection as an execution comment. A leading '/'
      // is a slash command through the native registry, matching the native
      // composer and the review page. Synchronous: the round is saved at
      // once and the card's queue chip + this thread reflect it.
      if (liveGone || taskDone) return
      const round = controller.submitSessionComment(task.id, sessionId, text, text.startsWith('/'))
      if (round !== undefined) {
        setLastCommentId(round.id)
        setDraft('')
        setSendError(undefined)
        draftStore.clear(commentDraftKey(task.id, sessionId))
      }
      return
    }
    // Direct: the message goes to the native session immediately (exactly as
    // if typed in its own conversation) — no execution record, no dispatcher.
    // The sent line is recorded as a direct round in this session's thread,
    // so it stays visible next to drive comments and execution comments.
    if (directUnavailable) return
    setBusy(true)
    setSendError(undefined)
    void controller.sendSessionMessage(task.id, sessionId, text).then(result => {
      setBusy(false)
      if (result.ok) {
        setDraft('')
        draftStore.clear(commentDraftKey(task.id, sessionId))
        reload()
      } else {
        setSendError(result.error === 'direct message unavailable'
          ? t('detail.sessionUnavailable')
          : t('detail.sessionSendFailed', { error: result.error }))
      }
    })
  }

  const stateChip = waiting !== undefined
    ? { kind: 'warn' as const, label: t(`waiting.${waiting}` as 'waiting.approval') }
    : row?.running === true
      ? { kind: 'warn' as const, label: t('detail.result.running') }
      : row?.completed === true
        ? { kind: 'success' as const, label: t('detail.linkedDone') }
        : undefined

  // The hint under the send button, one branch per situation — never a
  // guessed bulk of nested ternaries inline in the JSX.
  let composerHint: ReactNode = null
  if (drive && taskDone) {
    // A done task rejects comments — the hint explains how to release them.
    composerHint = <span className={css.reviewComposerHint}>{t('detail.commentQueuedDone')}</span>
  } else if (liveGone) {
    composerHint = <span className={css.reviewComposerHint}>{t('detail.sessionUnavailable')}</span>
  } else if (!drive && sendError !== undefined) {
    composerHint = <span className={css.reviewConfigMessage}>{sendError}</span>
  } else if (drive && lastCommentId !== undefined
    && !task.executions.some(round => round.id === lastCommentId && round.endedAt !== undefined)) {
    // A saved drive comment states where it stands (injected / queued / saved).
    composerHint = (
      <span className={css.reviewComposerHint}>
        {task.status === 'running' ? t('review.commentInjected')
          : cruiseOn ? t('review.commentQueuedHint')
            : t('review.commentPendingHint')}
      </span>
    )
  }

  return (
    <SessionFrame
      title={row?.title ?? sessionId}
      badge={t('detail.sessionCountBadge', { n: String(controller.linkedOf(task).length) })}
      ariaLabel={t('detail.sessionPanel')}
      actions={
        <>
          <Button size="sm" onClick={reload} title={t('review.refresh')}>
            {t('review.refresh')}
          </Button>
          <Button size="sm" onClick={() => { controller.openSession(sessionId) }}>
            {t('detail.viewSession')} →
          </Button>
        </>
      }
      main={
        row === undefined ? (
          <p className={css.detailText}>{t('detail.sessionUnavailable')}</p>
        ) : (
          <div className={css.reviewTranscriptScroll} ref={scrollRef} onScroll={onScroll}>
            <SessionTranscript
              lines={lines}
              error={transcriptError}
              atBottom={atBottom}
              jumpToBottom={jumpToBottom}
              waiting={waiting}
            />
          </div>
        )
      }
      rail={
        <>
          {/* The head + thread scroll inside their own region; the composer
              below is flex:none and stays pinned — a taller head (status,
              config, thread) can never squeeze the send button out of the
              rail. */}
          <div className={css.sessionRailScroll}>
            {stateChip !== undefined && row !== undefined && (
              <div className={css.sessionFacts}>
                <Chip
                  kind={stateChip.kind}
                  icon={(row.running || waiting !== undefined)
                    ? <span className={css.spinner} aria-hidden="true" />
                    : undefined}
                >
                  {stateChip.label}
                </Chip>
                <span className={css.sessionFactTime}>
                  {t('detail.sessionUpdated')} {formatDateTime(row.updatedAt)}
                </span>
              </div>
            )}
            <SessionRailHead
              sessionId={sessionId}
              controller={controller}
              projections={projections}
              lines={lines}
              onChanged={reload}
            />
            {/* The session's own comment thread — ONE shared record for every
                way this session is driven: drive rounds from this panel,
                direct-send rounds, and comments submitted from an execution's
                review page all land in the same list (session-scoped model),
                so the drive and direct surfaces read and look IDENTICAL. The
                mode note below states the composer's boundary; it never
                replaces the thread. Direct rounds carry the quiet "直发" tag. */}
            <section className={css.sessionThread}>
              <h4 className={css.reviewThreadTitle}>
                {t('review.comments')}
                <span className={css.reviewThreadCount}>{thread.length}</span>
              </h4>
              <CommentsThread
                task={task}
                views={thread}
                onCancel={id => controller.cancelComment(id)}
              />
              {drive
                ? <p className={css.detailHint}>{t('detail.sessionDriveHint')}</p>
                : <p className={css.sessionReadonly}>{t('detail.sessionDirect')}</p>}
            </section>
          </div>

          {/* The composer, pinned: drive (default) or direct, chosen by one
              explicit switch. Same visual rhythm and primary send button on
              both paths — different accounting, which the mode label above
              and the placeholder below explain. */}
          <div className={css.reviewComposer}>
            <div className={css.segmentedRow} role="radiogroup" aria-label={t('detail.sessionComposerMode')}>
              <button
                type="button"
                role="radio"
                aria-checked={drive}
                className={`${css.segmentedButton}${drive ? ` ${css.segmentedActive}` : ''}`}
                title={t('detail.sessionComposerModeDriveTitle')}
                onClick={() => { setDrive(true); setSendError(undefined) }}
              >
                {t('detail.sessionComposerModeDrive')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!drive}
                className={`${css.segmentedButton}${!drive ? ` ${css.segmentedActive}` : ''}`}
                title={t('detail.sessionComposerModePureTitle')}
                onClick={() => { setDrive(false); setSendError(undefined) }}
              >
                {t('detail.sessionComposerModePure')}
              </button>
            </div>
            <PromptInput
              value={draft}
              onChange={next => {
                setDraft(next)
                draftStore.set(commentDraftKey(task.id, sessionId), next)
              }}
              placeholder={drive
                ? t('detail.sessionDrivePlaceholder')
                : t('detail.sessionComposerPlaceholder')}
              rows={3}
              controller={controller}
            />
            <div className={css.reviewComposerRow}>
              <Button
                variant="primary"
                disabled={draft.trim() === '' || (drive ? (liveGone || taskDone) : directUnavailable)}
                onClick={submit}
              >
                {drive ? t('review.commentSend') : t('detail.sessionSend')}
              </Button>
              {composerHint}
            </div>
          </div>
        </>
      }
      onClose={onClose}
    />
  )
}
