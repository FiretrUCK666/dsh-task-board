/**
 * The item domain model — one row of the 任务清单, the SECOND document this
 * plugin owns. It is a sibling of the task ledger, not a view over it: its own
 * document, its own truth, its own merge (the kernel in board-merge-core.ts is
 * what makes that possible, and this model is the shape that will feed it).
 *
 * What it borrows from the board is exactly one optional link — `taskId` — and
 * even that is READ, never re-judged: an item never decides for itself whether
 * its card is running. It asks {@link itemStatusOf}, which reads the card's own
 * live state, so the two surfaces cannot disagree about the same card.
 *
 * THREE DECISIONS THIS MODEL IS BUILT ON (all settled; the code is their
 * consequence, not their summary):
 *
 *  - Steps are ONE level. {@link ItemStep} has no children field, so nesting is
 *    not representable rather than merely discouraged. Progress is derived from
 *    the steps ({@link itemProgressOf}); there is no percentage to hand-fill,
 *    and a row with no steps has NO progress at all (an empty 0% bar is a lie
 *    about work that was never defined).
 *  - `ref` is the stable short number a person and a model both say out loud
 *    (`#12`). It is minted by a monotonic counter ON THE DOCUMENT and is never
 *    writable, so a replica cannot renumber the list under the user's feet — and
 *    no UUID ever has to leave the host to be named in a sentence.
 *  - The three times are three fields, never one. 最早开始 / 截止 / 硬期限 are
 *    different promises; collapsing them is how a soft deadline turns into a
 *    missed one.
 *
 * NEW-FIELD ADMISSION (the rule, so the next field asks for permission first):
 * a field enters this model only if it participates in FILTERING, SORTING or
 * DISPLAY. Everything else is written into `body` as prose, where it costs
 * nothing to keep and everything to model. That is why there is no `order`
 * (the list sorts itself), no `statusHistory` (nothing reads it) and no
 * `viewedAt` (the checklist is scanned, not watched — the board's unread
 * reminder has no business here).
 */
/** The stored status. 进行中 is NOT here: it is derived (see {@link itemStatusOf}). */
export type ItemStatus = 'open' | 'blocked' | 'done';
/** The status a surface may DISPLAY — the stored one, or the derived 进行中. */
export type ItemStatusView = ItemStatus | 'inProgress';
/** The four priority tiers, lowest first (the list sorts on this). */
export type ItemPriority = 'low' | 'normal' | 'high' | 'urgent';
/** Who wrote this row, and when. Kept so a bad row can be traced to its author. */
export type ItemOriginSource = 'human' | 'ai' | 'import';
/**
 * The provenance stamp. Storage text is DATA, never instruction: this field is
 * what lets a reader tell the two apart at a glance, so it is never rewritten
 * after birth (see {@link ITEM_FIELDS}).
 */
export interface ItemOrigin {
    source: ItemOriginSource;
    at: number;
    /** The session that wrote it, when a model did — the audit trail's handle. */
    sessionId?: string;
}
/** One checklist entry: a line of text and whether it is done. No children. */
export interface ItemStep {
    id: string;
    text: string;
    done: boolean;
}
/** One checklist row. */
export interface ItemRecord {
    /** Stable identity (uuid). Never shown, never writable, never spoken. */
    id: string;
    /** The short number this row is called by (`#12`). Document-minted. */
    ref: number;
    /** One-line title; may be empty, in which case the body's first line is it. */
    title: string;
    /** The body, as Markdown. */
    body: string;
    /** Context notes for whoever (model included) picks this up later. */
    notes: string;
    /** The checklist. One level; progress is derived from it. */
    steps: ItemStep[];
    status: ItemStatus;
    priority: ItemPriority;
    tags: string[];
    /** 最早开始 — the earliest moment this may be started. */
    startsAfter: number | undefined;
    /** 截止 — when it is wanted. */
    dueAt: number | undefined;
    /** 硬期限 — the one that does not move. */
    hardDueAt: number | undefined;
    /** The board card this item belongs to, if any (zero or one, never many). */
    taskId: string | undefined;
    origin: ItemOrigin;
    createdAt: number;
    updatedAt: number;
}
/** The closed status enum, in display order (进行中 is derived, never listed). */
export declare const ITEM_STATUSES: readonly ItemStatus[];
/**
 * The four priority tiers, listed LOW to HIGH — an ENUM order, not a ranking.
 *
 * Read it wherever tiers are LISTED (a dropdown, a filter menu, a `oneOf` the
 * catalog renders). Never sort on it: {@link itemPriorityRankOf} is the scale
 * that orders, and it runs the other way.
 */
export declare const ITEM_PRIORITIES: readonly ItemPriority[];
/**
 * How loud a tier is, as a number small enough to sort on.
 * @param priority - the tier.
 * @returns 0 for 紧急, 3 for 低; never a tie between two different tiers.
 */
export declare function itemPriorityRankOf(priority: ItemPriority): number;
/**
 * A verdict on one field: may an action write it, and if not, why not. The
 * three answers mean three different things, and the difference is the whole
 * point of the table:
 *
 * - `writable` — an action may write it, so it belongs in that action's params.
 * - `derived` — the system computes or assigns it from other state (a counter,
 *   a clock, another field). Writing it would overwrite a derivation, so it is
 *   refused; the derivation is the only writer.
 * - `forbidden` — no writer exists in this system at all, and that is the
 *   promise: the identity nobody may restate, and the provenance nobody may
 *   rewrite.
 *
 * The key set IS the type ({@link ItemRecord}), so adding a field to the model
 * without ruling on it here fails the build. That is the point: a field nobody
 * ruled on is a field nobody thought about.
 */
export interface FieldSpec {
    readonly access: 'writable' | 'derived' | 'forbidden';
    readonly why: string;
}
/** Every field of {@link ItemRecord}, ruled on.
 *
 *  `as const satisfies` rather than a bare annotation, and the reason is that
 *  the verdict has to be READABLE, not only writable: `item-transitions.ts`
 *  derives the patch type from the `access` column, so a field ruled
 *  `derived` or `forbidden` cannot be patched.
 *
 *  AND THE FAILURE IS SILENT, WHICH IS THE WHOLE POINT OF WRITING IT DOWN. An
 *  annotation widens `access` to the union of all three verdicts, so every key
 *  stops being `writable` and `WritableItemKey` collapses to `never` — which
 *  makes `ItemPatch` the EMPTY object type, and `{}` accepts any object literal
 *  there is. The gate does not fail the build; it OPENS, and a patch may then
 *  carry `ref`, `origin` or `id` straight into a row. Measured, not guessed: with
 *  this annotation in place `pnpm typecheck` is silent on a patch smuggling
 *  `ref`; with it reverted the same line also compiles, and only the
 *  `@ts-expect-error` ratchet in `item-transitions.ts` notices. So do not
 *  "simplify" this back into an annotation — the exhaustiveness check survives
 *  either way, and that is exactly what makes the change look harmless. */
export declare const ITEM_FIELDS: {
    readonly id: {
        readonly access: "forbidden";
        readonly why: "身份由文档分配；副本重述它就是换了一行";
    };
    readonly ref: {
        readonly access: "derived";
        readonly why: "短编号来自文档上的单调计数器，写它等于在别人脚下重排整张清单";
    };
    readonly title: {
        readonly access: "writable";
        readonly why: "一行标题，可以留空（空了就从正文首行补）";
    };
    readonly body: {
        readonly access: "writable";
        readonly why: "正文，Markdown；没进模型的新字段一律写这里";
    };
    readonly notes: {
        readonly access: "writable";
        readonly why: "给接手的人或模型看的上下文备注，参与展示";
    };
    readonly steps: {
        readonly access: "writable";
        readonly why: "勾选清单，参与展示；进度由它派生，不另存";
    };
    readonly status: {
        readonly access: "writable";
        readonly why: "开放/受阻/完成三选一；「进行中」是派生，不存";
    };
    readonly priority: {
        readonly access: "writable";
        readonly why: "四档，参与筛选与排序";
    };
    readonly tags: {
        readonly access: "writable";
        readonly why: "自由标签，参与筛选";
    };
    readonly startsAfter: {
        readonly access: "writable";
        readonly why: "最早开始，与截止、硬期限是三件不同的事";
    };
    readonly dueAt: {
        readonly access: "writable";
        readonly why: "截止时间，与硬期限语义不同，不挤成一列";
    };
    readonly hardDueAt: {
        readonly access: "writable";
        readonly why: "硬期限，唯一不会顺延的那个";
    };
    readonly taskId: {
        readonly access: "writable";
        readonly why: "关联看板卡片，零张或一张；只存链接，不存第二份判断";
    };
    readonly origin: {
        readonly access: "forbidden";
        readonly why: "来源标记是出事时的追溯凭据，出生后不可改写";
    };
    readonly createdAt: {
        readonly access: "derived";
        readonly why: "出生时刻，只有文档写";
    };
    readonly updatedAt: {
        readonly access: "derived";
        readonly why: "同步合并的 LWW 键，只能由写入漏斗盖章";
    };
};
/** Progress from the steps, or undefined when the row has no checklist at all. */
export interface ItemProgress {
    done: number;
    total: number;
    /** 0..1; the display layer decides how to draw it. */
    ratio: number;
}
/** The derived progress. NO steps means no progress — never a 0% bar. */
export declare function itemProgressOf(item: ItemRecord): ItemProgress | undefined;
/**
 * The one status derivation. 进行中 is not stored: it is whatever the LINKED
 * card is doing, read from the card's own live state — a second derivation
 * would be a second opinion, and the same card would then show two different
 * things in two places. A row with no card is never 进行中.
 *
 * @param linkedRunning - the linked card's live state (a card with no open run
 *  passes false). The caller reads it; this function never guesses it.
 */
export declare function itemStatusOf(item: ItemRecord, linkedRunning: boolean): ItemStatusView;
/** The title a surface shows: the row's own, else the body's first line. */
export declare function itemTitleOf(item: ItemRecord): string;
/** Which pair of the three dates is out of order, and by how much. */
export interface ItemDateConflict {
    /** The field that must not be later than its neighbour. */
    readonly field: 'startsAfter' | 'dueAt' | 'hardDueAt';
    readonly value: number;
    /** The date it may not exceed. */
    readonly limit: number;
}
/**
 * The three dates, checked against each other.
 *
 * The order is not a convention: `startsAfter` is when the work may begin, so a
 * start date after the wanted-by date is a promise the row cannot keep, and
 * `hardDueAt` is the one date that does not move, so a softer date past it is a
 * promise the reader has already broken. A row holding an impossible pair
 * renders as a schedule that cannot be believed, and nothing about it looks
 * wrong on screen.
 *
 * The conflict is REPORTED, never repaired. Silently swapping or clamping the
 * two would leave the reader's words changed with no note that they were, and a
 * quietly edited date is worse than an obviously broken one — so the write path
 * refuses and the surface says why.
 * @param item - the row.
 * @returns the first violated pair, or `undefined` when the three agree.
 */
export declare function itemDateConflict(item: ItemRecord): ItemDateConflict | undefined;
/** What a caller supplies to mint a row: everything the caller decided. */
export interface NewItemInput {
    readonly title: string;
    readonly body: string;
    readonly notes: string;
    readonly status: ItemStatus;
    readonly priority: ItemPriority;
    readonly steps?: readonly ItemStep[];
    readonly tags?: readonly string[];
    readonly startsAfter?: number;
    readonly dueAt?: number;
    readonly hardDueAt?: number;
    readonly taskId?: string;
}
/**
 * Mint a row, ready for the document to accept.
 *
 * ONE CONSTRUCTOR FOR BOTH WRITERS. A row used to be built twice — once by the
 * interface, once by the model — and that is how two halves of one document
 * drift into disagreeing about what a freshly written row looks like. Both go
 * through this, so the fields that must always agree always do.
 *
 * The id and the ORIGIN are parameters, and neither is defaulted. The number is
 * the document's to hand out, and the origin is the audit trail's handle which
 * {@link ITEM_FIELDS} forbids anyone from rewriting — so both are facts the
 * writer supplies rather than guesses this function would make on its behalf.
 * @param input - what the writer decided.
 * @param origin - who wrote it, and when.
 * @param id - the identity the document will key on.
 * @param now - the writing clock, stamped on both ends of the row.
 * @returns a row carrying `ref: 0`, which means "not numbered yet".
 */
export declare function newItem(input: NewItemInput, origin: ItemOrigin, id: string, now: number): ItemRecord;
/**
 * The validated-but-unrepaired shape: the medium's words, checked for the
 * fields that must be right for the row to exist at all, and left `unknown` for
 * the ones the normalizers below repair. A guard that promised more than it
 * checked would make every cast downstream a lie.
 */
interface RawItem {
    id: string;
    title: string;
    body: string;
    notes: string;
    createdAt: number;
    updatedAt: number;
    steps: unknown;
    origin: {
        source: ItemOriginSource;
        at: number;
        sessionId?: string;
    };
    ref?: unknown;
    status?: unknown;
    priority?: unknown;
    tags?: unknown;
    startsAfter?: unknown;
    dueAt?: unknown;
    hardDueAt?: unknown;
    taskId?: unknown;
}
/**
 * Structural check for a persisted row: what makes a row a ROW. Status and
 * priority stay free (the normalizers below repair them), and so do the steps'
 * own entries — those are repaired one by one in {@link normalizeSteps}.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE LEDGER GRAMMAR. `parseLedger` drops a
 * whole task when one of its execution rounds is malformed, and that is right
 * there: a round is a fact about a run, and silently keeping the card without it
 * would misreport its history. A checklist step is a line the person typed, and
 * the blast radius is the other way round — dropping the whole item (body,
 * notes, three dates) to fix one checkbox is the bug, not the repair. So the
 * row is checked and the entries are repaired.
 */
/**
 * The shape guard, exported because it is a CONTRACT and not a private helper.
 *
 * Everything downstream — the merge, the sort, the row projection — assumes a row
 * that passed here has FINITE numbers, because a `NaN` comparator does not throw:
 * `Array.prototype.sort` treats it as "equal", so the order quietly becomes
 * arrival order and two devices holding one document render two different lists.
 * A guard whose failure mode is invisible has to be reachable from a test, and it
 * was not.
 */
export declare function isItemRecordShape(value: unknown): value is RawItem;
/**
 * A finite timestamp, or undefined for every other shape (including NaN).
 *
 * EXPORTED, because "can this value be a moment" is one question with three
 * callers — the persisted row, the model writing a date, and a fresh capture —
 * and it lives next to the field ruling that says what a date MEANS. A value
 * that is not a finite number is not a promise; it is a sentence somebody typed
 * where a calendar was expected, and storing it would produce a row whose date
 * sorts and renders as though it were a day.
 */
export declare function itemInstantOf(raw: unknown): number | undefined;
/**
 * Tags: strings only, blanks dropped, order kept, duplicates folded.
 *
 * One grammar for the persisted row and for a writer's list alike, so the same
 * words cannot be filed twice on one surface and once on the other. Order is
 * kept because a tag list is read as a phrase, and the first tag is the one a
 * reader is most likely to have meant first.
 */
export declare function itemTagsOf(raw: unknown): string[];
/** Mint a fresh short number for a row the medium never carried one. */
export type RefMinter = () => number;
/**
 * Parse + repair a persisted checklist document; unusable rows are dropped.
 * Mirrors the ledger's grammar deliberately (same failure behaviour, same
 * console discipline, same "repair the field, never fail the row" law) so the
 * two documents cannot drift into different standards for the same mistake.
 *
 * @param raw - the persisted JSON text.
 * @param mintRef - the document's short-number counter. Required, not
 *  defaulted: a row's number is the document's to hand out, and a silent
 *  fallback that mints the same number twice would make two rows answer to
 *  one name.
 */
export declare function parseItems(raw: string | null, mintRef: RefMinter): ItemRecord[];
export {};
