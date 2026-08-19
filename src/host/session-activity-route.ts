/**
 * Session-activity bridge (host): exposes NATIVE per-session state — the plan
 * mode, the active goal and the live slash-command catalog — to the board's
 * comment and refine surfaces. This is the architectural cornerstone of the
 * "no maintenance sync" contract: we never hardcode command names or plan
 * states; we READ the harness's own services (planMode / goals / commands /
 * agents) through thin structural faces, so whatever the official UI gains or
 * renames shows up here automatically. Any face that is missing or throws
 * degrades to that block being absent — never an error surface.
 */
import type { Context } from '@deepseek-ai/cordis'

/** The validated, shape-safe view a surface can render. */
export interface NativeActivityView {
  plan?: { active: boolean; pending: boolean }
  goal?: { title: string; active: boolean }
  commands?: Array<{ name: string; description?: string }>
}

/** Service faces the host wiring supplies (each optional). */
export interface SessionActivityFaces {
  sessions?: { get(id: string): unknown | undefined }
  agents?: { get(id: string): unknown | undefined }
  planMode?: { get(agent: unknown): unknown }
  goals?: { get(agent: unknown): unknown }
  commands?: { list(agent: unknown): unknown }
}

function isStr(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * Read the native activity of a session. Structural reads only: leaves that
 * are not well-formed are dropped (a re-shaped harness object keeps the view
 * safe). A missing agent or throwing service produces no block at all.
 */
export function readSessionActivity(
  faces: SessionActivityFaces,
  sessionId: string,
): NativeActivityView {
  const view: NativeActivityView = {}
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
  if (faces.commands !== undefined) {
    try {
      const list = faces.commands.list(agent)
      if (Array.isArray(list)) {
        const commands = list
          .map(item => item as { name?: unknown; description?: unknown })
          .filter(item => isStr(item.name))
          .slice(0, 40)
          .map(item => ({
            name: item.name as string,
            ...(isStr(item.description) ? { description: item.description as string } : {}),
          }))
        if (commands.length > 0) view.commands = commands
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

/** HTTP handler: GET /api/dsh-task-board/session-activity?sessionId=… → { ok, plan?, goal?, commands? }. */
export function createSessionActivityHandler(
  faces: SessionActivityFaces,
  read: (faces: SessionActivityFaces, sessionId: string) => NativeActivityView = readSessionActivity,
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
export function registerSessionActivityRoute(ctx: Context): () => void {
  const webServer = ctx.get('webServer') as { register(options: unknown): () => void } | undefined
  if (webServer === undefined) return () => undefined
  const faces: SessionActivityFaces = {
    sessions: ctx.get('sessions') as SessionActivityFaces['sessions'],
    agents: ctx.get('agents') as SessionActivityFaces['agents'],
    planMode: ctx.get('planMode') as SessionActivityFaces['planMode'],
    goals: ctx.get('goals') as SessionActivityFaces['goals'],
    commands: ctx.get('commands') as SessionActivityFaces['commands'],
  }
  return webServer.register({
    kind: 'exact',
    path: '/api/dsh-task-board/session-activity',
    handler: createSessionActivityHandler(faces),
  })
}
