/**
 * Merge-kernel tests (src/core/board-merge-core.ts).
 *
 * The kernel is the document-agnostic core of the host merge grammar: it owns
 * the laws, and a document owns only the four answers about its own rows. These
 * tests therefore drive it with a row shape the board's task ledger has never
 * heard of — no rounds, a read-state field named `seenAt` instead of the
 * board's, an inbound repair the board does not have, an ordering rule the
 * board does not use — and that is the point, twice over:
 *
 *  - A kernel that reached into a task-shaped row would not compile here (these
 *    rows carry no such field), and a kernel that reached for one by cast is
 *    refused outright by the source scan at the end of this file.
 *  - The board's own wiring is pinned by tests/board-doc.spec.ts, which says
 *    nothing about the kernel. The two suites are disjoint on purpose, so no
 *    law can ever be "covered" by only the board's version of it — and a second
 *    document reusing this kernel gets the same laws without a second opinion.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  applyRowCommit,
  maxSeen,
  mergeSection,
  sameMergeState,
  TOMBSTONE_TTL_MS,
  type MergeDelete,
  type MergeRowOps,
  type MergeSection,
  type MergeState,
} from '../src/core/board-merge-core.ts'

const T0 = 1_700_000_000_000

/** One checklist entry, with its own read stamp. */
interface NoteStep {
  id: string
  text: string
  seenAt?: number
}

/** A row in a shape the board's ledger has no field for. */
interface NoteRow {
  id: string
  title: string
  body: string
  done: boolean
  updatedAt: number
  seenAt?: number
  steps: NoteStep[]
}

/**
 * This document's four answers. Its inbound grammar keeps whole-second
 * freshness stamps (a fractional one is floored) and drops an id-less row; its
 * read state is `seenAt` on the row and on each step, paired by step id; its
 * ordering puts rows the host lacked in freshness order rather than arrival
 * order — none of which the board's ledger does, on purpose.
 */
const NOTE_OPS: MergeRowOps<NoteRow> = {
  normalize: row => (row.id === '' ? undefined : { ...row, updatedAt: Math.floor(row.updatedAt) }),
  authorshipKey: row => JSON.stringify({
    ...row,
    seenAt: undefined,
    steps: row.steps.map(({ seenAt: _stepSeen, ...step }) => step),
  }),
  mergeReadState: (winner, incoming) => {
    const seenAt = maxSeen(winner.seenAt, incoming.seenAt)
    const steps = winner.steps.map(step => {
      const other = incoming.steps.find(candidate => candidate.id === step.id)
      const stepSeen = maxSeen(step.seenAt, other?.seenAt)
      return stepSeen === step.seenAt ? step : { ...step, seenAt: stepSeen }
    })
    const moved = seenAt !== winner.seenAt || steps.some((step, index) => step !== winner.steps[index])
    return moved ? { ...winner, seenAt, steps } : winner
  },
  sortRows: (hostRows, incoming, resolved) => {
    const kept = hostRows.filter(row => resolved.has(row.id)).map(row => resolved.get(row.id)!)
    const held = new Set(hostRows.map(row => row.id))
    const fresh = incoming
      .filter(row => !held.has(row.id))
      // An id the inbound grammar refused is simply not in `resolved`.
      .map(row => resolved.get(row.id))
      .filter((row): row is NoteRow => row !== undefined)
      .sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))
    return [...kept, ...fresh]
  },
}

/** One row of this document's ledger. */
function note(id: string, updatedAt: number, patch: Partial<NoteRow> = {}): NoteRow {
  return { id, title: `note ${id}`, body: '', done: false, updatedAt, steps: [], ...patch }
}

/** The host's rows and bookkeeping before any commit. */
function host(rows: NoteRow[] = []): MergeState<NoteRow> {
  return { rows, tombstones: {}, stamps: {} }
}

/** One commit, applied. */
function commit(
  state: MergeState<NoteRow>,
  incoming: NoteRow[],
  now: number,
  claimed: string[] = [],
  deleted: MergeDelete[] = [],
): MergeState<NoteRow> {
  return applyRowCommit(state, incoming, new Set(claimed), deleted, NOTE_OPS, now)
}

describe('applyRowCommit: the laws, on a row the board has never had', () => {
  it('inserts rows the host lacks, in the order this document puts them', () => {
    // Arrival order is b, a; this document orders fresh rows by freshness.
    const next = commit(host(), [note('b', 2000), note('a', 1000)], T0 + 1)
    expect(next.rows.map(row => row.id)).toEqual(['a', 'b'])
    expect(next.stamps).toEqual({ a: T0 + 1, b: T0 + 1 })
  })

  it('never lets an unclaimed copy clobber a newer row, and the host wins ties', () => {
    const seeded = commit(host(), [note('a', 1000, { title: 'host' })], T0 + 1)
    const tie = commit(seeded, [note('a', 1000, { title: 'ancient' })], T0 + 2)
    expect(tie.rows[0]!.title).toBe('host')
    const fresh = commit(seeded, [note('a', 1001, { title: 'newer' })], T0 + 3)
    expect(fresh.rows[0]!.title).toBe('newer')
  })

  it('takes a CLAIMED row whatever the clocks say', () => {
    const seeded = commit(host(), [note('a', 5000, { title: 'host' })], T0 + 1)
    // A replica whose clock runs minutes behind: its gesture still lands.
    const claimed = commit(seeded, [note('a', 1, { title: 'phone' })], T0 + 2, ['a'])
    expect(claimed.rows[0]!.title).toBe('phone')
    expect(claimed.stamps['a']).toBe(T0 + 2)
  })

  it('a content-equal claim moves nothing — and re-stamps nothing', () => {
    const seeded = commit(host(), [note('a', 5000)], T0 + 7)
    const again = commit(seeded, [seeded.rows[0]!], T0 + 8, ['a'])
    expect(again.rows[0]).toBe(seeded.rows[0])
    expect(sameMergeState(seeded, again)).toBe(true)
    // The stamp is diagnostics, so a no-op must not touch it either.
    expect(again.stamps['a']).toBe(T0 + 7)
  })

  it('drops a row the inbound grammar refuses (the host never trusts a replica shape)', () => {
    const next = commit(host(), [note('', 1000), note('ok', 1000)], T0 + 1)
    expect(next.rows.map(row => row.id)).toEqual(['ok'])
  })

  it('joins read state forward, never backward, and never as an edit', () => {
    const seeded = commit(host(), [note('a', 1000, { title: 'host', seenAt: 4000 })], T0 + 1)
    // An older copy that merely OPENED the row: content loses, read state wins.
    const seen = commit(seeded, [note('a', 500, { title: 'ancient', seenAt: 9000 })], T0 + 2)
    expect(seen.rows[0]!.title).toBe('host')
    expect(seen.rows[0]!.seenAt).toBe(9000)
    // A read is not an edit: the acceptance stamp must not move.
    expect(seen.stamps['a']).toBe(T0 + 1)
    // An older stamp never rewinds, and an absent one never clears.
    expect(commit(seen, [note('a', 500, { seenAt: 10 })], T0 + 3).rows[0]!.seenAt).toBe(9000)
    expect(commit(seen, [note('a', 500)], T0 + 4).rows[0]!.seenAt).toBe(9000)
  })

  it('pairs step-level read state by step id, and adds no step the winner lacks', () => {
    const seeded = commit(host(), [note('a', 1000, {
      steps: [{ id: 's1', text: 'one', seenAt: 4000 }],
    })], T0 + 1)
    const joined = commit(seeded, [note('a', 500, {
      steps: [{ id: 's1', text: 'one', seenAt: 10 }, { id: 's2', text: 'two', seenAt: 9000 }],
    })], T0 + 2)
    expect(joined.rows[0]!.steps).toHaveLength(1)
    expect(joined.rows[0]!.steps[0]!.seenAt).toBe(4000)
  })

  it('never mutates the state it was handed', () => {
    const seeded = commit(host(), [note('a', 1000)], T0 + 1)
    commit(seeded, [], T0 + 2, [], [{ id: 'a', baseUpdatedAt: 1000 }])
    expect(seeded.rows).toHaveLength(1)
    expect(seeded.tombstones).toEqual({})
    expect(seeded.stamps).toEqual({ a: T0 + 1 })
  })
})

describe('applyRowCommit: deletes and tombstones', () => {
  /** One row, host-held, stamped at 1000. */
  const seeded = () => commit(host(), [note('a', 1000)], T0 + 1)

  it('honors a delete against an unmodified row and takes its stamp with it', () => {
    const next = commit(seeded(), [], T0 + 10, [], [{ id: 'a', baseUpdatedAt: 1000 }])
    expect(next.rows).toEqual([])
    expect(next.tombstones['a']).toEqual({ at: 1001, seenAt: T0 + 10 })
    expect(next.stamps['a']).toBeUndefined()
  })

  it('loses a delete against a row edited after the replica baseline', () => {
    const edited = commit(seeded(), [note('a', 1005, { title: 'edited' })], T0 + 2)
    const after = commit(edited, [], T0 + 3, [], [{ id: 'a', baseUpdatedAt: 1000 }])
    expect(after.rows).toHaveLength(1)
    expect(after.tombstones['a']).toBeUndefined()
  })

  it('suppresses a stale replica resurrecting the delete', () => {
    const deleted = commit(seeded(), [], T0 + 10, [], [{ id: 'a', baseUpdatedAt: 1000 }])
    const after = commit(deleted, [note('a', 1000)], T0 + 11)
    expect(after.rows).toEqual([])
    expect(after.tombstones['a']).toEqual({ at: 1001, seenAt: T0 + 10 })
  })

  it('lets a genuinely newer edit revive the row and clear the tombstone', () => {
    const deleted = commit(seeded(), [], T0 + 10, [], [{ id: 'a', baseUpdatedAt: 1000 }])
    const revived = commit(deleted, [note('a', 1002, { title: 'revived' })], T0 + 11)
    expect(revived.rows.map(row => row.title)).toEqual(['revived'])
    expect(revived.tombstones['a']).toBeUndefined()
  })

  it('deleting an id the host never had is a no-op and mints no tombstone', () => {
    const next = commit(host(), [], T0 + 1, [], [{ id: 'ghost', baseUpdatedAt: 1 }])
    expect(next).toEqual(host())
  })

  it('prunes tombstones past their TTL', () => {
    const deleted = commit(seeded(), [], T0 + 10, [], [{ id: 'a', baseUpdatedAt: 1000 }])
    const later = commit(deleted, [], T0 + 10 + TOMBSTONE_TTL_MS + 1)
    expect(later.tombstones['a']).toBeUndefined()
  })

  it('judges the two freshness streams separately — the stamp reads what was SENT, the suppression reads what was STORED', () => {
    // The whole point of this document's inbound grammar: it floors fractional
    // stamps, so the stored freshness and the sent freshness differ on purpose.
    const held = commit(host(), [note('a', 1024.25)], T0 + 1)
    expect(held.rows[0]!.updatedAt).toBe(1024)
    // The delete commit still carries the row it deleted, so the sent freshness
    // (1024.25) is the highest the host ever saw: the tombstone lands above IT
    // (1025.25). Judged by the stored stamp alone it would have been 1025.
    const deleted = commit(held, [note('a', 1024.25)], T0 + 2, [], [{ id: 'a', baseUpdatedAt: 1024 }])
    expect(deleted.tombstones['a']!.at).toBe(1025.25)
    // The put that tombstone suppresses is judged by the STORED stamp: 1025.5
    // sent normalizes to 1025, which the tombstone still outranks. Judged by the
    // sent stamp (1025.5) this row would have come back — the other leg of the
    // same law, and the one that would have resurrected a deleted row.
    const stale = commit(deleted, [note('a', 1025.5)], T0 + 3)
    expect(stale.rows).toEqual([])
    // The control: a stamp the tombstone does not outrank still revives it.
    const revived = commit(deleted, [note('a', 1026.5)], T0 + 4)
    expect(revived.rows.map(row => row.updatedAt)).toEqual([1026])
  })
})

describe('sameMergeState', () => {
  it('reads rows and tombstones, and never the stamps', () => {
    const rows = [note('a', 1000)]
    const tombstones = { a: { at: 5, seenAt: 6 } }
    expect(sameMergeState({ rows, tombstones }, { rows: [...rows], tombstones: { ...tombstones } })).toBe(true)
    expect(sameMergeState(
      { rows, tombstones },
      { rows, tombstones: { ...tombstones, a: { at: 6, seenAt: 6 } } },
    )).toBe(false)
    expect(sameMergeState({ rows, tombstones }, { rows: [note('a', 1001)], tombstones })).toBe(false)
  })
})

describe('mergeSection: the claim protocol, on a section the board has no name for', () => {
  const clean = (raw: unknown): string[] =>
    Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : []
  const stored: MergeSection<string[]> = { value: ['a'], at: 100 }

  it('takes a claimed section regardless of the client stamp and re-stamps it with the host clock', () => {
    const next = mergeSection(stored, { value: ['b', 7] as never, at: 1 }, clean, 'labels', T0 + 500, ['labels'])
    expect(next).toEqual({ value: ['b'], at: T0 + 500 })
  })

  it('skips an unclaimed section outright, however new its stamp reads', () => {
    const next = mergeSection(stored, { value: ['b'], at: 99_999 }, clean, 'labels', T0 + 500, [])
    expect(next).toBe(stored)
  })

  it('LEGACY (no claim list at all): LWW on the client stamp, ties by arrival', () => {
    expect(mergeSection(stored, { value: ['b'], at: 1 }, clean, 'labels', T0, undefined)).toBe(stored)
    expect(mergeSection(stored, { value: ['b'], at: 100 }, clean, 'labels', T0, undefined)).toEqual({ value: ['b'], at: 100 })
  })
})

describe('the kernel (source scan)', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/core/board-merge-core.ts', import.meta.url)), 'utf8')

  it('is dependency-free — a second document reuses it without dragging anything in', () => {
    expect(/^[ \t]*import\s/m.test(source), 'the kernel must not import anything, including the document it grew out of').toBe(false)
  })

  it('names no task-domain field, in code or in prose', () => {
    const banned = /\b(?:TaskRecord|ExecutionRecord|executions|viewedAt|parseLedger)\b/g
    const offenders = [...source.matchAll(banned)].map(match => {
      const line = source.slice(0, match.index).split('\n').length
      return `${line}: ${match[0]}`
    })
    expect(offenders, 'the kernel does not know a task ledger exists — a row is id + updatedAt and whatever the document injects').toEqual([])
  })

  it('asks a document for exactly the four row answers, and nothing more', () => {
    expect(Object.keys(NOTE_OPS).sort()).toEqual(['authorshipKey', 'mergeReadState', 'normalize', 'sortRows'])
  })
})
