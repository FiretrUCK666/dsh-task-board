/**
 * The items document — the SECOND synced document, and the first consumer of
 * the merge kernel. It is a sibling of the board ledger, not a view over it:
 * its own document, its own truth, its own tombstone space, its own no-op
 * predicate, and its own short-number counter.
 *
 * Everything below is the board's grammar (board-merge-core.ts) with five
 * answers supplied, and nothing more. That the KERNEL needed no change to
 * carry a document this different is the point of having extracted it — and it
 * is checked, not assumed: the board's own spec is unchanged, so the kernel's
 * behaviour on the board is the same behaviour it had before this file existed.
 *
 * ── THE SHORT NUMBER (`ref`), the one invariant this document owns ──────────
 *
 * A replica creates items optimistically, so it mints a number long before the
 * host has seen the row. Two replicas that have not seen each other mint the
 * SAME number for two different items, and the kernel will happily accept both:
 * rows merge by identity (`id`) and freshness (`updatedAt`), and `ref` is just
 * a field inside a row. Uniqueness is therefore NOT a merge invariant — it is
 * a DOCUMENT invariant, and this file is where it is enforced.
 *
 * THE LAW: the document is the only authority on a number, and every number
 * entering it — from any replica, from any field repair, from a corrupt file —
 * passes through ONE chokepoint, {@link assignItemRefs}, AFTER the merge:
 *
 *  - a number that is positive and NOT currently in use is KEPT. A replica's
 *    optimistic guess is honoured, so the ordinary single-device case displays
 *    the very number the device already showed, and nothing ever flickers.
 *  - a number that is missing, malformed, or ALREADY TAKEN is replaced with the
 *    smallest free number at or above the document's counter. Two racing
 *    replicas therefore end up 13 and 14 — no duplicate, no gap, and the same
 *    answer whoever arrives first, because the host's serial order is the
 *    arbiter (the same law the board already uses for equal stamps).
 *
 * WHY THE HOST ARBITRATES RATHER THAN LEAVING NUMBERS TO CLIENTS. Two options
 * were weighed. "Clients never mint" is collision-proof by construction, but
 * the panel is offline-first with a debounced commit, so every new row would
 * sit unnumbered until the round trip — and an unnumbered row cannot be
 * referred to ("把第 3 条改了"), which is exactly the receipt PRD §4.2 calls the
 * precondition for continuous conversation. Host-arbitrated minting keeps the
 * number on screen from the first frame, and a re-mint only ever fires in a
 * genuine two-device race — where somebody is wrong regardless. The only
 * question that race leaves open is whether the wrongness is silent and
 * permanent, or one hop and converged; this design is the second.
 *
 * WHAT THIS COSTS, STATED RATHER THAN DISCOVERED. A collision leaves no gap (13
 * and 14, dense). A CLAIM that reintroduces a number another row now holds does:
 * the number that row vacated is not reissued, so the list ends up with a hole
 * where it used to be. That is the deliberate trade — a gap is invisible in a
 * checklist, while the alternative (a number changing under a person who just
 * read it out loud) is a lie told to their face. The kernel is what makes the
 * vacated number unreachable: the claim is taken whole, number included, and by
 * then the document no longer knows the row ever held it.
 *
 * WHY THE COUNTER IS STORED AND NOT DERIVED FROM THE ROWS. A derived counter
 * (`max(refs) + 1`) would hand a DELETED item's number to the next item, and
 * since checklist deletions are recoverable (they go through a tombstone), a
 * later restore would put two `#60`s on the board — the same collision,
 * arriving through the back door. So `nextRef` is document state. Which is why
 * it is part of THIS document's no-op predicate (the board's `stamps` is
 * deliberately not part of the board's): a commit that mints a number has
 * changed the document, and a counter allowed to roll back on a no-op would
 * re-mint a number that is in use.
 *
 * ── WHY THIS DOCUMENT HAS NO SECTIONS ───────────────────────────────────────
 *
 * The board carries three synced sections beside its rows; the checklist
 * carries none, so an items commit has no `sectionClaims` and never calls the
 * kernel's section protocol. That is a fact about this document, not a missing
 * feature: adding a section later means giving it a claim protocol here, not
 * widening the kernel.
 */
import {
  applyRowCommit,
  sameMergeState,
  type MergeDelete,
  type MergeRowOps,
  type MergeTombstone,
} from './board-merge-core.ts'
import { parseItems, type ItemRecord } from './item.ts'

/** What a replica sends per commit: its whole view, the ids its own edits
 *  moved since its baseline (authorship claims), and the deletions it saw. */
export interface ItemsCommit {
  clientId: string
  items: readonly ItemRecord[]
  /** The rows THIS replica changed against its baseline — taken
   *  unconditionally (clock-independent); absence = untouched copy. */
  changed?: readonly string[]
  deleted: readonly MergeDelete[]
}

/** The full authoritative checklist the host owns and persists. */
export interface ItemsDoc {
  /** Host monotonic change counter. */
  revision: number
  /** The checklist rows (normalized, uniquely numbered, in document order). */
  items: ItemRecord[]
  /** itemId → tombstone; suppresses stale replicas resurrecting a delete. */
  tombstones: Record<string, MergeTombstone>
  /** itemId → host wall time the row was last accepted (diagnostics). */
  stamps: Record<string, number>
  /** The next short number to hand out. Never decreases, never reuses. */
  nextRef: number
  /** When the host first created the document (migration probe). */
  bornAt: number
}

/** A fresh empty checklist (host first boot; revision 0 marks "never committed"). */
export function emptyItemsDoc(now: number): ItemsDoc {
  return { revision: 0, items: [], tombstones: {}, stamps: {}, nextRef: 1, bornAt: now }
}

/** The highest number any row actually carries (0 for an empty checklist). */
function highestRefOf(items: readonly ItemRecord[]): number {
  let highest = 0
  for (const item of items) if (item.ref > highest) highest = item.ref
  return highest
}

/**
 * THE SHORT-NUMBER CHOKEPOINT. The only place a number is handed out, and the
 * only place uniqueness is decided (see the module header for why this is a
 * document invariant rather than a merge one).
 *
 * A number is kept when it is a positive integer nothing else in this document
 * is using; otherwise the row is re-stamped with the smallest free number above
 * every number the document already holds AND above `nextRef`. Both halves of
 * that sentence matter: a replica's own free guess is often far ahead of the
 * stored counter (a long-offline device mints 13 off a max of 12), so seeding
 * the counter from the stored value alone would hand the next collision a
 * number BELOW one already in use — and a list whose numbers run backwards is
 * worse than a list with a gap in it.
 *
 * Runs AFTER the merge, so a row that lost the merge never consumes a number,
 * and re-mints a row that arrived with a number somebody else already holds —
 * which is also how a checklist that was already broken (a hand-edited file, two
 * devices that raced before this law existed) heals on the next commit instead
 * of staying broken.
 */
function assignItemRefs(items: readonly ItemRecord[], nextRef: number): { items: ItemRecord[]; nextRef: number } {
  const taken = new Set<number>()
  const numbered: ItemRecord[] = []
  let counter = Math.max(1, Math.trunc(nextRef), highestRefOf(items) + 1)
  for (const item of items) {
    if (Number.isInteger(item.ref) && item.ref > 0 && !taken.has(item.ref)) {
      taken.add(item.ref)
      numbered.push(item)
      continue
    }
    // At most one skip per number already in use, so this cannot outrun the row
    // count no matter how far apart the numbers are.
    while (taken.has(counter)) counter++
    taken.add(counter)
    numbered.push(counter === item.ref ? item : { ...item, ref: counter })
    counter++
  }
  return { items: numbered, nextRef: counter }
}

/**
 * One row's authorship fingerprint, and it deliberately EXCLUDES the short
 * number. `ITEM_FIELDS` rules `ref` `derived` — the document's to hand out — so
 * a claim must not be able to carry one, exactly as a claim must not be able to
 * carry the board's read state. Without this, a replica whose copy predates a
 * collision correction would claim the stale number back on every edit and the
 * correction would never settle.
 *
 * The fields are listed one by one rather than spread, so the fingerprint
 * cannot silently change meaning if a field is added to the row or the parse
 * order is ever reordered.
 */
function itemAuthorshipKey(item: ItemRecord): string {
  return JSON.stringify({
    id: item.id,
    title: item.title,
    body: item.body,
    notes: item.notes,
    steps: item.steps,
    status: item.status,
    priority: item.priority,
    tags: item.tags,
    startsAfter: item.startsAfter,
    dueAt: item.dueAt,
    hardDueAt: item.hardDueAt,
    taskId: item.taskId,
    origin: item.origin,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  })
}

/** The number the sort reads for "when is this wanted" — unset rows sort last. */
const UNSET_DATE = Number.MAX_SAFE_INTEGER

function wantedAt(item: ItemRecord): number {
  const dates = [item.startsAfter, item.dueAt, item.hardDueAt].filter((at): at is number => at !== undefined)
  return dates.length === 0 ? UNSET_DATE : Math.min(...dates)
}

const STATUS_RANK: Record<ItemRecord['status'], number> = { open: 0, blocked: 1, done: 2 }
const PRIORITY_RANK: Record<ItemRecord['priority'], number> = { urgent: 0, high: 1, normal: 2, low: 3 }

/**
 * The document's own order, and a PURE FUNCTION of the document — which the
 * board cannot say of its own (a card's slot is a manual drag, so two devices
 * can disagree about it and the host settles it by arrival). The checklist has
 * no manual order (the new-field admission rule kept `order` out of the model),
 * so its order is derived, so two replicas holding the same rows show the same
 * list without ever syncing the order itself.
 *
 * Finished rows last, then urgency, then whichever of the three dates is
 * nearest, then age, then the short number — which is unique, so the comparison
 * is TOTAL and the result cannot depend on the order the rows arrived in.
 *
 * @param rows - the finished rows (numbers assigned, tombstones settled).
 */
export function sortItems(rows: readonly ItemRecord[]): ItemRecord[] {
  return [...rows].sort((a, b) =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status]
    || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || wantedAt(a) - wantedAt(b)
    || a.createdAt - b.createdAt
    || a.ref - b.ref)
}

/** What the inbound grammar writes for a number it could not read. NOT a usable
 *  number: the document's chokepoint mints the real one after the merge, so a
 *  row that LOSES the merge never burns a number. */
const UNSET_REF = 0

/** One incoming row through the checklist's own grammar. The host never trusts
 *  a replica's shape, and {@link parseItems} is where that is said. */
function normalizeIncomingItem(item: ItemRecord): ItemRecord | undefined {
  return parseItems(JSON.stringify([item]), () => UNSET_REF)[0]
}

/** The checklist's half of the grammar: the four answers only a checklist can
 *  give. Everything else the merge does is the kernel's.
 *
 *  Exported so the answers themselves can be pinned, and one of them cannot be
 *  pinned any other way: `mergeReadState` is the IDENTITY, and its entire
 *  correctness is that it is invisible from outside (an equal copy would still
 *  compare equal, so every document-level test would pass with the bug in
 *  place). A guarantee nobody can reach is a guarantee nobody has checked. */
export const ITEM_ROW_OPS: MergeRowOps<ItemRecord> = {
  normalize: normalizeIncomingItem,
  authorshipKey: itemAuthorshipKey,
  /**
   * THE IDENTITY, and that is the correct implementation rather than a missing
   * one. This document has no read state: `ITEM_FIELDS` carries no `viewedAt`,
   * because the checklist is scanned rather than watched and the board's unread
   * reminder has no business on a row that is not a run. A join of nothing with
   * nothing is the identity.
   *
   * It must return the winner OBJECT, not an equal copy: the kernel reads
   * `merged !== host` as "the read state moved", so a fresh-but-identical object
   * would make every untouched commit look like a change — a revision bump and a
   * broadcast on every keystroke's round trip, for nothing.
   */
  mergeReadState: winner => winner,
  sortRows: (_hostRows, _incoming, resolved) => sortItems([...resolved.values()]),
}

/** Structural equality of two checklists — the "did anything move" test that
 *  keeps a no-op commit from bumping the revision and storming replicas.
 *
 *  This is the CHECKLIST's own predicate and must never be shared with the
 *  board's. One predicate across two documents reads one document's unchanged
 *  state as the other document's change, and the replica that believes it loses
 *  its queue in silence. It is composed from the kernel's part, which IS shared,
 *  plus this document's own state.
 */
export function sameItemsDocs(a: ItemsDoc, b: ItemsDoc): boolean {
  return sameMergeState(
    { rows: a.items, tombstones: a.tombstones },
    { rows: b.items, tombstones: b.tombstones },
  ) && a.nextRef === b.nextRef
}

/**
 * Apply one replica's commit to the authoritative checklist and return the new
 * truth (the input is never mutated). The order of the three steps is the
 * design: merge, then hand out numbers, then order — so a number is only ever
 * minted for a row that survived, and the order is a function of the finished
 * document.
 *
 * The merge itself is the board's, unchanged: an unclaimed row merges by
 * `updatedAt` (host wins ties), a claimed row is taken unconditionally, a
 * tombstone outranks a stale copy, and a row whose content loses still has its
 * read state joined — which for this document means the identity above.
 */
export function applyItemsCommit(doc: ItemsDoc, commit: ItemsCommit, now: number): ItemsDoc {
  const merged = applyRowCommit(
    { rows: doc.items, tombstones: doc.tombstones, stamps: doc.stamps },
    commit.items,
    new Set(commit.changed ?? []),
    commit.deleted,
    ITEM_ROW_OPS,
    now,
  )
  const numbered = assignItemRefs(merged.rows, doc.nextRef)
  const next: ItemsDoc = {
    revision: doc.revision + 1,
    items: sortItems(numbered.items),
    tombstones: merged.tombstones,
    stamps: merged.stamps,
    nextRef: numbered.nextRef,
    bornAt: doc.bornAt,
  }
  return sameItemsDocs(doc, next) ? doc : next
}

/** Normalize an unknown persisted document: the medium's word is data, not
 *  truth. Junk degrades to the empty shape, rows go through the checklist's own
 *  grammar, and the short-number law runs here too — a file that was already
 *  broken heals on load instead of waiting for the next commit. */
export function normalizeItemsDoc(value: unknown, now: number = Date.now()): ItemsDoc {
  if (typeof value !== 'object' || value === null) return emptyItemsDoc(now)
  const row = value as Record<string, unknown>
  const revision = typeof row.revision === 'number' && Number.isFinite(row.revision) && row.revision >= 0
    ? Math.floor(row.revision)
    : 0
  const bornAt = typeof row.bornAt === 'number' && Number.isFinite(row.bornAt) ? row.bornAt : now
  const items = Array.isArray(row.items) ? parseItems(JSON.stringify(row.items), () => UNSET_REF) : []
  const numbered = assignItemRefs(items, Math.max(highestRefOf(items) + 1, 1))
  const tombstones: Record<string, MergeTombstone> = {}
  if (typeof row.tombstones === 'object' && row.tombstones !== null) {
    for (const [id, entry] of Object.entries(row.tombstones as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) continue
      const tomb = entry as Record<string, unknown>
      if (typeof tomb.at !== 'number' || !Number.isFinite(tomb.at)) continue
      tombstones[id] = {
        at: tomb.at,
        seenAt: typeof tomb.seenAt === 'number' && Number.isFinite(tomb.seenAt) ? tomb.seenAt : bornAt,
      }
    }
  }
  const stamps: Record<string, number> = {}
  if (typeof row.stamps === 'object' && row.stamps !== null) {
    for (const [id, at] of Object.entries(row.stamps as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at) && at >= 0) stamps[id] = at
    }
  }
  const storedNext = typeof row.nextRef === 'number' && Number.isFinite(row.nextRef) ? Math.trunc(row.nextRef) : 0
  return {
    revision,
    items: sortItems(numbered.items),
    tombstones,
    stamps,
    nextRef: Math.max(storedNext, numbered.nextRef, 1),
    bornAt,
  }
}
