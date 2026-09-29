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
  ITEM_INSIGHT_IDS,
  ITEM_PAGES,
  ITEM_SORTS,
  ITEM_STATUS_ORDER,
  SCHEDULE_BUCKETS,
  datePostureOf,
  isAgendaItem,
  isInboxItem,
  itemGroupCountsOf,
  itemInsightOf,
  itemMatches,
  itemMatchesText,
  itemPageCountsOf,
  itemRefOf,
  itemRowViewOf,
  itemSlicesOf,
  itemMatchContextOf,
  parseItemQuery,
  scheduleBucketOf,
  scheduleBucketsOf,
  sortItemsOf,
  staleDaysOf,
  triageLinesOf,
} from '../src/core/item-view.ts'
import { itemDateConflict, isItemRecordShape } from '../src/core/item.ts'
import { compareItemOrder } from '../src/core/items-doc.ts'

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

  it('a stamp that is not FINITE is refused, so no ordering can return NaN', () => {
    // The totality gate above proves order-independence for FINITE keys, and every
    // fixture in this file comes from one `row()` helper with a finite clock — so
    // the `1e999` path was unreachable from this suite and the `birth` ordering's
    // `Infinity - Infinity` had nothing standing in front of it.
    //
    // `JSON.parse('1e999')` is `Infinity`, not a parse error, so a persisted or
    // hand-edited file carries it quietly. `Array.prototype.sort` treats a `NaN`
    // comparison as EQUAL, which does not fail: the rows are simply never ordered
    // against each other and the list falls back to arrival order, so two devices
    // holding one document show two lists. The only thing standing between that
    // and a reader is the shape guard asking for a finite NUMBER rather than a
    // finite-looking one.
    const infinite = (id: string, createdAt: number): ItemRecord =>
      ({ ...row({ id }), createdAt } as unknown as ItemRecord)
    // The two rows differ ONLY in a stamp the grammar must have refused.
    const a = infinite('a', Number.POSITIVE_INFINITY)
    const b = infinite('b', Number.POSITIVE_INFINITY)
    expect(isItemRecordShape({ ...a }), 'an infinite stamp passed the shape guard').toBe(false)
    expect(isItemRecordShape({ ...b, updatedAt: Number.POSITIVE_INFINITY }), 'an infinite updatedAt passed the shape guard').toBe(false)
    // And the comparator itself must never shrug, whatever reaches it.
    for (const sort of ITEM_SORTS) {
      const ordered = sortItemsOf([a, b] as never, sort)
      expect(ordered, `the ${sort} ordering collapsed two rows it could not tell apart`).toHaveLength(2)
    }
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

describe('the seven orderings, one case each on the question they exist to answer', () => {
  it('顺序 IS the document\'s own order, pair by pair, because two devices must not disagree', () => {
    // THE DEFAULT ORDER IS A CONTRACT WITH THE HOST, not a preference. The
    // checklist's order is derived (the new-field admission rule kept `order`
    // out of the model), so a row has exactly one place it can be — and if the
    // surface's answer and the document's answer differ for even ONE pair, two
    // replicas holding the same rows render two lists, with nothing red anywhere
    // and no screenshot on earth that would show it.
    //
    // Pair by pair rather than "the arrays are equal", because the arrays can
    // agree while a pair disagrees: a chain of transpositions can round-trip.
    // The case is built so the five document keys are all live, so a reader
    // cannot tell which pair moved.
    const rows = [
      row({ id: '1', status: 'open', priority: 'low', ref: 9, createdAt: T0 + 4 * DAY, dueAt: T0 + 4 * DAY }),
      row({ id: '2', status: 'done', priority: 'urgent', ref: 1, createdAt: T0 }),
      row({ id: '3', status: 'blocked', priority: 'high', ref: 5, createdAt: T0 + 2 * DAY, dueAt: T0 - DAY }),
      row({ id: '4', status: 'open', priority: 'urgent', ref: 3, createdAt: T0 + DAY, dueAt: T0 + DAY }),
      row({ id: '5', status: 'open', priority: 'low', ref: 7, createdAt: T0 + 3 * DAY, dueAt: T0 + 3 * DAY }),
    ]
    const ordered = sortItemsOf(rows, 'sequence')
    for (const a of rows) {
      for (const b of rows) {
        if (a.id === b.id) continue
        const expected = Math.sign(compareItemOrder(a, b))
        const actual = ordered.findIndex(r => r.id === a.id) - ordered.findIndex(r => r.id === b.id)
        // The document's own "these keys say nothing" is resolved by the number,
        // which the surface also ends on — so equal means "same row", which is
        // only reachable when the two are the same row, excluded above.
        expect(Math.sign(actual), `the surface puts ${a.id} ${actual < 0 ? 'before' : 'after'} ${b.id}, and the document says the other way`).toBe(expected)
      }
    }
    // And the control: the comparator really does separate this set, so the
    // pairs above are not all passing on a zero.
    const signs = rows.flatMap(a => rows.filter(b => a.id !== b.id).map(b => Math.sign(compareItemOrder(a, b))))
    expect(new Set(signs), 'every pair in the fixture compares equal, so the pair loop above proves nothing').not.toEqual(new Set([0]))
  })

  it('a row the document has not numbered yet goes to the END of every ordering, never the top', () => {
    // `ref: 0` is the document's own "nobody has numbered me" sentinel. Sorted
    // as a number it is the SMALLEST, so every fresh row — and on a replica
    // every optimistically created row is `ref: 0` — would jump to the top of
    // the list and shove the reader's own work down the page every time they
    // typed something.
    const fresh = row({ id: 'fresh', ref: 0, createdAt: T0 - DAY, updatedAt: T0 - DAY, dueAt: T0 - 5 * DAY })
    const numbered = row({ id: 'numbered', ref: 1, createdAt: T0 + DAY, updatedAt: T0 + DAY, dueAt: T0 + 30 * DAY })
    for (const sort of ITEM_SORTS) {
      const ordered = sortItemsOf([fresh, numbered], sort).map(r => r.id)
      expect(ordered, `${sort} puts an unnumbered row first — every row the reader has just typed jumps to the top of their own list`).toEqual(['numbered', 'fresh'])
      // The control, and it is the half that matters: on its own the unnumbered
      // row still has to be a real answer, not a dropped one.
      expect(sortItemsOf([fresh], sort).map(r => r.id), sort).toEqual(['fresh'])
    }
  })

  it('the title ordering is code-unit, so it is the same answer on every device', () => {
    // `localeCompare` is the obvious tool and the wrong one: its answer depends
    // on the device's language, so a phone and a laptop could sort the same
    // rows into two different lists for no reason a reader could see.
    //
    // THE EXPECTED ORDER IS WRITTEN BY HAND, and the ground truth underneath it
    // is four facts about code units that any device agrees on. Using
    // `localeCompare` to state the expectation would be asking the thing under
    // test to grade itself, and it would pass on whatever the platform says:
    //
    //   'Apple' < 'apple'    — U+0041 before U+0061
    //   'apple' < 'ärger'    — U+00E4 is after every ASCII letter
    //   'ärger' < '中'        — the CJK block starts at U+4E00
    //   '中文字幕' < '中文标题' — 幕 U+5E55 before 标 U+6807
    //
    // And the rule being pinned is a TWO-PASS one: a Latin-1 case fold decides
    // first, so 'apple' and 'Apple' sit next to each other instead of splitting
    // the alphabet; the RAW code units decide only when the fold ties, which is
    // what puts 'Apple' before 'apple' rather than after it.
    expect('Apple' < 'apple').toBe(true)
    expect('apple' < 'ärger').toBe(true)
    expect('ärger' < '中').toBe(true)
    expect('中文字幕' < '中文标题').toBe(true)
    const rows = [
      row({ id: 'cjk-2', ref: 1, title: '中文字幕' }),
      row({ id: 'lat-1', ref: 2, title: 'apple' }),
      row({ id: 'cjk-1', ref: 3, title: '中文标题' }),
      row({ id: 'lat-2', ref: 4, title: 'Apple' }),
      row({ id: 'umlaut', ref: 5, title: 'Ärger' }),
    ]
    expect(sortItemsOf(rows, 'title').map(r => r.id))
      .toEqual(['lat-2', 'lat-1', 'umlaut', 'cjk-2', 'cjk-1'])
    // And the fold is doing its job: the two spellings of one word are ADJACENT,
    // which is the only reason the first pass exists. A locale's answer would
    // also place them together, so this does not distinguish the two — the four
    // code-unit facts above do, and they are the part that matters.
    const ordered = sortItemsOf(rows, 'title').map(r => r.id)
    expect(ordered.indexOf('lat-2') + 1, 'the case fold did not keep the two spellings together').toBe(ordered.indexOf('lat-1'))
  })

  it('优先级 puts the loud tier at the TOP, which is the opposite of the enum\'s own order', () => {
    // The enum is declared lowest-first because that is how the tiers read in a
    // table. Sorting on it would put the reader's most urgent row at the bottom
    // of the page — and the direction is not a matter of taste: 顺序 already
    // puts it at the top, so switching between the two orders would move the
    // reader's most urgent row from the first line to the last.
    const rows = [
      row({ id: 'low', ref: 1, priority: 'low' }),
      row({ id: 'normal', ref: 2, priority: 'normal' }),
      row({ id: 'high', ref: 3, priority: 'high' }),
      row({ id: 'urgent', ref: 4, priority: 'urgent' }),
    ]
    expect(sortItemsOf(rows, 'priority').map(r => r.id)).toEqual(['urgent', 'high', 'normal', 'low'])
    // And the two orders must AGREE about where the loud tier sits, because the
    // panel's own comment says the scale is "the same one the document's order
    // uses". Stated as an agreement rather than as a number, so it keeps holding
    // if a fifth tier is added to the enum.
    for (const sort of ['sequence', 'priority'] as const) {
      const ordered = sortItemsOf(rows, sort).map(r => r.id)
      expect(ordered.indexOf('urgent'), `${sort} does not put the loudest tier first`).toBeLessThan(ordered.indexOf('high'))
      expect(ordered.indexOf('low'), `${sort} does not put the quietest tier last`).toBeGreaterThan(ordered.indexOf('normal'))
    }
  })

  it('the probe bites: a NaN gap is not a total order, and the pair loop is what sees it', () => {
    // THE DEFECT THIS WHOLE BLOCK EXISTS FOR. Two undated rows both answer
    // `Infinity`; `Infinity - Infinity` is `NaN`; a comparator that returns
    // `NaN` makes `Array.prototype.sort` treat the pair as EQUAL and move on —
    // so those two rows are never ordered against each other at all. The
    // consequence is not a wrong number, it is a list whose order depends on
    // the order the rows happened to arrive in, which differs per device.
    //
    // Shown here as a comparator, because that is the shape the real code has
    // and the shape the gate above would catch if it ever came back.
    const withNaN = (a: number | undefined, b: number | undefined): number => (a ?? Infinity) - (b ?? Infinity)
    expect(Number.isNaN(withNaN(undefined, undefined)), 'the probe is not reproducing the NaN gap').toBe(true)
    expect(Number.isNaN(withNaN(1, undefined)), 'the probe is not reproducing the one-sided gap').toBe(false)
    // And the real function does NOT have it — that is the claim, and it is
    // what the pair loop above verifies pair by pair rather than in the abstract.
    const undated = [row({ id: 'u1', ref: 2 }), row({ id: 'u2', ref: 1 })]
    expect(sortItemsOf(undated, 'due').map(r => r.id)).toEqual(['u2', 'u1'])
    for (const sort of ITEM_SORTS) {
      const forward = sortItemsOf(undated, sort).map(r => r.id)
      const backward = sortItemsOf([...undated].reverse(), sort).map(r => r.id)
      expect(forward, `${sort} orders two undated rows by input order`).toEqual(backward)
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

describe('the numbers on the rail are facts about the DOCUMENT', () => {
  const finished = row({ id: 'f', status: 'done' })
  const unfiled = row({ id: 'u' })
  const dated = row({ id: 'd', dueAt: T0 + DAY })

  it('the list page counts everything, finished work included', () => {
    // Completion is a switch INSIDE the list, never a fourth page. A rail that
    // quietly stopped counting the rows a reader finished would be a second,
    // invisible 「已完成」 page.
    expect(itemPageCountsOf([finished, unfiled, dated]).list).toBe(3)
  })

  it('the inbox counts what the inbox holds, and the agenda counts what the agenda holds', () => {
    const counts = itemPageCountsOf([finished, unfiled, dated])
    expect(counts.inbox, 'a row nobody has filed is not on the inbox rail cell').toBe(1)
    expect(counts.schedule, 'an unfiled capture has no date, so it is not on the agenda — and not in its "no date" tray either').toBe(1)
  })

  it('and the rail agrees with the pages it counts', () => {
    // The failure this exists for is a SECOND opinion: the rail is a map of
    // the document, so its number has to be the number of rows the page
    // actually holds rather than a re-derivation that can drift.
    const rows = [finished, unfiled, dated, row({ id: 'x', status: 'blocked' })]
    const counts = itemPageCountsOf(rows)
    const ctx = { ...itemMatchContextOf(T0), running: new Map<string, boolean>() }
    const onAgenda = scheduleBucketsOf(rows, EMPTY_ITEM_QUERY, ctx, 'due').flatMap(b => b.items.map(i => i.id))
    expect(counts.schedule).toBe(onAgenda.length)
    expect(counts.inbox).toBe(rows.filter(isInboxItem).length)
  })

  it('an empty document reads zero on all three, and does not answer one of them', () => {
    expect(itemPageCountsOf([])).toEqual({ inbox: 0, list: 0, schedule: 0 })
  })

  it('THE MEMBERSHIP, STATED ONCE: a capture is on the inbox and on no agenda at all', () => {
    // The two surfaces answered this separately and drifted, so the strip said a
    // fresh capture is not "unscheduled" while the agenda filed it under exactly
    // that. One predicate, two consumers, and the cases below are the two
    // directions of the round trip.
    for (const capture of [unfiled, row({ id: 'u2', body: '只有正文' })]) {
      expect(isInboxItem(capture), 'a row with no priority, no date, no tag and no card is still unfiled').toBe(true)
      expect(isAgendaItem(capture), 'a capture is on an agenda, which is how a row nobody decided about ends up filed under a date nobody chose').toBe(false)
    }
    // And the dated row is the other way round, so the predicates are not both
    // answering false for everything.
    expect(isAgendaItem(dated)).toBe(true)
    expect(isInboxItem(dated)).toBe(false)
  })

  it('the probe bites: a second spelling of the exemption is reported', () => {
    // A copy inlined at the call site is the drift in its raw form. The shape
    // below is the one that was really there — "the agenda is everything still
    // live" — which cannot tell "no date because nobody decided" from "no date
    // because it was never scheduled", so it files the capture.
    const shared = (rows: readonly ItemRecord[]): number => rows.filter(isAgendaItem).length
    const inlined = (rows: readonly ItemRecord[]): number => rows.filter(r => r.status !== 'done').length
    // Agreement first, on the two rows where the two answers SHOULD agree, so
    // the control is isolating the spellings rather than a difference in rows.
    expect(shared([dated])).toBe(1)
    expect(inlined([dated])).toBe(1)
    expect(shared([finished])).toBe(0)
    expect(inlined([finished])).toBe(0)
    // And disagreement on the capture, which is the one row the two spellings
    // were written to answer differently.
    expect(shared([unfiled]), 'a capture is on an agenda').toBe(0)
    expect(inlined([unfiled]), 'the inline copy filed an unfiled capture — a reader\'s thought landed under a date nobody chose').toBe(1)
  })
})

describe('the four group counts are four, whatever the rows happen to be', () => {
  it('always returns every key, all four, even for an empty document', () => {
    // A header that renders only the groups it has rows for is a header that
    // hides the map of the list, and a pane's empty state that counts
    // differently from the header above it is the same defect in a second
    // place. The shape being a closed Record is the model's way of saying that
    // no surface may drop one.
    expect(Object.keys(itemGroupCountsOf([], new Map())).sort()).toEqual([...ITEM_STATUS_ORDER].sort())
    expect(itemGroupCountsOf([], new Map())).toEqual({ inProgress: 0, open: 0, blocked: 0, done: 0 })
  })

  it('a row hanging off a running card counts as 进行中, and off an idle one as 待办', () => {
    const linked = row({ id: 'l', taskId: 'card-1' })
    expect(itemGroupCountsOf([linked], new Map([['card-1', true]]))).toEqual({ inProgress: 1, open: 0, blocked: 0, done: 0 })
    expect(itemGroupCountsOf([linked], new Map([['card-1', false]]))).toEqual({ inProgress: 0, open: 1, blocked: 0, done: 0 })
  })

  it('a caller with no board in front of it is told nothing is running, rather than being guessed at', () => {
    // A query answer and a dry run pass an empty map. That must make 进行中
    // zero — a row that is quietly running must not be counted as 待办, and must
    // never be counted as 进行中 on a host that cannot see the session.
    const linked = row({ id: 'l', taskId: 'card-1' })
    expect(itemGroupCountsOf([linked], new Map()).inProgress).toBe(0)
  })

  it('the four add up to the document, so the header and the buckets cannot disagree', () => {
    const rows = [
      row({ id: 'a' }), row({ id: 'b', status: 'blocked' }), row({ id: 'c', status: 'done' }),
      row({ id: 'd', taskId: 'card-1' }),
    ]
    const counts = itemGroupCountsOf(rows, new Map([['card-1', true]]))
    expect(Object.values(counts).reduce((sum, n) => sum + n, 0)).toBe(rows.length)
  })
})

describe('the overview is four counts of whole rows, and shares of one denominator', () => {
  const live = row({ id: 'a' })
  const late = row({ id: 'b', dueAt: T0 - 2 * DAY })
  const finished = row({ id: 'f', status: 'done', dueAt: T0 - 30 * DAY })

  it('the tiles come in a fixed order, because a tile is named by its id not its position', () => {
    expect(itemInsightOf([live, late], T0).tiles.map(tile => tile.id)).toEqual([...ITEM_INSIGHT_IDS])
  })

  it('the denominator is what is left to do, and a list with nothing left has no share to give', () => {
    expect(itemInsightOf([live, late, finished], T0).total).toBe(2)
    const empty = itemInsightOf([], T0)
    expect(empty.total).toBe(0)
    // Zero, not a division by zero and not NaN: a meter drawn to "full" over an
    // empty list is the dashboard lying with a straight face.
    for (const tile of empty.tiles) expect(tile.ratio).toBe(0)
  })

  it('each ratio is that tile\'s share of the same denominator, so the four are comparable', () => {
    const insight = itemInsightOf([live, late, row({ id: 'c' })], T0)
    for (const tile of insight.tiles) expect(tile.ratio).toBe(tile.count / insight.total)
    expect(insight.tiles.reduce((sum, tile) => sum + tile.count, 0)).toBeGreaterThan(0)
  })

  it('逾期 means the two late buckets and nothing else, so a gated row is nagged about by neither', () => {
    // A gated row is waiting on a date the reader set; saying it is overdue
    // nags about work that cannot be done today.
    const gated = row({ id: 'g', startsAfter: T0 + 9 * DAY, dueAt: T0 + 20 * DAY })
    const tiles = itemInsightOf([gated], T0).tiles
    const byId = new Map(tiles.map(tile => [tile.id, tile.count]))
    expect(byId.get('overdue')).toBe(0)
    expect(byId.get('today')).toBe(0)
  })

  it('本周 deliberately overlaps 今天, because the two tiles are read together', () => {
    // A 本周 that excluded today would make the pair disagree by one row for no
    // reason the reader could see. The row's date is T0 itself rather than
    // "tomorrow", because a date typed as a day lands at local midnight and
    // T0 + a day is tomorrow — the two cases differ by one bucket, which is
    // the whole point of pinning the instant.
    const byId = new Map(itemInsightOf([row({ id: 't', dueAt: T0 })], T0).tiles.map(tile => [tile.id, tile.count]))
    expect(byId.get('today')).toBe(1)
    expect(byId.get('week')).toBe(1)
  })
})
