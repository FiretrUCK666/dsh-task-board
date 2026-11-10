/**
 * FLIP for card movement — structure-driven, never rect-driven.
 *
 * The original rect-diff approach treated ANY geometry change (a column
 * scroll, a hover lift, the dragging scale) as a move, so a busy board
 * repainted cards into their old positions — the "cards vanish / ghost
 * copies / endless flicker" symptoms. This version compares STRUCTURE only:
 * a card's column and its index inside it, read from the DOM order, never
 * from rects. A card animates only when its structure changed (a reorder or
 * a column move); a pure scroll or hover can never trigger it. The animation
 * runs on the Web Animations API (the browser owns the lifecycle — no
 * transitionend dependency, no inline-transform residue, auto-cancel on
 * unmount), and it is fully suppressed while the user is dragging: the
 * post-drop settle is the one moment it plays.
 *
 * Newcomers (in the current snapshot, absent from the previous one) arrive
 * instead of teleporting: the hook stamps them with `data-fresh` so the CSS
 * reveals them once (see `.card[data-fresh]`), then removes the stamp on the
 * next frame batch — the animation belongs to the arrival, not to the card,
 * so a later re-render never replays it.
 *
 * ── THE DECISION IS SEPARATE FROM THE MEASUREMENT ───────────────────────────
 *
 * "Where is every card right now" costs one `getBoundingClientRect()` per card,
 * and a rect read is a LAYOUT read: the engine has to finish every pending style
 * and layout job before it can answer. This hook used to do exactly that on
 * EVERY render of the board — and the board re-renders on every controller
 * notification (a session list burst, a poll, a heartbeat), so a reader scrolling
 * a comment panel over the board paid a full synchronous layout per notification,
 * for cards nobody could see.
 *
 * So the two halves are now separate functions with a cheap boundary between
 * them: {@link structureSignatureOf} reads the DOM ORDER only (no layout), and
 * {@link flipDecisionOf} says whether this render may skip. Only a render that
 * actually moved a card — or a reveal edge — reaches {@link measureRegion}.
 *
 * ── WHY THE REMEMBERED POSITION IS A CONTENT POSITION ───────────────────────
 *
 * Skipping renders means the remembered rects can be older than the last paint:
 * the reader may have scrolled a column, or the board may have scrolled sideways,
 * between the render that measured and the render that animates. Comparing a fresh
 * rect against a stale one would fling the card in from the wrong place. So the
 * memory stores each card's position in the coordinates that do not change when
 * something scrolls — offset from the container, plus that column's scroll offset —
 * and reconstructs the viewport position from the CURRENT scroll offsets. A
 * remembered position is then valid at any later render, which is what makes
 * "measure only when the structure moved" honest instead of merely faster.
 */
import { type RefObject } from 'react';
/** A card's structural identity: which column, and which index inside it. */
export interface CardStructure {
    status: string;
    index: number;
}
/**
 * The ids whose structure (column or in-column order) actually changed
 * between two snapshots — the ONLY cards eligible for a FLIP. A card absent
 * from the previous snapshot is new content (no old rect to animate FROM), a
 * card absent from both sides is ignored.
 */
export declare function flipCandidatesOf(previous: ReadonlyMap<string, CardStructure>, current: ReadonlyMap<string, CardStructure>): string[];
/**
 * The board's structure as one comparable string: every column in track order,
 * and the card ids inside it in DOM order.
 *
 * This is the CHEAP half of the hook. `querySelectorAll` walks the tree; it does
 * not ask the engine for a single box, so it never forces a layout flush. That is
 * the whole point of having it: the answer to "did anything move" must be
 * available without paying for rects.
 * @param container - the board region.
 * @returns the signature (stable for an unchanged structure).
 */
export declare function structureSignatureOf(container: HTMLElement): string;
/** What this render is allowed to do — the cheap answer, decided before any rect. */
export type FlipDecision = 
/** Nothing moved and no edge was crossed: do no layout work at all. */
{
    readonly kind: 'skip';
}
/** The structure moved (or the surface was just revealed): measure. */
 | {
    readonly kind: 'measure';
    readonly animate: boolean;
};
/**
 * Decide, from the signature alone, what this render must do.
 *
 * `quiet` folds the three reasons a move must NOT play (a drag in flight, reduced
 * motion, and the reveal edge). They stay separate facts upstream and become one
 * flag here, because "may play" is one question — two branches would let a drag
 * and reduced motion disagree about which one wins.
 * @param previous - the signature the last measurement was taken from (undefined on mount).
 * @param current - this render's signature.
 * @param quiet - movement must not play (see above).
 * @returns the decision; `skip` means no layout read may follow.
 */
export declare function flipDecisionOf(previous: string | undefined, current: string, quiet: boolean): FlipDecision;
/**
 * Animate the cards whose structure changed into their new positions.
 *
 * Compact horizontal track: a cross-column move on a phone lands OFF-SCREEN
 * (the target column is not the one under the eye), so the animation —
 * though it plays — is never seen: 「移动没有动效」. Before playing, the
 * moved card's TARGET column is brought into view (instant scroll: a smooth
 * one would fight the rects the animation is computed from). Desktop (no
 * horizontal scroll) never touches it.
 *
 * @param containerRef - the board region (columns → cards, in DOM order).
 * @param disabled - a drag is in flight; the post-drop settle is the only moment
 *   a move plays, so nothing may animate under the pointer.
 * @param revealKey - changes when the surface is REVEALED (a covering layer closed).
 *   A reveal resets the baseline and plays nothing: the reader just closed a panel,
 *   and cards flying into place behind it is noise, not feedback.
 */
export declare function useFlipRegion(containerRef: RefObject<HTMLElement | null>, disabled: boolean, revealKey?: unknown): void;
