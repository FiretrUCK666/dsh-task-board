import type { BoardController, TranscriptEventShape, TranscriptProjectionsShape } from '../../core/controller.ts';
import { type TranscriptLine } from './review-transcript.ts';
/** How close to the bottom a scroll position counts as "at the latest". */
export declare const NEAR_BOTTOM_PX = 24;
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
 */
export declare function useResizeFollow(scrollRef: React.RefObject<HTMLDivElement>, atBottomRef: React.MutableRefObject<boolean>, remountKey?: unknown, initialToBottom?: boolean): void;
/**
 * One FOLLOW mechanism, shared by every live list (transcript tail, comment
 * thread): measure and pin against the RESOLVED scroller, and see its scroll
 * events through a window-level capture listener (scroll does not bubble, but
 * it does run the capture phase from the window down). A surface therefore
 * keeps following, reporting and jumping correctly whether its own region
 * scrolls (wide panel) or an ancestor does (stacked narrow panel) — no
 * per-mode code, no mobile fork.
 */
export declare function useFollowScroll(scrollRef: React.RefObject<HTMLDivElement>, atBottom: boolean, setAtBottom: (value: boolean) => void, changedKey: unknown, 
/** When the scroll region itself UNMOUNTS and REMOUNTS (a fold that hides
 *  its children — the comments Disclosure), the observer + follow effects
 *  must re-bind to the NEW element; passing a value that changes with the
 *  fold (its open state) does that. */
remountKey?: unknown, 
/** Whether a remount should pin to the bottom. A MANUAL open of the narrow
 *  comment fold passes false — the reader stays where they were (the head
 *  stays visible); a forced open (pending question) keeps true. */
initialToBottom?: boolean): {
    measure: () => void;
    jumpToBottom: () => void;
};
/**
 * The sticky "滑到最新" affordance shown in a scroll region (transcript or
 * comment thread) when the user has scrolled away from the bottom: one click
 * returns to the latest output. Hidden while the region is at the bottom,
 * where new content already auto-follows.
 */
export declare function JumpToLatest({ atBottom, onJump }: {
    atBottom: boolean;
    onJump: () => void;
}): import("react").JSX.Element | null;
/** The transcript-tail state + controls a consumer binds to its scroll region. */
interface TranscriptTailState {
    /** Folded transcript lines; undefined while the first load is in flight. */
    lines: readonly TranscriptLine[] | undefined;
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
    /** Whether the user is at (or near) the bottom of the scroll region. */
    atBottom: boolean;
    /** Ref to attach to the content region (the scroller is resolved from it). */
    scrollRef: React.RefObject<HTMLDivElement>;
    /** The scroll handler to attach to the container (updates `atBottom`). */
    onScroll: () => void;
    /** Scroll to the latest output and resume following. */
    jumpToBottom: () => void;
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
