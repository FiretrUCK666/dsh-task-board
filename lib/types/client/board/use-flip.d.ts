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
 * Animate the cards whose structure changed into their new positions.
 *
 * Compact horizontal track: a cross-column move on a phone lands OFF-SCREEN
 * (the target column is not the one under the eye), so the animation —
 * though it plays — is never seen: 「移动没有动效」. Before playing, the
 * moved card's TARGET column is brought into view (instant scroll: a smooth
 * one would fight the rects the animation is computed from). Desktop (no
 * horizontal scroll) never touches it.
 */
export declare function useFlipRegion(containerRef: RefObject<HTMLElement | null>, disabled: boolean): void;
