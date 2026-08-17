/**
 * Shared transcript-tail logic: load a session's recent history, poll it
 * lightly (watermark-gated, so an idle session costs nothing), and follow
 * the latest output while the user is at the bottom — with a "滑到最新"
 * escape when they scroll up. Used by the review page, the refinement
 * panel, and anywhere else a live session tail is shown, so every surface
 * behaves identically.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardController, TranscriptEventShape, TranscriptProjectionsShape } from '../../core/controller.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { foldTranscript, type TranscriptLine } from './review-transcript.ts'

/** How close to the bottom a scroll position counts as "at the latest". */
export const NEAR_BOTTOM_PX = 24

/** The watermark of a loaded result (tail seq; 0 when empty). */
function watermarkOf(result: { events: readonly TranscriptEventShape[] }): number {
  const tail = result.events[result.events.length - 1]
  return tail?.seq ?? result.events.length
}

/**
 * The sticky "滑到最新" affordance shown in a scroll region (transcript or
 * comment thread) when the user has scrolled away from the bottom: one click
 * returns to the latest output. Hidden while the region is at the bottom,
 * where new content already auto-follows.
 */
export function JumpToLatest({ atBottom, onJump }: { atBottom: boolean; onJump: () => void }) {
  if (atBottom) return null
  return (
    <button type="button" className={css.reviewJumpLatest} onClick={onJump}>
      <svg className={css.reviewJumpLatestIcon} viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 6.5 8 11.5 13 6.5" />
      </svg>
      {t('review.jumpLatest')}
    </button>
  )
}

/** The transcript-tail state + controls a consumer binds to its scroll region. */
export interface TranscriptTailState {
  /** Folded transcript lines; undefined while the first load is in flight. */
  lines: readonly TranscriptLine[] | undefined
  /** Whether the last load failed (the session/reader is unavailable). */
  error: boolean
  /** Whether the user is at (or near) the bottom of the scroll region. */
  atBottom: boolean
  /** Ref to attach to the scroll container. */
  scrollRef: React.RefObject<HTMLDivElement>
  /** The scroll handler to attach to the container (updates `atBottom`). */
  onScroll: () => void
  /** Scroll to the latest output and resume following. */
  jumpToBottom: () => void
  /** Reload immediately (e.g. after a comment was injected). */
  reload: () => void
}

/**
 * Manage one live transcript tail.
 * @param controller - the board controller (transcript reader).
 * @param sessionId - the session whose tail to show (undefined = idle).
 * @param reloadKey - a value whose change forces a full reload (e.g. the
 *   execution list length, so an injected/settled round refreshes at once).
 * @param onResult - optional callback with every load result (e.g. the
 *   review page reads the native projections riding the tail page).
 */
export function useTranscriptTail(
  controller: BoardController,
  sessionId: string | undefined,
  reloadKey: unknown = undefined,
  onResult?: (result: { events: readonly TranscriptEventShape[]; projections?: TranscriptProjectionsShape }) => void,
): TranscriptTailState {
  const [lines, setLines] = useState<readonly TranscriptLine[] | undefined>(undefined)
  const [error, setError] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null!)
  const watermarkRef = useRef<number | undefined>(undefined)

  /** Full reload: re-read the tail and reset the watermark. */
  const reload = useCallback((): void => {
    if (sessionId === undefined) return
    void controller.loadTranscript(sessionId).then(result => {
      if (result === undefined) {
        setError(true)
        return
      }
      setError(false)
      watermarkRef.current = watermarkOf(result)
      setLines(foldTranscript(result.events))
      onResult?.(result)
    })
  }, [controller, sessionId, onResult])

  // Load on open + whenever the reload key changes.
  useEffect(() => { reload() }, [reload, reloadKey])

  // Light poll at 3s while mounted; paused while the tab is hidden (the
  // native rhythm), with an immediate catch-up on return.
  useEffect(() => {
    if (sessionId === undefined) return
    const poll = (): void => {
      void controller.loadTranscript(sessionId).then(result => {
        if (result === undefined || watermarkRef.current === watermarkOf(result)) return
        watermarkRef.current = watermarkOf(result)
        setError(false)
        setLines(foldTranscript(result.events))
        onResult?.(result)
      })
    }
    const timer = setInterval(poll, 3_000)
    const onVisibility = (): void => { if (!document.hidden) poll() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [controller, sessionId, onResult])

  // Follow the latest output while the user is at the bottom.
  useEffect(() => {
    const element = scrollRef.current
    if (element === null || !atBottom) return
    element.scrollTop = element.scrollHeight
  }, [lines, atBottom])

  const onScroll = (): void => {
    const element = scrollRef.current
    if (element === null) return
    setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX)
  }

  const jumpToBottom = (): void => {
    const element = scrollRef.current
    if (element === null) return
    element.scrollTop = element.scrollHeight
    setAtBottom(true)
  }

  return { lines, error, atBottom, scrollRef, onScroll, jumpToBottom, reload }
}
