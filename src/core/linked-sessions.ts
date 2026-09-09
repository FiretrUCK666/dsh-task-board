/**
 * Linked-sessions derivation: the pure logic behind a task's 链接会话 section.
 *
 * A linked row exists for a session the user explicitly bound to the task
 * (dragged in from the sidebar, created through the detail, picked in the
 * add-session dialog, or snapshotted at workspace-folder creation). A
 * WORKSPACE BIND is a source/config association (where the task came from,
 * where it runs) — it contributes NO rows by itself, so a session the user
 * creates in the main UI never appears on a task card by itself. (The
 * earlier live-member derivation was exactly that bug: every new session in
 * a bound workspace flooded into the card.) The folder-drop snapshot above
 * is the deliberate exception: at CREATION the card takes the workspace's
 * current live sessions as explicit rows — a snapshot, not a subscription.
 *
 * The session row is derived live from the native session snapshot (title,
 * running, pending interaction), so renames and state changes surface with no
 * manual copy, no drift. An explicitly bound session is NEVER filtered by
 * archived/blank (the user dragged it in on purpose); only the user's own
 * hide set applies. Pure and framework-free.
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
  /** The task's display-hidden linked-session ids (task.hidden.sessions). */
  hidden: readonly string[]
}

/** Short display label of a directory path (last non-empty segment). THE one
 *  cwd→label derivation, shared with the session panels' workspace rows. */
export function workspaceLabelOf(cwd: string): string {
  const segment = cwd.split(/[\\/]+/).filter(Boolean).pop()
  return segment !== undefined && segment !== '' ? segment : cwd
}

/**
 * The session's REAL name, or undefined. A durable title that is exactly the
 * workspace (project) BASENAME is the host's DETERMINISTIC auto-name — the
 * fallback it projects after the first message when nothing named the
 * session — NOT a name a human chose. Every title surface (run rows, linked
 * rows, panel headers) reads through here, so a fresh session never presents
 * its folder as its title. A user who deliberately names a session after its
 * own folder is the accepted, genuinely-ambiguous edge.
 */
export function realTitleOf(title: string | undefined, cwd: string | undefined): string | undefined {
  if (title === undefined || title === '') return undefined
  if (cwd !== undefined && cwd !== '' && title === workspaceLabelOf(cwd)) return undefined
  return title
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
      const base = session.cwd !== undefined ? workspaceLabelOf(session.cwd) : undefined
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

/** One derived row from a native session source (real title + cwd label).
 *  The TITLE slot carries only a REAL name: the workspace folder has its own
 *  `workspaceLabel` slot, and the host's deterministic auto-name (== the
 *  folder basename) is not a name — an unnamed row keeps the id and the
 *  single 未命名 grammar (`sessionRowTitleOf`) renders it. */
function rowOf(sessionId: string, source: LinkedSessionSource): LinkedSessionRow {
  const workspaceLabel = source.cwd !== undefined ? workspaceLabelOf(source.cwd) : undefined
  const real = realTitleOf(source.title, source.cwd)
  return {
    sessionId,
    title: real ?? sessionId,
    ...workspaceLabel !== undefined ? { workspaceLabel } : {},
    running: source.running,
    pendingInteraction: source.pendingInteraction,
    completed: source.completed === true,
    updatedAt: source.updatedAt,
  }
}

/**
 * Derive the linked-session rows of one bind from the native snapshot.
 *
 * - session bind → exactly that session (never filtered by archived/blank:
 *   the user dragged it in on purpose; only the hide set applies);
 * - workspace bind → NO rows by itself (a workspace is a source/config
 *   association, never a subscription — folder drops snapshot their members
 *   as explicit session binds at creation instead);
 * - unbound → no rows.
 */
export function deriveLinkedSessions(
  bind: TaskRecord['bind'],
  sources: LinkedSources,
): readonly LinkedSessionRow[] {
  if (bind === undefined || bind.kind === 'workspace') return []
  if (sources.hidden.includes(bind.sessionId)) return []
  const source = sources.byId[bind.sessionId]
  if (source === undefined) return []
  return [rowOf(bind.sessionId, source)]
}
