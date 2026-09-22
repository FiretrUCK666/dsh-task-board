/**
 * Local platform adaptation layer.
 *
 * The `@deepseek-ai/dsh-client-runtime` package stopped at 0.1.x-rc.2 and was
 * removed from the line that ships today: the host's client module system only
 * resolves the PLATFORM_MODULES seed words (react / cordis / static UI
 * libraries), dynamic package rows, and registered factories — nothing else.
 * The domain API moved from `connection.api.*` to the Typert-generated
 * `ctx.remote.<ns>.*` surface, and `createSnapshotStore` belongs to the
 * `dsh-client-store` package the shell seeds but this plugin does not require.
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
import type { SessionDriver } from '../core/execution.ts';
/** Branded session id (the host brands its wire ids the same way). */
export type SessionId = string & {
    readonly __sessionId: unique symbol;
};
/** Branded workspace id. */
export type WorkspaceId = string & {
    readonly __workspaceId: unique symbol;
};
/**
 * Minimal observable snapshot source. Both `Session`-like objects and
 * snapshot stores satisfy it.
 */
export interface ObservableSnapshot<T> {
    getSnapshot(): T;
    subscribe(fn: () => void): () => void;
}
/**
 * Writable snapshot store (bare data face). Same shape as the official
 * client-store engine; implemented here without zustand/immer so the plugin
 * bundle needs no platform module beyond the baseline.
 */
export interface SnapshotStore<T> extends ObservableSnapshot<T> {
    /** Mutate the state through a draft (plain assignment on the draft object). */
    update(mutator: (draft: T) => void): void;
    /** Replace the state wholesale. */
    set(next: T): void;
}
/**
 * Create a snapshot store. Synchronous flush (controlled inputs need
 * same-tick echo); persistence is intentionally omitted — this plugin's
 * stores are projections, not durable state.
 *
 * @param init - initial state.
 * @returns the store.
 */
export declare function createSnapshotStore<T>(init: T): SnapshotStore<T>;
/** One Remote call's failure. */
export interface RemoteFailure {
    readonly code: string;
    readonly message: string;
    readonly details?: object;
}
/** One Remote call's result envelope. */
export type RemoteResult<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: RemoteFailure;
};
/** One prompt content part (the wire accepts text + temporary image bytes + staged file refs). */
export type PromptContentPart = {
    readonly type: 'text';
    readonly text: string;
} | {
    readonly type: 'image';
    readonly mediaType: string;
    readonly data: string;
    readonly name?: string;
} | {
    readonly type: 'file';
    readonly receiptId: string;
};
/** One complete model selection for a session. */
export interface ModelSelection {
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort?: string;
}
/** One model row in a discovery group. */
export interface DiscoveredModel {
    readonly id: string;
    readonly name: string;
    readonly reasoning?: {
        readonly efforts: readonly {
            readonly id: string;
            readonly name: string;
        }[];
        readonly defaultEffort?: string;
    };
}
/** One provider group in a model catalog. */
export interface ModelProviderGroup {
    readonly id: string;
    readonly models: readonly DiscoveredModel[];
}
/** The model catalog the model picker consumes. */
export interface ModelCatalog {
    readonly current: ModelSelection;
    readonly groups: readonly ModelProviderGroup[];
}
/** One skill available to a session's composer. */
export interface SkillEntry {
    readonly name: string;
    readonly description: string;
    readonly whenToUse?: string;
    readonly modelInvocable: boolean;
}
/** One agent-preset row. */
export interface AgentPresetEntry {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly isDefault: boolean;
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
            sessionId: SessionId;
            mode: 'queue' | 'steer';
            content: readonly PromptContentPart[];
        }): Promise<{
            result: RemoteResult<{
                accepted: true;
            }>;
        }>;
        selectModel(request: {
            sessionId: SessionId;
            provider: string;
            model: string;
            reasoningEffort?: string;
        }): Promise<{
            result: RemoteResult<{
                selected: ModelSelection;
            }>;
        }>;
        create(request: {
            workspaceId: WorkspaceId;
        }): Promise<{
            result: RemoteResult<{
                sessionId: SessionId;
            }>;
        }>;
        history(request: {
            sessionId: SessionId;
            maxMessages: number;
        }): Promise<{
            result: RemoteResult<{
                events: readonly {
                    event: unknown;
                }[];
                hasMore: boolean;
                floorSeq?: number;
                /** The follow opening's log cut — the page grammar's other half. */
                throughSeq?: number;
                projections?: {
                    values?: Record<string, unknown>;
                };
            }>;
        }>;
        page(request: {
            sessionId: SessionId;
            beforeSeq: number;
            maxMessages: number;
            /** The follow opening's log cut (required by the page grammar). */
            throughSeq?: number;
        }): Promise<{
            result: RemoteResult<{
                events: readonly {
                    event: unknown;
                }[];
                hasMore: boolean;
                floorSeq?: number;
            }>;
        }>;
        rename(request: {
            sessionId: SessionId;
            title: string;
        }): Promise<{
            result: RemoteResult<{
                title: string;
                seq: number;
            }>;
        }>;
        attachment(request: {
            sessionId: SessionId;
            attachmentId: string;
        }): Promise<{
            result: RemoteResult<{
                attachment: {
                    mediaType: string;
                };
                data: string;
            }>;
        }>;
        models(request: {
            sessionId?: SessionId;
        }): Promise<{
            result: RemoteResult<ModelCatalog>;
        }>;
    };
    skills: {
        list(request: {
            sessionId: SessionId;
        }): Promise<{
            result: RemoteResult<{
                skills: readonly SkillEntry[];
            }>;
        }>;
    };
    agentPresets: {
        list(request: {}): Promise<{
            result: RemoteResult<{
                presets: readonly AgentPresetEntry[];
            }>;
        }>;
        select(request: {
            sessionId: SessionId;
            agentPreset: string;
        }): Promise<{
            result: RemoteResult<unknown>;
        }>;
    };
    fileUploads: {
        upload(request: {
            sessionId: SessionId;
            data: string;
            name?: string;
        }): Promise<{
            result: RemoteResult<{
                receiptId: string;
            }>;
        }>;
    };
    events: {
        mux(request: {}, signal: AbortSignal): AsyncIterable<QuestionMuxEnvelope>;
    };
    respond(message: unknown): Promise<{
        accepted: boolean;
    }>;
}
/**
 * One mux frame envelope the question tracker reduces. The host replays
 * pending `ask_user_question` batches and pushes live session frames; the
 * shape is structural so the adapter can narrow it without a platform type.
 */
export type QuestionMuxEnvelope = {
    rpcId: string;
    payload: {
        type: 'session/event';
        sessionId: string;
        event: unknown;
    } | {
        type: 'question/requested';
        sessionId: string;
        questions: unknown;
    } | {
        type: 'question/resolved';
        questionRpcId: string;
    };
};
/** One `session.follow` stream frame (structural slice of the Typert union). */
export type FollowFrame = {
    readonly type: 'event';
    readonly event: unknown;
} | {
    readonly type: 'snapshot';
    readonly cursor: number;
    readonly records: readonly {
        readonly type: 'event' | 'chunks';
        readonly event: unknown;
    }[];
    readonly hasMore: boolean;
    readonly projections?: {
        readonly asOfSeq?: number;
        readonly values?: Record<string, unknown>;
    };
};
/** One `session.page` response (structural slice of the Typert contract). */
export type PageResult = {
    readonly records: readonly {
        readonly type: 'event';
        readonly event: unknown;
    }[];
    readonly hasMore: boolean;
};
/** The oldest event seq covered by one record window (undefined when empty). */
export declare function floorSeqOf(records: readonly {
    event: unknown;
}[]): number | undefined;
/** One session list row (alpha.3 `SessionSummary` projection). */
export interface SessionListSummary {
    id: SessionId;
    title?: string;
    displayTitle: string;
    cwd?: string;
    /** The workspace id the host attributes the session to, when known. */
    workspaceId?: string;
    /**
     * THE SESSION'S OWN turn flag — the official projection's meaning, and the
     * only one this field ever has. Surfaces ask "is anything still working?"
     * through the activity derivation (session-activity.ts), which is the only
     * place that rolls subagent descendants up; the settle/watchdog paths keep
     * reading this value verbatim.
     */
    running: boolean;
    /**
     * The session this one was spawned from (`parentSessionId` on the wire).
     * Declared because the lineage rollup reads it — a subagent's session row
     * carries it, and the rollup walks that link up to the turn that summoned
     * it. A fork also carries one (and no `origin`), which is why lineage gates
     * on `origin` FIRST.
     */
    parentId?: SessionId;
    /** Coarse durable origin (`'subagent'` marks an agent-summoned session). */
    origin?: 'subagent';
    /** Host "never started" flag: only a blank session may be reused for a run. */
    blank?: boolean;
    /** List-activity stamp: advances on every durable user message (the 0.1.5
     *  `api-session/activity` projection — the wake channel's list face). */
    updatedAt?: number;
}
/** The session-list snapshot `ctx.sessions.list` exposes.
 *
 *  NO `current` MEMBER. The host used to carry the selection here; it moved to
 *  the view layer (the workspace browser owns it and persists it), so the list
 *  is pure catalog. Declaring it would promise a field the host never sends —
 *  every read would silently yield `undefined`, which is exactly how the old
 *  board lost its "the user switched sessions" signal.
 */
export interface SessionListState {
    ids: readonly SessionId[];
    byId: Readonly<Record<string, SessionListSummary>>;
    phase: 'pending' | 'ready';
}
/** The snapshot the alpha.3 Session object publishes (structural slice). */
export interface BoundSessionSnapshot {
    readonly running: boolean;
    readonly lastAgentError: string | null;
    /**
     * Blank-session first-turn edge: true while the first accepted prompt has
     * not yet opened its turn. The board's driver adapter derives its turn-end
     * counter from this edge (see {@link sessionDriverOf}).
     */
    readonly awaitingFirstTurn?: boolean;
}
/** The live session object a binding hands out (structural slice of `Session`). */
export interface BoundSessionFace {
    prompt(content: readonly unknown[], mode: 'queue' | 'steer', signal?: AbortSignal, requestId?: string): Promise<{
        ok: true;
        value: {
            accepted: true;
        };
    } | {
        ok: false;
        error: RemoteFailure;
    }>;
    rename(title: string): Promise<unknown>;
    command(line: string): Promise<{
        ok: true;
        value: {
            matched: boolean;
        };
    } | {
        ok: false;
        error: unknown;
    }>;
    getSnapshot(): BoundSessionSnapshot;
    subscribe(fn: () => void): () => void;
    /**
     * Session projection layer (the official `projections.faceOf` read — the
     * goal verbs' call-time CAS ref comes from here). Absent on old hosts:
     * structural, never required — callers degrade without it.
     */
    projections?: {
        faceOf(key: string): {
            getSnapshot(): unknown;
        } | undefined;
    };
}
/** The structural slice of the `remote.goals` Typert stub the goal verbs
 *  call (positional `(sessionId, ref, …)`, GoalView results — verbatim the
 *  calls the harness's own GoalBar makes). Absent = the goal strip hides. */
export type GoalsRemoteFace = import('../core/goal-verbs.ts').GoalsRemoteFace;
/** One live binding record: the session object driving a host session. */
export interface SessionBinding {
    readonly session: BoundSessionFace;
}
/** The narrow `ctx.sessions` service face this plugin reads.
 *
 *  NAVIGATION IS DELIBERATELY ABSENT. The host used to expose `open(id)` /
 *  `current` here; the current contract states "navigation belongs to view
 *  owners" and removed both, so this plugin navigates through the layout
 *  service instead (see `buildApi`'s `sessions.open` adapter, which routes to
 *  `ctx.layout.selectPanel`). Reading a removed member would fail at runtime
 *  with nothing but a `TypeError` on the first click, so a face that never
 *  declares one is the structural guard.
 */
export interface ISessionsFace {
    list: ObservableSnapshot<SessionListState>;
    create(opts?: {
        workspaceId?: WorkspaceId;
        cwd?: string;
        sessionId?: SessionId;
    }): Promise<SessionId>;
    /**
     * Resolve the stable session binding (scope-addressed assembly feed). Pure
     * resolution — undefined for a session neither listed nor already scoped.
     */
    binding(id: SessionId): SessionBinding | undefined;
}
/** One workspace list row. */
export interface WorkspaceListRow {
    workspaceId: WorkspaceId;
    title: string;
    /** The workspace's own working directory (alpha.3 official `path`). */
    path?: string;
    /** Sessions the workspace owns (alpha.3 official `sessionIds`). */
    sessionIds?: readonly string[];
}
/** The workspace-list snapshot `ctx.workspaces.list` exposes. */
export interface WorkspaceListState {
    items: readonly WorkspaceListRow[];
    recentWorkspaceId?: WorkspaceId;
    archivedSessionIds: readonly string[];
}
/** The narrow `ctx.workspaces` service face this plugin reads. */
export interface IWorkspacesFace {
    list: ObservableSnapshot<WorkspaceListState>;
}
/**
 * The narrow `ctx.uiWorkspace` face this plugin reads: the official
 * navigation capability ("Select a Session and show its Conversation as one
 * UI navigation action"). This is the board's replacement for the removed
 * `sessions.open`, and the ONLY navigation the board performs.
 */
export interface IUiWorkspaceFace {
    openSession(target: SessionId): void;
}
/**
 * The narrow `ctx.layout` face this plugin reads: the official centre-stage
 * panel selector. `selectPanel(null)` shows the Conversation, which is how the
 * board's 返回 and its panel entry work — the panel selection IS the board's
 * visibility, so this is the only lever that can actually change what is on
 * screen (`@throws` when the id is not a registered main panel, hence the
 * guard at the call site).
 */
export interface ILayoutFace {
    selectPanel(panelId: string | null): void;
}
/** The narrow `ctx.uiSession` service face this plugin reads. The board only
 *  SUBSCRIBES to the official session-status snapshot (the same source the
 *  native sidebar and composer read) — it never registers its own waterfall
 *  listener and never publishes an interaction (publishing would race the
 *  native composer for the answer). Absent = the question card degrades to the
 *  waiting banner.
 *
 *  ENVELOPE NOTE: the host publishes per-session STATUS
 *  (`Map<sessionId, { running, pendingInteraction, completionUnread }>`), not
 *  a bare interaction map. This face declares the source; pending-mirror.ts is
 *  the single place that unwraps the envelope.
 */
export interface IUiSessionFace {
    readonly sessionStatus: {
        getSnapshot(): ReadonlyMap<string, unknown>;
        subscribe(listener: () => void): () => void;
    };
}
/**
 * The client root context this plugin's `apply` receives. Structural face of
 * the alpha.3 web shell: services arrive through cordis `inject` (slots,
 * locale, sessions, workspaces) plus the `remote` and `connection` services.
 */
export interface ClientContext {
    /** Register one fiber-scoped effect; returns the disposer. */
    effect(fn: () => void | (() => void), label?: string): void;
    /** Read a registered service by name (structural; absent = undefined). */
    get<T = unknown>(name: string): T | undefined;
    /** Locale service: register one namespace dictionary. */
    locale: {
        register(namespace: string, dictionaries: Record<string, unknown>): void;
    };
    /** Slot service: inject a registration for a declared slot. */
    slots: {
        inject(name: string, factory: () => unknown): () => void;
        register(entry: Record<string, unknown>, component: unknown): unknown;
    };
    /** Session object layer. */
    sessions: ISessionsFace;
    /** Workspace object layer. */
    workspaces: IWorkspacesFace;
    /** Session UI layer (the official session-status projection). */
    uiSession?: IUiSessionFace;
    /**
     * Workspace navigation layer (`ctx.uiWorkspace`, the official Client
     * navigation capability). This is where "show this session's conversation"
     * lives now that the session controller dropped `open`/`current` — the
     * controller's own contract states navigation belongs to view owners.
     * Optional: read through `ctx.get`, absent on a composition without the
     * workspace UI (the board then reports the navigation as failed instead of
     * throwing on an undefined member).
     */
    uiWorkspace?: IUiWorkspaceFace;
    /** Centre-stage panel selection (the board's own seat). */
    layout?: ILayoutFace;
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
            prompt(request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>;
            selectModel(request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>;
            create(request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>;
            rename(request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>;
            attachment(request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>;
            modelCatalog(signal?: AbortSignal): Promise<RemoteResult<unknown>>;
            follow(request: unknown, signal?: AbortSignal): AsyncIterable<unknown>;
            page(request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>;
        };
        fileUploads: {
            upload(agentId: SessionId, request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>;
        };
        skills: {
            list(request: unknown, signal?: AbortSignal): Promise<RemoteResult<unknown>>;
        };
        agentPresets: {
            list(signal?: AbortSignal): Promise<RemoteResult<unknown>>;
            select(agent: SessionId, agentPreset: string, signal?: AbortSignal): Promise<RemoteResult<unknown>>;
        };
    };
}
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
export declare function buildApi(ctx: ClientContext): ApiFace;
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
export declare function sessionDriverOf(session: BoundSessionFace): {
    driver: SessionDriver;
    dispose: () => void;
};
/** Branded correlation id minted by the caller and echoed by the response. */
export type RpcId = string & {
    readonly __rpcId: unique symbol;
};
/** One RPC failure body. */
export interface RpcError {
    readonly code: string;
    readonly message: string;
    readonly details?: object;
}
/** One client-response message submitted to settle a suspended ask. */
export type ClientResponse = {
    readonly type: 'client-response';
    readonly rpcId: RpcId;
    readonly result: {
        readonly ok: true;
        readonly value: unknown;
    } | {
        readonly ok: false;
        readonly error: RpcError;
    };
};
/** The API face the question tracker consumes (a subset of `ApiFace`). */
export type IApiClient = ApiFace;
/**
 * The locale dictionary key map this plugin owns (namespace `dsh-task-board`).
 * Locale faces are merge tables in the host; re-declared locally so the card
 * component types without importing a platform package.
 */
export interface TaskBoardLocaleKeyMap {
    [key: string]: string;
}
/** The locale prop share a slot component receives (`t` seat). */
export type PropsLocale = {
    t: (key: string) => string;
};
/** The inject face share: inject members become component props. */
export type InjectFace<F> = {
    [K in keyof F]: F[K];
};
/**
 * The renderer-bound hook seat: the renderer binds the inject face's `hooks`
 * members to `use<Name>` props, each a selector hook over its snapshot store.
 */
export type SnapshotSelector<T> = (selector: (snapshot: T) => T) => T;
