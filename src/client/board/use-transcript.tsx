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
   * Capture where the reader is now, relative to the END, and hand back the action
   * that puts them back there after content was PREPENDED above the viewport (the
   * "加载更早" grammar).
   *
   * It belongs here rather than at the call site because the owner holds both the
   * scroller's offset and the cached geometry: a write from outside would leave the
   * cache describing the pre-page heights, and the next measurement would then read
   * a distance that is wrong by exactly the page's height.
   */
  hold(): () => void
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
 * One geometry read, and **the only one in this module**.
 *
 * `scrollHeight` and `clientHeight` are LAYOUT reads: asking for them makes the
 * engine finish every pending style and layout job first. So every caller of this
 * function is a caller that has decided its moment is one where geometry may have
 * changed: mount, a resize notification, a page prepend, a click. A scroll gesture
 * is not one of those, and the measure path uses the cached value instead.
 *
 * Both numbers come back together because the two callers need different ones — the
 * follow wants the maximum offset, the anchor wants the content height — and two
 * functions reading the same two properties would be two places to forget why they
 * are expensive.
 */
function geometryOf(root: HTMLElement): { height: number; max: number } {
  const height = root.scrollHeight
  return { height, max: Math.max(0, height - root.clientHeight) }
}

/**
 * One FOLLOW mechanism, shared by every live list (transcript tail, comment
 * thread).
 *
 * ── ONE OWNER, NOT A PILE OF EFFECTS ─────────────────────────────────────────
 *
 * "Follow the latest" is one job, and it used to be spread across four scrollTop
 * writers, six refreshes of the same cached geometry, two ResizeObservers and a
 * per-frame style resolution. Each piece was added to fix a real symptom, and
 * together they made the region impossible to reason about: two observers watching
 * the same element, a cache written from places that had no business knowing it
 * exists, and — the one that costs every frame — `resolveScroller` called from
 * `measure`, i.e. a `getComputedStyle` walk on every scroll frame. Measured
 * (`scripts/probes/probe-follow-cost.{cjs,js}`): 40 frames of scrolling produced
 * **40 style resolutions**, and the region had **2 observers over 3 nodes**.
 * A style resolution per frame is a forced style recalculation per frame, which is
 * exactly 「上下滑动都掉帧」 — and it comes and goes because it only costs when the
 * styles are actually dirty.
 *
 * So the region now has ONE owner, and the ownership is visible in the shape:
 *
 *   · `rootRef` — the element that scrolls, resolved ONLY where layout can change
 *     (setup, a resize notification, a remount). Never on the scroll path.
 *   · `geometry` — the cached content height and maximum offset, written only by
 *     `refresh` / `jump` / `hold`'s restore, all through the single `geometryOf` read.
 *   · `pinnedRef` — keep following? Written by `measure` and the commands, read by
 *     the follow path. NEVER React state: a scroll must not re-render anything.
 *   · pill visibility — a visual fact with hysteresis, delivered through
 *     `subscribe` to the pill alone.
 *   · ONE ResizeObserver and ONE passive scroll listener, both on this region.
 *
 * Three commands move the reader, each a distinct intent: `jump` (asked for the
 * end), `hold` (take a reading now, hand back the restore that keeps the same
 * distance from the end after a prepend), and the internal `refresh` (content
 * changed and the reader is pinned). Nothing else writes `scrollTop`.
 */
export function useFollowScroll(
  scrollRef: React.RefObject<HTMLDivElement>,
  changedKey: unknown,
  /** When the scroll region itself UNMOUNTS and REMOUNTS (a fold that hides
   *  its children — the comments Disclosure), the owner must re-bind to the NEW
   *  element; passing a value that changes with the fold (its open state) does
   *  that. */
  remountKey?: unknown,
): ScrollPin {
  /* ── NO FORCED LAYOUT IN THE SCROLL PATH ──────────────────────────────────
   *
   * The recorded trace of this panel showed **5,051 ms of unattributed main-thread
   * time** — Chrome could not attribute it to any function, which is what forced
   * layout looks like — on top of 2,031 ms rendering and 1,508 ms painting.
   *
   * Two kinds of read cause it, and both are now off the scroll path:
   *
   *     root.scrollHeight - root.scrollTop - root.clientHeight   (layout read)
   *     getComputedStyle(node)                                    (style recalc)
   *
   * `scrollTop` is NOT one of them — it is a stored offset the engine already has.
   * So the per-frame path reads exactly that one number and subtracts it from a
   * cache; everything else happens where layout actually changes. */
  const rootRef = useRef<HTMLElement | null>(null)
  const geometry = useRef({ height: 0, max: 0 })
  /* THE FOLLOW GATE — the only thing the follow path asks.
   *
   * It flips on `FOLLOW_SLACK_PX`, NOT on the pill's hysteresis, and the
   * difference is not cosmetic: with the pill's 120px leave-line a reader who has
   * scrolled 100px up is still 「在底部」, so an arriving round (the 3-second poll
   * makes one arrive often) would yank them back to the end mid-read — 「滑动条
   * 也跟着卡一下」. Eight pixels is the honest answer to 「他还在末尾吗」. */
  const pinnedRef = useRef(true)
  /* THE PILL'S ANSWER, and it leaves through a subscription rather than a state:
   * `visibleRef` is the snapshot; `listeners` is who to tell. */
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
    const root = rootRef.current
    if (root === null) return
    // `scrollTop` only — see the note above. No layout, no style resolution.
    const distance = geometry.current.max - root.scrollTop
    pinnedRef.current = distance < FOLLOW_SLACK_PX
    publish(visibleRef.current ? distance >= LEAVE_BOTTOM_PX : distance >= NEAR_BOTTOM_PX)
  }, [publish])

  /* THE ONE PLACE THAT READS LAYOUT, and it is never on the scroll path: setup, a
   * resize notification, a remount, or new content. Re-resolving the root belongs
   * here too — a container-query band change can move the scroll to an ancestor,
   * and doing it once per layout change keeps that promise without paying for it
   * per frame. */
  const refresh = useCallback((): void => {
    const content = scrollRef.current
    if (content === null) return
    const root = resolveScroller(content) ?? content
    rootRef.current = root
    geometry.current = geometryOf(root)
    if (!pinnedRef.current) return
    /* A ResizeObserver fires on every content growth, including the growth a
     * scroll causes when a page of history is prepended. Writing an out-of-range
     * `scrollHeight` here asks the browser to clamp on every one of those, and the
     * clamp is indistinguishable from a small jump. Write the clamped target, and
     * only when the scroller is not already sitting on it. */
    if (Math.abs(root.scrollTop - geometry.current.max) < 1) return
    root.scrollTop = geometry.current.max
  }, [scrollRef])

  /* ONE OBSERVER AND ONE LISTENER FOR THIS REGION.
   *
   * The listener belongs to the scroller, not to the document: a capture-phase
   * scroll listener on `document` runs for every scroll on the page and stops the
   * engine taking its gesture fast path. It stays passive and coalesces a whole
   * wheel gesture into one measurement — the answer cannot change twice between
   * two paints.
   *
   * The listener follows the ROOT rather than binding once to whatever scrolled at
   * setup: a container-query band change can hand the scroll to an ancestor, and a
   * listener left on the old element would stop measuring, so the pill would never
   * appear again. Re-binding happens inside the observer callback — a layout
   * moment — never on the scroll path. */
  useEffect(() => {
    const content = scrollRef.current
    if (content === null) return
    refresh()

    let frame: number | undefined
    const onScroll = (): void => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        measure()
      })
    }
    let listening: HTMLElement | null = null
    let observer: ResizeObserver | undefined
    const watched = new Set<HTMLElement>()
    /* ONE place says "this node is part of the region": it is listened to, and it
     * is observed so a change in its size can hand the scroll to a different root.
     * Both facts move together, so they cannot drift into "observed but not
     * listened to" — a region that measures its size and never hears the scroll. */
    const track = (node: HTMLElement): void => {
      if (listening !== node) {
        if (listening !== null) listening.removeEventListener('scroll', onScroll)
        listening = node
        node.addEventListener('scroll', onScroll, { passive: true })
      }
      if (observer === undefined || watched.has(node)) return
      watched.add(node)
      observer.observe(node)
    }
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        refresh()
        const current = rootRef.current
        if (current !== null) track(current)
      })
    }
    track(content)
    track(rootRef.current ?? content)
    return () => {
      if (listening !== null) listening.removeEventListener('scroll', onScroll)
      if (frame !== undefined) cancelAnimationFrame(frame)
      observer?.disconnect()
      rootRef.current = null
    }
  }, [measure, refresh, scrollRef, remountKey])

  /* New content while pinned: the geometry moved, so refresh it and land on the
   * end. This runs per new round / per page — not per gesture — and it is the same
   * function the observer uses, so there is one write path rather than two. */
  useEffect(() => { refresh() }, [refresh, changedKey, remountKey])

  const jump = useCallback((): void => {
    const root = rootRef.current
    if (root === null) return
    // A click, not a gesture: one layout read here is the right trade (the offset
    // must be exact), and it keeps the cache honest for the scroll that follows.
    geometry.current = geometryOf(root)
    root.scrollTop = geometry.current.max
    pinnedRef.current = true
    publish(false)
  }, [publish])
  const subscribe = useCallback((listener: () => void): (() => void) => {
    listeners.current.add(listener)
    return () => { listeners.current.delete(listener) }
  }, [])
  const visible = useCallback((): boolean => visibleRef.current, [])
  /* HOLD: read the distance ONCE, hand back the restore action. The caller says
   * "capture now", the owner says "put them back" — neither side needs to know how
   * the distance is computed, and the geometry cache is corrected by the same hand
   * that moved the offset. */
  const hold = useCallback((): (() => void) => {
    const root = rootRef.current
    if (root === null) return () => undefined
    /* A click, not a gesture: reading the geometry here is the right trade, and it
     * is what makes the anchor exact — the cache may predate the last growth, and a
     * distance computed from a stale height puts the reader a whole page off. */
    geometry.current = geometryOf(root)
    const distance = geometry.current.height - root.scrollTop
    return () => {
      const current = rootRef.current
      if (current === null) return
      // Geometry moved with the prepend: the cache and the offset are refreshed in
      // the same breath, and the reader keeps the SAME distance from the end, which
      // is where they were looking.
      geometry.current = geometryOf(current)
      current.scrollTop = Math.max(0, geometry.current.height - distance)
    }
  }, [])
  return { subscribe, visible, jump, hold }
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
      /* Capture the reader's place HERE, not at the click: between the tap and the
       * page arriving they may have kept reading, and the number that has to survive
       * the prepend is where they are when it happens. The DOM is still pre-prepend
       * at this point (`setEvents` has not rendered yet), which is exactly the
       * moment the distance is meant to describe. The owner computes it and hands
       * back the restore action. */
      const restore = pin.hold()
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
      requestAnimationFrame(() => { requestAnimationFrame(() => { restore() }) })
    })
  }, [controller, sessionId, loadingEarlier, pin])

  // Scroll measurement, end-following and the jump all live in
  // `useFollowScroll` above — one mechanism for every live list.

  return { turns, error, hasMore, loadingEarlier, pageError, pageUnsupported, pin, scrollRef, reload, loadEarlier }
}
