/**
 * Board-document tests: the host merge grammar (per-record LWW, tombstones,
 * delete-vs-edit resolution, section LWW, no-op detection), document
 * normalization from the medium, and the client-side deletion diff.
 */
import { describe, expect, it } from 'vitest'
import {
  applyCommit,
  boardViewOf,
  diffDeletions,
  emptyBoardDoc,
  normalizeBoardDoc,
  normalizeCruiseValue,
  sameBoardDocs,
  TOMBSTONE_TTL_MS,
  type BoardCommit,
} from '../src/core/board-doc.ts'
import { createTask, withStatus } from '../src/core/tasks.ts'

/** A commit carrying only what changed: sections default to the baseline's. */
function commitOf(overrides: Partial<BoardCommit> & { clientId?: string } = {}): BoardCommit {
  return {
    clientId: 'c-1',
    tasks: [],
    deleted: [],
    cruise: { value: { enabled: false, limit: 5, schedule: [] }, at: 0 },
    schedulePresets: { value: [], at: 0 },
    runPresets: { value: { presets: [] }, at: 0 },
    ...overrides,
  }
}

const T0 = 1_700_000_000_000

describe('emptyBoardDoc / normalizeBoardDoc', () => {
  it('starts empty at revision 0', () => {
    const doc = emptyBoardDoc(T0)
    expect(doc.revision).toBe(0)
    expect(doc.tasks).toEqual([])
    expect(doc.tombstones).toEqual({})
    expect(doc.bornAt).toBe(T0)
  })

  it('survives a JSON round-trip through the medium', () => {
    const doc = emptyBoardDoc(T0)
    const withTasks = applyCommit(doc, commitOf({ tasks: [createTask({ title: 'A', description: '', prompt: 'p' }, T0, 't-1')] }), T0 + 1)
    const restored = normalizeBoardDoc(JSON.parse(JSON.stringify(withTasks)))
    expect(restored.tasks).toEqual(withTasks.tasks)
    expect(restored.revision).toBe(withTasks.revision)
  })

  it('degrades corrupt input to the empty shape instead of throwing', () => {
    expect(normalizeBoardDoc(null).tasks).toEqual([])
    expect(normalizeBoardDoc('nope').revision).toBe(0)
    const junk = normalizeBoardDoc({ revision: -3, tasks: 'junk', tombstones: { x: 'y' }, cruise: 5 })
    expect(junk.revision).toBe(0)
    expect(junk.tasks).toEqual([])
    expect(junk.tombstones).toEqual({})
    expect(junk.cruise.value.enabled).toBe(false)
  })

  it('drops invalid task rows and repairs legacy shapes via the ledger grammar', () => {
    const doc = normalizeBoardDoc({
      revision: 2,
      bornAt: T0,
      tasks: [
        { id: 'ok', title: 'T', description: '', prompt: '', status: 'failed', createdAt: 1, updatedAt: 2, executions: [] },
        { id: '', title: 'bad id', description: '', prompt: '', status: 'todo', createdAt: 1, updatedAt: 2, executions: [] },
      ],
    })
    expect(doc.tasks).toHaveLength(1)
    // The legacy 'failed' status normalizes into the review gate (parseLedger grammar).
    expect(doc.tasks[0].status).toBe('review')
  })
})

describe('normalizeCruiseValue', () => {
  it('clamps junk and sorts windows', () => {
    const value = normalizeCruiseValue({
      enabled: 'yes',
      manual: 'x',
      limit: 0,
      schedule: [{ endAt: 500 }, { startAt: 100, endAt: 200 }, 'junk'],
    })
    expect(value.enabled).toBe(false)
    expect(value.manual).toBeUndefined()
    expect(value.limit).toBe(5)
    expect(value.schedule).toEqual([{ endAt: 500 }, { startAt: 100, endAt: 200 }])
  })
})

describe('diffDeletions', () => {
  it('reports only ids the next view dropped, with the baseline stamp', () => {
    const a = createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')
    const b = createTask({ title: 'B', description: '', prompt: '' }, T0, 't-b')
    const editedB = withStatus(b, 'done', T0 + 50)
    expect(diffDeletions([a, b], [editedB])).toEqual([{ id: 't-a', baseUpdatedAt: b.updatedAt }])
    expect(diffDeletions([a, b], [a, b])).toEqual([])
  })
})

describe('applyCommit: puts', () => {
  const doc = emptyBoardDoc(T0)

  it('inserts new records and bumps the revision once per real change', () => {
    const task = createTask({ title: 'A', description: '', prompt: 'p' }, T0, 't-1')
    const next = applyCommit(doc, commitOf({ tasks: [task] }), T0 + 1)
    expect(next.tasks.map(t => t.id)).toEqual(['t-1'])
    expect(next.revision).toBe(doc.revision + 1)
  })

  it('takes the incoming copy only when strictly newer (LWW, host wins ties)', () => {
    const v1 = createTask({ title: 'A', description: '', prompt: 'p' }, T0, 't-1')
    const withV1 = applyCommit(doc, commitOf({ tasks: [v1] }), T0 + 1)
    const stale = { ...v1, title: 'stale', updatedAt: v1.updatedAt }
    expect(applyCommit(withV1, commitOf({ tasks: [stale] }), T0 + 2)).toBe(withV1)
    const fresh = { ...v1, title: 'fresh', updatedAt: v1.updatedAt + 1 }
    const merged = applyCommit(withV1, commitOf({ tasks: [fresh] }), T0 + 3)
    expect(merged.tasks[0].title).toBe('fresh')
  })

  it('keeps host rows a stale replica does not know about', () => {
    const a = createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')
    const b = createTask({ title: 'B', description: '', prompt: '' }, T0, 't-b')
    const withBoth = applyCommit(applyCommit(doc, commitOf({ tasks: [a] }), T0 + 1), commitOf({ tasks: [b] }), T0 + 2)
    // A replica that only knows A commits its array: B must survive.
    const after = applyCommit(withBoth, commitOf({ tasks: [a] }), T0 + 3)
    expect(after).toBe(withBoth) // nothing moved → same doc, no revision churn
  })

  it('normalizes junk rows through the ledger grammar instead of trusting the replica', () => {
    const next = applyCommit(doc, commitOf({
      tasks: [
        createTask({ title: 'A', description: '', prompt: '' }, T0, 'good'),
        { id: '', title: 'bad', description: '', prompt: '', createdAt: 1, updatedAt: 1, executions: [] },
      ] as never,
    }), T0 + 1)
    expect(next.tasks.map(t => t.id)).toEqual(['good'])
  })

  it('a no-op commit returns the identical document (no revision bump, no broadcast)', () => {
    const task = createTask({ title: 'A', description: '', prompt: '' }, T0, 't-1')
    const withTask = applyCommit(doc, commitOf({ tasks: [task] }), T0 + 1)
    const again = applyCommit(withTask, commitOf({ tasks: [task] }), T0 + 2)
    expect(again).toBe(withTask)
    expect(sameBoardDocs(withTask, again)).toBe(true)
  })
})

describe('applyCommit: deletes and tombstones', () => {
  const doc = emptyBoardDoc(T0)
  const seeded = () => applyCommit(doc, commitOf({ tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')] }), T0 + 1)

  it('honors a delete against an unmodified host copy and tombstones it', () => {
    const base = seeded()
    const task = base.tasks[0]
    const after = applyCommit(base, commitOf({ deleted: [{ id: 't-a', baseUpdatedAt: task.updatedAt }] }), T0 + 10)
    expect(after.tasks).toEqual([])
    expect(after.tombstones['t-a']).toEqual({ at: task.updatedAt + 1, seenAt: T0 + 10 })
  })

  it('loses a delete against a copy edited after the baseline', () => {
    const base = seeded()
    const edited = applyCommit(base, commitOf({ tasks: [{ ...base.tasks[0], title: 'edited', updatedAt: base.tasks[0].updatedAt + 5 }] }), T0 + 2)
    const after = applyCommit(edited, commitOf({ deleted: [{ id: 't-a', baseUpdatedAt: base.tasks[0].updatedAt }] }), T0 + 3)
    expect(after).toBe(edited)
  })

  it('a tombstone suppresses a stale replica resurrecting the delete', () => {
    const base = seeded()
    const task = base.tasks[0]
    const deleted = applyCommit(base, commitOf({ deleted: [{ id: 't-a', baseUpdatedAt: task.updatedAt }] }), T0 + 10)
    // Another replica still holding the old copy commits it unchanged: the tombstone wins.
    const after = applyCommit(deleted, commitOf({ clientId: 'c-2', tasks: [task] }), T0 + 11)
    expect(after).toBe(deleted)
  })

  it('a genuinely newer edit revives the record and clears the tombstone', () => {
    const base = seeded()
    const task = base.tasks[0]
    const deleted = applyCommit(base, commitOf({ deleted: [{ id: 't-a', baseUpdatedAt: task.updatedAt }] }), T0 + 10)
    const revived = applyCommit(deleted, commitOf({ tasks: [{ ...task, title: 'revived', updatedAt: deleted.tombstones['t-a'].at + 1 }] }), T0 + 11)
    expect(revived.tasks).toHaveLength(1)
    expect(revived.tasks[0].title).toBe('revived')
    expect(revived.tombstones['t-a']).toBeUndefined()
  })

  it('deleting an unknown id is a no-op without a tombstone', () => {
    const after = applyCommit(doc, commitOf({ deleted: [{ id: 'ghost', baseUpdatedAt: T0 }] }), T0 + 1)
    expect(after).toBe(doc)
  })

  it('prunes tombstones past their TTL', () => {
    const base = seeded()
    const task = base.tasks[0]
    const deleted = applyCommit(base, commitOf({ deleted: [{ id: 't-a', baseUpdatedAt: task.updatedAt }] }), T0 + 10)
    expect(deleted.tombstones['t-a']).toBeDefined()
    // Re-applying an empty commit far in the future prunes the stale tombstone.
    const later = applyCommit(deleted, commitOf({ tasks: deleted.tasks, cruise: deleted.cruise, schedulePresets: deleted.schedulePresets, runPresets: deleted.runPresets }), T0 + 10 + TOMBSTONE_TTL_MS + 1)
    expect(later.tombstones['t-a']).toBeUndefined()
  })
})

describe('applyCommit: sections', () => {
  const doc = emptyBoardDoc(T0)

  it('cruise replaces on a newer stamp and holds on an older one', () => {
    const on = applyCommit(doc, commitOf({ cruise: { value: { enabled: true, limit: 3, schedule: [] }, at: T0 + 5 } }), T0 + 5)
    expect(on.cruise.value.enabled).toBe(true)
    expect(on.cruise.value.limit).toBe(3)
    const older = applyCommit(on, commitOf({ cruise: { value: { enabled: false, limit: 9, schedule: [] }, at: T0 + 1 } }), T0 + 6)
    expect(older).toBe(on)
  })

  it('equal stamps resolve by arrival order (the later commit wins, deterministically)', () => {
    const a = applyCommit(doc, commitOf({ cruise: { value: { enabled: true, limit: 2, schedule: [] }, at: T0 + 5 } }), T0 + 5)
    const b = applyCommit(a, commitOf({ cruise: { value: { enabled: false, limit: 7, schedule: [] }, at: T0 + 5 } }), T0 + 6)
    expect(b.cruise.value.limit).toBe(7)
  })

  it('presets and run presets merge through their own normalization grammars', () => {
    const withPresets = applyCommit(doc, commitOf({
      schedulePresets: { value: [{ id: 'p1', label: 'L', cron: '0 9 * * *' }, { id: '', label: 'bad', cron: 'x' }], at: T0 + 2 },
      runPresets: { value: { presets: [{ id: 'r1', name: 'R', config: { model: 'm', bogus: 'x' } as never }], defaultId: 'r1' }, at: T0 + 2 },
    }), T0 + 2)
    expect(withPresets.schedulePresets.value).toEqual([{ id: 'p1', label: 'L', cron: '0 9 * * *' }])
    expect(withPresets.runPresets.value.presets[0].config).toEqual({ model: 'm' })
    expect(boardViewOf(withPresets).runPresets.defaultId).toBe('r1')
  })
})

describe('applyCommit: ordering', () => {
  it('keeps host order and appends records the host lacked', () => {
    const doc = emptyBoardDoc(T0)
    const a = applyCommit(doc, commitOf({ tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')] }), T0 + 1)
    const b = applyCommit(a, commitOf({ tasks: [createTask({ title: 'B', description: '', prompt: '' }, T0, 't-b')] }), T0 + 2)
    const c = applyCommit(b, commitOf({ tasks: [createTask({ title: 'C', description: '', prompt: '' }, T0, 't-c')] }), T0 + 3)
    expect(c.tasks.map(t => t.id)).toEqual(['t-a', 't-b', 't-c'])
  })
})

describe('convergence', () => {
  it('two replicas editing different tasks both win; editing the same task resolves by LWW', () => {
    const doc = emptyBoardDoc(T0)
    const a = createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')
    const b = createTask({ title: 'B', description: '', prompt: '' }, T0, 't-b')
    let truth = applyCommit(doc, commitOf({ tasks: [a, b] }), T0 + 1)

    // Replica 1 renames A at T0+10; replica 2 renames B at T0+11 (neither has seen the other).
    const r1 = commitOf({ clientId: 'r1', tasks: [{ ...a, title: 'A1', updatedAt: T0 + 10 }, b] })
    const r2 = commitOf({ clientId: 'r2', tasks: [a, { ...b, title: 'B2', updatedAt: T0 + 11 }] })
    truth = applyCommit(truth, r1, T0 + 12)
    truth = applyCommit(truth, r2, T0 + 13)
    expect(truth.tasks.map(t => t.title).sort()).toEqual(['A1', 'B2'])

    // Same-task conflict: the newer updatedAt wins regardless of commit order.
    const older = commitOf({ clientId: 'r1', tasks: [{ ...truth.tasks[0], updatedAt: T0 + 5 }] })
    const newer = commitOf({ clientId: 'r2', tasks: [{ ...truth.tasks[0], title: 'wins', updatedAt: T0 + 20 }] })
    const after = applyCommit(applyCommit(truth, newer, T0 + 21), older, T0 + 22)
    expect(after.tasks[0].title).toBe('wins')
  })
})
