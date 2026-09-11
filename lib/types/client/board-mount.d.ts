import type { BoardController } from '../core/controller.ts';
import type { BundleFreshnessState } from './bundle-freshness.ts';
/**
 * Mount the board React tree into the center column and bind its visibility
 * to the controller's boardOpen state.
 * @param controller - the board controller driving the view.
 * @param freshness - the stale-bundle verdict to render (see bundle-freshness).
 * @returns disposer unmounting the tree and restoring the column.
 */
export declare function mountBoard(controller: BoardController, freshness?: BundleFreshnessState): () => void;
