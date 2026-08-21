/**
 * Review page: one execution's review surface. Opened by clicking an
 * execution-history row, it shows the session's recent conversation
 * (the transcript tail, folded from raw history events following the
 * native harness rules) plus a live session panel — the execution
 * session's current model/reasoning effort (native models API), its
 * permission (switched through the native `/permission` command registry —
 * never a model turn), its real workspace/Agent facts (from the
 * session-list summary, read-only), and the native context meter. When the
 * execution session is blocked on the user (approval / plan review /
 * question), a waiting banner explains it and points at "查看会话". The
 * layout is two columns: the conversation owns the full left height; the
 * right rail is THE shared SessionRail — live state row, fixed head (meter,
 * config, session facts), fixed thread header, hint line, independently
 * scrolling comment list, pending interaction card and the pinned composer.
 * The thread shows only the comments of the execution being reviewed — each
 * execution's page shows its own, the injection queue stays task-level. Both
 * the transcript and the comment list auto-follow the latest output while at
 * the bottom, with a "滑到最新" button when scrolled up. A comment whose
 * first character is '/' is a slash command executed through the native
 * command registry, exactly like the native composer. The native session
 * page remains the place for the full transcript ("查看会话").
 */
import { useCallback, useEffect, useState } from 'react'
import type { BoardController, TranscriptProjectionsShape } from '../../core/controller.ts'
import { type ExecutionRecord, type TaskRecord } from '../../core/tasks.ts'
import { sessionDisplay } from '../../core/session-display.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import { formatDateTime } from './TaskCard.tsx'
import { sessionCommentsOf } from './comment-thread.ts'
import { SessionFrame } from './SessionFrame.tsx'
import { SessionComposer, SessionRail, SessionTranscript } from './session-panel.tsx'
import { useTranscriptTail } from './use-transcript.tsx'
import { useSessionContext, useWireQuestion } from './use-interaction.ts'
import { Button } from './ui.tsx'

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
  const cruiseOn = snapshot.cruise.enabled
  // This execution's session thread (the session-scoped model — comments
  // submitted from any surface for this session, execution page or linked
  // panel, are visible together here).
  const comments = sessionId !== undefined
    ? sessionCommentsOf(current, sessionId, cruiseOn)
    : []

  // The open native interaction (plan confirm / question): the card over the
  // composer answers it in place through the mux channel (the only path that
  // settles the suspended call). Plus the live session context (to-do / goal
  // / subagents) for the readout above the composer.
  const context = useSessionContext(controller, sessionId)
  const pendingInteraction = useWireQuestion(controller, sessionId)
  const [contextOpen, setContextOpen] = useState(false)

  // Native projection baseline (context pressure / breakdown / permissions)
  // from the history tail page — the source of the context meter below and
  // the projection-backed permission switcher.
  const [projections, setProjections] = useState<TranscriptProjectionsShape | undefined>(undefined)
  // Bumped to force the shared config editor to re-read the model directory
  // (manual refresh / run-history changes).
  const [configReloadKey, setConfigReloadKey] = useState(0)

  // Opening the review page clears this execution's unread dot: its session's
  // content is now seen (mount-only — the page's identity is its execution).
  useEffect(() => {
    controller.markExecutionViewed(task.id, execution.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The conversation tail: shared transcript state (load / watermark-gated
  // poll / auto-follow / 滑到最新) — same mechanism as the linked panel.
  // The review page additionally reads the native projections riding the
  // tail page for its context meter.
  const {
    lines,
    error: transcriptError,
    atBottom: transcriptAtBottom,
    scrollRef: transcriptScrollRef,
    onScroll: onTranscriptScroll,
    jumpToBottom: jumpTranscript,
    reload: reloadTranscript,
  } = useTranscriptTail(
    controller,
    sessionId,
    current.executions.length,
    (result) => { setProjections(result.projections) },
  )

  /** Full refresh (manual 刷新 / after a config change): transcript + the
   *  shared config editor (via its reload key). */
  const reload = useCallback((): void => {
    reloadTranscript()
    setConfigReloadKey(key => key + 1)
  }, [reloadTranscript])

  // Re-read the session panel on open + whenever the task's run history
  // changes (a comment injected or settled) — the shared editor re-loads.
  useEffect(() => { setConfigReloadKey(key => key + 1) }, [current.executions.length, current.status])

  // The execution session is blocked on the user (approval / plan review /
  // question): surfaced live from the native session-list signal.
  const waiting = controller.pendingInteractionOf(sessionId)

  // The live state row (shared rail grammar): the run's own outcome chip +
  // its last activity time — a running run shows 进行中 + spinner.
  const session = sessionDisplay(current, execution, waiting)
  const sessionActive = session.state === 'running' || session.state === 'waiting'
  const stateChip = waiting !== undefined
    ? { kind: 'warn' as const, label: t(`waiting.${waiting}` as 'waiting.approval'), spinner: true }
    : session.state === 'succeeded'
      ? { kind: 'success' as const, label: t('detail.result.succeeded') }
      : session.state === 'failed'
        ? { kind: 'error' as const, label: t('detail.result.failed') }
        : session.state === 'cancelled'
          ? { kind: 'muted' as const, label: t('detail.result.cancelled') }
          : { kind: 'warn' as const, label: t('detail.result.running'), spinner: sessionActive }
  const updatedAt = formatDateTime(execution.endedAt ?? execution.startedAt)
  // The hint under the thread header: the blocking reason when there is one
  // (a done task rejects comments), the drive explanation otherwise.
  const hint = current.status === 'done' ? t('detail.commentQueuedDone') : undefined

  return (
    <SessionFrame
      title={current.title}
      ariaLabel={t('review.title')}
      actions={
        <>
          <Button size="sm" onClick={reload} title={t('review.refresh')}>
            {t('review.refresh')}
          </Button>
          {sessionId !== undefined && (
            <Button size="sm" onClick={() => { controller.openSession(sessionId) }}>
              {t('detail.viewSession')} →
            </Button>
          )}
        </>
      }
      main={
        <div
          className={css.reviewTranscriptScroll}
          ref={transcriptScrollRef}
          onScroll={onTranscriptScroll}
        >
          {sessionId === undefined ? (
            <p className={css.detailText}>{t('review.noSession')}</p>
          ) : (
            <SessionTranscript
              lines={lines}
              error={transcriptError}
              atBottom={transcriptAtBottom}
              jumpToBottom={jumpTranscript}
              waiting={waiting}
              before={
                <div className={css.reviewOutcome}>
                  <Chip kind={execution.result === 'failed' ? 'error' : execution.result === 'succeeded' ? 'success' : 'muted'}>
                    {execution.result === undefined ? t('detail.result.running') : t(`detail.result.${execution.result}` as 'detail.result.succeeded')}
                  </Chip>
                  <span className={css.reviewOutcomeMeta}>
                    {t('detail.executionEnded')} {execution.endedAt !== undefined ? formatDateTime(execution.endedAt) : '—'}
                  </span>
                </div>
              }
            />
          )}
        </div>
      }
      rail={
        <SessionRail
          context={context}
          contextOpen={contextOpen}
          onToggleContext={() => { setContextOpen(value => !value) }}
          stateChip={stateChip}
          updatedAt={updatedAt}
          sessionId={sessionId}
          controller={controller}
          projections={projections}
          lines={lines}
          onChanged={reload}
          reloadKey={configReloadKey}
          hint={hint}
          task={current}
          thread={comments}
          onCancelComment={id => controller.cancelComment(id)}
          interaction={pendingInteraction}
          composer={
            <SessionComposer
              controller={controller}
              taskId={current.id}
              sessionId={sessionId}
              placeholder={t('review.commentPlaceholder')}
              onDrive={text => controller.submitComment(current.id, execution.id, text, text.startsWith('/')) !== undefined}
              onSteer={text => sessionId === undefined
                ? Promise.resolve(false)
                : controller.steerComment(current.id, sessionId, text).then(result => result.ok)}
              onSteerImages={(text, refs) => sessionId === undefined
                ? Promise.resolve(false)
                : controller.steerCommentWithImages(current.id, sessionId, text, refs).then(result => result.ok)}
            />
          }
        />
      }
      onClose={onClose}
    />
  )
}
