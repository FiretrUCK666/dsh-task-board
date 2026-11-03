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
import { type ActionDanger, type ActionDomain, type ActionKind, type ActionLane, type ActionSurface } from '../../core/board-actions.ts';
import { type BoardCommand, type BoardCommandCarrier, type BoardCommit, type BoardDoc, type CommandRelayStatus } from '../../core/board-doc.ts';
import { type ItemPurge, type ItemsCommit, type ItemsDoc } from '../../core/items-doc.ts';
import { type TaskRecord } from '../../core/tasks.ts';
import { type ItemStatus, type ItemStatusView } from '../../core/item.ts';
import type { ResolveKind } from '../../core/resolve.ts';
import type { SessionPosture, SessionPostureSources } from '../session-state.ts';
import type { ItemAddress } from '../board-route.ts';
export interface ToolCommitFace {
    getDoc(): BoardDoc;
    getItemsDoc(): ItemsDoc;
    commit(commit: BoardCommit): Promise<BoardDoc>;
    commitItems(commit: ItemsCommit): Promise<ItemsDoc>;
    /**
     * Erase one deleted row's text — the host's own operation, and the only one
     * that can: a commit carries rows and deletions, and a tombstone's payload is
     * a field the merge grammar never shows a replica. So it is on this face
     * rather than in the batch's commit path, and the batch asks for it the same
     * way the panel's HTTP route does.
     *
     * THE ADDRESS IS THE SERVICE'S OWN, not a narrowed copy of it. The tool has
     * already turned the number a model says out loud into the row's identity by
     * the time it gets here, and a second signature that took a bare id would be a
     * second name for one operation — with the real service no longer assignable
     * to this face, which is how a structural view starts drifting from the class
     * it is a view of.
     *
     * A face that cannot purge must say so rather than pretend: the model would
     * otherwise be told 「已生效」 about words that are still on disk.
     */
    purgeItem(of: ItemAddress, clientId: string): Promise<ItemPurge>;
    /** Relay one command to whichever replica holds the seat, and ANSWER WITH
     *  WHAT HAPPENED: a live engine that knows the carrier took it, nobody was
     *  there so it parked, or the live engine does not implement it and nothing
     *  was sent or parked. The whole union rides through: the catalog decides
     *  which carrier an action rides, and the relay carries it as-is. */
    submitCommand(command: BoardCommand): CommandRelayStatus;
    available: boolean;
}
export interface ToolDeps {
    board: () => ToolCommitFace | undefined;
    posture: (sessionId: string) => Promise<SessionPosture>;
    /** The live host faces, so a decision that needs to know whether a session
     *  is still working asks the SAME derivation the board does — never a second
     *  one written here. */
    sources: SessionPostureSources;
    /**
     * A workspace's display name, when this host knows one.
     *
     * OPTIONAL, and deliberately so: `ws:` is a board-side qualifier whose whole
     * job is 「cards in a workspace called this」, and a card with no workspace is
     * not in any workspace. Guessing a name would make the qualifier answer for a
     * host that cannot see it, so a host without this face simply does not offer
     * `ws:` — which is the honest answer, and the same one the board gives.
     */
    workspaceTitle?: (workspaceId: string) => string;
    /**
     * The vocabulary bridge, when this host can supply one.
     *
     * OPTIONAL for the same reason the workspace face is: a deployment without it
     * still works — the closed sets then keep the catalog's stricter reading — and
     * an absent face must degrade to 「the old behaviour」 rather than to a guess.
     */
    resolver?: ParamResolver;
    now: () => number;
    uuid: () => string;
}
/**
 * The tools below are the HOST's `ToolDefinition`, imported — a hand-written
 * copy of it compiles against itself and then fails on the first real
 * registration, which is what happened: `output` was simply absent, and
 * nothing in the tree could say so.
 *
 * Types only: `dependencies` stays empty, and the runtime the plugin loads
 * against is the host's own.
 */
export type { ToolDefinition, ToolOutputDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
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
 *  so a caller that only wants to know "what may I do" reads two lines.
 *
 *  NARROWING IS THE POINT OF `topic`, and the reason is a cost measurement rather
 *  than tidiness: the full answer is ~7,000 characters (36 actions × their
 *  parameters) and the tool is documented as 「先查后做」, so EVERY write began by
 *  paying for the whole catalog. That structure is wrong — a caller about to move
 *  one card does not need the nine preset actions — so the answer can now be
 *  asked for in three sizes:
 *
 *   · no topic        — the reach (verbs, reachable, humanOnly) plus the action
 *                       IDS and their one-line summaries, no parameters
 *   · `topic: 'task'` — one domain, in full
 *   · `topic: 'task.create'` — one action, in full
 *
 *  The sizes are DERIVED from the same catalog, so a compact answer cannot omit
 *  an action the full one has: it is the same list, sliced.
 */
export declare function capabilityView(topic?: string): {
    verbs: readonly string[];
    reachable: readonly string[];
    humanOnly: readonly string[];
    actions: readonly CapabilityAction[];
    /** What this answer covered, echoed so a caller can tell a slice from the whole. */
    scoped?: string;
    /** The domains an unscoped answer can be narrowed to. */
    domains?: readonly string[];
    /** How to ask for more, when this answer was narrowed. */
    hint?: string;
};
/** Every `key:value` the board's own filter box can offer — derived by asking
 *  the registry itself, one key at a time. A key added there appears here with
 *  no edit on this side. */
export declare function enumeratedFilters(): readonly string[];
/** The filter syntax, in the words BOTH registries use — and **both** is the
 *  point, not a nicety.
 *
 *  `taskboard_query`'s `filter` string is parsed by `matchItemQuery` for the item
 *  list AND by the board's own search, so the description has to cover both.
 *  Describe only the board's keys and the model is taught board keys (`has:*`,
 *  `is:*`) that the list silently treats as free words — a query that returns
 *  nothing and reports no error — while everything the list actually speaks
 *  (`status:`, `p1`–`p4`, `!1`–`!4`, `has:`, `#标签`) goes unmentioned.
 *  **A vocabulary taught by half is
 *  worse than none**: the model cannot tell 「no match」 from 「I used it wrong」.
 *
 *  Both halves are DERIVED from the registry that parses them, so a flag added to
 *  one appears in the description without anyone editing this file — which is the
 *  only arrangement in which the description cannot go stale quietly.
 */
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
    /**
     * The DERIVED status — what the reader sees, and what `status:inProgress`
     * filters on.
     *
     * Printing the STORED one is the same defect as a facet counting
     * by a different predicate than the list under it: a row hanging off a running
     * card filters into `status:inProgress` and then comes back printed as `open`,
     * with nothing in the answer saying the two are different questions. A model
     * that has just asked 「what is running」 must not be told the answer is empty.
     */
    readonly status: ItemStatusView;
    /** The stored tier, for the caller that needs to know a row reads `inProgress`
     *  because its card is running. Never the one a filter compares. */
    readonly storedStatus: ItemStatus;
    /** The linked card, or `undefined` — never a second copy of its title. */
    readonly taskId: string | undefined;
}
/**
 * The ONE place a card is looked up by what a caller said.
 *
 * A card is named by its TITLE, and titles are not unique — two cards called
 * 「收尾」 is an ordinary thing to have. The old lookup was
 * `tasks.find(t => t.id === of || t.title === of)`, which SILENTLY picked the
 * first: the model said 「把收尾移到已完成」, one of the two moved, the receipt
 * said 「已生效」, and nothing anywhere mentioned there had been two. A wrong
 * answer that looks like a right one is the exact failure mode this surface is
 * being rebuilt around.
 *
 * So a title that matches more than one card is a REFUSAL that lists them, and a
 * caller that meant one of them says which. The uuid keeps working (a caller that
 * has one has it for real), and a title wins over nothing.
 * @param tasks - the board.
 * @param spoken - what the caller said: a title, or an id.
 * @returns the card, or the sentence explaining which cards it could have meant.
 */
export declare function resolveCard(tasks: readonly TaskRecord[], spoken: unknown): {
    kind: 'found';
    task: TaskRecord;
} | {
    kind: 'missing';
} | {
    kind: 'ambiguous';
    matches: readonly TaskRecord[];
};
/** The refusal sentence for an ambiguous title, naming every candidate. */
export declare function ambiguousCardWhy(spoken: unknown, matches: readonly TaskRecord[]): string;
/**
 * The kind a report is filed under, decided from the report's FIELDS.
 *
 * The catalog's verb says which kind of change this was; the report's own
 * fields say whether there WAS one. **Neither is read out of the detail
 * sentence**: a receipt that classified itself by its own wording turns one
 * rewording into a wrong kind, a wrong first failure and a wrong summary —
 * with every functional test still green, because the wording was the only
 * thing that changed.
 * @param report - the report as the batch runner built it.
 * @returns the kind.
 */
export declare function kindOfReport(report: Omit<OpReport, 'kind'>): OpReport['kind'];
/**
 * The rows the engine ACCEPTED but has not run yet.
 *
 * Accepted is not executed: a card that renders these as done is lying, and
 * the summary that counts them as effects is lying in a bigger way.
 * @param reports - the batch's reports.
 * @returns the titles of the accepted-but-pending rows.
 */
export declare function enginePendingOf(reports: readonly OpReport[]): string[];
/**
 * The rows the relay REFUSED because the live engine cannot perform them.
 *
 * A separate list from {@link enginePendingOf} on purpose: 「等引擎上线」 and
 * 「这个页面做不了」 are different facts with different next moves (wait vs.
 * reload / use another device), and one list holding both would push the reader
 * toward the wrong one.
 */
export declare function engineUnsupportedOf(reports: readonly OpReport[]): string[];
/**
 * The op the batch stopped at: the first failure that was actually ATTEMPTED.
 *
 * A skipped op is not a failure — it never ran — so pointing the summary at
 * one would blame an op for something that did not happen to it.
 * @param reports - the batch's reports.
 * @returns the first real failure, or undefined when there was none.
 */
export declare function firstFailureOf(reports: readonly OpReport[]): OpReport | undefined;
/** Which of the two synced documents an op moved. */
export type ActionDocument = 'board' | 'items';
export interface OpReport {
    /** The op's own words back, so a report points at something. */
    readonly op: string;
    readonly ok: boolean;
    /** Which kind of change this was, from the catalog's verb — the only
     *  classification in the system, so a card and the model read one thing. */
    readonly kind: ActionKind | 'unchanged' | 'failed' | 'skipped';
    /** The short number and title this op touched, when it touched one. */
    readonly ref?: string;
    readonly title?: string;
    /**
     * WHICH DOCUMENTS ACTUALLY MOVED, and it is here because an action that writes
     * two documents cannot be reported by a subject-less 「已生效」.
     *
     * `item.promote` is the one: it creates a card AND links the row. The two
     * commits are separate, so a medium that takes the first and refuses the
     * second leaves the document in a half state — and a receipt saying
     * 「没写进去」 about the whole op is how a reader learns that this tool's
     * failure sentences do not mean what they say. A two-document action cannot
     * be reported by a subject-less 「已生效」.
     *
     * One document moved is the ordinary case and stays implicit; only an op that
     * moved two has to name them.
     */
    readonly documents?: readonly ActionDocument[];
    /**
     * THE OP WAS NOT EXECUTED: the batch stopped before it, or the call was
     * cancelled. It is a field because the sentence that says so is prose, and
     * prose can be reworded — a receipt that classifies itself by reading its
     * own wording turns one rewording into a wrong answer with nothing red.
     */
    readonly skipped?: boolean;
    /**
     * THE HOST TOOK NO CHANGE: the row already looked like this. A field for the
     * same reason as {@link skipped}.
     */
    readonly unchanged?: boolean;
    /**
     * WHERE THIS OP LANDED, as a value rather than as a sentence.
     *
     * The receipt used to carry a single `queued` boolean, and the boolean could
     * not express the case that mattered: a live engine that does not implement
     * the carrier. That one is neither "done" nor "queued", and the two-state
     * vocabulary had nowhere to put it, so it was reported as done.
     *
     * Every branch below assigns exactly one of these, and the sentence the model
     * reads is RENDERED from it — so 「已生效」 can only come out of the branch
     * that really wrote, and 「没有执行」 can only come out of a branch that
     * really did not.
     */
    readonly outcome?: OpOutcome;
    /** What happened, or what to change. Never a bare error code. Rendered
     *  FROM {@link outcome} for the engine lane, so the two cannot disagree. */
    readonly detail: string;
}
/**
 * One op's landing place. THREE lanes, because the batch has three:
 *
 *  · `document` — the host wrote a document. Only this lane may be counted as
 *    an effect;
 *  · `engine` — a command was relayed, and the STATUS says what the relay did
 *    with it. `broadcast` still is not "done": the engine took the request;
 *  · `none` — nothing was written and nothing was sent, with a reason.
 */
export type OpOutcome = {
    readonly lane: 'document';
    /** Which documents the write landed in — the two-document op names both. */
    readonly wrote: readonly ActionDocument[];
    /** True when the write changed nothing (the row already looked like this). */
    readonly unchanged?: true;
} | {
    readonly lane: 'engine';
    readonly status: CommandRelayStatus['status'];
    /** Which carrier, and — for `unsupported` — the one the page lacks. */
    readonly carrier: BoardCommandCarrier;
} | {
    readonly lane: 'none';
    readonly why: 'skipped' | 'refused' | 'rehearsed';
};
/** Why an op cannot run, in the words the catalog itself uses. */
export declare function refuseOp(id: string): {
    ok: false;
    detail: string;
};
/**
 * The resolver face this module takes, when the host has one.
 *
 * Declared structurally and passed in (never imported as a value from core, never
 * as a host service) because it must work in tests and in a deployment where the
 * workspace registry is absent: absent = the resolver only knows the built-in
 * vocabularies, which is the honest degradation.
 */
export interface ParamResolver {
    /**
     * Read one value into its stored spelling.
     * @param kind - the vocabulary.
     * @param value - what the caller said.
     * @returns the stored value, or undefined when it is not readable.
     */
    resolve(kind: ResolveKind, value: unknown): string | undefined;
    /**
     * The legal values, for a refusal to print.
     *
     * A REFUSAL WITHOUT THE LIST COSTS A SEARCH. 「认不出 Full access」 leaves the
     * caller with the same guess it already made; the list turns the correction into
     * a glance. This is also the only way a caller learns what a DEPLOYMENT's table
     * holds — those values are not in the catalog by design.
     * @param kind - the vocabulary.
     * @returns `value（label）` per candidate, empty when the host cannot say.
     */
    candidatesOf(kind: ResolveKind): readonly string[];
    /**
     * The refusal sentence for a value this face could not read.
     *
     * OPTIONAL because a face may only know how to READ and not how to explain; when
     * absent the caller falls back to its own sentence built from `candidatesOf`. It
     * exists so the wording lives in one place (`resolveWhy`) instead of being
     * re-typed at every door that refuses a value.
     * @param kind - the vocabulary.
     * @param value - what was said.
     * @returns the sentence, or '' when the value actually resolved.
     */
    whyNot?(kind: ResolveKind, value: unknown): string;
}
export interface ExecuteRequest {
    readonly ops: readonly {
        op: string;
        payload?: unknown;
    }[];
    readonly dry_run?: boolean;
    /**
     * The caller's promise that a retried batch is the SAME batch.
     *
     * A model that retries after a timeout cannot tell "my write did not land"
     * from "my write landed and the answer was lost", so it retries — and without
     * a key the retry is a second write. This is what makes the retry safe.
     *
     * A STRING, and the published schema says so. It was once declared and never
     * read, and while it was unread a promise nobody kept was worse than no
     * promise, because the caller was told it was protected; it is read now (see
     * the batch runner) and the schema publishes its real shape, because a key
     * published as a boolean arrives as `true`, fails the reader's string guard,
     * and fails open — silently, with the schema still claiming the protection.
     */
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
    /** The batch in the tool's OWN vocabulary, so a card can render it without
     *  re-reading prose. The kinds come from the catalog's `verb`, never from a
     *  name list written here. */
    readonly counts: Readonly<Record<ActionKind | 'unchanged' | 'failed' | 'skipped', number>>;
    /** Rows this op handed to the engine while no replica held the seat. They
     *  are ACCEPTED, not done — a card that renders them as "已执行" is lying. */
    readonly enginePending: readonly string[];
    /** Rows the relay REFUSED because the live engine does not implement their
     *  carrier. A separate field from {@link enginePending}, not folded into it:
     *  「等引擎上线」 and 「这个页面做不了」 have different next moves (wait vs.
     *  reload / another device), and one list holding both points the reader at
     *  the wrong one. */
    readonly engineUnsupported: readonly string[];
    /**
     * Set when this answer is an earlier one's, replayed because the caller
     * retried with the same key. Nothing ran this time — and saying so is the
     * whole point, because a retry that silently re-executed looks exactly like
     * one that did not.
     */
    readonly replayed?: true;
}
/** Forget every remembered key. For tests, and for nothing else. */
export declare function clearIdempotentReplies(): void;
export declare function runBatch(deps: ToolDeps, request: ExecuteRequest, exec?: ToolRunContext): Promise<ExecuteResult>;
/** Build the three tool definitions. Registration is the caller's job, so this
 *  stays a pure function of the catalog and the host faces. */
export declare function createTaskboardTools(deps: ToolDeps): readonly ToolDefinition[];
