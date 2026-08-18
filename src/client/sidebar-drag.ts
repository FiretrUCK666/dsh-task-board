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
export const SESSION_MIME = 'application/x-dsh-task-board-session'
/** MIME a workspace-folder drag is stamped with by the board (explicit channel). */
export const WORKSPACE_MIME = 'application/x-dsh-task-board-workspace'

/** A sidebar-sourced drag read off a drop event. */
export type SidebarDrag = { kind: 'session'; id: string } | { kind: 'workspace'; id: string }

/** Read a board-stamped sidebar drag from a drop's dataTransfer (own MIME only). */
export function readSidebarDrag(data: { getData: (type: string) => string }): SidebarDrag | undefined {
  const sessionId = data.getData(SESSION_MIME)
  if (sessionId !== '') return { kind: 'session', id: sessionId }
  const workspaceId = data.getData(WORKSPACE_MIME)
  if (workspaceId !== '') return { kind: 'workspace', id: workspaceId }
  return undefined
}

/** Normalize a possibly-composite native key to its id tail. */
export function idOfKey(key: string): string {
  return key.split(':').pop()?.split(/[\\/]/).pop() ?? key
}

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
export function externalDragOf(
  data: { getData: (type: string) => string },
  isKnownBoardTask: (id: string) => boolean,
  resolve: (id: string) => 'session' | 'workspace' | undefined,
): SidebarDrag | undefined {
  const own = readSidebarDrag(data)
  if (own !== undefined) return own
  const text = data.getData('text/plain')
  if (text === '' || isKnownBoardTask(text)) return undefined
  const id = idOfKey(text)
  const kind = resolve(id)
  if (kind === undefined) return undefined
  return { kind, id }
}
