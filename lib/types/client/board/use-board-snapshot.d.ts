import type { BoardController } from '../../core/controller.ts';
/** 看板快照的形状由 controller 自己说了算，这里不写第二遍。 */
export type BoardSnapshot = ReturnType<BoardController['getSnapshot']>;
/**
 * Subscribe to the board's snapshot, or `undefined` when there is no board.
 * @param controller - 装配层给的看板控制器，`undefined` = 这一屏没有看板。
 * @returns 当前快照；controller 变了或看板改了都会重画。
 */
export declare function useBoardSnapshot(controller: BoardController | undefined): BoardSnapshot | undefined;
