/**
 * Sidebar-entry display policy (pure, DOM-free decisions for the mount
 * state machine in sidebar-entry.ts).
 *
 * The single entry rule: the board is reachable through EXACTLY ONE affordance
 * at any moment — the injected sidebar row while it is actually visible, the
 * floating corner button otherwise. "Placed in the DOM" is not the same as
 * "visible": a mobile shell renders its sidebar off-canvas (or is late /
 * re-rendered away), so a row that exists inside a hidden or detached tree
 * would silently leave the board unreachable. Every decision here is a
 * direct function of visibility, never of what happened earlier.
 *
 * @module dsh-task-board/client/entry-policy
 */
/**
 * Whether a mounted entry is actually visible to the user. Requires the
 * element to be connected, to have laid-out boxes, AND to intersect the
 * viewport — the last condition is what keeps an off-canvas mobile sidebar
 * (its drawer slides the entry out of the viewport while the element keeps
 * its layout rects) from ever counting as "visible". A row in any other
 * state — hidden by CSS, off-viewport, or detached — is not an entry.
 */
export declare function entryVisible(element: HTMLElement | undefined): boolean;
/**
 * Whether the floating corner fallback is currently needed. The row wins
 * while visible; every other state — never placed, placed in a hidden or
 * detached shell subtree, or just not connected — wants the fallback.
 */
export declare function fallbackWanted(entry: HTMLElement | undefined): boolean;
