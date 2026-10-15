import { type BoardController } from '../../core/controller.ts';
import type { ItemPriority } from '../../core/item.ts';
import { type BundleFreshnessState } from '../bundle-freshness.ts';
/** Board component; subscribes to the controller snapshot.
 *
 *  WHY THIS IS ONE LONG FUNCTION, AND WHY SPLITTING IT IS NOT THE FIX.
 *
 *  The panel is ALREADY decomposed: `board/` holds thirty components, and the
 *  return below is 72% attributes and expressions — it is WIRING, not a wall of
 *  markup. What is left here is the one place that knows how the thirty connect.
 *
 *  Measured, because "this function is too long" is not a reason to move code:
 *  the function's scope declares 286 names, and the two big blocks inside the
 *  return read 82 (the header) and 96 (the columns) of them. Turning either into
 *  a component therefore means writing an 82- or 96-prop interface — the same
 *  complexity moved behind a boundary, plus an interface to keep in sync. That is
 *  worse for the reader, not better. The only cheap block is the narrow-screen
 *  thumb bar (16 lines, 3 names), and lifting 16 lines out of 2,538 buys nothing.
 *
 *  So the boundary is deliberate, and the thing that WOULD help is a different
 *  change: a reducer plus context, so a sub-component reads the slice it needs
 *  instead of being handed it. That is an architectural change touching every
 *  line, with its own verification cycle — not a refactor to slip in beside
 *  something else. Until then the three section markers in the return are what
 *  the reader navigates by. */
export declare function TaskBoard({ controller, freshness, mountedOf, onOpenRows }: {
    controller: BoardController;
    freshness?: BundleFreshnessState;
    mountedOf?: (cardId: string) => {
        readonly count: number;
        readonly loudest?: ItemPriority;
    } | undefined;
    onOpenRows?: (cardId: string) => void;
}): import("react").JSX.Element;
