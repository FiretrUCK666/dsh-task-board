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
 *   still wins and takes the row back.
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
  readonly id: string
  readonly updatedAt: number
}

/** One tombstone: the logical stamp a newer edit must beat, plus the host
 *  wall time it was written (pruning key). */
export interface MergeTombstone {
  at: number
  seenAt: number
}

/** One synced section: the value plus the client write stamp (LWW key). */
export interface MergeSection<T> {
  value: T
  at: number
}

/** One deletion a replica observed, with the stamp it computed against. */
export interface MergeDelete {
  id: string
  baseUpdatedAt: number
}

/** Tombstones older than this are pruned (a delete this old cannot still be
 *  contested by a realistic offline replica). */
export const TOMBSTONE_TTL_MS = 30 * 86_400_000

/** The larger of two optional read stamps (undefined = never seen). A read
 *  state only ever moves forward, so this join is the whole of it. */
export function maxSeen(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return a >= b ? a : b
}

/** What a document's no-op predicate is allowed to look at. Deliberately no
 *  `stamps`: see the header. A document composes its own predicate from this
 *  part, and MUST compose one of its own — a single shared predicate across
 *  two documents reads one document's unchanged state as the other's change,
 *  which clears a replica in silence. */
export interface MergeTruth<Row extends MergeRow> {
  rows: readonly Row[]
  tombstones: Record<string, MergeTombstone>
}

/** Structural equality of a no-op predicate's inputs. */
export function sameMergeState<Row extends MergeRow>(a: MergeTruth<Row>, b: MergeTruth<Row>): boolean {
  return JSON.stringify({ r: a.rows, x: a.tombstones })
    === JSON.stringify({ r: b.rows, x: b.tombstones })
}

/** The rows a merge produces, plus the two bookkeeping maps it maintains. */
export interface MergeState<Row extends MergeRow> {
  rows: Row[]
  tombstones: Record<string, MergeTombstone>
  stamps: Record<string, number>
}

/** The per-document half of the grammar: everything about a row that is not the
 *  merge. A document supplies these four and owns every behaviour below them;
 *  the kernel never looks inside a row. */
export interface MergeRowOps<Row extends MergeRow> {
  /** One incoming row through this document's own inbound grammar; undefined
   *  when the row is unusable. The host never trusts a replica's shape, and
   *  this is the single place a document says so. */
  normalize: (row: Row) => Row | undefined
  /** The row's content fingerprint MINUS every read-state field: a claim
   *  vouches for content, never for "has the human seen it". */
  authorshipKey: (row: Row) => string
  /** Fold the incoming row's read state into the content winner; the same
   *  object back when nothing moved (a join that allocates anyway would churn
   *  the document on every read). */
  mergeReadState: (winner: Row, incoming: Row) => Row
  /** The document's row order: rows the host holds keep their slots, rows it
   *  lacked land where this document puts new rows. `resolved` holds only what
   *  survived `normalize` — an id this document's inbound grammar refused is
   *  simply absent, so skip it instead of asserting it exists. */
  sortRows: (hostRows: readonly Row[], incoming: readonly Row[], resolved: ReadonlyMap<string, Row>) => Row[]
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
 *   and leaves any existing tombstone alone.
 * - pruning: tombstones past their TTL (and the stamps of rows long gone).
 */
export function applyRowCommit<Row extends MergeRow>(
  state: MergeState<Row>,
  incoming: readonly Row[],
  claimed: ReadonlySet<string>,
  deleted: readonly MergeDelete[],
  ops: MergeRowOps<Row>,
  now: number,
): MergeState<Row> {
  const tombstones: Record<string, MergeTombstone> = { ...state.tombstones }
  const stamps: Record<string, number> = { ...state.stamps }
  const result: Map<string, Row> = new Map(state.rows.map(row => [row.id, row]))

  // The RAW freshness the replica sent, per id — the first of the two streams
  // the header warns about. Read before normalization, because that is what the
  // tombstone stamp is computed against.
  const sentAt = new Map<string, number>()
  for (const row of incoming) sentAt.set(row.id, Math.max(sentAt.get(row.id) ?? -Infinity, row.updatedAt))

  // 1) puts — the replica's full array (absence is NOT a delete; deletes are
  // the explicit list below, so remote rows the replica never saw survive).
  for (const raw of incoming) {
    const row = ops.normalize(raw)
    if (row === undefined) continue
    const host = result.get(row.id)
    if (host === undefined) {
      const tomb = tombstones[row.id]
      if (tomb !== undefined && row.updatedAt <= tomb.at) continue
      delete tombstones[row.id]
      result.set(row.id, row)
      stamps[row.id] = now
      continue
    }
    let winner: Row | undefined
    if (claimed.has(row.id)) {
      // The replica vouches for this content: taken unconditionally
      // (host-serialized last-write-wins — a skewed clock cannot flip it).
      // A content-equal claim is a no-op.
      if (ops.authorshipKey(host) !== ops.authorshipKey(row)) winner = row
    } else if (row.updatedAt > host.updatedAt) {
      winner = row
    }
    // READ STATE IS A MONOTONE JOIN, and it runs even when no content won:
    // that is how a replica which merely opened a row propagates what it saw
    // without ever being able to clobber another replica's newer content.
    const merged = ops.mergeReadState(winner ?? host, row)
    if (winner !== undefined) {
      result.set(row.id, merged)
      stamps[row.id] = now
    } else if (merged !== host) {
      // Read state moved: the row changes, the stamp does not (a read is not
      // an edit, and must not look like one to the diagnostics).
      result.set(row.id, merged)
    }
  }

  // 2) deletes — honored against the host copy's freshness.
  for (const del of deleted) {
    const host = result.get(del.id)
    if (host === undefined) {
      // Already gone (another replica deleted it): keep the existing tombstone.
      continue
    }
    if (host.updatedAt > del.baseUpdatedAt) continue // edited after the replica's baseline → the delete loses
    // One millisecond above everything the host ever saw for this id, from
    // EITHER stream (the normalized host copy, the raw rows just sent).
    const newest = Math.max(host.updatedAt, sentAt.get(del.id) ?? -Infinity, 0)
    result.delete(del.id)
    delete stamps[del.id]
    tombstones[del.id] = { at: newest + 1, seenAt: now }
  }

  // 3) prune ancient tombstones (and the host stamps of rows long gone).
  for (const [id, tomb] of Object.entries(tombstones)) {
    if (now - tomb.seenAt > TOMBSTONE_TTL_MS && !result.has(id)) delete tombstones[id]
  }
  for (const id of Object.keys(stamps)) {
    if (!result.has(id)) delete stamps[id]
  }

  return { rows: ops.sortRows(state.rows, incoming, result), tombstones, stamps }
}

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
export function mergeSection<T>(
  stored: MergeSection<T>,
  incoming: MergeSection<T>,
  clean: (raw: unknown) => T,
  key: string,
  now: number,
  sectionClaims: readonly string[] | undefined,
): MergeSection<T> {
  if (sectionClaims !== undefined) {
    return sectionClaims.includes(key) ? { value: clean(incoming.value), at: now } : stored
  }
  const at = typeof incoming.at === 'number' && Number.isFinite(incoming.at) ? incoming.at : 0
  if (at < stored.at) return stored
  return { value: clean(incoming.value), at }
}
