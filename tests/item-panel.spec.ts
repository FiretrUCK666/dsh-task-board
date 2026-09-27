/**
 * The task-list panel's judgments: what a row says, how the list is grouped
 * and ordered, and what an edit does to the document.
 *
 * These are the questions the panel must answer identically every time, so
 * they live here as pure functions and are tested without a DOM. The panel
 * draws; it never decides.
 */
import { describe, expect, it } from 'vitest'
import type { ItemRecord } from '../src/core/item.ts'
import {
  editItem,
  groupOpenByDefault,
  itemGroupSlicesOf,
  itemRowViewOf,
  ITEM_GROUPS,
  removeItem,
  toggleItemStep,
  NO_ITEM_FILTER,
} from '../src/client/item/model.ts'

const T0 = 1_700_000_000_000

function item(patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'i-1',
    ref: 12,
    title: 'A thing',
    body: 'the body',
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

function step(id: string, text: string, done = false) {
  return { id, text, done, updatedAt: T0 }
}

describe('itemRowViewOf', () => {
  it('borrows the body for a title the reader never gave', () => {
    const view = itemRowViewOf(item({ title: '' }), false, T0)
    expect(view.title.length).toBeGreaterThan(0)
  })

  it('speaks the number the reader and the model both use', () => {
    expect(itemRowViewOf(item({ ref: 7 }), false, T0).ref).toBe('#7')
  })

  it('reports NO progress for an item with no steps, so nothing can be drawn', () => {
    // The panel's rule is: no steps means no bar at all. A 0% bar reads as a
    // failed load; absence reads as "there is nothing here yet".
    expect(itemRowViewOf(item(), false, T0).progress).toBeUndefined()
  })

  it('lets a deadline outrank a step count, and says how loudly it is', () => {
    const withBoth = item({ steps: [step('s1', 'a'), step('s2', 'b', true)], dueAt: T0 - 1000 })
    const view = itemRowViewOf(withBoth, false, T0)
    expect(view.meta).toEqual({ kind: 'due', at: T0 - 1000, overdue: true, hard: false })
  })

  it('distinguishes a hard deadline from a soft one', () => {
    const soft = itemRowViewOf(item({ dueAt: T0 + 1000 }), false, T0)
    const hard = itemRowViewOf(item({ hardDueAt: T0 + 1000 }), false, T0)
    expect(soft.meta).toMatchObject({ hard: false })
    expect(hard.meta).toMatchObject({ hard: true })
  })

  it('stays quiet when there is neither a date nor a step', () => {
    expect(itemRowViewOf(item(), false, T0).meta).toEqual({ kind: 'quiet' })
  })

  it('derives in-progress from the linked card, and lets a finished item stay finished', () => {
    const running = item({ taskId: 't-1', status: 'open' })
    expect(itemRowViewOf(running, true, T0).status).toBe('inProgress')
    // A done item is done even while its card reruns: the reader's record of
    // finishing is not withdrawn by the machine working on it.
    const done = item({ taskId: 't-1', status: 'done' })
    expect(itemRowViewOf(done, true, T0).status).toBe('done')
  })

  it('never becomes in-progress without a card to ask about', () => {
    expect(itemRowViewOf(item(), true, T0).status).toBe('open')
  })
})

describe('itemGroupSlicesOf', () => {
  const three = [
    item({ id: 'a', ref: 1, title: 'running one', status: 'open', taskId: 't-1' }),
    item({ id: 'b', ref: 2, title: 'waiting one', status: 'open' }),
    item({ id: 'c', ref: 3, title: 'stuck one', status: 'blocked' }),
    item({ id: 'd', ref: 4, title: 'finished one', status: 'done' }),
  ]
  const running = new Map([['t-1', true]])

  it('groups by derived status, in reading order, dropping empty groups', () => {
    const slices = itemGroupSlicesOf(three, NO_ITEM_FILTER, running)
    expect(slices.map(s => s.group)).toEqual(['inProgress', 'open', 'blocked', 'done'])
    expect(slices[0]?.items.map(i => i.id)).toEqual(['a'])
  })

  it('is order-independent, so two devices holding the same rows agree', () => {
    const forward = itemGroupSlicesOf(three, NO_ITEM_FILTER, running)
    const backward = itemGroupSlicesOf([...three].reverse(), NO_ITEM_FILTER, running)
    expect(backward.map(s => s.items.map(i => i.id))).toEqual(forward.map(s => s.items.map(i => i.id)))
  })

  it('orders inside a group by the nearest deadline, then by what moved last', () => {
    const rows = [
      item({ id: 'late', ref: 1, dueAt: T0 + 9000 }),
      item({ id: 'soon', ref: 2, dueAt: T0 + 1000 }),
      item({ id: 'none', ref: 3, updatedAt: T0 + 500 }),
    ]
    const slice = itemGroupSlicesOf(rows, NO_ITEM_FILTER, new Map())[0]
    expect(slice?.items.map(i => i.id)).toEqual(['soon', 'late', 'none'])
  })

  it('searches title, body, notes and tags, and matches case-insensitively', () => {
    const rows = [
      item({ id: 'a', ref: 1, title: 'Fix login' }),
      item({ id: 'b', ref: 2, body: 'mentions LOGIN in the body' }),
      item({ id: 'c', ref: 3, notes: 'a note about login' }),
      item({ id: 'd', ref: 4, tags: ['login'] }),
      item({ id: 'e', ref: 5, title: 'unrelated' }),
    ]
    const slice = itemGroupSlicesOf(rows, { text: 'LoGiN', groups: [] }, new Map())[0]
    expect(slice?.items.map(i => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('filters by group and keeps the reading order of what survives', () => {
    const slices = itemGroupSlicesOf(three, { text: '', groups: ['blocked', 'done'] }, running)
    expect(slices.map(s => s.group)).toEqual(['blocked', 'done'])
  })

  it('returns nothing rather than everything when the filter matches nothing', () => {
    expect(itemGroupSlicesOf(three, { text: 'zzz', groups: [] }, running)).toEqual([])
  })
})

describe('groupOpenByDefault', () => {
  it('opens the live groups and keeps finished work folded until asked for', () => {
    expect(groupOpenByDefault('inProgress', false)).toBe(true)
    expect(groupOpenByDefault('done', false)).toBe(false)
  })

  it('opens everything the reader has filtered down to — they asked for it', () => {
    for (const group of ITEM_GROUPS) expect(groupOpenByDefault(group, true)).toBe(true)
  })
})

describe('edits', () => {
  it('returns the SAME array when nothing changed, so no revision is burned', () => {
    // The sync replica only stamps and broadcasts when it is handed a
    // different array. A no-op that rebuilt the list would wake every device
    // for a keystroke that changed no fact.
    const items = [item()]
    expect(editItem(items, 'i-1', { title: 'A thing' }, T0 + 9)).toBe(items)
  })

  it('stamps updatedAt only on a real change', () => {
    const before = [item({ title: 'A' })]
    const after = editItem(before, 'i-1', { title: 'B' }, T0 + 9)
    expect(after[0]?.updatedAt).toBe(T0 + 9)
    expect(before[0]?.title).toBe('A')
  })

  it('leaves every other row byte-identical', () => {
    const before = [item({ id: 'a' }), item({ id: 'b', title: 'B' })]
    const after = editItem(before, 'b', { title: 'B2' }, T0 + 9)
    expect(after[0]).toBe(before[0])
  })

  it('reports no change for an unknown row instead of inventing one', () => {
    const before = [item()]
    expect(editItem(before, 'nope', { title: 'x' }, T0 + 9)).toBe(before)
  })

  it('toggles a step in place and reports a missing one as no change', () => {
    const before = [item({ steps: [step('s1', 'a'), step('s2', 'b')] })]
    const after = toggleItemStep(before, 'i-1', 's1', T0 + 9)
    expect(after[0]?.steps.map(s => s.done)).toEqual([true, false])
    expect(toggleItemStep(before, 'i-1', 'nope', T0 + 9)).toBe(before)
  })

  it('toggling back is a real change again, not a no-op', () => {
    // Symmetry matters: if a toggle that turned a step off returned the same
    // array, the step would be stuck on forever.
    const before = [item({ steps: [step('s1', 'a', true)] })]
    expect(toggleItemStep(before, 'i-1', 's1', T0 + 9)).not.toBe(before)
  })

  it('removes a row, and says so for one that was never there', () => {
    const before = [item({ id: 'a' }), item({ id: 'b' })]
    expect(removeItem(before, 'a').map(i => i.id)).toEqual(['b'])
    expect(removeItem(before, 'zzz')).toBe(before)
  })
})
