/**
 * Sidebar drag contract + classification: how a drag that lands on the board
 * from the native sidebar (a workspace folder or a session) becomes a task.
 *
 * The native workspace browser already starts drags for BOTH row kinds and
 * stamps their identity into `text/plain` — a folder row sets
 * `text/plain = workspaceId` (its `row.key`), a session row sets
 * `text/plain = sessionId` (its `node.id`). So the board does NOT need to
 * re-stamp anything; it just classifies the incoming `text/plain` (after
 * ruling out its own card drags, which use `text/plain = task id`) against
 * the known native ids. The board's own MIME types are kept as an explicit,
 * forward-compatible channel (they take priority when present).
 *
 * Pure helpers — no DOM coupling — so they unit-test cleanly.
 */
/** MIME a session drag is stamped with by the board (explicit channel). */
export declare const SESSION_MIME = "application/x-dsh-task-board-session";
/** MIME a workspace-folder drag is stamped with by the board (explicit channel). */
export declare const WORKSPACE_MIME = "application/x-dsh-task-board-workspace";
/** A sidebar-sourced drag read off a drop event. */
export type SidebarDrag = {
    kind: 'session';
    id: string;
} | {
    kind: 'workspace';
    id: string;
};
/**
 * Whether a drag's advertised types mark it as a sidebar-drag candidate.
 * Types are the ONLY reliable signal during dragover/dragenter — the drag
 * data store is in protected mode there and `getData` returns empty in
 * Chrome — so the board latches the candidate from `dataTransfer.types`
 * and reads the actual payload (`externalDragOf`) only at drop time. The
 * board's own card drags also carry `text/plain`, so the caller must
 * exclude them (its drag-source ref) before latching.
 */
export declare function candidateExternalDrag(types: readonly string[]): boolean;
/** Read a board-stamped sidebar drag from a drop's dataTransfer (own MIME only). */
export declare function readSidebarDrag(data: {
    getData: (type: string) => string;
}): SidebarDrag | undefined;
/** Normalize a possibly-composite native key to its id tail. */
export declare function idOfKey(key: string): string;
/**
 * Classify a drop's dataTransfer as a sidebar drag: own MIME first, then the
 * native `text/plain` (a folder = workspaceId, a session = sessionId), after
 * ruling out the board's own card drags (`text/plain = task id`).
 * @param data - the drop's dataTransfer.
 * @param isKnownBoardTask - whether a `text/plain` value is a board task id
 *   (in which case it is the board's own card drag, never external).
 * @param resolve - (id) => 'session' | 'workspace' | undefined against the
 *   known native snapshots.
 */
export declare function externalDragOf(data: {
    getData: (type: string) => string;
}, isKnownBoardTask: (id: string) => boolean, resolve: (id: string) => 'session' | 'workspace' | undefined): SidebarDrag | undefined;
