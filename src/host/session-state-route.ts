/**
 * Session-state bridge (host): exposes the native per-session PLAN mode,
 * active GOAL and live SUBAGENTS to the board's comment surfaces.
 * This is the narrow read-only bridge — it deliberately DOES NOT carry a
 * command catalog (the command directory was removed from the board): only
 * live session state that the surfaces display. We never hardcode plan/goal/
 * subagent shapes; we READ the harness's own services (planMode / goals /
 * subagents) through thin structural faces, so official changes flow in
 * automatically. Any missing/throwing face degrades to that block being
 * absent — never an error surface.
 *
 * NATIVE SHAPES (verified against the deployment's own type definitions):
 * - goal: `goals.get(agent)` → GoalView `{ objective, phase:
 *   'active'|'paused'|'blocked'|'complete', ... }` — a completed goal
 *   (phase 'complete') is NOT in flight, so it is not exposed.
 * - subagents: `subagents.listChildren(parentSessionId)` → entries
 *   `{ kind: 'child'|'diagnostic', label?, activity: 'running'|'inactive',
 *   mode, hasChildren, ... }` (async, keyed by the parent SESSION id, not an
 *   agent object). 'running' = live now; 'inactive' = finished; a
 *   'diagnostic' row is not a child.
 */
import type { Context } from '@deepseek-ai/cordis'

/** The validated, shape-safe view a surface can render. */
export interface SessionStateView {
  plan?: { active: boolean; pending: boolean }
  goal?: { title: string; active: boolean }
  /** Child subagent thumbnails of the session (read-only directory view). */
  subagents?: Array<{ title: string; status?: string }>
}

/** Service faces the host wiring supplies (each optional). */
export interface SessionStateFaces {
  sessions?: { get(id: string): unknown | undefined }
  agents?: { get(id: string): unknown | undefined }
  planMode?: { get(agent: unknown): unknown }
  goals?: { get(agent: unknown): unknown }
  subagents?: { listChildren(parentSessionId: string): Promise<unknown> | unknown }
}

function isStr(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** Subagent finished words (native 'inactive' = finished; tolerate reshares). */
function subagentFinished(status: string | undefined): boolean {
  return status === 'inactive' || status === 'finished' || status === 'completed'
    || status === 'done' || status === 'settled'
}

/**
 * Read the native plan/goal/subagent state of a session. Structural reads
 * only: leaves that are not well-formed are dropped; a missing agent or
 * throwing service produces no block at all.
 */
export async function readSessionState(
  faces: SessionStateFaces,
  sessionId: string,
): Promise<SessionStateView> {
  const view: SessionStateView = {}
  const agent = faces.agents !== undefined
    ? faces.agents.get(sessionId)
    : faces.sessions?.get(sessionId)
  if (agent === undefined) return view
  if (faces.planMode !== undefined) {
    try {
      const plan = faces.planMode.get(agent) as { active?: unknown; pending?: unknown } | null | undefined
      if (plan !== null && plan !== undefined) {
        const active = plan.active === true
        const pending = plan.pending === true
        if (active || pending) view.plan = { active, pending }
      }
    } catch { /* native failure degrades silently */ }
  }
  if (faces.goals !== undefined) {
    try {
      // GoalView: `objective` is the title, `phase` is the lifecycle word.
      // 'complete' means the goal is DONE — surfaced nowhere; any other
      // phase (active/paused/blocked, or an unknown host word) is in flight.
      const goal = faces.goals.get(agent) as { objective?: unknown; phase?: unknown } | null | undefined
      if (goal !== null && goal !== undefined && isStr(goal.objective) && goal.phase !== 'complete') {
        view.goal = { title: goal.objective, active: true }
      }
    } catch { /* degraded silently */ }
  }
  if (faces.subagents !== undefined) {
    try {
      const list = await faces.subagents.listChildren(sessionId)
      if (Array.isArray(list)) {
        const subagents = list
          .filter(row => {
            const entry = row as Record<string, unknown>
            return entry.kind === 'child' && isStr(entry.label)
          })
          .map(row => {
            const entry = row as Record<string, unknown>
            return { title: entry.label as string, status: isStr(entry.activity) ? entry.activity : undefined }
          })
          .filter(item => !subagentFinished(item.status))
        if (subagents.length > 0) view.subagents = subagents
      }
    } catch { /* degraded silently */ }
  }
  return view
}

/** Extract a query parameter out of a raw request URL (no URL dependency). */
export function queryParamOf(rawUrl: string | undefined, key: string): string | undefined {
  if (rawUrl === undefined) return undefined
  const question = rawUrl.indexOf('?')
  if (question < 0) return undefined
  for (const pair of rawUrl.slice(question + 1).split('&')) {
    const eq = pair.indexOf('=')
    const name = eq < 0 ? pair : pair.slice(0, eq)
    const value = eq < 0 ? '' : pair.slice(eq + 1)
    if (decodeURIComponent(name) === key) return decodeURIComponent(value)
  }
  return undefined
}

/** HTTP handler: GET /api/dsh-task-board/session-state?sessionId=… → { ok, plan?, goal? }. */
export function createSessionStateHandler(
  faces: SessionStateFaces,
  read: (faces: SessionStateFaces, sessionId: string) => Promise<SessionStateView> = readSessionState,
): (req: { url?: string }, res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: string): void }) => Promise<void> {
  return async (req, res) => {
    const sessionId = queryParamOf(req.url, 'sessionId')
    if (sessionId === undefined || sessionId === '') {
      res.writeHead(400)
      res.end()
      return
    }
    const view = await read(faces, sessionId)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, ...view }))
  }
}

/** Mount the bridge on the host web surface. */
export function registerSessionStateRoute(ctx: Context): () => void {
  const webServer = ctx.get('webServer') as { register(options: unknown): () => void } | undefined
  if (webServer === undefined) return () => undefined
  const faces: SessionStateFaces = {
    sessions: ctx.get('sessions') as SessionStateFaces['sessions'],
    agents: ctx.get('agents') as SessionStateFaces['agents'],
    planMode: ctx.get('planMode') as SessionStateFaces['planMode'],
    goals: ctx.get('goals') as SessionStateFaces['goals'],
    subagents: ctx.get('subagents') as SessionStateFaces['subagents'],
  }
  return webServer.register({
    kind: 'exact',
    path: '/api/dsh-task-board/session-state',
    handler: createSessionStateHandler(faces),
  })
}
