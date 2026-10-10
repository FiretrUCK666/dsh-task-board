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
import { dayTokensIn, freeTextOf, queryChipsOf, tagFacetValuesOf, withFacetToken } from '../src/client/item/facets.ts'
import { ITEM_KEYS, bindingFor, claimsKey, dispatchKey, type ItemKeyAction, type ItemKeyActions } from '../src/client/item/keyboard.ts'

/** The action names the registrar can call, read off the closed action union. */
const knownActions: ReadonlySet<string> = new Set<ItemKeyAction>([
  'quickCapture', 'moveNext', 'movePrev', 'pick', 'rename', 'open',
  'close', 'priority', 'dueToday', 'remove', 'undo', 'palette',
  'palettePrev', 'paletteNext', 'palettePick',
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
    palettePrev: record('palettePrev'), paletteNext: record('paletteNext'),
    palettePick: record('palettePick'),
  }
}
import {
  EMPTY_ITEM_QUERY,
  ITEM_SORTS,
  ITEM_STATUS_ORDER,
  itemMatches,
  itemMatchContextOf,
  itemSlicesOf,
  isInboxItem,
  ITEM_FLAGS,
  ITEM_RAIL_DATE_FLAGS,
  ITEM_RAIL_IDLE_FLAGS,
  parseItemQuery,
  scheduleBucketsOf,
  type ItemFlag,
  type ItemQuery,
} from '../src/core/item-view.ts'
// `type` is the harness's 「type into a field」 helper and it collides with the
// `type` keyword as a bare import name, so it is renamed at the boundary rather
// than avoided — a gate that cannot drive the keyboard cannot claim the keyboard
// works.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { type as typeInto, alignClassNames, click, coreSurfaceSource, fixtures, hostTokenCss, itemSurfaceFiles, itemSurfaceSource, locateSource, mountPanel, panelCss, press, readSource, renderPanel } from './panel-harness.ts'
import { pickThrough } from '../src/client/item/selection.ts'
import { addStep, moveStep, removeStep } from '../src/client/item/steps.ts'
import { whyLabelOf } from '../src/client/item/why-label.ts'
import type { ItemStep } from '../src/core/item.ts'

// A fixed clock, so every date-derived claim is reproducible.
const NOW = new Date(2026, 8, 29, 10, 0, 0).getTime()

/** 这一枚 flag 的芯片该读哪一栏名——日期那一栏的菜单里有它，就归日期。 */
function hasFlagFacet(flag: ItemFlag): boolean {
  return (ITEM_RAIL_DATE_FLAGS as readonly string[]).includes(flag) || (ITEM_RAIL_IDLE_FLAGS as readonly string[]).includes(flag)
}
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

describe('the priority ladder is spelled in exactly one place', () => {
  it('no client file writes the four tiers out again', () => {
    // 四档曾经在八个文件里各写一遍（`marks.tsx`、`keyboard.ts`、`compose-parse.ts`、
    // `facets.ts`、`batch-bar.tsx`、`item-create-dialog.tsx`、`detail-pane.tsx`、
    // `rail.tsx`），而 core 里两张对的那一份没人读。抄一份的代价不是那几行，是
    // **改一处不报错**：重新分档之后总有一个角落继续指着旧号码，而屏上不会有人说一句话。
    // 这一条查的就是那件事本身：客户端里不许再出现排在一行上的两个档位字面量。
    const tier = '(?:urgent|high|normal|low)'
    const pair = new RegExp(`'${tier}'[^\\n]*'${tier}'`)
    for (const source of clientSources()) {
      const live = code(source)
      expect(pair.test(live), 'a client file lists the four tiers again — they belong to core/item.ts').toBe(false)
    }
  })

  it('and the one table it reads is the model’s own', () => {
    // 正方向：那张表必须真的从模型派生（顺序 = 重量序），而不是另一份手写数组。
    // 客户端那一圈里没有 core，所以这一条读的是 core 自己的文件。
    expect(code(read('core/item.ts')), 'the weight order is no longer derived from the rank table')
      .toMatch(/ITEM_PRIORITIES_BY_WEIGHT[\s\S]{0,160}itemPriorityRankOf/)
  })
})

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
    status: 'todo',
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
  /**
   * EVERY FIELD, MINUS THE ONES THAT ARE NEVER WRITTEN — BY NAME, not by the shape
   * of their line. `overlay` is written by the render bench and by nothing else
   * (its own note says so and says why), so a scan that included it would demand a
   * control that must not exist; the exclusion is therefore a list a reader can
   * check, rather than a `\??` in a regular expression that happens to skip it.
   */
  const neverWritten = new Set(['overlay'])
  const fields = [...prefsBody.matchAll(/\breadonly\s+(\w+)\s*\??\s*:/g)]
    .map(match => match[1] as string)
    .filter(field => !neverWritten.has(field))

  it('the field list is not empty, or this file is asserting nothing', () => {
    expect(fields, 'the gate read no preference fields — the interface shape changed and the gate is now vacuous').toContain('page')
    expect(fields.length).toBeGreaterThan(2)
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
    // THE ROUND TRIP, in the direction a reader travels: every flag the chips and
    // the rail can turn on must be a word the grammar reads back as that same
    // flag. Two spellings of one vocabulary is how a control writes a filter that
    // silently matches nothing while looking like it worked — the one failure a
    // filter box cannot recover from for the person who used it.
    expect(ITEM_FLAGS.length, 'no flag to check — the gate is asserting nothing').toBeGreaterThan(0)
    for (const flag of ITEM_FLAGS) {
      const parsed = parseItemQuery(`has:${flag}`)
      expect([...parsed.flags], `has:${flag} does not parse back to the flag it names`).toEqual([flag])
      expect(parsed.words, `has:${flag} is being read as a plain word`).toEqual([])
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

  it('a second press on the same ⋯ closes its menu, and a third opens it again', () => {
    // 开与关是同一个手势的两个方向：再按一次开它的那个⋯，面板要收回去。外点收
    // 的监听豁免 ⋯ 本体，开合只由按钮自己的 toggle 读当前状态定——同一次点击
    // 只剩一个写者，收与开不再取决于两个处理器的先后。
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      openRowMenu(panel.surface)
      expect(panel.surface.querySelector('[role="menu"]'), 'the first press did not open the menu').not.toBeNull()
      const trigger = panel.surface.querySelector('[aria-haspopup="menu"]')
      click(trigger)
      expect(panel.surface.querySelector('[role="menu"]'), 'the second press on the ⋯ did not close its own menu').toBeNull()
      click(trigger)
      expect(panel.surface.querySelector('[role="menu"]'), 'the third press did not open the menu again').not.toBeNull()
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
    // Room on the inline axis: the menu hangs off the ⋯'s own trailing shoulder —
    // its right edge ON the ⋯'s right edge (「往右上角挪、贴近⋯」), not a whole
    // button-width away on the content column's own line.
    const roomy = place({ top: 300, bottom: 340, left: 700, right: 740, width: 40, height: 40 }, PANEL, MENU)
    expect(roomy.left + MENU.width, 'the menu did not hang off the ⋯\'s own right edge').toBe(740)
    // A trigger hard against the trailing edge: the rim keeps its 10px of air, so
    // the menu slides back inside instead of gluing to the panel's edge.
    const edge = place({ top: 300, bottom: 340, left: 960, right: 998, width: 38, height: 40 }, PANEL, MENU)
    expect(edge.left + MENU.width, 'the menu glued to the panel\'s rim — the rim keeps its 10px of air').toBe(PANEL.right - 10)
    expect(edge.left, 'the menu was pushed past the panel\'s own leading edge').toBeGreaterThanOrEqual(PANEL.left)
    // A trigger measured OVERHANGING the rim (a rect taken mid-scroll can do it):
    // the clamp still keeps the same 10px of air, so no menu ever glues to the edge.
    const over = place({ top: 300, bottom: 340, left: 995, right: 1030, width: 35, height: 40 }, PANEL, MENU)
    expect(PANEL.right - (over.left + MENU.width), 'a degenerate trigger let the menu glue to the rim').toBe(10)
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

describe('a row wears its own tier', () => {
  it('two rows identical except for their tier do not render the same', () => {
    // THE DISCRIMINATOR. Two rows identical except for their tier must render
    // differently, and two rows identical INCLUDING their tier must render
    // identically — otherwise a comparison like this one would be finding the
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

describe('a card that cannot run says why, beside the button', () => {
  /** 一张卡，`prompt` 由调用者给——`taskExecutable` 读的就是它。 */
  const boardWith = (prompt: string): unknown => ({
    getSnapshot: () => ({ tasks: [{ id: 't-1', title: '看板上的那张', status: 'todo', prompt, description: '' }] }),
    liveStateOf: () => 'idle',
  })

  it('「执行」 is disabled and the reason is ON the page, not in a title', () => {
    /* 读者报过的那一类缺陷：一枚按下去什么都不会发生的控件。执行门禁（`taskExecutable`）在
       看板那一侧拦得住，而按这一枚按钮的人是在清单上按的——所以理由必须出现在这里。
       **不许只挂在 `title` 上**（硬性规范 11③：触屏没有 hover）。 */
    const rows = oneRow({ taskId: 't-1' })
    const blocked = renderPanel(rows, 'wide', 'list', boardWith(''), {}, 'r-1')
    expect(blocked, 'a card with an empty execution prompt can run nothing — the reason is not on the page').toContain('执行 Prompt 为空')
    expect(blocked, 'the button was left pressable, so the press does nothing and says nothing').toMatch(/disabled/)
    // 对照：同一条行、同一张卡的 prompt 一填上，按钮就能按、理由就不该再出现。
    const ready = renderPanel(rows, 'wide', 'list', boardWith('do the thing'), {}, 'r-1')
    expect(ready, 'the reason is still printed for a card that can run').not.toContain('执行 Prompt 为空')
  })
})

describe('the card chip is a door when the wiring gives one, and a reading when it does not', () => {
  /* 挂卡那一行右边那枚芯片说的是「这一条挂在待审核那张卡上」。读者看到它时的下一个动作
     十有八九是去看那张卡——所以装配层给了 `openCard` 时它是一枚**门**（`button`），按下
     去带着那张卡的 id 走；没给时它退回**一枚读数**（`span`），绝不画成一枚按了没反应的按钮。 */
  const carded = (): ItemRecord[] => oneRow({ taskId: 'task-review' })

  it('按下它，它带着那张卡的 id 走', () => {
    const opened: string[] = []
    const panel = mountPanel(carded(), 'list', 'wide', { openCard: id => { opened.push(id) } })
    try {
      const chip = panel.surface.querySelector('button[data-door]')
      expect(chip, 'the chip is not a door even though the wiring gave one').not.toBeNull()
      click(chip)
      expect(opened, 'pressing the chip did not hand the card id to the wiring').toEqual(['task-review'])
    } finally {
      panel.dispose()
    }
  })

  it('没有那扇门时它是一枚读数，不是一枚按不动的按钮', () => {
    const panel = mountPanel(carded(), 'list', 'wide')
    try {
      expect(panel.surface.querySelector('[data-door]'), 'a door with nothing behind it').toBeNull()
      expect(panel.surface.querySelector('span[class*="itemRowCardChip"]'), 'the chip vanished instead of degrading').not.toBeNull()
    } finally {
      panel.dispose()
    }
  })
})

describe('every filter the rail can press is a chip you can see and remove', () => {
  /* 读者报过的那一类缺陷（两处根因、同一句话）：「点击『已超期』和『还没到』，左边都显示选中
     了，但下面没有出现对应的胶囊」。左栏按下的是 `has:overdue / ahead / undated / stale`，
     而芯片那张手写的表里写的是 `has:hardOverdue / behind / undated / gated`——**两套词汇只有
     一枚重合**，于是另外三个筛子开着：列表筛了，屏上没有任何东西说得出它开着，也点不掉它。 */
  it('the rail writes only tokens the chips know, so nothing filters invisibly', () => {
    for (const flag of [...ITEM_RAIL_DATE_FLAGS, ...ITEM_RAIL_IDLE_FLAGS]) {
      const chips = queryChipsOf(`has:${flag}`)
      expect(chips.map(chip => chip.token), `has:${flag} filters the list with nothing on screen saying so`).toEqual([`has:${flag}`])
      expect(chips[0]?.value, `has:${flag} got a chip with no word on it`).not.toBeNull()
    }
  })

  it('a flag OUTSIDE the menu is still a chip — hand-typed or written by the model', () => {
    // `has:linked`/`has:done` 永远不在日期那一栏的菜单里，但读者可以手打、模型也会写。
    for (const flag of ITEM_FLAGS) {
      const chips = queryChipsOf(`has:${flag}`)
      expect(chips.length, `has:${flag} is a filter with no chip`).toBe(1)
      expect(chips[0]?.facet, `has:${flag} is described by a family that does not own it`).toBe(
        hasFlagFacet(flag) ? 'item.facet.date' : 'item.facet.flag',
      )
    }
  })
})

describe('the rail marks EVERY filter that is on, not just the first', () => {
  /* 筛子是叠加的：按「已超期」再按「紧急」，两条一起筛。而左栏原来在遇到第一个匹配的行时就
     停下——三枚芯片亮着、左栏只有一行有底色，读者看到的是「我按了三个，它只认一个」。
   *
   * **查询只能从搜索框里写进去**（`readViewPrefs` 故意不恢复搜索文本，那是刻意的产品行为），
   * 所以这一条是**真实交互**：挂载、往框里打字、数一共几行亮着。 */
  it('three filters on means three rows marked, and clearing them leaves 「全部」', async () => {
    const panel = mountPanel([...fixtures()], 'list', 'wide')
    try {
      const box = panel.surface.querySelector('input[type="search"], input[type="text"]')
      if (box === null) throw new Error('the bar drew no search box')
      typeInto(box, 'has:overdue p1 status:done')
      await settle()
      const marked = [...panel.surface.querySelectorAll('[aria-current="true"]')]
      expect(marked.length, 'the rail marked one row for three filters').toBe(3)
      // 对照：按「全清」（产品自己的清空路径），读者回到「全部」——它是这条轨的地板，
      // 不是三个里赢的那一个。
      const clear = [...panel.surface.querySelectorAll('button')].find(one => (one.textContent ?? '') === '全清')
      if (clear === undefined) throw new Error('three chips on screen but no 「全清」 button')
      click(clear)
      await settle()
      const after = [...panel.surface.querySelectorAll('[aria-current="true"]')]
      expect(after.length, 'clearing the query did not land the reader back on 「全部」').toBe(1)
      expect(after[0]?.textContent ?? '', 'the lit row after clearing is not 「全部」').toContain('全部')
    } finally {
      panel.dispose()
    }
  })
})

describe('the summary says what it says, and the numbers do not move under a switch', () => {
  it('the grouping drops the finished group under the switch, and only under it', () => {
    // 这一条原来问的是 `itemGroupCountsOf`（一份「永远是四组」的封闭计数表）。那个函数
    // 与它数的三个界面东西一起删了——分组头、概览条、页轨今天都不存在，而给死代码写测试
    // 会让死代码看起来被需要。留下来的、仍然有人在读的性质是**分组**那一条：清单页里的
    // 「已完成」是一个开关，所以关掉它时那一组必须真的不出现。
    const rows = fixtures()
    const fromSlices = (includeDone: boolean): number[] => itemSlicesOf(rows, {
      query: EMPTY_ITEM_QUERY,
      ctx: { ...itemMatchContextOf(NOW), cards: new Map() },
      sort: 'due',
      includeDone,
    }).map(slice => slice.items.length)
    expect(fromSlices(false).length, 'the grouping stopped dropping the finished group — the switch does nothing, so it is not a switch').toBe(ITEM_STATUS_ORDER.length - 1)
    expect(fromSlices(true).length).toBe(ITEM_STATUS_ORDER.length)
    // 而两组数字加起来就是这份文档的全部行数：一份「分组」若不是覆盖，它就不是分组。
    expect(fromSlices(true).reduce((sum, n) => sum + n, 0), 'the groups do not cover the document').toBe(rows.length)
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
    // 真问题问的是**分组**：开关关掉时那一组真的不见了，打开时又回来。这一条与上面那一节
    // 是同一个判据，写在这里是为了让「检测器两种答案都出得来」有据可依。
    const groups = (includeDone: boolean): number[] => itemSlicesOf(fixtures(), {
      query: EMPTY_ITEM_QUERY,
      ctx: { ...itemMatchContextOf(NOW), cards: new Map() },
      sort: 'due',
      includeDone,
    }).map(slice => slice.items.length)
    expect(stable(groups), 'a switch-following denominator was accepted — the grouping ignores the finished switch').toBe(false)
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
    const buckets = scheduleBucketsOf(rows, EMPTY_ITEM_QUERY, { ...itemMatchContextOf(NOW), cards: new Map() }, 'due')
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
      const overdue = railRow(panel.surface, '已超期')
      const undated = railRow(panel.surface, '没定日期')
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
      const row = railRow(panel.surface, '已超期')
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
      expect(panel.surface.textContent ?? '', 'pressing 全部 left the reader on the agenda page').not.toContain('不早于还没到')
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
      expect(panel.surface.textContent ?? '', 'the list page is drawing the agenda bucket already, so the door below proves nothing').not.toContain('不早于还没到')
      const schedule = railRow(panel.surface, '日程')
      click(schedule)
      expect(panel.surface.textContent ?? '', 'the 日程 row did not open the agenda').toContain('不早于还没到')
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
      const meanings = new Set(group.map(binding => binding.action))
      for (const binding of group) {
        expect(binding.when, `${chord} is shared with ${[...meanings].join(' and ')}, but "${binding.action}" applies everywhere — so the other meaning is unreachable`).toBeDefined()
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

  it('a field that claims its keys keeps them, and the flow stands aside on exactly those', () => {
    // 卡片的就地起名框：`Enter` 确认、`Esc` 收起，都是这根输入框自己的手势。
    // 流的表不知道窗格里的状态，所以它按表把 `Esc` 收作了「关上」——起名的
    // Esc 连着整行详情一起没了。给字段一条「我接这些键」的明说，是让「某根
    // 输入框自己应答手势」这一类需求在流的一处落地，而不是靠每一处拦。
    const claimed = document.createElement('input')
    claimed.setAttribute('data-dsh-tb-keys', 'Enter Escape')
    const state = { focusedId: 'r-1', somethingOpen: true, paletteOpen: false }
    const onField = (key: string, over: Record<string, unknown> = {}) =>
      ({ key, metaKey: false, ctrlKey: false, shiftKey: false, target: claimed, ...over })
    expect(claimsKey(onField('Escape')), 'a named Escape was still taken by the flow — the naming field lost its own gesture').toBe(false)
    expect(claimsKey(onField('Enter')), 'a named Enter was still taken by the flow').toBe(false)
    // The claim is about the BARE key: a deliberate chord stays the surface's.
    expect(claimsKey(onField('k', { metaKey: true })), 'a claimed field lost ⌘K as well').toBe(true)
    // And the claim never leaves the field: the same key on the page is still the flow's.
    expect(claimsKey({ key: 'Escape', metaKey: false, ctrlKey: false, shiftKey: false, target: document.createElement('div') }),
      'the field\'s claim emptied out of the field').toBe(true)
    // A value that says nothing claims nothing.
    const empty = document.createElement('input')
    empty.setAttribute('data-dsh-tb-keys', '   ')
    expect(claimsKey({ key: 'Escape', metaKey: false, ctrlKey: false, shiftKey: false, target: empty }), 'an empty claim still swallowed the key').toBe(true)
    // And dispatch runs nothing for a claimed key — no inert close hides behind it.
    const ran: string[] = []
    expect(dispatchKey(onField('Escape'), state, recordOfActions(name => { ran.push(name) })), 'a claimed key was dispatched anyway').toBe(false)
    expect(ran, 'a claimed key ran something').toEqual([])
  })

  it('E enters the inline rename of the row under the cursor; the plain press opens the row instead', () => {
    // W23, stated as BEHAVIOUR: the map said 「E 改标题」 for two releases while
    // its handler body was `setSelected` — the same sentence as ↵. Now `E`
    // delivers the rename lease to the cursor row, the row opens its inline
    // editor with the caret in it, and ↵ remains the open gesture. A rename
    // that is also an open is a key that answers two questions with one word.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      press(panel.surface, 'j')
      press(panel.surface, 'e')
      const editor = panel.surface.querySelector('[class*="itemRowTitleInput"]') as HTMLInputElement | null
      expect(editor, 'E did not enter the row\'s title editor — the key still aliases ↵').not.toBeNull()
      expect(document.activeElement, 'the rename editor did not take the caret when E was pressed').toBe(editor)
      // And the other act stays its own: the plain press expands (opens),
      // which is what the row does for ↵ — never the editor.
      expect(panel.surface.querySelector('[data-open]'), 'E also opened the row, so the two keys still agree').toBeNull()
    } finally {
      panel.dispose()
    }
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

  it('a key still reaches the page after a blank click, because the focus falling to nothing must not kill the flow', () => {
    // 点击空白之后焦点落回 body：监听挂在面板根上的时候，从这里起每一条快捷键
    // 都是哑的——「按了很多功能都没有反应」的原样。监听在 document 上，以
    // 「目标在本面板子树内，或已落回空处」为守卫，J 仍是下一条，X 仍是握住。
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      press(document.body, 'j')
      press(document.body, 'x')
      expect(panel.surface.querySelector('[data-picked]'), 'a key pressed at nothing was not heard — the flow died with the focus').not.toBeNull()
    } finally {
      panel.dispose()
    }
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
    expect(withFacetToken(typed, 'status:todo', true), 'a press lost or rewrote the reader\'s own words').toBe('Gallery Work notes status:todo')
    expect(withFacetToken(withFacetToken(typed, 'status:todo', true), 'status:todo', false)).toBe(typed)
  })

  it('the box holds the words, and the qualifiers are not in it', () => {
    // What the reader TYPING, and nothing else. If a press prints
    // `status:todo` into a field labelled 「搜索标题、正文、备注与标签」, the control
    // is showing the reader its own source code.
    expect(freeTextOf('status:todo #work Gallery')).toBe('Gallery')
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
    const a = queryChipsOf('p1 status:todo Gallery', [])
    const b = queryChipsOf('Gallery status:todo p1', [])
    expect(a.map(chip => chip.token), 'the chips came back in a different order for the same filter').toEqual(b.map(chip => chip.token))
    expect(a.map(chip => chip.token)).toEqual(['status:todo', 'p1'])
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
      wordsSurvived(typed, withFacetToken(typed, 'status:todo', true)),
      'the detector reports the real editor as a rewriter — this probe proves nothing',
    ).toBe(true)
    expect(
      wordsSurvived(typed, reSerialising(typed, 'status:todo')),
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
        const title = row?.querySelector('button[class*="itemRowText"]')
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
  /* 「打开详情」这一步的公共入口在文件尾部的 `openRowDetail`，两个 suite 同一步。 */
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
      openRowDetail(panel)
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
        .find(node => (node.textContent ?? '').trim() === '删除')
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
      expect(row.getAttribute('data-cursor'), 'a collapsed row still wears the cursor rim — 「收起来之后还挂着加粗的边」').toBeNull()
      expect(panel.surface.querySelector('[data-cursor]'), 'a cursor rim survived a second press on its own row').toBeNull()
    } finally {
      panel.dispose()
    }
  })

  it('pressing the card\'s own blank collapses the open row and takes the rim with it', () => {
    // 点击空白 = 「我不要这一条了」。收的不只是纸面：选中、游标圈一起走。
    // 圈留下的那条「加粗的边」就是读者投诉的原样。
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const flow = panel.surface.querySelector('[data-dsh-tb-scroll]') as HTMLElement | null
      expect(flow, 'the list card has no scroller boundary to test against').not.toBeNull()
      const row = rowEls(panel.surface)[0]
      click(row)
      expect(row.getAttribute('data-open'), 'the row did not open, so the rest of this proves nothing').toBe('')
      click(flow)
      expect(row.getAttribute('data-open'), 'a blank press did not collapse the open row').toBeNull()
      expect(row.getAttribute('data-cursor'), 'a blank press left the rim on the collapsed row').toBeNull()
      expect(panel.surface.querySelector('[data-cursor]'), 'the rim survived on another row after a blank press').toBeNull()
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

  it('while the batch is armed every row wears its tickbox, and the bar can tick the whole screen', () => {
    // THE MODE NEEDS A FACE. The palette's 「多选」 used to arm the mode and show
    // nothing: the state machine turned over behind an interface that looked
    // exactly like the un-armed one, and a touch reader — who has no modifier
    // key at all — had no door into the whole batch surface. Now armed is the
    // mode whose face is the tickbox: the first hold turns the boxes on
    // everywhere, and the bar can tick or release every row the reader can see.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      hold(rowEls(panel.surface)[0])
      const rows = rowEls(panel.surface)
      expect(rows.length, 'the fixture drew no rows').toBeGreaterThan(1)
      for (const row of rows) {
        expect(row.querySelector('input[type=checkbox]'), 'an armed row shows no tickbox, so the mode has no face').not.toBeNull()
      }
      // The bar's select-all ticks exactly the screen: every row, then none.
      const allBox = panel.surface.querySelector('[class*="itemBatchLead"] input[type=checkbox]') as HTMLInputElement
      expect(allBox, 'the bar has no select-all box, so a full-screen batch is one press per row').not.toBeNull()
      act(() => { allBox.click() })
      expect(heldEls(panel.surface).length, 'select-all held fewer rows than the screen shows').toBe(rows.length)
      expect((panel.surface.querySelector('[class*="itemBatchLead"] input[type=checkbox]') as HTMLInputElement).checked, 'the select-all box does not read as all-held after ticking everything').toBe(true)
      act(() => { (panel.surface.querySelector('[class*="itemBatchLead"] input[type=checkbox]') as HTMLInputElement).click() })
      expect(heldEls(panel.surface).length, 'releasing all left rows held').toBe(0)
    } finally {
      panel.dispose()
    }
  })

  it('arming alone shows the bar with 「已选 0 条」, and everything but select-all stands disabled', () => {
    // THE MODE NEEDS A FACE THE MOMENT IT IS ON. A bar that waited for the first
    // row was a mode with no face: the reader pressed 多选 and nothing told them
    // it was on. With nothing held, the bar keeps its shape — the count reads
    // zero, and every write stands disabled because there is nothing to write to.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const chip = [...panel.surface.querySelectorAll('button')]
        .find(button => (button.textContent ?? '').trim() === '多选')
      expect(chip, 'the strip carries no 多选 chip').toBeDefined()
      act(() => { chip!.click() })
      expect((panel.surface.querySelector('[class*="itemBatchCount"]')?.textContent ?? ''), 'arming alone drew no bar').toContain('0')
      const pressed = [...panel.surface.querySelectorAll('[class*="itemBatch"] button, [class*="itemBatch"] [role="radio"]')]
      for (const control of pressed) {
        const tick = control.matches('input[type=checkbox]')
        if (tick) continue
        expect((control as HTMLButtonElement).disabled, 'a write answered a press with nothing held — it would write to nothing')
          .toBe(true)
      }
      // The first pick lights the bar up: the disabled half leaves.
      act(() => { hold(rowEls(panel.surface)[0]) })
      const urgent = [...panel.surface.querySelectorAll('[class*="itemBatch"] [role="radio"]')]
        .find(one => (one.textContent ?? '').trim() === '紧急') as HTMLButtonElement
      expect(urgent.disabled, 'a pick did not stand the writes back up').toBe(false)
    } finally {
      panel.dispose()
    }
  })

  it('the 多选 chip is the way out of the mode, and the boxes leave with it', () => {
    // Leaving the mode is an ACT (setArmed(false) clears the holding), not a
    // collapse: the reader must be able to stand down without touching the
    // rows one by one, and an un-armed surface must look un-armed. The chip
    // that armed the mode is the same door back out — one control, one intent.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const chip = [...panel.surface.querySelectorAll('button')]
        .find(button => (button.textContent ?? '').trim() === '多选')
      act(() => { chip!.click() })
      expect(rowEls(panel.surface)[0]!.querySelector('input[type=checkbox]'), 'the mode did not turn its face on').not.toBeNull()
      act(() => { chip!.click() })
      for (const row of rowEls(panel.surface)) {
        expect(row.querySelector('input[type=checkbox]'), 'a box survived the disarming, so the surface still reads as armed').toBeNull()
      }
      expect(panel.surface.querySelector('[class*="itemBatchCount"]'), 'the bar survived its own door').toBeNull()
    } finally {
      panel.dispose()
    }
  })

  it('a tier in the bar is a press that writes, and the status segments are the same tribe', () => {
    // The bar's two segment groups answer the same KIND of question — put a
    // tier on every held row, act once — so they are also the SAME control.
    // The native dropdown that used to be here was one control this panel's
    // stylesheet did not draw, and the one page answering 「这一个的档位」 with
    // chips and 「这一批的档位」 with a platform menu. The press still has to
    // write, which is what the gates below check on BOTH groups.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      hold(rowEls(panel.surface)[0])
      const held = heldEls(panel.surface)[0]
      expect(held, 'nothing was held, so the press has nothing to land on').toBeDefined()
      const press = (word: string): void => {
        const chip = [...panel.surface.querySelectorAll('button')]
          .find(button => (button.textContent ?? '').trim() === word)
        if (chip === undefined) throw new Error(`the bar does not carry a "${word}"`)
        act(() => { chip.click() })
      }
      press('紧急')
      // The row's own number is the identity the list prints; the document is
      // asked through it, and the tier the press named must be what is stored.
      const ref = Number(/#(\d+)/.exec(held.textContent ?? '')?.[1])
      expect(Number.isNaN(ref), 'the held row printed no number to be read back by').toBe(false)
      expect(panel.lastWrite().find(row => row.ref === ref)?.priority, 'the tier press never reached the held row').toBe('urgent')
      press('标为已完成')
      expect(panel.lastWrite().find(row => row.ref === ref)?.status, 'the status press never reached the held row').toBe('done')
      // 改了 N 条 comes back as a count of what CHANGED.
      expect(panel.surface.textContent ?? '', 'the press did not say what changed').toContain('改了 1 条')
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
    status: 'todo', priority: 'normal', tags: [],
    startsAfter: undefined, dueAt: undefined, hardDueAt: undefined, taskId: undefined,
    origin: { source: 'human', at: NOW }, createdAt: NOW, updatedAt: NOW,
  }

  /**
   * THE HOST, as far as this surface is concerned.
   *
   * `answer` decides only the purge route; the archive read answers from the row
   * above — minus the rows a purge in this session has ERASED, because a host
   * that keeps listing a row it destroyed is not a host, it is a haunted house,
   * and the re-read the drawer runs after a batch acts on it would resurrect
   * the very row the reader watched it take away.
   * @param answer - what the host says about the erase.
   * @returns a function that puts the real `fetch` back.
   */
  function hostThatPurges(answer: (address: { id?: string }) => unknown): () => void {
    const real = globalThis.fetch
    const erased = new Set<string>()
    const rescued = new Set<string>()
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const body = JSON.parse(String(init?.body ?? '{}')) as { id?: string }
      if (url.includes('/board/items/restore')) {
        /* THE OTHER HOST OPERATION, answered by the same fake: a restore is a route
         * this device calls directly, so the fake has to answer it here or the test
         * would be reading the bench's own host instead. */
        rescued.add(body.id ?? '')
        return new Response(JSON.stringify({
          ok: true,
          value: { available: true, revision: 11, restored: ARCHIVED },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/board/items/purge')) {
        const verdict = answer(body)
        // A SELF-CONSISTENT host: whatever the purge answered — erased, a live
        // name refused, or nothing left to erase — its read stops listing the
        // row, because a tombstone that survived any of those answers is not a
        // tombstone the read would return. An answer that CARRIES an envelope
        // error is a refusal: the read keeps the row (the tombstone is still
        // there), and the error itself is what the caller sees.
        if (verdict !== null && typeof verdict === 'object' && 'error' in verdict) {
          return new Response(JSON.stringify({ ok: false, error: (verdict as { error: unknown }).error }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        erased.add(body.id ?? '')
        return new Response(JSON.stringify({ ok: true, value: { revision: 9, ...(verdict as Record<string, unknown>) } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        ok: true,
        value: {
          available: true,
          deleted: erased.has(ARCHIVED.id) || rescued.has(ARCHIVED.id) ? [] : [ARCHIVED],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    return () => { globalThis.fetch = real }
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

  /** 每一行旁边的那一枚勾选框（多选是抽屉自己的脸）。 */
  const rowElsOf = (surface: ParentNode): Element[] =>
    [...surface.querySelectorAll('[class*="itemArchiveRow"]:not([class*="itemArchiveRowList"])')]

  const tickboxOf = (row: Element | null): HTMLInputElement | null =>
    row?.querySelector('input[type=checkbox]') as HTMLInputElement | null

  /** The drawer bar's 确认块：选中若干行之后，栏换成一句带后果的确认。 */
  const killButton = (surface: ParentNode): Element | undefined =>
    [...surface.querySelectorAll('button')].find(node => (node.textContent ?? '').trim() === '彻底删除')

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
      // The drawer's own bar sentence exists only inside the open drawer, so its
      // presence is the drawer's presence — and the page it names is where the
      // reader now is.
      expect(panel.surface.textContent ?? '',
        'pressing 已删除 from 日程 did not bring the archive up, so the row did half its job').toContain('删掉的行留 30 天')
    } finally {
      panel.dispose()
      undo()
    }
  })

  it('putting a row back lands it in the LIVE list in the same tick, not on the next poll', async () => {
    /* THE DEFECT THIS EXISTS FOR, as the reader met it: press 「放回去」, the receipt
     * says the row is back, close the drawer — and the row is NOT in the list. The
     * host had written it (the receipt is honest), but the announcement never came
     * back to this device: a restore is a host operation this panel called straight
     * at the route, and this client drops its OWN commit frames by design (`own
     * commits arrive via the response`). The row therefore waited for the next poll
     * — measured at up to thirty seconds — and the reader's words for that were
     * 「点了没反应，各种不显示、没刷新」.
     *
     * So the claim is exact: after the press, the row is in the live list with no
     * poll, no reopen and no reload. */
    const { panel, undo } = await openArchive(() => ({ available: true }))
    try {
      const back = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim() === '放回去')
      expect(back, 'the archived row offers no way back').not.toBeUndefined()
      click(back)
      await settle()
      expect(panel.surface.textContent ?? '', 'the receipt never said the row came back').toContain('找回来了')
      // Back out through the same door, and look at the LIVE list.
      const look = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').includes('已删除'))
      click(look)
      await settle()
      expect(panel.surface.textContent ?? '',
        'the rescued row is not in the live list — it is waiting for the next poll').toContain('删掉的那一条')
    } finally {
      panel.dispose()
      undo()
    }
  })

  it('every archived row wears its pickbox, and the way back belongs to that row', async () => {
    const { panel, undo } = await openArchive(() => ({ available: true }))
    try {
      const row = rowElsOf(panel.surface)[0] ?? null
      expect(row, 'the archive drew no row to hold the deleted one').not.toBeNull()
      expect(tickboxOf(row), 'an archived row wears no pickbox — the drawer cannot be picked').not.toBeNull()
      const back = [...(row?.querySelectorAll('button') ?? [])].find(node => (node.textContent ?? '').trim() === '放回去')
      expect(back, 'an archived row offers no way to bring it back — the rescue is nowhere').not.toBeUndefined()
    } finally {
      panel.dispose()
      undo()
    }
  })

  it('picking a row turns the bar into the one confirmation, and erasing the pick takes the row off the page', async () => {
    // 回执写的是**数**这件事的总账，不是「已删除」：读者按的是抽屉自己的确认块，
    // 看到的是这一批的下场。
    const seen: (string | undefined)[] = []
    const { panel, undo } = await openArchive(body => {
      seen.push(body.id)
      return { available: true, revision: 2, erased: ARCHIVED }
    })
    try {
      expect(panel.surface.textContent, 'the archive is not holding the deleted row').toContain('删掉的那一条')
      const box = tickboxOf(rowElsOf(panel.surface)[0] ?? null)
      expect(box, 'the row carries no pickbox, so the erase cannot be reached').not.toBeNull()
      act(() => { box!.click() })
      await settle()
      // THE BAR BECAME THE CONFIRMATION the moment a row was held — a plain
      // destroy button that vanishes on press is the control this grammar
      // refuses.
      expect(panel.surface.textContent ?? '', 'picking did not surface the consequence').toContain('找不回来')
      const kill = killButton(panel.surface)
      expect(kill, 'the confirmation carries no erase').not.toBeUndefined()
      click(kill)
      await settle()
      expect(seen, 'the press never reached the host').toEqual(['gone-1'])
      // 行离开这一页了。
      expect(rowElsOf(panel.surface).length, 'the erased row is still on the page').toBe(0)
      // 而回执说的是这一批。
      expect(panel.surface.textContent, 'the receipt does not say what was erased').toContain('已彻底删除 1 条')
    } finally {
      panel.dispose()
      undo()
    }
  })

  it('a host that refused the erase keeps the row, and the count stays at zero', async () => {
    // THE HONEST FAILURE KEEPS ITS ROW. A refill/pre-persist refusal (a full
    // disk, a host that reached but said no) leaves the tombstone on the read —
    // and the drawer, which re-reads after the batch, still draws it in the
    // holding it arrived in. Nothing is drained and nothing is hinted as done.
    const { panel, undo } = await openArchive(() => ({ error: { code: 'persist_failed', message: 'disk said no' } }))
    try {
      act(() => { tickboxOf(rowElsOf(panel.surface)[0] ?? null)!.click() })
      await settle()
      click(killButton(panel.surface))
      await settle()
      const said = panel.surface.textContent ?? ''
      expect(said, 'a refusals batched was reported as erased').toContain('一条都没有删掉')
      expect(rowElsOf(panel.surface).length, 'the refused row was drained from the drawer').toBe(1)
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
      act(() => { tickboxOf(rowElsOf(panel.surface)[0] ?? null)!.click() })
      await settle()
      click(killButton(panel.surface))
      await settle()
      const said = panel.surface.textContent ?? ''
      expect(said, 'the reader was shown a failure for a row that was already gone').toContain('已彻底删除 1 条')
      expect(said, 'nothing at all was said — a silent press is a press that looks broken').not.toContain('正在彻底删除')
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

/**
 * The naming field once the picker offers one, named by its own label.
 * `?? null` because `find` answers undefined, and the cases below ask null.
 */
function namingField(root: ParentNode): HTMLInputElement | null {
  return [...root.querySelectorAll('input')]
    .find(node => (node.getAttribute('aria-label') ?? '').includes('新卡的名字')) as HTMLInputElement | null ?? null
}

describe('一张卡没了，它就不再是一张卡', () => {
  /** 一行挂在 `task-1` 上，而板上真有这张卡（台架按夹具把卡片名单长出来）。 */
  const hung = (): readonly ItemRecord[] => oneRow({ taskId: 'task-1' })

  /** 那一行右边那枚**卡芯片**（按类名，不按 `data-door`：台架这一档没有接 `openCard`，
   *  于是它是一枚读数而不是一扇门——两种形态都该在，测的是它在不在）。 */
  const chipOf = (panel: ReturnType<typeof mountPanel>): Element | null =>
    panel.surface.querySelector('[class*="itemRowCardChip"]')

  it('删掉卡之后：它不再是门，状态照旧看得见，展开区读「不挂」', () => {
    // 两件事一起变：**门**没了（没有卡可跳），而**状态那个词**必须在（读者要能看出这一行现在
    // 站在哪一栏——没挂卡的行正是最容易「看不出状态」的那一种）。
    const panel = mountPanel(hung(), 'list', 'wide')
    try {
      expect(chipOf(panel), '这一行本来就没画成挂着卡的样子').not.toBeNull()
      panel.board.setTasks([])
      panel.settle()
      const after = chipOf(panel)
      expect(after, '状态那一枚胶囊跟着卡一起消失了').not.toBeNull()
      expect(after?.getAttribute('data-door'), '卡没了，它还是一扇门').toBeNull()
      expect(after?.textContent ?? '', '卡没了之后那一枚不说话了').toContain('待办')
      openRowDetail(panel)
      expect(panel.surface.textContent ?? '', '展开区没有说回「不挂」').toContain('不挂')
    } finally {
      panel.dispose()
    }
  })

  it('没挂卡的行同样看得见状态那个词', () => {
    // 读者的原话：「不管怎么变它的状态，只要不挂上卡，标题右边是不会显示那些胶囊的，
    // 感觉很难区分出来。」珠子是形状，形状说不出五栏里的哪一栏，所以词每一行都在。
    const panel = mountPanel(oneRow({ status: 'done' }), 'list', 'wide')
    try {
      const chip = chipOf(panel)
      expect(chip?.textContent ?? '', '没挂卡的行看不见它的状态').toContain('已完成')
      expect(chip?.getAttribute('data-door'), '没有卡却画成了一扇门').toBeNull()
    } finally {
      panel.dispose()
    }
  })

  it('并且文档里那条死链接被清掉（走的是同一个写入漏斗）', () => {
    // 屏上读对是一半，文档里是对的**另一半**：不然 `has:linked`、左栏的计数与模型的
    // 答复会继续把这一条算作「挂着卡」。
    const panel = mountPanel(hung(), 'list', 'wide')
    try {
      panel.board.setTasks([])
      panel.settle()
      expect(panel.lastWrite()[0]?.taskId, '文档里还留着一条指向已删卡片的链接').toBeUndefined()
    } finally {
      panel.dispose()
    }
  })

  it('卡被拖到另一栏，清单这一行当场跟着换', () => {
    // 三张映射按 `[face.controller, items]` memo 的那一版在这里必红：两者都不随看板变，
    // 于是这一行会停在「待办」。
    const panel = mountPanel(hung(), 'list', 'wide')
    try {
      expect(panel.surface.querySelector('[data-status]')?.getAttribute('data-status')).toBe('todo')
      panel.board.setTasks([{ id: 'task-1', title: '画廊第二版', status: 'running' }])
      panel.settle()
      expect(panel.surface.querySelector('[data-status]')?.getAttribute('data-status'), '看板改了栏，清单这一行没跟着').toBe('running')
    } finally {
      panel.dispose()
    }
  })
})

describe('一句话认出来的东西，全部落到各自的框里', () => {
  /** 打开「新建一条」，在文法那一行里写一句话。 */
  const writeLine = (panel: ReturnType<typeof mountPanel>, line: string): void => {
    const open = [...panel.surface.querySelectorAll('button')]
      .find(node => (node.textContent ?? '').includes('新建一条'))
    if (open === undefined) throw new Error('the bar carries no 新建一条')
    click(open)
    const box = panel.surface.querySelector('input[class*="itemInput"]') as HTMLInputElement | null
    if (box === null) throw new Error('the sheet drew no grammar line')
    typeInto(box, line)
    panel.settle()
  }

  const save = (panel: ReturnType<typeof mountPanel>): void => {
    const button = [...panel.surface.querySelectorAll('button')]
      .find(node => (node.textContent ?? '').trim() === '存下这一条')
    if (button === undefined) throw new Error('the sheet carries no way to save')
    click(button)
    panel.settle()
  }

  it('三个日期各到各的框，存下去三样都在', () => {
    // 这一条钉的是一次**静默丢失**：这一行能解析出三个日期，而新建纸的保存读的是它自己的
    // 字段——回填只覆盖了「希望在」那一个，另外两个被解析出来之后直接丢掉，屏上没有任何
    // 东西说这件事。
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      writeLine(panel, '大活儿 @不早于 10/25 @10/26 @不晚于 10/27')
      const values = [...panel.surface.querySelectorAll('input')].map(node => node.value)
      expect(values, '「不早于」没有回填到它的框里').toContain('2026-10-25')
      expect(values, '「希望在」没有回填到它的框里').toContain('2026-10-26')
      expect(values, '「不晚于」没有回填到它的框里').toContain('2026-10-27')

      save(panel)
      const rows = panel.lastWrite()
      const row = rows[rows.length - 1]
      expect(row?.startsAfter, '存下去的行缺了「不早于」').toBe(new Date(2026, 9, 25).getTime())
      expect(row?.dueAt, '存下去的行缺了「希望在」').toBe(new Date(2026, 9, 26).getTime())
      expect(row?.hardDueAt, '存下去的行缺了「不晚于」').toBe(new Date(2026, 9, 27).getTime())
    } finally {
      panel.dispose()
    }
  })

  it('步骤框认两种写法：光一行就是一步，`- [x] 一句` 是已经勾上的一步', () => {
    // 那行文法框是**单行**输入，所以 `- [ ] 步骤` 这种带换行的写法到不了它那里；读者真正
    // 能让步骤进文档的地方是这张纸上的步骤框。两种写法都认，是因为那一行与这一框说的是
    // 同一件事：读者在一行里学到的写字方式，在这里不该被拒。
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      writeLine(panel, '大活儿')
      const stepsBox = [...panel.surface.querySelectorAll('textarea')]
        .find(node => node.getAttribute('aria-label') === '步骤')
      if (stepsBox === undefined) throw new Error('the sheet drew no steps box')
      typeInto(stepsBox, '第一步\n- [x] 第二步')
      panel.settle()

      save(panel)
      const rows = panel.lastWrite()
      const row = rows[rows.length - 1]
      expect(row?.steps.map(step => step.text)).toEqual(['第一步', '第二步'])
      expect(row?.steps.map(step => step.done), '勾过的那一步在存下去的时候被当成没勾').toEqual([false, true])
    } finally {
      panel.dispose()
    }
  })

  it('同一行里同一个日子写两遍：那一个不成芯片，并且说一句为什么', () => {
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      writeLine(panel, '大活儿 @10/26 @10/28')
      expect(panel.surface.textContent ?? '', '被拒的那一个没有说一句为什么').toContain('@10/28')
      expect(panel.surface.textContent ?? '').toContain('已经写了一个日子')
    } finally {
      panel.dispose()
    }
  })
})

describe('同一列顺序可以倒过来读', () => {
  /** 顶栏那枚「排序 · X」芯片，按文字找（不按类名）。 */
  const sortChip = (panel: ReturnType<typeof mountPanel>): HTMLButtonElement => {
    const chip = [...panel.surface.querySelectorAll('button')]
      .find(node => (node.textContent ?? '').trim().startsWith('排序'))
    if (chip === undefined) throw new Error('the bar carries no sort chip')
    return chip as HTMLButtonElement
  }

  /** 排序面板里那一项，按它的词找。 */
  const sortEntry = (panel: ReturnType<typeof mountPanel>, word: string): HTMLButtonElement => {
    const entry = [...panel.surface.querySelectorAll('[class*="itemTopPanel"] button')]
      .find(node => (node.textContent ?? '').trim().startsWith(word))
    if (entry === undefined) throw new Error(`the sort panel carries no ${word} entry`)
    return entry as HTMLButtonElement
  }

  const firstRow = (panel: ReturnType<typeof mountPanel>): string =>
    (panel.surface.querySelector('[class*="itemRowText"]')?.textContent ?? '').trim()

  it('按当前那一项第二下就翻过来，芯片上说得出方向，换一列则归位', () => {
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      expect(sortChip(panel).textContent ?? '', '一个全新的面板不是正序').not.toContain('倒过来')

      click(sortChip(panel))
      panel.settle()
      click(sortEntry(panel, '标题'))
      panel.settle()
      expect(sortChip(panel).textContent ?? '').toContain('标题')
      const ascending = firstRow(panel)

      // 第二下：同一个词，说的是**方向**。这一下不收起那一面（它不压住列表），
      // 所以读者能一边按一边看见那一列真的翻过来。
      click(sortChip(panel))
      panel.settle()
      click(sortEntry(panel, '标题'))
      panel.settle()
      expect(sortChip(panel).textContent ?? '', '按第二下没有翻过来').toContain('倒过来')
      expect(firstRow(panel), '芯片说倒过来了，而列表没有动').not.toBe(ascending)

      // 换一列：那一下说的是另一列，不该继承上一列的方向。**这一下不必再点芯片**——
      // 反转不收面，所以面板还开着（那正是「一边按一边看见列表翻过来」的意思）。
      click(sortEntry(panel, '优先级'))
      panel.settle()
      expect(sortChip(panel).textContent ?? '', '换了一列却把上一列的方向带了过来').not.toContain('倒过来')
    } finally {
      panel.dispose()
    }
  })
})

describe('挂上卡之后，状态两边一起变（先复现，再修）', () => {
  /** 详情面板里状态那一排里的某一枚按钮，按它的词找。 */
  const statusChip = (panel: ReturnType<typeof mountPanel>, word: string): HTMLButtonElement | undefined =>
    [...panel.surface.querySelectorAll('[class*="itemOpts"] button')]
      .find(node => (node.textContent ?? '').trim() === word) as HTMLButtonElement | undefined

  const row = (panel: ReturnType<typeof mountPanel>): ItemRecord | undefined => panel.lastWrite()[0]

  it('这一行自己写着「已完成」而卡在待办：按「待办」胶囊要立刻跟着走', () => {
    // 复现读者的原话：「再选什么待规划待办…他那边那个胶囊也不会有变化」。
    // `itemStatusOf` 让这一行自己的 done 压过卡片，而挂卡时那一排只给"移卡"的三个动词
    // ——写完卡，显示照旧是「已完成」，而解释那句的条件是 `done !== done`，也不出现。
    // 两边的数据于是必须一起写：按别的档 = 移卡 **并且**把那张牌收回去。
    const panel = mountPanel(oneRow({ status: 'done', taskId: 'task-1' }), 'list', 'wide')
    try {
      openRowDetail(panel)
      const chip = statusChip(panel, '移到待办')
      expect(chip, '状态那一排没有「移到待办」这一枚').toBeDefined()
      click(chip)
      panel.settle()
      expect(row(panel)?.status, '这一行自己的「已完成」没有被收回去，于是显示永远压着卡片').toBe('todo')
      const shown = panel.surface.querySelector('[class*="itemRowCardChip"]')?.textContent ?? ''
      expect(shown, '胶囊没有跟着走').toContain('待办')
    } finally {
      panel.dispose()
    }
  })

  it('按「已完成」：卡移到已完成，这一行自己也写上，两边一致', () => {
    // 只移卡不写这一行的话，摘下来那一刻它会跳回旧值——那正是"两边各存一份真相"的账。
    const panel = mountPanel(oneRow({ status: 'todo', taskId: 'task-1' }), 'list', 'wide')
    try {
      openRowDetail(panel)
      const chip = statusChip(panel, '移到已完成')
      expect(chip, '状态那一排没有「移到已完成」这一枚').toBeDefined()
      click(chip)
      panel.settle()
      expect(panel.calls, '没有移那张卡').toContain('moveTask(2)')
      expect(row(panel)?.status, '这一行自己的字段没有跟着写成已完成').toBe('done')
    } finally {
      panel.dispose()
    }
  })

  it('挂一条「已完成」的行：卡要开在已完成，不是写死的待办', () => {
    // 「他那个状态好像就不能正确跳转该有的状态」——第一根就在这里：提升把出生栏写死成
    // `status: 'todo'`，完全不看这一条当时的真实状态。
    const panel = mountPanel(oneRow({ status: 'done' }), 'list', 'wide')
    try {
      openRowDetail(panel)
      const chip = newCardChip(panel.surface)
      expect(chip, '「新建卡片」不在这一格上').not.toBeNull()
      click(chip)
      const field = namingField(panel.surface)
      expect(field, '那一格没有变成起名字的输入框').not.toBeNull()
      typeInto(field, '画廊改造')
      press(field as HTMLInputElement, 'Enter')
      panel.settle()
      const minted = panel.minted[0]
      expect(minted?.status, '新建的卡没有跟着这一行的状态走').toBe('done')
    } finally {
      panel.dispose()
    }
  })
  it('卡被拖到另一栏：这一行自己的字段跟着写（摘下来不会跳回旧值）', () => {
    // 屏上早就跟着变了（显示读卡），而这一行自己的字段还停在挂上那一刻——摘下来或跨设备读到
    // 它时会跳回旧状态，排序、收件判据这些读裸字段的地方也一直看旧值。
    const panel = mountPanel(oneRow({ status: 'todo', taskId: 'task-1' }), 'list', 'wide')
    try {
      panel.board.setTasks([{ id: 'task-1', title: '画廊第二版', status: 'review' }])
      panel.settle()
      expect(row(panel)?.status, '卡换了栏，这一行自己的字段没跟着写').toBe('review')
    } finally {
      panel.dispose()
    }
  })

  it('这一行自己按下的「已完成」不被写穿冲掉（那条规则是单向的）', () => {
    // `itemStatusOf` 的覆盖规则本来就是单向的：读者自己标了完成，卡片还没跟上时**显示仍是
    // 已完成**。写穿如果把它抹掉，那张牌就白按了——所以唯一的例外就是它。
    const panel = mountPanel(oneRow({ status: 'done', taskId: 'task-1' }), 'list', 'wide')
    try {
      panel.board.setTasks([{ id: 'task-1', title: '画廊第二版', status: 'running' }])
      panel.settle()
      expect(row(panel)?.status, '读者自己那张牌被写穿抹掉了').toBe('done')
    } finally {
      panel.dispose()
    }
  })

  it('挂上卡之后，状态那一格把执行器给的那两档也画出来（禁用 + 写明为什么）', () => {
    const panel = mountPanel(oneRow({ taskId: 'task-1' }), 'list', 'wide')
    try {
      openRowDetail(panel)
      const words = [...panel.surface.querySelectorAll('[class*="itemOpts"] button')].map(node => (node.textContent ?? '').trim())
      expect(words, '进行中那一档被藏掉了').toContain('进行中')
      expect(words, '待审核那一档被藏掉了').toContain('待审核')
      const disabled = [...panel.surface.querySelectorAll('[class*="itemOpts"] button')]
        .find(node => (node.textContent ?? '').trim() === '进行中') as HTMLButtonElement | undefined
      expect(disabled?.disabled, '那一档画成了可以按的').toBe(true)
      expect(panel.surface.textContent ?? '', '没有一句话说清那两档为什么不能按').toContain('执行器')
    } finally {
      panel.dispose()
    }
  })
})

describe('从看板跳过来：只看挂着那张卡的条目', () => {
  it('请求到了，列表只剩挂着那张卡的几条，而且有一枚摘得掉的芯片', () => {
    // 看板卡片上那枚「挂 N 条」按下去走的就是这一步：装配层记下一个带 token 的请求 + 抬清单舞台。
    // 过滤只发生在清单面板这一处（下游左栏计数/分组/查询都读同一个 items），否则同一份列表会有
    // 五个答案；而它必须长成一枚**看得见、摘得掉**的芯片——跳过来的人要能知道自己在一个筛选里。
    const rows = [
      { ...(oneRow({ taskId: 'task-1' })[0] as ItemRecord), id: 'r-1', ref: 1, title: '挂着那张卡的一条' },
      { ...(oneRow({})[0] as ItemRecord), id: 'r-2', ref: 2, title: '没有挂卡的一条' },
      { ...(oneRow({ taskId: 'task-2' })[0] as ItemRecord), id: 'r-3', ref: 3, title: '挂在另一张卡的一条' },
    ]
    const panel = mountPanel(rows, 'list', 'wide', { cards: ['task-1', 'task-2'], focus: { token: 1, cardId: 'task-1' } })
    try {
      const text = panel.surface.textContent ?? ''
      expect(text, '没有过滤：别的条目还在').not.toContain('没有挂卡的一条')
      expect(text, '没有过滤：挂在另一张卡上的条目还在').not.toContain('挂在另一张卡的一条')
      expect(text, '该显示的条目没显示').toContain('挂着那张卡的一条')

      // 摘掉它 → 回到全量。
      const chip = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').includes('只看挂着'))
      expect(chip, '没有那枚可摘的芯片，读者会以为自己只剩这几条').toBeDefined()
      click(chip)
      panel.settle()
      expect(panel.surface.textContent ?? '', '摘掉之后没有回到全量').toContain('没有挂卡的一条')
    } finally {
      panel.dispose()
    }
  })
})

describe('「问 AI」与「执行」同一判据（有没有卡都问得出去）', () => {
  it('「问 AI」对没挂卡的行也一样：先建一张卡再问', () => {
    // 与「执行」同一判据：读者问的是**这一条**，与有没有卡无关。这一支原来和「执行」一样
    // 落进死路——而它的另一半（有卡却被删了）必须继续拒绝，两条一起钉。
    const panel = mountPanel(oneRow({ body: '这件事交给你', taskId: undefined }), 'list', 'wide')
    try {
      openRowDetail(panel)
      const ask = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim() === '问 AI')
      expect(ask, '详情里没有「问 AI」那一枚').toBeDefined()
      click(ask)
      panel.settle()
      expect(panel.calls.join(' '), '没挂卡的行问 AI 时没有先建卡').toContain('createTask(')
    } finally {
      panel.dispose()
    }
  })

  it('行菜单也照同一条律：没挂卡的行也有「执行」与「问 AI」', () => {
    // 这是同一处判断的第二个表面（详情那排是第一个）。两处各写一份判断的代价，就是它们
    // 迟早不一样——而这一段代码的注释自己写着「⋯ menu 说同一条律，学过一边的人就学会了
    // 另一边」。所以两边各有一条断言，缺一边就会出现「同一个动作，在一个地方有、另一个
    // 地方没有」。
    const panel = mountPanel(oneRow({ body: '这件事交给你', taskId: undefined }), 'list', 'wide')
    try {
      openRowMenu(panel.surface)
      panel.settle()
      expect(findMenuEntry(panel.surface, '执行'), '行菜单里没有「执行」').not.toBeNull()
      expect(findMenuEntry(panel.surface, '问 AI'), '行菜单里没有「问 AI」').not.toBeNull()
    } finally {
      panel.dispose()
    }
  })

  it('有卡却被删了的行：拒绝，不建新卡', () => {
    // `linkedCardIdOf` 返回 undefined 有两种原因，而答案不同：从来没挂过 → 建一张再问；
    // 挂过却被删了 → 拒绝（去问一个不存在的会话是错的）。这一条钉住后者的边界，否则
    // 一次「卡没了」会悄悄变成「又冒出一张新卡」。
    const panel = mountPanel(oneRow({ body: '这件事交给你', taskId: 'ghost-card' }), 'list', 'wide')
    try {
      openRowDetail(panel)
      const ask = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim() === '问 AI')
      /* **这一枚必须存在，而且必须按得到**：写成 `if (ask !== undefined)` 的话，按钮不见了
         这条也会绿——那正是「假面比现实宽容」：测试说它测了，其实什么都没测。 */
      expect(ask, '卡被删掉的行详情里没有「问 AI」那一枚').toBeDefined()
      click(ask)
      panel.settle()
      expect(panel.calls.join(' '), '卡被删了却建了一张新卡').not.toContain('createTask(')
    } finally {
      panel.dispose()
    }
  })
})

describe('没挂卡的一条也能交给 AI：按「执行」= 就地建卡并开跑', () => {
  /** 那一枚按文字找（它同时出现在详情与行菜单里，而这里问的是详情那一枚）。 */
  const startButton = (panel: ReturnType<typeof mountPanel>): HTMLButtonElement | undefined =>
    [...panel.surface.querySelectorAll('button')]
      .find(node => (node.textContent ?? '').trim() === '执行') as HTMLButtonElement | undefined

  it('按下去：板上多了一张卡，而且它开跑了', () => {
    // 读者按下这一枚的意思是「这条我要让 AI 干」，与有没有卡无关。它原来在没有卡时是一条
    // **死路**（按钮画得出来、按下去什么都不会发生）——这一条钉住「一件动作两件事」：先建卡，
    // 再让那张卡开跑。
    const panel = mountPanel(oneRow({ body: '把这件事做了', taskId: undefined }), 'list', 'wide')
    try {
      openRowDetail(panel)
      const button = startButton(panel)
      expect(button, '详情里没有「执行」那一枚').toBeDefined()
      click(button)
      panel.settle()
      const calls = panel.calls.join(' ')
      expect(calls, '没有建卡').toContain('createTask(')
      expect(calls, '建了卡却没有开跑').toContain('runTask(')
    } finally {
      panel.dispose()
    }
  })

  it('按完之后这一行真的挂上了那张新卡：文档里 links、屏上有芯片', () => {
    // 一次动作两件事（建卡 + 开跑）之后，这一行还不是「挂着卡」的话，屏上就会出现一张没人认领
    // 的卡：文档里 `taskId` 没写、行尾没有芯片、状态照旧读它自己那两个值。这一条把那个缺口钉住。
    const panel = mountPanel(oneRow({ body: '把这件事做了', taskId: undefined }), 'list', 'wide')
    try {
      openRowDetail(panel)
      click(startButton(panel))
      panel.settle()
      expect(panel.lastWrite()[0]?.taskId, '文档里没有把这一行挂到新卡上').toBe('task-minted')
      const chip = panel.surface.querySelector('[class*="itemRowCardChip"]')
      expect(chip, '行尾那枚卡芯片没有出现').not.toBeNull()
      expect(chip?.textContent ?? '', '芯片没有说那张卡在哪一栏').toContain('待办')
    } finally {
      panel.dispose()
    }
  })

  it('正文为空：**不建卡**（建出来也是一张跑不起来的卡）', () => {
    // 看板的执行门禁读的是「执行 Prompt」，而它来自这一条的正文——所以正文为空时建出来的卡
    // 一跑就停。这里钉住：宁可不建，也不留一张假卡。
    const panel = mountPanel(oneRow({ taskId: undefined }), 'list', 'wide')
    try {
      openRowDetail(panel)
      const button = startButton(panel)
      expect(button, '详情里没有「执行」那一枚').toBeDefined()
      click(button)
      panel.settle()
      expect(panel.calls.join(' '), '正文为空却建了一张跑不起来的卡').not.toContain('createTask(')
    } finally {
      panel.dispose()
    }
  })
})

/** The chip that asks for a new card, named by its text rather than its class. */
function newCardChip(root: ParentNode): HTMLButtonElement | null {
  for (const chip of root.querySelectorAll('button')) {
    if ((chip.textContent ?? '').trim() === '新建卡片') return chip as HTMLButtonElement
  }
  return null
}

/** Open one row's detail, whatever band — the same steps the checklist suite uses. */
function openRowDetail(panel: ReturnType<typeof mountPanel>): void {
  openRowMenu(panel.surface)
  const entry = findMenuEntry(panel.surface, '展开详情')
  if (entry === null) throw new Error('the row menu offers no way to expand the row')
  click(entry)
}

describe('an in-place editor answers a press away from it, and the row stays open', () => {
  it('the body prompt opens into a block, and a press outside collapses the block with the row still open', () => {
    const panel = mountPanel(oneRow({}), 'list', 'wide')
    try {
      openRowDetail(panel)
      const row = rowEls(panel.surface)[0]!
      expect(row.getAttribute('data-open'), 'the row did not open').toBe('')
      const prompt = [...row.querySelectorAll('button')].find(one => (one.textContent ?? '').includes('写点什么'))
      if (prompt === null) throw new Error('the open row has no body prompt')
      click(prompt)
      const field = [...row.querySelectorAll('textarea')].find(one => one.getAttribute('aria-label') === '正文')
      expect(field, 'pressing the prompt turned nothing into a body block').not.toBeNull()
      // 点开别处 = 焦点走出这一块。文字已随每次键入写进文档，收回只是收场。
      act(() => { field!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
      const promptAgain = [...row.querySelectorAll('button')].find(one => (one.textContent ?? '').includes('写点什么'))
      expect(promptAgain, 'the body block stayed open after a press outside it').not.toBeNull()
      expect(row.getAttribute('data-open'), 'the collapse took the open row with it').toBe('')
    } finally {
      panel.dispose()
    }
  })
})

/** A row that already carries two steps, so order and removal are both real. */
function twoSteps(): ItemRecord[] {
  return oneRow({
    steps: [
      { id: 'r-1.s1', text: '第一步', done: false },
      { id: 'r-1.s2', text: '第二步', done: true },
    ],
  })
}

/** The rows on screen, in the order the reader sees them. `data-status` is the
 *  row's own identity hook: it is on the row root and nowhere else, so a class
 *  rename cannot turn this helper into a selector for the row's buttons. */
const rowEls = (root: ParentNode): Element[] =>
  [...root.querySelectorAll('[data-status]')]

/** Let every already-resolved promise inside the panel land. */
const settle = async (): Promise<void> => {
  for (let round = 0; round < 4; round += 1) await act(async () => { await Promise.resolve() })
}

/** Serialise the LIVE mounted panel into a standalone page `shot-panel.mjs` can
 *  capture — the DOM after the press that put the state on screen, the sheet on
 *  disk as the stylesheet, and the value properties written back into attributes
 *  so a controlled field says what the reader would have seen. */
function writeMountedPage(panel: ReturnType<typeof mountPanel>, target: string): void {
  for (const node of panel.surface.querySelectorAll('input, textarea')) {
    const field = node as HTMLInputElement | HTMLTextAreaElement
    if (field.getAttribute('value') !== field.value) field.setAttribute('value', field.value)
  }
  const document_ = [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>task list panel (mounted)</title>',
    '<style>', hostTokenCss(), '</style>',
    '<style>', panelCss(), '</style>',
    '<style>',
    'html,body{margin:0;block-size:100%;}',
    'body{display:flex;flex-direction:column;overflow:hidden;}',
    '</style></head><body>',
    panel.host.outerHTML,
    '</body></html>',
  ].join('\n')
  /* The mounted DOM carries the renderer's SCOPED class names, the sheet on
     disk the friendly ones — the same split the static artifact reconciles
     before writing. Without it the capture renders completely unstyled, which
     reads as a CSS failure and is nothing of the kind. */
  const aligned = alignClassNames(document_, panelCss())
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, aligned.html, 'utf8')
}

describe('「新建卡片」 names the card in place, where the picker stands', () => {
  it('pressing it turns the chip into the naming field with the row\'s own words in it', () => {
    // 预填是「借来的标题」：挂不上的那条就是名字该长出来的那条。空场起步是
    // 让读者从零开始给一条**已经有话**的行再讲一遍同一句话。
    const panel = mountPanel(oneRow({}), 'list', 'wide')
    try {
      openRowDetail(panel)
      const chip = newCardChip(panel.surface)
      if (chip === null) throw new Error('the card picker does not offer a way to make a card')
      click(chip)
      const field = namingField(panel.surface)
      expect(field, 'pressing the chip turned nothing into a naming field').not.toBeNull()
      expect(field?.value, 'the field does not carry the row\'s own words to start from').toBe('一条普通的行')
      panel.settle()
      expect(panel.calls, 'opening the field itself touched the board').toEqual([])
      expect(panel.writes.length, 'opening the field itself wrote to the list').toBe(0)
    } finally {
      panel.dispose()
    }
  })

  it('choosing an existing card hangs the row there, and 不挂 unhands it', () => {
    // 选择器的两个老手势与新建是同一族：都是「这一条挂在哪」的一次作答，都写文档。
    // naming 的到来没有动它们——这条钉在这里，族里少一个都不行。
    const panel = mountPanel(oneRow({}), 'list', 'wide')
    try {
      openRowDetail(panel)
      const card = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim() === '画廊第二版')
      if (card === undefined) throw new Error('the picker does not list the card the fake board holds')
      click(card)
      expect(panel.lastWrite()[0]?.taskId, 'the chosen card never reached the document').toBe('task-1')
      const none = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim() === '不挂')
      if (none === undefined) throw new Error('the picker dropped its 「不挂」')
      click(none)
      expect(panel.lastWrite()[0]?.taskId, '「不挂」 did not clear the link').toBeUndefined()
    } finally {
      panel.dispose()
    }
  })

  it('the card a promotion mints is seeded from the row; hanging an existing card writes the link only', () => {
    // 挂卡的两句实话，一条钉住：新建的那张卡的名字/执行稿/描述是**播种**——来自
    // 行自己的词，建完两边各改各；而挂已有卡只写 taskId 一个字段，板的那边一个字
    // 都没被碰（calls 里除 createTask 外没有别的写法）。
    const panel = mountPanel(oneRow({ title: '画廊随访', body: '把东墙的灯换掉', notes: '灯座是旧款' }), 'list', 'wide')
    try {
      openRowDetail(panel)
      const promote = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim() === '变成看板卡片')
      if (promote === undefined) throw new Error('the detail carries no promote button')
      click(promote)
      panel.settle()
      const made = panel.minted[0]
      expect(made, 'the press minted no card').toBeDefined()
      expect(made?.title, 'the card did not take the row\'s own title as its seed').toBe('画廊随访')
      expect(made?.prompt, 'the card did not take the row\'s body as its seed').toBe('把东墙的灯换掉')
      expect(made?.description, 'the card did not take the row\'s notes as its seed').toBe('灯座是旧款')
      // And hanging an EXISTING card touches nothing on the board — the card's
      // own words are not this surface's to write.
      const card = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim() === '画廊第二版')
      if (card === undefined) throw new Error('the picker does not list the fake board\'s card')
      click(card)
      panel.settle()
      expect(panel.calls.filter(name => !name.startsWith('createTask')), 'hanging an existing card wrote to the board').toEqual([])
      expect(panel.lastWrite()[0]?.taskId, 'the chosen card never reached the document').toBe('task-1')
    } finally {
      panel.dispose()
    }
  })

  it('Enter with a name makes the card on the board and hangs this row on it', () => {
    const panel = mountPanel(oneRow({}), 'list', 'wide')
    try {
      openRowDetail(panel)
      click(newCardChip(panel.surface))
      const field = namingField(panel.surface)
      if (field === null) throw new Error('the naming field never appeared')
      typeInto(field, '画廊随访')
      press(field, 'Enter')
      expect(panel.calls, 'the press never asked the board for a card').toContain('createTask(1)')
      expect(panel.lastWrite()[0]?.taskId, 'the row was never hung on the card that was made').toBe('task-minted')
      // THE SCREEN ANSWERS TOO: the card the press minted is a chip in the same
      // strip, and it is the one reading as chosen.
      panel.settle()
      const chosen = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim() === '画廊随访')
      expect(chosen, 'the card the press made is not offered in the picker at all').not.toBeUndefined()
      expect(chosen?.getAttribute('data-on'), 'a picked card that does not read as picked is a strip that lies').not.toBeNull()
      // And the naming field is gone: the strip is back to chips only.
      expect(namingField(panel.surface), 'the field outlived its own answer').toBeNull()
    } finally {
      panel.dispose()
    }
  })

  it('a cleared name stays in the field, says what is missing, and writes nothing', () => {
    const panel = mountPanel(oneRow({}), 'list', 'wide')
    try {
      openRowDetail(panel)
      click(newCardChip(panel.surface))
      const field = namingField(panel.surface)
      if (field === null) throw new Error('the naming field never appeared')
      typeInto(field, '')
      press(field, 'Enter')
      panel.settle()
      expect(namingField(panel.surface), 'an empty name closed the field — a silent refusal is a press that looks broken').not.toBeNull()
      expect(panel.surface.textContent ?? '', 'nothing said why the press did nothing').toContain('先给这张卡起一个名字')
      expect(panel.calls, 'an empty name still reached the board').toEqual([])
      expect(panel.writes.length, 'an empty name still wrote to the list').toBe(0)
    } finally {
      panel.dispose()
    }
  })

  it('Escape closes the field and writes nothing', () => {
    const panel = mountPanel(oneRow({}), 'list', 'wide')
    try {
      openRowDetail(panel)
      click(newCardChip(panel.surface))
      const field = namingField(panel.surface)
      if (field === null) throw new Error('the naming field never appeared')
      typeInto(field, '画廊随访')
      press(field, 'Escape')
      panel.settle()
      expect(namingField(panel.surface), 'Escape left the field open').toBeNull()
      expect(newCardChip(panel.surface), 'the chip never came back').not.toBeNull()
      expect(panel.calls, 'Escape still reached the board').toEqual([])
    } finally {
      panel.dispose()
    }
  })

  it('a row that is already on a card can be re-pointed at a new card', () => {
    // 里 alreadyLinked 判定拦的是「重复按提升」；选择器这一下是明说的「换一张新的」，
    // 所以它必须能落地——否则挂错了卡的那条只能先不挂再建一次。
    const panel = mountPanel(oneRow({ taskId: 'task-1' }), 'list', 'wide')
    try {
      openRowDetail(panel)
      click(newCardChip(panel.surface))
      const field = namingField(panel.surface)
      if (field === null) throw new Error('the naming field never appeared')
      typeInto(field, '第二版的画廊')
      press(field, 'Enter')
      expect(panel.calls, 'a deliberate card was refused like an accidental one').toContain('createTask(1)')
      expect(panel.lastWrite()[0]?.taskId, 'the row never moved to the card it named').toBe('task-minted')
    } finally {
      panel.dispose()
    }
  })

  it('the sheet names a new card in its own strip, and saving makes the card and links the row at once', () => {
    // 一张还没存在的卡不能在一个半路取消的表单里先落子：名字先收在表单里，
    // 「存下」这一下用同一次提升把卡和行一起带上——看板上不留名存实亡的空卡。
    const panel = mountPanel(oneRow({}), 'list', 'wide')
    try {
      // 打开表单：顶栏那一枚「＋新建一条」。
      const open = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').includes('新建一条'))
      click(open)
      // 先把这一行写成一句有内容的话——一张只有名字的行不会被存下来。
      const titleField = [...panel.surface.querySelectorAll('input')]
        .find(node => node.getAttribute('aria-label') === '标题') as HTMLInputElement | null
      if (titleField === null) throw new Error('the sheet has no field for the row title')
      typeInto(titleField, '换一盆花')
      click(newCardChip(panel.surface))
      const field = namingField(panel.surface)
      if (field === null) throw new Error('the sheet offers no naming field for the new card')
      typeInto(field, '画廊改造')
      press(field, 'Enter')
      panel.settle()
      expect(namingField(panel.surface), 'the field never closed after the name was taken').toBeNull()
      const chosen = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim() === '画廊改造')
      // 名字收下之后答案留在原地：一枚选中的卡芯片。
      expect(chosen?.getAttribute('data-on'), 'the name was taken but the answer did not stay picked').not.toBeNull()
      expect(panel.calls, 'taking the name itself touched the board — the card belongs to the save').toEqual([])
      // 存下这一条。
      const save = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim() === '存下这一条')
      if (save === undefined) throw new Error('the sheet carries no button to save')
      click(save)
      expect(panel.calls, 'the save never asked the board for the card').toContain('createTask(1)')
      const last = panel.lastWrite()
      expect(last.length, 'the saved row is not in the document').toBe(2)
      expect(last[1]?.title, 'the row the reader wrote did not arrive').toBe('换一盆花')
      expect(last[1]?.taskId, 'the card and the row were not born linked').toBe('task-minted')
    } finally {
      panel.dispose()
    }
  })
})

describe('the mounted-page artifact, for the states a static render cannot reach', () => {
  /**
   * THE STATES THAT ONLY EXIST AFTER A PRESS.
   *
   * The static artifact (`writeRenderArtifact`) photographs markup produced by
   * `renderToStaticMarkup` — a real render of the real component, and one with
   * no event handlers, so a React-local state like an opened naming field can
   * never appear in it. A state whose SOURCE is a press is photographed by
   * MOUNTING the real panel under jsdom, making the press, and serialising the
   * live DOM afterwards: the DOM is the product's, the stylesheet is the
   * product's, and only the layout is left to the browser that looks at it.
   *
   * Writing happens ONLY when `DSH_PANEL_HTML` names a path, so the suite stays
   * a suite: the same env the static artifact reads, one name more:
   * `DSH_PANEL_MOUNT` — `card-naming` puts the card picker's naming field on
   * screen, prefilled with the row's own words. `DSH_PANEL_BAND` picks the band
   * as it does for the static path.
   */
  it('writes one when DSH_PANEL_HTML names a path', async () => {
    const target = process.env.DSH_PANEL_HTML
    if (target === undefined || target === '') return
    const state = process.env.DSH_PANEL_MOUNT ?? 'card-naming'
    const band = process.env.DSH_PANEL_BAND === 'narrow' ? 'narrow' : 'wide'
    if (state !== 'card-naming' && state !== 'card-pending' && state !== 'batch' && state !== 'steps-open'
      && state !== 'archive' && state !== 'agenda' && state !== 'archive-rows' && state !== 'archive-restored'
      && state !== 'create-sheet' && state !== 'row-body-open' && state !== 'menu-open' && state !== 'calendar-folded'
      && state !== 'card-door' && state !== 'chips-open' && state !== 'dangling-card'
      && state !== 'compose-three-dates' && state !== 'card-focus') throw new Error(`a mounted state this bench does not know: ${state}`)

    if (state === 'chips-open') {
      /* 搜索框下面那排筛子芯片**开着**的那一屏（四枚：状态 · 优先级 · 日期 · 迟迟没动）。
       *
       * 加它的理由：芯片的几何一直没有被真浏览器量过，而读者刚点出来的缺陷正是几何——
       * 「它右边那个叉没有居中好，感觉有点偏」。同时这一屏也把「按下的每一个筛子都有芯片」
       * 这件事**画出来**：左栏按得动的四枚，芯片里一枚都不许少。 */
      const items = [...fixtures()]
      const panel = mountPanel(items, 'list', band === 'narrow' ? 'narrow' : 'wide')
      try {
        const box = panel.surface.querySelector('input[type="search"], input[type="text"]')
        if (box === null) throw new Error('the bar drew no search box')
        typeInto(box, 'status:done p4 has:undated has:overdue')
        await settle()
      } catch (error) {
        panel.dispose()
        throw error
      }
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    if (state === 'card-door') {
      /* 卡芯片**是门**的那一屏（装配层把 `openCard` 接上了）。
       *
       * 加它的理由：这一枚的形态变了——读数（`span`）与门（`button`）在屏上是两种东西，而
       * 「按得动的东西看起来要像按得动」只有看一眼才算验过。对照组是同一份 fixture 在没有那扇
       * 门时的那一屏（默认的静态产物），两张图放一起看，差别应当**只有**这一枚的形态。 */
      const items = [...fixtures()]
      const panel = mountPanel(items, 'list', band === 'narrow' ? 'narrow' : 'wide', { openCard: () => {} })
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    if (state === 'calendar-folded') {
      /* 日历**折起来**之后的那一屏。
       *
       * 加它的理由是被读者点出来的：「展开的情况下显示没问题，可是我再点击一下收回时，
       * 2026-10 这个内容直接往左移动了一下。」——而这句话只有在**两个状态各出一张图、
       * 再比月题的位置**时才能被证实或否证。静态渲染永远只有默认那一个状态，所以这一屏
       * 是这条对齐律唯一的取证方式。 */
      const panel = mountPanel([...fixtures().slice(0, 2)], 'list', band === 'narrow' ? 'narrow' : 'wide')
      try {
        const fold = [...panel.surface.querySelectorAll('button')]
          .find(one => (one.getAttribute('aria-label') ?? '') === '按日子看')
        if (fold === undefined) throw new Error('the rail drew no calendar fold control')
        click(fold)
        await settle()
      } catch (error) {
        panel.dispose()
        throw error
      }
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    if (state === 'menu-open') {
      /* ⋮ 菜单开着的那一屏。
       *
       * 加它的理由是被读者点出来的：他说菜单里那些字「偏下，完全没有上下居中于按钮」，
       * 而**这一排从来没有被测台架量过**——静态渲染画不出打开的菜单（`renderToStaticMarkup`
       * 按不了东西），所以它一直是这一页上唯一没有真浏览器几何的那些控件。 */
      const items = [...fixtures().slice(0, 2)]
      const panel = mountPanel(items, 'list', band === 'narrow' ? 'narrow' : 'wide')
      try {
        const trigger = [...panel.surface.querySelectorAll('button')]
          .find(one => (one.getAttribute('aria-label') ?? '') === '这一条能做的事')
        if (trigger === undefined) throw new Error('the first row drew no ⋮ button')
        click(trigger)
        await settle()
      } catch (error) {
        panel.dispose()
        throw error
      }
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    if (state === 'row-body-open') {
      /* 展开了这一行、并且**按了「＋ 写点什么」**之后的那一屏。
       *
       * 读者的原话是两句：按了正文之后那一行「暗色的背景直接消失」，而且框的四个角
       * 「像缺了一块」。两句话说的都不是属性——`data-open` 在 jsdom 里量过，它一直在
       * （见「pressing into the body of an open row…」那条）——所以能被看见的只有
       * **同一份 DOM 在真浏览器里画成什么**。这就是那个状态：这一步结束时的活 DOM，
       * 加真样式表，交给浏览器。 */
      const items = [...fixtures().slice(0, 2)]
      const panel = mountPanel(items, 'list', band === 'narrow' ? 'narrow' : 'wide')
      try {
        const row = [...panel.surface.querySelectorAll('[data-status]')][0] as HTMLElement | undefined
        if (row === undefined) throw new Error('the list page drew no row to open')
        click(row)
        await settle()
        const prompt = [...row.querySelectorAll('button')].find(one => (one.textContent ?? '').includes('写点什么'))
        if (prompt === undefined) throw new Error('the open row carries no 正文 prompt')
        click(prompt)
        await settle()
      } catch (error) {
        panel.dispose()
        throw error
      }
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    if (state === 'dangling-card') {
      /* **一张卡被删掉之后那一屏。**
       *
       * 对照法：同一张纸上两行——一行挂在板上真有的那张卡上（芯片在），一行挂在一张
       * **已经被删掉**的卡上（芯片不在，且它读自己的两个值）。两行放一起，差别应当只在
       * 那一枚芯片上，而这正是「卡没了就不再是一张卡」唯一看得见的形态。 */
      const items = [
        { ...oneRow({ taskId: 'task-1' })[0] as ItemRecord, id: 'r-1', ref: 1, title: '挂在还活着的那张卡上' },
        { ...oneRow({ taskId: 'task-gone' })[0] as ItemRecord, id: 'r-2', ref: 2, title: '挂在一张已经被删掉的卡上' },
      ]
      const panel = mountPanel(items, 'list', band === 'narrow' ? 'narrow' : 'wide', { cards: ['task-1'] })
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    if (state === 'card-focus') {
      /* **从看板跳过来的那一屏。**
       *
       * 装配层记下一个带 token 的请求之后，清单只显示挂着那张卡的条目，并且顶上多一枚可摘的
       * 筛选芯片。这一屏要看的正是那枚芯片：它与旁边那排筛选芯片**同一个样子**（同一个类），
       * 而且是看得见、摘得掉的——而不是一个藏在别处、读者找不到也关不掉的过滤器。 */
      const items = [
        { ...oneRow({ taskId: 'task-1' })[0] as ItemRecord, id: 'r-1', ref: 1, title: '挂着那张卡的一条' },
        { ...oneRow({ taskId: 'task-1' })[0] as ItemRecord, id: 'r-2', ref: 2, title: '也挂着那张卡的一条' },
      ]
      const panel = mountPanel(items, 'list', band === 'narrow' ? 'narrow' : 'wide', { cards: ['task-1'], focus: { token: 1, cardId: 'task-1' } })
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    if (state === 'compose-three-dates') {
      /* **一行里写三个 `@` 的那一屏。**
       *
       * 读者问过「是不是 @ 完一个再 @ 一个，三个都能显示」——答案在屏上：三枚芯片，三个
       * 日期，各到各的框。同名的第二个 `@` 不成芯片并有一句为什么，这一屏也画出来。 */
      const panel = mountPanel(fixtures(), 'list', band === 'narrow' ? 'narrow' : 'wide')
      try {
        const open = [...panel.surface.querySelectorAll('button')]
          .find(node => (node.textContent ?? '').includes('新建一条'))
        if (open === undefined) throw new Error('the bar carries no 新建一条')
        click(open)
        const box = panel.surface.querySelector('input[class*="itemInput"]') as HTMLInputElement | null
        if (box === null) throw new Error('the sheet drew no grammar line')
        typeInto(box, '大活儿 @不早于 10/25 @10/26 @不晚于 10/27 @10/28')
        panel.settle()
      } catch (error) {
        panel.dispose()
        throw error
      }
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    if (state === 'create-sheet') {
      /* 「新建一条」那张纸。它与详情面板装同一批字段（三个日期、正文/步骤/备注、选卡、
       * 标签），所以两者的两列几何必须量得出同一个数——这块状态就是为了把两边放进
       * 同一支仪器里比。 */
      const panel = mountPanel(fixtures(), 'list', band === 'narrow' ? 'narrow' : 'wide')
      try {
        const open = [...panel.surface.querySelectorAll('button')]
          .find(node => (node.textContent ?? '').includes('新建一条'))
        if (open === undefined) throw new Error('the bar carries no 新建一条')
        click(open)
        await settle()
      } catch (error) {
        panel.dispose()
        throw error
      }
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    /** 抽屉里有三行的样子——读者的屏上出现的正是这个状态，而它此前无法被拍下来。 */
    const tombstoneRows = (): readonly ItemRecord[] => [1, 2, 3].map(n => ({
      id: `gone-${String(n)}`, ref: 100 + n, title: `删掉的那一条 ${String(n)}`, body: '', notes: '', steps: [],
      status: 'todo' as const, priority: 'normal' as const, tags: [],
      startsAfter: undefined, dueAt: undefined, hardDueAt: undefined, taskId: undefined,
      origin: { source: 'human' as const, at: Date.now() }, createdAt: Date.now(), updatedAt: Date.now(),
    }))

    if (state === 'archive-rows' || state === 'archive-restored') {
      /* 抽屉里有行、以及「按了放回去一条之后」的那一屏。读者的原话是：按完放回去，
       * 那些行会往下弹——这个状态存在的唯一目的就是让那一跳**看得见**（同一支仪器
       * 出两张图，量同一批盒子的位置）。 */
      const panel = mountPanel(fixtures(), 'list', band === 'narrow' ? 'narrow' : 'wide', { deleted: tombstoneRows() })
      try {
        const look = [...panel.surface.querySelectorAll('button')]
          .find(node => (node.textContent ?? '').includes('已删除'))
        if (look === undefined) throw new Error('the rail carries no 「已删除」')
        click(look)
        await settle()
        if (state === 'archive-restored') {
          const back = [...panel.surface.querySelectorAll('button')]
            .find(node => (node.textContent ?? '').trim() === '放回去')
          if (back === undefined) throw new Error('the drawer holds no row to put back')
          click(back)
          await settle()
          await settle()
        }
      } catch (error) {
        panel.dispose()
        throw error
      }
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    if (state === 'archive') {
      // The archive is a PAGE of its own now (the reader pressed the rail's row);
      // with nothing deleted this state is the empty page the reader demanded —
      // no presses needed: the mount itself answers with the default host's
      // empty archive.
      const panel = mountPanel(fixtures(), 'list', band === 'narrow' ? 'narrow' : 'wide')
      try {
        const look = [...panel.surface.querySelectorAll('button')]
          .find(node => (node.textContent ?? '').includes('已删除'))
        if (look === undefined) throw new Error('the rail carries no 「已删除」')
        click(look)
        await settle()
      } catch (error) {
        panel.dispose()
        throw error
      }
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    if (state === 'agenda') {
      const panel = mountPanel(fixtures(), 'schedule', band === 'narrow' ? 'narrow' : 'wide')
      try {
        panel.settle()
      } catch (error) {
        panel.dispose()
        throw error
      }
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    if (state === 'steps-open') {
      // A finished step's tick only exists behind its own fold, on the row that
      // CARRIES steps (the fixture's first row has none). The row's OWN ⋯ opens
      // ITS menu, and 「展开详情」 does the opening the way the reader does.
      const panel = mountPanel(fixtures(), 'list', band === 'narrow' ? 'narrow' : 'wide')
      try {
        const row = [...panel.surface.querySelectorAll('[data-status]')]
          .find(node => (node.textContent ?? '').includes('整整九天'))
        if (row === undefined) throw new Error('the step-bearing row is not on screen')
        const trigger = row.querySelector('[aria-haspopup="menu"]')
        if (trigger === null) throw new Error('the step-bearing row has no menu control')
        click(trigger)
        const entry = findMenuEntry(panel.surface, '展开详情')
        if (entry === null) throw new Error('the row menu offers no way to expand the row')
        click(entry)
        panel.settle()
        // The fold is its own control; it reads 「已完成 1 条」 while shut, so it
        // is found by what it IS, not by one of its two sentences.
        const fold = panel.surface.querySelector('button[class*="itemStepFold"]') as HTMLButtonElement | null
        if (fold === null) throw new Error('the steps board carries no fold')
        click(fold)
        panel.settle()
        // AND THE NOTES: this state is where the reader edits them, so the
        // capture shows the field the way a reader sees it.
        const notes = [...panel.surface.querySelectorAll('button')]
          .find(node => (node.textContent ?? '').includes('上下文备注'))
        if (notes === undefined) throw new Error('the detail carries no notes prompt')
        click(notes)
        panel.settle()
      } catch (error) {
        panel.dispose()
        throw error
      }
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    /* The pending pick only exists AFTER the sheet's naming field took a name:
       open the sheet by the door the reader uses (the ＋ button), name, confirm. */
    const openTheSheet = (panel: ReturnType<typeof mountPanel>): void => {
      const open = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').includes('新建一条'))
      if (open === undefined) throw new Error('the top bar carries no way to open the sheet')
      click(open)
    }

    if (state === 'batch') {
      // The bar only exists while something is held, so the reader's own holds
      // put it on screen. One hold is the smallest state that carries the whole
      // bar; each press settles on its own because the handlers read the state
      // of the render they were built in.
      const panel = mountPanel(fixtures(), 'list', band === 'narrow' ? 'narrow' : 'wide')
      try {
        act(() => { press(panel.surface, 'j') })
        act(() => { press(panel.surface, 'x') })
        panel.settle()
        if (panel.surface.querySelector('[class*="itemBatch"]') === null) throw new Error('the batch bar never came up')
      } catch (error) {
        panel.dispose()
        throw error
      }
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    if (state === 'card-pending') {
      const panel = mountPanel(fixtures(), 'list', band === 'narrow' ? 'narrow' : 'wide')
      try {
        openTheSheet(panel)
        click(newCardChip(panel.surface))
        const field = namingField(panel.surface)
        if (field === null) throw new Error('the sheet offers no naming field for the new card')
        typeInto(field, '画廊改造')
        press(field, 'Enter')
        panel.settle()
      } catch (error) {
        panel.dispose()
        throw error
      }
      writeMountedPage(panel, target)
      panel.dispose()
      return
    }

    const panel = mountPanel(fixtures(), 'list', band === 'narrow' ? 'narrow' : 'wide')
    try {
      openRowMenu(panel.surface)
      const entry = findMenuEntry(panel.surface, '展开详情')
      if (entry === null) throw new Error('the row menu offers no way to expand the row')
      click(entry)
      const chip = newCardChip(panel.surface)
      if (chip === null) throw new Error('the card picker does not offer the naming chip')
      click(chip)
      if (namingField(panel.surface) === null) throw new Error('the naming field never opened')
      panel.settle()
      writeMountedPage(panel, target)
    } finally {
      panel.dispose()
    }
  })
})

describe('the dates answer a press; the archive is a page; 多选 is on the bar', () => {
  /** A date line's reading, pressed as the reader presses it — **addressed by the field it
   *  is about** (`data-key`), not by the word printed above it. A gate that finds its line
   *  by a display word goes red the day that word changes, and its failure then reads
   *  「the axis does not carry a line named …」 — which points at the axis rather than at
   *  the word that moved. */
  function openDateLine(root: HTMLElement, key: 'startsAfter' | 'dueAt' | 'hardDueAt'): HTMLInputElement | null {
    const line = root.querySelector(`[class*="itemDateAxis"] li[data-key="${key}"]`)
    if (line === null) throw new Error(`the axis does not carry the ${key} line`)
    const reading = line.querySelector('button') as HTMLButtonElement | null
    if (reading === null) throw new Error(`the ${key} line carries no reading to press`)
    click(reading)
    return line.querySelector('input') as HTMLInputElement | null
  }

  it('a date reading opens the same-grammar field, prefilled with the value as it was stored', () => {
    // The stored date was typed as a WORD once; the field it opens shows the
    // word back, not a timestamp — the reader edits their own sentence.
    const panel = mountPanel(oneRow({ dueAt: NOW + DAY }), 'list', 'wide')
    try {
      openRowDetail(panel)
      const field = openDateLine(panel.surface, 'dueAt')
      expect(field, 'pressing the reading opened no field').not.toBeNull()
      expect(field?.value, 'the field does not show the stored date in the spelling it was typed in').toBe('2026-09-30')
      // And a word in, a date out — resolved against the bench's own clock:
      // 明天 is tomorrow's midnight, local, not a clock offset.
      typeInto(field!, '明天')
      press(field!, 'Enter')
      expect(panel.lastWrite()[0]?.dueAt, 'Enter never wrote a date').toBe(new Date(2026, 8, 30).getTime())
    } finally {
      panel.dispose()
    }
  })

  it('an emptied field clears the date, and Esc keeps the stored one', () => {
    const panel = mountPanel(oneRow({ dueAt: NOW + DAY }), 'list', 'wide')
    try {
      openRowDetail(panel)
      // The ESC half runs FIRST, on the pristine row: type a change, cancel it —
      // the stored date survives untouched.
      const field = openDateLine(panel.surface, 'dueAt')
      typeInto(field!, '明天')
      press(field!, 'Escape')
      panel.settle()
      expect(panel.lastWrite()[0]?.dueAt, 'Esc wiped the stored date').toBe(NOW + DAY)
      // Then the clear: an emptied field + Enter removes the promise.
      const field2 = openDateLine(panel.surface, 'dueAt')
      typeInto(field2!, '')
      press(field2!, 'Enter')
      panel.settle()
      expect(panel.lastWrite()[0]?.dueAt, 'an emptied field did not clear the promise').toBeUndefined()
    } finally {
      panel.dispose()
    }
  })

  it('an unreadable reading stays on screen and says why', () => {
    const panel = mountPanel(oneRow({}), 'list', 'wide')
    try {
      openRowDetail(panel)
      const field = openDateLine(panel.surface, 'dueAt')
      if (field === null) throw new Error('the field never opened')
      typeInto(field, '下下周三下午')
      press(field, 'Enter')
      panel.settle()
      expect(panel.surface.querySelector('input[class*="itemDateField"]'), 'the unreadable reading closed the field — a press that loses words is a press that lies').not.toBeNull()
      expect(panel.surface.textContent ?? '', 'nothing said why the press did nothing').toContain('我没读懂')
      expect(panel.lastWrite()[0]?.dueAt, 'an unreadable reading still wrote a date').toBeUndefined()
    } finally {
      panel.dispose()
    }
  })

  it('「多选」 on the bar arms the face, and pressing it again disarms', () => {
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const chip = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim() === '多选')
      if (chip === undefined) throw new Error('the bar carries no 多选')
      click(chip)
      panel.settle()
      const rows = rowEls(panel.surface)
      for (const row of rows) {
        expect(row.querySelector('input[type=checkbox]'), 'an armed row shows no tickbox').not.toBeNull()
      }
      click(chip)
      panel.settle()
      for (const row of rows) {
        expect(row.querySelector('input[type=checkbox]'), 'a box survived the disarm').toBeNull()
      }
    } finally {
      panel.dispose()
    }
  })

  it('the rail\'s 「已删除」 shows only deleted rows; nothing deleted is an empty page', async () => {
    // Standing IN the archive means the live table is not on this page — not
    // 「the same page with a section appended」。 The reader asked for a place
    // where only deleted rows exist, and an empty archive is that place with
    // nothing in it, said in its own sentence.
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const look = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').includes('已删除'))
      if (look === undefined) throw new Error('the rail carries no 「已删除」')
      click(look)
      // The archive read is ASYNC (a host round-trip), so a sync flush leaves the
      // page in its loading state — await the rounds instead.
      await settle()
      // THE LIVE TABLE IS GONE from this page.
      expect(panel.surface.querySelectorAll('[data-status]').length, 'the archive page still draws live rows').toBe(0)
      expect(panel.surface.textContent ?? '', 'the empty archive said nothing about being empty').toContain('没有删掉过任何一条')
      /* 活清单那条带子上的东西一件都不在这一页：搜索框（它也是命令面板的门）、
         排序、＋新建一条。**这条断言按控件点名，不按带子点名**——归档页现在有
         它自己的一条同高带子（题头 + 回去的路），那是修「页面顶上跳 56px」的办法；
         而「搜索 / 排序 / 新建说的不是眼前这份内容」这条理由一个字都没改。 */
      expect(panel.surface.querySelector('[class*="itemSearch"]'), 'the archive page kept the live page\'s search box').toBeNull()
      expect(panel.surface.textContent ?? '', 'the archive page offers a way to create a row').not.toContain('新建一条')
      expect(panel.surface.querySelector('[class*="itemArchiveTopBar"]'), 'the archive page has no bar of its own, so the page top jumps when the drawer opens').not.toBeNull()
      // Back out through the same door.
      const back = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').includes('已删除'))
      click(back)
      await settle()
      expect(panel.surface.querySelectorAll('[data-status]').length, 'the live list never came back').toBeGreaterThan(0)
    } finally {
      panel.dispose()
    }
  })

  it('the fold reads as a control: a mark that turns, a hover that answers', () => {
    // Both halves are MARKUP facts a static capture can check; the hover face is
    // a stylesheet fact the colour/token gates already count. What a reader
    // could not see before the fold was CLICKABLE — the mark is that sentence.
    const panel = mountPanel(twoSteps(), 'list', 'wide')
    try {
      openRowDetail(panel)
      const fold = panel.surface.querySelector('button[class*="itemStepFold"]') as HTMLElement | null
      expect(fold, 'the board carries no fold').not.toBeNull()
      expect(fold?.querySelector('svg'), 'the fold carries no disclosure mark — it still reads as a sentence').not.toBeNull()
      expect(fold?.getAttribute('aria-expanded'), 'the fold does not state its own state').not.toBeNull()
    } finally {
      panel.dispose()
    }
  })

  it('the agenda\'s card does not name the day a third time inside itself', () => {
    // The section already says its day twice (the name, then the date line); the
    // card's internal day head was a THIRD fact — and one bucketed by WRITE day,
    // so a row due today but written yesterday carried 「昨天」 inside 「今天」.
    const panel = mountPanel(fixtures(), 'schedule', 'wide')
    try {
      expect(panel.surface.querySelectorAll('[class*="itemDayHead"]').length,
        'the agenda card still carries its own day head').toBe(0)
    } finally {
      panel.dispose()
    }
  })

  it('the rename field answers Escape alone, and the row behind it stays open', () => {
    const panel = mountPanel(oneRow({}), 'list', 'wide')
    try {
      openRowDetail(panel)
      panel.settle()
      const title = panel.surface.querySelector('button[class*="itemRowText"]') as HTMLButtonElement | null
      if (title === null) throw new Error('the row carries no title control to press')
      click(title)
      panel.settle()
      const field = panel.surface.querySelector('input[class*="itemRowTitleInput"]') as HTMLInputElement | null
      expect(field, 'pressing the chip opened no title field').not.toBeNull()
      press(field!, 'Escape')
      panel.settle()
      expect(panel.surface.querySelector('input[class*="itemRowTitleInput"]'), 'Escape did not dismiss the field').toBeNull()
      // THE ROW BEHIND IT: still expanded — the detail is still on the page.
      expect(panel.surface.querySelector('[class*="itemDetail"]'), 'Escape collapsed the row behind the field').not.toBeNull()
    } finally {
      panel.dispose()
    }
  })

  it('Esc closes the top layer only: the create sheet goes before the row behind it', async () => {
    const panel = mountPanel(oneRow({}), 'list', 'wide')
    try {
      openRowDetail(panel)
      panel.settle()
      const newBtn = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').includes('新建一条'))
      if (newBtn === undefined) throw new Error('the bar carries no 新建一条')
      click(newBtn)
      panel.settle()
      expect(panel.surface.querySelector('[class*="itemCreateDialog"]'), 'the sheet never opened').not.toBeNull()
      const sheetField = panel.surface.querySelector('input[class*="itemCreateDialogTitleField"]') as HTMLInputElement | null
      press(sheetField ?? panel.surface, 'Escape')
      await settle()
      expect(panel.surface.querySelector('[class*="itemCreateDialog"]'), 'the sheet did not close on Esc').toBeNull()
      // THE ROW BEHIND IT: still open.
      expect(panel.surface.querySelector('[class*="itemDetail"]'), 'Esc collapsed the row behind the sheet').not.toBeNull()
    } finally {
      panel.dispose()
    }
  })
})

/* ── 日历：一块看得懂、按得动的日历 ─────────────────────────────────────────
 *
 * 这一段是读者点名的三件事，一件一条：
 *   1. 「点回 9 号什么都不显示」——按过的日子必须**留下痕迹**（一枚可摘的芯片），
 *      空列表必须说得出为什么空；
 *   2. 「点一个日子，再点另一个」——第二个必须**换掉**第一个，哪怕第一个那天没有行
 *      （老代码的「同族」取的是「有行的那些天」，于是没有行的那天留下的 `on:` 谁也
 *      没顶掉它）；
 *   3. 「像个毛坯房」——周首行、翻月、回到今天，三样都在，且**两档都有**。 */
describe('the calendar is a date filter a reader can read back', () => {
  /** 找到日历里写着这一天的格子。 */
  const dayCell = (surface: ParentNode, day: number): Element => {
    const cell = [...surface.querySelectorAll('button[class*="itemRailDay"]')]
      .find(node => (node.textContent ?? '').trim() === String(day))
    if (cell === undefined) throw new Error(`the calendar draws no cell for day ${String(day)}`)
    return cell
  }

  /** 芯片行里那些**念得出的**字（去掉 × 与「清掉筛选」）。 */
  const chipWords = (surface: ParentNode): string[] =>
    [...surface.querySelectorAll('[class*="itemQueryChipLabel"]')].map(node => (node.textContent ?? '').trim())

  it('a pressed day leaves a chip that names it, and taking the chip off un-filters the list', async () => {
    // 读者问的是「为什么空」，而答案必须**在屏幕上**：一枚写着那一天、能按掉的
    // 芯片。老版只有格子里一圈 26px 的墨环，窄档连格子都没有。
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const before = panel.surface.querySelectorAll('[data-status]').length
      click(dayCell(panel.surface, 12))
      await settle()
      const chips = chipWords(panel.surface)
      expect(chips.some(word => word.includes('12日')), `no chip names the day: ${chips.join(' / ')}`).toBe(true)
      expect(chips.join(' '), 'the chip printed the grammar instead of the day').not.toContain('on:')
      // 同一天再按一次 = 摘掉它，列表回到原来的行数。
      click(dayCell(panel.surface, 12))
      await settle()
      expect(panel.surface.querySelectorAll('[data-status]').length).toBe(before)
    } finally {
      panel.dispose()
    }
  })

  it('pressing a second day REPLACES the first, even when the first day holds nothing', async () => {
    // 这是「点回 9 号什么都不显示」的另一半：一个**没有行**的日子按下去也必须
    // 是一次完整的筛选（列表为空、芯片在），而它必须能被下一个日子顶掉。老代码
    // 的同族集合是「有行的那些天」，于是空日子的 token 永远留在串里——读者按了
    // 三个日子，串里有三个 `on:`，屏幕上只有一个芯片。
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      click(dayCell(panel.surface, 4))
      await settle()
      click(dayCell(panel.surface, 12))
      await settle()
      const days = chipWords(panel.surface).filter(word => word.includes('日'))
      expect(days.length, `two days are in the query at once: ${days.join(' / ')}`).toBe(1)
      expect(days[0]).toContain('12日')
      expect(panel.surface.querySelectorAll('[data-status]').length, 'a day with nothing on it must show nothing, not everything').toBe(0)
    } finally {
      panel.dispose()
    }
  })

  it('the probe bites: a day with no rows can never be a sibling of the day you press', () => {
    // 老代码的病灶，写成算术：同族集合取的是 `railDays` —— **有行的那些天**。
    // 于是一个没有行的日子（读者完全合理地会去问「那天有什么」）按下去之后，
    // 它留下的 `on:` 谁也顶不掉：下一个日子要顶掉的是「有行的那些天」，而它不在
    // 那份名单里。两个 `on:` 同时生效，屏幕上只有一个芯片，读者看到的是一份
    // 谁也说不出为什么的清单。
    const emptyDay = '2026-10-04'
    const daysWithRows = ['2026-10-12']
    expect(daysWithRows.map(day => `on:${day}`), 'the old sibling list DOES contain the empty day — this case is asserting nothing')
      .not.toContain(`on:${emptyDay}`)
    expect(dayTokensIn(`on:${emptyDay}`), 'the token in the box is not read back, so it can never be replaced')
      .toContain(`on:${emptyDay}`)
  })

  it('the month can be moved, today can be returned to, and the week says which column is which', async () => {
    const panel = mountPanel(fixtures(), 'list', 'wide')
    try {
      const title = (): string => (panel.surface.querySelector('[class*="itemRailMonth"]')?.textContent ?? '').trim()
      const start = title()
      expect(start, 'the calendar draws no month title').toMatch(/^\d{4}-\d{2}$/)
      // 周首行：七天，一天一个名字。
      const weekdays = [...panel.surface.querySelectorAll('[class*="itemRailWeekday"]')].map(node => (node.textContent ?? '').trim())
      expect(weekdays, `the calendar has no weekday row: ${weekdays.join('')}`).toEqual(['日', '一', '二', '三', '四', '五', '六'])
      const next = panel.surface.querySelector('button[aria-label="下一个月"]')
      expect(next, 'the calendar cannot be moved forward').not.toBeNull()
      click(next)
      expect(title(), 'pressing 下一个月 did not move the month').not.toBe(start)
      // 离今天远了，所以「回到今天」出现了——这是它唯一该出现的时候。
      const back = [...panel.surface.querySelectorAll('button')].find(node => (node.textContent ?? '').trim() === '回到今天')
      expect(back, 'looking at another month offers no way back to today').not.toBeUndefined()
      click(back)
      expect(title()).toBe(start)
      // **无路可回时它变灰，不消失。** 原本它是在按下的那一刻自己消失的（条件不再
      // 成立）——读者看到的是一个控件在他手指底下不见了，而屏上别处没有任何东西说明
      // 刚才发生了什么。控件可以变灰，不能在按下的那一刻消失。
      const home = (): HTMLButtonElement | null => panel.surface.querySelector('button[class*="itemRailToday"]')
      expect(home(), '「回到今天」 left the DOM instead of going quiet').not.toBeNull()
      expect(home()?.disabled, '「回到今天」 is still live while the reader IS on today').toBe(true)
    } finally {
      panel.dispose()
    }
  })
})

describe('批量那一枚也照同一条律（这一条是它自己发现的问题）', () => {
  it('选中的没挂卡的行照样问得出去，按钮也不是灰的', () => {
    // **按代码读不出这个 bug。** 批量那一枚原来由一个数管着（`heldCarded` = 存着卡号的行数），
    // 而「存着卡号」与「问得出去」是两件事：没挂过卡的行现在也问得出去（会就地建一张），
    // 它的 taskId 是空的，于是被那个数漏掉——按钮画成灰的，按下去什么都不发生。
    // 所以这条既断言**按钮不是灰的**，也断言**按下去真的建了卡**。
    const rows = [
      { ...(oneRow({ body: '第一件事' })[0] as ItemRecord), id: 'r-1', ref: 1 },
      { ...(oneRow({ body: '第二件事' })[0] as ItemRecord), id: 'r-2', ref: 2 },
    ]
    const panel = mountPanel(rows, 'list', 'wide')
    try {
      const armChip = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim() === '多选')
      expect(armChip, '面板里没有「多选」那一枚').toBeDefined()
      click(armChip)
      panel.settle()
      const allBox = panel.surface.querySelector('[class*="itemBatchLead"] input[type=checkbox]') as HTMLInputElement | null
      expect(allBox, '多选武装之后没有全选那一格').not.toBeNull()
      act(() => { allBox?.click() })
      panel.settle()
      const ask = [...panel.surface.querySelectorAll('[class*="itemBatch"] button')]
        .find(node => (node.textContent ?? '').includes('问 AI')) as HTMLButtonElement | undefined
      expect(ask, '批量那一排里没有「问 AI」').toBeDefined()
      expect(ask?.disabled, '两行都没挂卡，批量那一枚却是灰的').toBe(false)
      click(ask)
      panel.settle()
      expect(panel.calls.join(' '), '批量里没挂卡的行没有各自建卡').toContain('createTask(')
    } finally {
      panel.dispose()
    }
  })
})

describe('点标题就地改名字（使用者选的那条路）', () => {
  it('按标题打开编辑框，而且这一下不会同时选中这一行', () => {
    // 标题原来是纯文本，按它会**冒泡给整行**——那是「选中这一行」。做成控件之后必须在
    // 自己这一下把它挡住，否则一次点击会同时改名与选中：两个动作撞在一起，而读者只按了一下。
    const panel = mountPanel(oneRow({ title: '画廊第二版' }), 'list', 'wide')
    try {
      const title = [...panel.surface.querySelectorAll('button')]
        .find(node => (node.textContent ?? '').trim() === '画廊第二版')
      expect(title, '标题不是一个可点的控件——按它改不了名字').toBeDefined()
      click(title)
      panel.settle()
      expect(panel.surface.querySelector('[class*="itemRowTitleInput"]'), '按了标题却没有出现编辑框').not.toBeNull()
      expect(panel.surface.querySelector('[data-status][data-selected]'), '按标题把这一行也选中了').toBeNull()
    } finally {
      panel.dispose()
    }
  })
})