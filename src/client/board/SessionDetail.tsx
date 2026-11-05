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
import { useEffect, useState } from 'react'
import type { BoardController, TranscriptProjectionsShape } from '../../core/controller.ts'
import { type TaskRecord } from '../../core/tasks.ts'
import { sameValue } from '../../core/values.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { formatDateTime } from './format-time.ts'
import { sessionCommentsOf } from './comment-thread.ts'
import { SessionFrame } from './SessionFrame.tsx'
import { SessionComposer, SessionRail, SessionTranscript } from './session-panel.tsx'
import { useWorkSteps } from '../chat-settings.ts'
import { sessionStateChip, sessionUnavailableReasonOf } from './session-chip.ts'
import { sessionRowTitleOf } from '../../core/session-list.ts'
import { useTranscriptTail } from './use-transcript.tsx'
import { Button } from '../design/ui.tsx'
import { useSessionContext, useAwaitingCard } from './use-interaction.ts'

/** The linked-session panel (see module doc). */
export function SessionDetail({ controller, task, sessionId, onClose }: {
  controller: BoardController
  /** The task owning the binding (re-read from the controller snapshot on updates). */
  task: TaskRecord
  /** The linked row that was clicked. */
  sessionId: string
  onClose: () => void
}) {
  // Opening this panel IS reading the conversation: stamp the session's
  // rounds viewed (mount-only — the panel's identity is its session), the
  // same acknowledgement the review page gives its execution. Without this
  // the detail's session rows and the card's session dots kept breathing
  // while the user sat inside the very thread (「点进评论区还在闪」) — the
  // per-session clock has no other funnel from this surface.
  useEffect(() => {
    controller.markTaskSessionViewed(task.id, sessionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The live row, re-derived every render from the native snapshots.
  //
  // ARCHIVED IS STILL A ROW NOW, and that is why this reads AVAILABILITY rather
  // than existence. `linkedOf` keeps an archived session and marks it (a card must
  // be able to show a conversation it still owns), so `row === undefined` no longer
  // means 「gone」 — it means 「not bound here」. The old gate therefore let the
  // composer send into an archived session, while `controller.ruleDeliverable`
  // refuses exactly that for automated delivery: one rule, two answers. Archived
  // is 「可恢复的隐藏」 — the person put it away, and neither a rule nor a keystroke
  // should quietly bring it back.
  const row = controller.linkedOf(task).find(candidate => candidate.sessionId === sessionId)
  const availability = controller.sessionAvailability(sessionId)
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
    turns,
    error: transcriptError,
    hasMore: transcriptHasMore,
    loadingEarlier: transcriptLoadingEarlier,
    pageError: transcriptPageError,
    pageUnsupported: transcriptPageUnsupported,
    atBottom,
    scrollRef,
    jumpToBottom,
    reload,
    loadEarlier,
  } = useTranscriptTail(
    controller,
    liveSessionId,
    undefined,
    /* An unchanged projection must not re-render this panel. The poll hands back a
     FRESH object every 3 seconds, and setState compares by reference — so without
     this comparison the whole surface (211 lines, no memo) re-renders on a timer,
     and a scroll that lands on that tick stutters. Compare by value instead. */
    (result) => {
      const next = result.projections
      setProjections(current => sameValue(current, next) ? current : next)
    },
  )

  /** 工作步骤的折法：三项都读官方 `ui-chat` 设置（读不到时是产品默认）。 */
  const workSteps = useWorkSteps()

  // The session's own comment thread (the session-scoped model): drive-mode
  // rounds from this panel and comments from an execution review page land in
  // the same thread when they share this session.
  const cruiseOn = controller.getSnapshot().cruise.enabled
  const thread = sessionCommentsOf(task, sessionId, cruiseOn)

  // The open native interaction (plan confirm / question) + live to-do/goal/
  // subagents of the session.
  const context = useSessionContext(controller, sessionId)
  const pendingInteraction = useAwaitingCard(controller, sessionId)

  // Send gates: only an UNAVAILABLE session disables the composer — a comment is
  // the user's own words, never gated by the task's execution prompt (that gate
  // belongs to task execution only: runTask / scheduler / chain / cruise / usePrompt
  // rules).
  //
  // UNAVAILABLE, not 「the row is missing」. `linkedOf` keeps an archived row now,
  // so existence stopped answering this question: the old gate let a keystroke
  // reach an archived conversation while `controller.ruleDeliverable` refuses
  // exactly that for automated delivery. Archived is 「可恢复的隐藏」 — the person
  // put it away. `sessionAvailability` is the one judgement (the same one the chips
  // and ruleDeliverable read), and it is what the note below renders its reason
  // from, so the note and the disabled state cannot disagree.
  const liveGone = availability !== undefined && availability !== 'visible'

  // The live state row: waiting / running — THE one state-chip derivation. An
  // idle bound session shows no state row at all: the host session row carries
  // no outcome of its own, so the panel speaks only while the session is
  // actually doing something (a settled outcome is read from the task's own
  // rounds, in the session list's rows).
  const sessionState = waiting !== undefined
    ? 'waiting'
    : row?.running === true
      ? 'running'
      : undefined
  const stateChip = sessionState !== undefined
    ? sessionStateChip(sessionState, waiting, 'detail.result.succeeded', 'detail.linkedIdle', 'detail.idleHint')
    : undefined
  const updatedAt = row !== undefined ? formatDateTime(row.updatedAt) : undefined

  // The hint under the thread header: WHY this session cannot be acted on —
  // archived (recoverable in 设置 → 已归档会话), removed from this card
  // (drag it back), or genuinely gone. One judgment, shared with the badge row
  // below, so the two lines can never name different causes.
  const goneReason = sessionUnavailableReasonOf(controller.sessionAvailability(sessionId))

  return (
    <SessionFrame
      title={sessionRowTitleOf(controller.sessionTitle(sessionId), t('detail.sessionUntitled'))}
      badge={t('detail.sessionCountBadge', { n: String(controller.sessionsOf(task).length) })}
      ariaLabel={t('detail.sessionPanel')}
      context={context}
      contextSessionId={sessionId}
      controller={controller}
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
          <p className={css.detailText}>{goneReason ?? t('detail.sessionUnavailable')}</p>
        ) : (
          <div className={css.reviewTranscriptScroll} ref={scrollRef}>
            <SessionTranscript
              turns={turns}
              prefs={workSteps}
              error={transcriptError}
              atBottom={atBottom}
              jumpToBottom={jumpToBottom}
              waiting={waiting}
              hasMore={transcriptHasMore}
              loadingEarlier={transcriptLoadingEarlier}
              pageError={transcriptPageError}
              pageUnsupported={transcriptPageUnsupported}
              onLoadEarlier={loadEarlier}
              onRetry={reload}
              sessionId={sessionId}
              controller={controller}
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
          turns={turns}
          onChanged={reload}
          task={task}
          thread={thread}
          onCancelComment={id => controller.cancelComment(id)}
          interaction={pendingInteraction.question}
          shellWaiting={pendingInteraction.shell}
          composer={
            <SessionComposer
              controller={controller}
              taskId={task.id}
              sessionId={sessionId}
              placeholder={t('detail.sessionDrivePlaceholder')}
              disabled={liveGone}
              hint={goneReason}
              onDrive={(text, attachments) => controller.submitSessionComment(task.id, sessionId, text, text.startsWith('/'), attachments) !== undefined}
              onSteer={(text, attachments) => controller.steerComment(task.id, sessionId, text, attachments).then(result => result.ok)}
            />
          }
        />
      }
      onClose={onClose}
    />
  )
}