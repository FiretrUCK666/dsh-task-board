/**
 * Shared transcript-tail logic: load a session's recent history, page
 * backward on demand (the native "load earlier" grammar), poll the tail
 * lightly (watermark-gated, so an idle session costs nothing), and follow
 * the latest output while the user is at the bottom — with a "滑到最新"
 * escape when they scroll up. Used by the review page, the refinement
 * panel, and anywhere else a live session tail is shown, so every surface
 * behaves identically.
 *
 * EMPTY discipline (the 「刷新即暂无对话内容」 fix): the tail window is
 * message-aligned — a tail whose fold yields zero lines is a REAL empty
 * (nothing to show), and the hook says so at once. It never mistakes a
 * truncated window for an empty log, because the window NEVER truncates:
 * the reader asks for the tail and the host returns it whole; when the
 * host reports `hasMore`, the earlier pages stay reachable through
 * `loadEarlier`, never silently dropped.
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
 * The element that OWNS the scroll for a piece of content: the nearest
 * self-or-ancestor that DECLARES itself a scroll container (`overflow-y:
 * auto|scroll`), falling back to the region itself.
 *
 * Declared, not "currently scrollable": measuring `scrollHeight > clientHeight`
 * to decide makes the answer depend on how much text happens to be loaded, so
 * a short region escalated to an ANCESTOR and its "滑到最新" scrolled the whole
 * panel — the wrong range, and invisible until content grew. Ownership is a
 * layout fact (who was built to scroll), so a container-query width change
 * still needs no JS mode switch: the wide rail declares the comments box a
 * scroller, the narrow folds block does instead, and the same code finds the
 * right one in both.
 */
export function resolveScroller(element: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = element
  while (node !== null) {
    const style = getComputedStyle(node)
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') return node
    node = node.parentElement
  }
  return element
}

/** The watermark of a loaded result (tail seq; 0 when empty). Kept for the
 *  legacy settle path; the live poll/accumulate paths fold from state. */
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
  remountKey?: unknown,
  initialToBottom = true,
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
    // The initial pin is opt-out: a NARROW panel's comment fold re-mounts
    // when the user OPENS it, and the immediate scroll-to-bottom pushed the
    // fold HEAD off-screen (「一点开评论直接拉到底，要滑上去才能折叠」). A manual
    // open keeps the reader's position (initialToBottom: false); a forced open
    // (pending question) and every wide-panel surface keep the default pin.
    if (!initialToBottom) atBottomRef.current = false
    apply()
    return () => { observer.disconnect() }
  }, [scrollRef, remountKey, initialToBottom])
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
  /** When the scroll region itself UNMOUNTS and REMOUNTS (a fold that hides
   *  its children — the comments Disclosure), the observer + follow effects
   *  must re-bind to the NEW element; passing a value that changes with the
   *  fold (its open state) does that. */
  remountKey?: unknown,
  /** Whether a remount should pin to the bottom. A MANUAL open of the narrow
   *  comment fold passes false — the reader stays where they were (the head
   *  stays visible); a forced open (pending question) keeps true. */
  initialToBottom = true,
): { measure: () => void; jumpToBottom: () => void } {
  const atBottomRef = useRef(atBottom)
  useEffect(() => { atBottomRef.current = atBottom })
  useResizeFollow(scrollRef, atBottomRef, remountKey, initialToBottom)
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
  }, [scrollRef, changedKey, atBottom, remountKey])
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
  /** Whether the host holds messages older than the loaded window. */
  hasMore: boolean
  /** Whether an earlier page is being fetched right now. */
  loadingEarlier: boolean
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
  /** Prepend one earlier page above the current window (no-op at the floor). */
  loadEarlier: () => void
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
  const [events, setEvents] = useState<readonly TranscriptEventShape[] | undefined>(undefined)
  const [error, setError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // The accumulated window, oldest-first: the tail, then every earlier page
  // prepended ABOVE it (never appended — order is a layout fact). The floor
  // is the window's first seq; `hasMore` is the host's own flag.
  const floorRef = useRef<number | undefined>(undefined)
  const hasMoreRef = useRef(false)
  hasMoreRef.current = hasMore
  const watermarkRef = useRef<number | undefined>(undefined)
  // Alive guard: a late `.then` must never repaint a dead surface (the panel
  // can close while a read is still in flight).
  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])
  // The latest `onResult` identity, kept in a ref so `reload`/the poll stay
  // stable even when a consumer passes an inline callback (an unstable
  // callback must never re-trigger the load effect every render — that
  // would loop reloads and fight the user's scroll position).
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult
  const lines = events === undefined ? undefined : foldTranscript(events)
  // One follow mechanism (resolved scroller + capture listener + pinning).
  const { measure, jumpToBottom } = useFollowScroll(scrollRef, atBottom, setAtBottom, lines)

  /** Fold + publish a successful tail read (the reload AND the poll share
   *  it — one settlement grammar). */
  const settle = useCallback((result: { events: readonly TranscriptEventShape[]; hasMore: boolean; floorSeq?: number; projections?: TranscriptProjectionsShape }): void => {
    setError(false)
    const next = watermarkOf(result)
    setHasMore(result.hasMore === true)
    // A fresh tail REPLACES the window (reload / poll / session switch) —
    // earlier pages belong to the previous window and must not linger.
    floorRef.current = result.floorSeq
    watermarkRef.current = next
    setEvents([...result.events])
    onResultRef.current?.(result)
  }, [])

  /** Full reload: re-read the tail. A transient failure is not a dead end —
   *  the light poll keeps re-reading every 3s and ANY success clears the
   *  error (self-healing without a second retry mechanism). */
  const reload = useCallback((): void => {
    if (sessionId === undefined) return
    void controller.loadTranscript(sessionId).then(result => {
      if (!aliveRef.current) return
      if (result === undefined) {
        setError(true)
        return
      }
      settle(result)
    })
  }, [controller, sessionId, settle])

  // Load on open + whenever the reload key changes. A session switch resets
  // the window (no lines from the previous session may flash) and the floor.
  useEffect(() => {
    setEvents(undefined)
    setError(false)
    setHasMore(false)
    setLoadingEarlier(false)
    floorRef.current = undefined
    watermarkRef.current = undefined
    reload()
  }, [reload, reloadKey, sessionId])

  // Light poll at 3s while mounted; paused while the tab is hidden (the
  // native rhythm), with an immediate catch-up on return. ANY success also
  // clears a previous error — this is the tail's self-healing retry. The
  // poll NEVER replaces the window with a SHORTER tail: it only extends it
  // (append new events) or re-folds it, so a refresh can never flash
  // 「暂无对话内容」 over a loaded conversation.
  useEffect(() => {
    if (sessionId === undefined) return
    const poll = (): void => {
      void controller.loadTranscript(sessionId).then(result => {
        if (!aliveRef.current || result === undefined) return
        setError(false)
        setHasMore(result.hasMore === true)
        if (result.floorSeq !== undefined) floorRef.current = result.floorSeq
        const incoming = [...result.events]
        const watermark = incoming.length === 0 ? 0 : (incoming[incoming.length - 1]?.seq ?? incoming.length)
        setEvents(current => {
          if (current === undefined) {
            watermarkRef.current = watermark
            onResultRef.current?.(result)
            return incoming
          }
          const known = new Set<number>()
          for (const event of current) {
            if (event.seq !== undefined) known.add(event.seq)
          }
          let fresh = false
          const merged = [...current]
          for (const event of incoming) {
            if (event.seq === undefined || !known.has(event.seq)) {
              merged.push(event)
              fresh = true
            }
          }
          // New events (or the first load) re-fold; a same-watermark poll is
          // a no-op that keeps the reader's scroll position.
          if (fresh || watermarkRef.current === undefined) {
            watermarkRef.current = watermark
            onResultRef.current?.(result)
            return merged
          }
          return current
        })
      })
    }
    const timer = setInterval(poll, 3_000)
    const onVisibility = (): void => { if (!document.hidden) poll() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [controller, sessionId, settle])

  /** Prepend one earlier page above the window (the native "load earlier"
   *  grammar). Anchored: the scroller's offset from the BOTTOM is preserved
   *  (not scrollTop), so the reader stays on the same message instead of
   *  jumping to the top. At the floor, or without a page reader, a no-op. */
  const loadEarlier = useCallback((): void => {
    if (sessionId === undefined || loadingEarlier) return
    const floor = floorRef.current
    if (floor === undefined || !hasMoreRef.current) return
    setLoadingEarlier(true)
    void controller.loadTranscriptPage(sessionId, floor).then(page => {
      if (!aliveRef.current) return
      setLoadingEarlier(false)
      if (page === undefined) return
      const root = resolveScroller(scrollRef.current)
      const distance = root === null ? undefined : root.scrollHeight - root.scrollTop
      setEvents(current => {
        const known = new Set<number>()
        if (current !== undefined) {
          for (const event of current) {
            if (event.seq !== undefined) known.add(event.seq)
          }
        }
        const earlier = page.events.filter(event => event.seq === undefined || !known.has(event.seq))
        const merged = [...earlier, ...(current ?? [])]
        if (earlier.length > 0 || page.floorSeq !== floorRef.current) {
          if (page.floorSeq !== undefined) floorRef.current = page.floorSeq
          const watermark = merged.length === 0 ? 0 : (merged[merged.length - 1]?.seq ?? merged.length)
          watermarkRef.current = watermark
          return merged
        }
        return current ?? merged
      })
      setHasMore(page.hasMore === true)
      // Restore the reader's place AFTER paint (double rAF): the prepended
      // content grows the scroller above the viewport, and scrollTop alone
      // would leave the reader staring at older messages.
      if (root !== null && distance !== undefined) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            root.scrollTop = root.scrollHeight - distance
          })
        })
      }
    })
  }, [controller, sessionId, loadingEarlier])

  // Scroll measurement, bottom-following and the jump all live in
  // `useFollowScroll` above — one mechanism for every live list.

  return { lines, error, hasMore, loadingEarlier, atBottom, scrollRef, onScroll: measure, jumpToBottom, reload, loadEarlier }
}
