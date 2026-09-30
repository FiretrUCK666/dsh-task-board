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
import { act } from 'react'
import type { ItemRecord } from '../src/core/item.ts'
import { freeTextOf, queryChipsOf, tagFacetValuesOf, withFacetToken } from '../src/client/item/facets.ts'
import { ITEM_KEYS, bindingFor, claimsKey, dispatchKey, type ItemKeyAction, type ItemKeyActions } from '../src/client/item/keyboard.ts'

/** The action names the registrar can call, read off the closed action union. */
const knownActions: ReadonlySet<string> = new Set<ItemKeyAction>([
  'quickCapture', 'moveNext', 'movePrev', 'pick', 'rename', 'open',
  'close', 'priority', 'dueToday', 'remove', 'undo', 'palette',
])

/** A handler set that records what it was asked to do, for the reader cases. */
function recordOfActions(sink: (action: string) => void): ItemKeyActions {
  const call = (): void => undefined
  const record = (action: string) => (): void => { sink(action) }
  return {
    quickCapture: record('quickCapture'),
    moveNext: call, movePrev: call, pick: record('pick'), rename: record('rename'),
    open: record('open'), close: record('close'),
    priority: arg => { sink(`priority:${arg ?? ''}`) },
    dueToday: record('dueToday'), remove: record('remove'), undo: record('undo'),
    palette: record('palette'),
  }
}
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
  ITEM_FLAGS,
  parseItemQuery,
  scheduleBucketsOf,
  triageLinesOf,
  type ItemFlag,
  type ItemQuery,
} from '../src/core/item-view.ts'
// `type` is the harness's 「type into a field」 helper and it collides with the
// `type` keyword as a bare import name, so it is renamed at the boundary rather
// than avoided — a gate that cannot drive the keyboard cannot claim the keyboard
// works.
import { type as typeInto, click, coreSurfaceSource, fixtures, itemSurfaceFiles, itemSurfaceSource, locateSource, mountPanel, press, readSource, renderPanel, type Page } from './panel-harness.ts'

// A fixed clock, so every date-derived claim is reproducible.
const NOW = new Date(2026, 8, 29, 10, 0, 0).getTime()
const DAY = 86_400_000

/**
 * A source file, read by the END of its path rather than by all of it.
 *
 * The gate below that says every one of these resolved is the one that tells a
 * moved file from a broken rule; this helper only hands over the text.
 * @param rel - the end of a repository-relative path under `src/`.
 * @returns the file's text, or `''` when nothing under `src/` ends this way.
 */
function read(rel: string): string {
  return readSource(rel)
}

/**
 * Every file a gate in this file reads one at a time, located.
 *
 * The list is here rather than derived so that a NEW narrow claim is one line
 * and a MOVED file is a failure with a name in it. The gate over this list is
 * what separates 「the file is not there any more」 from 「the rule does not
 * hold」 — two different emergencies whose repairs point in opposite
 * directions, and only the second one is anybody's fault.
 */
const LOCATED = [
  'client/item/row-line.tsx',
  'client/item/detail-pane.tsx',
  'client/item/view-prefs.ts',
  'client/item/panel.tsx',
  'client/item/menu-place.ts',
  'client/item/item.module.css',
  'client/locales.ts',
  'client/index.ts',
  'client/platform.ts',
  'core/item-view.ts',
  'core/item-transitions.ts',
  'client/item/command-palette.tsx',
  'client/item/query-chips.tsx',
].map(suffix => locateSource(suffix))

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
/** The command palette's own source, for claims about the box it now holds. */
const palette = readSource('client/item/command-palette.tsx')
/** The one component that draws the qualifier chips. */
const chipsComponent = readSource('client/item/query-chips.tsx')
const rowSource = read('client/item/row-line.tsx')
const detailSource = read('client/item/detail-pane.tsx')
const prefsSource = read('client/item/view-prefs.ts')

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
  for (const match of read('client/locales.ts').matchAll(/'(item\.sort\.\w+)'\s*:\s*'([^']*)'/g)) {
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

describe('a gate that reads one file knows whether the file is there', () => {
  it('every file this file reads one at a time exists under src/', () => {
    // THE GATE THIS ENABLES. Every claim below reads one file by the END of its
    // path, so a component that is renamed or moved keeps working — but that is
    // only true while the file EXISTS, and a file that has moved away leaves
    // `source` empty, which turns each of those claims red for a reason that has
    // nothing to do with the claim. This is the one place that says so, with a
    // message naming the file and listing its directory, so 「the file moved」 is
    // never reported as 「the rule is broken」 — the two repairs point in opposite
    // directions and only the second one is anybody's fault.
    const lost = LOCATED.filter(located => located.path === undefined)
    expect(
      lost.map(located => located.missing),
      'a gate in this file reads a file that is not under src/ any more',
    ).toEqual([])
  })

  it('the locator resolves a file by the end of its path, wherever it lives', () => {
    // The move the whole arrangement exists for, exercised against the real
    // filesystem: the same suffix resolves whether the file sits where it always
    // has or one directory deeper.
    const direct = locateSource('client/item/view-prefs.ts')
    const renamed = locateSource('item/view-prefs.ts')
    expect(direct.path, 'a suffix that names a file that exists was not resolved').toBe('src/client/item/view-prefs.ts')
    expect(renamed.path, 'the directory part of the path was treated as required, so a moved file still breaks the gate').toBe(direct.path)
    expect(renamed.source).toBe(direct.source)
  })

  it('the probe bites: a file that cannot exist is reported as not there', () => {
    // A check that cannot fail is worse than no check. Feed the locator a name no
    // file could have and require it to SAY SO, with the directory contents in the
    // message — otherwise an empty `source` is indistinguishable from an empty
    // file, and a gate reading it would report a rule that does not hold.
    const missing = locateSource('client/item/there-is-no-such-module.tsx')
    expect(missing.path, 'a file that does not exist was reported as found').toBeUndefined()
    expect(missing.source, 'a missing file handed back text for a gate to match against').toBe('')
    expect(missing.missing, 'the failure message does not name what was looked for').toContain('client/item/there-is-no-such-module.tsx')
    expect(missing.missing, 'the failure message does not say what the directory actually holds').toContain('src/client/item/')
  })

  it('the probe bites: an ambiguous suffix is refused rather than guessed at', () => {
    // Two files ending the same way is a claim about a file that does not exist —
    // it is two of them, and picking one is a coin toss dressed as a fact. There
    // are two `index.ts` under src/ today, which is exactly the shape: a suffix
    // coarse enough to catch a moved file is also coarse enough to catch a
    // namesake, and the honest answer to that is to say which two.
    const ambiguous = locateSource('index.ts')
    expect(ambiguous.path, 'a suffix matching several files was resolved to one of them').toBeUndefined()
    expect(ambiguous.missing, 'the refusal does not say how many files it matched').toMatch(/matches 2 files/)
    expect(ambiguous.missing, 'the refusal does not name the files it could have meant').toContain('src/client/index.ts')
  })
})

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
    for (const flag of ITEM_FLAGS) {
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
    // THE MODEL'S OWN LIST, not a copy of it. This gate used to spell the flags
    // out by hand and cast the array, which is the one move that makes an
    // incomplete list compile: `overdue` was added to the grammar and this gate
    // kept passing, because the cast agreed with the shorter copy. A gate that
    // polices a vocabulary must READ the vocabulary, or it is a second, stale
    // answer to 「有哪些旗标」 — the exact failure its own name claims to catch.
    //
    // AND THE CLAIM IS NOW THE TRUE ONE. It used to demand a TRIAGE SENTENCE for
    // every flag, which was never true: `ITEM_FLAGS` is the FILTER vocabulary, and
    // only the flags the triage derivation can actually emit need a line. `overdue`
    // is the overview tile's filter and has no sentence, so demanding one would
    // have put a fiction in the table to satisfy a check. What is checked is the
    // real shape: every flag IS a flag the grammar parses, and every flag the
    // derivation can emit HAS a line.
    const flags = new Set<ItemFlag>(ITEM_FLAGS)
    const unparseable = [...flags].filter(flag => parseItemQuery(`has:${flag}`).flags.size !== 1)
    expect(unparseable,
      `these are in the grammar's own flag list but the parser does not read them back: ${unparseable.join(', ')}`).toEqual([])
    // The panel maps flags to lines through one table, so the table is the
    // vocabulary of the TRIAGE block specifically.
    const mapped = new Set([...code(panelSource).matchAll(/^\s*(\w+):\s*'item\.triage\.\w+',?$/gm)].map(m => m[1] as string))
    const invented = [...mapped].filter(name => !flags.has(name as ItemFlag))
    expect(invented,
      `the panel offers lines for flags the grammar does not have, so those sentences can never appear: ${invented.join(', ')}`).toEqual([])
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

  it('and the entrance a real reader finds IS the control', () => {
    // The most valuable half, because it pins reachability at an ENTRANCE a
    // reader can find, not at an abstract stored value. "The finished rows are
    // one gesture away" is a claim about a gesture; the version above is a claim
    // about a preference, and a preference nobody can reach is the defect this
    // whole refactor started from.
    //
    // THE ENTRANCE IS NOW THE GROUP'S OWN FOLD, and the claim moved with it rather
    // than being deleted. It used to be a tile on the overview strip; the strip is
    // retired and the page-level `showDone` went with it, because it was the same
    // sentence said a second time by a control that then disappeared — and a
    // preference whose control is gone is not a setting, it is a trap with the
    // handle filed off. **One intent, one control**, and this case now pins that
    // the surviving control is one a reader can see and press.
    const panel = mountPanel(rows, 'list', 'wide')
    try {
      const fold = [...panel.surface.querySelectorAll('[class*="itemGroupToggle"]')]
        .find(node => (node.textContent ?? '').includes('已完成'))
      expect(fold, 'the finished group has no visible fold — the rows behind it are unreachable by any route a reader can see').toBeDefined()
      // It has to be a real disclosure: an `aria-expanded` that names nothing is
      // a control that announces a state the listener cannot tie to a region.
      expect(fold?.getAttribute('aria-expanded'), 'the fold does not say whether it is open').toBeDefined()
      expect(fold?.getAttribute('aria-controls'), 'the fold announces its state but names no region').toBeTruthy()
      expect((panel.surface.textContent ?? ''), 'the finished row is not on the page with the switch on').toContain(rows[0]?.title ?? '__none__')
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

  it('the detail rail\'s head names the row in it, and there is no such thing as an empty rail', () => {
    // An empty head with a rule under it is a horizontal line that came from
    // nowhere: nothing is being separated, and a rule that separates nothing reads
    // as a rendering fault. That used to be fixed by giving the empty rail a
    // heading that named the column.
    //
    // THE BETTER FIX WAS TO STOP DRAWING IT. The rail is 37% of a wide stage and
    // is now rendered only when a row is chosen, so the whole state this case was
    // written against — a column with a head and a rule and no row in it — cannot
    // be reached. What remains worth pinning is the consequence, which is STRONGER
    // than the sentence it replaces: the head is never empty, because whenever the
    // rail exists it exists for a row, and the head says which one.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const railHead = (): Element | undefined => [...panel.surface.querySelectorAll('h2')]
        .filter(head => !head.closest('button'))
        .find(head => /item[A-Za-z]*Detail[A-Za-z]*Head/.test(head.className))
      expect(railHead(), 'a fresh panel drew a detail head with no row in it — a rule that separates nothing reads as a broken render').toBeUndefined()
      const row = panel.surface.querySelector('[class*="itemRowMain"]')
      click(row)
      const head = railHead()
      expect(head, 'a chosen row produced no detail head — the column beside the list is not named').toBeDefined()
      expect((head?.textContent ?? '').trim(), 'the detail head is an empty box with a rule under it').not.toBe('')
    } finally {
      panel.dispose()
    }
  })

  it('deleting offers the undo right there, on the NARROW band too', () => {
    // The same promise, on the band a phone is actually on.
    //
    // Every other delete gate in this file mounts the WIDE band, and the wide band
    // is the one where the detail lives in a rail beside the list. On a phone the
    // detail is in place, the rail is gone, and the receipt is the ONLY place the
    // undo can be — so a receipt that is wired to the wide band's arrangement is a
    // receipt that does not exist where it is needed. This is the band difference
    // that a wide-only suite cannot see, and it is the difference between 「undo
    // does nothing」 and 「undo is right there».
    for (const band of ['wide', 'narrow'] as const) {
      const panel = mountPanel(oneRow({ id: 'd-1', title: '删掉我' }), 'list', band)
      try {
        openRowMenu(panel.surface)
        click(findMenuEntry(panel.surface, '删除'))
        const undo = [...panel.surface.querySelectorAll('button')]
          .find(b => (b.textContent ?? '').includes('撤销'))
        expect(undo, `deleting on the ${band} band left the row gone with no way back on the page`).toBeDefined()
      } finally {
        panel.dispose()
      }
    }
  })

  it('a tile filters EXACTLY what it counts — the number and the list are one fact', () => {
    // THE OVERDUE TILE COUNTED TWO BUCKETS AND FILTERED ONE. `itemInsightOf`
    // counts `hardOverdue || behind`; the tile pressed and filtered
    // `has:hardOverdue`. So a reader pressed a tile reading 「逾期 3」 and got one
    // row, with nothing on screen saying the number had changed its meaning —
    // which is the one failure a filter surface cannot recover from, because the
    // reader has no way to tell a wrong number from a wrong filter.
    //
    // The gate is on the SHAPE rather than on the two values: whatever token the
    // tile writes, the rows that token keeps must be the rows the tile counted.
    // Asserted by asking the model, so a future tile that counts one bucket and
    // filters another cannot pass.
    // THE SUBJECT IS THE EMPTY-BUCKET SUMMARY'S CHIP NOW. The strip is retired,
    // and the claim is the same one a reader can still check: whatever number a
    // chip prints, the rows that chip's filter keeps must be those rows. The chip
    // is the surface's remaining 「a number you can press to filter」, so the
    // defect this caught has a home rather than losing its only test.
    //
    // The gate is on the SHAPE rather than on the two values: whatever token the
    // chip writes, the rows that token keeps must be the rows the chip counted.
    // Asserted by asking the model, so a future chip that counts one bucket and
    // filters another cannot pass.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const chip = panel.surface.querySelector('[class*="itemEmptyGroup"][data-status]')
      expect(chip, 'no bucket chip is drawn at all, so this gate is asserting nothing — a number with no press behind it is a scoreboard').not.toBeNull()
      // `[0]`, not `[1]`: the pattern has no capture group, so `[1]` is always
      // undefined and the whole case reports 「prints no number」 for a chip that
      // is printing one — a gate that is red for the wrong reason is a gate
      // somebody relaxes instead of reads.
      const said = Number(/\d+/.exec(chip?.textContent ?? '')?.[0] ?? Number.NaN)
      expect(Number.isInteger(said), `the chip prints no number to compare against: ${JSON.stringify(chip?.textContent)}`).toBe(true)
      const before = panel.surface.querySelectorAll('li[class*="itemRow"]').length
      act(() => { chip?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      const after = panel.surface.querySelectorAll('li[class*="itemRow"]').length
      expect(after, 'pressing the chip did not filter at all').toBeLessThan(before)
      // The count it prints and the rows it keeps are ONE fact. A chip that says
      // 0 and keeps 2 is the exact defect this case was written for.
      expect(after, `the chip says ${String(said)} and filtering to it left ${String(after)} rows — the number and the list are two different facts`).toBe(said)
    } finally {
      panel.dispose()
    }
  })

  it('the checklist HAS an offline mirror, wired where the client is built', () => {
    // A WHOLE CLASS OF DEFECT LIVES HERE, and every existing test was blind to it.
    // The sync client is constructed in exactly one production place, and nothing
    // in `tests/` imports that place — so an option omitted there is invisible to
    // every spec, because the specs build their OWN client with the option they
    // happen to pass. That is how the checklist shipped with NO mirror: a note
    // written with the host down rendered on screen, was stored nowhere, and was
    // gone on reload with no warning. The mirror key was not even present in the
    // shipped bundle.
    //
    // So the gate is on the CONSTRUCTION SITE, and it asks for the argument by
    // name. The mirror is deliberately not defaulted inside the replica: a default
    // that quietly builds one is a default nobody can find at the call site.
    const root = read('client/index.ts')
    const site = /new BoardSyncClient\(\{([\s\S]*?)\n {4}\}\)/.exec(root)?.[1] ?? ''
    expect(site, 'the sync client is no longer constructed where this gate looks for it — the markup moved and this is now checking nothing')
      .not.toBe('')
    expect(site, 'the checklist is still built with NO offline mirror, so a note written while the host is down is lost on reload')
      .toMatch(/checklistMirror:\s*createChecklistMirror\(\)/)
    // And the mirror must be a real one: the key the reader's notes live under.
    const platform = read('client/platform.ts')
    expect(platform, 'the mirror exists but writes somewhere that is not the documented key')
      .toMatch(/dsh\.taskBoard\.items\.v1/)
  })

  it('the undo actually puts the row back, and says so', async () => {
    // The gate above only proves the BUTTON is there. This one presses it, because
    // 「a button that is present and does nothing」 is the exact failure a presence
    // check cannot see, and it is the failure a reader reports as 「撤销没有任何
    // 反应」.
    //
    // ASYNC ON PURPOSE: undo is a round trip (the host has to fetch the row back
    // out from behind its tombstone), so the row returns on a later turn. A gate
    // that presses and reads the DOM in the same breath is measuring the network,
    // not the behaviour — and 「it did not come back YET」 is indistinguishable
    // from 「it did not come back」 in a red.
    const panel = mountPanel(oneRow({ id: 'd-2', title: '带我回来' }), 'list', 'wide')
    try {
      openRowMenu(panel.surface)
      click(findMenuEntry(panel.surface, '删除'))
      expect(panel.surface.textContent ?? '', 'the row did not go away, so there is nothing to undo').not.toContain('带我回来')
      const undo = [...panel.surface.querySelectorAll('button')].find(b => (b.textContent ?? '').includes('撤销'))
      expect(undo, 'there is no undo control to press').toBeDefined()
      await act(async () => { click(undo) })
      expect(panel.surface.textContent ?? '', 'the undo was pressed and the row did not come back').toContain('带我回来')
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

describe('the search box does not print the grammar', () => {
  /**
   * THE LARGEST SINGLE REASON THE PAGE READ AS MACHINE-MADE, and it was one
   * binding. The query is one string and it stays one string — the model reads the
   * same grammar, and a reader who wants the raw form can type it. But the field
   * was bound to the WHOLE query, so every facet press printed its own
   * implementation into a field labelled 「搜索标题、正文、备注与标签」:
   * `status:inProgress`, `has:hardOverdue`, `p1`. A control showing the reader its
   * source code is a control that has not been finished.
   *
   * So the split is enforced here on the BINDING, not on the strings: the box
   * takes the free-text half, and the qualifiers are DERIVED from the same string
   * into chips. A gate on the strings would have to enumerate every token, and the
   * next value added to a facet table would slip past it; a gate on the binding
   * cannot be outrun, because the defect WAS the binding.
   */
  const panel = code(read('client/item/panel.tsx'))

  it('the field is bound to the free-text half, not to the whole query', () => {
    // THE FIELD IS IN THE PALETTE NOW, and the claim did not move with the markup
    // so much as acquire a second address. It used to be read off `panel.tsx`; it
    // is the same binding in `command-palette.tsx`, against the same one string.
    // The wiring changed and the claim did not — which is the point of stating
    // what a claim IS rather than which file it was typed into.
    const field = /<input[^>]*className=\{css\.itemSearch\}[\s\S]{0,400}?\/>/.exec(palette)?.[0] ?? ''
    expect(field, 'the search field is not where this gate expected it — the markup moved and this is now checking nothing').not.toBe('')
    const bound = /value=\{([^}]*)\}/.exec(field)?.[1] ?? ''
    expect(bound, 'the search field has no value binding at all').not.toBe('')
    expect(bound, 'the field is bound to the whole query, so every facet press prints its own token into it')
      .toMatch(/freeTextOf\(/)
    expect(bound, 'the field was bound to the raw query again').not.toBe(/^props\.text$/)
  })

  it('the chips are DERIVED from that same string, and clearing them keeps the reader\'s words', () => {
    // The chips are DERIVED from the box's own string, and they were moved back
    // into `query-chips.tsx` after being inlined into the palette — two renderings
    // of one control, one of them imported by nobody. So this reads the component
    // that draws them, which is the one place the answer now lives.
    expect(chipsComponent, 'the chips are not derived from the box\'s own string')
      .toMatch(/queryChipsOf\(props\.text, props\.tags\)/)
    expect(chipsComponent, 'the chips were bound to the raw query again')
      .toMatch(/withFacetToken\(props\.text, chip\.token, false\)/)
    // And the palette reaches for that component rather than drawing its own.
    expect(palette, 'the palette draws its own copy of the chips instead of using the one component').not.toMatch(/itemQueryChipRemove/)
    // And the panel still owns that string: the palette is handed the same
    // `search` preference the list page reads, not a second copy of it.
    expect(panel, 'the palette keeps its own copy of the query instead of reading the panel\'s')
      .toMatch(/text=\{prefs\.search\}/)
  })

  it('pressing a facet does NOT print its token into the box, and the chip says it in words', () => {
    // THE DEFECT, EXERCISED RATHER THAN INSPECTED. The gates above read the
    // binding; this presses the control, because the thing a reader notices is
    // what the field says afterwards. One press, three claims: the field still
    // holds only the reader's words, a chip appears naming the value the way a
    // person would, and the reader's own words are untouched by it.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      // THE BOX IS BEHIND A KEYSTROKE NOW, and opening it is part of the claim: a
      // filter the reader cannot reach without a keyboard is a filter the phone
      // does not have, and hard rule 11 makes that a REMOVED control rather than
      // a moved one. So the gate opens the palette the way a reader does.
      press(panel.surface, '/')
      const box = (): HTMLInputElement => panel.surface.querySelector('input') as HTMLInputElement
      expect(box(), 'the palette opened on nothing, so the search box is unreachable without a mouse').not.toBeNull()
      // React controls this input, so assigning `.value` writes to the DOM node
      // without going through the change handler it listens to — the field stays
      // empty and the rest of the gate is measuring nothing. The native setter is
      // what a real keystroke ends up calling.
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      expect(nativeSetter, 'this environment has no input value setter to drive the field with').toBeDefined()
      act(() => {
        nativeSetter?.call(box(), 'Gallery')
        box().dispatchEvent(new Event('input', { bubbles: true }))
      })

      // Press the 待办 value in the status face.
      const chip = findByText(panel.surface, '待办')
      expect(chip, 'the status face offers no value to press, so this gate is asserting nothing').not.toBeNull()
      act(() => { chip?.click() })

      expect(box().value, 'the field printed a grammar token into itself, so the control showed the reader its own source')
        .not.toMatch(/status:|has:|^p[1-4]$|^\#/)
      expect(box().value, "the reader's own word was thrown away by a facet press").toContain('Gallery')
      const chips = panel.surface.querySelector('[class*="itemQueryChips"]')
      expect(chips, 'the qualifier is filtering the list with nothing on screen saying what is filtering it').not.toBeNull()
      expect(chips?.textContent ?? '', 'the chip is not naming the value the way a reader would').toContain('待办')
    } finally {
      panel.dispose()
    }
  })

  it('the probe bites: a box bound to the raw query is reported', () => {
    const binding = (source: string): string => /value=\{([^}]*)\}/.exec(source)?.[1] ?? ''
    const raw = 'const x = <input className={css.itemSearch} value={prefs.search} />'
    expect(binding(raw), 'the probe did not bite — the detector cannot see a raw binding').toBe('prefs.search')
    expect(binding(raw), 'a box bound to the whole query passed as a split one').not.toMatch(/freeTextOf\(/)
  })
})

describe('the ordering is ONE control, and the narrow band only wraps it', () => {
  /**
   * IT WAS TWO COMPONENTS, AND THE CONTAINER QUERY DECIDED WHICH ONE YOU GOT.
   *
   * A `<select>` at the base band, a segmented row from 720, one hidden and one
   * shown. That is the move rule 11 bans outright — a second component for the
   * narrow band — and it bought nothing: the shared segmented row already WRAPS,
   * so seven named orders on a 342px line is two lines, and a second line is one
   * of the six answers the rule allows. What it actually cost is that the same
   * setting had two different names and two different affordances depending on
   * the width of the window, and that a reader who learned one had to learn the
   * other.
   *
   * The gate is on the RENDER, not on the stylesheet, because the defect was never
   * a declaration — both controls were perfectly well declared. It was that only
   * one of them was ever on screen.
   */
  const bar = code(read('client/item/command-palette.tsx'))

  it('the palette offers ONE ordering control, and no band decides otherwise', () => {
    // THE SUBJECT MOVED, THE CLAIM DID NOT. The ordering used to live on the
    // filter bar, which had a `<select>` at the base band and a segmented row
    // from 720 — the same setting with two components and two names, which is
    // the shape rule 11 bans outright. The bar is retired; the six orders are in
    // the command palette now, and the state bar carries only a trigger that
    // NAMES the current one.
    //
    // So the claim is checked where the orders are now: exactly one chooser, no
    // second spelling, and every order reachable. What is deliberately NOT
    // asserted is that the current order appears exactly once on screen — the
    // state bar naming it and the palette offering it are the same control seen
    // from two states, and a gate that counted the two would forbid the reader
    // from being told what they are looking at.
    const choosers = (bar.match(/SORT_LABEL\[/g) ?? []).length
    expect(choosers, 'the orders are chosen in more than one place — the same setting with two components again').toBe(1)
    expect(bar, 'the ordering chooser is a `<select>` again, which is how the phone lost the segmented row').not.toMatch(/<select/)
    // Every order the model offers is reachable, and the orders come from the
    // model rather than from a list written here.
    expect(bar, 'the palette does not read the orders from the model').toContain('ITEM_SORTS')
    expect(bar, 'the palette writes its own list of order labels instead of the one closed table').not.toMatch(/item\.sort\.\w+'\s*:\s*'/)
  })

  it('and no stylesheet hides a control at a width', () => {
    // The shape of the old case, kept as a RULE rather than as the two classes
    // it happened to name: a stylesheet must not be able to remove a control at a
    // width, because 「the phone is offered what the desk is offered」 stops being
    // true the moment a width is allowed an opinion.
    const sheet = code(read('client/item/item.module.css'))
    const hidden = [...sheet.matchAll(/\.(itemFacetChip|itemStatebarAction|itemCommandTrigger|itemRowMain)\s*\{([^}]*)\}/g)]
      .map(match => match[2] ?? '')
      .filter(body => /display\s*:\s*none/.test(body))
    expect(hidden, 'a width is told to hide a control, which is how the phone lost it').toEqual([])
  })

  it('the probe bites: a hidden control is reported', () => {
    // Run through the SAME class list the gate above uses, so the probe tests the
    // reader rather than a copy of it — a copy drifts from its original the first
    // time the original is fixed, and then it proves nothing for ever after.
    const detector = (css: string): number => [...css.matchAll(/\.(itemFacetChip|itemStatebarAction|itemCommandTrigger|itemRowMain)\s*\{([^}]*)\}/g)]
      .map(match => match[2] ?? '')
      .filter(body => /display\s*:\s*none/.test(body)).length
    expect(detector('.itemFacetChip { display: none; }'), 'the probe did not bite — a hidden control passes').toBe(1)
    expect(detector('.itemFacetChip { display: flex; }'), 'a visible control is reported as hidden').toBe(0)
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
    const source = read('client/item/menu-place.ts')
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
    // THE WHOLE SHARED LAYER, not one file of it. The two predicates were
    // re-exported out of `item-view.ts` into their own module, and a gate wired
    // to the old path answered 「the inbox predicate is gone from the shared
    // module」 — which was false, the export was still there, and the reader of
    // that sentence would have gone hunting for a deleted function instead of a
    // moved one. The claim is about where the ANSWER lives (the shared layer)
    // and never about which file holds it today.
    const source = coreSurfaceSource()
    const inbox = /export function isInboxItem\b[\s\S]*?\n\}/.exec(source)?.[0] ?? ''
    expect(inbox, 'the inbox predicate is gone from the shared layer').not.toBe('')
    const member = /export function isAgendaItem\b[\s\S]*?\n\}/.exec(source)?.[0] ?? ''
    expect(member, 'there is no named agenda membership in the shared layer — the exemption is being written at each call site').not.toBe('')
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
    const shared = [...read('core/item-transitions.ts').matchAll(/export function (\w+)/g)].map(m => m[1] as string)
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
    const css = read('client/item/item.module.css')
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

/**
 * 「A METER STATES A FRACTION, SO ITS DENOMINATOR HAS TO BE THE ONE IT NAMES」 —
 * RETIRED, and the reason is written down so the next reader does not take the
 * silence for 「there was never a check here」.
 *
 * The invariant was real and it caught a real thing: a bar whose count is divided
 * by a total the bar is not a part of is a plausible number, is contradicted by
 * nothing on screen, and every other gate reads it as a percentage. The overview
 * strip's fifth tile was one — the finished group's count over the UNFINISHED
 * total — under a caption that was true about the other four.
 *
 * The check moved to the group heads' own meter when the strip was retired, and
 * then the group meter went too. So the page has NO meter at all: the four group
 * counts are group HEADS and the overdue count is the date facet, and both are
 * plain numbers a reader can add up against the header. The colour budget is
 * what finally settled it — nine 2px accent bars on one screen against a budget
 * of seven, all of them restating a number printed next to them.
 *
 * WHAT THIS MEANS FOR THE NEXT METER. Nothing on this surface draws a fraction
 * now, so there is nothing for the rule to police, and a gate with no subject is
 * worse than no gate: it would be a green tick asserting nothing, which is the
 * one thing this repository is most careful about. **The first meter drawn on this
 * surface again must come back with this check attached** — read the sentence
 * beside it, then require the bar to be the share of what that sentence says. A
 * bar over the list total, or over the rows still open, is the defect it exists
 * for.
 */
describe('a meter states a fraction — nothing on this page draws one', () => {
  it('and the counts that took their place are plain numbers, so there is no fraction left to police', () => {
    // A LIVE version of the retired check, pointed at the claim that replaced
    // it: whatever the four group heads and the overdue facet print must be a
    // COUNT a reader can check against the header, with no bar anywhere claiming
    // to be a share of it. This is the smallest honest gate the retirement
    // leaves behind — it cannot fail on a meter (there are none) and it fails the
    // moment a meter comes back without one.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const bars = panel.surface.querySelectorAll('[class*="itemTileBar"], [class*="itemGroupProgress"]')
      expect(
        [...bars].map(node => node.className),
        'a meter is back on this surface — it has to be the share of the fraction spelled out beside it, so this retirement is over',
      ).toEqual([])
      // And the group heads still print a number each: a retirement must not
      // quietly become a deletion.
      const counts = [...panel.surface.querySelectorAll('[class*="itemGroupCount"]')]
        .map(node => Number(/(\d+)\s*$/.exec(node.textContent ?? '')?.[1] ?? Number.NaN))
      expect(counts.length, 'the group heads no longer carry numbers, so 「the counts went back to the heads」 is not true').toBeGreaterThan(0)
      expect(counts.every(Number.isInteger), `a group head reports no number: ${JSON.stringify(counts)}`).toBe(true)
    } finally {
      panel.dispose()
    }
  })

  it('the probe bites: a bar with a sentence beside it is reported, so the retirement cannot hide a returning meter', () => {
    // The shape the retired check existed to catch, fed through the check that
    // replaced it. If this ever passes, the gate above has stopped being able to
    // fail and the whole block is decoration.
    const findsAMeter = (root: ParentNode): string[] =>
      [...root.querySelectorAll('[class*="itemTileBar"], [class*="itemGroupProgress"]')].map(node => node.className)
    const box = document.createElement('div')
    box.innerHTML = '<p><span class="_itemTileBar_x"><span class="_itemTileBarFill_x"></span></span></p>'
    expect(findsAMeter(box), 'the probe did not bite — a returning meter is invisible to this gate').not.toEqual([])
  })
})

describe('the keyboard flow is one table, and every key in it has something behind it', () => {
  // 398 LINES OF GRAMMAR WITH NO TEST, and then a table nobody checks. The
  // property that matters is not that the keys work — that is what pressing one
  // is for — but that there is no key WITHOUT something behind it. A shortcut
  // that does nothing is a promise the interface makes and breaks, and it is the
  // same defect as a button that only explains itself when pressed: the reader
  // cannot tell it apart from a broken panel.
  it('every action the map names is an action the panel can perform', () => {
    // THE CLOSED RECORD IS THE GATE, and this is the case that makes it worth
    // having. `ItemKeyActions` is `Record<ItemKeyAction, …>`, so a name added to
    // the map without a handler does not compile — which is why the panel's
    // object literal below type-checks at all, and why it is written out HERE as
    // well: a reader of this file can see which actions exist without opening
    // the component.
    const named = [...new Set(ITEM_KEYS.map(binding => binding.action))].sort()
    expect(named.length, 'the map names no actions at all — the gate is asserting nothing').toBeGreaterThan(3)
    // A name with no handler is a COMPILE error, not a runtime one, so what is
    // checkable here is the weaker and still useful half: every action the map
    // names is one the shared record knows about. The strong half is `tsc`.
    for (const action of named) {
      expect(knownActions.has(action), `the map names "${action}", which is not a key action the registrar can call`).toBe(true)
    }
  })

  it('no key is bound to a name twice with a different meaning', () => {
    // `J` and `↓` both mean 「next」, which is right. Two bindings with the same
    // CHORD meaning different things is not: the first one in the table wins and
    // the second is unreachable, so a reader who finds the second in the docs is
    // pressing a key that does something else.
    const byChord = new Map<string, string>()
    for (const binding of ITEM_KEYS) {
      const chord = `${binding.cmd === true ? 'cmd+' : ''}${binding.shift === true ? 'shift+' : ''}${binding.key}`
      const seen = byChord.get(chord)
      if (seen !== undefined) {
        expect(seen, `${chord} is bound twice with different meanings (${seen} and ${binding.what}) — one of them is unreachable`).toBe(binding.what)
      }
      byChord.set(chord, binding.what)
    }
    expect(byChord.size, 'no chords were read at all — the gate is asserting nothing').toBe(ITEM_KEYS.length)
  })

  it('a key the reader is TYPING into is not a command', () => {
    // The rule that makes a letter-key flow safe to have at all. `j`, `k` and
    // `d` are letters, and a reader searching for 「jdk」 must get three letters
    // rather than two letters and a cursor jump — which is a failure with no
    // error and no visible cause.
    const search = { key: 'j', metaKey: false, ctrlKey: false, shiftKey: false, target: document.createElement('input') }
    expect(claimsKey(search), 'a bare letter in a text field is claimed as a command — the reader cannot type it').toBe(false)
    const onThePage = { ...search, target: document.createElement('div') }
    expect(claimsKey(onThePage), 'the same letter is not claimed on the page itself — the key does nothing anywhere').toBe(true)
  })

  it('a ⌘ chord still works while the reader is typing, because it is not typing', () => {
    const undo = { key: 'z', metaKey: true, ctrlKey: false, shiftKey: false, target: document.createElement('input') }
    expect(claimsKey(undo), '⌘Z is swallowed by a text field, so undo cannot be reached from the search box').toBe(true)
    const plain = { ...undo, metaKey: false }
    expect(claimsKey(plain), 'a bare `z` in a text field is claimed as undo').toBe(false)
  })

  it('the digits set priorities in the order a reader already knows them', () => {
    // `!1` is the loudest thing this model can say, so `1` is the loudest here.
    // The table runs the OTHER way from `ITEM_PRIORITIES`, which is bottom-to-top,
    // and getting that backwards is the kind of wrong nobody notices until a
    // reader has pressed `1` on four rows meaning 「the most urgent thing there
    // is」 and got 「the quietest」.
    for (const [digit, tier] of [['1', 'urgent'], ['2', 'high'], ['3', 'normal'], ['4', 'low']] as const) {
      const event = { key: digit, metaKey: false, ctrlKey: false, shiftKey: false, target: document.createElement('div') }
      const binding = bindingFor(event, { focusedId: 'r-1', somethingOpen: false })
      expect(binding?.action, `${digit} does not set a priority`).toBe('priority')
      expect(binding?.arg, `${digit} sets the wrong tier`).toBe(tier)
    }
  })

  it('a key that needs a row does nothing without one, and is still swallowed', () => {
    // The two answers are DIFFERENT on purpose. 「Does nothing」 so a priority key
    // with no row under the cursor does not patch row zero; 「still swallowed」 so
    // `1` on an empty page does not type a `1` into the search box or scroll the
    // panel. A key that returns early without claiming the event is the defect.
    const empty = { key: '1', metaKey: false, ctrlKey: false, shiftKey: false, target: document.createElement('div') }
    const ran: string[] = []
    const actions = recordOfActions(name => { ran.push(name) })
    expect(claimsKey(empty), 'a priority key on an empty page is not claimed, so the browser takes it').toBe(true)
    const taken = dispatchKey(empty, { focusedId: undefined, somethingOpen: false }, actions)
    expect(taken, 'an inert key let the event travel to the browser').toBe(true)
    expect(ran, 'a key with no row under the cursor patched something anyway').toEqual([])
    dispatchKey(empty, { focusedId: 'r-1', somethingOpen: false }, actions)
    expect(ran, 'the same key with a row under the cursor did nothing — the binding is unreachable').toEqual(['priority:urgent'])
  })

  it('the probe bites: the readers can see a key the table does not have', () => {
    // Two synthetic events the table has no binding for, and the two that it
    // does. If `claimsKey` and `bindingFor` were reading an empty map, every one
    // of these would pass for the same reason.
    const off = (key: string) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, target: document.createElement('div') })
    const state = { focusedId: 'r-1', somethingOpen: false }
    expect(claimsKey(off('q')), 'the reader claims a key the map does not have — it is guessing').toBe(false)
    expect(claimsKey(off('z')), 'a bare `z` is claimed — ⌘ is the platform\'s chord, so `z` alone is a letter').toBe(false)
    // A chord the map genuinely does not have, and one it does: the readers must
    // tell those apart, which they cannot if either always answers the same way.
    expect(bindingFor({ ...off('q'), metaKey: true }, state), 'the map has no ⌘Q, and the reader invented one').toBeUndefined()
    expect(bindingFor({ ...off('z'), metaKey: true }, state)?.action, 'the map HAS ⌘Z and the reader cannot see it').toBe('undo')
    expect(bindingFor(off('j'), state)?.action, 'the reader cannot see a bare key that is in the map').toBe('moveNext')
  })
})

describe('the command palette BEHAVES, which a static capture cannot show', () => {
  // WHY THIS FILE AND WHY IT MOUNTS. The render bench writes `renderToStaticMarkup`
  // into a plain HTML document: no runtime, no handlers, no hydration. It can
  // therefore photograph the palette, and it can never answer the three questions
  // that decide whether the feature exists at all: **does `⌘K` open it, does the
  // caret land in the box, and does pressing a chip change the query.** A capture
  // that shows an open palette is a picture of markup, and markup is not a
  // feature — so this drives the real component with real key events.
  const open = (panel: ReturnType<typeof mountPanel>): boolean => {
    press(panel.surface, 'k', { metaKey: true })
    return panel.surface.querySelector('[class*="itemCommandPalette"]') !== null
  }

  it('⌘K opens it and Esc closes it', () => {
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      expect(panel.surface.querySelector('[class*="itemCommandPalette"]'), 'the palette is on screen before anything asked for it').toBeNull()
      expect(open(panel), '⌘K did not open the palette — the keyboard map names a control nothing answers').toBe(true)
      press(panel.surface, 'Escape')
      expect(panel.surface.querySelector('[class*="itemCommandPalette"]'), 'Esc did not close the palette').toBeNull()
    } finally {
      panel.dispose()
    }
  })

  it('/ opens it too, and so does the button on the spine', () => {
    // Three ways in, because a surface with one is a surface half of whose
    // readers cannot use it. The button is here because a filter a mouse cannot
    // reach is a filter the phone does not have.
    const bySlash = mountPanel(fixtures(), 'list', 'wide')
    const byButton = mountPanel(fixtures(), 'list', 'wide')
    try {
      press(bySlash.surface, '/')
      expect(bySlash.surface.querySelector('[class*="itemCommandPalette"]'), '`/` did not open the palette').not.toBeNull()
      const trigger = byButton.surface.querySelector('[class*="itemCommandTrigger"]')
      expect(trigger, 'the spine draws no ⌘K trigger, so a mouse user has no way into the palette at all').not.toBeNull()
      click(trigger)
      expect(byButton.surface.querySelector('[class*="itemCommandPalette"]'), 'the spine trigger did not open the palette').not.toBeNull()
    } finally {
      bySlash.dispose()
      byButton.dispose()
    }
  })

  it('the caret lands in the box, because a box you have to click first is a box you came here to avoid', () => {
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      open(panel)
      const box = panel.surface.querySelector('[class*="itemCommandPalette"] input') as HTMLInputElement | null
      expect(box, 'the palette opened with no field to type into').not.toBeNull()
      expect(document.activeElement, 'the palette opened and the focus stayed behind — the reader has to reach for the mouse to type the word they are already thinking').toBe(box)
    } finally {
      panel.dispose()
    }
  })

  it('a bare letter typed while the box is open is TEXT, and not a command', () => {
    // The rule that makes a letter-key flow safe to have at all. `j` and `d` are
    // keys here; a reader who has just typed 「登录」 and presses `j` must get a `j`.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      open(panel)
      const box = panel.surface.querySelector('[class*="itemCommandPalette"] input') as HTMLInputElement
      typeInto(box, 'jdk')
      expect(box.value, 'the reader\'s own word lost characters to the key map').toBe('jdk')
      expect(panel.surface.querySelector('[class*="itemCommandPalette"]'), 'a letter closed the palette — the key map claimed a keystroke inside a text field').not.toBeNull()
    } finally {
      panel.dispose()
    }
  })

  it('pressing a chip writes the filter and the list answers to it', () => {
    // The whole chain, end to end: a press in the palette, the panel's single
    // query string, and the rows underneath. A palette whose chips draw but do
    // not write is a picture of a control, and this is the case that would have
    // caught it — the render bench cannot, because nothing there responds to a
    // press.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const before = panel.surface.querySelectorAll('[class*="itemRow"]').length
      open(panel)
      const chip = findByText(panel.surface, '待办')
      expect(chip, 'the palette offers no status value to press').not.toBeNull()
      click(chip)
      const after = panel.surface.querySelectorAll('[class*="itemRow"]').length
      expect(after, 'pressing a chip did not narrow the list — the control is drawn and wired to nothing').toBeLessThan(before)
    } finally {
      panel.dispose()
    }
  })

  it('the probe bites: a key map with no ⌘K binding cannot pass the first case', () => {
    // The reader the gate uses, fed an event for a chord the map has not got, and
    // one it has. If both answered the same way the first case would be a green
    // tick asserting nothing — which is the one thing a keyboard gate must never be.
    const map = (keys: readonly { key: string; cmd?: boolean }[], event: { key: string; metaKey: boolean }): boolean =>
      keys.some(binding => binding.key === event.key && (binding.cmd === true) === event.metaKey)
    const withCommandK = [{ key: 'k', cmd: true }]
    expect(map(withCommandK, { key: 'k', metaKey: true }), 'the detector cannot see ⌘K — the gate proves nothing').toBe(true)
    expect(map(withCommandK, { key: 'k', metaKey: false }), 'a bare `k` was read as ⌘K').toBe(false)
    expect(map(withCommandK, { key: 'z', metaKey: true }), 'a chord the map does not have was read as bound').toBe(false)
  })
})

describe('the detail rail is rented when a row is chosen, and not before', () => {
  // THE OTHER HALF of `panel-render`'s band case, and it is here because this file
  // runs under jsdom: which row is open is LIVE state, and there is nothing to
  // seed it with — a prop that existed only for a test would be a second way to
  // say which row is open, which is exactly what the harness warns against for the
  // preference fields. The reader's gesture is the only honest way in, and it is
  // the one that also proves the rail appears as a CONSEQUENCE of choosing rather
  // than because something asked for it.
  for (const band of ['wide', 'narrow'] as const) {
    it(`the ${band} band: nothing chosen means no rail, and a row chosen decides the rest`, () => {
      const panel = mountPanel(fixtures(), 'list', band)
      try {
        const rail = (): boolean => panel.surface.querySelector('[class*="itemDetailPane"]') !== null
        expect(rail(), `a fresh ${band} panel drew a detail rail before anything was chosen — 37% of the stage saying nothing`).toBe(false)
        const row = panel.surface.querySelector('[class*="itemRowMain"]')
        expect(row, `the ${band} panel drew no row to choose`).not.toBeNull()
        click(row)
        expect(
          rail(),
          band === 'wide'
            ? 'a wide surface with a row chosen draws no detail rail — the row cannot be read anywhere'
            : 'a narrow surface drew a detail rail — on that band the detail opens in the row, and a rail would be a second copy of it',
        ).toBe(band === 'wide')
      } finally {
        panel.dispose()
      }
    })
  }
})

describe('the facet editor never rewrites what the reader typed', () => {
  // 398 LINES, THIRTEEN EXPORTS, NO TESTS — until now. This is the module that
  // stands between a reader's words and the grammar, and the failure it can
  // commit is silent: the query comes back rewritten under the reader's hands.
  // Nothing throws, nothing logs, and the rows still match, so it stays hidden
  // until a reader looks for their own sentence and does not find it.
  //
  // So the claims below are about the WORDS, not about the result. 「The same
  // rows match」 is true both before and after the text is mangled, and it is
  // exactly the property that hides the defect.

  it('a facet press adds one token and takes one away, leaving the reader\'s words', () => {
    // THE ROUND TRIP NOBODY SHOULD WRITE. Parse, drop the value, re-serialize,
    // write back — and `parseItemQuery` normalises, lower-casing every free word.
    // A reader who searched 「Gallery」 finds 「gallery」 under their hands, and a
    // reader who typed a tag in capitals can no longer type it again.
    //
    // Pinned on the WORDS, not on the whitespace between them: the field is one
    // line, so a run of spaces collapsing to one is invisible to the reader,
    // while capitalisation is the thing they typed on purpose.
    const typed = 'Gallery Work notes'
    expect(withFacetToken(typed, 'status:open', true), 'a press lost or rewrote the reader\'s own words').toBe('Gallery Work notes status:open')
    expect(withFacetToken(withFacetToken(typed, 'status:open', true), 'status:open', false)).toBe(typed)
  })

  it('the box holds the words, and the qualifiers are not in it', () => {
    // What the reader TYPING, and nothing else. If a press prints
    // `status:open` into a field labelled 「搜索标题、正文、备注与标签」, the control
    // is showing the reader its own source code.
    expect(freeTextOf('status:open #work Gallery')).toBe('Gallery')
    expect(freeTextOf('  '), 'an empty box came back with something in it').toBe('')
    expect(freeTextOf('Gallery'), 'a plain phrase lost words').toBe('Gallery')
  })

  it('a qualifier the grammar knows but the chip tables do not is still a qualifier', () => {
    // The hand-built token set this replaced had drifted from the grammar twice,
    // and each drift cost the same thing: the filter applied, the raw token sat
    // in the field the reader was typing in, and no chip said what had filtered
    // the list. `ITEM_FLAGS` carries nine flags and the date face offers four, so
    // `has:overdue` is a real filter this file has no button for — and it must
    // still come out of the WORDS, or it prints itself into the reader's text.
    expect(ITEM_FLAGS, 'the grammar no longer has the flag this case was written about').toContain('overdue')
    expect(freeTextOf('has:overdue'), 'a qualifier the grammar understands was left in the words box').toBe('')
  })

  it('a word that merely looks like a qualifier stays in the box', () => {
    // The other direction, and the one that makes the rule a rule rather than a
    // shape test: an unrecognised token is a WORD the reader typed, and hiding it
    // would filter the list with nothing on screen accounting for the filter.
    expect(freeTextOf('has:notAFlag')).toBe('has:notAFlag')
  })

  it('chips are in FACET order, not in the order the text happens to sit in', () => {
    // A chip row that reorders as the reader types is a row nobody can learn, and
    // the reader's own words may be in any order at all.
    const a = queryChipsOf('p1 status:open Gallery', [])
    const b = queryChipsOf('Gallery status:open p1', [])
    expect(a.map(chip => chip.token), 'the chips came back in a different order for the same filter').toEqual(b.map(chip => chip.token))
    expect(a.map(chip => chip.token)).toEqual(['status:open', 'p1'])
  })

  it('a tag chip shows the spelling the reader spelled it with', () => {
    // A tag is the reader's own word and has no dictionary entry, which is why it
    // is its own type. A chip that could not spell it would render `undefined`.
    // When the document holds two spellings of one tag, the first one seen is the
    // one kept — which is the rule, so it is pinned rather than assumed.
    const [chip, ...rest] = queryChipsOf('#Design', [['Design'], ['design']])
    expect(rest, 'one tag produced more than one chip').toEqual([])
    expect(chip?.tag).toBe('Design')
  })

  it('the tag list is the document\'s, de-duplicated case-insensitively and in one order', () => {
    // A list of chips whose order changes between renders is a list nobody can
    // find anything in. The order is the plain string order of the first
    // spelling seen — capitals before lower-case — which is arbitrary-looking but
    // TOTAL, and totality is the property that matters here.
    const values = tagFacetValuesOf([['Zebra', 'apple'], ['APPLE'], ['  '], []])
    expect(values.map(value => value.text), 'a tag was duplicated under a different case').toEqual(['Zebra', 'apple'])
    expect(values.map(value => value.key)).toEqual(['zebra', 'apple'])
    expect(tagFacetValuesOf([['b'], ['a']]).map(value => value.text), 'the same document gave two orders').toEqual(['a', 'b'])
  })

  it('the probe bites: a re-serialising editor is reported as one', () => {
    // Fed the copy the defect actually came from, inlined — the version that is
    // shorter and looks like the better one, because it goes through the parser
    // and therefore through its normalisation. A control written against today's
    // implementation would pass by accident the day the defect is fixed, and then
    // prove nothing for ever after. The positive arm uses the REAL editor, so
    // this also states that the shipped one is faithful.
    const wordsSurvived = (original: string, result: string): boolean => freeTextOf(result) === original
    const reSerialising = (text: string, token: string): string =>
      [...text.toLowerCase().split(/\s+/).filter(part => part !== token), token].join(' ')
    const typed = 'Gallery Work'
    expect(
      wordsSurvived(typed, withFacetToken(typed, 'status:open', true)),
      'the detector reports the real editor as a rewriter — this probe proves nothing',
    ).toBe(true)
    expect(
      wordsSurvived(typed, reSerialising(typed, 'status:open')),
      'a re-serialising editor passed as a faithful one',
    ).toBe(false)
  })
})

describe('a surface finds its OWN box, not the first one in the document', () => {
  /**
   * THE BOARD AND THE LIST SHARE ONE ATTRIBUTE, so "the first in the document"
   * is the wrong question. Both `TaskBoardPanel.tsx` and `item/panel.tsx` mark
   * their root `[data-dsh-taskboard-view]`, and the row was resolving it with
   * `document.querySelector`, which answers "whichever came first". While only
   * one surface is mounted that is the right box by luck; the moment both are in
   * the tree the menu is clamped to the board's rectangle and placed against a
   * surface that is not its own — the precise failure its own doc comment exists
   * to prevent. `useSurfaceNarrow` already resolves the same box with `closest`.
   */
  it('the row asks for its nearest ancestor rather than the document', () => {
    const source = code(read('client/item/row-line.tsx'))
    expect(
      source,
      'the row resolves this surface\'s own box from the document, and the board panel carries the same attribute',
    ).not.toMatch(/document\s*\.\s*querySelector[^\n]*data-dsh-taskboard-view/)
    expect(
      source,
      'the row no longer walks up to its own panel, so the menu has no box to be clamped inside',
    ).toMatch(/closest[^\n]*data-dsh-taskboard-view/)
  })

  it('the probe bites: a document-wide query is reported', () => {
    const detector = (source: string): boolean => /document\s*\.\s*querySelector[^\n]*data-dsh-taskboard-view/.test(source)
    expect(detector("panel.current = document.querySelector('[data-dsh-taskboard-view]')"), 'the probe did not bite').toBe(true)
    expect(detector("panel.current = rowRef.current?.closest('[data-dsh-taskboard-view]') ?? null"), 'a correct row is reported as broken').toBe(false)
  })
})

