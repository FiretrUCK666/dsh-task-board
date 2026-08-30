/**
 * Shared transcript-tail logic: load a session's recent history, poll it
 * lightly (watermark-gated, so an idle session costs nothing), and follow
 * the latest output while the user is at the bottom — with a "滑到最新"
 * escape when they scroll up. Used by the review page, the refinement
 * panel, and anywhere else a live session tail is shown, so every surface
 * behaves identically.
 *
 * EVERY follow/anchor/jump action runs against the RESOLVED scroller (see
 * `resolveScroller`), never against the content region by assumption: a wide
 * panel scrolls its inner region, a narrow stacked panel scrolls the whole
 * body, and the same code must work on both. Hard-coding "the region is the
 * scroller" is what made mobile open a transcript at the TOP, hide the jump
 * pill forever, and force a manual drag through dozens of screens.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardController, TranscriptEventShape, TranscriptProjectionsShape } from '../../core/controller.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { foldTranscript, type TranscriptLine } from './review-transcript.ts'
import { Icon } from './ui.tsx'

/** How close to the bottom a scroll position counts as "at the latest". */
export const NEAR_BOTTOM_PX = 24

/**
 * The element that ACTUALLY scrolls for a piece of content: walk up from the
 * content region to the nearest ancestor that overflows vertically and has
 * overflow-y auto/scroll; fall back to the region itself. Pure DOM truth, so
 * a container-query width change (which moves the scroll from the inner
 * region to the panel body) needs no JS mode switch to follow.
 */
export function resolveScroller(element: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = element
  while (node !== null) {
    const style = getComputedStyle(node)
    const scrolls = style.overflowY === 'auto' || style.overflowY === 'scroll'
    if (scrolls && node.scrollHeight > node.clientHeight + 1) return node
    node = node.parentElement
  }
  return element
}

/** The watermark of a loaded result (tail seq; 0 when empty). */
function watermarkOf(result: { events: readonly TranscriptEventShape[] }): number {
  const tail = result.events[result.events.length - 1]
  return tail?.seq ?? result.events.length
}

/**
 * Keep a following scroll region pinned to its latest output whenever its
 * size changes — a ResizeObserver (registered a disposer) re-scrolls to the
 * bottom while the user is at the bottom. This also fires once on
 * registration, so a surface opened before its layout settles (e.g. the
 * review page's right rail grows as its async context meter / config load,
 * shrinking the comment thread) still lands on the latest. The observer
 * watches BOTH the content region and its resolved scroller, so a width
 * change that moves the scroll elsewhere is still covered. Content-driven
 * re-scrolls stay with the caller's follow effects; this only covers layout.
 */
export function useResizeFollow(
  scrollRef: React.RefObject<HTMLDivElement>,
  atBottomRef: React.MutableRefObject<boolean>,
): void {
  useEffect(() => {
    const content = scrollRef.current
    if (content === null) return
    const apply = (): void => {
      const root = resolveScroller(content)
      if (root !== null && atBottomRef.current) root.scrollTop = root.scrollHeight
    }
    const observer = new ResizeObserver(apply)
    observer.observe(content)
    const root = resolveScroller(content)
    if (root !== null && root !== content) observer.observe(root)
    apply()
    return () => { observer.disconnect() }
  }, [scrollRef])
}

/**
 * One FOLLOW mechanism, shared by every live list (transcript tail, comment
 * thread): measure and pin against the RESOLVED scroller, and see its scroll
 * events through a window-level capture listener (scroll does not bubble, but
 * it does run the capture phase from the window down). A surface therefore
 * keeps following, reporting and jumping correctly whether its own region
 * scrolls (wide panel) or an ancestor does (stacked narrow panel) — no
 * per-mode code, no mobile fork.
 */
export function useFollowScroll(
  scrollRef: React.RefObject<HTMLDivElement>,
  atBottom: boolean,
  setAtBottom: (value: boolean) => void,
  changedKey: unknown,
): { measure: () => void; jumpToBottom: () => void } {
  const atBottomRef = useRef(atBottom)
  useEffect(() => { atBottomRef.current = atBottom })
  useResizeFollow(scrollRef, atBottomRef)
  const measure = useCallback((): void => {
    const root = resolveScroller(scrollRef.current)
    if (root === null) return
    setAtBottom(root.scrollHeight - root.scrollTop - root.clientHeight < NEAR_BOTTOM_PX)
  }, [scrollRef, setAtBottom])
  useEffect(() => {
    const handler = (): void => measure()
    document.addEventListener('scroll', handler, true)
    return () => document.removeEventListener('scroll', handler, true)
  }, [measure])
  // Follow the latest content while at the bottom.
  useEffect(() => {
    const root = resolveScroller(scrollRef.current)
    if (root === null || !atBottom) return
    root.scrollTop = root.scrollHeight
  }, [scrollRef, changedKey, atBottom])
  const jumpToBottom = useCallback((): void => {
    const root = resolveScroller(scrollRef.current)
    if (root === null) return
    root.scrollTop = root.scrollHeight
    setAtBottom(true)
  }, [scrollRef, setAtBottom])
  return { measure, jumpToBottom }
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
    <button
      type="button"
      className={css.reviewJumpLatest}
      onClick={onJump}
      title={t('review.jumpLatest')}
      aria-label={t('review.jumpLatest')}
    >
      <Icon name="arrowDown" />
    </button>
  )
}

/** The transcript-tail state + controls a consumer binds to its scroll region. */
interface TranscriptTailState {
  /** Folded transcript lines; undefined while the first load is in flight. */
  lines: readonly TranscriptLine[] | undefined
  /** Whether the last load failed (the session/reader is unavailable). */
  error: boolean
  /** Whether the user is at (or near) the bottom of the scroll region. */
  atBottom: boolean
  /** Ref to attach to the content region (the scroller is resolved from it). */
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
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const watermarkRef = useRef<number | undefined>(undefined)
  // The latest `onResult` identity, kept in a ref so `reload`/the poll stay
  // stable even when a consumer passes an inline callback (an unstable
  // callback must never re-trigger the load effect every render — that
  // would loop reloads and fight the user's scroll position).
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult
  // One follow mechanism (resolved scroller + capture listener + pinning).
  const { measure, jumpToBottom } = useFollowScroll(scrollRef, atBottom, setAtBottom, lines)

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
      onResultRef.current?.(result)
    })
  }, [controller, sessionId])

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
        onResultRef.current?.(result)
      })
    }
    const timer = setInterval(poll, 3_000)
    const onVisibility = (): void => { if (!document.hidden) poll() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [controller, sessionId])

  // Scroll measurement, bottom-following and the jump all live in
  // `useFollowScroll` above — one mechanism for every live list.

  return { lines, error, atBottom, scrollRef, onScroll: measure, jumpToBottom, reload }
}
