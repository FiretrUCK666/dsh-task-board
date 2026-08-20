/**
 * Session-state bridge (host): exposes the native per-session PLAN mode and
 * active GOAL to the board's comment/refine surfaces. This is the narrow
 * read-only bridge — it deliberately DOES NOT carry a command catalog (the
 * command directory was removed from the board): only live session state that
 * the surfaces display. We never hardcode plan/goal shapes; we READ the
 * harness's own services (planMode / goals / agents) through thin structural
 * faces, so official changes flow in automatically. Any missing/throwing face
 * degrades to that block being absent — never an error surface.
 */
import type { Context } from '@deepseek-ai/cordis'

/** The validated, shape-safe view a surface can render. */
export interface SessionStateView {
  plan?: { active: boolean; pending: boolean }
  goal?: { title: string; active: boolean }
}

/** Service faces the host wiring supplies (each optional). */
export interface SessionStateFaces {
  sessions?: { get(id: string): unknown | undefined }
  agents?: { get(id: string): unknown | undefined }
  planMode?: { get(agent: unknown): unknown }
  goals?: { get(agent: unknown): unknown }
}

function isStr(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * Read the native plan/goal state of a session. Structural reads only: leaves
 * that are not well-formed are dropped; a missing agent or throwing service
 * produces no block at all.
 */
export function readSessionState(
  faces: SessionStateFaces,
  sessionId: string,
): SessionStateView {
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
      const goals = faces.goals.get(agent) as { activeGoal?: unknown } | null | undefined
      const goal = goals?.activeGoal as { title?: unknown; status?: unknown } | null | undefined
      if (goal !== null && goal !== undefined && isStr(goal.title)) {
        view.goal = { title: goal.title, active: goal.status === 'active' || goal.status === 'running' }
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
  read: (faces: SessionStateFaces, sessionId: string) => SessionStateView = readSessionState,
): (req: { url?: string }, res: { writeHead(status: number, headers?: Record<string, string>): void; end(body?: string): void }) => Promise<void> {
  return async (req, res) => {
    const sessionId = queryParamOf(req.url, 'sessionId')
    if (sessionId === undefined || sessionId === '') {
      res.writeHead(400)
      res.end()
      return
    }
    const view = read(faces, sessionId)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, ...view }))
  }
}

/** Mount the bridge on the host web surface (mirrors registerSettingsRoute). */
export function registerSessionStateRoute(ctx: Context): () => void {
  const webServer = ctx.get('webServer') as { register(options: unknown): () => void } | undefined
  if (webServer === undefined) return () => undefined
  const faces: SessionStateFaces = {
    sessions: ctx.get('sessions') as SessionStateFaces['sessions'],
    agents: ctx.get('agents') as SessionStateFaces['agents'],
    planMode: ctx.get('planMode') as SessionStateFaces['planMode'],
    goals: ctx.get('goals') as SessionStateFaces['goals'],
  }
  return webServer.register({
    kind: 'exact',
    path: '/api/dsh-task-board/session-state',
    handler: createSessionStateHandler(faces),
  })
}
