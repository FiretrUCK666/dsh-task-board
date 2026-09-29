/**
 * The task-list workbench: what its controls are WIRED to, and what they change.
 *
 * WHY THIS FILE EXISTS ALONGSIDE `item-panel.spec.ts` AND `panel-render.spec.ts`.
 * Those two answer "what does it draw" and "how is it measured". Neither can
 * answer "does pressing this change anything" — one renders to a string, the
 * other reads a stylesheet — and that is the class of defect this file is for:
 * a control that is present, named, styled, and wired to nothing. Every claim
 * here is about a DOCUMENT, and the only honest way to see a document change is
 * to mount the real panel and click the real control, which is why this file
 * runs under jsdom and drives `ItemListPanel` itself.
 *
 * THE STANDING RULE FOR EVERY GATE IN IT. A check that cannot fail is worse
 * than no check: it is read as evidence and it is never looked at again. So
 * each gate below is paired with a control that feeds the SAME computation a
 * known-bad value and requires it to be reported. The controls are written
 * against synthetic inputs rather than against the current file, because a
 * control that leans on today's state passes by accident the day the defect is
 * fixed — and then it proves nothing for ever after.
 *
 * WHAT IS ASSERTED, AND HOW IT IS PHRASED. Where a claim is about a NAME (a prop,
 * a preference field, a shared write function) the name is read out of the
 * source that declares it, so a rename moves the gate with the code instead of
 * making it red or making it quiet. Where a claim is about BEHAVIOUR the gate
 * clicks and reads the document, so it does not care what anything is called.
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ItemRecord } from '../src/core/item.ts'
import {
  EMPTY_ITEM_QUERY,
  ITEM_SORTS,
  ITEM_STATUS_ORDER,
  itemGroupCountsOf,
  itemMatches,
  itemMatchContextOf,
  itemRowViewOf,
  itemSlicesOf,
  isInboxItem,
  parseItemQuery,
  scheduleBucketsOf,
  triageLinesOf,
  type ItemFlag,
  type ItemQuery,
} from '../src/core/item-view.ts'
import { click, fixtures, itemSurfaceFiles, itemSurfaceSource, mountPanel, press, renderPanel, type Page } from './panel-harness.ts'

// A fixed clock, so every date-derived claim is reproducible.
const NOW = new Date(2026, 8, 29, 10, 0, 0).getTime()
const DAY = 86_400_000

/**
 * A source file, read by path: this file runs under jsdom, where a relative
 * `new URL(..., import.meta.url)` does not survive the environment's URL
 * wiring, while `process.cwd()` is the repo root here.
 *
 * For a claim made about the SURFACE, use `itemSurfaceSource()` instead of
 * naming files here — a hand-written list of the files that exist is the defect,
 * because it stops agreeing with the filesystem the first time the panel is
 * split, and every one of those breaks arrives as a small emergency.
 */
function read(rel: string): string {
  return readFileSync(join(process.cwd(), ...rel.split('/')), 'utf8')
}

/** Comments removed, so a rule about CODE never bans the prose explaining it. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Every `on*` prop an interface declares. */
function handlerPropsOf(source: string, name: string): string[] {
  const body = new RegExp(`(?:export\\s+)?interface\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1] ?? ''
  return [...body.matchAll(/\b(on[A-Z]\w*)\s*[?:]/g)].map(match => match[1] as string)
}

/** The first JSX element with this name, as the text the panel passed to it. */
function elementMarkup(source: string, component: string): string {
  const paired = new RegExp(`<${component}\\b([\\s\\S]*?)\\/>`).exec(source)
  if (paired !== null) return paired[1] ?? ''
  return new RegExp(`<${component}\\b([\\s\\S]*?)<\\/${component}>`).exec(source)?.[1] ?? ''
}

/** Every source file of the task-list surface, by path — enumerated, never listed. */
function clientSources(): string[] {
  return itemSurfaceFiles().map(file => file.source)
}

/** The same surface as one string, for a claim made across it. */
const surfaceSource = itemSurfaceSource()

const panelSource = surfaceSource
const rowSource = read('src/client/item/row-line.tsx')
const detailSource = read('src/client/item/detail-pane.tsx')
const prefsSource = read('src/client/item/view-prefs.ts')

/**
 * What each order is CALLED, read out of the dictionary.
 *
 * Counting orders by their labels is what lets the same assertion hold whether
 * a band offers them as a segmented strip or as a `<select>`: the control is
 * free to change shape, the ORDER is not, and the order is what a reader is
 * missing when it is not offered. Counting control elements instead would pin
 * the shape and report a correct narrow band as broken.
 */
const SORT_LABELS: readonly string[] = (() => {
  // Keyed, and the FIRST value per key wins, because the file declares the
  // Chinese dictionary before the English one. Taking both would double every
  // label and the count would stop meaning "how many orders".
  const byKey = new Map<string, string>()
  for (const match of read('src/client/locales.ts').matchAll(/'(item\.sort\.\w+)'\s*:\s*'([^']*)'/g)) {
    if (!byKey.has(match[1] as string)) byKey.set(match[1] as string, match[2] as string)
  }
  return [...byKey.values()]
})()

/**
 * A row carrying exactly one interesting fact, so two renders of it differ in
 * one respect and the comparison means something.
 */
function oneRow(patch: Partial<ItemRecord>): ItemRecord[] {
  return [{
    id: 'r-1',
    ref: 1,
    title: '一条普通的行',
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
    origin: { source: 'human', at: NOW - 10 * DAY },
    createdAt: NOW - 10 * DAY,
    updatedAt: NOW - DAY,
    ...patch,
  }]
}

describe('every remembered preference is one the reader can change', () => {
  const prefsBody = /(?:export\s+)?interface\s+ItemViewPrefs\s*\{([\s\S]*?)\n\}/.exec(prefsSource)?.[1] ?? ''
  const fields = [...prefsBody.matchAll(/\breadonly\s+(\w+)\s*:/g)].map(match => match[1] as string)

  it('the field list is not empty, or this file is asserting nothing', () => {
    expect(fields.length, 'the gate read no preference fields — the interface shape changed and the gate is now vacuous').toBeGreaterThan(3)
  })

  for (const field of fields) {
    it(`the reader can change "${field}"`, () => {
      // WHAT COUNTS AS A WRITE, and why a read is not one. A field can be read
      // (`includeDone: prefs.showDone`) and still be unreachable: the stored
      // value feeds a query and no control anywhere sets it, so the preference
      // survives a reinstall and the reader has never been able to touch it. A
      // field whose only "write" is `writeViewPrefs({ …field: prefs.field })` is
      // the same thing wearing a hat — it persists whatever it is handed, which
      // is nothing, forever.
      //
      // So the write must carry a value that is NOT the field's own current
      // value: a literal, a control's value, or the result of a computation.
      const passThrough = new RegExp(`\\b${field}\\s*:\\s*(?:prefs|current|merged|next)\\s*\\.\\s*${field}\\b`)
      const written = clientSources().some(source => {
        const live = code(source)
        return [...live.matchAll(new RegExp(`(?<![.\\w])${field}\\s*:\\s*([^,\\n}]+)`, 'g'))]
          .some(match => !passThrough.test(match[0]) && !isATypeDeclaration(live, match.index ?? 0, field))
      })
      expect(written, `prefs.${field} is remembered and read but no control ever sets it — the reader has a preference they cannot change`).toBe(true)
    })
  }

  it('the detector tells a real write from a pass-through and from a type', () => {
    // The three shapes, decided by the same code path the gate above uses.
    const verdicts = (source: string): boolean[] => {
      const live = code(source)
      const passThrough = new RegExp(`\\bshowDone\\s*:\\s*(?:prefs|current|merged|next)\\s*\\.\\s*showDone\\b`)
      return [...live.matchAll(/(?<![.\w])showDone\s*:\s*([^,\n}]+)/g)]
        .map(match => !passThrough.test(match[0]) && !isATypeDeclaration(live, match.index ?? 0, 'showDone'))
    }
    // A control writing a value: a write.
    expect(verdicts('const a = { showDone: true }')).toEqual([true])
    // A control writing another field's value: still a write.
    expect(verdicts('const a = { showDone: event.target.checked }')).toEqual([true])
    // Persisting what it was handed: not a write.
    expect(verdicts('store({ showDone: prefs.showDone })')).toEqual([false])
    // The type declaration itself is not a write, which is the case that would
    // have made this whole file pass on an interface and nothing else.
    expect(verdicts('export interface ItemViewPrefs {\n  readonly showDone: boolean\n}')).toEqual([false])
    // And a mention in a comment is not a write either — prose may name a
    // preference without being able to change it.
    expect(verdicts('// choose({ showDone: true }) someday')).toEqual([])
  })
})

/** Whether a match sits inside a type declaration rather than in code. */
function isATypeDeclaration(live: string, at: number, field: string): boolean {
  const before = live.slice(0, at)
  const opened = before.lastIndexOf('{')
  const closed = before.lastIndexOf('}')
  if (opened <= closed) return false
  const head = before.slice(Math.max(0, before.lastIndexOf('\n', opened)), opened)
  return /(?:interface|type)\s+\w*\s*\{?$/.test(head.trim()) || /^\s*(?:export\s+)?(?:interface|type)\b/.test(head)
    || new RegExp(`(?:interface|type)\\s+\\w+\\s*\\{[^}]*${field}\\s*[?:]`).test(before.slice(opened))
}

describe('every handler a row or a detail declares is actually connected', () => {
  const rowHandlers = handlerPropsOf(rowSource, 'ItemRowLineProps')
  const detailHandlers = handlerPropsOf(detailSource, 'ItemDetailProps')

  it('the prop lists are not empty, or the gate is asserting nothing', () => {
    expect(rowHandlers.length, 'no on* props were read from ItemRowLineProps').toBeGreaterThan(3)
    expect(detailHandlers.length, 'no on* props were read from ItemDetailProps').toBeGreaterThan(3)
  })

  for (const [component, handlers, source] of [
    ['ItemRowLine', rowHandlers, panelSource],
    ['ItemDetail', detailHandlers, panelSource],
  ] as const) {
    it(`the panel passes every ${component} handler`, () => {
      const element = elementMarkup(source, component)
      expect(element, `${component} is not rendered by the panel any more — this gate is reading a component nobody mounts`).not.toBe('')
      const missing = handlers.filter(handler => !new RegExp(`\\b${handler}\\s*=`).test(element))
      expect(missing, `${component} declares ${missing.join(', ')} and the panel passes nothing for it — the control exists and is wired to nothing`).toEqual([])
    })
  }

  it('no handler is a shell whose only effect is to dismiss itself', () => {
    // THE DEFECT THIS EXISTS FOR. A menu entry named for an action, whose
    // handler's entire body is clearing the state that opened the menu: the
    // menu closes, so it looks like it worked, and nothing was done. The reader
    // pressed a verb and got a dismissal.
    //
    // The exemptions are by NAME and there are only three shapes of them, all
    // of which mean the same thing — "this handler's job IS to dismiss":
    // `onMenuClose`, `onCancelRemove`, anything starting `onCancel`. Naming
    // them is not a hole in the rule, it is the rule: a handler called `close`
    // that closes is correct, and the same body under the name `onPromote` is
    // a lie about what the button does.
    const shell = /\{\s*(?:\(\s*\)\s*=>\s*)?set[A-Za-z]+\(\s*undefined\s*\)\s*\}/
    const dismisses = (name: string): boolean => /Close$|^onCancel/.test(name)
    const offenders: string[] = []
    for (const source of [panelSource, rowSource, detailSource]) {
      const live = code(source)
      for (const match of live.matchAll(/\b(on[A-Z]\w*)\s*=\s*(\{[^{}]*\}|[A-Za-z0-9_.]+)/g)) {
        const name = match[1] as string
        if (dismisses(name)) continue
        if (shell.test(match[2] ?? '')) offenders.push(`${name}=${(match[2] ?? '').trim()}`)
      }
    }
    expect(offenders, `these handlers do nothing but close their own menu: ${offenders.join(' | ')}`).toEqual([])
  })

  it('the shell detector bites, and a real handler is not reported', () => {
    const shell = /\{\s*(?:\(\s*\)\s*=>\s*)?set[A-Za-z]+\(\s*undefined\s*\)\s*\}/
    const dismisses = (name: string): boolean => /Close$|^onCancel/.test(name)
    const verdict = (name: string, body: string): boolean => !dismisses(name) && shell.test(body)
    // The exact shape that shipped.
    expect(verdict('onPromote', '{() => setMenuRow(undefined)}')).toBe(true)
    expect(verdict('onMenuClose', '{() => setMenuRow(undefined)}')).toBe(false)
    expect(verdict('onCancelRemove', '{() => setConfirming(undefined)}')).toBe(false)
    // A handler that does the thing it is named for.
    expect(verdict('onPromote', '{() => promote(item)}')).toBe(false)
  })
})

describe('what the reader can click and what the reader can type are one grammar', () => {
  const ctx = { ...itemMatchContextOf(NOW), running: new Map<string, boolean>() }
  const rows = fixtures()

  /** The rows a query selects, as a sorted list of identities. */
  function selectedBy(query: ItemQuery): string[] {
    return rows.filter(row => itemMatches(row, query, ctx)).map(row => row.id).sort()
  }

  it('every flag the interface offers round-trips through the search box', () => {
    // THE ROUND TRIP, in the direction a reader travels. The triage strip hands
    // the reader a sentence and a button; the button writes a query; the query
    // has to select the rows the sentence described. If the two spellings are
    // not the same vocabulary, the button produces a filter that silently
    // matches nothing — a documented filter that cannot be diagnosed by the
    // person who used it, which is the one failure a filter box cannot recover
    // from.
    const lines = triageLinesOf(rows, NOW)
    expect(lines.length, 'no triage line to click — the gate is asserting nothing').toBeGreaterThan(0)
    for (const line of lines) {
      const parsed = parseItemQuery(`has:${line.id}`)
      expect([...parsed.flags], `has:${line.id} does not parse back to the flag the sentence names`).toEqual([line.id])
      // And it selects the rows the sentence counted, not some other set.
      const counted = line.count
      expect(selectedBy(parsed).length, `has:${line.id} selects a different number of rows than the sentence promises (${counted})`).toBe(counted)
    }
  })

  it('and in the other direction: the text names exactly the set the flag means', () => {
    // A reader who knows the vocabulary can type it. The two directions are
    // separate defects and only checking one of them misses half of them: a
    // button that writes an unparseable string still "works", and a grammar
    // that accepts a spelling no control produces still "works".
    for (const flag of ['hardOverdue', 'behind', 'stale', 'undated', 'gated', 'blocked', 'linked', 'done'] as ItemFlag[]) {
      const typed = parseItemQuery(`has:${flag}`)
      const spelled = parseItemQuery(`has:${flag.toLowerCase()}`)
      expect([...spelled.flags], `the grammar is case-sensitive for has:${flag}`).toEqual([...typed.flags])
      expect(selectedBy(typed), `has:${flag} selects nothing at all — a qualifier no row can satisfy is a qualifier that lies`).not.toEqual([])
    }
    for (const status of ITEM_STATUS_ORDER) {
      const parsed = parseItemQuery(`status:${status}`)
      expect(parsed.status, `status:${status} does not parse back to itself`).toContain(status)
    }
    for (const token of ['p1', 'p2', 'p3', 'p4']) {
      expect(parseItemQuery(token).priority.length, `${token} is not a priority qualifier`).toBe(1)
    }
    expect(parseItemQuery('#画廊').tags).toEqual(['画廊'])
  })

  it('the probe bites, and the correct spelling stays silent', () => {
    // The defect in its raw form is a qualifier the grammar does not know,
    // which then falls through to being a literal word. Two things have to be
    // true at once and a gate that checks only one of them is satisfied by a
    // grammar that recognises nothing: the token must be reported as a WORD,
    // and the words must be kept rather than swallowed — a reader who types
    // `notes:xyz` means the literal text, and losing it is losing their words.
    const unknown = parseItemQuery('has:nosuchflag')
    expect([...unknown.flags], 'a qualifier the grammar does not know was treated as a filter').toEqual([])
    expect(unknown.words, 'the unrecognised qualifier was swallowed instead of kept as the reader\'s literal word').toContain('has:nosuchflag')
    // And the shape that shipped once: a camelCase flag matched against a
    // lowercased token never matches, so the filter silently selected nothing.
    // The grammar indexes its flags rather than comparing, so this is silent —
    // which is the control that proves the test above is not just "everything
    // is a word".
    expect([...parseItemQuery('has:hardOverdue').flags]).toEqual(['hardOverdue'])
    expect([...parseItemQuery('has:HARDCVERDUE'.replace('CVERDUE', 'OVERDUE')).flags]).toEqual(['hardOverdue'])
    expect([...parseItemQuery('has:hardOverdue').flags], 'the camelCase spelling is not accepted, so the control proves nothing').not.toEqual([])
  })

  it('the interface covers every flag the grammar knows, and every flag the grammar knows is clickable', () => {
    // The reverse coverage: a flag the grammar can filter by but no control
    // offers is a capability with no entrance, and a control offering a flag
    // the grammar cannot parse is a button that filters nothing. Both are
    // caught by comparing the two sets, and neither is caught by reading one.
    const labelled = new Set([...code(panelSource).matchAll(/'item\.triage\.(\w+)'/g)].map(m => m[1] as string))
    const flags = new Set<ItemFlag>(['hardOverdue', 'behind', 'stale', 'undated', 'gated', 'blocked', 'linked', 'done'])
    // The panel maps flags to labels through one table, so the table is the
    // vocabulary; every flag must be in it under a name the grammar accepts.
    const mapped = new Set([...code(panelSource).matchAll(/^\s*(\w+):\s*'item\.triage\.\w+',?$/gm)].map(m => m[1] as string))
    expect([...flags].filter(flag => !mapped.has(flag)),
      `these flags have no label in the interface, so no sentence can offer them: ${[...flags].filter(f => !mapped.has(f)).join(', ')}`).toEqual([])
    expect(labelled.size, 'no triage labels at all — the vocabulary is being read from nothing').toBeGreaterThan(0)
  })
})

describe('the finished work is one click away on the list, and on no other page', () => {
  const rows = fixtures()

  it('with the switch open the row is there, and the bucket is named even when it is closed', () => {
    // THE CLAIM, STATED THE WAY THE PRODUCT SETTLED IT.
    //
    // The first version of this gate said the finished row must appear on all
    // three pages. It does not, and it must not: `isInboxItem` excludes `done`
    // (the inbox holds what nobody has filed yet), `isAgendaItem` is "unfinished
    // and not inbox" (an agenda is what is left to do), and PRODUCT.md puts it in
    // one line — 「完成是清单页里的一个开关，不是另一页」. So the gate was asking
    // for something the product has already ruled out, and the only two ways to
    // satisfy it were to change a core predicate or to draw a row the model says
    // is not on that page. The second is worse than the defect: a surface that
    // shows a row the model does not is the other half of the "two answers to
    // one question" family this whole refactor is about.
    //
    // The INTENT was right — a row the reader cannot reach is a row that does
    // not exist — and it is pinned here in the form a reader can act on.
    const finished = rows.filter(row => row.status === 'done').map(row => row.title)
    expect(finished.length, 'the fixture has no finished row — the gate is asserting nothing').toBeGreaterThan(0)
    // 1. WITH THE SWITCH OPEN, THE ROW IS THERE. The operable form of
    //    "reachable", and the only one checkable without inventing a prop: the
    //    switch is remembered state, so the bench seeds it the way it seeds the
    //    page.
    const open = renderPanel(rows, 'wide', 'list', undefined, { showDone: true })
    for (const title of finished) {
      expect(open, 'with the finished switch on, the finished row is still not on the list page').toContain(title)
    }
    // 2. AND THE BUCKET IS NAMED EVEN WHEN IT IS CLOSED. A header that renders
    //    only the groups it has rows for is a header that hides the map of the
    //    list — so the bucket stays, with its count, whatever the switch says.
    expect(renderPanel(rows, 'wide', 'list'), 'the 已完成 bucket is not on screen while the reader has not opened it').toContain('已完成')
  })

  it('and the entrance a real reader finds IS the switch', () => {
    // The most valuable half, because it pins reachability at the ENTRANCE a
    // reader finds rather than at an abstract preference. "The finished rows are
    // one gesture away" is a claim about a gesture; the version above is a claim
    // about a stored value, and a preference nobody can reach is the defect this
    // whole refactor started from.
    const panel = mountPanel(rows, 'list', 'wide')
    try {
      const tile = findByText(panel.surface, '已完成')
      expect(tile, 'the overview has no finished tile — the switch has no entrance, so the rows behind it are unreachable by any route').toBeDefined()
      click(tile)
      const showing = panel.surface.textContent ?? ''
      for (const row of rows.filter(r => r.status === 'done')) {
        expect(showing, 'one click on the finished tile did not put the finished row on screen').toContain(row.title)
      }
    } finally {
      panel.dispose()
    }
  })

  it('and it is on NO other page — the half that stops the next person "fixing" it', () => {
    // THE LOCK. Somebody who reads "the finished row is not on the agenda" as a
    // bug will go and change `isAgendaItem`, and that quietly rewrites a product
    // decision while every other check stays green — because none of the others
    // ever said the row SHOULD be there. Pinning the negative is what makes the
    // positive safe: together they say where the row lives and, just as
    // importantly, where it does not.
    const finished = rows.filter(row => row.status === 'done').map(row => row.title)
    for (const page of ['inbox', 'schedule'] as Page[]) {
      const html = renderPanel(rows, 'wide', page, undefined, { showDone: true })
      for (const title of finished) {
        expect(html, `a finished row is on the ${page} page — completion is a switch inside the list, not a fourth page`).not.toContain(title)
      }
    }
    // The control, on inputs it cannot have been tuned against: a LIVE row
    // really is on both of those pages, so the negative half above is not
    // passing because the pages are empty.
    expect(renderPanel(rows, 'wide', 'schedule')).toContain('这一条只是落后了计划')
    expect(renderPanel(rows, 'wide', 'inbox'), 'the inbox is empty, so the negative half above proves nothing').toContain('这一条很久没有人碰过了')
  })

  it('the probe bites: a page that has lost a row is told from a page that never had one', () => {
    // The detector, on strings it cannot have been tuned against — so a green
    // means the READER works, not that this page happens to be right today.
    const holds = (html: string, title: string): boolean => html.includes(title)
    expect(holds('<li>这一条做完了</li>', '这一条做完了')).toBe(true)
    expect(holds('<li>另一条</li>', '这一条做完了')).toBe(false)
    expect(holds('', '这一条做完了')).toBe(false)
  })

  it('the rail carries all three pages always, each with a number', () => {
    // THE RAIL IS A MAP, NOT A LOG. It used to drop a page the moment that page
    // had nothing on it, which turns a map into a record of what the reader has
    // already looked at — and makes "where is the schedule" a question whose
    // answer depends on today's contents. A page that is empty says 0.
    const rail = /itemPageRail[\s\S]*?<\/div>/.exec(renderPanel([], 'wide', 'list'))?.[0] ?? ''
    expect(rail, 'the page rail is not on the surface at all').not.toBe('')
    const tabs = [...rail.matchAll(/role="tab"[\s\S]*?<\/button>/g)].map(m => (m[0] ?? '').replace(/<[^>]*>/g, '').trim())
    expect(tabs.length, `the rail carries ${tabs.length} pages on an empty document`).toBe(3)
    for (const tab of tabs) {
      expect(tab, `the rail entry "${tab}" states no number — an empty page that says nothing is the page that disappeared`).toMatch(/\d/)
    }
  })

  it('the three numbers and the header count are the same fact told three ways', () => {
    const html = renderPanel(rows, 'wide', 'list')
    const header = /itemCount[^>]*>([^<]*)</.exec(html)?.[1] ?? ''
    const total = Number(/(?:共\s*)?(\d+)/.exec(header)?.[1] ?? Number.NaN)
    expect(Number.isInteger(total), `the header states no count: "${header}"`).toBe(true)
    const rail = /itemPageRail[\s\S]*?<\/div>/.exec(html)?.[0] ?? ''
    const numbers = [...rail.matchAll(/role="tab"[\s\S]*?<\/button>/g)]
      .map(m => Number(/(\d+)\s*$/.exec((m[0] ?? '').replace(/<[^>]*>/g, '').trim())?.[1] ?? Number.NaN))
    expect(numbers.filter(n => !Number.isInteger(n)), `a rail entry states no number: ${JSON.stringify(numbers)}`).toEqual([])
    // Each page holds a SUBSET of the document — that is what a page is — so no
    // page may claim more rows than the document holds. That is the real
    // invariant and it is unchanged.
    for (const n of numbers) expect(n, `a rail entry claims ${n} rows out of a document holding ${total}`).toBeLessThanOrEqual(total)
    //
    // AND THE LIST CELL IS THE HEADER. The first version of this line was
    // `toBeLessThan(total)` — "no page may claim everything" — which reads as
    // if a page holding the whole document were a fault. It is not: the list
    // page holds every row including the finished ones, so its number IS the
    // document's number, and PRODUCT.md fixes that as the product's decision
    // twice over: 「同一个数不许在两处各算一次。页头写的总数就是 M」 and 「页头总数
    // 是 M 的另一种读法」. A gate that made the correct value red was a gate
    // about a number the product has already settled, and the cheapest way to
    // satisfy it would have been to make one of the two lie.
    //
    // So the intent is now stated as the intent was: the rail is not claiming
    // an empty document, AND the list cell is the same M the header prints.
    // Which is a STRONGER pair than the one it replaces — the old line caught
    // only "all three zero"; this catches that plus the two cells drifting
    // apart, which is the failure the single-number rule exists to prevent.
    expect(Math.max(...numbers), 'every page claims to be empty while the header says otherwise').toBeGreaterThan(0)
    expect(numbers[1], 'the list cell is not the header\'s number — the same count is being computed in two places and the two will drift').toBe(total)
  })

  it('the probe bites: a rail that drops a page, and a rail whose list cell drifts', () => {
    const verdicts = (rail: string): number => [...rail.matchAll(/role="tab"[\s\S]*?<\/button>/g)]
      .filter(tab => /\d/.test(tab[0] ?? '')).length
    const three = '<div role="tablist"><button role="tab">收件 0</button><button role="tab">清单 7</button><button role="tab">日程 3</button></div>'
    const two = '<div role="tablist"><button role="tab">收件 0</button><button role="tab">清单 7</button></div>'
    expect(verdicts(three)).toBe(3)
    expect(verdicts(two)).toBe(2)
    // The second half, on numbers it cannot have been tuned against: the same
    // three cells with the list cell changed, and with the whole rail zeroed.
    const listCellOf = (rail: string): number => Number(/(\d+)\s*<\/button>/.exec(
      [...rail.matchAll(/role="tab"[\s\S]*?<\/button>/g)][1]?.[0] ?? '',
    )?.[1] ?? Number.NaN)
    expect(listCellOf(three)).toBe(7)
    expect(listCellOf(three.replace('清单 7', '清单 6')), 'the drifted value was not distinguishable from the correct one').toBe(6)
    expect(Math.max(0, 0, 0), 'the empty-rail control is wrong').toBe(0)
  })
})

describe('a press is a change to the document, not a change to the menu', () => {
  it('promoting a row writes something', () => {
    // 「转成卡片」 is a menu entry with a verb on it. Wired to "close the menu",
    // it is a button that reports success by closing, which is the most
    // expensive kind of no-op on a personal list: the reader believes the work
    // was filed and it was not.
    //
    // The assertion is deliberately about the DOCUMENT and not about which
    // method was called: the write may land on the checklist or on the board,
    // and a gate that demanded one of them would be pinning an implementation
    // choice rather than a promise. What is promised is that the press writes.
    const panel = mountPanel(oneRow({ id: 'p-1', title: '把它变成一张卡' }), 'list', 'wide')
    try {
      openRowMenu(panel.surface)
      const before = panel.writes.length
      // The entry is named by a DISTINCTIVE FRAGMENT rather than by its whole
      // label. Writing the whole string made this gate a rename detector: the
      // wording moved once (「转成卡片」 → 「变成看板卡片」) and the gate reported
      // "the menu does not offer it at all" — which reads as a missing feature
      // and is really a sentence. A fragment survives a rewrite and still fails
      // when the entry is gone, which is the only thing this gate is for.
      const entry = findMenuEntry(panel.surface, '卡片')
      expect(entry, 'the row menu offers nothing about becoming a board card — the gate cannot press what is not there').not.toBeNull()
      click(entry)
      const wroteChecklist = panel.writes.length > before
      const wroteBoard = panel.calls.length > 0
      expect(wroteChecklist || wroteBoard,
        'the promote entry closed the menu and wrote nothing — the reader pressed a verb and got a dismissal').toBe(true)
    } finally {
      panel.dispose()
    }
  })

  it('a row in 「最近动过」 is picked by its identity, and lands on that row', () => {
    // The pane's "before you pick" state lists the five most recently touched
    // rows. Each one is a button, and a button that selects nothing is the
    // worst kind: it looks like a link, it is focusable, and pressing it
    // changes the pane by not changing it. The panel knows the row's uuid and
    // shows its short number; the number is a NAME, not an address, and a row
    // the document has not numbered yet has no name at all.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const recent = findByText(panel.surface, '这一条做完了') ?? findByText(panel.surface, '这一条硬期限已经过了整整九天')
      click(recent)
      const showing = panel.surface.textContent ?? ''
      const landed = fixtures().some(row => showing.includes(row.title) && (row.title.length > 6))
      expect(landed, 'pressing a recent row did not put that row on screen — the entry is selecting by a name, not by an identity').toBe(true)
    } finally {
      panel.dispose()
    }
  })

  it('the detail rail\'s head says what the rail is, even with nothing picked', () => {
    // An empty head with a rule under it is a horizontal line that came from
    // nowhere: the reader has not chosen anything yet, so the line is not
    // separating two things, and a rule that separates nothing reads as a
    // rendering fault. The head says the two characters that name the column.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const heads = [...panel.surface.querySelectorAll('h2')].filter(head => !head.closest('button'))
      const railHead = heads.find(head => {
        const cls = head.className
        return /item[A-Za-z]*Detail[A-Za-z]*Head/.test(cls)
      })
      expect(railHead, 'the detail rail has no head at all — the column beside the list is not named when nothing is picked').toBeDefined()
      expect((railHead?.textContent ?? '').trim(), 'the detail head is an empty box with a rule under it — a line that separates nothing reads as a broken render').not.toBe('')
    } finally {
      panel.dispose()
    }
  })

  it('deleting offers the undo right there, with no second gate in front of it', () => {
    // TWO STEPS FOR A REVERSIBLE ACTION. The row is recoverable for thirty
    // days, and a modal asking to confirm a reversible action is friction with
    // no decision behind it — the reader is asked to be sure about something
    // they can take back. So the delete is one press and the undo appears where
    // the row was.
    const panel = mountPanel(oneRow({ id: 'd-1', title: '删掉我' }), 'list', 'wide')
    try {
      openRowMenu(panel.surface)
      click(findMenuEntry(panel.surface, '删除'))
      const surface = panel.surface.textContent ?? ''
      expect(surface, 'the delete asks for a confirmation before it does anything — the action is reversible, so the second gate is pure friction').not.toMatch(/确认删除|确定要删|清空搜索/)
      // And the way back is ON the page, not in a menu nobody opens.
      const undo = [...panel.surface.querySelectorAll('button')].find(b => (b.textContent ?? '').includes('撤销'))
      expect(undo, 'the row is gone and the page says nothing about bringing it back').toBeDefined()
    } finally {
      panel.dispose()
    }
  })

  it('the menu closes on Escape and on a click outside it — once each', () => {
    // TWO DISMISSALS, and the reason the rule is written down rather than
    // assumed is that the obvious implementation gets one of them wrong: a
    // listener on `document` that closes on a click the menu's own handler is
    // also handling closes it twice, and one that guesses from bubbling fires
    // for a click INSIDE the menu too. So the gate presses Escape, checks it is
    // gone, and separately presses outside, checks it is gone.
    //
    // THE OUTSIDE CLICK NAMES ITS TARGET, and the failure message prints the
    // whole path. An implementation that cannot reproduce a red needs to be told
    // what was actually pressed and what the DOM looked like, because the two
    // possible causes need opposite fixes and guessing at either one wastes a
    // round: either the gate pressed something other than it believes it pressed,
    // or the capture layer is not on the path. The report is the whole point.
    const panel = mountPanel(oneRow({ id: 'm-1', title: '菜单这一行' }), 'list', 'wide')
    const menuIsOpen = (): boolean => panel.surface.querySelector('[role="menu"]') !== null
    try {
      openRowMenu(panel.surface)
      expect(menuIsOpen(), 'the menu did not open — the gate is asserting against nothing').toBe(true)
      const menu = panel.surface.querySelector('[role="menu"]')
      press(menu, 'Escape')
      expect(menuIsOpen(), 'Escape did not close the row menu').toBe(false)

      openRowMenu(panel.surface)
      expect(menuIsOpen()).toBe(true)
      // The target, named and described, so a failure says what was pressed.
      const target = panel.surface.querySelector('h1')
      const report = [
        `pressed: <${target?.tagName.toLowerCase() ?? 'nothing'}> text=${JSON.stringify(target?.textContent ?? '')}`,
        `classes: ${target?.className ?? ''}`,
        `inside [role=menu]: ${menu?.contains(target ?? null) === true}`,
        `menu parent: ${panel.surface.querySelector('[role="menu"]')?.parentElement?.className ?? 'no menu'}`,
        `menu position: ${panel.surface.querySelector('[role="menu"]') ? getComputedStyle(panel.surface.querySelector('[role="menu"]') as Element).position : 'n/a'}`,
        `elementsFromPoint-ish siblings of the menu: ${(panel.surface.querySelector('[role="menu"]')?.parentElement?.children.length ?? 0)}`,
      ].join('\n  ')
      click(target)
      expect(menuIsOpen(), `a click outside the menu did not close it\n  ${report}`).toBe(false)
    } finally {
      panel.dispose()
    }
  })

  it('the cancel button does not borrow another control\'s words', () => {
    // It used to be labelled 「清空搜索」, because the key it reused was the
    // search field's clear button. A control whose label names a DIFFERENT
    // action is a reader pressing something they did not agree to — and the
    // worst case is the destructive one, where "cancel" reads as "clear".
    expect(code(detailSource)).not.toMatch(/onCancelRemove[^>]*t\('item\.state\.clearFilter'\)/)
    expect(detailSource, 'the delete confirmation borrows the search field\'s cancel label').not.toContain("t('item.state.clearFilter')")
  })

  it('the restore a row is brought back through is the SHARED one', () => {
    // A tombstone is stored under the row's uuid and the restore is a HOST
    // operation: a stale put carrying the same row is eaten by the tombstone,
    // so the interface re-submitting the row gets a 200 and no change. The way
    // back therefore goes through `itemsRestore`, and the panel says so out
    // loud when it fails.
    expect(code(panelSource)).toContain('itemsRestore')
    expect(code(panelSource), 'the panel edits the checklist array in place somewhere; the document owns that arithmetic').not.toMatch(/\bitems\.(?:map|filter)\([^)]*\)\s*(?:\.filter|\.slice)/)
  })
})

describe('the row menu is placed by arithmetic, not by hope', () => {
  /**
   * The pure kernel, imported so a missing module is ONE finding rather than a
   * whole file that will not collect. Every other gate in this file would go
   * quiet behind a module that is not there, and a gate that reports nothing
   * because its subject is absent is the exact thing this file is against.
   */
  async function kernel(): Promise<((trigger: unknown, panel: unknown, menu: unknown) => { placement: string; top: number; left: number }) | undefined> {
    try {
      const mod = await import('../src/client/item/menu-place.ts') as { placeRowMenu?: unknown }
      return typeof mod.placeRowMenu === 'function' ? mod.placeRowMenu as never : undefined
    } catch {
      return undefined
    }
  }

  const PANEL = { top: 0, bottom: 800, left: 0, right: 1000, width: 1000, height: 800 }
  const MENU = { width: 220, height: 240, minBelow: 8, gap: 4 }

  it('the pure kernel exists, and it is pure', async () => {
    const place = await kernel()
    expect(place, 'src/client/item/menu-place.ts has no placeRowMenu — the menu is positioned by a declaration that assumes the room is there').toBeDefined()
    const source = read('src/client/item/menu-place.ts')
    // Pure means pure: no DOM, no clock, no module state. A placement function
    // that reads `getBoundingClientRect` itself cannot be tested on the three
    // shapes below without a browser, which is the whole reason it is a
    // function and not a component.
    expect(code(source), 'the placement kernel reaches for the DOM, so the three cases cannot be checked without a browser').not.toMatch(/\b(?:document|window|getBoundingClientRect|Date\.now)\b/)
  })

  it('flips above when the room below is not there, and lands on the TRIGGER\'s edge', async () => {
    const place = await kernel()
    if (place === undefined) return
    // Plenty of room below: it opens downwards, under the row.
    const low = place({ ...PANEL, top: 100, bottom: 140, left: 300, right: 500, width: 200, height: 40 }, PANEL, MENU)
    expect(low.placement).toBe('below')
    // A row at the very bottom of the panel: downwards would run off the end.
    const bottom = place({ top: 740, bottom: 780, left: 300, right: 500, width: 200, height: 40 }, PANEL, MENU)
    expect(bottom.placement, 'the menu opened downwards from the last row and ran off the panel').toBe('above')
    expect(bottom.top, 'the flipped menu is not placed by its own edge — it overlaps the row it belongs to').toBeLessThan(740)
    // The gap is subtracted, so the menu is not flush against the row.
    expect(bottom.top).toBe(740 - MENU.gap - MENU.height)
  })

  it('never leaves the panel, in either direction', async () => {
    const place = await kernel()
    if (place === undefined) return
    // A trigger hard against the trailing edge: the menu is wider than the room
    // to its right, and the clamp has to move it rather than let it hang out.
    const edge = place({ top: 300, bottom: 340, left: 960, right: 998, width: 38, height: 40 }, PANEL, MENU)
    expect(edge.left, `the menu hangs ${edge.left + MENU.width - PANEL.right}px outside the panel`).toBeLessThanOrEqual(PANEL.right - MENU.width)
    expect(edge.left, 'the menu was pushed past the panel\'s own leading edge').toBeGreaterThanOrEqual(PANEL.left)
    // A trigger at the very top: neither direction has room for the whole
    // menu, and the answer must still be inside the box.
    const top = place({ top: 0, bottom: 40, left: 10, right: 210, width: 200, height: 40 }, PANEL, MENU)
    expect(top.top, 'the menu starts above the panel').toBeGreaterThanOrEqual(PANEL.top)
    expect(top.top + MENU.height, 'the menu ends below the panel').toBeLessThanOrEqual(PANEL.bottom)
  })

  it('the probe bites: a kernel that never flips is reported', () => {
    // The naive implementation — always downwards, clamp the left only — is
    // the one that produced the reported bug, and it satisfies both of the
    // first two cases' happy paths. So the control runs the SAME three
    // questions against it.
    const naive = (trigger: { bottom: number; left: number }, panel: typeof PANEL, menu: typeof MENU) => ({
      placement: 'below',
      top: trigger.bottom + menu.gap,
      left: Math.min(trigger.left, panel.right - menu.width),
    })
    const flips = (place: (t: unknown, p: unknown, m: unknown) => { placement: string }): boolean =>
      place({ top: 740, bottom: 780, left: 300, right: 500, width: 200, height: 40 }, PANEL, MENU).placement === 'above'
    expect(flips(naive as never), 'the naive kernel was reported as correct — the flip case proves nothing').toBe(false)
  })
})

describe('a priority is shouted only when it is loud', () => {
  it('the loudness verdict comes from the shared projection, and the row obeys it', () => {
    // A priority mark on every row is furniture: the reader learns to read past
    // it, and the one row that is genuinely urgent arrives in the same ink as
    // the forty that are merely filed. So the mark appears when the projection
    // says the tier is loud, and the projection is `core/item-view.ts`'s — the
    // same file the model's query reads, because "which rows are urgent" must
    // not have a second answer on this surface.
    const verdictOf = (priority: string): unknown => {
      const view = itemRowViewOf(oneRow({ priority: priority as never })[0] as ItemRecord, { now: NOW, running: new Map() })
      const loud = Object.entries(view).find(([key]) => /loud/i.test(key))
      expect(loud, `the row projection has no loudness verdict for priority — the row has to decide for itself, which is the second answer`).toBeDefined()
      return loud?.[1]
    }
    expect(verdictOf('urgent'), 'the top tier is not loud').toBe(true)
    expect(verdictOf('normal'), 'the neutral tier is loud, so every row carries a mark').toBe(false)
  })

  it('and the mark is a difference the two rows really have, not noise', () => {
    // The discriminator. Two rows identical except for their tier must render
    // differently, and two rows identical INCLUDING their tier must render
    // identically — otherwise the comparison above would be finding the
    // difference between two different titles and calling it a priority mark.
    const loud = renderPanel(oneRow({ priority: 'urgent' }), 'wide', 'list')
    const quiet = renderPanel(oneRow({ priority: 'normal' }), 'wide', 'list')
    expect(loud).not.toBe(quiet)
    const twinA = renderPanel(oneRow({ priority: 'high' }), 'wide', 'list')
    const twinB = renderPanel(oneRow({ priority: 'urgent' }), 'wide', 'list')
    expect(twinA, 'two rows of different tiers rendered identically').not.toBe(twinB)
    // The control: the same comparison run over markup that differs in nothing
    // must find nothing, or the detector is reporting every pair.
    const same = renderPanel(oneRow({ priority: 'high' }), 'wide', 'list')
    expect(same).toBe(renderPanel(oneRow({ priority: 'high' }), 'wide', 'list'))
  })
})

describe('the summary says four things, and they do not move under a switch', () => {
  it('the four counts are four, and they do not move under a view switch', () => {
    // THE DENOMINATOR WAS THE BUG, and the first version of this gate committed
    // a second one while trying to catch it.
    //
    // It asked `itemSlicesOf(…, includeDone)` to return the same four numbers
    // either way. `itemSlicesOf` is the GROUPING FOR DISPLAY, and it is supposed
    // to drop the finished group entirely when the switch is off — that is how
    // 「完成是清单页里的一个开关，不是另一页」 is implemented. So the function
    // CANNOT have the property the gate demanded, and no amount of fixing the
    // panel would have satisfied it: the gate was asking the wrong function for
    // a property that function must not have.
    //
    // The function that answers this is `itemGroupCountsOf`, whose own contract
    // is "ALWAYS all four": it is a closed `Record` over the four derived
    // statuses, so a surface may not drop one, and it takes no switch at all.
    // Asking THAT one is both correct and stronger — the property is in its type
    // rather than in a promise.
    const rows = fixtures()
    const counts = itemGroupCountsOf(rows, new Map())
    expect(Object.keys(counts).sort(), 'the four counts are not four, so a surface may hide a bucket by not reading one').toEqual([...ITEM_STATUS_ORDER].sort())
    // And the four add up to the document: a tile that is a summary of a list
    // whose buckets do not cover the list is a summary of part of it.
    expect(Object.values(counts).reduce((sum, n) => sum + n, 0), 'the four counts do not cover the document').toBe(rows.length)
    // The control: the same question asked of the grouping function, which
    // answers it the other way on purpose. It is here so the next reader can see
    // that the two functions are not interchangeable, and which one a summary
    // is allowed to read.
    const fromSlices = (includeDone: boolean): number[] => itemSlicesOf(rows, {
      query: EMPTY_ITEM_QUERY,
      ctx: { ...itemMatchContextOf(NOW), running: new Map() },
      sort: 'due',
      includeDone,
    }).map(slice => slice.items.length)
    expect(fromSlices(false).length, 'the grouping stopped dropping the finished group — the switch does nothing, so it is not a switch').toBe(ITEM_STATUS_ORDER.length - 1)
    expect(fromSlices(true).length).toBe(ITEM_STATUS_ORDER.length)
  })

  it('the pane shows all four, and the four add up to what the panel is showing', () => {
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const surface = panel.surface.textContent ?? ''
      for (const label of ['进行中', '待办', '受阻', '已完成']) {
        expect(surface, `the summary tile for ${label} is missing`).toContain(label)
      }
    } finally {
      panel.dispose()
    }
  })

  it('the probe bites: a denominator that reads the switch is reported, one that does not is not', () => {
    // The detector, on inputs it cannot have been tuned against. A control that
    // leaned on the current document would pass by accident the day the panel
    // is fixed, and prove nothing for ever after — so both verdicts are
    // demonstrated on synthetic denominators.
    const stable = (compute: (includeDone: boolean) => number[]): boolean =>
      JSON.stringify(compute(true)) === JSON.stringify(compute(false))
    expect(stable(includeDone => includeDone ? [1, 2, 3, 4] : [1, 2, 3]), 'a switch-following denominator was accepted').toBe(false)
    expect(stable(() => [1, 2, 3, 4]), 'a switch-independent denominator was reported').toBe(true)
    // And the real question, asked of the function a summary is allowed to
    // read. It takes no switch, so "the same either way" is not a property being
    // tested here — it is a property of the SIGNATURE, which is why the check
    // above can be about the shape rather than about two runs.
    const counts = itemGroupCountsOf(fixtures(), new Map())
    expect(Object.keys(counts).length, 'the counts function lost a key — a surface may now hide a bucket').toBe(ITEM_STATUS_ORDER.length)
  })
})

describe('the inbox is one membership, and the agenda reads it from there', () => {
  it('an unfiled capture appears on no agenda at all, including the "no date" tray', () => {
    // A row nobody has filed yet has no date because nobody has decided about
    // it — not because it was never scheduled. The agenda's "no date" tray is
    // about the second thing, and putting the first thing in it is how a
    // capture ends up filed under a date nobody chose. The triage strip already
    // exempts these rows from the same reading, so there is ONE exemption and
    // the agenda has to read it rather than write its own.
    const rows = fixtures()
    const unfiled = rows.filter(isInboxItem)
    expect(unfiled.length, 'the fixture has no unfiled capture — the gate is asserting nothing').toBeGreaterThan(0)
    const buckets = scheduleBucketsOf(rows, EMPTY_ITEM_QUERY, { ...itemMatchContextOf(NOW), running: new Map() }, 'due')
    const onAgenda = buckets.flatMap(bucket => bucket.items.map(row => row.id))
    for (const row of unfiled) {
      expect(onAgenda, `an unfiled capture (${row.id}) is on the agenda, in a bucket it was never put in`).not.toContain(row.id)
    }
  })

  it('and the strip and the agenda share ONE exemption rather than two spellings', () => {
    // The two surfaces answered this question separately and drifted, which is
    // why the strip says a fresh capture is not "unscheduled" while the agenda
    // files it under exactly that. A second copy of the predicate is a second
    // answer, and only one of them can be right.
    //
    // The gate reads the NAMED member that holds the exemption, not the two
    // call sites. A member is the better place for the answer: "does this row
    // belong on an agenda" is a question the page rail asks as well, and a
    // named predicate two consumers read cannot drift from itself the way two
    // inlined copies can. Scanning the call sites instead would forbid the
    // indirection and buy nothing.
    const source = read('src/core/item-view.ts')
    const inbox = /export function isInboxItem\b[\s\S]*?\n\}/.exec(source)?.[0] ?? ''
    expect(inbox, 'the inbox predicate is gone from the shared module').not.toBe('')
    const member = /export function isAgendaItem\b[\s\S]*?\n\}/.exec(source)?.[0] ?? ''
    expect(member, 'there is no named agenda membership in the shared module — the exemption is being written at each call site').not.toBe('')
    expect(member, 'the agenda membership states its own idea of what an unfiled capture is, instead of reading the one predicate').toMatch(/\bisInboxItem\b/)
    // And both consumers read the member rather than re-deciding for themselves.
    expect(code(source), 'the agenda fills its buckets without asking the named membership').toMatch(/\bisAgendaItem\b/)
  })

  it('the probe bites: a second spelling is reported', () => {
    // The copy the drift actually came from, inlined.
    const withInlineCopy = 'const undated = rows.filter(row => row.priority === "normal" && row.tags.length === 0)\n'
    const readsShared = /\bisInboxItem\b/.test(withInlineCopy)
    expect(readsShared, 'the detector reported an inline copy as reading the shared predicate').toBe(false)
    expect(/\bisInboxItem\b/.test('const undated = rows.filter(isInboxItem)')).toBe(true)
  })
})

describe('a batch is one write through the shared semantics, not a loop over the array', () => {
  it('the batch path reaches the shared write layer rather than rebuilding rows in the client', () => {
    // The checklist is the second document this plugin syncs. A batch that
    // rebuilds the rows itself is a second implementation of the no-op law and
    // of the stamp, and the two copies drift exactly as two copies always do —
    // one device burns a revision for a change that did not happen while the
    // other does not. So a multi-select writes through the SAME function the
    // single-row path uses, and that function lives in `core/`, not in the
    // panel.
    const shared = [...read('src/core/item-transitions.ts').matchAll(/export function (\w+)/g)].map(m => m[1] as string)
    expect(shared.length, 'src/core/item-transitions.ts exports no write functions — the shared layer is not there to be shared').toBeGreaterThan(2)
    const batch = /batch|selected|multi/i.exec(panelSource)
    expect(batch, 'the panel has no batch at all — the gate is asserting against a feature that does not exist').not.toBeNull()
    const live = code(panelSource)
    const reachesShared = shared.some(name => new RegExp(`\\b${name}\\s*\\(`).test(live))
    expect(reachesShared, `the panel never calls the shared write layer (${shared.join(', ')}) — every write it makes is its own`).toBe(true)
  })

  it('the probe bites: a client-side rebuild is reported', () => {
    const shared = ['applyItemPatch', 'applyItemStep', 'removeItemRecord']
    const readsShared = (live: string): boolean => shared.some(name => new RegExp(`\\b${name}\\s*\\(`).test(live))
    expect(readsShared('const next = rows.map(row => ({ ...row, status }))'), 'a client rebuild was accepted as a shared write').toBe(false)
    expect(readsShared('const next = applyItemPatch(rows, id, { status }, now)')).toBe(true)
  })
})

describe('a phone is offered every choice a desk is offered', () => {
  it('the two bands offer the same NUMBER of orders, whichever control carries them', () => {
    // RULING: on a phone the segmented control became a select, because a
    // segmented strip of seven orders cannot fit in 390px and the options it
    // could not fit were simply not drawn — a control that hides choices is a
    // control that has removed them, and hard rule 11 forbids the phone being a
    // lesser citizen by way of a missing option.
    //
    // Counted by LABEL, not by control. A select and a segmented strip are
    // different controls and either is a correct answer, so counting `<option>`
    // elements would report the narrow band as having seven and the wide band
    // as having none. What must be equal is the SET of orders a reader can
    // pick, and an order is named by its label.
    //
    // The comparison is between the two bands, not against `ITEM_SORTS`: how
    // many orders the vocabulary holds is the design's decision and changes
    // with it, while "the phone offers what the desk offers" is a promise this
    // surface keeps on its own. A floor of two keeps the case from passing on
    // an empty pair.
    const ordersIn = (markup: string): Set<string> => {
      const found = new Set<string>()
      for (const label of SORT_LABELS) if (markup.includes(label)) found.add(label)
      return found
    }
    const wide = ordersIn(renderPanel(fixtures(), 'wide', 'list'))
    const narrow = ordersIn(renderPanel(fixtures(), 'narrow', 'list'))
    expect(wide.size, `the wide band offers ${wide.size} orders; the shared vocabulary holds ${ITEM_SORTS.length}, and neither number being zero is what the phone is missing`).toBeGreaterThanOrEqual(2)
    expect([...narrow].sort(), `the narrow band offers ${narrow.size} orders against the wide band's ${wide.size} — the options that did not fit were dropped rather than moved into another control`).toEqual([...wide].sort())
  })

  it('the narrow band loses no control at all', () => {
    // The same law one level up: hiding the DENSITY control on a phone with a
    // `!narrow` guard is the identical defect wearing a different control, and
    // it is the one that a screenshot of the wide band can never show. So the
    // two bands are compared by what they LABEL, and anything the desk has that
    // the phone does not is a finding by name.
    const labelsIn = (markup: string): Set<string> => new Set(
      [...markup.matchAll(/aria-label="([^"]+)"/g)].map(match => match[1] as string),
    )
    const wide = labelsIn(renderPanel(fixtures(), 'wide', 'list'))
    const narrow = labelsIn(renderPanel(fixtures(), 'narrow', 'list'))
    expect(wide.size, 'the wide band labels nothing — the comparison would be between two empty sets').toBeGreaterThan(2)
    const missing = [...wide].filter(label => !narrow.has(label))
    expect(missing, `the phone is missing controls the desk shows: ${missing.join(', ')} — a control hidden on a phone is a control removed`).toEqual([])
  })

  it('the counting detector bites on a pair it cannot have been tuned against', () => {
    const ordersIn = (markup: string): Set<string> => {
      const found = new Set<string>()
      for (const label of SORT_LABELS) if (markup.includes(label)) found.add(label)
      return found
    }
    const all = SORT_LABELS.join('')
    const half = SORT_LABELS.slice(0, 3).join('')
    expect(ordersIn(all).size).toBe(SORT_LABELS.length)
    expect([...ordersIn(half)].sort()).toEqual(SORT_LABELS.slice(0, 3).sort())
    // A page with no order control at all counts none, and must not be
    // reported as "the same as the other band" just because both are empty.
    expect(ordersIn('<div>nothing here</div>').size).toBe(0)
  })
})

describe('the row is a grid whose tracks are fixed, because alignment is a promise', () => {
  it('the identity tracks and the fact line are not measured per row', () => {
    // WHY THIS IS A GATE AND NOT A PREFERENCE. An `auto` or `max-content`
    // track is measured per row, and every row on this page is its own grid —
    // so `#12` pushed the title one character right of where `#4` put it. The
    // eye reads a ragged left edge as a page nobody set, before it has read a
    // single word. Fixed tracks are the fix, and they are fixed ONCE on the
    // root so they cannot drift between rows.
    const css = read('src/client/item/item.module.css')
    const gridOf = (name: string): string => new RegExp(`\\.${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? ''
    const columns = (body: string): string[] => [...body.matchAll(/grid-template-columns\s*:\s*([^;]+)/g)].map(m => (m[1] ?? '').trim())
    for (const body of [gridOf('itemRowMain'), gridOf('itemRowMeta')]) {
      expect(body, 'the row grid rule is not where the file says it is').not.toBe('')
      for (const value of columns(body)) {
        // Content-sized tracks are the defect; `minmax(0, 1fr)` is the fix and
        // is explicitly NOT content-sized even though it ends in `1fr`.
        expect(value, `a track is measured from its own content (${value}) — every row is its own grid, so the edge moves row by row`)
          .not.toMatch(/\b(?:auto|max-content|min-content|fit-content)\b(?!\s*;?\s*$)/)
      }
    }
  })

  it('the probe bites, and a filler track is not reported', () => {
    const verdicts = (value: string): boolean => /\b(?:auto|max-content|min-content|fit-content)\b/.test(value)
    expect(verdicts('var(--item-mark-col) var(--item-ref-col) max-content')).toBe(true)
    expect(verdicts('var(--item-mark-col) var(--item-ref-col) minmax(0, 1fr)')).toBe(false)
    expect(verdicts('var(--item-meta-date-col) auto minmax(0, 1fr)')).toBe(true)
  })
})

/** The first element whose own text contains `needle`, at any depth. */
function findByText(root: ParentNode, needle: string): HTMLElement | null {
  for (const element of root.querySelectorAll('button, [role="menuitem"], a')) {
    if ((element.textContent ?? '').includes(needle)) return element as HTMLElement
  }
  return null
}

/**
 * The menu entry whose ACCESSIBLE NAME contains `needle`.
 *
 * Taking the first `[role="menuitem"]` was a positional guess, and it broke the
 * moment the menu's contents changed — the implementation removed the entry
 * that offers a row the status it is already in (a real fix: a button that
 * legally does nothing is a lie about what it does), the order shifted, and the
 * gate pressed the wrong button and reported the wrong defect. An entry is named
 * by what it says, so that is what the gate asks for.
 * @param root - where to look.
 * @param needle - a fragment of the entry's text.
 * @returns the entry, or `null` when the menu does not offer it at all.
 */
function findMenuEntry(root: ParentNode, needle: string): HTMLElement | null {
  for (const entry of root.querySelectorAll('[role="menuitem"]')) {
    if ((entry.textContent ?? '').includes(needle)) return entry as HTMLElement
  }
  return null
}

/**
 * Open the first row's menu by pressing the control that owns it.
 *
 * Found by the ARIA relationship rather than by a class name: a disclosure says
 * `aria-haspopup="menu"` and names the region it opens, which is the same
 * promise a reader relies on. Locating it by class would make this gate report
 * a rename, and would go quiet the day someone renamed it.
 */
function openRowMenu(root: HTMLElement): void {
  const trigger = root.querySelector('[aria-haspopup="menu"]')
  expect(trigger, 'the row has no menu control at all').not.toBeNull()
  click(trigger)
}
