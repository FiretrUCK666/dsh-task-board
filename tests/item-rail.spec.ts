/**
 * The rail, and the promise it makes.
 *
 * Two things are asserted here, and they are the two halves of PRODUCT's
 * invariant 1 (「数与跳必须共用一个谓词」): that a number on a rail row IS the
 * length of the rows it holds, and that pressing it lands on exactly those rows.
 *
 * The second one is the one that was silently broken. The rail used to be a
 * table of words with numbers in it; the jump behind each number was a filter
 * that happened to be spelled the same way. Nothing tied the two, so they agreed
 * only while nobody edited the data — and every gate in the repo was green the
 * whole time.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_ITEM_QUERY,
  ITEM_FLAGS,
  ITEM_FLAG_TESTS,
  ITEM_STATUS_VIEWS,
  itemHasFlag,
  itemMatchContextOf,
  itemMatches,
  itemRailGroupsOf,
  parseItemQuery,
} from '../src/core/item-view.ts'
import type { ItemFlag, ItemFlagProbe, ItemRailEntry } from '../src/core/item-view.ts'
import type { ItemRecord } from '../src/core/item.ts'

const NOW = new Date(2026, 8, 29, 10, 0, 0).getTime()
const DAY = 86_400_000
const CTX = { ...itemMatchContextOf(NOW), running: new Map<string, boolean>() }

/**
 * One row per condition the rail asks about, so every group has something in it
 * and a group that silently stopped matching would show up as a zero here.
 *
 * Built by spreading one base row, because a fixture that repeats its own shape
 * nine times is nine chances to type a field wrong — and a field typed wrong in a
 * fixture produces a test that passes while testing nothing.
 */
function row(patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'i-1',
    ref: 1,
    title: '一条',
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
    origin: { source: 'human', at: NOW - 30 * DAY },
    createdAt: NOW - 30 * DAY,
    updatedAt: NOW - DAY,
    ...patch,
  }
}

const FIXTURE: readonly ItemRecord[] = [
  row({ id: 'i-bare', ref: 1 }),
  row({ id: 'i-hard-late', ref: 2, priority: 'urgent', hardDueAt: NOW - 2 * DAY, tags: ['x'] }),
  row({ id: 'i-soft-late', ref: 3, dueAt: NOW - 3 * DAY, tags: ['x'] }),
  row({ id: 'i-neglected', ref: 4, updatedAt: NOW - 40 * DAY, tags: ['x'] }),
  row({ id: 'i-blocked', ref: 5, status: 'blocked', tags: ['x'] }),
  row({ id: 'i-gated', ref: 6, startsAfter: NOW + 3 * DAY, tags: ['x'] }),
  row({ id: 'i-linked', ref: 7, taskId: 'card-1', tags: ['x'] }),
  row({ id: 'i-done', ref: 8, status: 'done', tags: ['x'] }),
  row({ id: 'i-ordinary', ref: 9, tags: ['x'] }),
]

function fixture(): readonly ItemRecord[] { return FIXTURE }

function entryOf(id: string, rows: readonly ItemRecord[] = FIXTURE): ItemRailEntry {
  const found = itemRailGroupsOf(rows, CTX).flatMap(group => group.entries).find(one => one.id === id)
  if (found === undefined) throw new Error(`no rail entry named ${id}`)
  return found
}

describe('the registry of flag tests is keyed on the union, so a missing arm is a BUILD failure', () => {
  // @ts-expect-error The registry is `Readonly<Record<ItemFlag, …>>`, so leaving a
  // flag out is a type error rather than a runtime surprise — this line is what
  // that costs, written down so the cost is visible. If the type ever widens to
  // an index signature or a `Partial`, this directive goes unused and `tsc`
  // reports TS2578, which IS the alarm.
  const MISSING_ARM_WOULD_NOT_COMPILE: Readonly<Record<ItemFlag, (probe: ItemFlagProbe) => boolean>> = {
    done: () => true,
  }
  void MISSING_ARM_WOULD_NOT_COMPILE

  it('every declared flag has an arm, and every arm is reachable by name', () => {
    expect(Object.keys(ITEM_FLAG_TESTS).sort(), 'the registry and the flag list are two answers to 「what flags exist」').toEqual([...ITEM_FLAGS].sort())
  })

  it('an arm is a function, not a truthy placeholder', () => {
    for (const flag of ITEM_FLAGS) expect(typeof ITEM_FLAG_TESTS[flag], `${flag} has no arm`).toBe('function')
  })
})

describe('a rail number IS the length of the rows beside it', () => {
  it('holds for every entry in every group', () => {
    for (const group of itemRailGroupsOf(fixture(), CTX)) {
      for (const entry of group.entries) {
        expect(entry.n, `${entry.id} carries a number that is not its rows`).toBe(entry.rows.length)
      }
    }
  })

  it('and there is nowhere in the entry for a SECOND number to hide', () => {
    const keys = Object.keys(entryOf('flag:overdue')).sort()
    expect(keys, 'the rail grew a field a reader could see and the predicate would not honour').toEqual(['id', 'key', 'kind', 'n', 'rows', 'token'])
  })
})

describe('pressing a rail row lands on exactly the rows it counted', () => {
  it('every flag entry agrees with the grammar, row for row', () => {
    const items = fixture()
    for (const flag of ITEM_FLAGS) {
      const byPredicate = items.filter(item => itemHasFlag(item, flag, CTX))
      const byGrammar = items.filter(item => itemMatches(item, parseItemQuery(`has:${flag}`), CTX))
      expect(byGrammar.map(item => item.id), `has:${flag} and itemHasFlag disagree`).toEqual(byPredicate.map(item => item.id))
    }
  })

  it('so a flag with a rail row and its jump are the same set', () => {
    const items = fixture()
    for (const entry of itemRailGroupsOf(fixture(), CTX).flatMap(group => group.entries)) {
      if (entry.kind !== 'flag') continue
      const landed = items.filter(item => itemMatches(item, parseItemQuery(entry.token), CTX))
      expect(landed.map(item => item.id), `${entry.id} counts rows its own token does not show`).toEqual(entry.rows.map(item => item.id))
    }
  })

  it('and the token round-trips: writing it and deleting it leaves the query as it was', () => {
    const entry = entryOf('flag:overdue')
    expect(parseItemQuery(entry.token).flags.has('overdue')).toBe(true)
    expect(parseItemQuery(entry.token).words, 'a token that also carries a free word filters by something else too').toEqual([])
  })
})

describe('a set is not a filter, and says so', () => {
  it('刚记的 carries rows and no token, because the grammar has no word for it', () => {
    const entry = entryOf('inbox')
    expect(entry.token).toBe('')
    expect(entry.rows.length).toBeGreaterThan(0)
  })

  it('全部 is the document, unfiltered', () => {
    const items = fixture()
    expect(entryOf('all', items).n).toBe(items.length)
  })

  it('已删除 counts the archive rows it was given, and they are NOT in the document count', () => {
    const items = fixture()
    const dead = items.slice(0, 2).map((item, at) => ({ ...item, id: `gone-${at}`, status: 'done' as const }))
    const groups = itemRailGroupsOf(items, CTX, dead)
    const deleted = groups.flatMap(group => group.entries).find(one => one.id === 'deleted')
    expect(deleted?.n).toBe(dead.length)
    expect(groups.flatMap(group => group.entries).find(one => one.id === 'all')?.n).toBe(items.length)
  })
})

describe('no set has two identities in one rail', () => {
  it('受阻 is a STATUS, so it appears once and only under 按状态', () => {
    const groups = itemRailGroupsOf(fixture(), CTX)
    const every = groups.flatMap(group => group.entries.map(entry => ({ group: group.id, entry })))
    const blockedRows = fixture().filter(item => item.status === 'blocked').map(item => item.id)
    if (blockedRows.length === 0) return

    const asStatus = every.filter(one => one.entry.kind === 'status' && one.entry.key === 'blocked')
    expect(asStatus, '受阻 lost its status row').toHaveLength(1)
    const asFlag = every.filter(one => one.entry.kind === 'flag' && ['blocked', 'done'].includes(one.entry.key))
    expect(asFlag, 'a status also appears as a condition, which is two identities for one set of rows').toEqual([])
  })

  it('every entry id is unique across the whole rail', () => {
    const ids = itemRailGroupsOf(fixture(), CTX).flatMap(group => group.entries.map(entry => entry.id))
    expect(new Set(ids).size, 'two rail rows share an id').toBe(ids.length)
  })

  it('every flag token is one the parser actually speaks', () => {
    for (const entry of itemRailGroupsOf(fixture(), CTX).flatMap(group => group.entries)) {
      if (entry.token === '') continue
      expect(parseItemQuery(entry.token), `${entry.id} writes ${entry.token}, which parses to nothing`).not.toEqual(EMPTY_ITEM_QUERY)
    }
  })
})

describe('the rail does not reach for a clock of its own', () => {
  it('two calls with the same document and the same context give the same rail', () => {
    expect(itemRailGroupsOf(fixture(), CTX)).toEqual(itemRailGroupsOf(fixture(), CTX))
  })

  it('and the status order is the one the model declares, not a second one', () => {
    const statuses = itemRailGroupsOf(fixture(), CTX)
      .flatMap(group => group.entries)
      .filter(entry => entry.kind === 'status')
      .map(entry => entry.key)
    expect(statuses).toEqual([...ITEM_STATUS_VIEWS])
  })
})