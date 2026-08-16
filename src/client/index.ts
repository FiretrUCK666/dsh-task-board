/**
 * Task-board client plugin: wires the framework-free core (controller,
 * execution service, store) to the real client runtime and mounts the two
 * DOM surfaces — the sidebar entry row and the board view in the center
 * column.
 *
 * Failure policy: DOM mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and an external
 * plugin must not take the GUI down.
 */
import type { ClientContext, SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and its
// LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { BoardController } from '../core/controller.ts'
import { ExecutionService } from '../core/execution.ts'
import { SchedulerService } from '../core/scheduler.ts'
import { LocalStorageTaskStore } from '../core/store.ts'
import { mountBoard } from './board-mount.tsx'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { RouteSettingsScope } from './route-scope.ts'
import { TaskBoardSettingsCard, TaskBoardSettingsCardController, type TaskBoardSettings } from './TaskBoardSettingsCard.tsx'
import { en, zh, type TaskBoardKey } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'dsh-task-board'

/** Settings namespace the settings card edits (the Host plugin registers it). */
const TASK_BOARD_NS = 'dsh-task-board'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Task-board surface copy. */
    'dsh-task-board': TaskBoardKey
  }

  interface SlotMap {
    /**
     * The plugin-configuration section's list slot. Spelled here with the same
     * shape so this standalone package can register its card into it without
     * depending on a sibling settings UI package.
     */
    'settings.plugin.item': { kind: 'list'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
export interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

/**
 * Required services (fiber inject waiting — the runtime must be up first).
 *
 * `slots` is listed here as a hard service dependency even though it is not
 * declared in `dsh.client.inject` in package.json: the `slots` service is
 * seeded by the web shell itself (@deepseek-ai/dsh-client-ui-slots, served via
 * the platform seed table in web-platform.ts's PLATFORM_MODULES), so it is not
 * a package this plugin needs the loader to bring up. The other four names
 * (sessions/workspaces, connection, locale) correspond one-to-one with the
 * three SDK packages listed in `dsh.client.inject`.
 */
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'locale']

/**
 * Mount the task board.
 * @param ctx - client root context (services: sessions, workspaces).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-task-board: dictionaries')

  // Plugin configuration card: a route-backed scope over the `dsh-task-board`
  // settings namespace, contributed to the plugin-configuration list slot. The
  // scope and its card ride the plugin fiber: the scope's fetch fires at
  // creation and the effect disposer tears everything down on unload.
  const scope = new RouteSettingsScope<TaskBoardSettings>(TASK_BOARD_NS)
  ctx.effect(() => {
    const settingsCard = new TaskBoardSettingsCardController(scope)
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
      name: 'settings.plugin.item',
      id: 'dsh-task-board',
      order: 110,
      locale: NS,
      inject: () => settingsCard.inject(),
    }, TaskBoardSettingsCard))
    return () => { scope.dispose() }
  }, 'dsh-task-board: settings card + scope')

  // The sidebar entry and board view mount once the settings scope settles;
  // while the scope is still loading, the composition default is unknown, so
  // nothing mounts yet. Only an unavailable scope (no settings surface served)
  // falls back to the composition default (enabled).
  let uiDisposer: (() => void) | undefined
  const mountUi = (): void => {
    if (uiDisposer !== undefined) return
    const sessions = ctx.sessions
    const workspaces = ctx.workspaces
    const connection = ctx.get('connection') as ConnectionHandle

    // Core wiring: real runtime faces into the framework-free services.
    const store = new LocalStorageTaskStore()
    const exec = new ExecutionService({
      sessions: {
        list: sessions.list,
        binding: id => sessions.binding(id as SessionId),
      },
      workspaces: {
        list: workspaces.list,
        connectWorkspace: id => workspaces.connectWorkspace(id as WorkspaceId),
      },
      history: {
        loadTail: async sessionId => {
          const response = await connection.api.sessions.history({
            sessionId: sessionId as SessionId,
            maxMessages: 20,
          })
          return response.result.ok
            ? { events: response.result.value.events.map(entry => entry.event) }
            : undefined
        },
      },
      selectModel: async (sessionId, selection) => {
        const response = await connection.api.sessions.selectModel({
          sessionId: sessionId as SessionId,
          provider: selection.provider,
          model: selection.model,
          ...selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {},
        })
        return response.result.ok
          ? { ok: true as const }
          : { ok: false as const, error: `${response.result.error.code}: ${response.result.error.message}` }
      },
      selectAgentPreset: async (sessionId, agentPreset) => {
        const response = await connection.api.agentPresets.select({
          sessionId: sessionId as SessionId,
          agentPreset,
        })
        return response.result.ok
          ? { ok: true as const }
          : { ok: false as const, error: `${response.result.error.code}: ${response.result.error.message}` }
      },
    })
    const controller = new BoardController({
      store,
      exec,
      sessions: {
        list: sessions.list,
        exists: id => sessions.list.getSnapshot().byId[id as SessionId] !== undefined,
        open: id => sessions.open(id as SessionId),
      },
      runCatalog: {
        listWorkspaces: () => workspaces.list.getSnapshot().items.map(item => ({
          id: item.workspaceId,
          title: (item as { title?: string }).title ?? item.workspaceId,
        })),
        listModelGroups: async () => {
          const response = await connection.api.llm.models({})
          if (!response.result.ok) return []
          return response.result.value.groups.map(group => ({
            provider: group.id,
            models: group.models.map(model => ({
              id: model.id,
              name: model.name,
              efforts: (model.reasoning?.efforts ?? []).map(effort => ({
                id: effort.id,
                name: effort.name,
              })),
            })),
          }))
        },
        listAgentPresets: async () => {
          const response = await connection.api.agentPresets.list({})
          if (!response.result.ok) return []
          return response.result.value.presets.map(preset => ({
            id: preset.id,
            name: preset.name,
            description: preset.description,
            isDefault: preset.isDefault,
          }))
        },
      },
    })
    controller.start()

    // Scheduled runs: a browser-side heartbeat that triggers due tasks through
    // the same run path as the manual Run button. The first tick is gated on
    // the session list baseline so a page-load catch-up never fires into a
    // not-yet-ready runtime; tab visibility recovery ticks immediately.
    const scheduler = new SchedulerService({
      tasks: () => controller.getSnapshot().tasks,
      now: () => Date.now(),
      runTask: id => controller.runTask(id),
      applySchedule: (id, nextRunAt, lastTriggeredAt, runCount, disable) =>
        controller.applyScheduleNextRun(id, nextRunAt, lastTriggeredAt, runCount, disable),
      ready: () => sessions.list.getSnapshot().phase === 'ready',
      environment: {
        addEventListener: (type, listener) => document.addEventListener(type, listener),
        removeEventListener: (type, listener) => document.removeEventListener(type, listener),
      },
    })
    scheduler.start()

    const disposers: Array<() => void> = []
    try {
      disposers.push(mountSidebarEntry(controller))
      disposers.push(mountBoard(controller))
    } catch (error) {
      // DOM failures degrade the board, never the GUI.
      console.error('[dsh-task-board] mount failed:', error)
    }

    uiDisposer = () => {
      for (const dispose of disposers.splice(0)) dispose()
      scheduler.dispose()
      controller.dispose()
      uiDisposer = undefined
    }
  }
  const syncEnabled = (): void => {
    const snapshot = scope.getSnapshot()
    const enabled = snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
      : snapshot.status === 'unavailable'
    if (enabled) mountUi()
    else uiDisposer?.()
  }
  scope.subscribe(syncEnabled)
  syncEnabled()
}
