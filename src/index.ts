/**
 * Host loader entry for the task-board plugin.
 *
 * Everything the board does is browser work (DOM, localStorage, driving the
 * client runtime's session services over the wire), so the host half's main
 * behavior is a system-prompt section announcing the plugin to every agent,
 * plus an HTTP settings route that serves the plugin's settings namespace to
 * the browser half. The section registers while this plugin is in the host
 * composition (mount / DSH restart) and disappears when the plugin leaves it
 * (unmount / restart), so agents always know the board exists and how to
 * cooperate with it. The announcement can be turned off through the web
 * settings plugin-configuration surface (`announceToAgent`); the section then
 * disappears live.
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { registerPermissionRoute } from './host/permission-route.ts'
import { registerAttachRoute } from './host/attachment-route.ts'
import { registerSessionStateRoute } from './host/session-state-route.ts'
import { registerSettingsRoute } from './host/settings-route.ts'
import { registerBoardRoute } from './host/board-route.ts'

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 200

export const inject = ['webServer', 'systemPrompt', 'settings']

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const TASK_BOARD_GUIDANCE = '本机已安装 dsh-task-board 独立插件（DSH Web GUI 的任务看板，可挂载到 web profile）：侧边栏「任务看板」入口。能力：多列看板管理任务；任务可真实执行（驱动 agent 会话）；任务支持 5 段 cron 定时执行（如 0 23 * * *）；看板数据（任务/巡航/预设）持久化在 DSH host 端（存储单元 dsh_task_board），任意设备任意浏览器打开同一部署看到的都是同一块板，改动经 SSE 实时同步；手机等窄屏为紧凑布局。限制：调度引擎同一时刻只由一个打开的 GUI 端持有（host 租约仲裁，多端同开不会双份执行），至少一个 GUI 标签页保持打开，否则定时/巡航/接续停摆、错过即跳过；执行消耗 API 额度。用户提到「任务看板 / 看板 / 定时任务」时即指本插件，请据此协作。'

/**
 * Settings namespace of the board's announcement capability — the section the
 * web settings surface edits, and the namespace the settings route serves.
 * Spelled here rather than imported: the browser half spells the same value
 * and must not depend on a Host package.
 */
export const TASK_BOARD_SETTINGS_NAMESPACE = settingsNamespace('dsh-task-board')

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /**
   * When true (default), a system-prompt section announces the board to every
   * agent. Set false to keep the board silent in prompts; agents then learn
   * about it only when the user mentions it.
   */
  announceToAgent?: boolean
  /** Master switch for the plugin (browser half + host announcement). */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  announceToAgent: z.boolean().default(true),
  enabled: z.boolean().default(true),
})

/** Schema default, re-read for hand-built test contexts (the loader applies them normally). */
const DEFAULT_ANNOUNCE = true

/**
 * Register the board's announcement section, gated on the composition entry's
 * `announceToAgent` (and the live settings value once the web settings
 * surface is served). The section is re-registered whenever the source
 * changes, so a settings edit takes effect without a restart.
 * @param ctx - the plugin context (systemPrompt injected).
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export function apply(ctx: Context, config?: Config): void {
  // The live source the announcement reads: the settings section once the web
  // settings surface is served, the composition entry otherwise
  // (installSettingsSection swaps it when the namespace registers).
  let current: () => Config = () => config ?? {}
  let disposeSection: (() => void) | undefined

  // Register (or drop) the announcement to match the current source. The
  // section is kept under one disposer: re-registering first tears the old
  // one down so a duplicate-name registration never throws.
  const sync = (): void => {
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if ((current().enabled ?? true) === false) return
    if ((current().announceToAgent ?? DEFAULT_ANNOUNCE) === false) return
    disposeSection = ctx.systemPrompt.section({
      name: 'plugin:dsh-task-board',
      order: SECTION_ORDER,
      text: TASK_BOARD_GUIDANCE,
    })
  }

  installSettingsSection(ctx, TASK_BOARD_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => { current = source },
    onChange: sync,
  })

  // Serve the settings namespace to the browser half over HTTP.
  ctx.effect(
    () => registerSettingsRoute(ctx, 'dsh-task-board'),
    'dsh-task-board: settings route',
  )

  // Serve the deployment's native permission-preset catalog to the browser
  // half (the new-task form's permission selector reads this).
  ctx.effect(
    () => registerPermissionRoute(ctx, 'dsh-task-board'),
    'dsh-task-board: permissions route',
  )

  // Serve native per-session plan/goal state (a narrow read-only bridge — no
  // command catalog) to the comment and refine surfaces. Structural reads, so
  // official plan/goal changes flow in with zero maintenance; any missing
  // native service hides that block.
  ctx.effect(
    () => registerSessionStateRoute(ctx),
    'dsh-task-board: session-state route',
  )

  // Admit browser-attached images to the durable attachment service so the
  // board's composer can send `{ type: 'image', attachment }` prompt parts —
  // the exact shape the native composer produces.
  ctx.effect(
    () => registerAttachRoute(ctx),
    'dsh-task-board: attachments route',
  )

  // Serve the host-owned board document (the synced truth every replica —
  // desktop or phone, any origin — reads, commits and watches), plus the
  // engine lease and the launch-command relay.
  ctx.effect(
    () => registerBoardRoute(ctx, 'dsh-task-board'),
    'dsh-task-board: board route',
  )

  // Initial registration from the composition entry (covers deployments with
  // no settings service, whose installSettingsSection never fires its hooks).
  sync()
}
