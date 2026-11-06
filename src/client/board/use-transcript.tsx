/**
 * Shared transcript-tail logic: load a session's recent history, page
 * backward on demand (the native "load earlier" grammar), poll the tail
 * lightly (watermark-gated, so an idle session costs nothing), and follow
 * the latest output while the user is at the bottom — with a "滑到最新"
 * escape when they scroll up. Used by the review page and
 * anywhere else a live session tail is shown, so every surface
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
 *
 * ── SCROLL POSITION IS NOT PANEL STATE ───────────────────────────────────────
 *
 * Whether the reader is at the end used to be a `useState` living in the panel
 * (`ReviewDetail` / `SessionDetail` / `SessionRail`). Every crossing therefore
 * re-rendered a whole panel — and the recorded artifact says what one such
 * re-render costs: 40 rounds of transcript plus 40 comments is 928 nodes, and
 * rebuilding them measures 17.8 ms median / 22.3 ms worst (one frame budget is
 * 16.7 ms). So the frame the reader spends scrolling away from the end is a
 * frame that cannot be painted: 「在底部往上一滑，画面会瞬间卡一下」.
 *
 * The two questions were also never the same question:
 *
 *   · 「还要不要继续跟随新内容」 — answered every frame, must cost a subtraction
 *     and nothing else. It is a REF (`pinnedRef`), and it flips on a tight
 *     `FOLLOW_SLACK_PX` line.
 *   · 「那个『滑到最新』胶囊现在该不该显示」 — a VISUAL fact with hysteresis, read
 *     only by the pill. It is delivered to the pill alone, through a
 *     subscription (`ScrollPin`), so a crossing re-renders one button instead
 *     of the panel.
 *
 * Keeping them apart is what makes a scroll re-render nothing at all.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { BoardController, TranscriptEventShape, TranscriptProjectionsShape } from '../../core/controller.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { foldTurns, type TranscriptTurn } from './review-transcript.ts'
import { Icon } from '../design/ui.tsx'

/** How close to the end a scroll position counts as "要显示滑到最新" — the pill's
 *  ENTER line, and nothing else. */
export const NEAR_BOTTOM_PX = 24
/** How much clearance it takes to LEAVE — see the hysteresis note on `measure`. */
export const LEAVE_BOTTOM_PX = 120
/**
 * How close to the end a scroll position counts as "still following".
 *
 * Deliberately a SEPARATE, much tighter line than the pill's. This one answers a
 * mechanical question asked on every frame (「这一帧该不该把读者拽到末尾」) and
 * its only cost may be a subtraction. Eight pixels is wider than sub-pixel
 * jitter and narrower than any deliberate flick: a reader who has moved even a
 * few pixels up has left the end, and nothing may pull them back.
 */
export const FOLLOW_SLACK_PX = 8

/**
 * How to reach one live scroll region's tail: jump to it, or watch whether the
 * pill should show. `visible` is a SNAPSHOT function (not a captured boolean)
 * because it is read through `useSyncExternalStore` — a captured value would be
 * stale by the time the subscription reports a change.
 */
export interface ScrollPin {
  /** Subscribe to pill-visibility changes. Returns the disposer. */
  subscribe(listener: () => void): () => void
  /** Whether the 「滑到最新」 pill should show right now. */
  visible(): boolean
  /** Scroll to the end and resume following. */
  jump(): void
  /**
   * Put the reader back `distance` px from the end after content was PREPENDED
   * above the viewport (the "加载更早" grammar), and refresh the geometry cache.
   *
   * It belongs here rather than at the call site because the pin owns both the
   * scroller's offset and the cached maximum: a write from outside would leave
   * the cache describing the pre-page geometry, and the next measure would then
   * read a distance that is wrong by exactly the page's height.
   */
  anchor(distance: number): void
}

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
 * The largest offset a scroller can hold — **the only read of that geometry in this
 * module**.
 *
 * `scrollHeight` and `clientHeight` force layout, so every caller of this function is
 * a caller that has decided its moment is one where geometry may have changed: mount,
 * a resize notification, a page prepend, a click. A scroll gesture is not one of those,
 * and `measure` (the only per-frame reader) uses the cached value instead.
 */
function maxScrollOf(root: HTMLElement): number {
  return Math.max(0, root.scrollHeight - root.clientHeight)
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
 *
 * `maxScroll` is the caller's geometry cache: the observer ALREADY runs inside
 * the engine's layout pass, so reading `scrollHeight` here is free and it is the
 * one place allowed to refresh that cache.
 */
export function useResizeFollow(
  scrollRef: React.RefObject<HTMLDivElement>,
  pinnedRef: React.MutableRefObject<boolean>,
  maxScroll: React.MutableRefObject<number>,
  remountKey?: unknown,
): void {
  useEffect(() => {
    const content = scrollRef.current
    if (content === null) return
    /* A ResizeObserver fires on every content growth, including the growth a
     * scroll causes when a page of history is prepended. Writing an out-of-range
     * `scrollHeight` here asks the browser to clamp on every one of those, and the
     * clamp is indistinguishable from a small jump. Write the clamped target, and
     * only when the scroller is not already sitting on it. */
    const apply = (): void => {
      const root = resolveScroller(content)
      if (root === null) return
      maxScroll.current = maxScrollOf(root)
      if (!pinnedRef.current) return
      const target = maxScroll.current
      if (Math.abs(root.scrollTop - target) < 1) return
      root.scrollTop = target
    }
    const observer = new ResizeObserver(apply)
    observer.observe(content)
    const root = resolveScroller(content)
    if (root !== null && root !== content) observer.observe(root)
    apply()
    return () => { observer.disconnect() }
  }, [scrollRef, pinnedRef, maxScroll, remountKey])
}

/**
 * One FOLLOW mechanism, shared by every live list (transcript tail, comment
 * thread): measure and pin against the RESOLVED scroller, and see its scroll
 * events through a listener ON that scroller (scroll does not bubble, and a
 * capture listener on `window` would run for every scroll on the page). A
 * surface therefore keeps following and jumping correctly whether its own
 * region scrolls (wide panel) or an ancestor does (stacked narrow panel) — no
 * per-mode code, no mobile fork.
 *
 * It rations out THREE facts with three different costs, and mixing them up is
 * what made this panel feel heavy:
 *
 *   · `pinnedRef` — keep following? Written on every measure, read by the follow
 *     effects. NEVER a state: a scroll must not re-render anything.
 *   · the pill's visibility — a visual fact with hysteresis, delivered through
 *     `subscribe` to the pill alone.
 *   · the geometry cache (`maxScroll`) — refreshed only where geometry changes.
 */
export function useFollowScroll(
  scrollRef: React.RefObject<HTMLDivElement>,
  changedKey: unknown,
  /** When the scroll region itself UNMOUNTS and REMOUNTS (a fold that hides
   *  its children — the comments Disclosure), the observer + follow effects
   *  must re-bind to the NEW element; passing a value that changes with the
   *  fold (its open state) does that. */
  remountKey?: unknown,
): ScrollPin {
  /* ── NO FORCED LAYOUT IN THE SCROLL PATH ──────────────────────────────────
   *
   * The recorded trace of this panel showed **5,051 ms of unattributed main-thread
   * time** — Chrome could not attribute it to any function, which is what forced
   * layout looks like — on top of 2,031 ms rendering and 1,508 ms painting.
   *
   * The cause sat in this handler:
   *
   *     root.scrollHeight - root.scrollTop - root.clientHeight
   *
   * `scrollHeight` and `clientHeight` are LAYOUT reads: asking for them makes the
   * engine finish every pending style and layout job first. Doing that once per
   * animation frame during a gesture means the main thread can never get ahead.
   *
   * `scrollTop` is NOT a layout read — it is a stored offset the engine already
   * has. So the two expensive values are cached here and refreshed only when the
   * geometry can actually have changed: the element resizes, its content resizes,
   * or the region remounts. Between those moments, a scroll measurement is one
   * cheap read and a subtraction.
   *
   * This is the whole difference between "measure on every frame" and "measure on
   * every geometry change", and geometry changes are not what a scroll gesture is. */
  const maxScroll = useRef<number>(0)
  /* THE FOLLOW GATE — the only thing the follow effects ask.
   *
   * It flips on `FOLLOW_SLACK_PX`, NOT on the pill's hysteresis, and the
   * difference is not cosmetic: with the pill's 120px leave-line a reader who has
   * scrolled 100px up is still 「在底部」, so an arriving round (the 3-second poll
   * makes one arrive often) would yank them back to the end mid-read — 「滑动条
   * 也跟着卡一下」. Eight pixels is the honest answer to 「他还在末尾吗」. */
  const pinnedRef = useRef(true)
  /* THE PILL'S ANSWER, and it leaves through a subscription rather than a state:
   * see the module doc. `visibleRef` is the snapshot; `listeners` is who to tell. */
  const visibleRef = useRef(false)
  const listeners = useRef(new Set<() => void>())

  const publish = useCallback((next: boolean): void => {
    if (next === visibleRef.current) return
    visibleRef.current = next
    for (const listener of listeners.current) listener()
  }, [])
  /* HYSTERESIS, because a single threshold makes the pill flicker.
   *
   * Entering and leaving used ONE 24px line. A reader resting near the end
   * crosses it on almost every wheel tick, and each crossing flips the pill —
   * which, before this was a subscription, re-rendered the whole panel. On a long
   * conversation that is a render per scroll event: the recorded trace shows INP
   * 286ms with the JS row filled end to end, and the report is 「滑到底往上拉就卡」.
   *
   * Two thresholds instead of one. Coming TO the end still needs 24px, so the
   * pill appears as promptly as it did; leaving requires a full `LEAVE_BOTTOM_PX`
   * of clearance, so ordinary tremor around the end cannot toggle it at all. */
  const measure = useCallback((): void => {
    const root = resolveScroller(scrollRef.current)
    if (root === null) return
    // `scrollTop` only — see the note on `maxScroll`. No layout is read here.
    const distance = maxScroll.current - root.scrollTop
    pinnedRef.current = distance < FOLLOW_SLACK_PX
    // The pill keeps its own hysteresis, unchanged: it appears once the reader is
    // a comfortable 120px away and comes back as soon as they are within 24px.
    // Nothing is rendered for the pin, so these two lines cost a subtraction each.
    const wasVisible = visibleRef.current
    publish(wasVisible ? distance >= LEAVE_BOTTOM_PX : distance >= NEAR_BOTTOM_PX)
  }, [scrollRef, publish])
  /* THE LISTENER BELONGS TO THE SCROLLER, NOT TO THE DOCUMENT.
   *
   * It used to sit on `document` in the CAPTURE phase, so it ran for every scroll
   * of every scroller on the page — and each run read three layout properties
   * (`scrollHeight`, `scrollTop`, `clientHeight`). Chrome cannot take its fast
   * path for a capture-phase scroll listener that reads layout: it has to
   * synchronise with the main thread around the gesture before it can commit the
   * frame. A reader feels exactly that as 「滚了，等一下才动」 — and it happens
   * regardless of how little content is on screen, because the cost is the
   * synchronisation, not the content.
   *
   * The question this listener answers is only about ITS OWN scroller — 「is this
   * pinned to the end」 — so it belongs on that element. Every other scroll
   * (another panel, the sidebar, a dialog) stops paying for it.
   *
   * Still coalesced to one measurement per frame: a wheel gesture delivers many
   * scroll events, and the answer cannot change twice between two paints. */
  useEffect(() => {
    const root = resolveScroller(scrollRef.current)
    if (root === null) return
    /* THE GEOMETRY CACHE, filled where geometry can change and read nowhere else.
     *
     * `scrollHeight` and `clientHeight` force layout; this effect runs on mount and
     * whenever `remountKey` changes (the region was rebuilt). A ResizeObserver below
     * refreshes it for in-place growth — a new round arriving, an image decoding, a
     * fold opening. Those are the only moments the maximum offset can move, and
     * none of them is a scroll. */
    maxScroll.current = maxScrollOf(root)

    let frame: number | undefined
    const handler = (): void => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        measure()
      })
    }
    root.addEventListener('scroll', handler, { passive: true })
    /* Content growth: refresh the cached maximum off the scroll path entirely. The
     * observer's own callback is a good place for a layout read — it already runs
     * as part of the engine's layout pass, so the values are current and asking for
     * them forces nothing. */
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        maxScroll.current = maxScrollOf(root)
      })
      observer.observe(root)
      if (root.firstElementChild !== null) observer.observe(root.firstElementChild)
    }
    return () => {
      root.removeEventListener('scroll', handler)
      if (frame !== undefined) cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [measure, scrollRef, remountKey])
  useResizeFollow(scrollRef, pinnedRef, maxScroll, remountKey)
  /* Follow the latest content while pinned — and ONLY when it moved.
   *
   * Two things were wrong here, and together they read as a bounce at the end:
   *
   *  · `scrollTop = scrollHeight` over-assigns by design: scrollTop is clamped to
   *    `scrollHeight - clientHeight`, so the browser has to clamp a value that is
   *    already out of range. Assigning the clamped value directly is the same
   *    result without the wasted write.
   *  · The effect re-ran on every `changedKey`, including the ones a reader causes
   *    by scrolling to the end themselves. A write that moves the offset by zero
   *    still forces a scroll update, and Chromium's own anchoring correction can
   *    answer it — which is the 「滑到底就弹一下」 the report describes.
   *
   * So: compute the target from the cache, and do nothing when the scroller is
   * already there. The gate is read from the ref, so a reader who has moved up a
   * few pixels is never pulled back — and this effect no longer depends on any
   * render state at all. */
  useEffect(() => {
    const root = resolveScroller(scrollRef.current)
    if (root === null || !pinnedRef.current) return
    /* Content changed, so the cached maximum is stale: refresh it here, off the
     * scroll path. This runs per new round / per page, not per gesture. */
    maxScroll.current = maxScrollOf(root)
    const target = maxScroll.current
    if (Math.abs(root.scrollTop - target) < 1) return
    root.scrollTop = target
  }, [scrollRef, changedKey, remountKey])
  const jump = useCallback((): void => {
    const root = resolveScroller(scrollRef.current)
    if (root === null) return
    // A click, not a gesture: one layout read here is the right trade (the offset
    // must be exact), and it keeps the cache honest for the scroll that follows.
    maxScroll.current = maxScrollOf(root)
    root.scrollTop = maxScroll.current
    pinnedRef.current = true
    publish(false)
  }, [scrollRef, publish])
  const subscribe = useCallback((listener: () => void): (() => void) => {
    listeners.current.add(listener)
    return () => { listeners.current.delete(listener) }
  }, [])
  const visible = useCallback((): boolean => visibleRef.current, [])
  const anchor = useCallback((distance: number): void => {
    const root = resolveScroller(scrollRef.current)
    if (root === null) return
    // Geometry moved with the prepend, so the cache and the offset are refreshed in
    // the same breath: one layout read, and the next measure reads a maximum that is
    // true rather than one describing the pre-page geometry. The reader keeps the SAME
    // distance from the end, which is where they were looking.
    const height = root.scrollHeight
    maxScroll.current = Math.max(0, height - root.clientHeight)
    root.scrollTop = Math.max(0, height - distance)
  }, [scrollRef])
  return { subscribe, visible, jump, anchor }
}

/**
 * The frame a session scroll region lives in: the scroller as its only flexible
 * child, and the 「滑到最新」 pill as a SIBLING of that scroller.
 *
 * Why a sibling, in one sentence: `position: absolute` against a box that SCROLLS
 * still rides that box's scroll offset, so a pill declared against the scroller
 * leaves the screen exactly when it is supposed to appear. Measured in
 * `scripts/probes/probe-pill-anchor.{cjs,js}` (three placements x three offsets):
 * against the scroller it sat at `topInBox: 203` at scrollTop 0 and at `-292`
 * half-way down; against a wrapper that does not scroll, `topInBox` is constant
 * and it stays visible at every offset.
 *
 * It is a component rather than three lines copied into each surface for the
 * usual reason: the containing block is a LAYOUT fact, and a second copy of it is
 * a second place that can silently stop being one.
 */
export function TailFrame({ pin, children }: { pin: ScrollPin; children: ReactNode }) {
  return (
    <div className={css.sessionScrollFrame}>
      {children}
      <TailPill pin={pin} />
    </div>
  )
}

/**
 * The floating "滑到最新" affordance shown in a scroll region (transcript or
 * comment thread) when the reader has scrolled away from the end: one click
 * returns to the latest output. Hidden while the region is at the end, where new
 * content already auto-follows.
 *
 * It reads the pin THROUGH A SUBSCRIPTION (`useSyncExternalStore`), so a
 * crossing re-renders this one button — not the list, not the composer, not the
 * panel around it.
 *
 * Not exported: `TailFrame` is the only way in, because the pill's containing
 * block is the frame — rendering the pill without its frame is what put it inside
 * a scroller in the first place.
 */
function TailPill({ pin }: { pin: ScrollPin }) {
  const atBottom = !useSyncExternalStore(pin.subscribe, pin.visible)
  /* THE BUTTON KEEPS ITS SPACE WHEN IT IS NOT USABLE.
   *
   * It is a real layout element in the scroll content (absolute, 26px tall). The
   * version that unmounted it at the end shortened the content by its own height
   * — and that is exactly when the reader has just arrived at the end, so the
   * browser re-clamped scrollTop and the view sprang a few pixels. 「拖到底就弹一下，
   * 几像素，像吸一下」, and it appeared on both scrollers because both render this
   * one component.
   *
   * So it stays mounted and keeps occupying its space; only its ink and its
   * hit-target go away. `visibility` is the correct hiding tool here precisely
   * because it preserves layout, and `disabled` keeps a control nobody can see
   * from being focusable or clickable through another route. */
  return (
    <button
      type="button"
      className={css.reviewJumpLatest}
      data-hidden={atBottom ? 'true' : undefined}
      disabled={atBottom}
      aria-hidden={atBottom}
      tabIndex={atBottom ? -1 : undefined}
      onClick={atBottom ? undefined : pin.jump}
      title={atBottom ? undefined : t('review.jumpLatest')}
      aria-label={atBottom ? undefined : t('review.jumpLatest')}
    >
      <Icon name="arrowDown" />
    </button>
  )
}

/** The transcript-tail state + controls a consumer binds to its scroll region. */
interface TranscriptTailState {
  /** Folded turns; undefined while the first load is in flight. */
  turns: readonly TranscriptTurn[] | undefined
  /** Whether the last load failed (the session/reader is unavailable). */
  error: boolean
  /** Whether the host holds messages older than the loaded window. */
  hasMore: boolean
  /** Whether an earlier page is being fetched right now. */
  loadingEarlier: boolean
  /**
   * The last earlier-page read failed (stale host, rejected cursor, link
   * down). The button STAYS (tapping retries — a failed page is never a
   * dead end), and the surface says so instead of spinning once and going
   * quiet (the "点加载更早没反应" report).
   */
  pageError: boolean
  /**
   * The deployment serves no page endpoint (the refused wire code was
   * `remote/unavailable`). Terminal: the button goes AWAY and the line
   * names the missing server capability — retrying a missing endpoint is
   * the infinite dead loop, never an offered action.
   */
  pageUnsupported: boolean
  /**
   * The region's tail, as a pin: `pin.jump()` scrolls to the end and resumes
   * following, and the pill reads its visibility through it. There is NO
   * `atBottom` boolean on this interface on purpose — a boolean here is a
   * render-state fact, and every crossing would re-render the panel (see the
   * module doc).
   */
  pin: ScrollPin
  /** Ref to attach to the content region (the scroller is resolved from it). */
  scrollRef: React.RefObject<HTMLDivElement>
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
  const [pageError, setPageError] = useState(false)
  /** The deployment serves no page endpoint (terminal — the button goes away). */
  const [pageUnsupported, setPageUnsupported] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // The accumulated window, oldest-first: the tail, then every earlier page
  // prepended ABOVE it (never appended — order is a layout fact). The floor
  // is the window's first seq; `hasMore` is the host's own flag.
  const floorRef = useRef<number | undefined>(undefined)
  const hasMoreRef = useRef(false)
  hasMoreRef.current = hasMore
  // The follow opening's log cut (the page grammar's other half): captured
  // from the tail result, threaded into every earlier-page request. A page
  // without its cut is rejected by the host — that missing thread was the
  // "翻页永远失败" root (the hook sent beforeSeq alone).
  const throughSeqRef = useRef<number | undefined>(undefined)
  // A ref mirror of the window for the paging fallback below (refs, not
  // state — the callback must see the latest window without re-subscribing).
  const eventsRef = useRef<readonly TranscriptEventShape[] | undefined>(undefined)
  eventsRef.current = events
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
  /* FOLD ONCE PER WINDOW, not once per render.
   *
   * `foldTurns` walks every event of the loaded window. Called straight from the
   * render body it re-ran on every render of the panel — and it also produced new
   * `TranscriptTurn` objects each time, which is what quietly defeated the memo on
   * `TurnList` / `TurnItem`: their props were equal by value but never by
   * reference. One `useMemo` on the window makes both of those true at once. */
  const turns = useMemo(() => (events === undefined ? undefined : foldTurns(events)), [events])
  // One follow mechanism (resolved scroller + passive listener + pinning). The
  // content key is the folded window: a new round is what may need a re-pin.
  const pin = useFollowScroll(scrollRef, turns)

  /** Fold + publish a successful tail read (the reload AND the poll share
   *  it — one settlement grammar). */
  const settle = useCallback((result: { events: readonly TranscriptEventShape[]; hasMore: boolean; floorSeq?: number; throughSeq?: number; projections?: TranscriptProjectionsShape }): void => {
    setError(false)
    const next = watermarkOf(result)
    setHasMore(result.hasMore === true)
    // A fresh tail REPLACES the window (reload / poll / session switch) —
    // earlier pages belong to the previous window and must not linger.
    floorRef.current = result.floorSeq
    throughSeqRef.current = result.throughSeq
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
    setPageError(false)
    setPageUnsupported(false)
    floorRef.current = undefined
    throughSeqRef.current = undefined
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
        if (result.throughSeq !== undefined) throughSeqRef.current = result.throughSeq
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
   *  jumping to the top. At the floor, or without a page reader, a no-op.
   *
   *  The floor is the host's `floorSeq` when it sends one; otherwise the
   *  window's own first seq (a host that reports `hasMore` without a floor
   *  must still page — a visible button that no-ops is the "点了没反应"
   *  bug, never a silent guard again).
   *
   *  Two failure classes, two sentences: a REFUSED page carries its wire
   *  code — `remote/unavailable` (the deployment serves no page endpoint)
   *  is terminal (the button goes away, the line says to update the
   *  server — retrying a missing endpoint is the infinite dead loop);
   *  anything else keeps the button and the retry line. */
  const loadEarlier = useCallback((): void => {
    if (sessionId === undefined || loadingEarlier) return
    if (!hasMoreRef.current) return
    const floor = floorRef.current ?? eventsRef.current?.[0]?.seq
    if (floor === undefined) return
    setLoadingEarlier(true)
    void controller.loadTranscriptPage(sessionId, floor, throughSeqRef.current).then(page => {
      if (!aliveRef.current) return
      setLoadingEarlier(false)
      // A failed page is SAID, not swallowed: hasMore stays (the host still
      // claims more), the button stays, and the quiet line under it names
      // the failure — tapping retries. A silent stop is the bug.
      if (page === undefined) {
        setPageError(true)
        return
      }
      if (page.refused !== undefined) {
        if (page.refused === 'remote/unavailable') setPageUnsupported(true)
        else setPageError(true)
        return
      }
      setPageError(false)
      setPageUnsupported(false)
      const root = resolveScroller(scrollRef.current)
      const distance = root === null ? undefined : root.scrollHeight - root.scrollTop
      setEvents(current => {        const known = new Set<number>()
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
      // would leave the reader staring at older messages. The write goes through
      // the pin so the geometry cache is corrected in the same breath.
      if (distance !== undefined) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => { pin.anchor(distance) })
        })
      }
    })
  }, [controller, sessionId, loadingEarlier, pin])

  // Scroll measurement, end-following and the jump all live in
  // `useFollowScroll` above — one mechanism for every live list.

  return { turns, error, hasMore, loadingEarlier, pageError, pageUnsupported, pin, scrollRef, reload, loadEarlier }
}
