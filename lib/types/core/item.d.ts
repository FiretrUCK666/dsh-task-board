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
/** The four priority tiers, lowest first. */
export declare const ITEM_PRIORITIES: readonly ItemPriority[];
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
/** Every field of {@link ItemRecord}, ruled on. */
export declare const ITEM_FIELDS: Record<keyof ItemRecord, FieldSpec>;
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
