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
import type { ApiFace, BoundSessionFace, ClientContext, GoalsRemoteFace, ILayoutFace, IUiSessionFace, IUiWorkspaceFace, SessionId, WorkspaceId } from './platform.ts'
import { buildApi, sessionDriverOf } from './platform.ts'
import { QuestionTracker } from './board/question-tracker.ts'
import { PendingMirror, type UiSessionMirrorFace } from './board/pending-mirror.ts'
import { BoardController, type PromptFile, type PromptImage, type ReferenceRemoteFace, type SessionConfigFace, type SlashCandidate, type TranscriptEventShape, type TranscriptLoadResult, type TranscriptPage } from '../core/controller.ts'
import { pickTranscriptProjections } from '../core/projections.ts'
import { UNTITLED_SESSION_KEY } from '../core/session-list.ts'
import { ExecutionService, type ExecutionHistoryEvent, type SessionDriver } from '../core/execution.ts'
import { SchedulerService } from '../core/scheduler.ts'
import { LocalStorageTaskStore } from '../core/store.ts'
import { LocalStoragePresetStore } from '../core/presets.ts'
import { LocalStorageRunPresetStore } from '../core/run-presets.ts'
import { LocalStorageSessionAgentStore, recordApplied } from '../core/session-agents.ts'
import { BoardSyncClient, SyncedCruiseStore, SyncedPresetStore, SyncedRunPresetStore, SyncedTaskStore } from '../core/host-sync.ts'
import { createTranscriptReader } from './transcript-cache.ts'
import { watchSessionActivity } from './board/activity-wake.ts'
import { nativeTurnOf } from '../core/session-activity.ts'
import type { BoardView, CruiseValue } from '../core/board-doc.ts'
import { createBoardTransport } from './board-transport.ts'
import { TaskBoardPanel } from './TaskBoardPanel.tsx'
import { TaskBoardIcon } from './TaskBoardIcon.tsx'
import { BundleFreshnessState, reloadForFreshBundle } from './bundle-freshness.ts'
import { fetchUpdateSource } from './update-source.ts'
import packageJson from '../../package.json'

/** Deployed bundle version (diagnostic only — never rendered in the UI). */
const BOARD_VERSION = (packageJson as { version?: string }).version ?? 'unknown'
import { RouteSettingsScope } from './route-scope.ts'
import { TaskBoardSettingsCardController, TaskBoardSettingsSection, type TaskBoardSettings } from './TaskBoardSettingsCard.tsx'
import { en, t, zh } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'dsh-task-board'

/**
 * The board's stage identity — ONE value used for both official registrations:
 * the `main` slot key (which panel stage to show) and the `sidebar.panellist`
 * entry id (which row selects it). The shell resolves a row to its stage by
 * this id, so the two must be the same string; keeping it in one place is what
 * makes "they agree" structural rather than a coincidence two call sites must
 * remember.
 */
const GROUP = { id: 'dsh-task-board' } as const

/**
 * The controller holder behind the panel registration.
 *
 * The registration happens at apply time (the slot must be contributed before
 * the shell renders the panel), while the controller is built later in the
 * background settle. One mutable holder bridges the two without inventing a
 * second source of truth: until `bind` runs the stage renders its loading state,
 * and after the board is disposed `unbind` returns it there.
 */
class TaskBoardStage {
  private controller: BoardController | undefined

  /** Publish the live board to the stage. */
  bind(controller: BoardController): void { this.controller = controller }

  /** Stop publishing a board (the board is being disposed). */
  unbind(): void { this.controller = undefined }

  /** Build the face the panel registration injects (read fresh on every render). */
  inject(): { controller: BoardController | undefined } {
    return { controller: this.controller }
  }
}

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

/**
 * The task-board surface copy key map. Locale merge tables are host
 * declarations; this plugin's copy keys are declared locally (see
 * `./locales.ts`), so no platform package type is imported.
 */

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
  api: ApiFace,
  sessionId: string,
  selection: { provider: string; model: string; reasoningEffort?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await api.sessions.selectModel({
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
 * seeded by the web shell itself (the platform seed table in
 * web-platform.ts's PLATFORM_MODULES), so it is not a package this plugin
 * needs the loader to bring up. `sessions` / `workspaces` are the client
 * object-layer services (dsh-api-session-controller / workspace-controller),
 * `connection` the wire carrier, `locale` the copy service, and `remote` the
 * Typert-generated Host API namespaces — all real services, with the
 * package-name edges declared in `dsh.client.inject`. `uiSession` is the
 * session-UI adapter (dsh-client-ui-session): the board only subscribes to
 * its official session-status snapshot (read-only — answering stays
 * in the native session), never registering a waterfall listener of its own.
 * Navigation is NOT a required service: `ctx.uiWorkspace` is read optionally
 * at call time (see the sessions.open adapter in buildApi).
 */
export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'remote', 'uiSession']

/**
 * Mount the task board.
 * @param ctx - client root context (services: sessions, workspaces).
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-task-board: dictionaries')
  // Stale-bundle self-heal (see bundle-freshness.ts). This runs BEFORE any
  // mounting work: the client half is an immutable, revisioned artifact, so a
  // document that is already open keeps rendering the bundle it booted with —
  // and every rebuild plus host restart then looks like "nothing changed" for
  // as long as that document lives. Comparing the version baked into this
  // bundle against the one the host serves (an uncached API route) is the only
  // way the page itself can notice, and re-entering the boot graph once with a
  // cache-busting URL is the only way it can fix itself. The verdict is also
  // rendered (a real, tappable status line) so a page that stays stale after
  // one attempt says so instead of pretending.
  const freshness = new BundleFreshnessState({
    bundled: BOARD_VERSION,
    readHostVersion: async () => (await fetchUpdateSource())?.version,
    reload: reloadForFreshBundle,
    storage: (() => {
      try {
        return window.sessionStorage
      } catch {
        return undefined
      }
    })(),
  })
  ctx.effect(() => {
    void freshness.probe()
    // Keep watching: an open page must notice a host that restarted behind it
    // (a boot-only probe runs once, which is exactly why a restart used to
    // leave an open tab pinned to the previous bundle forever).
    return freshness.watch()
  }, 'dsh-task-board: bundle freshness probe + watch')
  // --- official seats ---------------------------------------------------------
  //
  // The board occupies the shell's CENTRE STAGE as a global panel, and its entry
  // is that panel's own icon in the shell's panel list. Both are official slots
  // with the shell owning the chrome, geometry and selection semantics; the
  // registration ids MUST agree (`GROUP` below is both the `main` key and the
  // panellist entry id), because that is how the shell resolves a row to its
  // stage. There is deliberately no other sidebar affordance: one surface, one
  // entry point, no second "is the board open" subscription to keep in step.
  const stage = new TaskBoardStage()
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: GROUP.id,
    locale: NS,
    inject: () => stage.inject(),
  }, TaskBoardPanel)), 'dsh-task-board: main panel')
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    // LIST-kind slot: id/order/label are the mandatory list shape (a missing id
    // throws at load-time validation).
    id: GROUP.id,
    order: 110,
    label: () => t('entry.label'),
    locale: NS,
  }, TaskBoardIcon)), 'dsh-task-board: panel entry')

  const scope = new RouteSettingsScope<TaskBoardSettings>(TASK_BOARD_NS)
  // The settings section's form controller lives exactly as long as the scope it
  // edits, both owned by this fiber. (The old shape rebuilt it inside the inject
  // callback, which was only safe while that callback ran exactly once.)
  const settingsCard = new TaskBoardSettingsCardController(scope)
  ctx.effect(() => {
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: GROUP.id,
      order: 112,
      label: () => t('settings.title'),
      locale: NS,
      inject: () => settingsCard.inject(),
    }, TaskBoardSettingsSection))
    return () => {
      settingsCard.dispose()
      scope.dispose()
    }
  }, 'dsh-task-board: settings section + scope')

  // The sidebar entry and board view mount once the settings scope settles;
  // while the scope is still loading, the composition default is unknown, so
  // nothing mounts yet. Only an unavailable scope (no settings surface served)
  // falls back to the composition default (enabled).
  let uiDisposer: (() => void) | undefined
  let mounting = false
  /** The live enabled decision (the mount gate): ready scope → its value,
   *  unavailable scope → the composition default (true), loading → false. */
  const currentEnabled = (): boolean => {
    const snapshot = scope.getSnapshot()
    return snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
      : snapshot.status === 'unavailable'
  }
  const mountUi = (): void => {
    if (uiDisposer !== undefined || mounting) return
    mounting = true
    mountUiBody().catch(error => {
      // A failed mount must never strand the gate or surface an unhandled
      // rejection: log it, stay unmounted, the next scope event may retry.
      console.error('[dsh-task-board] mount failed:', error)
    }).finally(() => { mounting = false })
  }
  const mountUiBody = async (): Promise<void> => {
    if (uiDisposer !== undefined) return
    const sessions = ctx.sessions
    const workspaces = ctx.workspaces
    const api = buildApi(ctx)

    // ── sync client: this tab becomes a replica of the host board document ──
    // Offline-first: the controller mounts on the LOCAL mirror instantly (the
    // entry binds below without awaiting the network) and the host truth
    // converges in the background settle at the end of this function (or the
    // board stays on the mirror when the host serves no synced board).
    const sync = new BoardSyncClient({
      transport: createBoardTransport(),
      defer: (fn, ms) => {
        const timer = setTimeout(fn, ms)
        return () => clearTimeout(timer)
      },
      // Tab visibility drives the engine-lease active flag + foreground wake:
      // the engine must sit where the user is looking (and must LEAVE the
      // moment the user stops looking — a frozen tab cannot renew).
      visibility: {
        is: () => document.visibilityState === 'visible',
        onVisible: cb => {
          const listener = () => {
            if (document.visibilityState === 'visible') cb()
          }
          document.addEventListener('visibilitychange', listener)
          return () => document.removeEventListener('visibilitychange', listener)
        },
        onHidden: cb => {
          const listener = () => {
            if (document.visibilityState === 'hidden') cb()
          }
          document.addEventListener('visibilitychange', listener)
          return () => document.removeEventListener('visibilitychange', listener)
        },
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
    // Offline-first mount: the board opens on the LOCAL mirror instantly (the
    // entry binds below without awaiting the network); the host truth
    // converges in the background and the stores flip to it on adoption.
    // A hanging socket must never hold the entry hostage (mobile "点了没反应").
    const store = new SyncedTaskStore(sync, new LocalStorageTaskStore())
    // Comment continuations go through the host-level session.prompt API:
    // it addresses any session id (the execution session is usually not
    // the currently staged one, so a client binding is not guaranteed). The
    // same channel serves the linked-session panel's direct composer
    // (sessionMessage) — "typing in the native conversation" is exactly
    // this call, shared by both callers. Images ride the content as the
    // OFFICIAL temporary-bytes part (`{type:'image', mediaType, data, name}`)
    // and files as the OFFICIAL staged refs (`{type:'file', receiptId}`) —
    // the host performs the durable admission itself, exactly like the
    // native composer does. There is deliberately no board-side attachment
    // bridge: the wire only accepts these shapes.
    const sendComment = async (
      sessionId: string,
      text: string,
      images?: readonly PromptImage[] | undefined,
      mode: 'queue' | 'steer' = 'queue',
      files?: readonly PromptFile[] | undefined,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const content: Array<{ type: string; text?: string; mediaType?: string; data?: string; name?: string; receiptId?: string }> =
        text.trim() !== ''
          ? [{ type: 'text', text }]
          : []
      if (images !== undefined) {
        for (const image of images) {
          content.push({
            type: 'image',
            mediaType: image.mediaType,
            data: image.data,
            ...image.name !== undefined ? { name: image.name } : {},
          })
        }
      }
      if (files !== undefined) {
        for (const file of files) {
          content.push({ type: 'file', receiptId: file.receiptId })
        }
      }
      if (content.length === 0) return { ok: false as const, error: 'empty message' }
      const response = await api.sessions.prompt({
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
    // One driver adapter per bound session object: alpha.3's sessions service
    // exposes session bindings (`sessions.binding(id)` — lazily minted,
    // scope-addressed) and `sessionDriverOf` maps the bound Session onto the
    // core SessionDriver face. Adapters are cached per session object and
    // disposed with this fiber.
    const driverEntries = new Map<BoundSessionFace, { driver: SessionDriver; dispose: () => void }>()
    ctx.effect(() => () => {
      for (const { dispose } of driverEntries.values()) dispose()
      driverEntries.clear()
    })
    const sessionDriverEntry = (id: SessionId): { driver: SessionDriver; dispose: () => void } | undefined => {
      const bound = sessions.binding(id)
      if (bound === undefined) return undefined
      let entry = driverEntries.get(bound.session)
      if (entry === undefined) {
        entry = sessionDriverOf(bound.session)
        driverEntries.set(bound.session, entry)
      }
      return entry
    }
    const sessionAgentStore = new LocalStorageSessionAgentStore()
    const exec = new ExecutionService({
      sessions: {
        list: sessions.list,
        binding: id => {
          const entry = sessionDriverEntry(id as SessionId)
          return entry === undefined ? undefined : { session: entry.driver }
        },
      },
      workspaces: {
        // alpha.3's workspace list snapshot carries no `recentWorkspaceId`;
        // the execution service reads it as an optional creation hint, so the
        // adapter supplies the absent shape. The workspace view's official
        // `path` / `sessionIds` ride through structurally (shape-guarded).
        list: {
          getSnapshot: () => ({
            items: workspaces.list.getSnapshot().items.map(item => {
              const raw = item as unknown as Record<string, unknown>
              return {
                workspaceId: item.workspaceId,
                ...typeof raw.path === 'string' ? { path: raw.path } : {},
                ...Array.isArray(raw.sessionIds) ? { sessionIds: raw.sessionIds as readonly string[] } : {},
              }
            }),
            recentWorkspaceId: undefined,
          }),
        },
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
        const response = await api.sessions.create({ workspaceId: target })
        if (!response.result.ok) {
          throw new Error(`${response.result.error.code}: ${response.result.error.message}`)
        }
        return response.result.value.sessionId
      },
      history: {
        loadTail: async sessionId => {
          const response = await api.sessions.history({
            sessionId: sessionId as SessionId,
            maxMessages: 20,
          })
          return response.result.ok
            ? { events: response.result.value.events.map(entry => entry.event as ExecutionHistoryEvent) }
            : undefined
        },
      },
      selectModel: (sessionId, selection) => selectModelOf(api, sessionId, selection),
      selectAgentPreset: async (sessionId, agentPreset) => {
        const response = await api.agentPresets.select({
          sessionId: sessionId as SessionId,
          agentPreset,
        })
        return response.result.ok
          ? { ok: true as const }
          : { ok: false as const, error: `${response.result.error.code}: ${response.result.error.message}` }
      },
      // Applied-preset ledger (the Agent row's fallback — the host offers no
      // preset read-back, so the board remembers what it composed each
      // session from; the execution service fires this on every successful
      // switch, both paths). One store instance, shared with the
      // controller's display side below.
      onAgentApplied: (sessionId, preset) => {
        const ledger = sessionAgentStore.load()
        sessionAgentStore.save(recordApplied(ledger, sessionId, preset, Date.now()))
      },
      sendComment: (sessionId, text, mode, images) => sendComment(sessionId, text, images, mode),
      sendCommand,
      // Session rename: the OFFICIAL user-title write (host-level rename RPC
      // — works for any session id, not just bound/staged ones). The native
      // semantics own the conflict story: an accepted title pins against
      // automatic regeneration; the wire error text is surfaced verbatim.
      renameSession: async (sessionId, title) => {
        const response = await api.sessions.rename({
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
    // The raw read is wrapped in the shared freshness layer (single-flight +
    // short TTL + timeout) so every surface that shows a session tail shares
    // ONE fetch and a hung RPC can never spin forever (「加载很久/加载不出来」).
    const readTranscriptRaw = async (sessionId: string): Promise<TranscriptLoadResult | undefined> => {
      const response = await api.sessions.history({
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
        events: value.events.map(entry => entry.event as TranscriptEventShape),
        hasMore: value.hasMore === true,
        ...value.floorSeq !== undefined ? { floorSeq: value.floorSeq } : {},
        ...value.throughSeq !== undefined ? { throughSeq: value.throughSeq } : {},
        ...pickTranscriptProjections(projections),
      }
    }
    // One earlier page ("load earlier messages"): the same event shape as
    // the tail, paged backward from `beforeSeq` (the window's first seq).
    // Undefined when the host serves no page endpoint (old deployments) or
    // the read fails — the hook then simply hides the affordance.
    const readTranscriptPage = async (sessionId: string, beforeSeq: number, throughSeq?: number): Promise<TranscriptPage | undefined> => {
      try {
        const response = await api.sessions.page({
          sessionId: sessionId as SessionId,
          beforeSeq,
          maxMessages: 50,
          ...throughSeq !== undefined ? { throughSeq } : {},
        })
        // A refused page (old host without the endpoint, a rejected cursor)
        // must name its code: the UI only says "retry", and this line is the
        // whole diagnosis of "明明还有更早的对话却加载不出来".
        if (!response.result.ok) {
          console.error('[dsh-task-board] transcript page refused', response.result.error.code, response.result.error.message)
          return { events: [], hasMore: true, refused: response.result.error.code }
        }
        return {
          events: response.result.value.events.map(entry => entry.event as TranscriptEventShape),
          hasMore: response.result.value.hasMore === true,
          ...response.result.value.floorSeq !== undefined ? { floorSeq: response.result.value.floorSeq } : {},
        }
      } catch (error) {
        console.error('[dsh-task-board] transcript page read failed', error)
        return { events: [], hasMore: true, refused: 'thrown' }
      }
    }
    const transcriptLoader = createTranscriptReader<TranscriptLoadResult>({
      read: async sessionId => {
        try {
          return await readTranscriptRaw(sessionId)
        } catch (error) {
          console.error('[dsh-task-board] transcript read failed', error)
          return undefined
        }
      },
      defer: (fn, ms) => {
        const timer = setTimeout(fn, ms)
        return () => clearTimeout(timer)
      },
    })
    // Durable message images read back through the OFFICIAL attachment RPC
    // (the host proves the session references the id). Attachments are
    // immutable, so the same freshness layer runs with a long TTL — one
    // fetch per image however many rows/surfaces show it, and a hung read
    // still cannot spin forever.
    const imageReader = createTranscriptReader<{ data: string; mediaType: string }>({
      read: async key => {
        const split = key.indexOf('|')
        const sessionId = key.slice(0, split)
        const attachmentId = key.slice(split + 1)
        try {
          const response = await api.sessions.attachment({
            sessionId: sessionId as SessionId,
            attachmentId: attachmentId as never,
          })
          if (!response.result.ok) return undefined
          return { data: response.result.value.data, mediaType: response.result.value.attachment.mediaType }
        } catch (error) {
          console.error('[dsh-task-board] attachment read failed', error)
          return undefined
        }
      },
      defer: (fn, ms) => {
        const timer = setTimeout(fn, ms)
        return () => clearTimeout(timer)
      },
      ttlMs: 10 * 60_000,
    })
    // File-lane staging: the EXACT bytes go up first (same session), the
    // prompt carries only the opaque receipt. Base64 here because the Remote
    // upload shape is `{data: base64, name?}`; the HTTP binary fallback stays
    // available on the host for large files (the runtime owns that choice —
    // the board never picks a transport, it only supplies exact bytes).
    const readFileAsBase64 = (file: File): Promise<string | undefined> => new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : ''
        const comma = result.indexOf(',')
        resolve(comma >= 0 ? result.slice(comma + 1) : undefined)
      }
      reader.onerror = () => resolve(undefined)
      reader.readAsDataURL(file)
    })
    const uploadFile = async (sessionId: string, file: File): Promise<
      | { ok: true; receiptId: string }
      | { ok: false; error: string }
    > => {
      try {
        const data = await readFileAsBase64(file)
        if (data === undefined || data === '') return { ok: false as const, error: 'unreadable file' }
        const response = await api.fileUploads.upload({
          sessionId: sessionId as SessionId,
          data,
          name: file.name,
        })
        if (!response.result.ok) {
          return { ok: false as const, error: `${response.result.error.code}: ${response.result.error.message}` }
        }
        return { ok: true as const, receiptId: response.result.value.receiptId }
      } catch (error) {
        console.error('[dsh-task-board] file upload failed', error)
        return { ok: false as const, error: String(error) }
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
        const response = await api.skills.list({ sessionId: sessionId as SessionId })
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

    // Pending native questions: the official mirror over the host's
    // session-status snapshot (the same source the native sidebar and
    // composer read). The board never registers its own waterfall listener —
    // the waterfall is a claim chain (first answer wins) — but the pending
    // entry IS the native carrier, so when it exposes answer/cancel the board
    // settles that one claim through it (in-place answering, identical to the
    // native card). Rendering reads questions/kind/sessionId/key structurally
    // (never instanceof across the plugin boundary); a carrier without those
    // actions degrades to navigate-to-answer. The legacy mux tracker stays as
    // the fallback while no uiSession face is served.
    const uiSession = ctx.get<IUiSessionFace>('uiSession')
    const mirror = uiSession !== undefined
      ? new PendingMirror(uiSession as unknown as UiSessionMirrorFace)
      : undefined
    if (mirror === undefined) {
      console.warn('[dsh-task-board] question mirror unavailable: no uiSession bridge (navigate-to-answer degraded)')
    }
    const questionTracker = new QuestionTracker(api)
    // The localStorage cruise face: the fallback-mode truth AND the synced-mode
    // offline mirror (one implementation, two roles — no drift).
    const localCruise = {
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
      write: (state: { enabled: boolean; manual?: boolean; limit: number }) => {
        try {
          localStorage.setItem(CRUISE_STORAGE_KEY, JSON.stringify(state))
        } catch (error) {
          console.error('[dsh-task-board] cruise state write failed (persistence skipped)', error)
        }
      },
    }
    const controller = new BoardController({
      store,
      exec,
      questionRpc: mirror ?? questionTracker,      // Presets ride the shared document once adopted (edits propagate to
      // every replica); before that the local keys serve (offline-first).
      // The localStorage instance stays as the offline mirror behind the
      // synced one either way.
      presetStore: new SyncedPresetStore(sync, new LocalStoragePresetStore()),
      runPresetStore: new SyncedRunPresetStore(sync, new LocalStorageRunPresetStore()),
      // The applied-preset ledger (the Agent row's fallback — shared with
      // the execution service's onAgentApplied above).
      sessionAgentStore,
      // A non-engine replica relays a user-initiated launch to the lease
      // holder (the host forwards it over the SSE command frame). Pre-sync
      // this replica is its own engine, so the relay is never used.
      requestLaunch: (taskId, trigger) => { if (sync.isSynced()) sync.requestLaunch(taskId, trigger) },
      // The engine-note dialog's 「重新检查」: renew the lease NOW (the sync
      // client's seat announcement then re-mirrors hostProto into the
      // controller), so a user who just restarted the host sees the banner
      // clear on the spot instead of waiting for the next heartbeat.
      // Pre-sync there is no seat to re-check.
      seatRecheck: async () => { if (sync.isSynced()) await sync.renewLease() },
      sessions: {
        list: sessions.list,
        exists: id => sessions.list.getSnapshot().byId[id as SessionId] !== undefined,
        // Navigation lives with the view owner now (`ctx.uiWorkspace`,
        // "select a Session and show its Conversation as one UI navigation
        // action"). The controller's own face dropped `open`, so this is the
        // only correct route — and a composition without the workspace UI
        // reports refusal instead of throwing on an undefined method.
        open: id => {
          const uiWorkspace = ctx.get<IUiWorkspaceFace>('uiWorkspace')
          if (uiWorkspace === undefined) {
            console.warn('[dsh-task-board] navigation unavailable: no uiWorkspace capability')
            return false
          }
          uiWorkspace.openSession(id as SessionId)
          return true
        },
      },
      workspaces: {
        // Source labels, the run-config picker, drag classification AND the
        // registry-global ARCHIVE set (archived conversations leave the card's
        // session rows). Workspace MEMBERSHIP is read only as the creation-
        // time snapshot for folder drops (later sessions never auto-join).
        list: {
          getSnapshot: () => {
            const snap = workspaces.list.getSnapshot()
            return {
              items: snap.items.map(item => {
                const raw = item as unknown as Record<string, unknown>
                return {
                  id: item.workspaceId,
                  title: item.title,
                  // The registry's ownership account (folder-drop snapshot
                  // reads membership from it — never cwd/title guessing).
                  ...Array.isArray(raw.sessionIds) ? { sessionIds: raw.sessionIds as readonly string[] } : {},
                }
              }),
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
      // the same switch/limit/windows) with the localStorage face kept as
      // the offline mirror; in fallback mode localStorage IS the truth.
      cruiseStorage: new SyncedCruiseStore(sync, localCruise),
      // Review-page transcripts: recent history of an execution session,
      // plus one earlier page at a time (the native "load earlier" grammar —
      // the tail window is message-aligned, so refresh reads the same tail
      // shape and an empty fold is a real empty, not a missed page).
      transcript: transcriptLoader,
      transcriptPage: readTranscriptPage,
      // Durable message images (official attachment read, cached/deduped)
      // + file-lane staging (official upload pre-step, per session).
      loadImage: (sessionId, attachmentId) => imageReader(`${sessionId}|${attachmentId}`),
      uploadFile,
      // The native goal verbs (official `remote.goals` mutations): the CAS
      // ref is read at call time from the live binding's `goal` projection
      // (verbatim the GoalBar grammar), activation arrives on
      // `goal/activation-changed`. Absent namespace/binding = the goal
      // strip stays read-only (never a throw at the click site).
      goalService: {
        bindingOf: sessionId => sessions.binding(sessionId as SessionId)?.session,
        remote: ctx.get<GoalsRemoteFace>('remote.goals'),
        subscribeActivation: (sessionId, listener) => {
          const remote = ctx.get<{ $on(event: string, listener: (event: unknown) => void): () => void }>('remote')
          if (remote === undefined || typeof remote.$on !== 'function') return () => {}
          try {
            return remote.$on('goal/activation-changed', (event: unknown) => {
              const payload = event as { sessionId?: unknown; goal?: unknown } | null
              if (payload === null || typeof payload !== 'object' || payload.sessionId !== sessionId) return
              const goal = payload.goal as { id?: unknown; revision?: unknown; activation?: unknown } | undefined
              if (goal === undefined) {
                listener(undefined)
                return
              }
              if (typeof goal.id !== 'string' || typeof goal.revision !== 'number'
                || (goal.activation !== 'armed' && goal.activation !== 'disarmed')) return
              listener({ id: goal.id, revision: goal.revision, activation: goal.activation })
            })
          } catch {
            return () => {}
          }
        },
      },
      // Review-page session panel: the live model directory + selection of
      // the execution session, straight from the native models/selectModel
      // APIs (the same sources the native model selector reads), and the
      // native `/permission` command path for permission switches.
      sessionConfig: {
        readModels: async sessionId => {
          try {
            const response = await api.sessions.models({ sessionId: sessionId as SessionId })
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
        selectModel: (sessionId, selection) => selectModelOf(api, sessionId, selection),
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
      // The board's 返回: leave the stage for the Conversation through the
      // shell's own panel API (`selectPanel(null)` is exactly what the shipped
      // workspace browser does when the user picks a session). Read at call
      // time: the layout service needs no fiber-inject edge of its own, and an
      // absent one degrades to "nowhere to go" rather than throwing.
      showConversation: () => {
        const layout = ctx.get<ILayoutFace>('layout')
        if (layout === undefined) {
          console.warn('[dsh-task-board] cannot return to the conversation: no layout panel capability')
          return
        }
        layout.selectPanel(null)
      },
      runCatalog: {
        listWorkspaces: () => workspaces.list.getSnapshot().items.map(item => ({
          id: item.workspaceId,
          title: (item as { title?: string }).title ?? item.workspaceId,
        })),
        listModelGroups: async () => {
          // The live model directory is `session/modelCatalog` in alpha.3
          // (the same catalog the native model picker reads), served through
          // the sessions.models face — no session id is needed for the
          // catalog, so the face's request stays empty here.
          try {
            const response = await api.sessions.models({})
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
          } catch (error) {
            console.error('[dsh-task-board] model catalog read failed', error)
            return []
          }
        },
        listAgentPresets: async () => {
          const response = await api.agentPresets.list({})
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
        listSlashCandidates: async sessionId => {
          // The slash menu merges the two native sources the composer's '/'
          // menu reads: host commands (live command registry via the remote
          // bridge) and skills (the skill catalog — every skill name is a
          // slash entry). Both sources are SESSION-SCOPED on the wire, so the
          // caller supplies the session its composer edits; a missing session
          // hides the menu (there is no global catalog to fall back to).
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
    // Adopt the engine seat BEFORE start(): start() runs a reconcile and (when
    // cruise is on) a dispatch, both seat-gated — a viewer must never pump on
    // boot alongside the real engine (that would double-launch). Pre-sync this
    // replica is its own engine (fallback discipline); the background settle
    // below adopts the real seat once the lease first answers — sync.start
    // awaited that probe before, so isEngine() was authoritative there and is
    // authoritative here right after adoption.
    // The protocol is adopted only when the first lease actually answered —
    // "no evidence yet" must never read as "old host" (a false stale banner).
    controller.start()
    // The legacy mux turn fan-out: on hosts that still serve it, every live
    // `user/message` frame goes straight to the controller (engine-only
    // inside, anchor-deduped against the reconcile backstop). On 0.1.5 the
    // mux is gone (the stub hangs silently) and the activity watcher below
    // is the live channel; this listener then simply never fires.
    const detachTurnWatcher = questionTracker.addSessionListener((sessionId, event) => {
      const turn = nativeTurnOf(event)
      if (turn !== undefined) controller.recordNativeTurn(sessionId, turn)
    })
    // The 0.1.5 native-activity wake channel: the host emits
    // `api-session/activity(sessionId, updatedAt)` for every durable user
    // message, which the session list projects onto the row's `updatedAt`.
    // A row whose stamp advances while its running flag stays put is a turn
    // the status edge would miss — wake the reconcile (engine-only inside,
    // anchor-deduped at the write) so it is recorded with its text.
    const detachActivityWake = watchSessionActivity(ctx, (sessionId, stamp) => {
      controller.recordActivityWake(sessionId, stamp)
    })
    // The localized 未命名 placeholder the session rows show for a session
    // the host has not titled yet (the host names it automatically from the
    // first real message).
    controller.untitledSessionLabel = t(UNTITLED_SESSION_KEY)

    // Sync wiring: every remote document lands in the controller + refreshes
    // the offline mirror; the seat and relayed launches follow the host's
    // lease/command frames. Registered upfront — nothing flows before the
    // background settle adopts the seat, so pre-sync taps behave exactly
    // like today's fallback mode.
    sync.onRemote(view => {
      controller.applyRemote(view)
      writeMirror(view)
    })
    // The seat announcement carries BOTH halves: which replica holds the
    // engine, and the host's protocol version (a restart moves the
    // protocol without moving the seat — this is what clears the stale
    // banner live on every device, no manual refresh needed). The host's
    // boot instant rides the same read: it is what the dialog shows as
    // evidence when a user insists they already restarted.
    sync.onEngine(held => {
      const proto = sync.hostProtoVersion()
      if (proto !== undefined) controller.setHostProto(proto)
      controller.setHostBoot(sync.hostBootTime())
      controller.setEngine(held)
    })
    sync.onCommand(command => { void controller.runTask(command.taskId, command.trigger) })

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
      ready: () => sessions.list.getSnapshot().phase === 'ready' && (!sync.isSynced() || sync.isEngine()),
      // Forbid-policy skip telemetry surfaces on the board's status line
      // (the controller snapshot carries it; zero stays hidden).
      onSkips: stats => { controller.setSchedulerSkips(stats) },
      // Heartbeat liveness surfaces the same way (volatile; undefined until
      // the first completed tick).
      onHeartbeat: hb => { controller.setSchedulerHeartbeat(hb.okAt) },
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

    // The board is LIVE now: the stage component renders it the moment the user
    // selects the panel, so all this does is publish the controller to the panel
    // registration. Nothing mounts into shell DOM, so there is no frame to wait
    // for and no observer to keep — the one failure mode left is "no controller
    // yet", which the stage renders as its own loading state.
    const disposers: Array<() => void> = []
    stage.bind(controller)
    disposers.push(() => { stage.unbind() })
    // Host-truth convergence runs in the BACKGROUND: the entry above is
    // already live on the local mirror. When the line allows, the host doc
    // (unioned with any pre-sync local writes by start's migration) replaces
    // the mirror-loaded ledger — one notify, no echo — and the real seat is
    // adopted. A disabled plugin disposes instead of converging behind a
    // closed door; a failed start simply stays on the mirror (fallback).
    void sync.start(readLocalView).then(mode => {
      // One permanent diagnostic line: every "didn't sync / didn't change"
      // dispute ends here (version + sync mode + seat, no devtools spelunking).
      console.info(`[dsh-task-board] boot v${BOARD_VERSION} sync=${mode} engine=${sync.isEngine()}`)
      if (!currentEnabled()) {
        sync.dispose()
        return
      }
      if (mode !== 'synced') return
      // Warm the offline mirror with the host truth so a later reload (or a
      // dropped connection) first-paints the real board, not a stale copy.
      writeMirror(sync.view())
      controller.syncActive = true
      const proto = sync.hostProtoVersion()
      if (proto !== undefined) controller.setHostProto(proto)
      controller.setHostBoot(sync.hostBootTime())
      controller.setEngine(sync.isEngine())
      controller.applyRemote(sync.view())
    }).catch(error => {
      console.error('[dsh-task-board] sync settle failed (staying on the local mirror):', error)
    })
    uiDisposer = () => {
      for (const dispose of disposers.splice(0)) dispose()
      detachTurnWatcher()
      detachActivityWake()
      scheduler.dispose()
      sync.dispose()
      controller.dispose()
      questionTracker.dispose()
      uiDisposer = undefined
    }
  }
  const syncEnabled = (): void => {
    if (currentEnabled()) mountUi()
    else uiDisposer?.()
  }
  scope.subscribe(syncEnabled)
  syncEnabled()
}
