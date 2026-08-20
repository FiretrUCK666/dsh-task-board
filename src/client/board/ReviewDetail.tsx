/**
 * Review page: one execution's review surface. Opened by clicking an
 * execution-history row, it shows the session's recent conversation
 * (the transcript tail, folded from raw history events following the
 * native harness rules) plus a live session panel — the execution
 * session's current model/reasoning effort (native models API), its
 * permission (switched through the native `/permission` command registry —
 * never a model turn), its real workspace/Agent facts (from the
 * session-list summary, read-only — an Agent cannot be switched here, the
 * native `agent-preset-locked` constraint is surfaced as read-only facts),
 * and the native context meter (occupancy percent + colored
 * system/tools/messages bar, straight from the `contextPressure`/
 * `contextBreakdown` projections the history tail page carries). When the
 * execution session is blocked on the user (approval / plan review /
 * question — the native sidebar wait signal), a waiting banner explains it
 * and points at "查看会话". The layout is two columns: the conversation
 * owns the full left height; a right rail holds a fixed head (meter,
 * config, session facts — always visible) above a fixed thread header
 * (title + count) and an independently scrolling comment list, with the
 * composer pinned at its bottom. The thread shows only the comments of the
 * execution being reviewed — each execution's page shows its own, the
 * injection queue stays task-level (a round's position is computed over the
 * whole task). Both the transcript and the comment list auto-follow the
 * latest output while at the bottom, with a "滑到最新" button when scrolled
 * up. A comment whose first character is '/' is a slash
 * command executed through the native command registry (unknown commands
 * fall back to plain text), exactly like the native composer. Transcript
 * and session data refresh while the panel is open (a lightweight 3s poll
 * gated on the projection watermark + manual refresh), so continuing the
 * conversation in the native session page shows up here. The native
 * session page remains the place for the full transcript ("查看会话");
 * this page never duplicates the full conversation view.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardController, TranscriptProjectionsShape } from '../../core/controller.ts'
import { type ExecutionRecord, type TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import { PromptInput } from './PromptInput.tsx'
import { formatDateTime } from './TaskCard.tsx'
import { CommentsThread } from './CommentsThread.tsx'
import { sessionCommentsOf } from './comment-thread.ts'
import { commentDraftKey, draftStore } from './drafts.ts'
import { JumpToLatest, NEAR_BOTTOM_PX, useResizeFollow, useTranscriptTail } from './use-transcript.tsx'
import { SessionFrame } from './SessionFrame.tsx'
import { SessionRailHead, SessionTranscript } from './session-panel.tsx'
import { AttachmentStrip } from './AttachmentStrip.tsx'
import { admitDraftImages, type DraftImage } from './attach.ts'
import { usePendingInteraction } from './use-interaction.ts'
import { InteractionCard } from './InteractionCard.tsx'
import { Button, SendModeToggle } from './ui.tsx'

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

  // The open native interaction (plan confirm / question), if any: the card
  // over the composer answers it in place.
  const pendingInteraction = usePendingInteraction(controller, sessionId)

  // Native projection baseline (context pressure / breakdown / permissions)
  // from the history tail page — the source of the context meter below and
  // the projection-backed permission switcher.
  const [projections, setProjections] = useState<TranscriptProjectionsShape | undefined>(undefined)
  // Bumped to force the shared config editor to re-read the model directory
  // (manual refresh / run-history changes).
  const [configReloadKey, setConfigReloadKey] = useState(0)
  const [draft, setDraft] = useState<string>(() => {
    // Draft memory: a comment typed here survives switching away and back —
    // the shared per-session slot (the linked panel for the same session
    // reads the same draft), cleared once the comment is actually sent.
    if (sessionId === undefined) return ''
    return draftStore.get(commentDraftKey(task.id, sessionId)) ?? ''
  })
  // Send mode: 排队 (dispatcher, default) vs 插话 (deliver now).
  const [steer, setSteer] = useState(false)
  // Pending browser images to attach to the next comment.
  const [attachedImages, setAttachedImages] = useState<readonly DraftImage[]>([])
  const mentions = controller.sessionLabelsOf(current.id).map(({ sessionId, title }) => ({ id: sessionId, title }))
  // The comment thread auto-follows its latest round (fingerprint-gated).
  const threadScrollRef = useRef<HTMLDivElement | null>(null)
  const [threadAtBottom, setThreadAtBottom] = useState(true)
  // The thread region's size depends on the async rail head (context meter /
  // config load after mount): a resize follower re-pins it to the latest
  // while at the bottom, and its initial callback lands the opened page on
  // the newest comment even when the layout settles after first paint.
  const threadAtBottomRef = useRef(true)
  useEffect(() => { threadAtBottomRef.current = threadAtBottom })
  useResizeFollow(threadScrollRef, threadAtBottomRef)
  // The comment-thread change fingerprint (id+state of every round): the
  // thread follow fires only on real comment changes — new saves, state
  // transitions — never on unrelated re-renders from the light poll.
  const threadFingerprint = comments.map(view => `${view.round.id}:${view.state}`).join('|')

  // Opening the review page clears this execution's unread dot: its session's
  // content is now seen (mount-only — the page's identity is its execution).
  useEffect(() => {
    controller.markExecutionViewed(task.id, execution.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The conversation tail: shared transcript state (load / watermark-gated
  // poll / auto-follow / 滑到最新) — same mechanism as the refinement panel.
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

  // The same follow for the comment list: new rounds and state transitions
  // scroll it to the newest comment while at the bottom.
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

  const submit = (): void => {
    const text = draft.trim()
    if (text === '' && attachedImages.length === 0) return
    // Images (if any) go out immediately through the steer path — a picture
    // must not sit in a queue, it belongs to the current exchange.
    if (attachedImages.length > 0) {
      if (sessionId === undefined) return
      void admitDraftImages(attachedImages).then(refs => {
        if (refs.length === 0) return
        void controller.steerCommentWithImages(current.id, sessionId, text, refs).then(result => {
          if (!result.ok) return
          setDraft('')
          setAttachedImages([])
          draftStore.clear(commentDraftKey(current.id, sessionId))
        })
      })
      return
    }
    // Send mode: 排队 = the dispatcher injects it (default); 插话 = deliver
    // straight to the session now, bypassing queue/budget/cruise.
    if (steer) {
      if (sessionId === undefined) return
      void controller.steerComment(current.id, sessionId, text).then(result => {
        if (!result.ok) return
        setDraft('')
        draftStore.clear(commentDraftKey(current.id, sessionId))
      })
      return
    }
    // A draft whose first non-space character is '/' is a slash command,
    // exactly like the native composer: it executes through the host command
    // registry (unknown commands fall back to plain text). Plain prompts
    // never start with '/', so nothing user-typed is misrouted.
    const round = controller.submitComment(current.id, execution.id, text, text.startsWith('/'))
    if (round !== undefined) {
      setDraft('')
      if (sessionId !== undefined) draftStore.clear(commentDraftKey(current.id, sessionId))
    }
  }

  // The execution session is blocked on the user (approval / plan review /
  // question): surfaced live from the native session-list signal.
  const waiting = controller.pendingInteractionOf(sessionId)

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

          {/* The context meter note: rendered in the right rail below. */}
            </div>
      }
      rail={
        <>
          {/* Right rail: the shared session head (context meter + live config
              + session facts — always visible no matter how long the comment
              thread grows), then the comment thread in its own scroll region,
              and the composer pinned at the rail's bottom. */}
          <div className={css.sessionRailHead}>
          <SessionRailHead
            sessionId={sessionId}
            controller={controller}
            projections={projections}
            lines={lines}
            onChanged={reload}
            reloadKey={configReloadKey}
          />
            </div>

            {/* The thread header: title + count, fixed — the count never
                scrolls away no matter how long the comment list grows. */}
            <div className={css.reviewThreadHeader}>
              <h4 className={css.reviewThreadTitle}>
                {t('review.comments')}
                <span className={css.reviewThreadCount}>{comments.length}</span>
              </h4>
            </div>

            {/* The comment list scrolls in its own region below the header;
                the rail head and the count above stay visible. Saved or queued
                rounds (not yet injected) can be cancelled; injected ones show
                their live state. New rounds follow while at the bottom. */}
            <div className={css.sessionRailScroll} ref={threadScrollRef} onScroll={onThreadScroll}>
            <CommentsThread
              task={current}
              views={comments}
              onCancel={id => controller.cancelComment(id)}
            />
            <JumpToLatest atBottom={threadAtBottom} onJump={jumpThread} />
            </div>

            {/* Pending native interaction (plan confirm / question): the
                card rides the composer so the user answers in place. */}
            {pendingInteraction !== undefined && sessionId !== undefined && (
              <InteractionCard
                interaction={pendingInteraction}
                taskId={current.id}
                sessionId={sessionId}
                controller={controller}
              />
            )}
            {/* The composer, pinned at the rail's bottom: a comment continues
                the conversation in-session. It shares the prompt autocomplete
                with the task form — the same live slash catalog, so commands
                and skills never drift. */}
            <div className={css.reviewComposer}>
              <PromptInput
                value={draft}
                onChange={next => {
                  setDraft(next)
                  if (sessionId !== undefined) draftStore.set(commentDraftKey(current.id, sessionId), next)
                }}
                placeholder={t('review.commentPlaceholder')}
                rows={3}
                controller={controller}
                mentions={mentions}
              />
              <div className={css.reviewComposerRow}>
                <AttachmentStrip images={attachedImages} onChange={setAttachedImages} />
                <SendModeToggle steer={steer} onChange={setSteer} />
                <Button variant="primary" disabled={draft.trim() === '' && attachedImages.length === 0} onClick={submit}>
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
