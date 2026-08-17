/**
 * Shared transcript-tail component: the scrollable conversation tail with
 * auto-follow and the sticky "滑到最新" button. Used by the review page
 * and the refinement panel so every live session surface looks and behaves
 * identically.
 */
import type { BoardController } from '../../core/controller.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { TranscriptRow } from './ReviewDetail.tsx'
import { JumpToLatest, useTranscriptTail } from './use-transcript.ts'

/** A live conversation tail in its own scroll region. */
export function TranscriptTail({ controller, sessionId, maxLines, reloadKey, className }: {
  controller: BoardController
  /** The session whose tail to show (undefined = idle/empty). */
  sessionId: string | undefined
  /** How many trailing lines to render (default: all). */
  maxLines?: number
  /** A value whose change forces a full reload (e.g. execution count). */
  reloadKey?: unknown
  /** Extra class on the scroll container (e.g. the refinement panel's sizing). */
  className?: string
}) {
  const { lines, error, atBottom, scrollRef, onScroll, jumpToBottom } = useTranscriptTail(
    controller,
    sessionId,
    reloadKey,
  )
  const shown = lines === undefined ? undefined : maxLines === undefined ? lines : lines.slice(-maxLines)

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={`${css.reviewTranscriptScroll}${className !== undefined ? ` ${className}` : ''}`}
    >
      {error ? (
        <p className={css.detailText}>{t('review.transcriptUnavailable')}</p>
      ) : shown === undefined ? (
        <p className={css.detailText}>{t('review.loading')}</p>
      ) : shown.length === 0 ? (
        <p className={css.detailText}>{t('review.transcriptEmpty')}</p>
      ) : (
        <ul className={css.reviewTranscript}>
          {shown.map(line => line.kind === 'context' ? (
            <TranscriptRow key={line.id} kind="context" plugin={line.plugin} summary={line.summary} />
          ) : (
            <TranscriptRow key={line.id} kind="message" role={line.role} text={line.text} />
          ))}
        </ul>
      )}
      <JumpToLatest atBottom={atBottom} onJump={jumpToBottom} />
    </div>
  )
}
