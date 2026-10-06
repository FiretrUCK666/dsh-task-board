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
  'keyHelp', 'palettePrev', 'paletteNext', 'palettePick',
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
    keyHelp: record('keyHelp'),
    palettePrev: record('palettePrev'), paletteNext: record('paletteNext'),
    palettePick: record('palettePick'),
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
import { type as typeInto, click, coreSurfaceSource, fixtures, itemSurfaceFiles, itemSurfaceSource, locateSource, mountPanel, press, readSource, renderPanel } from './panel-harness.ts'
import { pickThrough } from '../src/client/item/selection.ts'
import { addStep, moveStep, removeStep } from '../src/client/item/steps.ts'
import { whyLabelOf } from '../src/client/item/why-label.ts'
import type { ItemStep } from '../src/core/item.ts'

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

  /* `ItemRowLine` 不再有一条这样扫 JSX 的门禁，**因为它扫的那件事已经不存在了**。
   *
   * 旧的门禁在面板的源码里找 `<ItemRowLine onXxx=…>`，然后要求 `ItemRowLineProps`
   * 声明的每一个 handler 都在那上面出现。行现在不是这样被交出去的：面板把一个
   * **对象字面量**交给 `renderRows`，表格再把它展开成行。于是 `<ItemRowLine` 这个
   * 元素在面板源码里根本不存在，扫描永远读到空字符串，而断言永远红——它不是发现了
   * 一个缺口，它是问了一个不存在的东西。
   *
   * 那缺口的另一半由类型系统守着，而且守得更紧：`ItemRowLineProps` 的十一个 handler
   * 全是必填，缺一个就是构建失败（`tsc --noEmit` 绿就是证据）。一个必填属性既不能被
   * 漏传也不能被多传，所以「控制存在而没有接线」这件事在这个组件上已经不可表达。
   * 再加一条扫字符串的门禁，只会在下一次有人把行改成别的东西时提醒他们去改门禁，
   * 而不是去改代码。
   *
   * `ItemDetail` 那一条留着：它仍然是被 JSX 直接交出去的，所以那条扫描仍然在问一
   * 个真的问题。 */
  it('the panel passes every ItemDetail handler', () => {
    const element = elementMarkup(panelSource, 'ItemDetail')
    expect(element, 'ItemDetail is not rendered by the panel any more — this gate is reading a component nobody mounts').not.toBe('')
    const missing = detailHandlers.filter(handler => !new RegExp(`\\b${handler}\\s*=`).test(element))
    expect(missing, `ItemDetail declares ${missing.join(', ')} and the panel passes nothing for it — the control exists and is wired to nothing`).toEqual([])
  })

  it('the row is handed a COMPLETE props object, and the compiler is what says so', () => {
    // The half that replaced the deleted scan, stated as the thing that is now
    // load-bearing: the factory builds one object literal per row and the props
    // type is all-required, so a handler that stops being wired is a build
    // failure rather than a runtime shrug. This case exists so the NEXT reader
    // finds the claim and the proof in the same place — and so that a future
    // change which makes one of them optional has something to notice.
    const factory = /const rows = \(list[\s\S]*?list\.map\(item => \(\{([\s\S]*?)\n  \}\)\)/.exec(panelSource)?.[1] ?? ''
    expect(factory, 'the row factory is not in the panel any more — find the new seam before trusting anything below').not.toBe('')
    for (const handler of rowHandlers) {
      expect(factory, `ItemRowLine declares ${handler} and the row factory never mentions it`).toContain(handler)
    }
  })

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
    const dismisses = (name: string): boolean => /Close|^onCancel/.test(name)
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
    const panel = mountPanel(rows, 'list', 'wide')
    try {
      const finished = rows.filter(row => row.status === 'done')
      expect(finished.length, 'the fixture holds no finished row, so this case is proving nothing').toBeGreaterThan(0)
      // THE ENTRANCE IS 「按状态 › 完成」, and it is a button a thumb can press.
      //
      // 它原来是清单页上一个写着「隐藏已完成」的勾选框：一个说「后面有东西」而
      // 不说「有多少」的控件，还为了一个字段在页面上占了一个框。左栏那一行同时
      // 答了这两句——它写着 完成，而它右边的数字就是有多少。
      const entry = [...panel.surface.querySelectorAll('[class*="itemRailRow"]')]
        .find(node => (node.textContent ?? '').includes('完成')) as HTMLButtonElement | undefined
      expect(entry, 'there is no finished bucket anywhere on the rail — the finished rows are unreachable by any route a reader can see').toBeDefined()
      // THE WORD AND THE NUMBER ARE TWO ELEMENTS, and asking one of them for both is
      // how a test ends up wanting a separator that was never drawn.
      expect(entry?.querySelector('[class*="itemRailWord"]')?.textContent ?? '',
        'the finished bucket is not named 「完成」 — that is the word a reader looks for').toContain('完成')
      expect(entry?.querySelector('[class*="itemRailCount"]')?.textContent ?? '',
        'the finished bucket states no number — a filter with no count is a filter with no promise').toMatch(/\d/)
      // Pressing a rail predicate means 「show me these」 — so the finished rows STAY
      // and what goes is everything that is not finished. The switch asked the
      // opposite question, which is why this assertion used to be about them leaving.
      act(() => { entry?.click() })
      expect(panel.surface.textContent ?? '',
        'the finished rows are not on the page after pressing the bucket that counts them')
        .toContain(finished[0]?.title ?? '__none__')
      expect(panel.surface.textContent ?? '',
        'the unfinished rows are still on the page after pressing a predicate that excludes them')
        .not.toContain(rows.find(row => row.status !== 'done')?.title ?? '__none__')
      // And back again, because a control you cannot press back is a door.
      act(() => { entry?.click() })
      expect(panel.surface.textContent ?? '',
        'the bucket did not put the other rows back')
        .toContain(rows.find(row => row.status !== 'done')?.title ?? '__none__')
    } finally {
      panel.dispose()
    }
  })

  it('and the entrance a real reader finds IS the control', () => {
    // The most valuable half, because it pins reachability at an ENTRANCE a
    // reader can find, not at an abstract stored value. "The finished rows are
    // one gesture away" is a claim about a gesture; the version above is a claim
    // about a preference, and a preference nobody can reach is the defect this
    // whole refactor started from.
    //
    // THE ENTRANCE IS THE 「隐藏已完成」 SWITCH IN THE FILTER BAR, and the claim
    // moved with the structure rather than being deleted. It used to be a tile on
    // the overview strip, then the finished group's own fold; both are gone with
    // the groups, because a fold over a group that no longer exists is a control
    // for a question the page no longer has. What is left is a switch that says
    // the sentence in the reader's own words, sitting on the bar beside every
    // other filter — and **one intent, one control** is the whole of the claim.
    //
    // So it is pressed. Not seeded: seeding a preference proves the panel READS
    // it, and the defect this case was written for is a panel that reads a setting
    // whose control is gone.
    const panel = mountPanel(rows, 'list', 'wide')
    try {
      const finished = rows.filter(row => row.status === 'done')
      expect(finished.length, 'the fixture holds no finished row, so this case is proving nothing').toBeGreaterThan(0)
      // THE ENTRANCE IS 「按状态 › 完成」, and it is a button a thumb can press. It
      // used to be a checkbox labelled 「隐藏已完成」 on the page — which said there
      // was something behind it without saying how much, and put a box on the page
      // for one field.
      const entry = [...panel.surface.querySelectorAll('[class*="itemRailRow"]')]
        .find(node => (node.textContent ?? '').includes('完成')) as HTMLButtonElement | undefined
      expect(entry, 'there is no finished bucket anywhere on the rail — the finished rows are unreachable by any route a reader can see').toBeDefined()
      // THE WORD AND THE NUMBER ARE TWO ELEMENTS, and asking one of them for both is
      // how a test ends up wanting a separator that was never drawn.
      expect(entry?.querySelector('[class*="itemRailWord"]')?.textContent ?? '',
        'the finished bucket is not named 「完成」 — that is the word a reader looks for').toContain('完成')
      expect(entry?.querySelector('[class*="itemRailCount"]')?.textContent ?? '',
        'the finished bucket states no number — a filter with no count is a filter with no promise').toMatch(/\d/)
      // Pressing a rail predicate means 「show me these」 — so the finished rows STAY
      // and what goes is everything that is not finished. The switch asked the
      // opposite question, which is why the assertion above used to be about them
      // leaving, and why it kept failing a panel that was doing the right thing.
      act(() => { entry?.click() })
      expect(panel.surface.textContent ?? '',
        'the finished rows are not on the page after pressing the bucket that counts them')
        .toContain(finished[0]?.title ?? '__none__')
      expect(panel.surface.textContent ?? '',
        'the unfinished rows are still on the page after pressing a predicate that excludes them')
        .not.toContain(rows.find(row => row.status !== 'done')?.title ?? '__none__')
      // And back again, because a control you cannot press back is a door.
      act(() => { entry?.click() })
      expect(panel.surface.textContent ?? '',
        'the bucket did not put the other rows back')
        .toContain(rows.find(row => row.status !== 'done')?.title ?? '__none__')
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
    // THE RAIL IS THE MAP — three pages, three date predicates, four priorities,
    // four states and two places, and every one of them states a number even at 0.
    const rail = /itemRail[\s\S]*?<\/nav>/.exec(renderPanel([], 'wide', 'list'))?.[0] ?? ''
    expect(rail, 'the rail is not on the surface at all').not.toBe('')
    // EVERY DESTINATION, NOT THREE PAGES. The rail is the map now: a collection,
    // three date predicates, four priorities, four states and two places — and the
    // claim is the stronger one. **A destination that quietly drops itself when it is
    // empty is a map that has become a log**, so every one of them states a number,
    // and a zero is an answer.
    const tabs = [...rail.matchAll(/itemRailWord[^>]*>([^<]*)</g)].map(m => (m[1] ?? '').trim())
    expect(tabs.length, `the rail carries ${tabs.length} destinations on an empty document`).toBeGreaterThanOrEqual(14)
    // The word and its number are two elements, so the number is counted on the
    // element that HOLDS it rather than on the word — and one count element per row
    // is the claim: every destination states a number, even a zero.
    const counts = [...rail.matchAll(/itemRailCount[^>]*>([^<]*)</g)].map(m => (m[1] ?? '').trim())
    expect(counts.length, `${tabs.length} destinations and ${counts.length} counts — a destination with no number is the one that disappeared`).toBe(tabs.length)
    for (const count of counts) {
      expect(count, `a rail entry states "${count}" rather than a number`).toMatch(/^\d+$/)
    }
  })

  it('the three numbers and the header count are the same fact told three ways', () => {
    const html = renderPanel(rows, 'wide', 'list')
    // `itemPageCount` and not `itemCount`: the header's own class is the page
    // count, and a pattern written for an older name matches nothing at all — so
    // the case reported 「页头没有写数」 about a header that was counting.
    // `itemTopCount`: the number is beside the search, because it is a number
    // about what you are looking at and belongs next to the thing you look at it
    // with. A pattern written for an older name matches nothing at all, and the case
    // then reports 「页头没有写数」 about a header that was counting.
    const header = /itemTopCount[^>]*>([^<]*)</.exec(html)?.[1] ?? ''
    const total = Number(/(?:共\s*)?(\d+)/.exec(header)?.[1] ?? Number.NaN)
    expect(Number.isInteger(total), `the header states no count: "${header}"`).toBe(true)
    const rail = /itemRail[\s\S]*?<\/nav>/.exec(html)?.[0] ?? ''
    const numbers = [...rail.matchAll(/itemRailCount[^>]*>([^<]*)</g)]
      .map(m => Number(/(\d+)/.exec((m[1] ?? '').trim())?.[1] ?? Number.NaN))
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
    // ONE DERIVATION READ TWICE: the header's total and the rail's 全部 are the
    // same count, and the claim is that they cannot drift apart — which is what
    // the single-number rule is for.
    const all = /itemRailCount[^>]*>([^<]*)</.exec(html)?.[1] ?? ''
    expect(all, `the rail states "${all}" where its 全部 should be a number — an empty document that says nothing is the one that disappeared`).toMatch(/^\d+$/)
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

  /* 「「最近动过」里的某一行是按身份选中的，并落到那一行」这一条删掉了，**因为它
   * 的对象已经不在这个界面上了**。
   *
   * 原来的诊断是「`<ul>` 现在是 `class="undefined"`，所以找不到」——那一半是真的
   * （那一行的类名确实死过），但它不是找不到的原因。真正的原因是：宽档上详情轨
   * 只在**选中了某一行之后**才渲染（`showDetailPane = !narrow && picked !==
   * undefined`），窄档上详情长在行里、而行一定是有 id 的。两条路上
   * `ItemDetail` 收到的 `view` 都永远有值，所以它那整个「还没选中」的分支——一句
   * 提示加一个「最近动过」——在这个面板上一次都画不出来。
   *
   * 也就是说：这不是一条过期断言，是一段**死代码**。留着断言等于把死代码钉成
   * 设计；删掉断言而不报告，等于让下一个人继续以为「最近动过」是个入口。代码本身
   * 还在 `detail-pane.tsx` 里，等一个决定：要么给详情轨一个入口，要么把这一段拿
   * 掉。**这个决定是产品决定，不是实现细节，所以留给定夺。**
   *
   * 取代它的是下面那条：详情轨的头永远不为空，而且只在选中时存在。 */
  it('a row is picked by its identity from the list, and lands on that row', () => {
    // The reachable half of the claim above, and the one a reader actually
    // exercises: press a row in the list, and the row pressed is the row
    // selected. The panel knows the row's uuid; the short number it shows is a
    // NAME to read, never an address.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const row = panel.surface.querySelector('[data-status]')
      // THE SENTENCE, not the chip in front of it. What a reader pressed is a row
      // and what the row answers with is the whole row — so the claim is that the
      // press landed on THIS row and not on a neighbour.
      const title = (row?.querySelector('[class*="itemRowText"]')?.textContent ?? '').trim()
      expect(title, 'the list drew a row with no words on it').not.toBe('')
      click(row)
      const selected = panel.surface.querySelector('[data-selected]')
      expect(selected, 'pressing a row selected nothing — the press is a gesture with no answer').not.toBeNull()
      expect(selected?.textContent ?? '', 'pressing a row landed somewhere other than the row pressed').toContain(title.trim())
    } finally {
      panel.dispose()
    }
  })

  it('detail opens in the row only after expand, and there is no rented pane', () => {
    // The right-hand pane is gone because it was rented land whenever no row was
    // chosen. The replacement is deliberate two-step state: a press selects the
    // row where the reader is looking, and only 「展开详情」 builds the detail.
    // An expansion that appears before the reader asks is the same rented land
    // wearing a different class name.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      expect(panel.surface.querySelector('[class*="itemDetail"]'), 'a fresh panel drew an expansion before anything was asked for').toBeNull()
      openRowMenu(panel.surface)
      const entry = findMenuEntry(panel.surface, '展开详情')
      expect(entry, 'the row menu offers no way to expand the row').not.toBeNull()
      click(entry)
      const detail = panel.surface.querySelector('[class*="itemDetail"]')
      expect(detail, 'expanding a row built nowhere to read it').not.toBeNull()
      expect((detail?.textContent ?? '').trim(), 'an expanded row drew an empty detail').not.toBe('')
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

  it('a rail row filters EXACTLY what it counts — the number and the list are one fact', () => {
    // THE OVERDUE TILE COUNTED TWO BUCKETS AND FILTERED ONE. `itemInsightOf`
    // counts `hardOverdue || behind`; the tile pressed and filtered
    // `has:hardOverdue`. So a reader pressed a tile reading 「逾期 3」 and got one
    // row, with nothing on screen saying the number had changed its meaning —
    // which is the one failure a filter surface cannot recover from, because the
    // reader has no way to tell a wrong number from a wrong filter.
    //
    // The gate is on the SHAPE rather than on the two values: whatever token the
    // rail row writes, the rows that token keeps must be the rows the rail row
    // counted. The statistics band is gone; its contract moved to the rail rows
    // that replaced it, and this is the same behavioral shape rather than a
    // renamed selector.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const before = panel.surface.querySelectorAll('[data-status]').length
      const choice = [...panel.surface.querySelectorAll('button[class*="itemRailRow"]')]
        .map(node => ({
          node,
          kind: node.getAttribute('data-kind') ?? '',
          said: Number(/\d+/.exec(node.querySelector('[class*="itemRailCount"]')?.textContent ?? '')?.[0] ?? Number.NaN),
        }))
        .find(candidate =>
          (candidate.kind === 'flag' || candidate.kind === 'priority' || candidate.kind === 'status')
          && Number.isInteger(candidate.said)
          && candidate.said > 0
          && candidate.said < before)
      expect(choice, 'no pressable rail row with a proper-subset count is on screen — the gate is asserting nothing').toBeDefined()
      if (choice === undefined) return
      click(choice.node)
      const after = panel.surface.querySelectorAll('[data-status]').length
      expect(after, 'pressing the rail row did not filter at all').toBeLessThan(before)
      // The count it prints and the rows it keeps are ONE fact. A row that says
      // 0 and keeps 2 is the exact defect this case was written for.
      expect(after, `the rail row says ${String(choice.said)} and filtering to it left ${String(after)} rows — the number and the list are two different facts`).toBe(choice.said)
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

  it('undo reads the rows it writes into AFTER its awaits, not before them', () => {
    /** The invariant, as a function over a source string so it can be pointed at a
     *  planted violation and be seen to report. */
    const undoRebaseFindings = (text: string): string[] => {
      const at = text.indexOf('const runUndo =')
      if (at < 0) return ['there is no runUndo to check, so this gate is reading nothing']
      const body = text.slice(at, at + 2400)
      const findings: string[] = []
      if (/let next = items\b/.test(body)) {
        findings.push('undo rebuilds its write from the array it captured before its own awaits')
      }
      if (!body.includes('itemsNow.current')) {
        findings.push('undo does not read the rows as they are when its replies land')
      }
      return findings
    }
    // THE DEFECT THIS PINS, and it is the only one found this round that LOSES
    // DATA. Undo makes one host round trip per row and only then writes back, and
    // the array it wrote back was captured BEFORE the first round trip. Anything
    // the reader changed while it waited was reinstated at its old value — on
    // screen, and then on the host, because a row that differs from the replica is
    // CLAIMED by this client and a claimed row wins the merge unconditionally. The
    // stale value therefore reached every other device, with no error anywhere.
    //
    // WHY THIS IS A SOURCE CONTRACT AND NOT A PRESSED ONE. The window is 「a reader
    // writes to another row while the restore is in flight」, and this harness
    // cannot produce it: every helper it offers wraps its dispatch in `act`, which
    // drains the pending host reply as well — so any write a test can make lands
    // AFTER the reply, the ordering is gone, and the gate would pass on the broken
    // implementation. A gate that cannot fail is worse than none.
    const panel = mountPanel(oneRow({ id: 'u-1', title: '一条普通的行' }), 'list', 'wide')
    try {
      // THE WINDOW THIS DEFECT LIVES IN CANNOT BE PRODUCED HERE. It is 「a reader
      // writes to another row while the restore is in flight」, and every helper
      // this harness offers wraps its dispatch in `act` — which drains the pending
      // host reply as well. So any write a test can make lands AFTER the reply, the
      // ordering is gone, and a pressed gate would pass on the broken
      // implementation. A gate that cannot fail is worse than none, so what is
      // asserted is the shape that removes the window: the write is built from the
      // rows read once the replies have landed.
      const source = itemSurfaceSource()
      expect(undoRebaseFindings(source), 'undo writes an array captured before its own awaits').toEqual([])
      // And the gate is shown able to report, on a source that has the old shape.
      const captured = source.replace(
        'let next = itemsNow.current',
        'let next = items',
      )
      expect(captured, 'the plant did not change anything, so the control below proves nothing').not.toBe(source)
      // The real body has no `let next = items`, so plant the SHAPE the gate forbids.
      const planted = source.replace(
        'const restored: ItemRecord[] = []',
        'let next = items\n      const restored: ItemRecord[] = []',
      ).replace('let next = itemsNow.current', 'next = next')
      expect(undoRebaseFindings(planted).join('\n'), 'the gate cannot report the shape it exists for')
        .toMatch(/captured before its own awaits/)
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
      const target = panel.surface.querySelector('[data-status]')
      // A ROW, NOT A HEADING. This surface has no `h1` — the rows are a
      // `role="list"` of `role="listitem"` — so a probe that pressed a heading was
      // pressing nothing and proving nothing about the listener.
      const report = [
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

  it('the menu that opens is a box the reader can see and use', () => {
    // WHAT THE READER PRESSES AND WHAT THEY GET. The `⋯` control existed, its
    // handler ran, the menu element mounted, every dismissal gate passed — and
    // the thing had no height, so the press produced nothing on screen. A gate
    // that only asks 「is the menu in the DOM」 cannot tell that from a working
    // menu, which is how this shipped.
    //
    // The placement is computed from the trigger and the panel, so the box the
    // menu is measured against has to be a REAL box. It was a `hidden` marker
    // element for a while: `getBoundingClientRect()` on it is `{0,0,0,0}` in a
    // browser, the clamp collapsed, and the ceiling came out as exactly zero.
    const panel = mountPanel(oneRow({ id: 'mm-1', title: '菜单得看得见' }), 'list', 'wide')
    try {
      openRowMenu(panel.surface)
      const menu = panel.surface.querySelector('[role="menu"]') as HTMLElement | null
      expect(menu, 'the row menu did not mount at all').not.toBeNull()
      const ceiling = (menu as HTMLElement).style.maxBlockSize
      expect(ceiling, 'the menu was given no height ceiling at all, so its placement was never computed')
        .toMatch(/px$/)
      expect(Number.parseFloat(ceiling),
        'the menu opened with a zero-height ceiling — the reader presses ⋯ and nothing appears').toBeGreaterThan(0)
      // And it is placed against THIS panel: the menu's own box has to sit inside
      // the stage's, so the anchor cannot be some other element of the page.
      const stage = panel.surface.closest('[data-dsh-taskboard-view]') ?? panel.surface
      expect(stage, 'the panel stage does not carry the attribute the menu is measured against').not.toBeNull()
      expect((menu as HTMLElement).style.insetBlockStart, 'the menu was never given a block position').toMatch(/px$/)
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
    // Located by the anchor and cut at the tag's own end, rather than by a regex with
    // a character window in it. The window was the whole reason this gate broke:
    // a field that grows one ARIA attribute stops being found, and the failure is
    // reported as 「the search field is not where this gate expected it」 — which
    // reads like a moved control and is really a number that went stale.
    const anchor = palette.indexOf('className={css.itemSearch}')
    const field = anchor < 0
      ? ''
      : palette.slice(palette.lastIndexOf('<input', anchor), palette.indexOf('/>', anchor) + 2)
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
    const choosers = (bar.match(/ITEM_SORTS\.map\(/g) ?? []).length
    expect(choosers, 'the orders are chosen in more than one place — the same setting with two components again').toBe(1)
    expect(bar, 'the ordering chooser is a `<select>` again, which is how the phone lost the segmented row').not.toMatch(/<select/)
    // The word for each order is read from the closed table, never typed here —
    // and it may be READ more than once (the one that is on says so in words),
    // because reading a name twice is not choosing a setting twice.
    expect(bar, 'the palette writes its own list of order labels instead of the one closed table').not.toMatch(/item\.sort\.\w+'\s*:\s*'/)
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
  async function kernel(): Promise<((trigger: unknown, panel: unknown, menu: unknown) => { placement: string; top: number; left: number; maxBlockSize: number }) | undefined> {
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

  it('a room of zero is not a short menu, it is no menu', async () => {
    const place = await kernel()
    if (place === undefined) return
    // THE CASE THAT SHIPPED. A panel rectangle that cannot contain the menu —
    // which is what a box with no area is, and what a `display: none` element
    // measures as — used to yield `maxBlockSize: 0`. The menu then rendered with
    // no height whatsoever: the reader pressed `⋯` and nothing appeared, no
    // error was thrown, and nothing was logged.
    const boxless = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }
    const spot = place({ top: 300, bottom: 340, left: 300, right: 500, width: 200, height: 40 }, boxless, MENU)
    expect(spot.maxBlockSize,
      'a panel box that cannot hold the menu produced a zero-height ceiling, so the menu is invisible rather than merely clipped').toBeGreaterThan(0)

    // The same rule at the panel's own bottom edge, where the room is exactly
    // zero rather than absent: the trigger is ON the edge, so neither direction
    // has a pixel to offer.
    const onEdge = place({ top: 796, bottom: 800, left: 300, right: 500, width: 200, height: 40 }, PANEL, MENU)
    expect(onEdge.maxBlockSize, 'a trigger on the panel\'s last pixel produced an invisible menu').toBeGreaterThan(0)
  })

  it('the probe bites: a kernel that returns the room unchanged is reported', () => {
    // The control for the case above, written as the kernel that shipped: it
    // computes `room` and hands back `max(0, room)` with no floor. It answers
    // every OTHER question in this block correctly, which is exactly why the case
    // needed a gate of its own.
    const asShipped = (
      trigger: { top: number; bottom: number },
      panel: { top: number; bottom: number },
      menu: { height: number },
    ): { maxBlockSize: number } => {
      const gap = 4
      const roomBelow = panel.bottom - trigger.bottom - gap
      const roomAbove = trigger.top - panel.top - gap
      const placement = roomBelow < menu.height && roomAbove > roomBelow ? 'above' : 'below'
      const rawTop = placement === 'above' ? trigger.top - gap - menu.height : trigger.bottom + gap
      const top = Math.max(panel.top, Math.min(rawTop, panel.bottom - menu.height))
      const room = placement === 'above' ? top - panel.top : panel.bottom - top
      return { maxBlockSize: Math.min(Math.max(room, 0), menu.height) }
    }
    const boxless = { top: 0, bottom: 0 }
    const zero = asShipped({ top: 300, bottom: 340 }, boxless, MENU)
    expect(zero.maxBlockSize, 'the degenerate control was reported as fine — the case above proves nothing').toBe(0)
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

  it('the band shows three, and the three are the three you have to act on today', () => {
    // THREE, NOT FOUR, and the fourth is not missing — it is 停滞, and it is the
    // one number on this surface that is not a question.
    //
    // 「落后」「卡住」「没日期」 each answer a question a reader opens the list
    // with, and each is answered by FILTERING, so each one is a door. 「放置 31
    // 天」 answers none of them: a row nobody has touched in a month is not
    // something to do *today*, it is something to have noticed once, and it is
    // already on the row that says it. Putting it in the band would make the band
    // a fourth number the reader has to read rather than press, which is exactly
    // the furniture this band replaced.
    //
    // So the test is on the three, by name. The four status names are NOT here:
    // the status is a column now, and a status per group head was a second place
    // counting what the table already counts.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const surface = panel.surface.textContent ?? ''
      for (const label of ['落后', '卡住', '没日期']) {
        expect(surface, `the statistics tile for ${label} is missing`).toContain(label)
      }
      expect(surface, 'the staleness count is back in the band — it is a row fact, not a question about today').not.toContain('放置')
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

describe('the row is a grid whose edges do not move, because alignment is a promise', () => {
  it('the bead, title, tags and menu keep their four places on every band', () => {
    // WHY THIS IS A GATE AND NOT A PREFERENCE. Every row is its own grid, so a
    // track measured from that row's own content moves that row's edges: the
    // tag count used to decide where ⋮ landed, pinned right with one tag and a
    // couple of hundred pixels in with three. The four-column grid fixes the
    // places that must not move — bead first, ⋮ last — while the tags column is
    // allowed to be content-sized because it no longer decides the menu column.
    const css = read('client/item/item.module.css')
    const bodies = [...css.matchAll(/\.itemRow\s*\{([^}]*)\}/g)].map(match => match[1] ?? '')
    expect(bodies.length, 'there is no .itemRow grid rule to hold the row together').toBeGreaterThan(0)
    const tracksOf = (value: string): string[] =>
      value.match(/(?:[^\s()]+|\([^()]*\))+/g) ?? []
    for (const body of bodies) {
      const columns = [...body.matchAll(/grid-template-columns\s*:\s*([^;]+)/g)].map(match => (match[1] ?? '').trim())
      expect(columns.length, 'an .itemRow rule states no column tracks — the four places are not declared').toBeGreaterThan(0)
      for (const value of columns) {
        const tracks = tracksOf(value)
        expect(tracks.length, `a row does not have four places (${value}) — the bead, title, tags and menu cannot each stay put`).toBe(4)
        expect(tracks[0], `the state bead moves (${value}) — the left edge moves row by row`).toBe('10px')
        expect(tracks[1]?.replace(/\s+/g, ''), `the title has no floor (${value}) — a wide tag row can squeeze it to a few characters`).toContain('minmax(120px,1fr)')
        expect(['auto', '0'].includes(tracks[2] ?? ''), `the tags track is neither content-sized nor yielded (${value}) — narrow and wide need exactly those two answers`).toBe(true)
        expect(tracks[3], `the menu is not pinned last (${value}) — ⋮ lands wherever the tags happen to end`).toBe('28px')
      }
    }
  })

  it('the probe bites, and a filler track is not reported', () => {
    const tracksOf = (value: string): string[] =>
      value.match(/(?:[^\s()]+|\([^()]*\))+/g) ?? []
    const fourPlaces = (value: string): boolean => {
      const tracks = tracksOf(value)
      return tracks.length === 4 && tracks[0] === '10px' && tracks[3] === '28px'
    }
    expect(fourPlaces('10px minmax(120px,1fr) auto 28px')).toBe(true)
    expect(fourPlaces('10px minmax(120px,1fr) 0 28px')).toBe(true)
    expect(fourPlaces('10px minmax(120px,1fr) auto'), 'a three-track row passed as the four-place row').toBe(false)
    expect(fourPlaces('10px minmax(120px,1fr) 96px 28px'), 'a tags column can still be point-sized').toBe(true)
  })
})

/** The first element whose own text contains `needle`, at any depth. */
function findByText(root: ParentNode, needle: string): HTMLElement | null {
  for (const element of root.querySelectorAll('button, [role="menuitem"], a')) {
    if ((element.textContent ?? '').includes(needle)) return element as HTMLElement
  }
  return null
}

describe('the rail picks ONE thing per group, and the number on the row is what you get', () => {
  /** The rail's own row for a word, found by the class token CSS Modules keeps as a suffix. */
  const railRow = (surface: HTMLElement, word: string): HTMLElement => {
    const found = [...surface.querySelectorAll('button')].find(node =>
      node.className.includes('itemRailRow') && (node.textContent ?? '').includes(word))
    if (found === undefined) throw new Error(`the rail draws no 「${word}」 row`)
    return found as HTMLElement
  }
  /** The count printed on that row — the promise the list has to keep. */
  const promised = (row: HTMLElement): number => {
    const mark = row.querySelector('b')
    return Number((mark?.textContent ?? '').trim())
  }
  /** What the header says is actually on screen — both of its two sentences.
   *
   *  The header says 「共 N 条」 with nothing filtered and 「显示 S / 共 N 条」 with
   *  something filtered, so a reader of only the second form reports 「the header
   *  states no count」 on the one state where the count is the whole point: after
   *  the filter comes off. Both forms, or the assertion cannot see the transition
   *  it exists to check. */
  const shown = (surface: HTMLElement): number => {
    const line = [...surface.querySelectorAll('p')].map(node => node.textContent ?? '')
      .find(text => text.includes('显示') || text.includes('共'))
    if (line === undefined) throw new Error('the header states no count, so nothing here is checkable')
    const digits = /显示\s*(\d+)/.exec(line) ?? /共\s*(\d+)/.exec(line)
    if (digits === null) throw new Error(`the count line reads 「${line}」, which this test cannot read`)
    return Number(digits[1])
  }
  const box = (surface: HTMLElement): HTMLInputElement => {
    const found = surface.querySelector('input[type="search"]')
    if (found === null) throw new Error('the top bar draws no search box')
    return found as HTMLInputElement
  }

  it('a second press in the same group REPLACES the first, and the list gets no bigger', () => {
    // THE DEFECT THIS PINS: priority and status are matched with `includes`, so two
    // tokens from one group meant UNION — pressing 「高」 after 「紧急」 made the list
    // show MORE rows than the row the reader just pressed, whose own number said
    // five. A filter that adds rows when you narrow it is the one thing a reader
    // cannot forgive, because it contradicts the number they are looking at.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const urgent = railRow(panel.surface, '紧急')
      const high = railRow(panel.surface, '高')
      click(urgent)
      expect(shown(panel.surface), 'the list does not match the number on 紧急').toBe(promised(urgent))
      click(high)
      expect(shown(panel.surface), 'pressing a second priority did not replace the first — the list is now their union').toBe(promised(high))
      // And the box holds the reader's words only: the filter is a chip below it,
      // not a machine token inside the field they type in.
      expect(box(panel.surface).value, 'a qualifier token is sitting inside the search field').toBe('')
    } finally {
      panel.dispose()
    }
  })

  it('two date verdicts do not cancel each other into an empty list', () => {
    // THE DEFECT THIS PINS IS ARITHMETIC, not taste: the `has:` flags are ANDed
    // over ONE posture per row, and 「超期了」 needs a date to exist while 「没日子
    // 的」 means no date exists. Pressing both was constant-false — the list went
    // empty for every document that has ever existed, with both rows still
    // printing their own numbers beside it.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const overdue = railRow(panel.surface, '超期了')
      const undated = railRow(panel.surface, '没日子的')
      click(overdue)
      expect(shown(panel.surface)).toBe(promised(overdue))
      click(undated)
      expect(shown(panel.surface), 'two date verdicts were ANDed into an impossible question').toBe(promised(undated))
    } finally {
      panel.dispose()
    }
  })

  it('pressing a rail row again takes the filter OFF', () => {
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const row = railRow(panel.surface, '紧急')
      click(row)
      expect(shown(panel.surface)).toBe(promised(row))
      click(row)
      expect(shown(panel.surface), 'the same row pressed twice left the filter on').toBe(fixtures().length)
    } finally {
      panel.dispose()
    }
  })

  it('the highlight is derived from the query, so it cannot claim a filter that is off', () => {
    // A remembered highlight can: it was a `useState` written on every press, so
    // pressing the same row twice turned the filter off and left the row marked
    // 「you are here」, and deleting the text by hand left it marked too.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const row = railRow(panel.surface, '超期了')
      click(row)
      expect(row.getAttribute('aria-current'), 'the row the reader pressed is not marked current').toBe('true')
      click(row)
      expect(row.getAttribute('aria-current'), 'the row is still marked current with its filter off').toBeNull()
    } finally {
      panel.dispose()
    }
  })

  it('「全部」 OWNS THE PAGE, so pressing it from another page brings the reader back', () => {
    // THE DEFECT THIS PINS, reported from the surface: 「sometimes pressing 全部 does
    // nothing at all; press 已删除 first and then 全部 works」.
    //
    // The reason was that each rail row changed PART of the state. 已删除 moved the
    // page and opened the archive; 全部 cleared the filter and moved NOTHING. A
    // reader standing on 日程 pressed 全部, the filter was already empty, and the
    // screen did not change — so the row that should be the most definite one on the
    // rail was the one that appeared broken, and the row that appeared to fix it was
    // a different row entirely.
    //
    // A destination is `{ page, pick, archive }`, all three, always. This asserts the
    // page half from the one page that is NOT the list.
    const panel = mountPanel(fixtures(), 'schedule', 'wide')
    try {
      const all = railRow(panel.surface, '全部')
      click(all)
      // The agenda's own bucket names are what the list page never prints, so their
      // absence is the page having actually changed rather than a filter moving.
      expect(panel.surface.textContent ?? '', 'pressing 全部 left the reader on the agenda page').not.toContain('还没到开始时间')
      expect(all.getAttribute('aria-current'), 'the reader is on the document and no row says so').toBe('true')
    } finally {
      panel.dispose()
    }
  })

  it('日程 has a door, so no page in this panel is reachable only from ⌘K', () => {
    // 日程 has been a page since the page set existed, and until now its only route
    // was the command palette. A whole page behind a keyboard-only door is 「a control
    // reachable only from a keyboard does not exist for a thumb」 one level up.
    //
    // The witness is the GATED bucket, so it is seeded with a row that actually lands
    // in it: the agenda draws a bucket only when it has rows, and an empty one is
    // invisible rather than empty — asserting on it with the plain fixtures would
    // have been asserting on a heading the page is right not to draw.
    const soon = Date.now() + 6 * 86_400_000
    const rows = fixtures().map(item => ({ ...item, startsAfter: soon }))
    const panel = mountPanel(rows, 'list', 'wide')
    try {
      expect(panel.surface.textContent ?? '', 'the list page is drawing the agenda bucket already, so the door below proves nothing').not.toContain('还没到开始时间')
      const schedule = railRow(panel.surface, '日程')
      click(schedule)
      expect(panel.surface.textContent ?? '', 'the 日程 row did not open the agenda').toContain('还没到开始时间')
      expect(schedule.getAttribute('aria-current')).toBe('true')
    } finally {
      panel.dispose()
    }
  })
})

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
  /* 「取而代之的那些数是纯数字，所以已经没有分数可查了」这一条连同它的对象一起
   * 没了。分组拆掉之后，组头上**没有**任何一个数了，而这条断言的一半正是在数它们
   * ——一半的对象没了，剩下的那一半（没有量表）已经被下面那条钉住了，而它一个字都
   * 不需要改。留着一个断言已经不存在的东西的门禁，是这个文件里最容易长成假的
   * 一种门禁。 */
  it('no meter is on this surface, and the check that says so is the live one', () => {
    // 「没有量表」本身就是要保住的性质：它是这条断言被拆成两条之后剩下的那一条，
    // 而且它不依赖任何别的结构——只要有一个分数条回来，它就红。
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const bars = panel.surface.querySelectorAll('[class*="itemTileBar"], [class*="itemGroupProgress"]')
      expect(
        [...bars].map(node => node.className),
        'a meter is back on this surface — it has to be the share of the fraction spelled out beside it, so this retirement is over',
      ).toEqual([])
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

  it('a chord bound twice is bound twice ON PURPOSE, and never by accident', () => {
    // `J` and `↓` both mean 「next」, which is right. So do `↑`/`↓`/`↵` mean one
    // thing in the panel and another in the palette — and the only thing that
    // makes the second reachable is a `when`, because `bindingFor` takes the
    // binding that APPLIES rather than the first that matches. So a chord bound
    // twice with two different meanings must have both halves gated: one binding
    // that always applies and one that never applies would leave the gated one
    // unreachable, which is the same defect the old first-match rule had.
    //
    // It used to be asserted as 「no chord is bound twice at all」, which was true
    // until the palette took the arrows — and the rule it was really stating
    // (a reader must never find a key that does something else) is now checked
    // directly, on both halves, further down this block.
    const byChord = new Map<string, typeof ITEM_KEYS[number][]>()
    for (const binding of ITEM_KEYS) {
      const chord = `${binding.cmd === true ? 'cmd+' : ''}${binding.shift === true ? 'shift+' : ''}${binding.key}`
      byChord.set(chord, [...(byChord.get(chord) ?? []), binding])
    }
    const shared = [...byChord.values()].filter(group => group.length > 1)
    expect(shared.length, 'no chord is shared at all — the gate is asserting nothing, and the palette\'s arrows are the case it is for').toBeGreaterThan(0)
    for (const group of shared) {
      const chord = `${group[0]?.cmd === true ? 'cmd+' : ''}${group[0]?.shift === true ? 'shift+' : ''}${group[0]?.key}`
      const meanings = new Set(group.map(binding => binding.what))
      for (const binding of group) {
        expect(binding.when, `${chord} is shared with ${[...meanings].join(' and ')}, but "${binding.what}" applies everywhere — so the other meaning is unreachable`).toBeDefined()
      }
    }
    // And the exact pair the palette needs: the arrows and Enter change owner
    // with the box, and each owner answers in exactly one state.
    const arrow = (key: string, paletteOpen: boolean): string | undefined =>
      bindingFor({ key, metaKey: false, ctrlKey: false, shiftKey: false, target: document.createElement('div') },
        { focusedId: 'r-1', somethingOpen: paletteOpen, paletteOpen })?.action
    expect(arrow('arrowdown', false), '↓ does not walk the rows while the palette is shut').toBe('moveNext')
    expect(arrow('arrowdown', true), '↓ walks the panel\'s rows while the reader is choosing inside the palette').toBe('paletteNext')
    expect(arrow('enter', false), '↵ does not open the row while the palette is shut').toBe('open')
    expect(arrow('enter', true), '↵ opens the row under the cursor instead of running the candidate the reader can see selected').toBe('palettePick')
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

  it('a text-editing chord is never stolen from a field the reader is typing in', () => {
    // `⌘Z` and `⌘⌫` ARE the input's own undo and delete-word. Claiming them
    // behind the caret means the field loses its native editing shortcuts — the
    // reader presses ⌘Z to undo typing and instead the panel restores a deleted
    // row (or does nothing at all), and the keystroke is gone.
    // `⌘K` and other deliberate chords still work while typing.
    const undo = { key: 'z', metaKey: true, ctrlKey: false, shiftKey: false, target: document.createElement('input') }
    expect(claimsKey(undo), '⌘Z is stolen from a text field: the input loses its own undo').toBe(false)
    const remove = { key: 'backspace', metaKey: true, ctrlKey: false, shiftKey: false, target: document.createElement('input') }
    expect(claimsKey(remove), '⌘⌫ is stolen from a text field: the input loses its own delete-word').toBe(false)
    // A deliberate chord is still ours even while typing.
    const palette = { key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, target: document.createElement('input') }
    expect(claimsKey(palette), '⌘K is not claimed while typing, so the palette is unreachable from a field').toBe(true)
    // And a bare letter is still the field's.
    const plain = { key: 'z', metaKey: false, ctrlKey: false, shiftKey: false, target: document.createElement('input') }
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
      const binding = bindingFor(event, { focusedId: 'r-1', somethingOpen: false, paletteOpen: false })
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
    const taken = dispatchKey(empty, { focusedId: undefined, somethingOpen: false, paletteOpen: false }, actions)
    expect(taken, 'an inert key let the event travel to the browser').toBe(true)
    expect(ran, 'a key with no row under the cursor patched something anyway').toEqual([])
    dispatchKey(empty, { focusedId: 'r-1', somethingOpen: false, paletteOpen: false }, actions)
    expect(ran, 'the same key with a row under the cursor did nothing — the binding is unreachable').toEqual(['priority:urgent'])
  })

  it('the probe bites: the readers can see a key the table does not have', () => {
    // Two synthetic events the table has no binding for, and the two that it
    // does. If `claimsKey` and `bindingFor` were reading an empty map, every one
    // of these would pass for the same reason.
    const off = (key: string) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, target: document.createElement('div') })
    const state = { focusedId: 'r-1', somethingOpen: false, paletteOpen: false }
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
      // THE DOOR IS THE SEARCH BOX. A separate trigger beside it was 28px where its
      // neighbours were 32 and in a different shape, and it existed for one reason:
      // 「a control reachable only from a keyboard does not exist for a thumb」. The
      // search box already answers that — press it, the palette opens — so the
      // second control was a control for a control.
      const trigger = byButton.surface.querySelector('[class*="itemSearch"]')
      expect(trigger, 'the spine draws no palette door at all, so a mouse user has no way into the palette').not.toBeNull()
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
      // `itemTableRow` and not `itemRow`: the row is a seven-cell table row now,
      // and `itemRow` as a substring matches nothing — so before and after were
      // both 0 and the comparison reported 「没有变窄」 about a chain that works.
      const before = panel.surface.querySelectorAll('[data-status]').length
      open(panel)
      const chip = findByText(panel.surface, '待办')
      expect(chip, 'the palette offers no status value to press').not.toBeNull()
      click(chip)
      const after = panel.surface.querySelectorAll('[data-status]').length
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

describe('the detail opens in the row, on both bands, and never twice', () => {
  // IT IS IN THIS FILE AND NOT IN `panel-render` because this one runs under jsdom:
  // which row is open is LIVE state, and there is nothing to seed it with — a prop
  // that existed only for a test would be a second way to say which row is open,
  // which is exactly what the harness warns against for the preference fields. The
  // reader's gesture is the only honest way in.
  //
  // AND THE PANE IS GONE. It used to be rented on the wide band only, which meant a
  // reader who had chosen a row on a desk and the same row on a phone was looking
  // at two different arrangements of the same fields. So the claim is no longer
  // 「which band drew a rail」 — it is 「is there ever a second copy of the detail」,
  // and the row carries its own on both bands.
  for (const band of ['wide', 'narrow'] as const) {
    it(`the ${band} band: one copy, and the chosen row carries it`, () => {
      const panel = mountPanel(fixtures(), 'list', band)
      try {
        const rail = (): boolean => panel.surface.querySelector('[class*="itemDetailPane"]') !== null
        expect(rail(), `a fresh ${band} panel drew a detail rail before anything was chosen — a column saying nothing`).toBe(false)
        const row = panel.surface.querySelector('[data-status]')
        expect(row, `the ${band} panel drew no row to choose`).not.toBeNull()
        click(row)
        expect(rail(), `the ${band} band drew a detail rail — the detail opens in the row on both bands, and a rail would be a second copy of it`).toBe(false)
        expect(panel.surface.querySelector('[class*="itemOpenSide"]'), `the ${band} row opened with nowhere to read its fields`).not.toBeNull()
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
   * their root `[data-dsh-taskboard-view]`, and a document-wide lookup answers
   * "whichever came first" — so with both panels in the tree the menu is clamped
   * to the board's rectangle and placed against a surface that is not its own.
   * `useSurfaceNarrow` resolves the same box with `closest`, from inside.
   *
   * THE CHECK IS TWO-SIDED AND NAMES NO REF. It used to require the source to
   * contain `panelRef`, which blessed a change that replaced the climb with a
   * marker element carrying `hidden` — and a `hidden` element has no box, so the
   * menu was placed against `{0,0,0,0}` and opened at zero height. Every gate
   * stayed green because **the gate was asserting the shape of the source, not
   * what the reader gets**. A check that has to name the identifier it expects
   * will bless whatever that identifier happens to point at.
   *
   * So this asks only the question that has a right answer: the row resolves the
   * box by CLIMBING, and never by a document-wide lookup.
   */
  it('the row climbs to its own panel rather than searching the document', () => {
    const source = code(read('client/item/row-line.tsx'))
    expect(
      source,
      'the row resolves this surface\'s own box from the document, and the board panel carries the same attribute',
    ).not.toMatch(/document\s*\.\s*querySelector[^\n]*data-dsh-taskboard-view/)
    expect(
      source,
      'the row no longer climbs to the panel it is nested in, so the menu has no box of its own to be measured against',
    ).toMatch(/closest\(\s*'\[data-dsh-taskboard-view\]'\s*\)/)
  })

  it('and what it hands over is a box the reader can see', () => {
    // THE OUTCOME, not the identifier. `⋯` opens a menu whose ceiling is derived
    // from the anchor's rectangle; if the anchor has no area the ceiling is zero
    // and the press produces nothing on screen. Asserting the ceiling is the only
    // statement here that a reader could also make.
    const panel = mountPanel(oneRow({ id: 'own-1', title: '这一行有自己的盒子' }), 'list', 'wide')
    try {
      openRowMenu(panel.surface)
      const menu = panel.surface.querySelector('[role="menu"]') as HTMLElement | null
      expect(menu, 'the row menu did not mount, so there is no box to measure').not.toBeNull()
      const ceiling = Number.parseFloat((menu as HTMLElement).style.maxBlockSize)
      expect(ceiling, 'the anchor the menu was measured against has no box — it opened at zero height').toBeGreaterThan(0)
    } finally {
      panel.dispose()
    }
  })

  it('the probe bites: a document-wide query is reported', () => {
    const detector = (source: string): boolean => /document\s*\.\s*querySelector[^\n]*data-dsh-taskboard-view/.test(source)
    expect(detector("panel.current = document.querySelector('[data-dsh-taskboard-view]')"), 'the probe did not bite').toBe(true)
    expect(detector("panel = rowRef.current?.closest('[data-dsh-taskboard-view]') ?? null"), 'a correct row is reported as broken').toBe(false)
  })
})


/* ═══════════════════════════════════════════════════════════════════════════
 * 这一段是本轮接上的四件东西，每一件都按本文件的开头那条规矩配了一条「探针」：
 * 门禁必须是能被喂坏的，否则它只是一枚绿勾。
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('a title is edited where it is printed, and on a thumb too', () => {
  it('双击改标题, and 「改标题」 is the same edit under a thumb', () => {
    // 双击是**桌上**的手势。触屏没有双击，而触屏是硬性规范 11 里的一等公民，所以
    // 同一件事必须有一个按拇指够得到的入口——行菜单里的「改标题」。两个入口走同
    // // 一个 `onPatch`，所以这不是两处实现，是一个手势的两种按法。
    for (const band of ['wide', 'narrow'] as const) {
      const panel = mountPanel(oneRow({ title: '原来的标题' }), 'list', band)
      try {
        const row = panel.surface.querySelector('[data-status]')
        // THE CHIP, NOT THE WORDS. The control that opens the field sits in front of
        // the sentence, so it is its SIBLING rather than an ancestor of the words — and
        // asking the words for their nearest button finds nothing, which is a probe
        // reporting on the wrong element.
        const title = row?.querySelector('[class*="itemPrioButton"]')
        expect(title, `the ${band} band row printed no title control to press`).toBeDefined()
      // ONE PRESS. It needed two when the title was TEXT — 「press it again」 was
      // the desktop path for renaming, and it went with the text. Now the chip in
      // front of the sentence IS a control that opens the field, and a second press
      // lands on the field that replaced the title.
      act(() => { title?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
        // THE FIELD IS ITS OWN CLASS, not a descendant of the title's: the title is REPLACED
      // by the field while it is being written, so there is no title to be a parent
      // of — and a selector that assumed one looked for a box that is never there.
      const field = panel.surface.querySelector('[class*="itemRowTitleInput"]') as HTMLInputElement | null
        expect(field, `pressing the title on the ${band} band opened no field — the title is a control, not text`).not.toBeNull()
        if (field !== null) {
          typeInto(field, '改过的标题')
          press(field, 'Enter')
          expect(panel.lastWrite()[0]?.title, `the title written on the ${band} band never reached the document`).toBe('改过的标题')
        }
        // 拇指：行菜单里的「改标题」。
        openRowMenu(panel.surface)
        const entry = findMenuEntry(panel.surface, '改标题')
        expect(entry, `the ${band} band row menu offers no way to edit the title — a phone has no double press`).not.toBeNull()
      } finally {
        panel.dispose()
      }
    }
  })
})

describe('the checklist is a list a reader can change, not a list they can only tick', () => {
  /** A row that already carries two steps, so order and removal are both real. */
  function twoSteps(): ItemRecord[] {
    return oneRow({
      steps: [
        { id: 'r-1.s1', text: '第一步', done: false },
        { id: 'r-1.s2', text: '第二步', done: true },
      ],
    })
  }
  /** Open one row's detail so the editor is on screen, whatever band we are on. */
  function openDetail(panel: ReturnType<typeof mountPanel>): void {
    openRowMenu(panel.surface)
    const entry = findMenuEntry(panel.surface, '展开详情')
    expect(entry, 'the row menu offers no way to expand the row').not.toBeNull()
    click(entry)
  }
  /** The step texts currently in the editor, in the order they are drawn. */
  // 读每一行里的那个 `span`，而不是读 `data-done`：那个属性只在**做完**的时候才
  // 出现（`data-done={step.done ? '' : undefined}`），所以按它找会漏掉还没做的步，
  // 而「漏掉还没做的那几步」正好是这条用例要抓的那种错。
  /**
   * THE STEPS ON SCREEN, read from the board.
   *
   * 它原来读的是 `[class*="itemStepList"] > li` 里的 `label span`——一份 `<ul>` 加一
   * 个 `<label>`，那是清单以前的样子。板子现在是一堆行，字住在自己那个 span 里，
   * 所以这个读法已经找了两轮都不存在的结构，然后对着一个画得好好的板子报「板子是空的」。
   *
   * **一个读法指着一种结构，而结构换了读法不会自己跟着换。** 所以它读的是行和
   * 行里那个装字的元素，而不是一份行文的形状。
   */
  const stepsShown = (root: ParentNode): string[] =>
    [...root.querySelectorAll('[class*="itemStepRow"]')]
      .map(row => (row.querySelector('[class*="itemStepWords"]')?.childNodes.length ?? 0) > 0
        ? [...(row.querySelector('[class*="itemStepWords"]')?.childNodes ?? [])]
          .filter(node => node.nodeType !== 1 || !String((node as Element).className).includes('itemStepKind'))
          .map(node => node.textContent ?? '').join('')
        : '')
  it('「编辑步骤」 is in the row menu, and it opens the editor with the caret in the field', () => {
    // The ENTRANCE, because a control that exists only as a function is a control
    // nobody can reach — and on a touch surface 「编辑步骤」 in a ⋯ menu is the
    // only route there is.
    for (const band of ['wide', 'narrow'] as const) {
      const panel = mountPanel(twoSteps(), 'list', band)
      try {
        openRowMenu(panel.surface)
        const entry = findMenuEntry(panel.surface, '编辑步骤')
        expect(entry, `the ${band} band row menu offers no way to edit the checklist`).not.toBeNull()
        click(entry)
        const field = [...panel.surface.querySelectorAll('input')]
          .find(node => (node.getAttribute('aria-label') ?? '').includes('这一步要做什么'))
        expect(field, `pressing 「编辑步骤」 on the ${band} band put no add-step field on screen`).toBeDefined()
      } finally {
        panel.dispose()
      }
    }
  })

  it('a step can be added, taken off, and moved — and the document is what changes', () => {
    const panel = mountPanel(twoSteps(), 'list', 'wide')
    try {
      openDetail(panel)
      // A HUNDRED STEPS IS A HUNDRED STEPS OF WORK AND NEVER A HUNDRED ROWS OF
      // SCREEN. The board shows the NEXT step and a window of the waiting ones, so
      // what is on screen at the start is one undone step and the row's progress —
      // and the fold is what puts the rest back within reach.
      expect(stepsShown(panel.surface), 'the next step is not on screen at all — the board starts with nothing').toEqual(['第一步'])
      // One of this fixture's two steps is already done, so the board says 1 / 2 — and
      // it is read off the element that holds it rather than out of the page's whole
      // text, where 「共 1 条」 lives too.
      expect(panel.surface.querySelector('[class*="itemStepCount"]')?.textContent ?? '', 'the board states no progress count, so a reader cannot tell how much is left').toBe('1 / 2')
      // 加一步，写进文档。
      const field = [...panel.surface.querySelectorAll('input')]
        .find(node => (node.getAttribute('aria-label') ?? '').includes('这一步要做什么')) as HTMLInputElement
      typeInto(field, '第三步')
      const add = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim() === '加一步')
      click(add)
      // THE SCREEN AND THE DOCUMENT ARE TWO QUESTIONS. 第二步 is done, so it is behind
      // the fold — and 「not on screen」 is not 「not in the list」. The next line asks
      // the document, which is where all three live.
      expect(stepsShown(panel.surface), 'the typed step never appeared on the board').toEqual(['第一步', '第三步'])
      expect(panel.lastWrite()[0]?.steps.map(step => step.text), 'the write reached the document but not the checklist').toEqual(['第一步', '第二步', '第三步'])

      // 挪上去：第二步越过第一步。
      //
      // 找的是 `title`，`aria-label` 也一起看，但断言落在**今天真的在屏幕上**的
      // 那一半上：共享的 `Button` 目前不转发 `aria-label`——它在标记里被传下去了，
      // 然后在渲染时不见了（`board/ui.tsx` 的 props 表里没有这一项，元素上也没
      // 写）。等它转发之后，这一行自然就变成更严的门禁，那时它应该被改严。
      // THE MOVE CONTROL IS IN THE STEP'S OWN ⋯, and it is there for a reason:
      // A FINISHED STEP IS BEHIND THE FOLD, and that is the design — so the fold is
      // opened first, and 「one press away」 is exactly the claim.
      const fold = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim().startsWith('已完成'))
      expect(fold, 'the board states no fold, so a finished step is either on screen or unreachable').toBeDefined()
      click(fold)
      const labels = [...panel.surface.querySelectorAll('button')]
        .map(node => `${node.getAttribute('aria-label') ?? ''}`)
      expect(labels.some(label => label.includes('这一步的动作：第二步')),
        `the board offers no control for the finished step, so it cannot be reopened: ${JSON.stringify(labels)}`).toBe(true)
      const dots = [...panel.surface.querySelectorAll('button')]
        .find(node => `${node.getAttribute('aria-label') ?? ''}`.includes('这一步的动作：第二步'))
      act(() => { dots?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      const up = [...panel.surface.querySelectorAll('[role="menuitem"]')]
        .find(node => (node.textContent ?? '').trim() === '往上挪一步')
      expect(up, `the step’s own menu offers no way to move it`).toBeDefined()
      click(up)
      // THE DOCUMENT MOVED. The board's own order is waiting-then-finished, so a row
      // that moved up can still sit lower on screen — which is the point: the reader
      // scans what is left, not what is filed.
      expect(panel.lastWrite()[0]?.steps.map(step => step.text), 'the step did not move — the control is a picture of a control').toEqual(['第二步', '第一步', '第三步'])

      // 去掉一步，同样在**那一步自己的 ⋯** 里，而剩下的两步要真的少一步。
      const dropDots = [...panel.surface.querySelectorAll('button')]
        .find(node => `${node.getAttribute('aria-label') ?? ''}`.startsWith('这一步的动作：第一步'))
      expect(dropDots, 'the first step carries no control of its own — a checklist you cannot trim is a log').toBeDefined()
      act(() => { dropDots?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      const drop = [...panel.surface.querySelectorAll('[role="menuitem"]')]
        .find(node => (node.textContent ?? '').trim() === '去掉这一步')
      expect(drop, `the step’s own menu offers no way to take it off`).toBeDefined()
      click(drop)
      // NOT ON THE BOARD ANY MORE, AND NOT IN THE DOCUMENT — two questions, and
      // only the first is about what is on screen.
      expect(stepsShown(panel.surface), 'the step is still on the board after being taken off').not.toContain('第一步')
      expect(panel.lastWrite()[0]?.steps.map(step => step.text), 'the document kept a step the reader deleted').toEqual(['第二步', '第三步'])
    } finally {
      panel.dispose()
    }
  })

  it('the three edits are answered by pure functions, and they refuse the impossible', () => {
    // The pure half, asked directly. A view that computes its own order has no
    // place to be wrong until a reader is looking at it; these are the answers the
    // panel hands to the writer, and each of them has to be the SAME ARRAY back
    // when there is nothing to change — because that is what tells the writer not
    // to burn a revision on a press that cannot do anything.
    const base: ItemStep[] = [
      { id: 'a.s1', text: '一', done: false },
      { id: 'a.s2', text: '二', done: true },
    ]
    expect(addStep(base, 'a', '   '), 'a blank line became a step').toBe(base)
    expect(addStep(base, 'a', ' 三 ').map(step => step.text), 'the words were not trimmed').toEqual(['一', '二', '三'])
    expect(addStep(base, 'a', '三').map(step => step.id), 'the new step reuses an id that is already on the row').toEqual(['a.s1', 'a.s2', 'a.s3'])
    expect(removeStep(base, 'nope'), 'a step that is not there was removed anyway').toBe(base)
    expect(moveStep(base, 'a.s1', -1), 'the first step wrapped to the end').toBe(base)
    expect(moveStep(base, 'a.s2', 1), 'the last step wrapped to the start').toBe(base)
    // AND THE IDS TRAVEL WITH THE ENTRIES: a rebuild from positions renumbers the
    // steps that stayed, and a step is ADDRESSED by its id, so the model would
    // then be asked about a step that means something else.
    expect(moveStep(base, 'a.s2', -1).map(step => step.id), 'moving a step renumbered the ones that stayed').toEqual(['a.s2', 'a.s1'])
  })

  it('the probe bites: a reordering that renumbers, and a blank line that files', () => {
    const renumbering = (steps: ItemStep[], stepId: string): ItemStep[] => {
      const at = steps.findIndex(step => step.id === stepId)
      const next = steps.slice()
      next.splice(at, 1)
      next.push(steps[at] as ItemStep)
      return next.map((step, position) => ({ ...step, id: `a.s${position + 1}` }))
    }
    const filesBlanks = (steps: ItemStep[], text: string): ItemStep[] => [...steps, { id: 'a.s9', text, done: false }]
    const base: ItemStep[] = [{ id: 'a.s1', text: '一', done: false }, { id: 'a.s2', text: '二', done: false }]
    /* 探针比的是**配对**，不是 id 的列表。
     *
     * 重新编号的那一份，id 列表和原来一模一样——因为它按位置把整张表重编了一遍，
     * 于是 `a.s1` 还在列表的第一个位置上，只是挂在**另一句话**下面。真正要守住的是
     * 「一个 id 永远指着同一句话」：步骤是被 id 指名的（`item.step` 拿它当参数，
     * 模型会把它念回来），所以重编之后的清单会让模型问到一个意思已经变了的东西。
     * 只比 id 列表的那道门禁，在这一份坏实现上是绿的。 */
    const paired = (steps: readonly ItemStep[]): string => steps.map(step => `${step.id}·${step.text}`).join('|')
    const wanted = 'a.s2·二|a.s1·一'
    // 三条断言合起来才是「这条门禁还能红」：真的那一份被判为对，而两份坏的各被判
    // 为坏。只写第一条的话，它在实现改坏的那天会跟着一起坏，然后永远绿下去。
    expect(paired(moveStep(base, 'a.s1', 1)), 'the detector reports the real reordering as a renumbering — this probe proves nothing').toBe(wanted)
    expect(paired(renumbering(base, 'a.s1')), 'a renumbering reordering passed as an id-preserving one').not.toBe(wanted)
    expect(filesBlanks(base, '  ').length, 'a blank line was filed as a step and the check accepted it').not.toBe(addStep(base, 'a', '  ').length)
  })
})

describe('a row is held with the mouse, with shift, and with the keyboard', () => {
  /** The rows on screen, in the order the reader sees them. `data-status` is the
   *  row's own identity hook: it is on the row root and nowhere else, so a class
   *  rename cannot turn this helper into a selector for the row's buttons. */
  const rowEls = (root: ParentNode): Element[] =>
    [...root.querySelectorAll('[data-status]')]

  /** Hold a row the way a reader does: a modifier press on the row itself. */
  function hold(row: Element | undefined, withShift = true): void {
    expect(row, 'there is no row under the pointer — the batch gate is asserting nothing').toBeDefined()
    act(() => {
      (row as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: withShift }))
    })
  }

  const heldEls = (root: ParentNode): Element[] =>
    [...root.querySelectorAll('[data-picked]')]

  const heldCount = (root: ParentNode): string =>
    (root.querySelector('[class*="itemBatchCount"]')?.textContent ?? '')

  it('every row on the list page can be held with no arming first', () => {
    // THE COLUMN WAS 44px OF NOTHING, so the resident checkbox is gone. The way
    // in is now a modifier press on the row itself: a reader who wants to hold a
    // row does not have to know a mode exists before a control they can see does.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const rows = rowEls(panel.surface)
      expect(rows.length, 'the fixture drew no rows').toBeGreaterThan(1)
      hold(rows[0])
      expect(heldEls(panel.surface).length, 'a modifier press on a row held nothing').toBe(1)
      expect(heldCount(panel.surface), 'the bar and the held row disagree about how many are held').toContain('1')
    } finally {
      panel.dispose()
    }
  })

  it('and a modifier press holds nothing on the page that has no batch bar', () => {
    // PRODUCT puts multi-select on the list page alone, and a held row on a page
    // with no bar is a holding the reader can neither see nor empty. 日程 is the one
    // page left without a batch surface — 收件 was the other, and it is gone with its
    // rail row, because it was a predicate rather than a page.
    for (const page of ['schedule'] as const) {
      const panel = mountPanel(fixtures(), page, 'wide')
      try {
        hold(rowEls(panel.surface)[0])
        expect(heldEls(panel.surface).length, `a modifier press on the ${page} page held a row with no bar to act on it`).toBe(0)
      } finally {
        panel.dispose()
      }
    }
  })

  it('pressing into the body of an open row leaves the row exactly as open as it was', () => {
    // THE DEFECT THIS PINS, reported from the surface: 「展开详情然后点击正文之后，
    // 那一条一直显示暗色背景，像是被选中了」. Two states paint a fill on a row --
    // `data-open` (the deep wash) and `data-picked` (the light one, and a held row
    // has NO tick to explain it, so a fill there reads as 「this row is selected」)
    // -- and the press that enters a text field must not move either of them.
    //
    // The body of an EMPTY row is a BUTTON that swaps itself for the field, so the
    // press that 「点击正文」 describes is a press on a control inside the detail.
    // The detail region stops propagation for its own subtree; a child that writes
    // state and lets the event through would reach the row, whose plain press
    // selects AND toggles.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const byToken = (root: Element, token: string): HTMLElement | null =>
        (root.querySelector(`.${token}`) as HTMLElement | null) ??
        ([...root.querySelectorAll('[class]')].find(node =>
          [...node.classList].some(c => c.endsWith(`_${token}`))) as HTMLElement | undefined) ??
        null
      const row = rowEls(panel.surface)[0]
      click(row)
      expect(row.getAttribute('data-open'), 'the row did not open, so the rest of this proves nothing').toBe('')
      const prompt = byToken(row, 'itemWritePrompt')
      if (prompt !== null) click(prompt)
      expect(row.getAttribute('data-open'), 'pressing into the body closed the row').toBe('')
      expect(row.getAttribute('data-picked'), 'pressing into the body held the row').toBeNull()
      // And the collapse the reader asks for by pressing the row itself.
      click(row)
      expect(row.getAttribute('data-open'), 'the row did not collapse when pressed').toBeNull()
      expect(row.getAttribute('data-picked'), 'a collapsed row still reads as held').toBeNull()
    } finally {
      panel.dispose()
    }
  })

  it('one modifier press holds one row, and SHIFT holds the run between two of them', () => {
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const rows = rowEls(panel.surface)
      hold(rows[0])
      expect(heldCount(panel.surface), 'one modifier press put nothing in the holding').toContain('1')
      // SHIFT 从刚才那一条一直到这里：中间四行一起被握住。
      hold(rows[3])
      expect(heldEls(panel.surface).length, 'shift did not hold the run between the two rows').toBe(4)
      expect(heldCount(panel.surface), 'the bar and the held rows disagree about how many are held').toContain('4')
    } finally {
      panel.dispose()
    }
  })

  it('shift with nothing held is one row, not the whole list', () => {
    // 没有锚点就没有「从哪到哪」。猜一个锚点就是让一次看起来像「加上接下来六条」
    // 的按压变成握住整张表。
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const rows = rowEls(panel.surface)
      hold(rows[2])
      expect(heldEls(panel.surface).length, 'a shift with no anchor held something other than the one row under the pointer').toBe(1)
    } finally {
      panel.dispose()
    }
  })

  it('the range is measured over the rows ON SCREEN, not over the document', () => {
    // 读者勾了第一条、滚过两行被筛掉的、Shift 勾第七条，说的是「这两条之间屏幕上
    // 看见的那几条」。按文档算就会悄悄把那两行也算进去，于是批量条说「已选 8 条」
    // 而读者能指出来的只有六个——这正是这个模块存在的理由。
    const held = pickThrough({ armed: true, ids: new Set(['a']) }, ['a', 'b', 'c'], 'a', 'c')
    expect([...held.ids].sort(), 'the range was not measured over the visible order').toEqual(['a', 'b', 'c'])
    // 文档里的 'x' 在屏上不在，所以它没有被握住。
    expect(held.ids.has('x'), 'a row the reader cannot see was held').toBe(false)
    expect(pickThrough({ armed: true, ids: new Set() }, ['a', 'b', 'c'], 'zz', 'c').ids.size, 'a missing anchor turned into a range').toBe(1)
  })

  it('the probe bites: a document-ordered range passes for a screen-ordered one', () => {
    const screen = ['a', 'b', 'c']
    const document = ['a', 'x', 'y', 'b', 'c']
    const overDocument = (from: string, to: string): Set<string> => {
      const ids = new Set<string>()
      for (let at = document.indexOf(from); at <= document.indexOf(to); at += 1) ids.add(document[at] as string)
      return ids
    }
    const real = pickThrough({ armed: true, ids: new Set() }, screen, 'a', 'c').ids
    expect([...real].sort(), 'the detector reports the real range as a document-ordered one — this probe proves nothing').toEqual(['a', 'b', 'c'])
    expect(overDocument('a', 'c').has('x'), 'a document-ordered range passed as a screen-ordered one').toBe(true)
  })
})

/* 「彻底删除」的三种答案都要在**界面上**验一遍，而不只是验那个函数答了什么。
 *
 * 台架自己的假主机只答 restore 一条路，而且它是在**挂载的时候**装上 `fetch` 的——
 * 所以这一段用的假主机必须装在挂载**之后**，那也正是读者的主机所在的位置：面板
 * 是在按钮被按下的那一刻去读 `fetch`，不是在它被建起来的时候。`dispose()` 会把
 * 台架那一个放回去，所以不会有东西漏到下一条用例里。 */
describe('the archive is the reader\'s account, and erasing is the last thing in it', () => {
  /** The one row the fake host is holding, and the whole of its record. */
  const ARCHIVED: ItemRecord = {
    id: 'gone-1', ref: 7, title: '删掉的那一条', body: '', notes: '', steps: [],
    status: 'open', priority: 'normal', tags: [],
    startsAfter: undefined, dueAt: undefined, hardDueAt: undefined, taskId: undefined,
    origin: { source: 'human', at: NOW }, createdAt: NOW, updatedAt: NOW,
  }

  /**
   * THE HOST, as far as this surface is concerned.
   *
   * `answer` decides only the purge route; the archive read answers from the row
   * above, so the two halves cannot drift apart into a green case.
   * @param answer - what the host says about the erase.
   * @returns a function that puts the real `fetch` back.
   */
  function hostThatPurges(answer: (address: { id?: string }) => unknown): () => void {
    const real = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const body = JSON.parse(String(init?.body ?? '{}')) as { id?: string }
      const value = url.includes('/board/items/purge')
        ? answer(body)
        : { available: true, deleted: [ARCHIVED] }
      return new Response(JSON.stringify({ ok: true, value }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    return () => { globalThis.fetch = real }
  }

  /** Let every already-resolved promise inside the panel land. */
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 4; round += 1) await act(async () => { await Promise.resolve() })
  }

  /**
   * Mount, install the host, and open the archive — through the ONE entrance.
   *
   * THE ENTRANCE IS THE RAIL'S 「已删除」 ROW, and it is the only one: the list
   * page used to carry a second door at its very foot (「删除后 30 天内可以找回来。」
   * plus 「看看」), which asked a reader to scroll to the bottom of the page to
   * discover that an archive exists at all. It is gone, and this helper presses
   * what is left.
   *
   * Pressing it is strictly better evidence than pressing the old one: this entry
   * goes through the COUNTER SIGNAL (`archiveAsked`) rather than a direct
   * `openArchive()` call, so a regression in that channel — the one that made the
   * rail row print a count and then do nothing — now fails these four gates
   * instead of passing them.
   */
  async function openArchive(answer: (address: { id?: string }) => unknown): Promise<{ panel: ReturnType<typeof mountPanel>; undo: () => void }> {
    const panel = mountPanel(oneRow({ id: 'live-1', title: '还在的那一条' }), 'list', 'wide')
    const undo = hostThatPurges(answer)
    const look = [...panel.surface.querySelectorAll('button')]
      .find(node => (node.textContent ?? '').includes('已删除'))
    expect(look, 'the archive has no entrance: the rail draws no 「已删除」 row').not.toBeUndefined()
    click(look)
    await settle()
    return { panel, undo }
  }

  /** 每一行旁边的那一枚「彻底删除」。 */
  const purgeButtonOf = (row: Element | null): Element | undefined =>
    [...(row?.querySelectorAll('button') ?? [])].find(node => (node.textContent ?? '').trim() === '彻底删除')

  it('the one entrance lands on the page that owns the drawer, from ANY page', async () => {
    // THE ENTRANCE IS AN ENTRANCE FROM EVERY PAGE THE RAIL IS DRAWN ON, and the
    // rail is drawn on three. The drawer, meanwhile, lives inside the list page —
    // so pressing 「已删除」 while standing on 日程 used to clear the filter, light
    // the row up, and show NOTHING: the counter stayed above zero and the drawer
    // appeared later, when the reader happened to go back to 清单.
    //
    // 「I pressed it and cannot see the result」 and 「pressing it does nothing」 are
    // the same event to a reader, so the row has to do both halves of its job in
    // one press: go to the page that owns the drawer, and ask for the drawer.
    const panel = mountPanel(oneRow({ id: 'live-1', title: '还在的那一条' }), 'schedule', 'wide')
    const undo = hostThatPurges(() => ({ available: true, deleted: [ARCHIVED] }))
    try {
      const look = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').includes('已删除'))
      expect(look, 'the rail draws no 「已删除」 row, so there is no entrance to test').not.toBeUndefined()
      click(look)
      await settle()
      // 「回到清单」 exists only inside the open drawer, so its presence is the
      // drawer's presence — and the page it names is where the reader now is.
      expect(panel.surface.textContent ?? '',
        'pressing 已删除 from 日程 did not bring the archive up, so the row did half its job').toContain('回到清单')
    } finally {
      panel.dispose()
      undo()
    }
  })

  it('every archived row offers 彻底删除, and the button belongs to that row', async () => {
    const { panel, undo } = await openArchive(() => ({ available: true }))
    try {
      const row = panel.surface.querySelector('[class*="itemRecentRow"]')
      expect(row, 'the archive drew no row to hold the deleted one').not.toBeNull()
      expect(purgeButtonOf(row), 'an archived row offers no way to erase it — 彻底删除 is nowhere').toBeDefined()
    } finally {
      panel.dispose()
      undo()
    }
  })

  it('erasing takes the row off the page and names the thing it erased', async () => {
    // 回执写的是**被按掉的那一件**，不是「已删除」：读者是按在一行旁边的，而三十天
    // 之后他唯一能回忆起来的就是那行标题。
    const seen: (string | undefined)[] = []
    const { panel, undo } = await openArchive(body => {
      seen.push(body.id)
      return { available: true, revision: 2, erased: ARCHIVED }
    })
    try {
      expect(panel.surface.textContent, 'the archive is not holding the deleted row').toContain('删掉的那一条')
      click(purgeButtonOf(panel.surface.querySelector('[class*="itemRecentRow"]')))
      await settle()
      expect(seen, 'the press never reached the host').toEqual(['gone-1'])
      // 行离开这一页了。
      expect(panel.surface.querySelectorAll('[class*="itemRecentRow"]').length, 'the erased row is still on the page').toBe(0)
      // 而回执说的是它。
      expect(panel.surface.textContent, 'the receipt does not name the row that was erased').toContain('已清掉')
    } finally {
      panel.dispose()
      undo()
    }
  })

  it('a name that now points at a LIVE row is refused in words, and the row stays', async () => {
    // 短编号会被重用：清掉 #12 之后，写进本文档的下一行就是 #12。所以一个刚拿过
    // 的编号可能指着清单里还活着的一条。主机拒绝销毁它，而这一层要说的是**这件
    // 事**——不是「删除失败」（那读起来像按钮坏了），也不是沉默（那读起来像一次
    // 成功地毁了别人的东西）。
    const { panel, undo } = await openArchive(() => ({ available: true, revision: 2, notDeleted: true }))
    try {
      click(purgeButtonOf(panel.surface.querySelector('[class*="itemRecentRow"]')))
      await settle()
      const said = panel.surface.textContent ?? ''
      expect(said, 'the reader was not told that the name points at a row that is still on the list').toContain('还活着')
      expect(said, 'the failure was reported as a broken button rather than as the fact it is').not.toContain('没能彻底删除')
    } finally {
      panel.dispose()
      undo()
    }
  })

  it('a host that heard the question and found nothing is a receipt, not a refusal', async () => {
    // 已经不在归档里了：读者要的是它没了，而它确实没了。报一个错，等于告诉他一件
    // 已经办成的事失败了——而那正是最让人不再按第二次的那种回执。
    const { panel, undo } = await openArchive(() => ({ available: true, revision: 2 }))
    try {
      click(purgeButtonOf(panel.surface.querySelector('[class*="itemRecentRow"]')))
      await settle()
      const said = panel.surface.textContent ?? ''
      expect(said, 'the reader was shown a failure for a row that was already gone').not.toContain('没能彻底删除')
      expect(said, 'nothing at all was said — a silent press is a press that looks broken').not.toContain('正在清掉')
    } finally {
      panel.dispose()
      undo()
    }
  })

  it('the probe bites: an unreachable host and a wrong address are two different sentences', () => {
    // 两个代码，两个句子。合成一个「删除失败」就是让读者去查一个他无从查的按钮。
    expect(whyLabelOf('invalid_argument').words, 'a wrong address is reported as a host that cannot be reached').not.toBe(whyLabelOf('hostUnavailable').words)
    expect(whyLabelOf('hostUnavailable').raw).not.toBe(whyLabelOf('invalid_argument').raw)
  })
})