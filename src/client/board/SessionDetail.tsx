/**
 * Session detail: the linked-session panel opened by clicking a session row.
 * It shares the exact shell (SessionFrame), the right rail (SessionRail) and
 * the composer grammar (SessionComposer) with the execution review page —
 * one panel grammar for every session. This file is only the linked-session
 * semantics: the live row (state chip + updated time), the session's own
 * comment thread, and the send paths (排队 = dispatcher queue, 插话 =
 * deliver straight to the native session now; a comment on a done task
 * revives it — the message drives the task, never a dead end).
 */
import { useState } from 'react'
import type { BoardController, TranscriptProjectionsShape } from '../../core/controller.ts'
import { type TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { formatDateTime } from './format-time.ts'
import { sessionCommentsOf } from './comment-thread.ts'
import { SessionFrame } from './SessionFrame.tsx'
import { SessionComposer, SessionRail, SessionTranscript } from './session-panel.tsx'
import { sessionStateChip } from './session-chip.ts'
import { useTranscriptTail } from './use-transcript.tsx'
import { Button } from './ui.tsx'
import { useSessionContext, useWireQuestion } from './use-interaction.ts'

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

  // The session's own comment thread (the session-scoped model): drive-mode
  // rounds from this panel and comments from an execution review page land in
  // the same thread when they share this session.
  const cruiseOn = controller.getSnapshot().cruise.enabled
  const thread = sessionCommentsOf(task, sessionId, cruiseOn)

  // The open native interaction (plan confirm / question) + live to-do/goal/
  // subagents of the session.
  const context = useSessionContext(controller, sessionId)
  const pendingInteraction = useWireQuestion(controller, sessionId)

  // Send gates: a gone session is the only disable — a comment is the user's
  // own words, never gated by the task's execution prompt (that gate belongs
  // to task execution only: runTask / scheduler / chain / cruise / usePrompt
  // rules).
  const liveGone = row === undefined

  // The live state row: waiting / running / completed — THE one state-chip
  // derivation; an idle bound session shows no state row at all (nothing has
  // happened — the row exists only when the session is actually doing
  // something or has finished).
  const sessionState = waiting !== undefined
    ? 'waiting'
    : row?.running === true
      ? 'running'
      : row?.completed === true
        ? 'succeeded'
        : undefined
  const stateChip = sessionState !== undefined
    ? sessionStateChip(sessionState, waiting, 'detail.linkedDone', 'detail.linkedIdle', 'detail.idleHint')
    : undefined
  const updatedAt = row !== undefined ? formatDateTime(row.updatedAt) : undefined

  // The hint under the thread header: the blocking reason when there is one
  // (a gone session), the standing drive explanation otherwise.
  const hint = liveGone ? t('detail.sessionUnavailable') : undefined

  return (
    <SessionFrame
      title={row?.title ?? sessionId}
      badge={t('detail.sessionCountBadge', { n: String(controller.linkedOf(task).length) })}
      ariaLabel={t('detail.sessionPanel')}
      context={context}
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
        <SessionRail
          stateChip={stateChip}
          updatedAt={updatedAt}
          sessionId={sessionId}
          controller={controller}
          projections={projections}
          lines={lines}
          onChanged={reload}
          hint={hint}
          task={task}
          thread={thread}
          onCancelComment={id => controller.cancelComment(id)}
          interaction={pendingInteraction}
          composer={
            <SessionComposer
              controller={controller}
              taskId={task.id}
              sessionId={sessionId}
              placeholder={t('detail.sessionDrivePlaceholder')}
              disabled={liveGone}
              onDrive={text => controller.submitSessionComment(task.id, sessionId, text, text.startsWith('/')) !== undefined}
              onSteer={text => controller.steerComment(task.id, sessionId, text).then(result => result.ok)}
              onSteerImages={(text, refs) => controller.steerCommentWithImages(task.id, sessionId, text, refs).then(result => result.ok)}
            />
          }
        />
      }
      onClose={onClose}
    />
  )
}
