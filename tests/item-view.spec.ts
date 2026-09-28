/**
 * The list's derivation layer: every judgment the panel draws.
 *
 * WHY THIS FILE IS ITS OWN CONTRACT. `core/item-view.ts` is where the query
 * grammar, the page membership, the date verdicts, the staleness exemptions
 * and the triage sentences live — and the human surface and the model BOTH read
 * it. A file that two surfaces depend on and no test pins is the most dangerous
 * kind of green: it looks finished, and it is the one place a change can quietly
 * make the search box and the model's query disagree.
 *
 * The date cases are the ones worth reading twice, because each of them is a
 * bug this surface already had or nearly had: the three dates drawn identically,
 * a slipped plan painted red, a deliberately gated row counted as neglect, and
 * a row quoting the ledger's "nobody has numbered me" sentinel.
 */
import { describe, expect, it } from 'vitest'
import type { ItemRecord } from '../src/core/item.ts'
import {
  DEFAULT_STALE_DAYS,
  EMPTY_ITEM_QUERY,
  HARD_SOON_DAYS,
  ITEM_PAGES,
  ITEM_SORTS,
  ITEM_STATUS_ORDER,
  SCHEDULE_BUCKETS,
  datePostureOf,
  isInboxItem,
  itemMatches,
  itemMatchesText,
  itemRefOf,
  itemRowViewOf,
  itemSlicesOf,
  itemMatchContextOf,
  parseItemQuery,
  scheduleBucketOf,
  sortItemsOf,
  staleDaysOf,
  triageLinesOf,
} from '../src/core/item-view.ts'
import { itemDateConflict } from '../src/core/item.ts'

const T0 = new Date(2026, 8, 29, 10, 0, 0).getTime()
const DAY = 86_400_000

function row(patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'i-1',
    ref: 1,
    title: 'A thing',
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
    origin: { source: 'human', at: T0 - 30 * DAY },
    createdAt: T0 - 30 * DAY,
    updatedAt: T0 - DAY,
    ...patch,
  }
}

/** The context a page judges rows against: a fixed clock, nothing running. */
const ctx = () => ({ ...itemMatchContextOf(T0), running: new Map<string, boolean>() })

describe('the row names itself', () => {
  it('speaks the document-minted number', () => {
    expect(itemRefOf(row({ ref: 7 })).text).toBe('#7')
  })

  it('never shows the ledger sentinel, because `#0` is a fact about storage', () => {
    // `ref: 0` is the document saying "nobody has numbered me yet". Quoting it
    // on screen hands the reader a storage detail dressed as a short number,
    // and two unnumbered rows would answer to the same name.
    const view = itemRefOf(row({ ref: 0 }))
    expect(view.numbered).toBe(false)
    expect(view.text).toBeUndefined()
  })
})

describe('the three dates are three different promises', () => {
  it('a slipped WANTED-BY date is behind plan, never an alarm', () => {
    // The verdict that this whole branch exists for. A soft date that slipped is
    // a fact about a plan; painting it red is how a soft deadline quietly
    // becomes a hard one without anybody deciding that.
    const posture = datePostureOf(row({ dueAt: T0 - 3 * DAY }), T0)
    expect(posture.kind).toBe('behind')
    expect(posture).toMatchObject({ days: 3 })
  })

  it('only a missed HARD deadline is the overdue verdict', () => {
    expect(datePostureOf(row({ hardDueAt: T0 - 9 * DAY }), T0).kind).toBe('hardOverdue')
  })

  it('warns about a hard deadline inside the window, and not outside it', () => {
    const inside = datePostureOf(row({ hardDueAt: T0 + HARD_SOON_DAYS * DAY }), T0)
    expect(inside.kind).toBe('hardSoon')
    expect(datePostureOf(row({ hardDueAt: T0 + (HARD_SOON_DAYS + 2) * DAY }), T0).kind).toBe('hardAhead')
  })

  it('reports both dates on a row that carries both', () => {
    // The hard date decides the VERDICT; the soft one is still readable, so a
    // row never says half of what the reader set.
    const view = itemRowViewOf(row({ dueAt: T0 - 3 * DAY, hardDueAt: T0 - 1 * DAY }), { now: T0, running: new Map() })
    expect(view.posture.kind).toBe('hardOverdue')
    expect(view.soft.overdue).toBe(true)
  })

  it('a gate outranks everything: a row that may not start cannot be late', () => {
    const posture = datePostureOf(row({ startsAfter: T0 + DAY, hardDueAt: T0 + 2 * DAY }), T0)
    expect(posture.kind).toBe('gated')
  })

  it('has no start date means always ready, never gated', () => {
    // Taskwarrior's rule, and the one Obsidian mirrors: an absent start date
    // is not a gate, it is the absence of one.
    expect(datePostureOf(row(), T0).kind).toBe('none')
  })

  it('says a self-contradicting row is contradicting, rather than picking one', () => {
    // The document deliberately does not repair such a row, so the read side is
    // the only place left that can tell the reader. Quietly choosing one of the
    // three dates would draw a confident schedule on impossible data.
    const broken = row({ startsAfter: T0 + 5 * DAY, dueAt: T0 + DAY })
    expect(itemDateConflict(broken)).toBeDefined()
    expect(datePostureOf(broken, T0).kind).toBe('contradiction')
  })

  it('checks the start-against-hard pair on its own', () => {
    // The trap: the first pair (start vs due) returns first, so this branch is
    // UNREACHABLE unless dueAt is absent. Asserting it with dueAt set would pass
    // while testing nothing.
    const onlyStartAndHard = row({ startsAfter: T0 + 5 * DAY, dueAt: undefined, hardDueAt: T0 + DAY })
    expect(itemDateConflict(onlyStartAndHard)).toMatchObject({ field: 'startsAfter', limit: T0 + DAY })
  })
})

describe('neglect has exemptions, and a ceiling', () => {
  it('counts untouched days on an open row', () => {
    expect(staleDaysOf(row({ updatedAt: T0 - 20 * DAY }), T0)).toBe(20)
  })

  it('exempts a row that is not startable yet — it CANNOT be touched', () => {
    expect(staleDaysOf(row({ startsAfter: T0 + DAY, updatedAt: T0 - 90 * DAY }), T0)).toBeUndefined()
  })

  it('exempts a blocked row — it CANNOT be touched either', () => {
    expect(staleDaysOf(row({ status: 'blocked', updatedAt: T0 - 90 * DAY }), T0)).toBeUndefined()
  })

  it('stops reporting past the ceiling, so the signal cannot become a guilt engine', () => {
    // A staleness warning with no ceiling nags about rows the reader parked on
    // purpose; the first time that happens the reader turns the whole thing off.
    expect(staleDaysOf(row({ updatedAt: T0 - (DEFAULT_STALE_DAYS + 400) * DAY }), T0)).toBeUndefined()
  })

  it('does not report a row that changed today', () => {
    expect(staleDaysOf(row({ updatedAt: T0 }), T0)).toBe(0)
  })
})

describe('the inbox is computed, not stored', () => {
  it('holds a bare capture', () => {
    expect(isInboxItem(row())).toBe(true)
  })

  it('lets a row go the moment it is filed, and says which field filed it', () => {
    for (const patch of [
      { priority: 'high' as const },
      { tags: ['x'] },
      { taskId: 't-1' },
      { startsAfter: T0 + DAY },
      { dueAt: T0 + DAY },
      { hardDueAt: T0 + DAY },
    ]) {
      expect(isInboxItem(row(patch)), JSON.stringify(patch)).toBe(false)
    }
  })

  it('does not count body text, notes or steps as structure', () => {
    // They are CONTENT, not a place in the taxonomy. A note that arrives with a
    // checklist is still a thought that needs a decision.
    expect(isInboxItem(row({ body: 'lots of it', notes: 'context', steps: [{ id: 's', text: 'x', done: false }] }))).toBe(true)
  })

  it('never holds finished work', () => {
    expect(isInboxItem(row({ status: 'done' }))).toBe(false)
  })
})

describe('the query grammar', () => {
  it('is all-words over title, body, notes and tags', () => {
    const target = row({ title: 'Fix login', body: 'mentions LOGIN', notes: 'a note', tags: ['login'] })
    expect(itemMatches(target, parseItemQuery('login'), ctx())).toBe(true)
    expect(itemMatches(row({ title: 'unrelated' }), parseItemQuery('login'), ctx())).toBe(false)
  })

  it('leaves an unrecognised qualifier as the literal words the reader typed', () => {
    // Swallowing `notes:xyz` into a qualifier would lose their words, which is
    // the one failure a search box cannot recover from.
    const query = parseItemQuery('notes:xyz')
    expect(query.words).toEqual(['notes:xyz'])
    expect(query.flags.size).toBe(0)
  })

  it('reads a status by its ENUM value and never by its display word', () => {
    // A filter written against a label stops matching the moment the label is
    // reworded; one written against the value survives every rename.
    const target = row()
    expect(itemMatches(target, parseItemQuery('status:open'), ctx())).toBe(true)
    expect(itemMatches(target, parseItemQuery('status:待办'), ctx())).toBe(false)
  })

  it('reads priority digits, and does not infer them from the enum order', () => {
    // `p1` is the MOST urgent while the enum runs low -> high, so anything
    // derived from array position gets this exactly backwards.
    const urgent = parseItemQuery('p1')
    expect(urgent.priority).toEqual(['urgent'])
    expect(itemMatches(row({ priority: 'urgent' }), urgent, ctx())).toBe(true)
    expect(itemMatches(row({ priority: 'low' }), urgent, ctx())).toBe(false)
  })

  it('separates a missed hard deadline from a slipped plan', () => {
    // There is deliberately no `overdue:`: it cannot say WHICH date passed,
    // and "cannot say which" is the exact bug the three-tone row exists to end.
    const hard = row({ hardDueAt: T0 - DAY })
    const soft = row({ dueAt: T0 - DAY })
    expect(itemMatches(hard, parseItemQuery('has:hardOverdue'), ctx())).toBe(true)
    expect(itemMatches(soft, parseItemQuery('has:hardOverdue'), ctx())).toBe(false)
    expect(itemMatches(soft, parseItemQuery('has:behind'), ctx())).toBe(true)
  })

  it('an empty query matches everything, so a filter is a sieve and not a gate', () => {
    expect(itemMatches(row(), EMPTY_ITEM_QUERY, ctx())).toBe(true)
  })

  it('offers the same answer through the one-call form the model uses', () => {
    const target = row({ tags: ['gallery'], dueAt: T0 - DAY })
    expect(itemMatchesText(target, 'gallery has:behind', T0)).toBe(true)
    expect(itemMatchesText(target, 'gallery has:hardOverdue', T0)).toBe(false)
  })
})

describe('grouping and ordering', () => {
  const rows = [
    row({ id: 'a', ref: 1, status: 'open', title: 'one' }),
    row({ id: 'b', ref: 2, status: 'blocked', title: 'two' }),
    row({ id: 'c', ref: 3, status: 'done', title: 'three' }),
  ]

  it('keeps an empty group and reports the zero', () => {
    // A group that vanishes when it empties reads as a broken filter rather
    // than an empty queue, and the reader loses the map of the whole list.
    const slices = itemSlicesOf(rows, { query: EMPTY_ITEM_QUERY, ctx: ctx(), sort: 'due' })
    expect(slices.map(s => s.status)).toEqual(ITEM_STATUS_ORDER.filter(s => s !== 'done'))
    expect(slices.every(s => s.items.length > 0)).toBe(false)
  })

  it('hides the finished group until it is asked for, and reports progress only with steps', () => {
    const withoutDone = itemSlicesOf(rows, { query: EMPTY_ITEM_QUERY, ctx: ctx(), sort: 'due' })
    expect(withoutDone.some(s => s.status === 'done')).toBe(false)
    const withDone = itemSlicesOf(rows, { query: EMPTY_ITEM_QUERY, ctx: ctx(), sort: 'due', includeDone: true })
    expect(withDone.find(s => s.status === 'done')?.items).toHaveLength(1)
    expect(withDone.every(s => s.progress === undefined)).toBe(true)
  })

  it('is order-independent, so two devices holding one document agree', () => {
    const forward = itemSlicesOf(rows, { query: EMPTY_ITEM_QUERY, ctx: ctx(), sort: 'due' })
    const backward = itemSlicesOf([...rows].reverse(), { query: EMPTY_ITEM_QUERY, ctx: ctx(), sort: 'due' })
    expect(backward.map(s => s.items.map(i => i.id))).toEqual(forward.map(s => s.items.map(i => i.id)))
  })

  it('orders by the nearest date, and the hard date wins that claim', () => {
    // Bucketing a row carrying both dates by its soft one would park it later
    // than the day it has to be done by — the one error an agenda cannot make.
    const soon = row({ id: 'soon', hardDueAt: T0 + DAY, dueAt: T0 + 40 * DAY })
    const far = row({ id: 'far', dueAt: T0 + 30 * DAY })
    expect(sortItemsOf([far, soon], 'due').map(r => r.id)).toEqual(['soon', 'far'])
  })

  it('every ordering is a TOTAL order, so equal keys never reshuffle', () => {
    // A "nearest date" order that leaves the undated in input order is not a
    // total order, and that is how a list looks different on two devices.
    const tied = [
      row({ id: 'x', ref: 5, updatedAt: T0 }),
      row({ id: 'y', ref: 5, updatedAt: T0 }),
      row({ id: 'z', ref: 5, updatedAt: T0 }),
    ]
    for (const sort of ITEM_SORTS) {
      const once = sortItemsOf(tied, sort).map(r => r.id)
      const again = sortItemsOf([...tied].reverse(), sort).map(r => r.id)
      expect(once, sort).toEqual(again)
    }
  })
})

describe('the agenda', () => {
  it('is a fixed set of buckets, in reading order', () => {
    // A page that grows a column under demand is a page nobody scans.
    expect([...SCHEDULE_BUCKETS]).toEqual(['hardOverdue', 'behind', 'today', 'tomorrow', 'week', 'later', 'undated', 'gated'])
  })

  it('keeps a gated row out of every day bucket', () => {
    // It is not late, not due and not startable; showing it beside today's work
    // is a lie about what can be done today.
    expect(scheduleBucketOf(row({ startsAfter: T0 + DAY, dueAt: T0 + 2 * DAY }), T0)).toBe('gated')
  })

  it('puts an undated row in its own named container rather than nowhere', () => {
    expect(scheduleBucketOf(row(), T0)).toBe('undated')
  })

  it('keeps a self-contradicting row ON the agenda, so it can be fixed', () => {
    // Dropping it would hide the one row whose dates need attention.
    const broken = row({ startsAfter: T0 + 40 * DAY, dueAt: T0 + DAY })
    expect(['hardOverdue', 'behind', 'today', 'tomorrow', 'week', 'later']).toContain(scheduleBucketOf(broken, T0))
  })

  it('reads today across a daylight-saving change as today', () => {
    // A day boundary is 23 or 25 hours long twice a year, so truncating the
    // offset puts one day's rows a day early and a test on that day fails for
    // a reason nobody can see.
    const dstDay = new Date(2026, 2, 8, 0, 30, 0).getTime()
    expect(scheduleBucketOf(row({ dueAt: dstDay + 3600_000 }), dstDay + 3600_000)).toBe('today')
  })
})

describe('the triage strip', () => {
  it('emits a line only when it has something to say', () => {
    // A strip listing four zeros is four rows of chrome saying nothing, and the
    // reader learns to skip it.
    expect(triageLinesOf([row()], T0)).toEqual([])
    expect(triageLinesOf([], T0)).toEqual([])
  })

  it('every line carries the rows it counted, so the jump shows the same set', () => {
    const behind = row({ id: 'b', dueAt: T0 - DAY })
    const blocked = row({ id: 'c', status: 'blocked' })
    const lines = triageLinesOf([behind, blocked], T0)
    expect(lines.find(l => l.id === 'behind')?.items.map(i => i.id)).toEqual(['b'])
    expect(lines.find(l => l.id === 'blocked')?.items.map(i => i.id)).toEqual(['c'])
  })

  it('never nags about finished work', () => {
    expect(triageLinesOf([row({ status: 'done', dueAt: T0 - 30 * DAY })], T0)).toEqual([])
  })
})

describe('the page set is a closed constant', () => {
  it('is exactly three destinations, and the interface cannot add a fourth', () => {
    // Things' AppleScript manual: predefined, and you may not create a new list.
    // A rail that grows an entry every time the reader asks a question has
    // turned a map into a log.
    expect([...ITEM_PAGES]).toEqual(['inbox', 'list', 'schedule'])
  })
})
