/**
 * Sidebar drag contract + wiring: how a native sidebar element (a workspace
 * folder or a session, dragged from the workspace browser) becomes a board
 * task.
 *
 * The native workspace browser already makes FOLDER rows draggable and stamps
 * `text/plain` with the row's key; individual SESSION rows are not draggable.
 * This module (a) re-stamps any native drag into the board's own MIME types
 * (leaving the native `text/plain` untouched, so nothing the shell does is
 * disturbed), and (b) makes session rows draggable at the DOM level and stamps
 * them through the same mechanism — mirroring how the board already mounts its
 * sidebar entry via DOM, never touching native React state.
 *
 * The board's own card drags use `text/plain = task id`; the board MIMEs below
 * are distinct, so nothing can collide. Wiring attaches to whatever sidebar
 * container the board already manages; `resolve` tells whether an id is a
 * known workspace or session (supplied by the controller from its native
 * snapshots). If no rows are matched, the wiring no-ops silently — the feature
 * degrades gracefully instead of breaking the sidebar.
 */

/** MIME a session drag is stamped with by the board. */
export const SESSION_MIME = 'application/x-dsh-task-board-session'
/** MIME a workspace-folder drag is stamped with by the board. */
export const WORKSPACE_MIME = 'application/x-dsh-task-board-workspace'

/** A sidebar-sourced drag read off a drop event. */
export type SidebarDrag = { kind: 'session'; id: string } | { kind: 'workspace'; id: string }

/** Read a board-stamped sidebar drag from a drop's dataTransfer. */
export function readSidebarDrag(data: DataTransfer): SidebarDrag | undefined {
  const sessionId = data.getData(SESSION_MIME)
  if (sessionId !== '') return { kind: 'session', id: sessionId }
  const workspaceId = data.getData(WORKSPACE_MIME)
  if (workspaceId !== '') return { kind: 'workspace', id: workspaceId }
  return undefined
}

/** Candidate selectors for native session rows (first with matches wins). */
const SESSION_ROW_SELECTORS = [
  '[class*="sessionRow"]',
  '[class*="session-row"]',
  '[class*="session"] [role="button"]',
]

/** Normalize a possibly-composite native key to its id tail. */
function idOfKey(key: string): string {
  return key.split(':').pop()?.split(/[\\/]/).pop() ?? key
}

/**
 * Attach sidebar drag handling to a container (the sidebar / workspace
 * browser). Re-stamps native folder drags and, by making session rows
 * draggable, lets the user drag individual sessions into the board.
 * @param container - the sidebar region the board already manages.
 * @param resolve - (id) => 'session' | 'workspace' | undefined when the id is
 *   a known native session/workspace.
 * @returns disposer.
 */
export function wireSidebarDrag(
  container: HTMLElement,
  resolve: (id: string) => 'session' | 'workspace' | undefined,
): () => void {
  // (a) One delegated dragstart: a native row beginning a drag gets re-stamped
  // into the board MIME (native text/plain untouched). Row identity is probed
  // from the native text/plain first, then from the row's own attributes.
  const onDragStart = (event: DragEvent): void => {
    const data = event.dataTransfer
    if (data === null) return
    const raw = data.getData('text/plain')
    let kind: 'session' | 'workspace' | undefined
    let id = ''
    if (raw !== '') {
      const candidate = idOfKey(raw)
      kind = resolve(candidate)
      if (kind !== undefined) id = candidate
    }
    if (kind === undefined) {
      // Native didn't stamp (e.g. a session row we made draggable): read the
      // id off the row element if it carries one.
      const row = (event.target instanceof Element)
        ? event.target.closest<HTMLElement>(SESSION_ROW_SELECTORS.join(','))
        : null
      if (row !== null) {
        const rawId = row.dataset.sessionId ?? row.dataset.sessionid ?? row.dataset.id
        if (rawId !== undefined) {
          const candidate = idOfKey(rawId)
          kind = resolve(candidate)
          if (kind !== undefined) id = candidate
        }
      }
    }
    if (kind === undefined || id === '') return
    data.setData(kind === 'session' ? SESSION_MIME : WORKSPACE_MIME, id)
    data.effectAllowed = kind === 'workspace' ? 'copy' : 'copy'
  }
  container.addEventListener('dragstart', onDragStart)

  // (b) Make session rows draggable (the shell doesn't): self-healing walk on
  // DOM mutations, like the board's sidebar-entry mounting.
  const enableRows = (): void => {
    for (const selector of SESSION_ROW_SELECTORS) {
      const rows = container.querySelectorAll<HTMLElement>(selector)
      if (rows.length === 0) continue
      for (const row of rows) row.draggable = true
      break
    }
  }
  enableRows()
  const observer = new MutationObserver(enableRows)
  observer.observe(container, { childList: true, subtree: true })

  return () => {
    container.removeEventListener('dragstart', onDragStart)
    observer.disconnect()
  }
}
