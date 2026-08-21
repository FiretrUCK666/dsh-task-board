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
import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import { JumpToLatest, NEAR_BOTTOM_PX, useResizeFollow, useTranscriptTail } from './use-transcript.tsx'
import { Button, SendModeToggle } from './ui.tsx'
import { AttachmentStrip } from './AttachmentStrip.tsx'
import { admitDraftImages, type DraftImage } from './attach.ts'
import { useSessionContext, useWireQuestion } from './use-interaction.ts'
import { SessionContextBlock } from './SessionContextBlock.tsx'
import { InteractionCard } from './InteractionCard.tsx'

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

  // Composer is single-state now: one comment is one session-scoped message —
  // drive-mode rounds from this panel and comments from an execution review
  // page land in the same thread when they share this session.
  const cruiseOn = controller.getSnapshot().cruise.enabled
  // The session's own comment thread (the session-scoped model), live states.
  const thread = sessionCommentsOf(task, sessionId, cruiseOn)

  // The comment thread auto-follows its latest round (fingerprint-gated) and
  // scrolls in its OWN region — the rail head and the thread header stay
  // fixed, the list scrolls, and 跳到底 jumps to the newest comment. Same
  // mechanism as the execution review page: one comment rail grammar.
  const threadScrollRef = useRef<HTMLDivElement | null>(null)
  const [threadAtBottom, setThreadAtBottom] = useState(true)
  const threadAtBottomRef = useRef(true)
  useEffect(() => { threadAtBottomRef.current = threadAtBottom })
  useResizeFollow(threadScrollRef, threadAtBottomRef)
  const threadFingerprint = thread.map(view => `${view.round.id}:${view.state}`).join('|')
  useEffect(() => {
    const element = threadScrollRef.current
    if (element === null || !threadAtBottom) return
    element.scrollTop = element.scrollHeight
  }, [threadFingerprint, threadAtBottom])
  const onThreadScroll = (): void => {
    const element = threadScrollRef.current
    if (element === null) return
    setThreadAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX)
  }
  const jumpThread = (): void => {
    const element = threadScrollRef.current
    if (element === null) return
    element.scrollTop = element.scrollHeight
    setThreadAtBottom(true)
  }

  // Composer state: a failure keeps the draft so the user can retry. Draft
  // memory: the text survives switching away (shared with the execution review
  // page for this session) via the per-session comment draft slot; cleared on
  // a successful send. The native session drives it; a done task rejects.
  const [draft, setDraft] = useState<string>(() => draftStore.get(commentDraftKey(task.id, sessionId)) ?? '')
  const liveGone = row === undefined
  const taskDone = task.status === 'done'
  // Send mode: 排队 (dispatcher, default) vs 插话 (deliver now).
  const [steer, setSteer] = useState(false)
  const mentions = controller.sessionLabelsOf(task.id).map(({ sessionId, title }) => ({ id: sessionId, title }))
  // The open native interaction (plan confirm / question) + live to-do/goal/
  // subagents of the session.
  const context = useSessionContext(controller, sessionId)
  const pendingInteraction = useWireQuestion(controller, sessionId)
  const [contextOpen, setContextOpen] = useState(false)
  // Pending browser images to attach to the next comment.
  const [attachedImages, setAttachedImages] = useState<readonly DraftImage[]>([])

  const submit = (): void => {
    const text = draft.trim()
    if ((text === '' && attachedImages.length === 0) || liveGone || taskDone) return
    // Images go out immediately through the steer path — a picture belongs
    // to the current exchange, not a queue.
    if (attachedImages.length > 0) {
      void admitDraftImages(attachedImages).then(refs => {
        if (refs.length === 0) return
        void controller.steerCommentWithImages(task.id, sessionId, text, refs).then(result => {
          if (!result.ok) return
          setDraft('')
          setAttachedImages([])
          draftStore.clear(commentDraftKey(task.id, sessionId))
        })
      })
      return
    }
    // Send mode: 排队 = the dispatcher injects a session-anchored message round
    // (same queue as execution comments); 插话 = deliver straight to the native
    // session now (bypassing queue/budget/cruise), recorded as a settled
    // message round in the same thread. One message, two send modes.
    if (steer) {
      void controller.steerComment(task.id, sessionId, text).then(result => {
        if (!result.ok) return
        setDraft('')
        draftStore.clear(commentDraftKey(task.id, sessionId))
      })
      return
    }
    // A session-anchored comment round — same queue, same dispatcher, same
    // injection as an execution comment. A leading '/' is a slash command
    // through the native registry, matching the native composer and the review
    // page. Synchronous: the round is saved at once and the card's queue chip
    // + this thread reflect it.
    const round = controller.submitSessionComment(task.id, sessionId, text, text.startsWith('/'))
    if (round !== undefined) {
      setDraft('')
      draftStore.clear(commentDraftKey(task.id, sessionId))
    }
  }

  const stateChip = waiting !== undefined
    ? { kind: 'warn' as const, label: t(`waiting.${waiting}` as 'waiting.approval') }
    : row?.running === true
      ? { kind: 'warn' as const, label: t('detail.result.running') }
      : row?.completed === true
        ? { kind: 'success' as const, label: t('detail.linkedDone') }
        : undefined

  // The hint under the thread header, one branch per situation — never a
  // guessed bulk of nested ternaries inline in the JSX.
  let composerHint: ReactNode = null
  if (taskDone) {
    // A done task rejects comments — the hint explains how to release them.
    composerHint = t('detail.commentQueuedDone')
  } else if (liveGone) {
    composerHint = t('detail.sessionUnavailable')
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
          {/* The unified rail grammar (shared with the execution review
              page): session context first (above everything), then the
              session head, then the fixed thread header + hint, then the
              comment thread in its OWN scroll region (with 跳到底), then
              the pending interaction card, then the pinned composer. */}
          <SessionContextBlock context={context} open={contextOpen} onToggle={() => { setContextOpen(value => !value) }} />

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

          <div className={css.reviewThreadHeader}>
            <h4 className={css.reviewThreadTitle}>
              {t('review.comments')}
              <span className={css.reviewThreadCount}>{thread.length}</span>
            </h4>
          </div>
          {/* One quiet line under the header: the drive explanation in the
              normal case, the blocking reason (done task / gone session) in
              the exceptional case — never a stack of texts. */}
          <p className={css.detailHint}>{composerHint !== null ? composerHint : t('detail.sessionDriveHint')}</p>

          <div className={css.sessionRailScroll} ref={threadScrollRef} onScroll={onThreadScroll}>
            <CommentsThread
              task={task}
              views={thread}
              onCancel={id => controller.cancelComment(id)}
            />
            <JumpToLatest atBottom={threadAtBottom} onJump={jumpThread} />
          </div>

          {/* Pending native interaction (plan confirm / question). */}
          {pendingInteraction !== undefined && (
            <InteractionCard
              key={pendingInteraction.rpcId}
              question={pendingInteraction}
              sessionId={sessionId}
              controller={controller}
            />
          )}
          {/* The composer, pinned: one comment is one session-scoped message.
              Same visual rhythm and primary send button as the review page. */}
          <div className={css.reviewComposer}>
            <PromptInput
              value={draft}
              onChange={next => {
                setDraft(next)
                draftStore.set(commentDraftKey(task.id, sessionId), next)
              }}
              placeholder={t('detail.sessionDrivePlaceholder')}
              rows={3}
              controller={controller}
              mentions={mentions}
            />
            <div className={css.reviewComposerRow}>
              <AttachmentStrip images={attachedImages} onChange={setAttachedImages} />
              <SendModeToggle steer={steer} onChange={setSteer} />
              <Button
                variant="primary"
                disabled={(draft.trim() === '' && attachedImages.length === 0) || liveGone || taskDone}
                onClick={submit}
              >
                {t('review.commentSend')}
              </Button>
            </div>
          </div>
        </>
      }
      onClose={onClose}
    />
  )
}
