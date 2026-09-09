/**
 * Local platform adaptation layer for dsh 0.1.2-alpha.3.
 *
 * The `@deepseek-ai/dsh-client-runtime` package stopped at 0.1.x-rc.2 and was
 * removed from the alpha line: the host's client module system only resolves
 * PLATFORM_MODULES seed words (react / cordis / static UI libraries), dynamic
 * package rows, and registered factories — nothing else. The domain API moved
 * from `connection.api.*` to the Typert-generated `ctx.remote.<ns>.*` surface,
 * and `createSnapshotStore` belongs to a client-store package the alpha.3
 * host does not ship.
 *
 * This file therefore re-declares, locally and structurally, every runtime
 * face this plugin consumes — the same "framework-free, shape-guarded"
 * discipline the rest of the plugin already uses (see remote.commands) — and
 * provides a dependency-free snapshot-store implementation. No value import
 * crosses into an @deepseek-ai/dsh-client-* package, so the bundle builds
 * against the platform baseline and cannot drift with host versions.
 *
 * @module dsh-task-board/client/platform
 */

import type { SessionDriver } from '../core/execution.ts'

// ─── Branded identifiers ────────────────────────────────────────────────────

/** Branded session id (the host brands its wire ids the same way). */
export type SessionId = string & { readonly __sessionId: unique symbol }

/** Branded workspace id. */
export type WorkspaceId = string & { readonly __workspaceId: unique symbol }

// ─── Settings scope ─────────────────────────────────────────────────────────

/**
 * Client-side sync state of one settings namespace. Mirrors the official
 * `SettingsScopeSnapshot<T>` contract so the card form consumes it unchanged.
 */
export interface SettingsScopeSnapshot<T> {
  /** `loading` until the first accepted section, `ready` while one stands. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Last accepted schema-resolved section; undefined before the first acceptance. */
  value: T | undefined
  /** Composition layer the Host resolved `value` over. */
  base: unknown
  /** Raw user layer as stored; a field's PRESENCE here marks it overridden. */
  user: unknown
  /** Namespace revision fencing the next write. */
  revision: number | undefined
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** `host` syncs with the Host document; `memory` keeps state process-local. */
  mode: 'host' | 'memory'
}

// ─── Snapshot store (dependency-free) ───────────────────────────────────────

/**
 * Minimal observable snapshot source. Both `Session`-like objects and
 * snapshot stores satisfy it.
 */
export interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(fn: () => void): () => void
}

/**
 * Writable snapshot store (bare data face). Same shape as the official
 * client-store engine; implemented here without zustand/immer so the plugin
 * bundle needs no platform module beyond the baseline.
 */
export interface SnapshotStore<T> extends ObservableSnapshot<T> {
  /** Mutate the state through a draft (plain assignment on the draft object). */
  update(mutator: (draft: T) => void): void
  /** Replace the state wholesale. */
  set(next: T): void
}

/**
 * Create a snapshot store. Synchronous flush (controlled inputs need
 * same-tick echo); persistence is intentionally omitted — this plugin's
 * stores are projections, not durable state.
 *
 * @param init - initial state.
 * @returns the store.
 */
export function createSnapshotStore<T>(init: T): SnapshotStore<T> {
  let state = init
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe: fn => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    update: mutator => {
      // Rebuild through a shallow draft clone so an immer-style mutator
      // (which assigns onto the draft) leaves the previous snapshot intact
      // until the mutation settles.
      const draft = Array.isArray(state)
        ? [...state] as T
        : typeof state === 'object' && state !== null
          ? { ...state as Record<string, unknown> } as T
          : state
      mutator(draft)
      state = draft
      for (const listener of [...listeners]) listener()
    },
    set: next => {
      if (next === state) return
      state = next
      for (const listener of [...listeners]) listener()
    },
  }
}

// ─── Remote result shapes (Typert protocol) ─────────────────────────────────

/** One Remote call's failure. */
export interface RemoteFailure {
  readonly code: string
  readonly message: string
  readonly details?: object
}

/** One Remote call's result envelope. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailure }

// ─── Domain API face (alpha.3 `ctx.remote` projection) ──────────────────────

/** One prompt content part (the wire accepts text + temporary image bytes + staged file refs). */
export type PromptContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mediaType: string; readonly data: string; readonly name?: string }
  | { readonly type: 'file'; readonly receiptId: string }

/** One complete model selection for a session. */
export interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** One model row in a discovery group. */
export interface DiscoveredModel {
  readonly id: string
  readonly name: string
  readonly reasoning?: {
    readonly efforts: readonly { readonly id: string; readonly name: string }[]
    readonly defaultEffort?: string
  }
}

/** One provider group in a model catalog. */
export interface ModelProviderGroup {
  readonly id: string
  readonly models: readonly DiscoveredModel[]
}

/** The model catalog the model picker consumes. */
export interface ModelCatalog {
  readonly current: ModelSelection
  readonly groups: readonly ModelProviderGroup[]
}

/** One skill available to a session's composer. */
export interface SkillEntry {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
}

/** One agent-preset row. */
export interface AgentPresetEntry {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly isDefault: boolean
}

/**
 * The domain API face this plugin's client half consumes. The shape mirrors
 * the rc.7 `connection.api` surface (every method returns the `{ result }`
 * envelope) so the consuming code (execution, controller, question tracker)
 * stays unchanged; the implementation maps every method onto the alpha.3
 * `ctx.remote` namespaces in `buildApi` below.
 */
export interface ApiFace {
  sessions: {
    prompt(request: {
      sessionId: SessionId
      mode: 'queue' | 'steer'
      content: readonly PromptContentPart[]
    }): Promise<{ result: RemoteResult<{ accepted: true }> }>
    selectModel(request: {
      sessionId: SessionId
      provider: string
      model: string
      reasoningEffort?: string
    }): Promise<{ result: RemoteResult<{ selected: ModelSelection }> }>
    create(request: { workspaceId: WorkspaceId }): Promise<{ result: RemoteResult<{ sessionId: SessionId }> }>
    history(request: {
      sessionId: SessionId
      maxMessages: number
    }): Promise<{
      result: RemoteResult<{
        events: readonly { event: unknown }[]
        hasMore: boolean
        floorSeq?: number
        projections?: { values?: Record<string, unknown> }
      }>
    }>
    page(request: {
      sessionId: SessionId
      beforeSeq: number
      maxMessages: number
    }): Promise<{
      result: RemoteResult<{
        events: readonly { event: unknown }[]
        hasMore: boolean
        floorSeq?: number
      }>
    }>
    rename(request: {
      sessionId: SessionId
      title: string
    }): Promise<{ result: RemoteResult<{ title: string; seq: number }> }>
    attachment(request: {
      sessionId: SessionId
      attachmentId: string
    }): Promise<{ result: RemoteResult<{ attachment: { mediaType: string }; data: string }> }>
    models(request: { sessionId?: SessionId }): Promise<{ result: RemoteResult<ModelCatalog> }>
  }
  skills: {
    list(request: { sessionId: SessionId }): Promise<{ result: RemoteResult<{ skills: readonly SkillEntry[] }> }>
  }
  agentPresets: {
    list(request: {}): Promise<{ result: RemoteResult<{ presets: readonly AgentPresetEntry[] }> }>
    select(request: { sessionId: SessionId; agentPreset: string }): Promise<{ result: RemoteResult<unknown> }>
  }
  fileUploads: {
    upload(request: {
      sessionId: SessionId
      data: string
      name?: string
    }): Promise<{ result: RemoteResult<{ receiptId: string }> }>
  }
  events: {
    mux(request: {}, signal: AbortSignal): AsyncIterable<QuestionMuxEnvelope>
  }
  respond(message: unknown): Promise<{ accepted: boolean }>
}

/**
 * One mux frame envelope the question tracker reduces. The host replays
 * pending `ask_user_question` batches and pushes live session frames; the
 * shape is structural so the adapter can narrow it without a platform type.
 */
export type QuestionMuxEnvelope = {
  rpcId: string
  payload:
    | { type: 'session/event'; sessionId: string; event: unknown }
    | { type: 'question/requested'; sessionId: string; questions: unknown }
    | { type: 'question/resolved'; questionRpcId: string }
}

/** One `session.follow` stream frame (structural slice of the Typert union). */
export type FollowFrame =
  | { readonly type: 'event'; readonly event: unknown }
  | {
      readonly type: 'snapshot'
      readonly cursor: number
      readonly records: readonly { readonly type: 'event' | 'chunks'; readonly event: unknown }[]
      readonly hasMore: boolean
      readonly projections?: {
        readonly asOfSeq?: number
        readonly values?: Record<string, unknown>
      }
    }

/** One `session.page` response (structural slice of the Typert contract). */
export type PageResult = {
  readonly records: readonly { readonly type: 'event'; readonly event: unknown }[]
  readonly hasMore: boolean
}

/** The oldest event seq covered by one record window (undefined when empty). */
export function floorSeqOf(records: readonly { event: unknown }[]): number | undefined {
  let floor: number | undefined
  for (const record of records) {
    const event = record.event as { seq?: unknown } | null
    if (typeof event !== 'object' || event === null) continue
    if (typeof event.seq !== 'number' || !Number.isFinite(event.seq)) continue
    if (floor === undefined || event.seq < floor) floor = event.seq
  }
  return floor
}

// ─── Client runtime faces (alpha.3 services) ────────────────────────────────

/** One session list row (alpha.3 `SessionSummary` projection). */
export interface SessionListSummary {
  id: SessionId
  title?: string
  displayTitle: string
  cwd?: string
  /** The workspace id the host attributes the session to, when known. */
  workspaceId?: string
  running: boolean
  completed?: boolean
  /** Host "never started" flag: only a blank session may be reused for a run. */
  blank?: boolean
  /** List-activity stamp: advances on every durable user message (the 0.1.5
   *  `api-session/activity` projection — the wake channel's list face). */
  updatedAt?: number
}

/** The session-list snapshot `ctx.sessions.list` exposes. */
export interface SessionListState {
  ids: readonly SessionId[]
  byId: Readonly<Record<string, SessionListSummary>>
  current: SessionId | undefined
  phase: 'pending' | 'ready'
}

/** The snapshot the alpha.3 Session object publishes (structural slice). */
export interface BoundSessionSnapshot {
  readonly running: boolean
  readonly lastAgentError: string | null
  /**
   * Blank-session first-turn edge: true while the first accepted prompt has
   * not yet opened its turn. The board's driver adapter derives its turn-end
   * counter from this edge (see {@link sessionDriverOf}).
   */
  readonly awaitingFirstTurn?: boolean
}

/** The live session object a binding hands out (structural slice of `Session`). */
export interface BoundSessionFace {
  prompt(
    content: readonly unknown[],
    mode: 'queue' | 'steer',
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<{ ok: true; value: { accepted: true } } | { ok: false; error: RemoteFailure }>
  rename(title: string): Promise<unknown>
  command(line: string): Promise<
    { ok: true; value: { matched: boolean } } | { ok: false; error: unknown }
  >
  getSnapshot(): BoundSessionSnapshot
  subscribe(fn: () => void): () => void
  /**
   * Session projection layer (the official `projections.faceOf` read — the
   * goal verbs' call-time CAS ref comes from here). Absent on old hosts:
   * structural, never required — callers degrade without it.
   */
  projections?: {
    faceOf(key: string): { getSnapshot(): unknown } | undefined
  }
}

/** The structural slice of the `remote.goals` Typert stub the goal verbs
 *  call (positional `(sessionId, ref, …)`, GoalView results — verbatim the
 *  calls the harness's own GoalBar makes). Absent = the goal strip hides. */
export type GoalsRemoteFace = import('../core/goal-verbs.ts').GoalsRemoteFace

/** One live binding record: the session object driving a host session. */
export interface SessionBinding {
  readonly session: BoundSessionFace
}

/** The narrow `ctx.sessions` service face this plugin reads. */
export interface ISessionsFace {
  list: ObservableSnapshot<SessionListState>
  create(opts?: { workspaceId?: WorkspaceId; cwd?: string; sessionId?: SessionId }): Promise<SessionId>
  open(id: SessionId): void
  /**
   * Resolve the stable session binding (scope-addressed assembly feed). Pure
   * resolution — undefined for a session neither listed nor already scoped.
   */
  binding(id: SessionId): SessionBinding | undefined
}

/** One workspace list row. */
export interface WorkspaceListRow {
  workspaceId: WorkspaceId
  title: string
  /** The workspace's own working directory (alpha.3 official `path`). */
  path?: string
  /** Sessions the workspace owns (alpha.3 official `sessionIds`). */
  sessionIds?: readonly string[]
}

/** The workspace-list snapshot `ctx.workspaces.list` exposes. */
export interface WorkspaceListState {
  items: readonly WorkspaceListRow[]
  recentWorkspaceId?: WorkspaceId
  archivedSessionIds: readonly string[]
}

/** The narrow `ctx.workspaces` service face this plugin reads. */
export interface IWorkspacesFace {
  list: ObservableSnapshot<WorkspaceListState>
}

/** The narrow `ctx.uiSession` service face this plugin reads. The board only
 *  SUBSCRIBES to the official `pendingInteractions` snapshot (the same
 *  source the native sidebar and composer read) — it never registers its
 *  own waterfall listener and never publishes an interaction (publishing
 *  would race the native composer for the answer). Absent = the question
 *  card degrades to the waiting banner. */
export interface IUiSessionFace {
  readonly pendingInteractions: {
    getSnapshot(): ReadonlyMap<string, unknown>
    subscribe(listener: () => void): () => void
  }
}

/**
 * The client root context this plugin's `apply` receives. Structural face of
 * the alpha.3 web shell: services arrive through cordis `inject` (slots,
 * locale, sessions, workspaces) plus the `remote` and `connection` services.
 */
export interface ClientContext {
  /** Register one fiber-scoped effect; returns the disposer. */
  effect(fn: () => void | (() => void), label?: string): void
  /** Read a registered service by name (structural; absent = undefined). */
  get<T = unknown>(name: string): T | undefined
  /** Locale service: register one namespace dictionary. */
  locale: {
    register(namespace: string, dictionaries: Record<string, unknown>): void
  }
  /** Slot service: inject a registration for a declared slot. */
  slots: {
    inject(name: string, factory: () => unknown): () => void
    register(entry: Record<string, unknown>, component: unknown): unknown
  }
  /** Session object layer. */
  sessions: ISessionsFace
  /** Workspace object layer. */
  workspaces: IWorkspacesFace
  /** Session UI layer (the official pending-interaction projection). */
  uiSession?: IUiSessionFace
  /**
   * Typert-generated Host Remote namespaces. The alpha.3 host registers
   * exactly these methods per namespace (verified against the shipped
   * Typert manifests): `session` = attachment / cancel / canOpenWorkspacePath
   * / control / create / follow / fork / list / modelCatalog /
   * openWorkspacePath / page / prompt / rename / search / selectModel /
   * updateQueue; `skills` = list; `agentPresets` = copy / deletePreset / list
   * / read / select; `llm` = discoverModels / listConfigurableProviders /
   * listProviders. Anything else is a gateway miss — this face only declares
   * what the host actually serves.
   */
  remote: {
    session: {
      prompt(request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
      selectModel(request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
      create(request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
      rename(request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
      attachment(request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
      modelCatalog(signal?: AbortSignal): Promise<RemoteResult<unknown>>
      follow(request: unknown, signal?: AbortSignal): AsyncIterable<unknown>
      page(request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
    }
    fileUploads: {
      upload(agentId: SessionId, request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
    }
    skills: {
      list(request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>
    }
    agentPresets: {
      list(signal?: AbortSignal): Promise<RemoteResult<unknown>>
      select(agent: SessionId, agentPreset: string, signal?: AbortSignal): Promise<RemoteResult<unknown>>
    }
  }
}

// ─── API adapter (alpha.3 mapping) ──────────────────────────────────────────

/**
 * Build the domain API face from the alpha.3 client context. Every method
 * maps to a `ctx.remote` namespace (Typert endpoints follow the
 * `<namespace>/<method>` convention, e.g. `session/prompt`) and returns the
 * `{ result }` envelope the rc.7 surface used, so consuming code is
 * unchanged. The `create` method routes through the sessions service (the
 * wire's create carries a stricter request), and `history` reads the cold
 * inspect endpoint (header + event prefix) and takes its tail window.
 *
 * @param ctx - client root context.
 * @returns the API face.
 */
export function buildApi(ctx: ClientContext): ApiFace {
  // Remote NAMESPACES are cordis sub-services whose keys carry the dot
  // (`remote.session`, `remote.skills`, `remote.agentPresets`): a property
  // read on the parent service (`ctx.remote.session`) raises
  // "cannot get property ... without inject" unless the sub-service name is
  // in `inject`. Like `remote.commands` in index.ts, read them through
  // `ctx.get` — a missing namespace degrades to the guard below instead of
  // throwing (a plugin must never take the shell down by accessing a
  // namespace the deployment does not mount).
  const remoteSession = ctx.get<ClientContext['remote']['session']>('remote.session')
  const remoteSkills = ctx.get<ClientContext['remote']['skills']>('remote.skills')
  const remoteAgentPresets = ctx.get<ClientContext['remote']['agentPresets']>('remote.agentPresets')
  const remoteFileUploads = ctx.get<ClientContext['remote']['fileUploads']>('remote.fileUploads')
  const sessionsService = ctx.sessions

  // Missing-face guard: a host upgrade that renames or drops an endpoint must
  // surface as a NAMED diagnostic (once) here, not as a silent 「暂不可用」 at
  // five consumers. The consumers keep their honest degrade paths; the guard
  // only makes the failure diagnosable from the browser console.
  const warnedMissing = new Set<string>()
  const methodOf = <T>(ns: string, method: string, value: T | undefined): T | undefined => {
    if (value === undefined) {
      const label = `${ns}.${method}`
      if (!warnedMissing.has(label)) {
        warnedMissing.add(label)
        console.error(`[dsh-task-board] remote method missing on the live host: ${label} — a host upgrade may have renamed it`)
      }
    }
    return value
  }
  const unavailable = async <T>(label: string): Promise<{ result: RemoteResult<T> }> => ({
    result: { ok: false as const, error: { code: 'remote/unavailable', message: `the live host does not serve ${label}` } },
  })

  /** Log one named endpoint failure so a board surface's 「暂不可用」is diagnosable from the console. */
  const warnFailure = (label: string, error: { readonly code: string; readonly message: string }): void => {
    console.warn(`[dsh-task-board] ${label} failed -> ${error.code}: ${error.message}`)
  }

  /** Map a remote call result into the domain face's envelope. */
  const asResult = async <T>(label: string, call: Promise<RemoteResult<unknown>>): Promise<{ result: RemoteResult<T> }> => {
    const result = await call
    if (result.ok) return { result: { ok: true as const, value: result.value as T } }
    warnFailure(label, result.error)
    return { result: { ok: false as const, error: result.error } }
  }

  return {
    sessions: {
      prompt: async request => {
        const call = methodOf('session', 'prompt', remoteSession?.prompt)
        if (call === undefined) return unavailable('session.prompt')
        const result = await asResult('session.prompt', call({
          requestId: `tb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
          sessionId: request.sessionId,
          mode: request.mode,
          content: request.content as never,
        }))
        return result.result.ok
          ? { result: { ok: true as const, value: { accepted: true } } }
          : { result: result.result }
      },
      selectModel: request => {
        const call = methodOf('session', 'selectModel', remoteSession?.selectModel)
        if (call === undefined) return unavailable('session.selectModel')
        return asResult<{ selected: ModelSelection }>('session.selectModel', call({
          sessionId: request.sessionId,
          provider: request.provider,
          model: request.model,
          ...request.reasoningEffort !== undefined ? { reasoningEffort: request.reasoningEffort } : {},
        }))
      },
      create: async request => {
        const sessionId = await sessionsService.create({ workspaceId: request.workspaceId })
        return { result: { ok: true as const, value: { sessionId } } }
      },
      history: async request => {
        // The cold-history read is the one-shot `session.follow` snapshot
        // frame: it pages the TAIL (up to `maxMessages` message-surface
        // records) with the cursor, the `hasMore` flag and the projection
        // values in a single round trip. The board consumes the snapshot and
        // closes the stream (the break returns the iterator, which aborts
        // the underlying source). `hasMore` + the tail floor drive the
        // native "load earlier" grammar (see `page` below).
        const follow = methodOf('session', 'follow', remoteSession?.follow)
        if (follow === undefined) return unavailable('session.follow')
        try {
          const controller = new AbortController()
          const stream = follow({
            address: { kind: 'session', sessionId: request.sessionId },
            ...request.maxMessages !== undefined ? { maxMessages: request.maxMessages } : {},
          }, controller.signal)
          let events: readonly { event: unknown }[] = []
          let hasMore = false
          let floorSeq: number | undefined
          let projections: { asOfSeq?: number; values?: Record<string, unknown> } | undefined
          try {
            for await (const frame of stream as AsyncIterable<FollowFrame>) {
              if (frame.type !== 'snapshot') continue
              events = (frame.records ?? []).map(record => ({ event: record.event }))
              hasMore = frame.hasMore === true
              floorSeq = floorSeqOf(events)
              projections = frame.projections
              break
            }
          } finally {
            controller.abort()
          }
          return {
            result: {
              ok: true as const,
              value: {
                events,
                hasMore,
                ...floorSeq !== undefined ? { floorSeq } : {},
                ...projections !== undefined ? { projections } : {},
              },
            },
          }
        } catch (error) {
          const failure = error as Partial<RemoteFailure>
          const failureBody = {
            code: typeof failure.code === 'string' ? failure.code : 'follow/stream-failed',
            message: typeof failure.message === 'string' ? failure.message : String(error),
          }
          warnFailure('session.follow', failureBody)
          return {
            result: {
              ok: false as const,
              error: failureBody,
            },
          }
        }
      },
      page: async request => {
        // The native "load earlier" grammar: one `session.page` call pages
        // BACKWARD from `beforeSeq` (the window's first seq), returning the
        // earlier records plus its own `hasMore`. The hook accumulates pages
        // oldest-first; `follow`'s live tail then continues from the cursor.
        const call = methodOf('session', 'page', remoteSession?.page)
        if (call === undefined) return unavailable('session.page')
        const result = await asResult<PageResult>('session.page', call({
          address: { kind: 'session', sessionId: request.sessionId },
          beforeSeq: request.beforeSeq,
          maxMessages: request.maxMessages,
        }))
        if (!result.result.ok) return { result: result.result }
        const records = result.result.value.records ?? []
        return {
          result: {
            ok: true as const,
            value: {
              events: records.map(record => ({ event: record.event })),
              hasMore: result.result.value.hasMore === true,
              ...(() => {
                const floor = floorSeqOf(records.map(record => ({ event: record.event })))
                return floor !== undefined ? { floorSeq: floor } : {}
              })(),
            },
          },
        }
      },
      rename: request => {
        const call = methodOf('session', 'rename', remoteSession?.rename)
        if (call === undefined) return unavailable('session.rename')
        return asResult<{ title: string; seq: number }>('session.rename',
          call({ sessionId: request.sessionId, title: request.title }),
        )
      },
      attachment: request => {
        const call = methodOf('session', 'attachment', remoteSession?.attachment)
        if (call === undefined) return unavailable('session.attachment')
        return asResult<{ attachment: { mediaType: string }; data: string }>('session.attachment',
          call({ sessionId: request.sessionId, attachmentId: request.attachmentId as never }),
        )
      },
      models: async () => {
        // The per-session model read became the GLOBAL catalog in alpha.3
        // (`session/modelCatalog`; `default` is the deployment's current
        // selection). The face keeps the rc.7 `{current, groups}` envelope so
        // call sites stay unchanged; `sessionId` is ignored by the wire.
        const call = methodOf('session', 'modelCatalog', remoteSession?.modelCatalog)
        if (call === undefined) return unavailable('session.modelCatalog')
        const result = await call()
        if (!result.ok) {
          warnFailure('session.modelCatalog', result.error)
          return { result: { ok: false as const, error: result.error } }
        }
        const catalog = result.value as {
          default?: { provider?: string; model?: string; reasoningEffort?: string }
          groups?: readonly ModelProviderGroup[]
        }
        return {
          result: {
            ok: true as const,
            value: {
              current: {
                provider: catalog.default?.provider ?? '',
                model: catalog.default?.model ?? '',
                ...catalog.default?.reasoningEffort !== undefined
                  ? { reasoningEffort: catalog.default.reasoningEffort }
                  : {},
              },
              groups: catalog.groups ?? [],
            } as ModelCatalog,
          },
        }
      },
    },
    skills: {
      list: request => {
        const call = methodOf('skills', 'list', remoteSkills?.list)
        if (call === undefined) return unavailable('skills.list')
        return asResult<{ skills: readonly SkillEntry[] }>('skills.list',
          call({ sessionId: request.sessionId }),
        )
      },
    },
    agentPresets: {
      list: () => {
        const call = methodOf('agentPresets', 'list', remoteAgentPresets?.list)
        if (call === undefined) return unavailable('agentPresets.list')
        return asResult<{ presets: readonly AgentPresetEntry[] }>('agentPresets.list', call())
      },
      select: request => {
        const call = methodOf('agentPresets', 'select', remoteAgentPresets?.select)
        if (call === undefined) return unavailable('agentPresets.select')
        return asResult<unknown>('agentPresets.select', call(request.sessionId, request.agentPreset))
      },
    },
    fileUploads: {
      upload: async request => {
        // The official pre-step of the file lane: stage the EXACT bytes on
        // the SAME session, then carry only the opaque receipt in the prompt.
        // No file shape is ever invented here — the host mints the receipt.
        const call = methodOf('fileUploads', 'upload', remoteFileUploads?.upload)
        if (call === undefined) return unavailable('fileUploads.upload')
        const result = await asResult<{ receiptId: string; file?: { attachmentId: string; name: string; bytes: number } }>(
          'fileUploads.upload',
          call(request.sessionId, { data: request.data, ...request.name !== undefined ? { name: request.name } : {} }),
        )
        if (!result.result.ok) return { result: result.result }
        const receiptId = result.result.value.receiptId
        if (typeof receiptId !== 'string' || receiptId === '') {
          return {
            result: {
              ok: false as const,
              error: { code: 'fileUploads/bad-receipt', message: 'the host returned no file receipt' },
            },
          }
        }
        return { result: { ok: true as const, value: { receiptId } } }
      },
    },
    events: {
      mux: () => ({
        async *[Symbol.asyncIterator]() {
          // The host question channel moved off the legacy live stream in
          // 0.1.5; the plugin's question tracker falls back to the
          // controller-level pending map. The iterator HANGS instead of
          // ending so the tracker's reconnect loop never spins (a closed
          // stream would be read as a dead carrier and retried every second).
          console.warn('[dsh-task-board] live question stream unavailable on dsh 0.1.5: question live-stream disabled')
          await new Promise<void>(() => {})
        },
      }),
    },
    respond: async () => {
      console.warn('[dsh-task-board] question answer path unavailable on dsh 0.1.5: answers go through the native session')
      return { accepted: false }
    },
  }
}

// ─── Binding driver adapter (alpha.3 sessions.binding) ──────────────────────

/**
 * Adapt one alpha.3 bound session object to the core `SessionDriver` face.
 *
 * The alpha.3 session snapshot dropped the rc.7 `turnEnds` map (turn
 * bookkeeping moved into submission/queue mirrors), so the adapter derives
 * the ONE provably-ours turn boundary: the blank-session FIRST turn — the
 * `awaitingFirstTurn` edge stays pending until that first turn opens, and a
 * running→idle transition afterwards proves it closed. Later turns on reused
 * sessions settle through the host session list plus history tail (the
 * settlement authority), which keeps the rc.7 false-positive guard (a
 * previous turn ending while our prompt still queued) intact: the adapter
 * never fabricates a count it cannot prove.
 *
 * The internal subscription is deliberately permanent for the session's
 * lifetime — the derivation must never miss an edge — and is released by the
 * returned `dispose` (the caller registers it on its own fiber).
 *
 * @param session - the bound session object.
 * @returns the driver adapter plus its disposal.
 */
export function sessionDriverOf(session: BoundSessionFace): {
  driver: SessionDriver
  dispose: () => void
} {
  const turnEnds = new Map<number, number>()
  let awaitingFirst = false
  let lastRunning: boolean | undefined
  let latest = session.getSnapshot()
  const track = (): void => {
    latest = session.getSnapshot()
    if (latest.awaitingFirstTurn === true) awaitingFirst = true
    if (awaitingFirst && lastRunning === true && latest.running === false) {
      turnEnds.set(turnEnds.size + 1, Date.now())
    }
    lastRunning = latest.running
  }
  const dispose = session.subscribe(track)
  track()
  return {
    driver: {
      rename: title => session.rename(title),
      prompt: (content, mode) => session.prompt(content, mode),
      command: line => session.command(line),
      getSnapshot: () => ({
        running: latest.running,
        lastAgentError: latest.lastAgentError,
        turnEnds,
      }),
      subscribe: fn => session.subscribe(fn),
    },
    dispose,
  }
}

// ─── Question/respond RPC shapes (client-response wire) ─────────────────────

/** Branded correlation id minted by the caller and echoed by the response. */
export type RpcId = string & { readonly __rpcId: unique symbol }

/** One RPC failure body. */
export interface RpcError {
  readonly code: string
  readonly message: string
  readonly details?: object
}

/** One client-response message submitted to settle a suspended ask. */
export type ClientResponse = {
  readonly type: 'client-response'
  readonly rpcId: RpcId
  readonly result:
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: RpcError }
}

/** The API face the question tracker consumes (a subset of `ApiFace`). */
export type IApiClient = ApiFace

// ─── Slots / locale props (local re-declaration) ────────────────────────────

/**
 * The locale dictionary key map this plugin owns (namespace `dsh-task-board`).
 * Locale faces are merge tables in the host; re-declared locally so the card
 * component types without importing a platform package.
 */
export interface TaskBoardLocaleKeyMap {
  [key: string]: string
}

/** The locale prop share a slot component receives (`t` seat). */
export type PropsLocale = {
  t: (key: string) => string
}

/** The inject face share: inject members become component props. */
export type InjectFace<F> = {
  [K in keyof F]: F[K]
}

/**
 * The renderer-bound hook seat: the renderer binds the inject face's `hooks`
 * members to `use<Name>` props, each a selector hook over its snapshot store.
 */
export type SnapshotSelector<T> = (selector: (snapshot: T) => T) => T