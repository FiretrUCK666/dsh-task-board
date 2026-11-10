import type { BoardController } from '../../core/controller.ts';
/** 看板快照的形状由 controller 自己说了算，这里不写第二遍。 */
export type BoardSnapshot = ReturnType<BoardController['getSnapshot']>;
/**
 * Subscribe to the board's snapshot, or `undefined` when there is no board.
 * @param controller - 装配层给的看板控制器；`undefined` = 这一屏没有看板。
 * @param held - 这一层此刻是不是**被盖着**（见 `design/cover.ts`）。被盖着的表面不
 *   接收新快照：它的可见输出没有人在看，而每次通知都意味着一整棵子树的重算；重算本身
 *   不发生在读者眼里，代价却落在读者正滚动的那个面板的手感上。
 * @returns 当前快照，或 `undefined`（没有看板）。controller 变了或看板改了都会重画。
 */
export declare function useBoardSnapshot(controller: BoardController | undefined, held?: boolean): BoardSnapshot | undefined;
/**
 * The same subscription for a caller that REQUIRES a board.
 *
 * One line, and the line is the point: it states once that this caller cannot be
 * without a board, instead of making every field of every snapshot read assert it.
 * @param controller - 装配层给的看板控制器（必填）。
 * @param held - 这一层此刻是不是被盖着（见 `useBoardSnapshot`）。
 * @returns 当前快照；controller 变了或看板改了都会重画。
 */
export declare function useRequiredBoardSnapshot(controller: BoardController, held?: boolean): BoardSnapshot;
