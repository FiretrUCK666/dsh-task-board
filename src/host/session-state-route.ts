/**
 * Session-state bridge (host): exposes the native per-session PLAN mode,
 * active GOAL and live SUBAGENTS to the board's comment surfaces.
 * This is the narrow read-only bridge — it deliberately DOES NOT carry a
 * command catalog: only live session state that the surfaces display. We never
 * hardcode plan/goal/subagent shapes; we READ the harness's own services
 * (planMode / goals / subagents) through thin structural faces, so official
 * changes flow in automatically. Any missing/throwing face degrades to that
 * block being absent — never an error surface.
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
import { json } from './http-json.ts'

/** The validated, shape-safe view a surface can render. */
export interface SessionStateView {
  plan?: { active: boolean; pending: boolean }
  goal?: { title: string; active: boolean }
  /**
   * The session's DIRECT children, as the host's catalog knows them.
   *
   * `id` is what makes the row actionable and checkable: the client asks its own
   * activity derivation whether that child is still working (the same answer the
   * card's 「等 N 个子 Agent」 prints), so this layer never invents a status it
   * cannot read.
   */
  subagents?: Array<{ id: string; title: string }>
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
        /* **宿主给的是一张目录，不是一张状态表。**
         *
         * 安装的 DSH 里 `listChildren` 返回的是 `SubagentCatalogEntry`：
         * `{ id, createdAt, mode }`（`mode` 为 one-shot / continuable / external /
         * unknown，续跑型的 `label` 必有、一次性的可能没有）。它**不带**活动状态。
         *
         * 这里以前按 `{ kind: 'child', label, activity }` 过滤，于是**每一条都被丢掉**
         * ——评论区里一个子 Agent 也看不见，而这条路由照常 200。判据读错对象比读不到
         * 更坏：它让「没有」看起来像「宿主没给」。
         *
         * 所以这一层只回答它真能回答的：**有哪些子 Agent、各自叫什么**。谁还在跑是
         * 活性问题，客户端按 id 问自己的活性推导（`controller.sessionActiveOf`）——
         * 那个答案与卡片上「等 N 个子 Agent」用的是同一个。 */
        const subagents = list
          .map(row => row as Record<string, unknown>)
          .filter(row => isStr(row.id))
          .map(row => ({
            id: row.id as string,
            title: isStr(row.label)
              ? row.label as string
              // 没有标签时用宿主给的短 id：一行「未命名」比少一行好，而 id 至少
              // 还能与卡片上的会话对上。
              : (row.id as string).slice(0, 8),
          }))
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

/**
 * HTTP handler: GET /api/dsh-task-board/session-state?sessionId=… → the shared
 * envelope `{ ok: true, value: { plan?, goal?, subagents? } }`.
 *
 * THE ENVELOPE IS THE SHARED ONE. This route used to answer a FLAT envelope
 * (`{ ok: true, plan?, goal? }`) — its own dialect on the same plugin — which
 * meant a reader had to know which of the two shapes each route answers. Now
 * it answers exactly what every other route answers, and the browser reads
 * `value` like everywhere else.
 */
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
    json(res, { ok: true, value: view })
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
