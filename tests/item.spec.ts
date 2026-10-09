/**
 * Item-model tests (src/core/item.ts): the field verdicts, the three derived
 * readings, and the inbound grammar that repairs a replica's rows.
 *
 * The verdicts are the load-bearing part. `ITEM_FIELDS` is keyed by
 * `keyof ItemRecord`, so a field added to the model without a ruling fails the
 * build; the test below then pins that the table and the model really do have
 * the same key set, which the compiler alone cannot see (a table may carry a
 * key the model no longer has, and nothing would say so).
 */
import { describe, expect, it } from 'vitest'
import {
  ITEM_FIELDS,
  ITEM_PRIORITIES,
  ITEM_STATUSES,
  ITEM_STATUS_VIEWS,
  itemProgressOf,
  itemStatusOf,
  itemTitleOf,
  parseItems,
  type ItemOriginSource,
  type ItemRecord,
  type ItemStatus,
} from '../src/core/item.ts'
import { ALL_STATUSES } from '../src/core/tasks.ts'

const T0 = 1_700_000_000_000

/** One row, with only what a test cares about overridden. */
function item(patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'i-1',
    ref: 12,
    title: 'A thing',
    body: 'the body',
    notes: '',
    steps: [],
    status: 'todo',
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

/** A counter that hands out 1, 2, 3 … so a minted number is checkable. */
function counter(start = 1): () => number {
  let next = start
  return () => next++
}

describe('ITEM_FIELDS', () => {
  it('ruled on exactly the fields the model has — no more, no fewer', () => {
    expect(Object.keys(ITEM_FIELDS).sort()).toEqual(Object.keys(item()).sort())
  })

  it('states a reason for every verdict (a bare verdict is a shrug)', () => {
    for (const [field, spec] of Object.entries(ITEM_FIELDS)) {
      expect(spec.why.trim(), `${field} has no reason`).not.toBe('')
      expect(['writable', 'derived', 'forbidden']).toContain(spec.access)
    }
  })

  it('keeps the identity and the provenance out of every writer\'s reach', () => {
    // forbidden = no writer exists in this system, and that IS the promise
    expect(ITEM_FIELDS.id.access).toBe('forbidden')
    expect(ITEM_FIELDS.origin.access).toBe('forbidden')
  })

  it('leaves the system-owned fields derived, not writable', () => {
    // The short number and the two stamps are the document's to hand out;
    // letting an action write them is how a list gets renumbered underfoot.
    for (const field of ['ref', 'createdAt', 'updatedAt'] as const) {
      expect(ITEM_FIELDS[field].access, `${field} must be derived`).toBe('derived')
    }
  })

  it('leaves the three times writable and separate — collapsing them is the bug', () => {
    for (const field of ['startsAfter', 'dueAt', 'hardDueAt'] as const) {
      expect(ITEM_FIELDS[field].access).toBe('writable')
    }
  })
})

describe('itemProgressOf', () => {
  it('derives progress from the steps and never asks for a percentage', () => {
    const row = item({ steps: [
      { id: 's1', text: 'a', done: true },
      { id: 's2', text: 'b', done: false },
      { id: 's3', text: 'c', done: false },
      { id: 's4', text: 'd', done: true },
    ] })
    expect(itemProgressOf(row)).toEqual({ done: 2, total: 4, ratio: 0.5 })
  })

  it('has NO progress for a row with no checklist (an empty 0% bar is a lie)', () => {
    expect(itemProgressOf(item())).toBeUndefined()
  })

  it('reads a fully done checklist as exactly 1, never as 0.999…', () => {
    const row = item({ steps: [{ id: 's1', text: 'a', done: true }] })
    expect(itemProgressOf(row)).toEqual({ done: 1, total: 1, ratio: 1 })
  })
})

describe('itemStatusOf', () => {
  it('reads a mounted row as wherever its card is — the whole column, not just 「在跑」', () => {
    const linked = item({ taskId: 't-1' })
    expect(itemStatusOf(linked, 'running')).toBe('running')
    expect(itemStatusOf(linked, 'review')).toBe('review')
    expect(itemStatusOf(linked, 'backlog')).toBe('backlog')
  })

  it('falls back to the row itself when the board cannot be read', () => {
    // 看不见看板时它说的是自己的字段——不猜一栏，也不把「看不见」画成「进行中」。
    expect(itemStatusOf(item({ taskId: 't-1' }), undefined)).toBe('todo')
  })

  it('lets a settled row win over the card (a done item is done while its card reruns)', () => {
    expect(itemStatusOf(item({ status: 'done', taskId: 't-1' }), 'running')).toBe('done')
    // 而这一行自己写的「还没做」**不**压过卡片的栏：挂上卡之后它在哪一栏是卡的事实。
    expect(itemStatusOf(item({ status: 'todo', taskId: 't-1' }), 'review')).toBe('review')
  })

  it('存下来的五档就是看板那五栏，逐字同一张表（导入，不是抄）', () => {
    // 读者的原话：「没挂卡的时候为什么只有两档能选？」——答案是那两档的定义方式错了，不是
    // 清单只配有两条。没挂卡时这一行自己的状态就是它的全部事实，五档都成立。
    expect(ITEM_STATUSES).toEqual([...ALL_STATUSES])
    for (const status of ITEM_STATUSES) expect(ITEM_STATUS_VIEWS).toContain(status)
  })

  it('shows every column the board has, in the board order — one vocabulary, imported', () => {
    expect(ITEM_STATUS_VIEWS).toEqual([...ALL_STATUSES])
  })
})

describe('itemTitleOf', () => {
  it('uses the row title when it has one', () => {
    expect(itemTitleOf(item({ title: 'A thing', body: '# other' }))).toBe('A thing')
  })

  it("falls back to the body's first non-blank line, without the heading marks", () => {
    expect(itemTitleOf(item({ title: '', body: '\n\n## 真正的事\n细节' }))).toBe('真正的事')
  })

  it('is empty when there is nothing to fall back to', () => {
    expect(itemTitleOf(item({ title: '', body: '  \n\n' }))).toBe('')
  })
})

describe('parseItems', () => {
  /** A row on the medium, as JSON text. */
  const raw = (patch: Record<string, unknown> = {}): string => JSON.stringify([{
    id: 'i-1',
    ref: 7,
    title: 'T',
    body: 'B',
    notes: 'N',
    steps: [],
    status: 'todo',
    priority: 'normal',
    tags: [],
    origin: { source: 'human', at: T0 },
    createdAt: T0,
    updatedAt: T0,
    ...patch,
  }])

  it('starts empty on absent, unparseable and non-array input', () => {
    expect(parseItems(null, counter())).toEqual([])
    expect(parseItems('{nope', counter())).toEqual([])
    expect(parseItems('{"not":"an array"}', counter())).toEqual([])
  })

  it('keeps a well-formed row exactly as it stands', () => {
    const [row] = parseItems(raw({ dueAt: T0 + 5, taskId: 't-9' }), counter())
    expect(row.ref).toBe(7)
    expect(row.dueAt).toBe(T0 + 5)
    expect(row.taskId).toBe('t-9')
    expect(row.origin).toEqual({ source: 'human', at: T0 })
  })

  it('drops a row that is not a row, rather than half-keeping it', () => {
    const text = JSON.stringify([
      { id: '', title: 'no id', body: '', notes: '', steps: [], origin: { source: 'human', at: T0 }, createdAt: 1, updatedAt: 1 },
      { id: 'ok', title: 'T', body: '', notes: '', steps: [], origin: { source: 'ai', at: T0 }, createdAt: 1, updatedAt: 1 },
    ])
    expect(parseItems(text, counter()).map(row => row.id)).toEqual(['ok'])
  })

  it('reads an old or unknown status as 「还没做」, never dropping the row', () => {
    /* 两个**老值**都要读成「还没做」：`open` 是这一版之前的名字，`blocked` 是这一版删掉的
       那一档（受阻的行还在清单里，只是它现在说「还没做」）。未知值与下一版的词落在这里，
       理由同一条：行是读者写下的东西，枚举是我们的事。 */
    for (const legacy of ['inProgress', 'open', 'blocked', 'whatever']) {
      const [row] = parseItems(raw({ status: legacy, priority: 'urgent-ish' }), counter())
      expect(row.status, `「${legacy}」 should read as 还没做`).toBe('todo')
      expect(row.priority).toBe('normal')
    }
  })

  it('keeps a status and priority the model does know', () => {
    const [row] = parseItems(raw({ status: 'done', priority: 'urgent' }), counter())
    expect(row.status).toBe('done')
    expect(row.priority).toBe('urgent')
    expect(ITEM_PRIORITIES).toEqual(['low', 'normal', 'high', 'urgent'])
  })

  it('mints a short number for a row the medium never carried one, and keeps the ones it did', () => {
    const mint = counter(40)
    const text = JSON.stringify([
      { id: 'legacy', title: '', body: '', notes: '', steps: [], origin: { source: 'import', at: T0 }, createdAt: 1, updatedAt: 1 },
      { id: 'kept', ref: 3, title: '', body: '', notes: '', steps: [], origin: { source: 'human', at: T0 }, createdAt: 1, updatedAt: 1 },
      { id: 'legacy2', ref: -5, title: '', body: '', notes: '', steps: [], origin: { source: 'human', at: T0 }, createdAt: 1, updatedAt: 1 },
    ])
    const rows = parseItems(text, mint)
    expect(rows.map(row => [row.id, row.ref])).toEqual([['legacy', 40], ['kept', 3], ['legacy2', 41]])
  })

  it('repairs the checklist: a bad entry goes, a bad checkbox does not', () => {
    const [row] = parseItems(raw({ steps: [
      { id: 's1', text: 'keep me', done: true },
      { id: '', text: 'no id', done: false },
      { id: 's2', text: 'no done flag', done: 'yes' },
      { id: 's1', text: 'duplicate id', done: false },
      'not an object',
      { id: 's3', text: 'kept', done: 'truthy is not true' },
      { id: 's4', done: true },
    ] }), counter())
    // A corrupt checkbox never costs the person their line: s2 and s3 come back
    // unchecked. An entry with no id or no text is not a step at all.
    expect(row.steps).toEqual([
      { id: 's1', text: 'keep me', done: true },
      { id: 's2', text: 'no done flag', done: false },
      { id: 's3', text: 'kept', done: false },
    ])
  })

  it('a row is checked and its entries are repaired — one bad step never costs the whole item', () => {
    // The deliberate divergence from the ledger grammar: a malformed round
    // there must fail the task, or the run history becomes a lie. A checklist
    // is typed text, and losing the body, the notes and three dates to fix one
    // checkbox would be the bug.
    const [row] = parseItems(raw({ body: 'the real content', steps: [{ id: 's1', text: 'a', done: false }, null] }), counter())
    expect(row.body).toBe('the real content')
    expect(row.steps).toEqual([{ id: 's1', text: 'a', done: false }])
  })

  it('folds tags: trimmed, blanks and non-strings dropped, order kept, no duplicates', () => {
    const [row] = parseItems(raw({ tags: [' a ', 'a', '', 7, null, 'b'] }), counter())
    expect(row.tags).toEqual(['a', 'b'])
  })

  it('drops an instant that is not one, and keeps an empty task link empty', () => {
    const [row] = parseItems(raw({ startsAfter: 'soon', dueAt: Number.NaN, hardDueAt: T0 + 1, taskId: '' }), counter())
    expect(row.startsAfter).toBeUndefined()
    expect(row.dueAt).toBeUndefined()
    expect(row.hardDueAt).toBe(T0 + 1)
    expect(row.taskId).toBeUndefined()
  })

  it('keeps the provenance whole, session handle included', () => {
    const text = JSON.stringify([{
      id: 'i-1', ref: 1, title: '', body: '', notes: '', steps: [],
      origin: { source: 'ai', at: T0, sessionId: 's-3' }, createdAt: T0, updatedAt: T0,
    }])
    const [row] = parseItems(text, counter())
    expect(row.origin).toEqual({ source: 'ai', at: T0, sessionId: 's-3' })
  })

  it('rejects a row whose origin is unreadable — provenance is not optional', () => {
    const [row] = parseItems(raw({ origin: { source: 'robot', at: T0 } }), counter())
    expect(row).toBeUndefined()
  })

  it('never mints a number for a row it does keep (the counter only moves on a mint)', () => {
    const mint = counter(100)
    parseItems(raw(), mint)
    expect(mint()).toBe(100)
  })

  it('a source the model does not know is a dropped row, never a silent relabel', () => {
    const sources: ItemOriginSource[] = ['human', 'ai', 'import']
    for (const source of sources) {
      const [row] = parseItems(raw({ origin: { source, at: T0 } }), counter())
      expect(row.origin.source).toBe(source)
    }
    const [row] = parseItems(raw({ status: 'todo' as ItemStatus, origin: undefined }), counter())
    expect(row).toBeUndefined()
  })
})
