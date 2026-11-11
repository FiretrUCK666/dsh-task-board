import type { BoardController } from '../../core/controller.ts';
/** 看板快照的形状由 controller 自己说了算，这里不写第二遍。 */
export type BoardSnapshot = ReturnType<BoardController['getSnapshot']>;
/**
 * Subscribe to the board's snapshot, or `undefined` when there is no board.
 * @param controller - 装配层给的看板控制器；`undefined` = 这一屏没有看板。
 * @param held - 这一层此刻是不是**被盖着**（见 `design/cover.ts`）。被盖着时只跳过
 *   **数据**通知：位置一变照样收（见 `samePlace`）。一个表面不可能靠「什么都收不到」
 *   来省下重算——它需要知道的是**自己还该不该在**。
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
