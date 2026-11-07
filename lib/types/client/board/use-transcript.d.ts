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
import { type ReactNode } from 'react';
import type { BoardController, TranscriptEventShape, TranscriptProjectionsShape } from '../../core/controller.ts';
import { type TranscriptTurn } from './review-transcript.ts';
/** How close to the end a scroll position counts as "要显示滑到最新" — the pill's
 *  ENTER line, and nothing else. */
export declare const NEAR_BOTTOM_PX = 24;
/** How much clearance it takes to LEAVE — see the hysteresis note on `measure`. */
export declare const LEAVE_BOTTOM_PX = 120;
/**
 * How close to the end a scroll position counts as "still following".
 *
 * Deliberately a SEPARATE, much tighter line than the pill's. This one answers a
 * mechanical question asked on every frame (「这一帧该不该把读者拽到末尾」) and
 * its only cost may be a subtraction. Eight pixels is wider than sub-pixel
 * jitter and narrower than any deliberate flick: a reader who has moved even a
 * few pixels up has left the end, and nothing may pull them back.
 */
export declare const FOLLOW_SLACK_PX = 8;
/**
 * How to reach one live scroll region's tail: jump to it, or watch whether the
 * pill should show. `visible` is a SNAPSHOT function (not a captured boolean)
 * because it is read through `useSyncExternalStore` — a captured value would be
 * stale by the time the subscription reports a change.
 */
export interface ScrollPin {
    /** Subscribe to pill-visibility changes. Returns the disposer. */
    subscribe(listener: () => void): () => void;
    /** Whether the 「滑到最新」 pill should show right now. */
    visible(): boolean;
    /** Scroll to the end and resume following. */
    jump(): void;
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
    hold(): () => void;
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
export declare function resolveScroller(element: HTMLElement | null): HTMLElement | null;
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
export declare function useFollowScroll(scrollRef: React.RefObject<HTMLDivElement>, changedKey: unknown, 
/** When the scroll region itself UNMOUNTS and REMOUNTS (a fold that hides
 *  its children — the comments Disclosure), the owner must re-bind to the NEW
 *  element; passing a value that changes with the fold (its open state) does
 *  that. */
remountKey?: unknown): ScrollPin;
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
export declare function TailFrame({ pin, children }: {
    pin: ScrollPin;
    children: ReactNode;
}): import("react").JSX.Element;
/** The transcript-tail state + controls a consumer binds to its scroll region. */
interface TranscriptTailState {
    /** Folded turns; undefined while the first load is in flight. */
    turns: readonly TranscriptTurn[] | undefined;
    /** Whether the last load failed (the session/reader is unavailable). */
    error: boolean;
    /** Whether the host holds messages older than the loaded window. */
    hasMore: boolean;
    /** Whether an earlier page is being fetched right now. */
    loadingEarlier: boolean;
    /**
     * The last earlier-page read failed (stale host, rejected cursor, link
     * down). The button STAYS (tapping retries — a failed page is never a
     * dead end), and the surface says so instead of spinning once and going
     * quiet (the "点加载更早没反应" report).
     */
    pageError: boolean;
    /**
     * The deployment serves no page endpoint (the refused wire code was
     * `remote/unavailable`). Terminal: the button goes AWAY and the line
     * names the missing server capability — retrying a missing endpoint is
     * the infinite dead loop, never an offered action.
     */
    pageUnsupported: boolean;
    /**
     * The region's tail, as a pin: `pin.jump()` scrolls to the end and resumes
     * following, and the pill reads its visibility through it. There is NO
     * `atBottom` boolean on this interface on purpose — a boolean here is a
     * render-state fact, and every crossing would re-render the panel (see the
     * module doc).
     */
    pin: ScrollPin;
    /** Ref to attach to the content region (the scroller is resolved from it). */
    scrollRef: React.RefObject<HTMLDivElement>;
    /** Reload immediately (e.g. after a comment was injected). */
    reload: () => void;
    /** Prepend one earlier page above the current window (no-op at the floor). */
    loadEarlier: () => void;
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
export declare function useTranscriptTail(controller: BoardController, sessionId: string | undefined, reloadKey?: unknown, onResult?: (result: {
    events: readonly TranscriptEventShape[];
    projections?: TranscriptProjectionsShape;
}) => void): TranscriptTailState;
export {};
