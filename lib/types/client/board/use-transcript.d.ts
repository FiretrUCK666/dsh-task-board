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
     * Put the reader back `distance` px from the end after content was PREPENDED
     * above the viewport (the "加载更早" grammar), and refresh the geometry cache.
     *
     * It belongs here rather than at the call site because the pin owns both the
     * scroller's offset and the cached maximum: a write from outside would leave
     * the cache describing the pre-page geometry, and the next measure would then
     * read a distance that is wrong by exactly the page's height.
     */
    anchor(distance: number): void;
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
export declare function useResizeFollow(scrollRef: React.RefObject<HTMLDivElement>, pinnedRef: React.MutableRefObject<boolean>, maxScroll: React.MutableRefObject<number>, remountKey?: unknown): void;
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
export declare function useFollowScroll(scrollRef: React.RefObject<HTMLDivElement>, changedKey: unknown, 
/** When the scroll region itself UNMOUNTS and REMOUNTS (a fold that hides
 *  its children — the comments Disclosure), the observer + follow effects
 *  must re-bind to the NEW element; passing a value that changes with the
 *  fold (its open state) does that. */
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
