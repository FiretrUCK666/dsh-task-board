/**
 * The merge KERNEL — the document-agnostic core of the host merge grammar.
 *
 * A "row" here is any record carrying a stable identity and a monotone
 * freshness stamp, and nothing else (see {@link MergeRow}). Everything that
 * makes a row's CONTENT its own business — what counts as a content change,
 * what counts as read state, which inbound grammar repairs a replica's shape,
 * where a row lands in the document's order — arrives as an injected function
 * ({@link MergeRowOps}). The board's task ledger injects its four; the second
 * document will inject its own and reuse every line of this file untouched.
 *
 * The file is named for its place in the board family. Nothing in it is
 * board-specific, and {@link MergeRowOps} is the whole of the seam: a document
 * that cannot answer all four questions has no business being merged.
 *
 * THE LAWS. Each one is implemented in exactly one place below:
 *
 * - AuthorSHIP beats clocks. A claimed row is taken unconditionally — the
 *   host's own serial order decides, so a device whose clock runs minutes
 *   behind keeps its newest gesture. An unclaimed row is an untouched copy and
 *   merges by `updatedAt` LWW, the host winning ties.
 * - A tombstone is stamped one millisecond above the newest `updatedAt` the
 *   host ever saw for that id: a delete outranks every stale copy other
 *   replicas still hold, while a genuinely newer edit (a concurrent revive)
 *   still wins and takes the row back. What the tombstone CARRIES besides those
 *   two stamps is the document's call, and the kernel never compares it (see
 *   {@link MergeTombstone}).
 * - Read state is a MONOTONE JOIN, never a register. Whichever row wins the
 *   content, "has the human seen it" only ever moves forward — and it joins
 *   even when NO content won, so a replica that merely opened a row can
 *   propagate what it saw without ever being able to clobber newer content.
 * - A commit that moves nothing returns the same objects. Stamps are
 *   diagnostics: written on every acceptance, deliberately NOT an input to the
 *   no-op predicate, or every re-stamp would become a change and a broadcast
 *   storm.
 *
 * TWO DATA STREAMS, DELIBERATELY NOT ONE. A tombstone suppresses a stale put
 * by the NORMALIZED row's `updatedAt`; its own stamp is the maximum of the RAW
 * rows the replica sent. They look like the same number and are two different
 * facts, so they stay two different variables here — collapsing them looks
 * tidier and silently changes what a delete outranks.
 */
/** A stable identity plus a monotone freshness stamp — the whole definition of
 *  "one row" in this grammar. Nothing else about a row is the kernel's
 *  business, which is why this is a constraint rather than a parameter. */
export interface MergeRow {
    readonly id: string;
    readonly updatedAt: number;
}
/** One tombstone: the logical stamp a newer edit must beat, plus the host
 *  wall time it was written (pruning key).
 *
 *  `row` is the DELETED ROW'S OWN TEXT, present only for documents that asked
 *  for it through {@link MergeRowOps.retainDeleted}. It exists so a deletion
 *  can be undone, and it is OPTIONAL in the strict sense: a tombstone without
 *  one suppresses exactly as before and simply has nothing to give back. Old
 *  files therefore need no migration, and a document that never opts in never
 *  pays for the storage — which is the whole reason this is an opt-in rather
 *  than the kernel's standing behaviour (a board card carries a prompt and
 *  attachments; keeping those for 30 days is a cost the board should never
 *  have inherited from a feature built for a note list).
 *
 *  THE PAYLOAD IS NOT PART OF THE TRUTH. {@link sameMergeState} compares
 *  tombstones by `{at, seenAt}` and never by `row`, because the payload is a
 *  convenience the host happens to have, not a claim any replica made. Two
 *  devices that disagree about whether a tombstone carries text have not
 *  diverged on any fact, and a predicate that said otherwise would have them
 *  trading the same commit back and forth forever: each side's commit changes
 *  the other's answer, so neither ever reaches a no-op. */
export interface MergeTombstone {
    at: number;
    seenAt: number;
    /** The row as it stood when the delete was honored, when kept. */
    row?: MergeRow;
}
/** One synced section: the value plus the client write stamp (LWW key). */
export interface MergeSection<T> {
    value: T;
    at: number;
}
/** One deletion a replica observed, with the stamp it computed against. */
export interface MergeDelete {
    id: string;
    baseUpdatedAt: number;
}
/** Tombstones older than this are pruned (a delete this old cannot still be
 *  contested by a realistic offline replica). */
export declare const TOMBSTONE_TTL_MS: number;
/** The larger of two optional read stamps (undefined = never seen). A read
 *  state only ever moves forward, so this join is the whole of it. */
export declare function maxSeen(a: number | undefined, b: number | undefined): number | undefined;
/** What a document's no-op predicate is allowed to look at. Deliberately no
 *  `stamps`: see the header. A document composes its own predicate from this
 *  part, and MUST compose one of its own — a single shared predicate across
 *  two documents reads one document's unchanged state as the other's change,
 *  which clears a replica in silence. */
export interface MergeTruth<Row extends MergeRow> {
    rows: readonly Row[];
    tombstones: Record<string, MergeTombstone>;
}
/** Structural equality of a no-op predicate's inputs.
 *
 *  TOMBSTONES COMPARE BY STAMP ONLY. `row` is excluded on purpose, and the
 *  reason is about convergence rather than tidiness: a payload is something
 *  the host may hold and a replica may not, so including it would make two
 *  documents that agree on every fact compare unequal, and each one's commit
 *  would then look like a change to the other. Two devices would ping-pong the
 *  same commit for as long as both stayed online. The row leaving `rows` is
 *  already the change the predicate reports; the copy inside the tombstone
 *  adds no fact to it. */
export declare function sameMergeState<Row extends MergeRow>(a: MergeTruth<Row>, b: MergeTruth<Row>): boolean;
/** The rows a merge produces, plus the two bookkeeping maps it maintains. */
export interface MergeState<Row extends MergeRow> {
    rows: Row[];
    tombstones: Record<string, MergeTombstone>;
    stamps: Record<string, number>;
}
/** The per-document half of the grammar: everything about a row that is not the
 *  merge. A document supplies these four and owns every behaviour below them;
 *  the kernel never looks inside a row. */
export interface MergeRowOps<Row extends MergeRow> {
    /** One incoming row through this document's own inbound grammar; undefined
     *  when the row is unusable. The host never trusts a replica's shape, and
     *  this is the single place a document says so. */
    normalize: (row: Row) => Row | undefined;
    /** The row's content fingerprint MINUS every read-state field: a claim
     *  vouches for content, never for "has the human seen it". */
    authorshipKey: (row: Row) => string;
    /** Fold the incoming row's read state into the content winner; the same
     *  object back when nothing moved (a join that allocates anyway would churn
     *  the document on every read). */
    mergeReadState: (winner: Row, incoming: Row) => Row;
    /** The document's row order: rows the host holds keep their slots, rows it
     *  lacked land where this document puts new rows. `resolved` holds only what
     *  survived `normalize` — an id this document's inbound grammar refused is
     *  simply absent, so skip it instead of asserting it exists. */
    sortRows: (hostRows: readonly Row[], incoming: readonly Row[], resolved: ReadonlyMap<string, Row>) => Row[];
    /**
     * OPTIONAL: what to keep of a row this delete removes, or nothing to keep.
     *
     * Absent means the tombstone is a bare stamp and the deletion is final.
     * Present, it is how a document says "my rows are things a person wrote, and
     * losing one loses their words"; the kernel copies the answer onto the
     * tombstone. Returning `undefined` for a particular row keeps that one
     * deletion final while the rest of the document stays recoverable.
     *
     * WHY OPTIONAL RATHER THAN A FIFTH REQUIRED ANSWER: whether a delete is worth
     * reversing is a property of the document, not of merging, and a document that
     * has no answer to give is not broken. Requiring it would force every future
     * document to answer a question that may not apply to it, and would make the
     * storage cost a decision every document pays whether it wants it or not.
     */
    retainDeleted?: (row: Row) => Row | undefined;
}
/**
 * Apply one replica's row commit to the host's rows and return the merged
 * state (the input is never mutated — both maps are copies).
 *
 * The contract, in the order it is applied:
 *
 * - put: a row the host lacks is inserted unless a tombstone outranks it (then
 *   the delete stands) and its tombstone is cleared; a row the host has is
 *   replaced when the replica CLAIMS it (content-equal claims are no-ops) or,
 *   unclaimed, when the incoming copy is simply newer. Every acceptance is
 *   stamped with the host clock.
 * - read state joins onto whichever row won, including when none did.
 * - delete: honored only when the host copy is not newer than the baseline the
 *   delete was computed against; deleting an id the host never had is a no-op
 *   and leaves any existing tombstone alone. What the tombstone KEEPS is the
 *   document's call (see {@link MergeRowOps.retainDeleted}); a document that
 *   does not opt in gets a bare stamp, exactly as before.
 * - pruning: tombstones past their TTL (and the stamps of rows long gone).
 *   Anything a tombstone carried goes with it, so a document that keeps deleted
 *   text keeps it for exactly as long as the tombstone survives and no longer.
 */
export declare function applyRowCommit<Row extends MergeRow>(state: MergeState<Row>, incoming: readonly Row[], claimed: ReadonlySet<string>, deleted: readonly MergeDelete[], ops: MergeRowOps<Row>, now: number): MergeState<Row>;
/**
 * Section merge. CLAIM protocol (a commit carrying `sectionClaims`): only a
 * claimed section is taken — unconditionally, re-stamped with the host clock
 * (client clocks never decide a section) — and an unclaimed section is
 * SKIPPED, so the baseline copy every commit rides can never clobber a newer
 * write. LEGACY (no `sectionClaims` field at all — a pre-claim client): plain
 * LWW on the client stamp, ties by arrival, so the later commit wins
 * deterministically.
 *
 * @param key - this document's name for the section. The claim list is keyed
 *  by it, which is why the kernel takes a name and not a set of sections: which
 *  sections exist is the document's business.
 */
export declare function mergeSection<T>(stored: MergeSection<T>, incoming: MergeSection<T>, clean: (raw: unknown) => T, key: string, now: number, sectionClaims: readonly string[] | undefined): MergeSection<T>;
