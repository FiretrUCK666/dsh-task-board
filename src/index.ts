/**
 * Host loader entry for the task-board plugin.
 *
 * Everything the board does is browser work (DOM, localStorage, driving the
 * client runtime's session services over the wire), so the host half's job is
 * the HTTP routes the browser half reads: the shared board document and its
 * lease, the permission catalog, the native per-session state bridge, the
 * install source and the live page reports.
 *
 * There is deliberately no `Config` schema here. Settings exist so a user can
 * change plugin behavior, and every behavior this plugin has is already the
 * user's own choice: tasks, schedules, cruise and rules are all board data they
 * edit in the UI, and the surfaces themselves are switched by the plugin page's
 * per-row switches — which write the profile, not a schema. A schema would only
 * add a second control for something that already has one.
 *
 * The plugin contributes FOUR rows, and the plugin page lists a switch per row:
 * this one (the package, which carries the browser half and the host truth),
 * plus `host-board`, `host-items` and `host-agent` — three host-side modules
 * whose whole job is to announce that their surface is on. The loader only
 * evaluates a row whose switch is on, so a switched-off surface is never
 * registered at all rather than present and inert, and no half has to check at
 * runtime — which is the only way a switch stays honest.
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerPermissionRoute } from './host/permission-route.ts'
import { registerSessionStateRoute } from './host/session-state-route.ts'
import { registerBoardRoute } from './host/board-route.ts'
import { registerUpdateRoute } from './host/update-route.ts'
import { registerClientReportRoute } from './host/client-report-route.ts'
import { registerAttachmentRoute } from './host/attachment-route.ts'

/**
 * Only `webServer`. The model's whole surface (three tools, two slash commands,
 * one prompt section) moved to its own row — `host-agent.ts` — so the plugin
 * page can switch it off in one click, and switching it off means the loader
 * never evaluates it rather than a runtime check that could be forgotten.
 */
export const inject = ['webServer']

/** Declared entry point: the board's host routes, one effect per route. */
export function apply(ctx: Context): void {
  // Serve the deployment's native permission-preset catalog to the browser
  // half (the new-task form's permission selector reads this).
  ctx.effect(
    () => registerPermissionRoute(ctx, 'dsh-task-board'),
    'dsh-task-board: permissions route',
  )

  // Serve native per-session plan/goal state (a narrow read-only bridge — no
  // command catalog) to the comment surfaces. Structural reads, so
  // official plan/goal changes flow in with zero maintenance; any missing
  // native service hides that block.
  ctx.effect(
    () => registerSessionStateRoute(ctx),
    'dsh-task-board: session-state route',
  )

  // Images need NO board-side route of their own for a PROMPT: the browser
  // submits the official temporary-bytes part and the host admits it durably as
  // part of taking the prompt. What the plugin's own attachment route adds is the
  // DURABLE reference a document keeps — the official per-Agent upload face mints
  // a receipt for one session, which a checklist row (no session at all) cannot
  // use — plus the read-back every later sender needs. Bytes land in the
  // harness's own store; there is still exactly one place they live.
  ctx.effect(
    () => registerAttachmentRoute(ctx, 'dsh-task-board'),
    'dsh-task-board: attachment route',
  )

  // Serve the host-owned board document (the synced truth every replica —
  // desktop or phone, any origin — reads, commits and watches), plus the
  // engine lease and the launch-command relay.
  ctx.effect(
    () => registerBoardRoute(ctx, 'dsh-task-board'),
    'dsh-task-board: board route',
  )

  // Serve the install source (version + install mode + checkout state) the
  // header's check-for-updates button reads before comparing against npm.
  ctx.effect(
    () => registerUpdateRoute(ctx, 'dsh-task-board'),
    'dsh-task-board: update route',
  )

  // Live page reports (bundle version + measured geometry). Diagnostic only:
  // it is what lets the host answer "which bundle is that phone running, and
  // what did its layout actually compute to" without another screenshot.
  ctx.effect(
    () => registerClientReportRoute(ctx, 'dsh-task-board'),
    'dsh-task-board: client report route',
  )
}

