/** Edge zone height from each edge (px). */
export declare const AUTO_SCROLL_EDGE_PX = 48;
/** Maximum scroll step per animation frame (px). */
export declare const AUTO_SCROLL_MAX_STEP = 14;
/**
 * The scroll step for a pointer at `pointerY` over a root spanning
 * [rectTop, rectBottom]: 0 outside the edge zones; positive (scroll down)
 * near the bottom, negative (scroll up) near the top, magnitude linear in
 * proximity (1..maxStep).
 */
export declare function edgeScrollStep(pointerY: number, rectTop: number, rectBottom: number, edgePx?: number, maxStep?: number): number;
/**
 * The edge-scroll loop for one drag surface. `getRoot` resolves the scroll
 * container under the pointer (stable closure over a ref); `active` switches
 * the loop on for the surface's drag kind. Every frame while the pointer sits
 * inside the root: `onFrame(lastPointerY)` only when a step was actually
 * applied (the gap/indicator follow the scroll).
 */
export declare function useDragAutoScroll(getRoot: () => HTMLElement | null, active: boolean, onFrame?: (pointerY: number) => void): void;
