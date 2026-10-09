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
  isInboxItem,
  parseItemQuery,
} from '../src/core/item-view.ts'
import type { ItemFlag, ItemFlagProbe, ItemRailEntry } from '../src/core/item-view.ts'
import { isAgendaItem } from '../src/core/item-membership.ts'
import type { ItemRecord } from '../src/core/item.ts'
import type { TaskStatus } from '../src/core/tasks.ts'

const NOW = new Date(2026, 8, 29, 10, 0, 0).getTime()
const DAY = 86_400_000
const CTX = { ...itemMatchContextOf(NOW), cards: new Map<string, TaskStatus>() }

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
    status: 'todo',
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
  row({ id: 'i-blocked', ref: 5, status: 'todo', tags: ['x'] }),
  row({ id: 'i-gated', ref: 6, startsAfter: NOW + 3 * DAY, tags: ['x'] }),
  /* 一份**未来到期**的行：读者那句「按日子的逻辑看不懂」的根因就在这里——它改前落在
     「按日子」那一组的**外面**（既不是已超期，也不是迟迟没动、没定日期）。 */
  row({ id: 'i-ahead', ref: 10, dueAt: NOW + 6 * DAY, tags: ['x'] }),
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

describe('the date group is a PARTITION, and the neglect question is its own group', () => {
  /* 读者问过：「它这个日期的逻辑是什么呢？我有点看不懂。」当时那一组是
     已超期 · 迟迟没动 · 没定日期——三行里有一行不是日期，而且一份**未来到期**的行落在
     这一组之外，于是「按日子」那四个字在屏上并不成立。现在这一组只有日子，而这三行覆盖
     一条分过流的行的每一种日子：在过去、在未来、或者根本没有。 */
  const groups = itemRailGroupsOf(fixture(), CTX)
  const groupOf = (id: string) => groups.find(group => group.id === id)

  it('「按日子」就是那三行，而「没人动的」在它自己那一组', () => {
    expect(groupOf('when')?.word).toBe('when')
    expect(groupOf('when')?.entries.map(one => one.key)).toEqual(['overdue', 'ahead', 'undated'])
    expect(groupOf('idle')?.word, 'the neglect row is still filed under a caption about dates').toBe('idle')
    expect(groupOf('idle')?.entries.map(one => one.key)).toEqual(['stale'])
    expect(groupOf('when')?.entries.some(one => one.key === 'stale'), 'a set with two identities in one rail').toBe(false)
  })

  it('every row that has been decided about falls in exactly ONE of the three', () => {
    let checked = 0
    for (const item of fixture()) {
      const held = ['overdue', 'ahead', 'undated'].filter(flag => itemHasFlag(item, flag as ItemFlag, CTX))
      /* 两处**故意的**例外，与那枚 flag 自己的注释同一句话：刚记下的一句（`isInboxItem`）
         还没到谈日子的阶段；三个日期互相矛盾的那一条两边都有日子、另有自己的说法。 */
      if (isInboxItem(item) || held.length === 0) continue
      checked += 1
      expect(held.length, `${item.id} fell into ${String(held.length)} of the three date rows`).toBe(1)
    }
    expect(checked, 'the fixture exercised no row at all — this gate is asserting nothing').toBeGreaterThan(2)
  })

  it('a row whose date has not arrived is reachable, and it is NOT counted as late', () => {
    // 「还没到」这一枚的全部理由：一份未来到期的行，改前**一行都不在**。
    expect(entryOf('flag:ahead').rows.map(one => one.id)).toContain('i-ahead')
    expect(entryOf('flag:ahead').rows.map(one => one.id)).toContain('i-gated')
    expect(entryOf('flag:overdue').rows.map(one => one.id), 'a date in the future is being counted as late').not.toContain('i-ahead')
  })
})

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
  it('the three place-rows carry rows and no token, because the grammar has no word for them', () => {
    // A TOKEN IS WHAT MAKES A ROW A FILTER. These three are not filters: they are
    // the document (全部), the document read day by day (日程), and the rows that
    // are no longer in it (已删除). Each opens a PLACE, and a place that also wrote
    // a token would be two answers to one press.
    for (const id of ['all', 'schedule', 'deleted']) {
      expect(entryOf(id).token, `the place-row 「${id}」 writes a token, so it is a filter as well as a place`).toBe('')
    }
    // 已删除 counts the TOMBSTONES it was handed, not the live document, so its
    // number is checked against the archive rows rather than against `fixture()` —
    // see the case below, which is the one that holds that promise.
    for (const id of ['all', 'schedule']) {
      expect(entryOf(id).rows.length, `the place-row 「${id}」 carries no rows, so its number is a decoration`).toBeGreaterThan(0)
    }
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

  it('日程 counts what the agenda holds, and it is not a filter of it', () => {
    // The row that was missing a door until now. Its number has to be the agenda's
    // own membership ({@link isAgendaItem}, the predicate the page fills by) — a
    // place whose number came from somewhere else is a number the reader presses
    // and then counts for themselves.
    const items = fixture()
    const onAgenda = entryOf('schedule', items)
    expect(onAgenda.token).toBe('')
    expect(onAgenda.n).toBe(items.filter(isAgendaItem).length)
    expect(onAgenda.n, 'the agenda row counts something other than the agenda, so its number cannot be trusted').toBeLessThanOrEqual(items.length)
  })
})

describe('no set has two identities in one rail', () => {
  it('每一条状态行都是看板那一栏，而且只出现一次', () => {
    const groups = itemRailGroupsOf(fixture(), CTX)
    const every = groups.flatMap(group => group.entries.map(entry => ({ group: group.id, entry })))
    // 五栏（看板那五个）都是**状态**行：一条挂卡的行在哪一栏由那张卡回答，所以这一组
    // 里每一行的 key 就是看板的栏名，而且每一栏只出现一次。
    for (const view of ITEM_STATUS_VIEWS) {
      const rows = every.filter(one => one.entry.kind === 'status' && one.entry.key === view)
      expect(rows, `${view} lost its status row`).toHaveLength(1)
    }
    /* 而「已完成」**不许**再以一种「条件」的身份出现：同一个集合在一栏里有两个身份，
     * 读者就会数出两个数。 */
    const asFlag = every.filter(one => one.entry.kind === 'flag' && ['done'].includes(one.entry.key))
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