/**
 * Task-store tests: localStorage backend round-trips, corrupt-document
 * handling, invalid-row dropping, and the in-memory backend.
 */
import { describe, expect, it } from 'vitest'
import {
  InMemoryTaskStore, LocalStorageTaskStore, isTaskRecord, parseLedger,
} from '../src/core/store.ts'
import { createTask, withSchedule } from '../src/core/tasks.ts'

/** A tiny in-memory Storage stand-in (localStorage shape). */
class FakeStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  entries(): [string, string][] {
    return [...this.map.entries()]
  }
}

function sampleLedger() {
  return [
    createTask({ title: 'A', description: 'd', prompt: 'p' }, 1, 't-1'),
    createTask({ title: 'B', description: '', prompt: '' }, 2, 't-2'),
  ]
}

describe('LocalStorageTaskStore', () => {
  it('round-trips a ledger through storage', () => {
    const storage = new FakeStorage()
    const store = new LocalStorageTaskStore('k', storage)
    expect(store.load()).toEqual([])
    store.save(sampleLedger())
    expect(store.load()).toEqual(sampleLedger())
  })

  it('persists under the configured key with a JSON document', () => {
    const storage = new FakeStorage()
    const store = new LocalStorageTaskStore('dsh.taskBoard.v1', storage)
    store.save(sampleLedger())
    expect(storage.getItem('dsh.taskBoard.v1')).toBe(JSON.stringify(sampleLedger()))
  })

  it('clears the document on clear()', () => {
    const storage = new FakeStorage()
    const store = new LocalStorageTaskStore('k', storage)
    store.save(sampleLedger())
    store.clear()
    expect(store.load()).toEqual([])
  })

  it('tolerates storage absence (no storage, no throw)', () => {
    const store = new LocalStorageTaskStore('k', undefined)
    expect(store.load()).toEqual([])
    store.save(sampleLedger())
    expect(store.load()).toEqual([])
  })

  it('tolerates throwing storage reads/writes without breaking the board', () => {
    const broken: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
      getItem: () => { throw new Error('quota') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('quota') },
    }
    const store = new LocalStorageTaskStore('k', broken)
    expect(store.load()).toEqual([])
    expect(() => store.save(sampleLedger())).not.toThrow()
  })
})

describe('parseLedger', () => {
  it('returns an empty ledger for absent documents', () => {
    expect(parseLedger(null)).toEqual([])
  })

  it('returns an empty ledger for invalid JSON or non-array documents', () => {
    expect(parseLedger('not json')).toEqual([])
    expect(parseLedger('{"a":1}')).toEqual([])
  })

  it('drops invalid rows and keeps valid ones', () => {
    const valid = createTask({ title: 'ok', description: '', prompt: '' }, 1, 't-1')
    const ledger = [
      valid,
      { id: 't-2' },                       // missing fields
      { ...valid, id: 't-3', status: 'weird' }, // unknown status → normalized to todo
      null,
      'nope',
    ]
    const parsed = parseLedger(JSON.stringify(ledger))
    expect(parsed).toHaveLength(2)
    expect(parsed[0].id).toBe('t-1')
    expect(parsed[1].id).toBe('t-3')
    expect(parsed[1].status).toBe('todo')
  })

  it('migrates legacy failed tasks into review (the human gate)', () => {
    const valid = createTask({ title: 'ok', description: '', prompt: '' }, 1, 't-1')
    const parsed = parseLedger(JSON.stringify([{ ...valid, id: 't-9', status: 'failed' }]))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].status).toBe('review')
  })

  it('round-trips a task with a run-configuration permission through storage', () => {
    const task = createTask(
      { title: 'x', description: '', prompt: '', permission: 'danger-full-access', agentPreset: 'butler' },
      1,
      't-1',
    )
    const parsed = parseLedger(JSON.stringify([task]))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].permission).toBe('danger-full-access')
    expect(parsed[0].agentPreset).toBe('butler')
    // Legacy rows without the field keep the field absent.
    const legacy = parseLedger(JSON.stringify([createTask({ title: 'y', description: '', prompt: '' }, 1, 't-2')]))
    expect(legacy[0].permission).toBeUndefined()
  })

  it('round-trips comment rounds with their queue state (comment + injectedAt + command)', () => {
    const task = createTask({ title: 'x', description: '', prompt: '' }, 1, 't-1')
    task.executions = [
      { id: 'run-1', sessionId: 's-1', startedAt: 1, endedAt: 10, result: 'succeeded', error: undefined },
      { id: 'c-1', sessionId: 's-1', startedAt: 20, endedAt: 30, result: 'succeeded', error: undefined, comment: '已注入', injectedAt: 21 },
      { id: 'c-2', sessionId: 's-1', startedAt: 40, endedAt: undefined, result: undefined, error: undefined, comment: '排队中' },
      { id: 'c-3', sessionId: 's-1', startedAt: 50, endedAt: 51, result: 'succeeded', error: 'preset read-only', comment: '/permission read-only', command: true },
    ]
    const parsed = parseLedger(JSON.stringify([task]))
    expect(parsed[0].executions).toEqual([
      { id: 'run-1', sessionId: 's-1', startedAt: 1, endedAt: 10, result: 'succeeded', error: undefined, viewedAt: 10 },
      { id: 'c-1', sessionId: 's-1', startedAt: 20, endedAt: 30, result: 'succeeded', error: undefined, comment: '已注入', injectedAt: 21, viewedAt: 30 },
      { id: 'c-2', sessionId: 's-1', startedAt: 40, endedAt: undefined, result: undefined, error: undefined, comment: '排队中', viewedAt: 40 },
      { id: 'c-3', sessionId: 's-1', startedAt: 50, endedAt: 51, result: 'succeeded', error: 'preset read-only', comment: '/permission read-only', command: true, viewedAt: 51 },
    ])
  })

  it('round-trips refinement rounds and the bound refine session', () => {
    const task = createTask({ title: 'x', description: '', prompt: '' }, 1, 't-1')
    task.refineSessionId = 's-refine'
    task.executions = [
      { id: 'run-1', sessionId: 's-1', startedAt: 1, endedAt: 10, result: 'succeeded', error: undefined },
      { id: 'r-1', sessionId: 's-refine', startedAt: 20, endedAt: 30, result: 'succeeded', error: undefined, refine: true },
      { id: 'r-2', sessionId: 's-refine', startedAt: 40, endedAt: undefined, result: undefined, error: undefined, refine: true },
    ]
    const parsed = parseLedger(JSON.stringify([task]))
    expect(parsed[0].refineSessionId).toBe('s-refine')
    expect(parsed[0].executions).toEqual(task.executions.map(round => ({
      ...round,
      viewedAt: round.endedAt ?? round.startedAt,
    })))
  })
})

describe('isTaskRecord', () => {
  it('validates shape strictly', () => {
    const task = createTask({ title: 'x', description: '', prompt: '' }, 1, 't-1')
    expect(isTaskRecord(task)).toBe(true)
    expect(isTaskRecord({ ...task, status: 'bogus' })).toBe(false)
    expect(isTaskRecord({ ...task, executions: [{ id: 3 }] })).toBe(false)
    expect(isTaskRecord(null)).toBe(false)
    expect(isTaskRecord('x')).toBe(false)
  })
})

describe('InMemoryTaskStore', () => {
  it('stores and clones records (no shared mutation)', () => {
    const store = new InMemoryTaskStore()
    store.save(sampleLedger())
    const loaded = store.load()
    expect(loaded).toEqual(sampleLedger())
    loaded[0].title = 'mutated'
    expect(store.load()[0].title).toBe('A')
    store.clear()
    expect(store.load()).toEqual([])
  })
})

describe('schedule persistence', () => {
  it('round-trips a task with a schedule rule through storage', () => {
    const storage = new FakeStorage()
    const store = new LocalStorageTaskStore('k', storage)
    const task = withSchedule(
      createTask({ title: 'A', description: '', prompt: '' }, 1, 't-1'),
      { enabled: true, cron: '0 9 * * *', nextRunAt: 100, lastTriggeredAt: 50 },
      2,
    )
    store.save([task])
    expect(store.load()[0].schedule).toEqual({
      enabled: true, mode: 'cron', cron: '0 9 * * *', nextRunAt: 100, lastTriggeredAt: 50,
      maxRuns: undefined, runCount: 0, primed: false,
    })
  })

  it('keeps legacy tasks without a schedule intact', () => {
    const raw = JSON.stringify([createTask({ title: 'A', description: '', prompt: '' }, 1, 't-1')])
    expect(parseLedger(raw)[0].schedule).toBeUndefined()
  })

  it('round-trips a primed chain rule and a column sort key', () => {
    const storage = new FakeStorage()
    const store = new LocalStorageTaskStore('k', storage)
    const task = withSchedule(
      createTask({ title: 'A', description: '', prompt: '' }, 1, 't-1'),
      { enabled: true, mode: 'chain', cron: '', primed: true, runCount: 2, maxRuns: 5 },
      2,
    )
    store.save([task])
    const loaded = store.load()[0]
    expect(loaded.schedule).toEqual({
      enabled: true, mode: 'chain', cron: '', nextRunAt: undefined, lastTriggeredAt: undefined,
      maxRuns: 5, runCount: 2, primed: true,
    })
    // A persisted order survives; a legacy row without one keeps its array
    // position so the previous relative order is preserved.
    expect(parseLedger(JSON.stringify([
      { ...createTask({ title: 'B', description: '', prompt: '' }, 1, 't-2'), order: 7 },
      { ...createTask({ title: 'C', description: '', prompt: '' }, 2, 't-3'), order: undefined },
      { ...createTask({ title: 'D', description: '', prompt: '' }, 3, 't-4'), order: undefined },
    ])).map(row => [row.id, row.order])).toEqual([
      ['t-2', 7],
      ['t-3', 1],
      ['t-4', 2],
    ])
  })

  it('repairs a malformed schedule instead of dropping the task row', () => {
    const valid = createTask({ title: 'ok', description: '', prompt: '' }, 1, 't-1')
    const raw = [
      { ...valid, id: 't-1', schedule: { enabled: 'yes', cron: '0 9 * * *', nextRunAt: 'soon', lastTriggeredAt: 5 } },
      { ...valid, id: 't-2', schedule: { enabled: true, cron: '   ' } },
      { ...valid, id: 't-3', schedule: 'nope' },
      { ...valid, id: 't-4', schedule: { enabled: true, cron: 'not a cron' } },
    ]
    const parsed = parseLedger(JSON.stringify(raw))
    expect(parsed).toHaveLength(4) // no row dropped for a bad schedule
    expect(parsed[0].schedule).toEqual({
      enabled: false, mode: 'cron', cron: '0 9 * * *', nextRunAt: undefined, lastTriggeredAt: 5,
      maxRuns: undefined, runCount: 0, primed: false,
    })
    expect(parsed[1].schedule).toBeUndefined() // blank cron → schedule dropped
    expect(parsed[2].schedule).toBeUndefined() // non-object schedule → dropped
    expect(parsed[3].schedule).toBeUndefined() // malformed cron → schedule dropped
  })

  it('drops a schedule whose cron is malformed instead of accepting it', () => {
    const valid = createTask({ title: 'ok', description: '', prompt: '' }, 1, 't-1')
    const raw = [
      { ...valid, id: 't-1', schedule: { enabled: true, cron: '0 9 * * *' } },
      { ...valid, id: 't-2', schedule: { enabled: true, cron: '* * * *' } },
      { ...valid, id: 't-3', schedule: { enabled: true, cron: '99 99 99 99 99' } },
    ]
    const parsed = parseLedger(JSON.stringify(raw))
    expect(parsed[0].schedule).toEqual({
      enabled: true, mode: 'cron', cron: '0 9 * * *', nextRunAt: undefined, lastTriggeredAt: undefined,
      maxRuns: undefined, runCount: 0, primed: false,
    })
    expect(parsed[1].schedule).toBeUndefined() // not five fields
    expect(parsed[2].schedule).toBeUndefined() // values out of range
  })
})
