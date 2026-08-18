/**
 * Session detail: the linked-session panel opened by clicking a "链接会话"
 * row. It shares the exact shell of the execution review page (SessionFrame
 * + the same live transcript tail), so both families feel like one system —
 * but it is READ-ONLY BY CONSTRUCTION: no comment composer, no drive
 * affordances. The bound session is a live view of the native conversation;
 * only the execution records can be driven by comments (and auto-cruise),
 * and the panel says so explicitly. The rail carries the session's facts,
 * live status and the only actions it supports: view / hide / unbind.
 */
import type { BoardController } from '../../core/controller.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import { formatDateTime } from './TaskCard.tsx'
import { TranscriptRow, workspaceLabelOf } from './ReviewDetail.tsx'
import { SessionFrame } from './SessionFrame.tsx'
import { JumpToLatest, useTranscriptTail } from './use-transcript.tsx'
import { Button, Notice } from './ui.tsx'

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
  // then degrades to the raw id and the facts that remain).
  const row = controller.linkedOf(task).find(candidate => candidate.sessionId === sessionId)
  const waiting = row?.pendingInteraction
  // The session's real workspace + composed Agent (same facts as the review
  // page's rail).
  const sessionInfo = controller.sessionInfo(sessionId)
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
  } = useTranscriptTail(controller, sessionId)

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
      badge={t('detail.sessionBadge')}
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
          {waiting !== undefined && (
            <Notice chip={t('review.waiting')}>
              {t('review.waitingTitle', { kind: t(`waiting.${waiting}` as 'waiting.approval') })}
            </Notice>
          )}
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
          {sessionInfo !== undefined && (
            <div className={css.reviewSessionFacts}>
              <span className={css.reviewSessionFact}>
                <span className={css.reviewSessionFactLabel}>{t('review.sessionWorkspace')}</span>
                <span
                  className={css.reviewSessionFactValue}
                  title={sessionInfo.cwd ?? undefined}
                >
                  {sessionInfo.cwd !== undefined ? workspaceLabelOf(sessionInfo.cwd) : t('review.sessionUnknown')}
                </span>
              </span>
              <span className={css.reviewSessionFact}>
                <span className={css.reviewSessionFactLabel}>{t('review.sessionAgent')}</span>
                <span className={css.reviewSessionFactValue}>
                  {sessionInfo.agentPreset !== undefined ? sessionInfo.agentPreset : t('review.sessionDefaultAgent')}
                </span>
              </span>
            </div>
          )}
          {/* The read-only boundary, stated plainly: this is a live view, not
              an execution — comments here do not (and cannot) drive the
              task. The absence of a composer is the structural half; this
              line is the explicit half. */}
          <p className={css.sessionReadonly}>{t('detail.sessionReadonly')}</p>
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
      }
      onClose={onClose}
    />
  )
}
