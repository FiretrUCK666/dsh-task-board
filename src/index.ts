/**
 * Host loader entry for the task-board plugin.
 *
 * Everything the board does is browser work (DOM, localStorage, driving the
 * client runtime's session services over the wire), so the host half's main
 * behavior is a system-prompt section announcing the plugin to every agent,
 * plus the HTTP routes the browser half reads. The section registers while
 * this plugin is in the host composition (mount / DSH restart) and disappears
 * when the plugin leaves it (unmount / restart), so agents always know the
 * board exists and how to cooperate with it. The announcement can be turned
 * off through the web settings surface (`announceToAgent`); the section then
 * disappears live, without a restart.
 *
 * Settings: the plugin's own profile entry carries the `Config` schema below,
 * and the plugin manager's detail page renders that schema as a form. A field
 * is editable only when the schema marks it `volatile`, and a volatile field's
 * runtime value is a live reference rather than a plain value — see
 * {@link volatileValue}.
 *
 * There is deliberately no enable switch in this config: the plugin manager
 * already owns activation for every entry, and a second boolean would be a
 * second truth about the same thing. Composed IS enabled — an inactive entry is
 * never evaluated, so nothing here has to check.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { registerPermissionRoute } from './host/permission-route.ts'
import { registerSessionStateRoute } from './host/session-state-route.ts'
import { registerBoardRoute } from './host/board-route.ts'
import { registerUpdateRoute } from './host/update-route.ts'
import { registerClientReportRoute } from './host/client-report-route.ts'

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 200

export const inject = ['webServer', 'systemPrompt', 'settings']

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const TASK_BOARD_GUIDANCE = '本机已安装 dsh-task-board 独立插件（DSH Web GUI 的任务看板，可挂载到 web profile）：侧边栏「任务看板」入口。能力：多列看板管理任务；任务可真实执行（驱动 agent 会话）；任务支持 5 段 cron 定时执行（如 0 23 * * *）；看板数据（任务/巡航/预设）持久化在 DSH host 端（存储单元 dsh_task_board），任意设备任意浏览器打开同一部署看到的都是同一块板，改动经 SSE 实时同步；手机等窄屏为紧凑布局。限制：调度引擎同一时刻只由一个打开的 GUI 端持有（host 租约仲裁，多端同开不会双份执行），至少一个 GUI 标签页保持打开，否则定时/巡航/接续停摆、错过即跳过；执行消耗 API 额度。用户提到「任务看板 / 看板 / 定时任务」时即指本插件，请据此协作。'

/**
 * Settings namespace of the board's own capabilities. It names the profile
 * entry this plugin occupies, so it is the same identifier the bundle patch
 * inserts and the browser half spells. Spelled here rather than imported: the
 * browser half spells the same value and must not depend on a Host package.
 */
export const TASK_BOARD_SETTINGS_NAMESPACE = 'dsh-task-board'

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /**
   * When true (default), a system-prompt section announces the board to every
   * agent. Set false to keep the board silent in prompts; agents then learn
   * about it only when the user mentions it.
   */
  announceToAgent?: boolean
}

/**
 * Plugin config schema. The EXPORT NAME is load-bearing: the plugin runtime
 * reads it as `module.Config`, so renaming this binding to anything else leaves
 * the loader without a schema — the plugin still loads and every route still
 * registers, but the settings surface treats the entry as unconfigurable and
 * silently drops its page. A test pins the name for that reason.
 *
 * The field is `volatile`: a configuration write that touches only volatile
 * fields updates the running instance in place — the plugin is never unloaded,
 * and `apply` is never re-run — so a settings edit takes effect without a
 * restart. `pnpm verify` asserts the schema keeps at least one volatile field,
 * because an entry with none is skipped by the settings service the same way.
 *
 * The declared output type is the plain value shape. A volatile field's
 * resolved output is a live reference to that value rather than the value
 * itself, which is why {@link apply} receives {@link ResolvedConfig} and reads
 * through {@link volatileValue} instead of comparing the field directly.
 */
export const Config: z<Config> = z.object({
  announceToAgent: z.boolean().default(true).volatile(),
}) as unknown as z<Config>

/** The resolved config {@link apply} receives (each volatile field is a live reference). */
export type ResolvedConfig = ReturnType<typeof Config>

/** Schema default, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULT_ANNOUNCE = true

/**
 * Read one config field's current value. A schema field marked `volatile`
 * resolves to a stable live reference rather than a plain value, so comparing
 * it directly would silently read "always truthy" and leave the switch stuck
 * on. Anything non-volatile (a hand-built test config, a schema that drops the
 * marker) is already a plain value and passes through.
 * @param field - the resolved config field.
 * @param fallback - the schema default, for an absent field.
 * @returns the current plain value.
 */
function volatileValue(field: unknown, fallback: boolean): boolean {
  if (field === undefined || field === null) return fallback
  const candidate = field as { get?: unknown }
  const current = typeof candidate.get === 'function'
    ? (candidate.get as () => unknown)()
    : field
  return typeof current === 'boolean' ? current : fallback
}

/**
 * Register the board's announcement section, gated on the live
 * `announceToAgent` value. The section is re-registered whenever it changes, so
 * a settings edit takes effect without a restart.
 * @param ctx - the plugin context (systemPrompt injected).
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export function apply(ctx: Context, config?: ResolvedConfig): void {
  // The live source the announcement reads: the resolved entry config, whose
  // volatile fields are live references the settings service updates in place.
  const current = (): ResolvedConfig => config ?? ({} as ResolvedConfig)

  // Register (or drop) the announcement to match the current config. The
  // section is kept under one disposer: re-registering first tears the old
  // one down so a duplicate-name registration never throws.
  let disposeSection: (() => void) | undefined
  const sync = (): void => {
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (!volatileValue(current().announceToAgent, DEFAULT_ANNOUNCE)) return
    disposeSection = ctx.systemPrompt.section({
      name: 'plugin:dsh-task-board',
      order: SECTION_ORDER,
      text: TASK_BOARD_GUIDANCE,
    })
  }

  // A configuration write that touches only volatile fields keeps this
  // instance running and republishes the values in place, so the section is
  // re-derived from this event rather than from a re-run of apply().
  ctx.on('loader/volatile-update', sync)

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

  // Initial registration from the resolved entry config (covers the value the
  // announcement reads before the first configuration write).
  sync()
}
