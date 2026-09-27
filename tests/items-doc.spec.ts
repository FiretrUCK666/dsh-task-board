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
  emptyItemsDoc,
  ITEM_ROW_OPS,
  normalizeItemsDoc,
  sameItemsDocs,
  sortItems,
  type ItemsCommit,
  type ItemsDoc,
} from '../src/core/items-doc.ts'
import { applyCommit, emptyBoardDoc, type BoardCommit } from '../src/core/board-doc.ts'
import { createTask } from '../src/core/tasks.ts'
import type { ItemRecord } from '../src/core/item.ts'

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
