/**
 * Items-document tests (src/core/items-doc.ts).
 *
 * The knife's question is one question — CAN TWO ROWS ANSWER TO THE SAME
 * NUMBER — and most of this file is that question asked from different
 * directions. The rest pins the three answers this document gives the kernel
 * (the authorship fingerprint, the identity read-state join, the derived
 * order), because those are where a second document could quietly become a
 * second grammar.
 *
 * Every test here drives the REAL kernel, so "the kernel needed no change for
 * a document this different" is measured, not asserted: the board's own spec is
 * untouched, and these run beside it.
 */
import { describe, expect, it } from 'vitest'
import {
  applyItemsCommit,
  deletedItemsOf,
  emptyItemsDoc,
  ITEM_ROW_OPS,
  normalizeItemsDoc,
  restoredItemOf,
  sameItemsDocs,
  sortItems,
  type ItemsCommit,
  type ItemsDoc,
} from '../src/core/items-doc.ts'
import { applyCommit, emptyBoardDoc, type BoardCommit } from '../src/core/board-doc.ts'
import { TOMBSTONE_TTL_MS } from '../src/core/board-merge-core.ts'
import { createTask } from '../src/core/tasks.ts'
import { itemDateConflict, type ItemRecord } from '../src/core/item.ts'

const T0 = 1_700_000_000_000

/** One id deliberately used by BOTH documents, to prove the key spaces are
 *  separate objects rather than separate intentions. */
const SHARED = 'shared-id'

/** One checklist row, with only what a test cares about overridden. */
function row(patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'i-1',
    ref: 1,
    title: 'a thing',
    body: '',
    notes: '',
    steps: [],
    status: 'open',
    priority: 'normal',
    tags: [],
    startsAfter: undefined,
    dueAt: undefined,
    hardDueAt: undefined,
    taskId: undefined,
    origin: { source: 'human', at: T0 },
    createdAt: T0,
    updatedAt: T0,
    ...patch,
  }
}

/** A commit carrying only what changed. */
function commitOf(overrides: Partial<ItemsCommit> = {}): ItemsCommit {
  return { clientId: 'c-1', items: [], deleted: [], ...overrides }
}

/** The short numbers a document currently hands out. */
function refsOf(doc: ItemsDoc): number[] {
  return doc.items.map(item => item.ref)
}

/** True when no two rows answer to the same number. */
function numbersAreUnique(doc: ItemsDoc): boolean {
  return new Set(refsOf(doc)).size === doc.items.length
}

describe('the short number: the collision law', () => {
  it('two replicas that never met, each minting the same number, never both survive it', () => {
    // The knife's whole question. Both replicas had seen #12, so both minted
    // #13 for a DIFFERENT item. The kernel takes both rows (different ids); the
    // document's chokepoint is what keeps the numbers apart.
    const first = applyItemsCommit(emptyItemsDoc(T0), commitOf({ clientId: 'phone', items: [row({ id: 'i-a', ref: 13 })] }), T0 + 1)
    const second = applyItemsCommit(first, commitOf({ clientId: 'laptop', items: [row({ id: 'i-b', ref: 13 })] }), T0 + 2)
    expect(second.items).toHaveLength(2)
    expect(numbersAreUnique(second)).toBe(true)
    expect(refsOf(second).sort((a, b) => a - b)).toEqual([13, 14])
  })

  it('holds whichever order the two commits arrive in', () => {
    const a = row({ id: 'i-a', ref: 13 })
    const b = row({ id: 'i-b', ref: 13 })
    const forwards = applyItemsCommit(
      applyItemsCommit(emptyItemsDoc(T0), commitOf({ clientId: 'phone', items: [a] }), T0 + 1),
      commitOf({ clientId: 'laptop', items: [b] }),
      T0 + 2,
    )
    const backwards = applyItemsCommit(
      applyItemsCommit(emptyItemsDoc(T0), commitOf({ clientId: 'laptop', items: [b] }), T0 + 1),
      commitOf({ clientId: 'phone', items: [a] }),
      T0 + 2,
    )
    // WHICH row keeps 13 is the host's serial order to decide — the same law the
    // board already uses for equal stamps. What must not vary is uniqueness.
    expect(numbersAreUnique(forwards)).toBe(true)
    expect(numbersAreUnique(backwards)).toBe(true)
    expect(refsOf(forwards).sort((a, b) => a - b)).toEqual(refsOf(backwards).sort((a, b) => a - b))
  })

  it('stays unique no matter how many replicas collide, and leaves no gap', () => {
    let doc = emptyItemsDoc(T0)
    const minted: ItemRecord[] = []
    for (let i = 0; i < 8; i++) {
      const next = row({ id: `i-${i}`, ref: 5 })
      minted.push(next)
      doc = applyItemsCommit(doc, commitOf({ clientId: `device-${i}`, items: [next] }), T0 + i + 1)
    }
    expect(doc.items).toHaveLength(8)
    expect(numbersAreUnique(doc)).toBe(true)
    // Dense: every replica asked for 5 and got a distinct answer from 5 upward,
    // so a person reading #5..#12 is reading eight different rows.
    expect(refsOf(doc).sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('keeps a number the host has never seen when nothing else holds it', () => {
    const doc = applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [row({ ref: 900 })] }), T0 + 1)
    expect(refsOf(doc)).toEqual([900])
  })

  it('re-mints a number that another row already holds, leaving the row itself alone', () => {
    const seeded = applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [row({ id: 'i-a', ref: 7, title: 'first' })] }), T0 + 1)
    const collided = applyItemsCommit(seeded, commitOf({ items: [row({ id: 'i-b', ref: 7, title: 'second' })] }), T0 + 2)
    const b = collided.items.find(item => item.id === 'i-b')!
    // Only the number moved: identity, content and provenance are the row's.
    expect(b.ref).not.toBe(7)
    expect(b.title).toBe('second')
    expect(b.origin).toEqual({ source: 'human', at: T0 })
  })

  it('mints for a number that is missing, zero, negative or fractional', () => {
    for (const ref of [0, -3, 2.5]) {
      const doc = applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [row({ ref })] }), T0 + 1)
      expect(refsOf(doc), `ref ${ref} should not survive`).toEqual([1])
    }
  })

  it('never hands a deleted row\'s number to a new row', () => {
    // Checklist deletions are RECOVERABLE (they go through a tombstone), so a
    // number that gets reused could come back with its old owner attached. This
    // is why the counter is stored rather than derived from the live rows.
    const seeded = applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [
      row({ id: 'i-a', ref: 60, updatedAt: T0 + 1 }),
      row({ id: 'i-b', ref: 61, updatedAt: T0 + 1 }),
    ] }), T0 + 1)
    const deleted = applyItemsCommit(seeded, commitOf({ deleted: [{ id: 'i-a', baseUpdatedAt: T0 + 1 }] }), T0 + 2)
    expect(refsOf(deleted)).toEqual([61])
    // A row the replica could not number at all is minted from the document's
    // counter — which is 62, not the freed 60.
    const fresh = applyItemsCommit(deleted, commitOf({ items: [row({ id: 'i-c', ref: 0 })] }), T0 + 3)
    expect(refsOf(fresh).sort((a, b) => a - b)).toEqual([61, 62])
  })

  it('still honours a free number a replica minted, even one below the counter', () => {
    // The other half of the law: the document re-issues a number only when it is
    // actually taken. A long-offline device minting #1 against a counter at 62
    // gets #1 — the number is free, and inventing a different one would change a
    // number the person is already looking at for no reason.
    const seeded = applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [row({ id: 'i-b', ref: 61 })] }), T0 + 1)
    const arrived = applyItemsCommit(seeded, commitOf({ items: [row({ id: 'i-c', ref: 1 })] }), T0 + 2)
    expect(refsOf(arrived).sort((a, b) => a - b)).toEqual([1, 61])
    expect(numbersAreUnique(arrived)).toBe(true)
  })

  it('keeps that number out of reach across a no-op commit (the counter never rolls back)', () => {
    const minted = applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [row({ id: 'i-a' })] }), T0 + 1)
    expect(minted.nextRef).toBe(2)
    // A commit that changes nothing hands back the SAME document — so if the
    // counter were not part of the predicate, it would silently rewind here and
    // the next row would be handed #1 again.
    const noop = applyItemsCommit(minted, commitOf(), T0 + 2)
    expect(noop).toBe(minted)
    expect(noop.nextRef).toBe(2)
  })

  it('lets a claim NOT carry a stale number back over a correction, and settles', () => {
    // The replica still says 13; the host has since corrected that row to 14.
    // The claim is for a content edit, and the number is the document's to own —
    // so the edit lands and 13 does not come back.
    const raced = applyItemsCommit(
      applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [row({ id: 'i-a', ref: 13 })] }), T0 + 1),
      commitOf({ items: [row({ id: 'i-b', ref: 13 })] }),
      T0 + 2,
    )
    const edited = applyItemsCommit(raced, commitOf({
      items: [row({ id: 'i-b', ref: 13, title: 'edited by the phone' })],
      changed: ['i-b'],
    }), T0 + 3)
    const b = edited.items.find(item => item.id === 'i-b')!
    expect(b.title).toBe('edited by the phone')
    expect(b.ref).not.toBe(13)
    expect(numbersAreUnique(edited)).toBe(true)
    // The cost, stated: the number this row vacated is not reissued, so there is
    // a gap. A gap is invisible in a checklist; a number that changes under a
    // person who just read it out loud is not.
    expect(refsOf(edited).sort((a, b) => a - b)).toEqual([13, 15])
    // And it settles: the next commit carrying the host's own number changes nothing.
    const settled = applyItemsCommit(edited, commitOf({ items: edited.items, changed: ['i-b'] }), T0 + 4)
    expect(settled).toBe(edited)
  })

  it('heals a checklist that was already broken, on the next commit', () => {
    // A file edited by hand, or written before this law existed: two rows, one
    // number. The next commit repairs it instead of leaving it broken.
    const broken: ItemsDoc = {
      ...emptyItemsDoc(T0),
      items: [row({ id: 'i-a', ref: 3 }), row({ id: 'i-b', ref: 3 })],
      nextRef: 3,
    }
    const healed = applyItemsCommit(broken, commitOf(), T0 + 1)
    expect(numbersAreUnique(healed)).toBe(true)
    expect(refsOf(healed).sort((a, b) => a - b)).toEqual([3, 4])
  })
})

describe('the read state join is the identity, and says why', () => {
  it('returns the winner object itself, never an equal copy', () => {
    // The kernel reads `merged !== host` as "the read state moved". A copy would
    // make every untouched commit look like a change: a revision bump and a
    // broadcast for every row trip. This is the one answer with no observable
    // effect from outside — an equal copy would still compare equal, so every
    // other test in this file would pass with the bug in place.
    const winner = row({ id: 'i-a' })
    const incoming = row({ id: 'i-a', updatedAt: T0 + 99 })
    expect(ITEM_ROW_OPS.mergeReadState(winner, incoming)).toBe(winner)
  })

  it('leaves an unclaimed newer copy alone when it is content-equal', () => {
    const seeded = applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [row({ id: 'i-a' })] }), T0 + 1)
    const again = applyItemsCommit(seeded, commitOf({ items: [row({ id: 'i-a' })] }), T0 + 2)
    expect(again).toBe(seeded)
  })
})

describe('the authorship fingerprint', () => {
  const key = (item: ItemRecord) => ITEM_ROW_OPS.authorshipKey(item)

  it('counts every field a replica may legitimately edit as content', () => {
    const base = row()
    const edits: Array<[string, Partial<ItemRecord>]> = [
      ['title', { title: 'other' }],
      ['body', { body: 'other' }],
      ['notes', { notes: 'other' }],
      ['steps', { steps: [{ id: 's1', text: 'a', done: true }] }],
      ['status', { status: 'done' }],
      ['priority', { priority: 'urgent' }],
      ['tags', { tags: ['x'] }],
      ['startsAfter', { startsAfter: T0 + 5 }],
      ['dueAt', { dueAt: T0 + 5 }],
      ['hardDueAt', { hardDueAt: T0 + 5 }],
      ['taskId', { taskId: 't-1' }],
      ['updatedAt', { updatedAt: T0 + 1 }],
    ]
    for (const [field, patch] of edits) {
      expect(key(row(patch)), `${field} must count as content`).not.toBe(key(base))
    }
  })

  it('does NOT count the short number — the document owns that, not the claim', () => {
    // The load-bearing exclusion. If the number were in the fingerprint, every
    // content-equal claim that happens to carry a stale number would look like a
    // real edit, the host would take the stale number, and the collision
    // correction would be undone on the next keystroke.
    expect(key(row({ ref: 99 }))).toBe(key(row({ ref: 1 })))
  })

  it('ignores the order the fields happen to sit in on the row', () => {
    // Built as an explicit field list, so a reordered parse or a reordered
    // interface can never silently change what "the same content" means. A
    // fingerprint that spread the row would pass every other test here and
    // fail only here.
    const same = row()
    const shuffled = Object.fromEntries(
      (Object.keys(same) as Array<keyof ItemRecord>).reverse().map(field => [field, same[field]]),
    ) as unknown as ItemRecord
    expect(Object.keys(shuffled)).not.toEqual(Object.keys(same))
    expect(key(shuffled)).toBe(key(same))
  })
})

describe('the order is a pure function of the document', () => {
  it('puts finished rows last, then urgency, then the nearest date, then age', () => {
    const rows = [
      row({ id: 'done', ref: 1, status: 'done', priority: 'urgent' }),
      row({ id: 'low', ref: 2, priority: 'low' }),
      row({ id: 'far', ref: 3, priority: 'normal', dueAt: T0 + 900 }),
      row({ id: 'soon', ref: 4, priority: 'normal', dueAt: T0 + 10 }),
      row({ id: 'urgent', ref: 5, priority: 'urgent' }),
      row({ id: 'blocked', ref: 6, status: 'blocked' }),
    ]
    expect(sortItems(rows).map(item => item.id)).toEqual(['urgent', 'soon', 'far', 'low', 'blocked', 'done'])
  })

  it('is total, so an unset date never makes the comparison meaningless', () => {
    // Two rows with no dates at all: Infinity minus Infinity is NaN, and a NaN
    // comparator leaves the order up to the engine — which is exactly the "two
    // replicas show the same rows in different orders" bug. The short number
    // settles it, and it settles it the same way every time.
    const x = row({ id: 'x', ref: 2 })
    const y = row({ id: 'y', ref: 1 })
    expect(sortItems([x, y]).map(item => item.id)).toEqual(['y', 'x'])
    expect(sortItems([y, x]).map(item => item.id)).toEqual(['y', 'x'])
  })

  it('gives two replicas holding the same rows the same order, without syncing the order', () => {
    const a = row({ id: 'i-a', ref: 1, priority: 'low' })
    const b = row({ id: 'i-b', ref: 2, priority: 'urgent' })
    // The same two rows arriving in opposite array order, on two documents that
    // already hold a third row each.
    const base = row({ id: 'i-z', ref: 3, priority: 'normal' })
    const left = applyItemsCommit(
      applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [base] }), T0 + 1),
      commitOf({ clientId: 'phone', items: [a, b] }),
      T0 + 2,
    )
    const right = applyItemsCommit(
      applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [base] }), T0 + 1),
      commitOf({ clientId: 'laptop', items: [b, a] }),
      T0 + 2,
    )
    expect(left.items.map(item => item.id)).toEqual(right.items.map(item => item.id))
  })
})

describe('a row with impossible dates is kept verbatim, not repaired', () => {
  // The judgment itself — which pair of the three dates contradicts, and by how
  // much — belongs to `itemDateConflict` in `item.ts`, beside the other pure
  // reads of a row, and is specified there. What this file owns is the
  // DOCUMENT's behaviour when such a row arrives, which is a different question
  // and the one that would otherwise go unanswered: the grammar is the last
  // place that could quietly tidy the data, and it does not.
  const dated = (over: Partial<ItemRecord>) => row({ id: 'i-d', startsAfter: T0 + 10, dueAt: T0 + 20, hardDueAt: T0 + 30, ...over })

  it('keeps the broken row and the reader\'s words, rather than repairing or dropping it', () => {
    // The tempting repairs are both worse than the disease: reordering the three
    // changes what the person wrote and reports success, dropping the row loses
    // their words over a mistake in a date field. So the grammar lets an
    // impossible row through untouched and hands the read side the question.
    const broken = dated({ startsAfter: T0 + 25, dueAt: T0 + 20 })
    const doc = applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [broken] }), T0 + 1)
    const kept = doc.items.find(item => item.id === 'i-d')!
    expect(kept.title).toBe(broken.title)
    expect(kept.startsAfter).toBe(T0 + 25)
    expect(kept.dueAt).toBe(T0 + 20)
    // Still reported as broken on the way out: nothing "healed" it in transit,
    // which is what makes the conflict reproducible instead of a warning the
    // reader saw once and can never see again.
    expect(itemDateConflict(kept)).toEqual({ field: 'startsAfter', value: T0 + 25, limit: T0 + 20, limitField: 'dueAt' })
  })

  it('keeps a row that is merely sparse, and never invents a conflict out of an absent date', () => {
    // The other half of "does not repair": a row with one date is not a broken
    // row, and a grammar that treated a missing field as a value would either
    // reject those rows or start filling them in.
    for (const over of [
      { startsAfter: undefined },
      { dueAt: undefined },
      { hardDueAt: undefined },
      { startsAfter: undefined, dueAt: undefined },
    ]) {
      const doc = applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [dated(over)] }), T0 + 1)
      const kept = doc.items.find(item => item.id === 'i-d')!
      expect(kept, JSON.stringify(over)).toBeDefined()
      expect(itemDateConflict(kept), JSON.stringify(over)).toBeUndefined()
    }
  })

  it('holds a payload in a tombstone to the same law, so the archive is not a way around it', () => {
    // Otherwise the row is contradictory right up until it is deleted, and the
    // archive hands back a row that is suddenly "fine" — at exactly the moment
    // the reader is looking at it to decide whether it was ever real.
    const broken = dated({ dueAt: T0 + 35, hardDueAt: T0 + 30 })
    const seeded = applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [broken] }), T0 + 1)
    const deleted = applyItemsCommit(seeded, commitOf({ deleted: [{ id: 'i-d', baseUpdatedAt: T0 }] }), T0 + 2)
    expect(itemDateConflict(deletedItemsOf(deleted)[0]!)).toEqual({ field: 'dueAt', value: T0 + 35, limit: T0 + 30, limitField: 'hardDueAt' })
  })
})

describe('a delete keeps the row, and the promise is only as wide as the window', () => {
  /** One seeded row, one delete, and whatever the document answers. */
  const removed = (over: Partial<ItemRecord> = {}, at = T0 + 10) => {
    const seeded = applyItemsCommit(
      emptyItemsDoc(T0),
      commitOf({ items: [row({ id: 'i-a', ref: 5, title: 'a thought worth keeping', ...over })] }),
      T0 + 1,
    )
    const deleted = applyItemsCommit(seeded, commitOf({ deleted: [{ id: 'i-a', baseUpdatedAt: T0 }] }), at)
    return { seeded, deleted }
  }

  it('keeps the text the delete removed, so "still recoverable" is true', () => {
    // The panel prints 删除后这一条仍可恢复 in front of the reader. Before this,
    // the tombstone held two timestamps and the words were gone the instant the
    // row was — so that sentence described a system that did not exist.
    const { deleted } = removed({ body: 'the body that matters', notes: 'why' })
    const archive = deletedItemsOf(deleted)
    expect(archive.map(item => item.id)).toEqual(['i-a'])
    expect(archive[0]!.title).toBe('a thought worth keeping')
    expect(archive[0]!.body).toBe('the body that matters')
    expect(archive[0]!.notes).toBe('why')
  })

  it('keeps what the HOST held, not what the deleting replica happened to be carrying', () => {
    // Every commit carries the replica's whole view, so a delete always rides
    // along with a copy of the row it removes. The payload is read from the
    // host's row, so a copy that lost the put cannot decide what comes back —
    // otherwise "restore" would hand back words from a device that lost the
    // argument, and the other device would disagree about what the row was.
    const seeded = applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [row({ id: 'i-a', title: 'host copy' })] }), T0 + 1)
    const deleted = applyItemsCommit(seeded, commitOf({
      items: [row({ id: 'i-a', title: 'a copy this device lost', updatedAt: T0 })],
      deleted: [{ id: 'i-a', baseUpdatedAt: T0 }],
    }), T0 + 10)
    expect(deleted.items).toEqual([])
    expect(deletedItemsOf(deleted)[0]!.title).toBe('host copy')
  })

  it('suppresses a stale replica exactly as before, payload or not', () => {
    // The suppression law is unchanged: the archive is an addition to what a
    // tombstone carries, never a change to what it outranks.
    const { deleted } = removed()
    const stale = applyItemsCommit(deleted, commitOf({ items: [row({ id: 'i-a' })] }), T0 + 11)
    expect(stale.items).toEqual([])
    expect(stale).toBe(deleted)
  })

  it('an OLD tombstone with no row still suppresses, and reports nothing to restore', () => {
    // Documents written before this rule have no payload, and they are not
    // broken: the delete still holds, and the archive is simply empty. What it
    // may NOT do is invent a row to give back.
    const old: ItemsDoc = {
      ...emptyItemsDoc(T0),
      tombstones: { 'i-old': { at: 999, seenAt: T0 } },
    }
    const after = applyItemsCommit(old, commitOf({ items: [row({ id: 'i-old', ref: 2, updatedAt: 998 })] }), T0 + 1)
    expect(after.items).toEqual([])
    expect(deletedItemsOf(old)).toEqual([])
    expect(restoredItemOf(old, 'i-old', T0 + 5)).toBeUndefined()
  })

  it('prunes the text with the tombstone, so the window has an end', () => {
    const { deleted } = removed({}, T0 + 10)
    const later = applyItemsCommit(deleted, commitOf(), T0 + 10 + TOMBSTONE_TTL_MS + 1)
    expect(later.tombstones['i-a']).toBeUndefined()
    expect(deletedItemsOf(later)).toEqual([])
    expect(restoredItemOf(later, 'i-a', later.items.length)).toBeUndefined()
  })

  it('survives a restart, or the promise breaks at the one moment nobody watches', () => {
    // The host reloads the file on boot. If normalization dropped the payload,
    // every deletion would silently become final on the next launch — and the
    // loss would only show up as an empty archive, with no error anywhere.
    const { deleted } = removed()
    const reloaded = normalizeItemsDoc(JSON.parse(JSON.stringify(deleted)))
    expect(deletedItemsOf(reloaded).map(item => item.title)).toEqual(['a thought worth keeping'])
    // And a payload the document could never have produced is refused, exactly
    // as a malformed row arriving from a replica is.
    const forged = normalizeItemsDoc({
      tombstones: { 'i-x': { at: 1, seenAt: T0, row: { ...row({ id: 'i-x' }), steps: 'not a list' } } },
    })
    expect(deletedItemsOf(forged)).toEqual([])
  })
})

describe('restoring is an ordinary put', () => {
  /** A document holding one deleted row, plus one live row beside it. */
  const withDelete = () => {
    const seeded = applyItemsCommit(emptyItemsDoc(T0), commitOf({
      items: [row({ id: 'i-a', ref: 5, title: 'gone' }), row({ id: 'i-b', ref: 6, title: 'stayed' })],
    }), T0 + 1)
    return applyItemsCommit(seeded, commitOf({ deleted: [{ id: 'i-a', baseUpdatedAt: T0 }] }), T0 + 10)
  }

  it('re-stamps the payload above the tombstone, because the tombstone outranks it', () => {
    // THE step that makes restore work. A tombstone is stamped one millisecond
    // above the row it removed, so handing the payload back un-stamped is
    // indistinguishable from the stale copy the tombstone exists to suppress —
    // the row would come back, be eaten, and the restore would look like a no-op.
    const doc = withDelete()
    const restored = restoredItemOf(doc, 'i-a', T0 + 20)!
    expect(restored.updatedAt).toBeGreaterThan(doc.tombstones['i-a']!.at)
    expect(restored.title).toBe('gone')
    // …and the stamp is never moved backwards, even if the caller's clock is.
    expect(restoredItemOf(doc, 'i-a', 0)!.updatedAt).toBeGreaterThan(doc.tombstones['i-a']!.at)
  })

  it('a restore goes in as a claimed put and the row is back, number and all', () => {
    const doc = withDelete()
    const rowBack = restoredItemOf(doc, 'i-a', T0 + 20)!
    const after = applyItemsCommit(doc, commitOf({ items: [rowBack], changed: ['i-a'] }), T0 + 20)
    expect(after.items.map(item => item.id).sort()).toEqual(['i-a', 'i-b'])
    expect(after.items.find(item => item.id === 'i-a')!.ref).toBe(5)
    expect(after.tombstones['i-a']).toBeUndefined()
    // It is back in the document, so it is no longer in the archive — one fact,
    // two views, which is why the archive is a read over tombstones and not a
    // second list that could fall out of step.
    expect(deletedItemsOf(after)).toEqual([])
  })

  it('re-numbers a restored row whose number the document has since handed out', () => {
    // The chokepoint still owns the numbers, restore included. This document
    // reached a state where two rows once shared #5 and the second was
    // corrected upward; the deleted one keeps #5 in its payload, and putting it
    // back must not put two #5s on the list.
    const raced = applyItemsCommit(
      applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [row({ id: 'i-a', ref: 13, title: 'first' })] }), T0 + 1),
      commitOf({ items: [row({ id: 'i-b', ref: 13, title: 'second' })] }),
      T0 + 2,
    )
    const deleted = applyItemsCommit(raced, commitOf({ deleted: [{ id: 'i-a', baseUpdatedAt: T0 + 1 }] }), T0 + 3)
    const after = applyItemsCommit(deleted, commitOf({
      items: [restoredItemOf(deleted, 'i-a', T0 + 4)!],
      changed: ['i-a'],
    }), T0 + 4)
    expect(numbersAreUnique(after)).toBe(true)
    expect(after.items.find(item => item.id === 'i-a')!.title).toBe('first')
  })

  it('reports the archive newest delete first, and ties on the id', () => {
    const one = applyItemsCommit(emptyItemsDoc(T0), commitOf({
      items: [row({ id: 'i-b' }), row({ id: 'i-a' })],
    }), T0 + 1)
    const two = applyItemsCommit(one, commitOf({ deleted: [{ id: 'i-a', baseUpdatedAt: T0 }] }), T0 + 2)
    const three = applyItemsCommit(two, commitOf({ deleted: [{ id: 'i-b', baseUpdatedAt: T0 }] }), T0 + 5)
    expect(deletedItemsOf(three).map(item => item.id)).toEqual(['i-b', 'i-a'])
  })
})

describe('this document owns its own no-op predicate', () => {
  it('hands back the SAME document when nothing moved', () => {
    const seeded = applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [row({ id: 'i-a' })] }), T0 + 1)
    expect(applyItemsCommit(seeded, commitOf({ items: [seeded.items[0]!] }), T0 + 2)).toBe(seeded)
  })

  it('keeps its tombstone space to itself: the same id in two documents is two tombstones', () => {
    // Key-space separation with teeth: the board's tombstone for an id must not
    // suppress a checklist row of the same name, and the checklist's must not
    // suppress a card. One shared map would make a deleted CARD look like a
    // deleted ITEM, and the row would vanish for no reason anyone can see.
    const board = applyCommit(emptyBoardDoc(T0), {
      clientId: 'c', tasks: [createTask({ title: 'A', description: '', prompt: 'p' }, T0 + 1, SHARED)],
      deleted: [],
      cruise: { value: { enabled: false, limit: 5, schedule: [] }, at: 0 },
      schedulePresets: { value: [], at: 0 },
      runPresets: { value: { presets: [] }, at: 0 },
    } satisfies BoardCommit, T0 + 1)
    const boardDeleted = applyCommit(board, {
      clientId: 'c', tasks: [], deleted: [{ id: SHARED, baseUpdatedAt: T0 + 1 }],
      cruise: { value: { enabled: false, limit: 5, schedule: [] }, at: 0 },
      schedulePresets: { value: [], at: 0 },
      runPresets: { value: { presets: [] }, at: 0 },
    } satisfies BoardCommit, T0 + 2)

    const items = applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [row({ id: SHARED, ref: 1 })] }), T0 + 1)
    const itemsDeleted = applyItemsCommit(items, commitOf({ deleted: [{ id: SHARED, baseUpdatedAt: T0 }] }), T0 + 2)

    expect(boardDeleted.tombstones[SHARED]).toBeDefined()
    expect(itemsDeleted.tombstones[SHARED]).toBeDefined()
    expect(itemsDeleted.tombstones).not.toBe(boardDeleted.tombstones)
    // The board's tombstone says nothing about the checklist: the same row, sent
    // again, is still only suppressed by the checklist's OWN tombstone.
    const revived = applyItemsCommit(items, commitOf({ items: [row({ id: SHARED, ref: 1, updatedAt: T0 + 9 })] }), T0 + 3)
    expect(revived.items).toHaveLength(1)
  })

  it('counts a minted number as a change, and ignores nothing else the board ignores', () => {
    const before = emptyItemsDoc(T0)
    const after = applyItemsCommit(before, commitOf({ items: [row({ id: 'i-a' })] }), T0 + 1)
    expect(sameItemsDocs(before, after)).toBe(false)
    expect(after.revision).toBe(1)
  })

  it('does NOT count the text a tombstone keeps as a change', () => {
    // The load-bearing exclusion, and it is about convergence rather than
    // tidiness. A payload is something the host may hold and a replica may not,
    // so a predicate that compared it would have two devices that agree on every
    // fact each seeing a change in the other — and they would trade the same
    // commit back and forth for as long as both stayed online, never settling.
    const withRow = { 'i-a': { at: 1001, seenAt: T0, row: { id: 'i-a', updatedAt: 1000, title: 'kept' } } }
    const withoutRow = { 'i-a': { at: 1001, seenAt: T0 } }
    const a: ItemsDoc = { ...emptyItemsDoc(T0), tombstones: withRow }
    const b: ItemsDoc = { ...emptyItemsDoc(T0), tombstones: withoutRow }
    expect(sameItemsDocs(a, b)).toBe(true)
    // The stamp is still truth: a different delete time IS a different fact.
    const later: ItemsDoc = { ...emptyItemsDoc(T0), tombstones: { 'i-a': { at: 1002, seenAt: T0 } } }
    expect(sameItemsDocs(b, later)).toBe(false)
  })
})

describe('the host never trusts a replica\'s shape', () => {
  it('drops a row that is not a row, and never reaches the document', () => {
    const doc = applyItemsCommit(emptyItemsDoc(T0), commitOf({
      items: [
        row({ id: '' }),
        { ...row({ id: 'ok' }), steps: 'not a list' } as never,
        row({ id: 'good' }),
      ],
    }), T0 + 1)
    expect(doc.items.map(item => item.id)).toEqual(['good'])
  })

  it('numbers every row that survives, so a dropped row leaves no hole in the numbering', () => {
    const doc = applyItemsCommit(emptyItemsDoc(T0), commitOf({ items: [row({ id: '' }), row({ id: 'good' })] }), T0 + 1)
    expect(refsOf(doc)).toEqual([1])
    expect(doc.nextRef).toBe(2)
  })
})

describe('normalizeItemsDoc', () => {
  it('degrades junk to the empty shape instead of throwing', () => {
    expect(normalizeItemsDoc(null).items).toEqual([])
    expect(normalizeItemsDoc('nope').revision).toBe(0)
    const junk = normalizeItemsDoc({ revision: -3, items: 'junk', tombstones: { x: 'y' } })
    expect(junk.revision).toBe(0)
    expect(junk.items).toEqual([])
    expect(junk.tombstones).toEqual({})
  })

  it('assigns numbers to rows that arrive without one, and keeps the ones that have it', () => {
    const doc = normalizeItemsDoc({ items: [
      { ...row({ id: 'kept', ref: 4 }), steps: [] },
      { ...row({ id: 'minted' }), ref: undefined },
    ] })
    expect(doc.items.map(item => [item.id, item.ref]).sort()).toEqual([['kept', 4], ['minted', 5]])
    expect(doc.nextRef).toBe(6)
  })

  it('repairs a loaded file that already holds two rows under one number', () => {
    const doc = normalizeItemsDoc({ items: [row({ id: 'i-a', ref: 3 }), row({ id: 'i-b', ref: 3 })] })
    expect(numbersAreUnique(doc)).toBe(true)
    expect(refsOf(doc).sort((a, b) => a - b)).toEqual([3, 4])
  })

  it('keeps sane stamps, drops corrupt ones, and never rewinds the counter', () => {
    const doc = normalizeItemsDoc({ items: [row({ ref: 9 })], stamps: { 'i-1': T0, 'i-2': 'x', 'i-3': -1 }, nextRef: 2 })
    expect(doc.stamps).toEqual({ 'i-1': T0 })
    expect(doc.nextRef).toBe(10)
  })
})
