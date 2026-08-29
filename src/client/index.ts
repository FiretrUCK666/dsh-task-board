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
import { QuestionTracker } from './board/question-tracker.ts'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and its
// LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { BoardController, type HostImageRef, type PermissionOptionShape, type ReferenceRemoteFace, type SessionConfigFace, type SessionTodoShape, type SlashCandidate, type TranscriptLoadResult, type TranscriptProjectionsShape } from '../core/controller.ts'
import { ExecutionService } from '../core/execution.ts'
import { SchedulerService } from '../core/scheduler.ts'
import { LocalStorageTaskStore } from '../core/store.ts'
import { LocalStoragePresetStore } from '../core/presets.ts'
import { LocalStorageRunPresetStore } from '../core/run-presets.ts'
import { BoardSyncClient, SyncedCruiseStore, SyncedPresetStore, SyncedRunPresetStore, SyncedTaskStore } from '../core/host-sync.ts'
import type { BoardView, CruiseValue } from '../core/board-doc.ts'
import { createBoardTransport } from './board-transport.ts'
import { mountBoard } from './board-mount.tsx'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { RouteSettingsScope } from './route-scope.ts'
import { TaskBoardSettingsCard, TaskBoardSettingsCardController, type TaskBoardSettings } from './TaskBoardSettingsCard.tsx'
import { en, t, zh, type TaskBoardKey } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'dsh-task-board'

/** Settings namespace the settings card edits (the Host plugin registers it). */
const TASK_BOARD_NS = 'dsh-task-board'

/** localStorage key for the auto-cruise state (toggle + concurrency limit). */
const CRUISE_STORAGE_KEY = 'dsh.taskBoard.cruise.v1'

/** localStorage key where a diverging pre-sync local ledger is parked (the
 *  host truth wins on first connect; the local copy is never silently lost). */
const PRE_SYNC_BACKUP_KEY = 'dsh.taskBoard.preSync.v1'

/** Read the four local board keys as a single view (the sync migration source). */
function readLocalView(): BoardView {
  let cruise: CruiseValue = { enabled: false, limit: 5, schedule: [] }
  try {
    const raw = localStorage.getItem(CRUISE_STORAGE_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<CruiseValue>
      cruise = {
        enabled: parsed.enabled === true,
        ...typeof parsed.manual === 'boolean' ? { manual: parsed.manual } : {},
        limit: typeof parsed.limit === 'number' && Number.isInteger(parsed.limit) && parsed.limit >= 1 ? parsed.limit : 5,
        schedule: Array.isArray(parsed.schedule) ? parsed.schedule : [],
      }
    }
  } catch (error) {
    console.error('[dsh-task-board] local cruise read failed', error)
  }
  return {
    tasks: new LocalStorageTaskStore().load(),
    cruise,
    schedulePresets: new LocalStoragePresetStore().load(),
    runPresets: new LocalStorageRunPresetStore().load(),
  }
}

/** Write the four local board keys from a view (the offline first-paint mirror). */
function writeMirror(view: BoardView): void {
  new LocalStorageTaskStore().save(view.tasks)
  new LocalStoragePresetStore().save(view.schedulePresets)
  new LocalStorageRunPresetStore().save(view.runPresets)
  try {
    localStorage.setItem(CRUISE_STORAGE_KEY, JSON.stringify(view.cruise))
  } catch (error) {
    console.error('[dsh-task-board] cruise mirror write failed', error)
  }
}

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
    'settings.plugin.item': { kind: 'keyed'; scope: 'root'; owner: SettingsPluginItemOwnerProps }
  }
}

/** Owner share of a plugin card (the section supplies nothing). */
interface SettingsPluginItemOwnerProps {
  /** Marker field: card owner props are intentionally empty. */
  children?: never
}

/**
 * Structural face of the client remote bridge (the web shell's `remote`
 * service from dsh-api-gateway): the prompt autocomplete reads the live host
 * command registry through `remote.commands.list` — the same catalog the
 * native composer's '/' menu consumes — and slash-command comment rounds
 * execute through `remote.commands.execute`, the same RPC the native
 * composer's '/' submissions use. Narrowed structurally so no SDK package is
 * imported; unavailable surfaces degrade to "no menu" / plain-text comments.
 */
interface RemoteCommandsFace {
  list(sessionId: string): Promise<
    | { ok: true; value: readonly { name: string; description: string; input?: { hint?: string } }[] }
    | { ok: false; error: { code: string; message: string } }
  >
  execute(sessionId: string, line: string, images?: readonly unknown[], signal?: AbortSignal): Promise<
    | { ok: true; value: { commandId: string; result: { kind: 'success' | 'error'; text?: string } } | undefined }
    | { ok: false; error: { code: string; message: string } }
  >
}

interface RemoteFace {
  commands?: RemoteCommandsFace
}

/** THE one client-remote resolution: the host command registry by registered
 *  name (`remote.commands`), with the parent remote service's child property
 *  as the fallback. Three surfaces read the same bridge — the slash menu, the
 *  slash-command send and the /permission switch — so the resolution grammar
 *  and its "unavailable" warning live here once, never in three copies.
 *  Nothing is hard-coded: commands registered by DSH or any plugin show up
 *  without a plugin update. */
function commandsOf(ctx: ClientContext): RemoteCommandsFace | undefined {
  const commands = ctx.get('remote.commands') as RemoteCommandsFace | undefined
    ?? (ctx.get('remote') as RemoteFace | undefined)?.commands
  if (commands === undefined) {
    console.warn('[dsh-task-board] slash commands unavailable: no remote.commands bridge')
  }
  return commands
}

/** THE one native model-selection write: the sessions.selectModel API — the
 *  run config's model route and the session panel's model selector submit
 *  the same wire call, so the mapping exists once. */
async function selectModelOf(
  connection: ConnectionHandle,
  sessionId: string,
  selection: { provider: string; model: string; reasoningEffort?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await connection.api.sessions.selectModel({
    sessionId: sessionId as SessionId,
    provider: selection.provider,
    model: selection.model,
    ...selection.reasoningEffort !== undefined ? { reasoningEffort: selection.reasoningEffort } : {},
  })
  return response.result.ok
    ? { ok: true as const }
    : { ok: false as const, error: `${response.result.error.code}: ${response.result.error.message}` }
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
 * Structural pick of the two context projections the review page reads from
 * the history tail page. `values` is typed as `Partial<SessionProjectionMap>`,
 * a merge table whose keys exist only when the domain packages are imported —
 * this plugin never imports them, so every field is read and shape-guarded
 * structurally. Anything that is not a plain object with the expected numeric
 * fields is dropped (the key's absence is handled gracefully downstream).
 */
function pickProjections(values: Record<string, unknown> | undefined): Pick<TranscriptLoadResult, 'projections'> {
  if (values === undefined) return {}
  const pressure = values.contextPressure
  const breakdown = values.contextBreakdown
  const permissions = values.permissions
  const projections: TranscriptProjectionsShape = {}
  if (typeof pressure === 'object' && pressure !== null) {
    const entry = pressure as Record<string, unknown>
    projections.contextPressure = {
      ...typeof entry.pressureTokens === 'number' ? { pressureTokens: entry.pressureTokens } : {},
      ...typeof entry.projectedTokens === 'number' ? { projectedTokens: entry.projectedTokens } : {},
      ...typeof entry.contextWindow === 'number' ? { contextWindow: entry.contextWindow } : {},
    }
  }
  if (typeof breakdown === 'object' && breakdown !== null) {
    const entry = breakdown as Record<string, unknown>
    const systemTokens = entry.systemTokens
    const toolsTokens = entry.toolsTokens
    const messageTokens = entry.messageTokens
    if (typeof systemTokens === 'number' && typeof toolsTokens === 'number' && typeof messageTokens === 'number') {
      projections.contextBreakdown = { systemTokens, toolsTokens, messageTokens }
    }
  }
  if (typeof permissions === 'object' && permissions !== null) {
    const entry = permissions as Record<string, unknown>
    const options = entry.options
    const currentValue = entry.currentValue
    if (Array.isArray(options) && typeof currentValue === 'string') {
      const rows: PermissionOptionShape[] = []
      for (const option of options) {
        if (typeof option !== 'object' || option === null) continue
        const row = option as Record<string, unknown>
        if (typeof row.value === 'string' && typeof row.name === 'string') {
          rows.push({
            value: row.value,
            name: row.name,
            ...typeof row.description === 'string' ? { description: row.description } : {},
          })
        }
      }
      if (rows.length > 0) projections.permissions = { options: rows, currentValue }
    }
  }
  // The official `todos` projection (the harness's own TodoPanel reads the
  // same host-computed whole list) — structural pick, no typing imports.
  const todos = values.todos
  if (Array.isArray(todos)) {
    const rows: SessionTodoShape[] = []
    for (const item of todos) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as Record<string, unknown>
      if (typeof row.content !== 'string' || row.content === '') continue
      const status = row.status === 'in_progress' || row.status === 'completed' ? row.status : 'pending'
      rows.push({ content: row.content, status })
    }
    if (rows.length > 0) projections.todos = rows
  }
  return projections.contextPressure !== undefined || projections.contextBreakdown !== undefined || projections.permissions !== undefined || projections.todos !== undefined
    ? { projections }
    : {}
}

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
      key: 'dsh-task-board',
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
  let mounting = false
  const mountUi = (): void => {
    if (uiDisposer !== undefined || mounting) return
    mounting = true
    void mountUiBody().finally(() => { mounting = false })
  }
  const mountUiBody = async (): Promise<void> => {
    if (uiDisposer !== undefined) return
    const sessions = ctx.sessions
    const workspaces = ctx.workspaces
    const connection = ctx.get('connection') as ConnectionHandle

    // ── sync client: this tab becomes a replica of the host board document ──
    // The client boots BEFORE the controller so the first ledger the board
    // renders is already the host truth (or, if the host serves no synced
    // board, the plain localStorage mode — today's behavior, unchanged).
    const sync = new BoardSyncClient({
      transport: createBoardTransport(),
      defer: (fn, ms) => {
        const timer = setTimeout(fn, ms)
        return () => clearTimeout(timer)
      },
    })
    // A diverging local ledger is parked under a dedicated key before the
    // host truth overwrites the mirror (nothing is ever silently dropped).
    sync.onBackup(view => {
      try {
        localStorage.setItem(PRE_SYNC_BACKUP_KEY, JSON.stringify({ savedAt: Date.now(), ...view }))
        console.warn('[dsh-task-board] local board data differed from the host truth; kept a copy under', PRE_SYNC_BACKUP_KEY)
      } catch (error) {
        console.error('[dsh-task-board] pre-sync backup failed', error)
      }
    })
    const mode = await sync.start(readLocalView)
    const synced = mode === 'synced'
    if (synced) {
      // Warm the offline mirror with the host truth so a later reload (or a
      // dropped connection) first-paints the real board, not a stale copy.
      writeMirror(sync.view())
    }

    // Core wiring: real runtime faces into the framework-free services.
    const store = synced
      ? new SyncedTaskStore(sync, new LocalStorageTaskStore())
      : new LocalStorageTaskStore()
    // Comment continuations go through the host-level session.prompt API:
    // it addresses any session id (the execution session is usually not
    // the currently staged one, so a client binding is not guaranteed). The
    // same channel serves the linked-session panel's direct composer
    // (sessionMessage) — "typing in the native conversation" is exactly
    // this call, shared by both callers. Durable attachment refs (admitted
    // through the host attachment bridge) ride the content as native image
    // blocks — the same parts the native composer produces.
    const sendComment = async (
      sessionId: string,
      text: string,
      images?: readonly HostImageRef[] | undefined,
      mode: 'queue' | 'steer' = 'queue',
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const content: Array<{ type: string; text?: string; attachment?: unknown }> = text.trim() !== ''
        ? [{ type: 'text', text }]
        : []
      if (images !== undefined) {
        for (const image of images) {
          content.push({ type: 'image', attachment: { attachmentId: image.attachmentId, mediaType: image.mediaType } })
        }
      }
      if (content.length === 0) return { ok: false as const, error: 'empty message' }
      const response = await connection.api.sessions.prompt({
        sessionId: sessionId as SessionId,
        // The OFFICIAL prompt disposition: queue injects in order; steer
        // interrupts the current turn now (the composer's 插话 — a steer is
        // only a steer when the wire says so).
        mode,
        content: content as never,
      })
      return response.result.ok
        ? { ok: true as const }
        : { ok: false as const, error: `${response.result.error.code}: ${response.result.error.message}` }
    }
    // Slash-command lines execute through the native command registry — the
    // same RPC the composer's '/' submissions use. The plain prompt path
    // would deliver the line to the model as text, which is exactly the
    // "command doesn't work" symptom; the registry path never produces a
    // model turn. matched=false = the registry did not recognize the line
    // (the caller then falls back to plain text, matching the native
    // composer's default-sink behavior).
    const sendCommand = async (sessionId: string, line: string): Promise<
      | { ok: true; matched: boolean; outcome?: { kind: 'success' | 'error'; text?: string } }
      | { ok: false; error: string }
    > => {
      const commands = commandsOf(ctx)
      if (commands === undefined) {
        return { ok: true as const, matched: false }
      }
      try {
        // Official signature: (agent, line, images, signal) — three business
        // arguments plus an optional AbortSignal. Images are empty for a plain
        // invocation (the composer's picture attachments pass through here).
        const result = await commands.execute(sessionId as SessionId, line, [], new AbortController().signal)
        if (!result.ok) {
          return { ok: false as const, error: `${result.error.code}: ${result.error.message}` }
        }
        return {
          ok: true as const,
          matched: result.value !== undefined,
          ...result.value !== undefined
            ? { outcome: { kind: result.value.result.kind, ...result.value.result.text !== undefined ? { text: result.value.result.text } : {} } }
            : {},
        }
      } catch (error) {
        console.warn('[dsh-task-board] slash command execution failed:', error)
        return { ok: false as const, error: String(error) }
      }
    }
    const exec = new ExecutionService({
      sessions: {
        list: sessions.list,
        binding: id => sessions.binding(id as SessionId),
      },
      workspaces: {
        list: workspaces.list,
        connectWorkspace: id => workspaces.connectWorkspace(id as WorkspaceId),
      },
      // The detail page's "新建会话": a guaranteed-FRESH host session —
      // never the workspace blank-reuse entry. The concrete runtime's
      // create() guarantees the session is in the list store and addressable
      // on resolution (the New Session draft hand-off guarantee), so the
      // binding and the linked derivation can use it at once; read
      // structurally (ISessions does not declare it) with the raw wire
      // create as the fallback.
      createSession: async workspaceId => {
        const target = workspaceId as WorkspaceId
        const runtime = ctx.sessions as Partial<typeof ctx.sessions> & {
          create?: (opts?: { workspaceId?: WorkspaceId }) => Promise<SessionId>
        }
        if (runtime.create !== undefined) {
          return runtime.create({ workspaceId: target })
        }
        const response = await connection.api.sessions.create({ workspaceId: target })
        if (!response.result.ok) {
          throw new Error(`${response.result.error.code}: ${response.result.error.message}`)
        }
        return response.result.value.sessionId
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
      selectModel: (sessionId, selection) => selectModelOf(connection, sessionId, selection),
      selectAgentPreset: async (sessionId, agentPreset) => {
        const response = await connection.api.agentPresets.select({
          sessionId: sessionId as SessionId,
          agentPreset,
        })
        return response.result.ok
          ? { ok: true as const }
          : { ok: false as const, error: `${response.result.error.code}: ${response.result.error.message}` }
      },
      sendComment: (sessionId, text, mode) => sendComment(sessionId, text, undefined, mode),
      sendCommand,
      // Session rename: the OFFICIAL user-title write (host-level rename RPC
      // — works for any session id, not just bound/staged ones). The native
      // semantics own the conflict story: an accepted title pins against
      // automatic regeneration; the wire error text is surfaced verbatim.
      renameSession: async (sessionId, title) => {
        const response = await connection.api.sessions.rename({
          sessionId: sessionId as SessionId,
          title,
        })
        return response.result.ok
          ? { ok: true as const }
          : { ok: false as const, error: `${response.result.error.code}: ${response.result.error.message}` }
      },
    })
    // Review-page transcripts: the recent history window of an execution
    // session (raw events; the review page folds them into messages), plus
    // the native projection baseline (context pressure / breakdown) that the
    // history tail page carries — the same values the native context meter
    // reads, so the board's usage strip is always the real occupancy figure.
    const transcriptLoader = async (sessionId: string): Promise<TranscriptLoadResult | undefined> => {
      try {
        const response = await connection.api.sessions.history({
          sessionId: sessionId as SessionId,
          maxMessages: 30,
        })
        if (!response.result.ok) return undefined
        const value = response.result.value
        // The projection values ride the history tail page as a
        // `Partial<SessionProjectionMap>` — a merge table whose keys exist
        // only when the domain packages are type-imported. Read the two
        // fields we consume structurally (never a dependency on a domain
        // package), dropping any value that fails the shape guard.
        const projections = value.projections?.values as Record<string, unknown> | undefined
        return {
          events: value.events.map(entry => entry.event),
          ...pickProjections(projections),
        }
      } catch (error) {
        console.error('[dsh-task-board] transcript read failed', error)
        return undefined
      }
    }

    // Slash-menu sources (see listSlashCandidates): each fetches one native
    // catalog and degrades to [] on any failure, with the reason logged.
    const fetchSlashCommands = async (sessionId: string): Promise<readonly SlashCandidate[]> => {
      const commands = commandsOf(ctx)
      if (commands === undefined) return []
      try {
        const result = await commands.list(sessionId as SessionId)
        if (!result.ok) {
          console.warn('[dsh-task-board] slash commands unavailable:', result.error.code, result.error.message)
          return []
        }
        return result.value.map(descriptor => ({
          name: descriptor.name,
          description: descriptor.description,
          ...descriptor.input !== undefined && descriptor.input.hint !== undefined
            ? { hint: descriptor.input.hint }
            : {},
          kind: 'command' as const,
        }))
      } catch (error) {
        console.warn('[dsh-task-board] slash commands unavailable:', error)
        return []
      }
    }

    const fetchSlashSkills = async (sessionId: string): Promise<readonly SlashCandidate[]> => {
      // The skill catalog (native `skill.list`), one candidate per skill
      // name; user-only skills are marked like the native composer does.
      try {
        const response = await connection.api.skills.list({ sessionId: sessionId as SessionId })
        if (!response.result.ok) {
          console.warn('[dsh-task-board] slash skills unavailable:', response.result.error.code, response.result.error.message)
          return []
        }
        return response.result.value.skills.map(skill => ({
          name: skill.name,
          description: skill.modelInvocable
            ? skill.description
            : `${t('prompt.skillUserOnly')} · ${skill.description}`,
          kind: 'skill' as const,
        }))
      } catch (error) {
        console.warn('[dsh-task-board] slash skills unavailable:', error)
        return []
      }
    }

    // The OFFICIAL '@' reference bridge: the two Remote namespaces behind the
    // harness's own ui-reference source (file discovery + session-reference
    // discovery). Read structurally, exactly like remote.commands above —
    // namespace service by registered name first, then the parent remote
    // service's child property. Absent namespaces degrade to "no @ menu"
    // (see reference-source.ts); nothing is hard-coded, so the deployment's
    // own file/session discovery is consumed as-is.
    const referenceBridge = ((): ReferenceRemoteFace | undefined => {
      const fileReferences = ctx.get('remote.fileReferences') as ReferenceRemoteFace['fileReferences'] | undefined
        ?? (ctx.get('remote') as Partial<ReferenceRemoteFace> | undefined)?.fileReferences
      const sessionReferenceResolver = ctx.get('remote.sessionReferenceResolver') as ReferenceRemoteFace['sessionReferenceResolver'] | undefined
        ?? (ctx.get('remote') as Partial<ReferenceRemoteFace> | undefined)?.sessionReferenceResolver
      if (fileReferences === undefined && sessionReferenceResolver === undefined) {
        console.warn('[dsh-task-board] @ reference menu unavailable: no remote file/session bridge')
        return undefined
      }
      return {
        ...fileReferences !== undefined ? { fileReferences } : {},
        ...sessionReferenceResolver !== undefined ? { sessionReferenceResolver } : {},
      }
    })()

    // Pending native questions ride the board's own mux stream: the host
    // replays every still-pending frame on open, and answers flow through
    // the same respond wire call the native composer uses — the only path
    // that can settle a suspended ask_user_question.
    const questionTracker = new QuestionTracker(connection.api)
    const controller = new BoardController({
      store,
      exec,
      questionRpc: questionTracker,
      // Presets ride the shared document in synced mode (edits propagate to
      // every replica), the local keys otherwise. The localStorage instance
      // stays as the offline mirror behind the synced one.
      presetStore: synced ? new SyncedPresetStore(sync, new LocalStoragePresetStore()) : undefined,
      runPresetStore: synced ? new SyncedRunPresetStore(sync, new LocalStorageRunPresetStore()) : undefined,
      // A non-engine replica relays a user-initiated launch to the lease
      // holder (the host forwards it over the SSE command frame). In fallback
      // mode this replica is always the engine, so the relay is never used.
      requestLaunch: synced
        ? (taskId, trigger) => { sync.requestLaunch(taskId, trigger) }
        : undefined,
      sessions: {
        list: sessions.list,
        exists: id => sessions.list.getSnapshot().byId[id as SessionId] !== undefined,
        open: id => sessions.open(id as SessionId),
      },
      workspaces: {
        // Live "链接会话" derivation: one workspace's accounted sessions +
        // the registry-global archive set (the native grouping facts).
        list: {
          getSnapshot: () => {
            const snap = workspaces.list.getSnapshot()
            return {
              items: snap.items.map(item => ({ id: item.workspaceId, title: item.title, sessionIds: item.sessionIds })),
              archivedSessionIds: snap.archivedSessionIds,
            }
          },
          subscribe: fn => workspaces.list.subscribe(fn),
        },
      },
      // The OFFICIAL '@' reference bridge: the two Remote namespaces behind
      // the harness's own ui-reference source (file discovery + session
      // discovery), read structurally like remote.commands — absent namespaces
      // degrade to "no @ menu" (the prompt inputs stay fully usable).
      reference: referenceBridge,
      // Auto-cruise state persists across reloads (toggle + concurrency). In
      // synced mode it rides the shared document section (every replica sees
      // the same switch/limit/windows); in fallback mode it stays local.
      cruiseStorage: synced
        ? new SyncedCruiseStore(sync)
        : {
            read: () => {
              try {
                const raw = localStorage.getItem(CRUISE_STORAGE_KEY)
                if (raw === null) return undefined
                const parsed = JSON.parse(raw) as { enabled?: boolean; manual?: boolean; limit?: number }
                return {
                  enabled: parsed.enabled === true,
                  ...(parsed.manual === true || parsed.manual === false ? { manual: parsed.manual } : {}),
                  limit: parsed.limit,
                }
              } catch (error) {
                console.error('[dsh-task-board] cruise state read failed', error)
                return undefined
              }
            },
            write: state => {
              try {
                localStorage.setItem(CRUISE_STORAGE_KEY, JSON.stringify(state))
              } catch (error) {
                console.error('[dsh-task-board] cruise state write failed (persistence skipped)', error)
              }
            },
          },
      // Review-page transcripts: recent history of an execution session.
      transcript: transcriptLoader,
      // Review-page session panel: the live model directory + selection of
      // the execution session, straight from the native models/selectModel
      // APIs (the same sources the native model selector reads), and the
      // native `/permission` command path for permission switches.
      sessionConfig: {
        readModels: async sessionId => {
          try {
            const response = await connection.api.sessions.models({ sessionId: sessionId as SessionId })
            if (!response.result.ok) return undefined
            const value = response.result.value
            return {
              current: {
                provider: value.current.provider,
                model: value.current.model,
                ...value.current.reasoningEffort !== undefined ? { reasoningEffort: value.current.reasoningEffort } : {},
              },
              groups: value.groups.map(group => ({
                provider: group.id,
                models: group.models.map(model => ({
                  id: model.id,
                  name: model.name,
                  ...model.reasoning !== undefined
                    ? {
                      reasoning: {
                        efforts: model.reasoning.efforts.map(effort => ({ id: effort.id, name: effort.name })),
                        ...model.reasoning.defaultEffort !== undefined ? { defaultEffort: model.reasoning.defaultEffort } : {},
                      },
                    }
                    : {},
                })),
              })),
            }
          } catch (error) {
            console.error('[dsh-task-board] session models read failed', error)
            return undefined
          }
        },
        selectModel: (sessionId, selection) => selectModelOf(connection, sessionId, selection),
        setPermission: async (sessionId, permission) => {
          // The native write path for per-session permission switches: the
          // `/permission` command through the host command registry (the
          // same RPC the GUI's permission picker uses). The plain prompt
          // path would deliver the line to the model as text — the agent
          // would answer in natural language instead of the permission
          // actually changing. The registry path never produces a model
          // turn; an unrecognized line reports unmatched.
          const commands = commandsOf(ctx)
          if (commands === undefined) {
            return { ok: false as const, error: 'permission commands unavailable: no remote.commands bridge' }
          }
          try {
            const result = await commands.execute(sessionId as SessionId, `/permission ${permission}`, [], new AbortController().signal)
            if (!result.ok) {
              return { ok: false as const, error: `${result.error.code}: ${result.error.message}` }
            }
            if (result.value === undefined) {
              return { ok: false as const, error: 'the host offers no /permission command for this session' }
            }
            const outcome = result.value.result
            return outcome.kind === 'success'
              ? { ok: true as const }
              : { ok: false as const, error: outcome.text ?? 'permission switch failed' }
          } catch (error) {
            console.warn('[dsh-task-board] permission switch failed:', error)
            return { ok: false as const, error: String(error) }
          }
        },
      } satisfies SessionConfigFace,
      // Linked-session panel's direct composer: the exact same host
      // channels as comment continuations — the message goes to the native
      // session itself (typing there), never through the task's dispatcher.
      sessionMessage: sendComment,
      sessionCommand: sendCommand,
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
        listPermissions: async () => {
          // The deployment's native permission-preset catalog, served by the
          // host half from the `permissionPresets` service — never a
          // hard-coded list, so preset-table changes in the harness show up
          // without a plugin update. Any failure degrades to "no selector".
          try {
            const response = await fetch('/api/dsh-task-board/permissions', { headers: { accept: 'application/json' } })
            const envelope = await response.json() as {
              ok: boolean
              value?: { available?: boolean; options?: Array<{ id: string; name?: string; description?: string }> }
            }
            if (envelope.ok !== true || envelope.value?.available !== true) return undefined
            const options = envelope.value.options
            if (!Array.isArray(options)) return undefined
            return options.map(option => ({
              id: option.id,
              name: option.name,
              description: option.description,
            }))
          } catch (error) {
            console.error('[dsh-task-board] permission catalog fetch failed', error)
            return undefined
          }
        },
        listSlashCandidates: async () => {
          // The slash menu merges the two native sources the composer's '/'
          // menu reads: host commands (live command registry via the remote
          // bridge) and skills (the skill catalog — every skill name is a
          // slash entry). One session scopes both; a missing session hides
          // the menu; a failing source degrades to the other one.
          const list = sessions.list.getSnapshot()
          const sessionId = list.current ?? Object.keys(list.byId)[0]
          if (sessionId === undefined) {
            console.warn('[dsh-task-board] slash catalog unavailable: no session to scope it to')
            return undefined
          }
          const [commands, skills] = await Promise.all([
            fetchSlashCommands(sessionId),
            fetchSlashSkills(sessionId),
          ])
          return [...commands, ...skills]
        },
      },
    })
    controller.start()
    // The localized 未命名 placeholder the session rows show for a session
    // the host has not titled yet (the host names it automatically from the
    // first real message).
    controller.untitledSessionLabel = t('detail.sessionUntitled')

    // Sync wiring (only meaningful in synced mode): the replica's engine seat
    // follows the host lease, and every remote document lands in the
    // controller + refreshes the offline mirror. sync.start already awaited
    // the first lease probe, so isEngine() is authoritative here.
    if (synced) {
      controller.setEngine(sync.isEngine())
      sync.onRemote(view => {
        controller.applyRemote(view)
        writeMirror(view)
      })
      sync.onEngine(held => { controller.setEngine(held) })
      sync.onCommand(command => { void controller.runTask(command.taskId, command.trigger) })
    }

    // Scheduled runs: a browser-side heartbeat that triggers due tasks through
    // the same run path as the manual Run button. The first tick is gated on
    // the session list baseline so a page-load catch-up never fires into a
    // not-yet-ready runtime; tab visibility recovery ticks immediately. In
    // synced mode the heartbeat ALSO requires the engine seat — a non-engine
    // replica ticks a no-op (the engine drives automation for all of them),
    // so many open boards never double-fire a schedule.
    const scheduler = new SchedulerService({
      tasks: () => controller.getSnapshot().tasks,
      now: () => Date.now(),
      // Auto triggers never prime a rule: they only drive tasks a manual run
      // has started.
      runTask: id => controller.runTask(id, 'schedule'),
      applySchedule: (id, nextRunAt, lastTriggeredAt, runCount, disable) =>
        controller.applyScheduleNextRun(id, nextRunAt, lastTriggeredAt, runCount, disable),
      ready: () => sessions.list.getSnapshot().phase === 'ready' && (!synced || sync.isEngine()),
      // Cruise scheduled windows flip on/off at their boundaries on the same
      // heartbeat as task schedules.
      cruiseTick: now => controller.tickCruise(now),
      // Session automation rules fire their due instructions (cron) on the
      // same heartbeat.
      sessionRulesTick: now => controller.tickSessionRules(now),
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
      sync.dispose()
      controller.dispose()
      questionTracker.dispose()
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
