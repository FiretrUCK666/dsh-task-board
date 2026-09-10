import type { BoardController } from '../core/controller.ts';
/**
 * Mount the board React tree into the center column and bind its visibility
 * to the controller's boardOpen state.
 * @param controller - the board controller driving the view.
 * @returns disposer unmounting the tree and restoring the column.
 */
export declare function mountBoard(controller: BoardController): () => void;
