/**
 * Session detail: the linked-session panel opened by clicking a "链接会话"
 * row. It shares the exact shell (SessionFrame) and the full right-rail
 * experience (SessionRailHead: context meter + live config + session facts)
 * with the execution review page — one panel grammar for every session.
 *
 * The one deliberate difference is the composer semantics: this panel's
 * composer sends a message DIRECTLY to the native session (exactly as if
 * typed in its own conversation) — it never creates execution records,
 * never enters the task dispatcher and never changes task state, cruise,
 * chain or schedules. The distinction is stated plainly in the panel, and
 * driving the task stays with the execution records' comments.
 */
import { useState } from 'react'
import type { BoardController, TranscriptProjectionsShape } from '../../core/controller.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import { PromptInput } from './PromptInput.tsx'
import { formatDateTime } from './TaskCard.tsx'
import { TranscriptRow } from './ReviewDetail.tsx'
import { SessionFrame } from './SessionFrame.tsx'
import { SessionRailHead, SessionWaitingNotice } from './session-panel.tsx'
import { JumpToLatest, useTranscriptTail } from './use-transcript.tsx'
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
    sessionId,
    undefined,
    (result) => { setProjections(result.projections) },
  )

  // Direct-composer state: sending is immediate (no queue), a failure keeps
  // the draft so the user can retry.
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [sendError, setSendError] = useState<string | undefined>(undefined)
  const unavailable = row === undefined || !controller.directMessageAvailable()

  const submit = (): void => {
    const text = draft.trim()
    if (text === '' || busy || unavailable) return
    setBusy(true)
    setSendError(undefined)
    // The controller routes a leading '/' through the native command
    // registry (unknown commands fall back to plain text). Success is
    // "delivered to the native session" — the transcript poll then shows
    // the new turn.
    void controller.sendSessionMessage(sessionId, text).then(result => {
      setBusy(false)
      if (result.ok) {
        setDraft('')
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

  return (
    <SessionFrame
      title={row?.title ?? sessionId}
      badge={t('detail.sessionCountBadge', { n: String(controller.linkedOf(task).length) })}
      ariaLabel={t('detail.sessionPanel')}
      actions={
        <>
          <Button onClick={reload} title={t('review.refresh')}>
            {t('review.refresh')}
          </Button>
          <Button onClick={() => { controller.openSession(sessionId) }}>
            {t('detail.viewSession')} →
          </Button>
        </>
      }
      main={
        <div className={css.reviewTranscriptScroll} ref={scrollRef} onScroll={onScroll}>
          <SessionWaitingNotice waiting={waiting} />
          {transcriptError ? (
            <p className={css.detailText}>{t('review.transcriptUnavailable')}</p>
          ) : lines === undefined ? (
            <p className={css.detailText}>{t('review.loading')}</p>
          ) : lines.length === 0 ? (
            <p className={css.detailText}>{t('review.transcriptEmpty')}</p>
          ) : (
            <ul className={css.reviewTranscript}>
              {lines.map(line => line.kind === 'context' ? (
                <TranscriptRow
                  key={line.id}
                  kind="context"
                  plugin={line.plugin}
                  summary={line.summary}
                />
              ) : (
                <TranscriptRow
                  key={line.id}
                  kind="message"
                  role={line.role}
                  text={line.text}
                />
              ))}
            </ul>
          )}
          <JumpToLatest atBottom={atBottom} onJump={jumpToBottom} />
        </div>
      }
      rail={
        <>
          <div className={css.reviewRailHead}>
            {stateChip !== undefined && row !== undefined && (
              <div className={css.sessionFacts}>
                <Chip kind={stateChip.kind}>
                  {(row.running || waiting !== undefined) && <span className={css.spinner} aria-hidden="true" />}
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
            {/* The direct-message boundary, stated plainly: this composer
                talks to the native session; it does not drive the task. */}
            <p className={css.sessionReadonly}>{t('detail.sessionDirect')}</p>
            <div className={css.linkedActions}>
              <Button onClick={() => { controller.openSession(sessionId) }}>
                {t('detail.viewSession')} →
              </Button>
              <Button onClick={() => {
                controller.hideTaskRow(task.id, 'sessions', sessionId)
                onClose()
              }}>
                {t('detail.hide')}
              </Button>
              <Button variant="ghost" onClick={() => {
                controller.unbindTask(task.id)
                onClose()
              }}>
                {t('detail.linkedUnbind')}
              </Button>
            </div>
          </div>

          {/* The direct composer: same visual rhythm as the review page's
              composer, different semantics — a ghost send button, an
              explicit placeholder, no queue states. */}
          <div className={css.reviewComposer}>
            <PromptInput
              value={draft}
              onChange={setDraft}
              placeholder={t('detail.sessionComposerPlaceholder')}
              rows={3}
              controller={controller}
            />
            <div className={css.reviewComposerRow}>
              <Button
                variant="ghost"
                disabled={draft.trim() === '' || busy || unavailable}
                onClick={submit}
              >
                {t('detail.sessionSend')}
              </Button>
              {unavailable ? (
                <span className={css.reviewConfigMessage}>{t('detail.sessionUnavailable')}</span>
              ) : sendError !== undefined && (
                <span className={css.reviewConfigMessage}>{sendError}</span>
              )}
            </div>
          </div>
        </>
      }
      onClose={onClose}
    />
  )
}
