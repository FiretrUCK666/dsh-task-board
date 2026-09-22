/**
 * Host loader entry for the task-board plugin.
 *
 * Everything the board does is browser work (DOM, localStorage, driving the
 * client runtime's session services over the wire), so the host half's job is
 * the HTTP routes the browser half reads: the shared board document and its
 * lease, the permission catalog, the native per-session state bridge, the
 * install source and the live page reports.
 *
 * Settings: the plugin's own profile entry carries the `Config` schema below,
 * and the plugin manager's detail page renders that schema as a form — one page
 * per entry, the board's switch living with the board. A field is editable only
 * when the schema marks it `volatile`, and a volatile field's runtime value is
 * a live reference rather than a plain value, so `pnpm verify` pins both facts
 * (this entry losing its schema or its volatile field loses the page silently).
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerPermissionRoute } from './host/permission-route.ts'
import { registerSessionStateRoute } from './host/session-state-route.ts'
import { registerBoardRoute } from './host/board-route.ts'
import { registerUpdateRoute } from './host/update-route.ts'
import { registerClientReportRoute } from './host/client-report-route.ts'

export const inject = ['webServer']

/**
 * Plugin config, validated by the same-named schemastery schema.
 *
 * The schema's EXPORT NAME is load-bearing: the plugin runtime reads it as
 * `module.Config`, so renaming the binding leaves the loader without a schema —
 * the plugin still loads and every route still registers, but the settings
 * surface treats the entry as unconfigurable and silently drops its page.
 *
 * The one field is `volatile`, which is what makes it editable AND immediate: a
 * write that touches only volatile fields updates the running instance in place
 * rather than reloading it. Its resolved value is a live reference to the
 * current value, not the value itself, so the browser half reads it through
 * `boardEnabledNow` instead of comparing it directly.
 */
export interface Config {
  /**
   * When true (default), the browser half puts the board on screen: the sidebar
   * entry and the board view itself. When false the board is hidden from this
   * deployment while the plugin stays loaded and its host routes stay served —
   * the switch is how the board is hidden without unloading anything, and the
   * plugin manager's own enable switch remains the way to unload it entirely.
   */
  boardEnabled?: boolean
}

/** Plugin config schema (see {@link Config}). */
export const Config: z<Config> = z.object({
  boardEnabled: z.boolean().default(true).volatile(),
}) as unknown as z<Config>

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

  // Images need NO board-side route: the browser submits the official
  // temporary-bytes prompt part (`{type:'image', mediaType, data}`) and the
  // host admits it durably as part of taking the prompt. Display reads back
  // through the official `sessions.attachment` RPC. There is exactly one
  // image mechanism, and it is the native one.

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
