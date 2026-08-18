/**
 * Linked-sessions derivation: the pure logic behind a task's "链接会话" section.
 *
 * A task can be bound to a native source — one session, or a whole workspace
 * folder (dragged in from the sidebar). The bound source is NOT copied into
 * the board; instead the linked rows are derived live from the native session
 * + workspaces snapshots on every render, mirroring exactly the rule the
 * native workspace browser uses (`deriveGroups`): a workspace's sessions are
 * its `sessionIds` in order, archived sessions (`archivedSessionIds`) and
 * blank reuse placeholders are hidden, and the user's own "hide" set (`hidden`)
 * is applied on top. Because it is a pure function of the native snapshots,
 * new sessions, renames, archive toggles and hides all surface automatically —
 * no manual copy, no drift. Framework-free and unit-testable in isolation.
 */
import type { TaskRecord } from './tasks.ts'
import type { PendingInteractionKind } from './controller.ts'

/** The subset of a native session row the derivation reads. */
export interface LinkedSessionSource {
  title?: string
  /** The session's workspace directory path (its folder label derives from it). */
  cwd?: string
  /** Empty-log placeholder (a blank session is a "New Session" slot, not a conversation). */
  blank: boolean
  running: boolean
  pendingInteraction?: PendingInteractionKind
  completed?: boolean
  updatedAt: number
}

/** One linked-session row the board renders. */
export interface LinkedSessionRow {
  sessionId: string
  /** Session title, else its workspace folder's last path segment, else the id. */
  title: string
  /** The workspace folder label (cwd's last segment), when the cwd is known. */
  workspaceLabel?: string
  running: boolean
  pendingInteraction?: PendingInteractionKind
  completed: boolean
  updatedAt: number
}

/** Inputs the derivation needs from the native domains (read-only snapshots). */
export interface LinkedSources {
  /** Every session row, keyed by id (sessions.list.byId). */
  byId: Readonly<Record<string, LinkedSessionSource>>
  /** Registry-global archive set (workspaces.list.archivedSessionIds). */
  archived: readonly string[]
  /** A workspace's accounted session ids in display order; undefined = unknown/deleted workspace. */
  workspaceSessionIds: (workspaceId: string) => readonly string[] | undefined
  /** The task's display-hidden linked-session ids (task.hidden.sessions). */
  hidden: readonly string[]
}

/** Short display label of a directory path (last non-empty segment). */
function baseOf(cwd: string): string | undefined {
  const segment = cwd.split(/[\\/]+/).filter(Boolean).pop()
  return segment !== undefined && segment !== '' ? segment : cwd
}

/** The default title of a freshly dragged-in binding (from its native source). */
export function boundSourceTitle(
  bind: NonNullable<TaskRecord['bind']>,
  ctx: {
    sessions: Readonly<Record<string, Pick<LinkedSessionSource, 'title' | 'cwd'>>>
    workspaces: readonly { id: string; title: string }[]
  },
): string {
  if (bind.kind === 'session') {
    const session = ctx.sessions[bind.sessionId]
    if (session !== undefined) {
      if (session.title !== undefined && session.title !== '') return session.title
      const base = session.cwd !== undefined ? baseOf(session.cwd) : undefined
      if (base !== undefined && base !== '') return base
    }
    return bind.sessionId
  }
  return ctx.workspaces.find(workspace => workspace.id === bind.workspaceId)?.title ?? bind.workspaceId
}

/** Classify an id drawn from a sidebar drag as a native session or workspace. */
export function resolveExternalKind(
  id: string,
  ctx: { sessions: Readonly<Record<string, unknown>>; workspaces: readonly { id: string }[] },
): 'session' | 'workspace' | undefined {
  if (id in ctx.sessions) return 'session'
  if (ctx.workspaces.some(workspace => workspace.id === id)) return 'workspace'
  return undefined
}

/** One derived row from a native session source (title fallbacks + cwd label). */
function rowOf(sessionId: string, source: LinkedSessionSource): LinkedSessionRow {
  const workspaceLabel = source.cwd !== undefined ? baseOf(source.cwd) : undefined
  return {
    sessionId,
    title: source.title !== undefined && source.title !== '' ? source.title : (workspaceLabel ?? sessionId),
    ...workspaceLabel !== undefined ? { workspaceLabel } : {},
    running: source.running,
    pendingInteraction: source.pendingInteraction,
    completed: source.completed === true,
    updatedAt: source.updatedAt,
  }
}

/**
 * Derive the linked-session rows of a task from the native snapshots. Rows are
 * the workspace's accounted sessions in order (or the single bound session),
 * minus archived, minus blank placeholders, minus the user's hidden set. A
 * missing or archived/bound-stale single session yields no row.
 *
 * @param bind - the task's live binding (undefined = no linked section).
 * @param sources - native read faces + hidden set.
 */
export function deriveLinkedSessions(
  bind: TaskRecord['bind'],
  sources: LinkedSources,
): readonly LinkedSessionRow[] {
  if (bind === undefined) return []
  const hidden = new Set(sources.hidden)

  const eligible = (sessionId: string): LinkedSessionRow | undefined => {
    if (hidden.has(sessionId)) return undefined
    const source = sources.byId[sessionId]
    if (source === undefined) return undefined
    if (source.blank) return undefined
    if (sources.archived.includes(sessionId)) return undefined
    return rowOf(sessionId, source)
  }

  if (bind.kind === 'session') {
    const row = eligible(bind.sessionId)
    return row !== undefined ? [row] : []
  }

  const ids = sources.workspaceSessionIds(bind.workspaceId)
  if (ids === undefined) return []
  const rows: LinkedSessionRow[] = []
  for (const sessionId of ids) {
    const row = eligible(sessionId)
    if (row !== undefined) rows.push(row)
  }
  return rows
}
