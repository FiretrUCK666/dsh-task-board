/**
 * The three task-board tools (host half) — the model's whole surface on this
 * plugin: `taskboard_capabilities` (what can be done), `taskboard_query` (what
 * is there), `taskboard_execute` (do this batch).
 *
 * ── WHY THREE ───────────────────────────────────────────────────────────────
 * Read and write are separate names, which is what makes a read-only mode a
 * later possibility; and three names that mean three different things beat
 * thirty that overlap (near-identical tool names are the top cause of a model
 * picking the wrong one). The whole set fits the "3-5 hot tools" range.
 *
 * ── ONE CATALOG, FOUR VIEWS (this file is three of them) ────────────────────
 *
 * The action table in `board-actions.ts` is the authority. Nothing here writes
 * an action, a verb, a parameter, a danger level or a value list a second
 * time: the op enum is {@link TOOL_ACTION_IDS}, the parameter table is each
 * row's `params`, and the filter vocabulary comes from the SAME search registry
 * the board's own filter box completes from. A second list is the drift this
 * project has spent three knives removing; writing one here would put it back.
 *
 * ── THE THREE LAWS ──────────────────────────────────────────────────────────
 *
 * 1. THE CATALOG IS THE ONLY AUTHORITY, INCLUDING WHO MAY DO WHAT. An op may
 *    only name an action in {@link TOOL_ACTION_IDS}, so an action marked
 *    `surface: 'ui'` does not exist for this tool — it is not "refused", it is
 *    absent from the enum the model can even type, and if one is named anyway
 *    the answer says WHO may do it and why (the catalog's own `summary` says
 *    so out loud, so the model does not spend a turn discovering it).
 * 2. SHORT NUMBERS OUT, NEVER UUIDs. A person and a model both say "#12"; a
 *    uuid has to be carried through a conversation to be useful and the model
 *    invents them when it has to type one. Every row this tool returns carries
 *    its number and title, because a receipt the model can read back is what
 *    makes "把第 3 条删了" work on the next turn.
 * 3. A BUSINESS FAILURE SAYS WHAT TO CHANGE. Not a code, not a stack: the
 *    thing to fix and how. An unparseable spec, a missing required parameter
 *    and a target that does not exist are the three failures a model actually
 *    hits, and each one comes back with the correction attached.
 *
 * ── BATCH SEMANTICS (decided, not discovered here) ───────────────────────────
 *
 * `ops` run in order, the first failure stops the rest, nothing is rolled
 * back, and every op is reported. That is a deliberate trade: a cross-op undo
 * layer would be a second history beside the merge grammar, and the grammar is
 * where convergence across devices actually comes from. So the report is the
 * product: "前 2 条已生效，第 3 条失败：…". `dry_run` rehearses the WHOLE batch
 * on a document clone through the same code path — one at a time would be a
 * different function, and a rehearsal that differs from the real thing is not
 * a rehearsal.
 *
 * ── ENGINE-LANE OPS SAY SO WHEN NO ENGINE IS HOLDING THE SEAT ───────────────
 * A relayed command is accepted, not executed: the honest answer is "已受理，
 * 引擎当前不在线，将在引擎上线后执行". Pretending it ran is the failure mode.
 */
import { type ActionDanger, type ActionDomain, type ActionLane, type ActionSurface } from '../../core/board-actions.ts';
import { type BoardCommit, type BoardDoc } from '../../core/board-doc.ts';
import { type ItemsCommit, type ItemsDoc } from '../../core/items-doc.ts';
import type { SessionPosture } from '../session-state.ts';
export interface ToolCommitFace {
    getDoc(): BoardDoc;
    getItemsDoc(): ItemsDoc;
    commit(commit: BoardCommit): Promise<BoardDoc>;
    commitItems(commit: ItemsCommit): Promise<ItemsDoc>;
    /** Relay one run to whichever replica holds the seat. `queued` = no engine. */
    submitCommand(command: {
        type: 'run';
        taskId: string;
        trigger: 'manual' | 'schedule' | 'chain';
        clientId: string;
    }): {
        queued: boolean;
    };
    available: boolean;
}
export interface ToolDeps {
    board: () => ToolCommitFace | undefined;
    posture: (sessionId: string) => Promise<SessionPosture>;
    now: () => number;
    uuid: () => string;
}
interface ToolParameterSchema {
    readonly [key: string]: unknown;
}
/** The tool registration shape (structural — no SDK import). */
export interface ToolDefinitionLike {
    readonly name: string;
    readonly description: string;
    readonly parameters: ToolParameterSchema;
    readonly output: {
        readonly schema: ToolParameterSchema;
        render(args: unknown, value: unknown): {
            type: 'text';
            text: string;
        }[];
    };
    execute(args: unknown, exec?: {
        signal?: AbortSignal;
    }): Promise<unknown>;
}
/** One action as the model reads it: what it is, what it costs, who may do it,
 *  and every parameter with its own condition spelled out. */
export interface CapabilityAction {
    readonly id: string;
    readonly verb: string;
    readonly domain: ActionDomain;
    readonly lane: ActionLane;
    readonly danger: ActionDanger;
    readonly surface: ActionSurface;
    readonly summary: string;
    readonly params: Readonly<Record<string, {
        about: string;
        required: boolean;
        requiredWhen?: string;
        appliesWhen?: string;
        oneOf?: readonly string[];
    }>>;
}
/**
 * THE WHOLE CATALOG, rendered. One function, so the capability query, the tool
 * schema and any future surface cannot answer the question three ways.
 */
export declare function capabilityActions(): readonly CapabilityAction[];
/** What `taskboard_capabilities` answers: the model's own reach, stated first,
 *  so a caller that only wants to know "what may I do" reads two lines. */
export declare function capabilityView(): {
    verbs: readonly string[];
    reachable: readonly string[];
    humanOnly: readonly string[];
    actions: readonly CapabilityAction[];
};
/** Every `key:value` the board's own filter box can offer — derived by asking
 *  the registry itself, one key at a time. A key added there appears here with
 *  no edit on this side. */
export declare function enumeratedFilters(): readonly string[];
/** The filter syntax, in the words the registry uses. */
export declare function filterHelp(): {
    keys: readonly string[];
    values: readonly string[];
    syntax: string;
};
interface TaskRow {
    readonly title: string;
    readonly status: string;
}
interface ItemRow {
    readonly ref: string;
    readonly id: string;
    readonly title: string;
    readonly status: string;
}
export interface OpReport {
    /** The op's own words back, so a report points at something. */
    readonly op: string;
    readonly ok: boolean;
    /** The short number and title this op touched, when it touched one. */
    readonly ref?: string;
    readonly title?: string;
    /** What happened, or what to change. Never a bare error code. */
    readonly detail: string;
}
/** Why an op cannot run, in the words the catalog itself uses. */
export declare function refuseOp(id: string): {
    ok: false;
    detail: string;
};
export interface ExecuteRequest {
    readonly ops: readonly {
        op: string;
        payload?: unknown;
    }[];
    readonly dry_run?: boolean;
    readonly idempotencyKey?: string;
}
export interface ExecuteResult {
    readonly dryRun: boolean;
    readonly ok: boolean;
    /** One report per op that was attempted, in order. */
    readonly reports: readonly OpReport[];
    /** The line a person reads: how many landed, where it stopped. */
    readonly summary: string;
    readonly boardRevision: number;
    readonly itemsRevision: number;
    /** Only on a real run: the boards that moved, with their short numbers. */
    readonly changed?: {
        readonly tasks: readonly TaskRow[];
        readonly items: readonly ItemRow[];
    };
}
/**
 * Run a batch. Order, stop-at-first-failure, no rollback, report every op —
 * and `dry_run` rehearses the SAME code path against a clone, so a rehearsal
 * that disagrees with the real thing cannot happen.
 */
export declare function runBatch(deps: ToolDeps, request: ExecuteRequest): Promise<ExecuteResult>;
/** Build the three tool definitions. Registration is the caller's job, so this
 *  stays a pure function of the catalog and the host faces. */
export declare function createTaskboardTools(deps: ToolDeps): readonly ToolDefinitionLike[];
export {};
