/**
 * The task-list panel, rendered for real and measured.
 *
 * WHY A RENDER HARNESS AND NOT A SCREENSHOT OF THE APP. Every layout rule in
 * DESIGN.md about width, density and containment was written by measuring a
 * rendering, and a static check cannot keep any of them: the panel filling its
 * box, the columns not overlapping, the text staying inside its slot — those
 * are facts about computed geometry, not about source text. So the loop has to
 * be "render it, measure it, fix what it shows".
 *
 * It renders the component rather than this page in the running GUI on purpose.
 * The GUI is behind a per-process launch token, and a second instance would
 * open the same storage unit the live one holds (a dual-open this plugin has
 * already been bitten by), so neither route is safe to rely on. The bench is the
 * third option and the better instrument: it is deterministic, it needs no
 * server, it runs on every `pnpm test`, and it can assert geometry instead of
 * asking a human to look at a PNG. The PNG is still the final word on taste —
 * `scripts/shot-panel.mjs` captures the same page `tests/panel-harness.ts`
 * writes — but the geometry claims are checked here, every run, by arithmetic
 * rather than by eye.
 *
 * WHAT THE BENCH IS, AND WHAT IT IS NOT. The bench itself lives in
 * `panel-harness.ts` because a second copy of it would be a second instrument
 * answering the same question, and two instruments come to disagree about what
 * the current code does. It renders `ItemListPanel` with the real stylesheet
 * and with the tokens lifted out of the INSTALLED harness. A snapshot of
 * `--dsw-*` values in a test goes stale the first time the host re-skins, and
 * then it is worse than no snapshot: it renders a plausible page in the wrong
 * colours and every conclusion drawn from it is about a host that no longer
 * exists. So the token block is extracted from the real theme stylesheet, and
 * `every dsw token the panel names exists in the host` is a TEST.
 *
 * WHAT THE PAGES PROVE, AND WHAT THEY CANNOT. A page carries STRUCTURE and
 * GEOMETRY. It does not carry colour: the running accent is a layer the theme
 * service applies from the reader's own settings, and the bench reads the
 * installed bundle's static sheet, so the accent in a capture is blue where the
 * product's is pink. Colour is therefore checked at the TOKEN layer (zero
 * literals, only `--dsh-tb-*`, and the canvas/inner split below), never by
 * looking at a pixel. A gate that used a capture as colour evidence would be
 * asserting about a host that is not running.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import * as lightningcss from 'lightningcss'
import { join } from 'node:path'
import { designCss, itemSurfaceSource, PAGES, repoRoot, type Page } from './panel-harness.ts'
import { clientSheets, pageCss } from './panel-harness.ts'
import {
  aliasLayer,
  allRules,
  backgroundOf,
  cssMembersOf,
  declaredOf,
  lastDeclaredOf,
  baseDeclaredOf,
  dswNamesReferenced,
  fixtures,
  hostTokens,
  itemSheet,
  itemSheetPath,
  itemSurfaceFiles,
  openRowOfEnv,
  panelCss,
  readSource,
  renderPanel,
  rulesOf,
  stripCssComments,
  writeRenderArtifact,
} from './panel-harness.ts'

/**
 * THE CANVAS / INNER SPLIT, stated for the two cases a single rule merges.
 *
 * The board already answers this, and it is the authority: `.board` AND
 * `.column` are both `var(--dsh-tb-bg)`, because a column is a plate that HOLDS
 * CONTENT and translucency has to compose through it. Only a thing that FLOATS —
 * a menu, a field, the danger zone — takes an opaque layer, because text has to
 * survive whatever is behind it.
 *
 * One rule with the opposite sense is the tempting shortcut: the root takes the
 * canvas and NOTHING inside it may. That reads fine in the file and renders as a
 * flat plate with a translucent border, because the list card and the five
 * overview tiles are painted with opaque layer tokens and cover the glass one
 * level down — while the board beside it keeps working. **The lesson is the split
 * itself**: 「canvas or inner」 is not a property of a token, it is a property of
 * whether the box holds the content or floats over it.
 */

/** One declaration-only rule, with the selector that introduced it. */
interface Rule {
  readonly selector: string
  readonly body: string
}

/**
 * Every DECLARATION rule in a sheet, nested ones included.
 *
 * A rule whose body still contains a `{` is an at-rule's own prelude, not a
 * declaration, and is skipped — otherwise a `@container` block would be
 * credited with every background inside it and the report would name the wrong
 * selector. That is the same class of mistake the container self-query gate
 * documents: a block that merely CONTAINS a rule does not declare what the rule
 * declares.
 *
 * COMMENTS COME OUT FIRST, and that is not tidiness — it is what makes any
 * answer this function gives usable. A sheet in this repository explains its own
 * rules at length, so a selector named in prose sits in the text next to the rule
 * that carries it. Without this strip, `declarationRules` merged that prose into
 * the FOLLOWING rule's selector, and a gate asking "is there a rule of this shape"
 * answered yes about a rule that does not exist — while the rule it was meant to
 * find had just been deleted. The reader would then be told to put back the very
 * thing that was removed. **A checker that cannot tell a rule from a sentence
 * about it will demand the wrong fix**, which is the whole of hard rule 14; the
 * remedy here is to read the sheet the way a browser does.
 *
 * **它建在 `allRules` 上**（台架里那一个读法），所以**它看得见窄档**。这一份曾经
 * 自己做，那份读法**不下降进 at-rule**——于是整段窄档对它不可见，而它守着的
 * 「宽度 100% 那一族必须声明 border-box」在窄档里**从未被检查过**。
 * @param css - the sheet.
 * @returns one entry per declaration rule, in source order.
 */
function declarationRules(css: string): Rule[] {
  return allRules(css).map((rule) => ({ selector: rule.selector, body: rule.body }))
}

/**
 * Every `@media` / `@container` block in a sheet, as [start, end) offsets.
 *
 * A declaration does not say whether it is CONDITIONAL — its position does.
 * `@container dsh-tb-item (min-width: 720px) { .itemWorkbench { --x: 0px } }`
 * contains an ordinary-looking declaration, and `declarationRules` reports it as
 * a rule like any other: it cannot tell a default from a band. So the question
 * "does this value answer to width" is a question about WHERE it sits, and this
 * is what answers it.
 *
 * Comments must already be off: a comment quoting a block would be brace-matched
 * exactly like a real one.
 * @param sheet - the sheet, comments already stripped.
 * @returns each block's own [start, end) range, in source order.
 */
function conditionalRanges(sheet: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const match of sheet.matchAll(/@(?:media|container)\b[^{]*\{/g)) {
    const start = match.index ?? 0
    let depth = 0
    let end = start
    for (; end < sheet.length; end++) {
      if (sheet[end] === '{') depth += 1
      else if (sheet[end] === '}') { depth -= 1; if (depth === 0) break }
    }
    out.push([start, end])
  }
  return out
}



/**
 * Every `@media (prefers-reduced-motion: reduce)` block in a sheet, brace-matched.
 *
 * A sheet is allowed to have SEVERAL of these — the board has three today — so
 * anything that reaches for "the block" by `lastIndexOf` or by `indexOf` is
 * reading ONE of them and calling it the one, and the next component that
 * adds a block of its own silently moves what every reduced-motion gate is
 * looking at. So the blocks are COLLECTED here, and a claim about the policy
 * asks about all of them instead of about a position.
 *
 * Comments must already be off before this runs: a CSS comment that quotes a
 * block would otherwise be brace-matched exactly like a real one.
 * @param sheet - the sheet, comments already stripped.
 * @returns each block's own text, braces included, in source order.
 */
function reducedMotionBlocks(sheet: string): string[] {
  const out: string[] = []
  for (const match of sheet.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g)) {
    const start = (match.index ?? 0) + match[0].length - 1
    let depth = 0
    let end = start
    for (; end < sheet.length; end++) {
      if (sheet[end] === '{') depth++
      else if (sheet[end] === '}') { depth--; if (depth === 0) break }
    }
    out.push(sheet.slice(start, end + 1))
  }
  return out
}

/**
 * Board transitions that spell their own duration and no reduced-motion block
 * silences the rule they belong to.
 *
 * THE OWNING SELECTOR IS THE WHOLE QUESTION. A transition found by scanning
 * text is a fragment (`{ transition: <value>`), and a fragment cannot say which
 * rule spends the literal — so asking such a fragment "does the block name
 * you?" can only ever answer no, and pairing it with a second condition that
 * does not depend on the answer turns the assertion into a constant. This
 * reads the rule with its selector attached, collects every selector a
 * reduced-motion block silences, and reports the literal whose OWN selector is
 * not among them.
 *
 * "Silenced" means the block declares `transition: none` or a zero duration
 * for that selector — naming a selector is not silencing it, and a selector
 * list that leaves this rule out silences nothing, which is how a third
 * literal gets in. The match is EXACT or a STATE of the named selector: a bare
 * `.x` in the block cannot silence `.x:hover`, because the state carries the
 * higher specificity and wins whatever the order.
 * @param sheet - the board sheet, comments intact or not.
 * @returns the literals, each with the selector that owns it.
 */
function unownedBoardTransitions(sheet: string): { selector: string; value: string }[] {
  const live = stripCssComments(sheet)
  const blocks = reducedMotionBlocks(live)
  const silenced = new Set<string>()
  for (const block of blocks) {
    for (const rule of declarationRules(block)) {
      const stops = /(?:^|[;{\s])transition\s*:\s*none/.test(rule.body)
        || /(?:^|[;{\s])transition-duration\s*:\s*0s/.test(rule.body)
      if (!stops) continue
      for (const part of selectorName(rule.selector).split(',')) silenced.add(part.trim())
    }
  }
  // The policy's own `transition: none` IS the naming, so the policy is not
  // scanned for literals of its own.
  const outside = blocks.reduce((rest, block) => rest.split(block).join('\n'), live)
  return declarationRules(outside)
    .filter(rule => !/var\(--dsh-tb-motion\)/.test(rule.body))
    .flatMap(rule => [...rule.body.matchAll(/(?:^|[;{\s])transition\s*:\s*([^;}]+)/g)]
      .map(call => ({ selector: selectorName(rule.selector), value: (call[1] ?? '').trim() })))
    .filter(found => ![...silenced].some(named =>
      named === found.selector || /^[:[]/.test(named.slice(found.selector.length))))
}

/**
 * A rule's selector, without whatever at-rule prelude the reader glued onto it.
 *
 * `declarationRules` takes the text between the previous `}` and this `{`, so a
 * rule written inside an at-rule can arrive carrying the at-rule's own name —
 * `@media (prefers-reduced-motion: reduce) .columnEmpty` for a rule that is not
 * in that block at all. That is harmless for an `.includes` or a `.test` and
 * actively misleading for anything that compares a selector for EQUALITY or
 * prints one to a reader, which is why the trimming lives here rather than in
 * the shared reader: changing that one would merge two same-named rules from
 * different at-rules into a single key, and the colour budget counts KEYS.
 * @param selector - the selector half as the reader returned it.
 * @returns the selector proper.
 */
function selectorName(selector: string): string {  return selector.split('{').pop()?.trim().replace(/\s+/g, ' ') ?? ''
}

/**
 * A CSS value's TOP-LEVEL parts.
 *
 * The whitespace inside `calc()` does not make it two values: `calc(a + b)` is
 * ONE value, and as an inline padding it says both ends pay the same. This is
 * the difference between a value that says one thing and a value that says two,
 * so it is counted at the top level only.
 */
function topLevelParts(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of value) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth === 0 && /\s/.test(ch)) {
      if (current !== '') { parts.push(current); current = '' }
      continue
    }
    current += ch
  }
  if (current !== '') parts.push(current)
  return parts
}

/** Whether a rule's block says a class may give way rather than overflow. */
function givesWay(body: string): boolean {
  return /(?:flex-wrap\s*:\s*wrap|white-space\s*:\s*normal|overflow-x?\s*:\s*(?:auto|scroll))/.test(body)
}

/** Whether joined rule bodies draw the named hairline separator. */
function drawsSeparator(text: string, side: 'border-inline-end' | 'border-inline-start' | 'border-block-start'): boolean {
  return [...text.matchAll(new RegExp(`(?:^|[;{\\s])${side}\\s*:\\s*([^;]+)`, 'g'))]
    .some(match => (match[1] ?? '').includes('var(--item-hair)'))
}

/**
 * Whether these two checks CAN run here, and if not, why.
 *
 * Both read the INSTALLED host: what tokens it declares, and whether the sheets
 * name any it does not. That host is found by resolution and is deliberately not
 * a dependency, so on CI it is simply not there — and a test that cannot read
 * its subject must not report a verdict about it. It did: every `--dsw-*` the
 * sheets name came back 「undeclared」, and CI has been red on this file for a
 * dozen commits, which is a long time for a red that says nothing.
 *
 * So the two are separated:
 *
 *   - the host is installed → both checks RUN, exactly as before;
 *   - no host AND this is CI → both SKIP, visibly, because CI does not install
 *     the host and that is a property of the environment, not of this code;
 *   - no host and this is NOT CI → they FAIL, with the existing 「the installed
 *     DSH theme bundle was not found」. A developer who has not installed the
 *     host still gets told, because on that machine it is a real setup gap.
 */
const hostFound = hostTokens().found
const onCi = process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== 'false'
const hostAbsentByDesign = !hostFound && onCi
// The CONDITION and the REASON are two values, and the first draft made the
// reason the condition — a string compared with `=== true`, which is never true,
// so the skip it announced never happened. Vitest 3's `skipIf` takes the
// condition only, so the reason is stated by the test below, which always runs.
const SKIP_WITHOUT_HOST = hostAbsentByDesign

describe('the panel renders against the host it will actually run in', () => {
  const { css: tokens } = hostTokens()
  const css = panelCss()
  const itemSheetText = itemSheet()

  // THE SKIP IS NEVER SILENT. Vitest 3's `skipIf` takes no reason, so a skipped
  // check looks exactly like a passing one in the summary — and a token contract
  // that quietly stops running is worse than one that was never written, because
  // the count still says 2300. This test always runs, in all three environments,
  // and names which of them it is in.
  it('says whether the host-backed checks ran, were skipped, or must be installed', () => {
    if (hostFound) {
      expect(tokens, 'the harness found the host but read no tokens out of it').not.toBe('')
      return
    }
    // No host. That is legitimate on CI — the host is discovered by resolution,
    // not declared as a dependency, so CI does not have one and the two checks
    // below skip instead of reporting a verdict they cannot reach. It is NOT
    // legitimate on a machine where the host is expected to be installed, and the
    // one thing this can still catch there is the developer who does not have it.
    expect(onCi,
      'the installed DSH theme bundle was not found, so the two host-backed checks below cannot read their subject and were skipped. On this machine they were expected to run — install the DSH, or set DSH_ROOT, or run on CI where their absence is by design.')
      .toBe(true)
  })

  it.skipIf(SKIP_WITHOUT_HOST)('finds the host token stylesheets, so nothing is measured against a snapshot', () => {
    // Without this the rest of the file would pass by asserting nothing: a
    // harness that silently renders colourless geometry is not a harness.
    expect(tokens, 'the installed DSH theme bundle was not found').not.toBe('')
    expect(tokens).toContain('--dsw-alias-bg-base')
    expect(tokens).toContain('--dsw-font-family')
  })

  it('has a stylesheet of its own, so the list stops living inside the board\'s', () => {
    expect(existsSync(itemSheetPath()), 'src/client/item/item.module.css does not exist yet').toBe(true)
  })

  it('keeps zero list rules inside the board stylesheet', () => {
    // The separation is the structural half: 74 list rules appended to the
    // board's sheet, under a heading that still reads "right-hand page", is what
    // it prevents — with a sheet of its own, nothing about the list can be edited
    // from the board's file by accident.
    //
    // The harness has to have read SOMETHING for the sweep below to mean
    // anything. `css.includes('src/client/board.module.css')` cannot prove that,
    // because `panelCss()` writes that path into the string as a BANNER COMMENT
    // whether or not the file exists: it is a decoration answering an assertion
    // about the source. What is left is the part that can actually fail: the
    // list's own rules are in the concatenation at all.
    expect(/\.item[A-Z]/.test(css), 'the harness read no list rules at all, so the sweep of the board page\'s sheets below is over an empty claim').toBe(true)
    /* 这一条问的是「清单的规则有没有漏在看板那一页的表里」。读法不能写死一个
       文件名——那一页可以有任意多张表，拆分与合并都不该让这条判据失效。所以扫
       **这一页的全部表**，并把命中的表名逐个报出来。 */
    const boardOnly = clientSheets()
      .filter(sheet => sheet.rel === 'src/client/board.module.css' || sheet.rel.startsWith('src/client/board/'))
      .map(sheet => `/* ${sheet.rel} */\n${sheet.css}`)
      .join('\n')
    const leftover = [...boardOnly.matchAll(/^\.item[A-Z][A-Za-z]*\s*\{/gm)].map(m => m[0])
    expect(leftover, `these list rules are still in the board page's own sheets: ${leftover.join(', ')}`).toEqual([])
    // The assertion that is left CAN fail, and this is the state it stands in
    // for: `panelCss()` writes each sheet's path into the string as a banner
    // comment, so on a concatenation carrying two banners and no rules the banner
    // check alone still holds. Nothing is asserted about that string as a claim
    // now — this line is a pin, so the next reader does not put the banner check
    // back.
    expect(
      /\.item[A-Z]/.test('/* src/client/board.module.css */\n/* src/client/item/item.module.css */\n'),
      'this assertion cannot tell a panel with list rules from one without, so it will pass on an empty read',
    ).toBe(false)
  })

  it.skipIf(SKIP_WITHOUT_HOST)('names only tokens the host declares, in the list\'s own sheet and in the shared alias layer', () => {
    // A token the host dropped resolves to nothing, which paints as transparent
    // — and a transparent surface is exactly the class of bug that reads as a
    // layout bug. Scoped to this surface: the board's own sheet is a different
    // surface, and a check that spans both is a check nobody can act on.
    const named = [...new Set([
      ...dswNamesReferenced(itemSheetText),
      ...dswNamesReferenced(aliasLayer()),
    ])]
    const missing = named.filter(name => !tokens.includes(`${name}:`) && ABSENT_BY_DECISION[name] === undefined)
    const why = missing.map(name => `${name}${ABSENT_BY_DECISION[name] === undefined ? '' : ` (${ABSENT_BY_DECISION[name]})`}`)
    expect(missing, `the list names tokens the host does not declare: ${why.join(', ')}`).toEqual([])
  })

  it('produces markup, not an error page', () => {
    const html = renderPanel(fixtures())
    expect(html.length).toBeGreaterThan(500)
    expect(html).not.toContain('undefined')
  })

  it('really opens the page it was asked for, on every page', () => {
    // A harness that accepts a setting and quietly drops it is worse than one
    // that refuses it: every capture then looks right and proves nothing. This
    // is the check that would have caught the page argument landing nowhere.
    // The gated bucket is pinned to the render clock rather than the fixture
    // clock: a hard-coded future date eventually becomes the past, and the test
    // would then ask for a gate section from a document that no longer has one.
    const now = Date.now()
    const rows = fixtures().map(item => ({
      ...item,
      startsAfter: item.startsAfter === undefined ? item.startsAfter : now + 6 * 86_400_000,
      dueAt: item.dueAt === undefined ? item.dueAt : now + 60 * 86_400_000,
    }))
    const schedule = renderPanel(rows, 'wide', 'schedule')
    const list = renderPanel(rows, 'wide', 'list')
    // The agenda is the page whose primary form is a day sequence; the list is the
    // page that counts what exists. 收件 was the third and it is gone — it was a
    // PREDICATE over the same document rather than a different question, so its rail
    // row was its only door and its own layout was the only thing it added.
    expect(schedule).toContain('没定日期')
    expect(schedule).toContain('还没开始')
    /* **日程少列了几行，它就说少在哪。** 读者的原话：「3 条里只看见 2 条」。两个
     * 排除都有理由（已完成是历史；刚记下、还没被读第二遍的一条属于收件），但理由不
     * 在屏幕上，屏幕上剩下的只有「少了一条」——而少了一条和丢了一条，读者分不出来。
     * 这一行按 `isAgendaItem` 自己的两个子句数数，所以它和列表里的行是同一次推导。
     *
     * **而它是安静行里的两个名字加两个数**（不是页尾的一段话）：零行的节、已完成、
     * 刚记下，说的都是「没排在这一页上」这同一件事，所以它们共用一行，而为什么落在
     * 这一行自己的 `InfoMark` 后面。 */
    expect(schedule, 'the agenda lists fewer rows than the document and says nothing about it')
      .toMatch(/已完成<\/span><i[^>]*>(\d+)<\/i>/)
    expect(schedule, 'the agenda lists fewer rows than the document and says nothing about it')
      .toMatch(/刚记下<\/span><i[^>]*>(\d+)<\/i>/)
    /* **零行的节不占一节，而那个 0 仍然写出来。** 「截止已过 0」曾经是一枚独立药丸加一条
     * 说明，而它下面一行都没有——一个没有内容的节，读者读到的是一句关于空的话。现在零行的
     * 节是安静行里的一个名字加一个 0：零仍然被说到，但它不再占一节的地方。
     *
     * 读的是**节头里**那些条数（`<h2>` 里的一枚），不是全页的：安静行里那几个 0 本来就该在。 */
    const heads = [...schedule.matchAll(/<h2 class="[^"]*itemGroupHead[^"]*"[\s\S]*?<\/h2>/g)].map(m => m[0])
    expect(heads.length, '日程页一个节头都没有，这条闸门在空转').toBeGreaterThan(0)
    const headCounts = heads.flatMap(head => [...head.matchAll(/itemGroupCount[^"]*">(\d+)</g)].map(m => Number(m[1])))
    expect(headCounts.length, '有节头没有说自己的条数').toBe(heads.length)
    expect(headCounts.filter(n => n === 0), '零行的节仍然占着一节——它该只是安静行里的一个 0').toEqual([])
    expect(schedule, '安静行没有把 0 写出来：零也被藏掉了').toMatch(/itemEmptyGroup[\s\S]{0,400}itemGroupCount[^"]*">0</)
    // THE LIST HOLDS EVERY ROW, which is the membership promise that outlived the
    // page: the bare capture is here, and so is the date-less row that carries a tag
    // (which is therefore NOT a capture, and was never on the inbox either).
    expect(list).toContain('刚记下的一句')
    expect(list).toContain('这一条还在做')
    // And they must be two DIFFERENT documents, not one rendered twice.
    expect(new Set([schedule, list]).size).toBe(2)
    // 收件 is gone from the render as well as from the page set, so a stale reader of
    // its copy finds nothing — and this assertion is what says so out loud.
    expect(list, 'the removed 收件 page is still drawn').not.toContain('收件只放还没分流的想法')
  })

  it('a static render cannot answer the band question, and that is a fact about the bench', () => {
    // **「两档渲染出来的标记一样吗」 IS THE WRONG QUESTION FOR A STATIC RENDER, and
    // it cannot fail for a reason worth recording.**
    //
    // It answers "yes, they differ" by comparing two strings. The band is read by
    // `useSurfaceNarrow`, whose value is the FIRST slot the hook can hold — and
    // everything that *acts* on the band lives behind an effect or a selection:
    // the wide band's detail rail needs a chosen row, the narrow band's in-row
    // detail needs an expanded one. `renderToStaticMarkup` renders neither, so the
    // two renders come out **byte-identical**, and the comparison is vacuous while
    // still reading like a check. The same shape as the 「探针没咬住」 failures
    // elsewhere in this file, one level up: not a probe that cannot bite, but a
    // probe with nothing left to bite on.
    //
    // **WHERE THAT CLAIM LIVES.** The part worth keeping — 「a wide surface has
    // somewhere to put the row you are reading, and a narrow one does not」 — needs
    // a real mount, because both halves of it are about state that only exists
    // after an interaction. It lives in `item-workbench.spec.ts` under jsdom.
    //
    // **WHAT A STATIC RENDER CAN SEE INSTEAD.** The fact that actually breaks when
    // the wiring breaks: the harness hands the panel a band and the panel must
    // carry it into the root. That is asserted by the band tests below, and it is
    // the half a typo in the hook would take out.
    const wide = renderPanel(fixtures(), 'wide')
    const narrow = renderPanel(fixtures(), 'narrow')
    expect(wide.length, 'a static render produced nothing at all — the bench is broken, not the band').toBeGreaterThan(0)
    expect(narrow.length, 'a static render produced nothing at all — the bench is broken, not the band').toBeGreaterThan(0)
    // The one thing a static render can still say: **the detail rail is absent from
    // BOTH**, because it appears only once a row is chosen. A rail that appeared
    // without one would be a permanent column saying 「还没选中任何一条」, which is
    // the defect this assertion was originally written for and which survives the
    // move to a mounted spec.
    expect(wide, 'the wide band drew a detail rail with nothing selected — a permanent column saying nothing').not.toContain('itemDetailPane')
    expect(narrow, 'a narrow surface has no detail rail; the detail opens in the row').not.toContain('itemDetailPane')
  })

  // A CLAIM ABOUT HOW MANY OF SOMETHING ARE ON SCREEN HAS TO BE COUNTED.
  //
  // This one can be wrong while nothing is red. 「三张统计卡」is a claim about a
  // COUNT, and it is true on the fixtures (all three numbers non-zero, so three
  // cards render) while false on a real document — `triageLinesOf` drops the zero
  // lines, `flatMap` drops the tiles that have none, and the band that looks like
  // three cards is 「最多画三张」. Removing a second filter on the receiving side
  // changes nothing, because the zeros are already gone before they arrive, and
  // **a defect defended twice looks defended once**.
  //
  // Nothing in this suite notices, which is exactly the hazard: no test ever says
  // the number. The number is measured instead by opening the live panel at 412px
  // and counting the cards in the picture. **So the number is said here, on the
  // case that makes it a claim at all**: a document where every count is zero.
  it('the rail states every count, including zero — 「被问到而答案是零」', () => {
    // The statistics band is gone; its contract moved to the rail rows that
    // replaced it. A rail that drops a zero-count row turns the map into a log,
    // while a rail that keeps the row and its zero keeps「没有一件卡在你手上」
    // distinguishable from a rail that failed to render.
    const wordsOf = (html: string): string[] =>
      [...html.matchAll(/<button[^>]*itemRailRow[^>]*>([\s\S]*?)<\/button>/g)]
        .map(match => (match[1] ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())
    for (const html of [renderPanel(fixtures(), 'wide', 'list'), renderPanel(fixtures().map(item => ({ ...item, status: 'done' as const })), 'wide', 'list')]) {
      const words = wordsOf(html)
      expect(words.length, 'no rail rows are on screen — the counts have nowhere to live').toBeGreaterThan(0)
      for (const word of ['日期已过', '放着没动', '没定日期', '紧急', '待办', '完成']) {
        const row = words.find(text => text.includes(word))
        expect(row, `the rail does not name ${word} at all, so its zero is never stated`).toBeDefined()
        expect(row ?? '', `the rail names ${word} without a number — a claim with no count is not a count`).toMatch(/\d+/)
      }
    }
  })

  it('today keeps its fill under the pointer, because a calendar fact is not a hover state', () => {
    // THE DEFECT THIS EXISTS FOR, as the reader reported it: 「点击今天那个蓝色的
    // 地方，它会变白色…按钮上的数字就看不到了」. Two rules named `.itemRailDay:hover`
    // — one beside the cell's own block, one in the interaction family further down —
    // and the family's came later at equal specificity, so it won: the fill went to a
    // light surface while the number stayed white, and the number vanished on the
    // very cell the reader was pressing.
    //
    // The claim is 「the today cell's fill survives hover」, and the only shape that
    // keeps it true after the next hover rule is written is the one that names the
    // exception where the hover is declared — so that is what this reads.
    // **先剥注释再匹配**（硬性规范 14）：样式表里那段讲这条规则的散文本身就写着
    // `.itemRailDay:hover`，不剥注释的话，门禁会把**正确的注释**报成违规——
    // 于是正确的修法变成改注释躲开扫描，而不是改实现。
    const sheet = panelCss().replace(/\/\*[\s\S]*?\*\//g, '')
    const hoverRules = [...sheet.matchAll(/\.itemRailDay[^{}]*\{[^}]*\}/g)]
      .map(match => ({ sel: /\.itemRailDay[^{}]*/.exec(match[0])?.[0] ?? '', body: match[0] }))
      .filter(rule => rule.sel.includes(':hover'))
    expect(hoverRules.length, 'no `.itemRailDay:hover` rule is in the sheet — this gate is reading nothing').toBeGreaterThan(0)
    const washes = hoverRules.filter(rule => /background\s*:/.test(rule.body))
    expect(washes.length, 'no hover rule repaints a day cell, so 「today keeps its fill」 is vacuously true').toBeGreaterThan(0)
    for (const rule of washes) {
      expect(rule.sel, `「${rule.sel}」 repaints a day cell on hover without excluding today — that is how the blue pill turned white under the reader's finger`).toContain(':not([data-today])')
    }
    // And both facts are drawn when they hold at once: today's own fill, and a ring
    // that belongs to today rather than cancelling it.
    expect(sheet, 'today has no fill of its own to keep').toMatch(/\.itemRailDay\[data-today\]\s*\{[^}]*background/)
    expect(sheet, 'a picked today wears the plain ink ring, which cancels the very fact that it is today')
      .toMatch(/\.itemRailDay\[data-today\]\[data-picked\]/)
  })
})

/**
 * Tokens the project already ruled absent, each with the reason it is here.
 *
 * An exemption without a reason is indistinguishable from a gap, and a gap
 * that has learned to shout is how a gate gets switched off. So every entry
 * says why the host does not declare it and what the panel gets instead.
 */
const ABSENT_BY_DECISION: Readonly<Record<string, string>> = {
  // board.module.css:44-52 documents this one at length: the shell references
  // the token and never declares it (zero declarations across the whole DSH
  // install), so the alias is deliberately `none` and the separators never
  // paint. Naming it here keeps that decision from being "fixed" by accident.
  '--dsw-alias-separator-primary': 'the host references it and never declares it; the alias is deliberately `none`',
}

/**
 * THE GEOMETRY CONTRACTS.
 *
 * These are the claims a screenshot cannot settle, so they are arithmetic on the
 * source rather than a picture, because a picture has to be believed. Each one
 * states the failure it exists to catch, in the same shape: the rule, then the
 * reason the rule is a rule.
 */
/**
 * Could this selector match the standalone triage sentence?
 *
 * That sentence is a `<p>` that is a DIRECT CHILD of the page's column
 * scroller. So a rule reaches it when its selector is the bare class, or a
 * compound scoped to that scroller. A rule under an ancestor the element does
 * not have — the triage row, a severity variant, a density step — cannot reach
 * it no matter what it declares, and its `flex` is none of the column's business.
 *
 * The list of ancestors that DO exist around the standalone sentence, kept
 * explicit rather than "anything not containing a dot", because a negated
 * pattern is a guess: it would classify `.itemScroll > .itemTriageText` as
 * inapplicable and quietly re-open the very hole this exists to close.
 *
 * **THE CLASS IS A PARAMETER.** Writing the literal `itemTriageText` inside this
 * function body is the worst shape a helper can have: the sentence is a prop of
 * the table now, and a hard-coded class goes on filtering for a class nothing
 * renders, so every rule is discarded and the gate reports 「there is no rule」
 * about a rule three lines above it. A helper that hard-codes its subject can
 * only ever be right about one subject.
 * @param selector - the selector the sheet wrote.
 * @param className - the class the standalone element actually carries.
 * @returns whether the standalone element can be subject to it.
 */
function canMatchStandalone(selector: string, className: string): boolean {
  const compound = selector.split(',').map(part => part.trim()).filter(part => part.includes(className))
  const ANCESTORS_THAT_CANNOT_BE_THERE = [
    'itemTriageRow',
    'itemDetail',
    'itemHeader',
    'itemComposer',
    'itemListCard',
    'itemRow',
    'itemFacetRow',
  ]
  return compound.some(part => !ANCESTORS_THAT_CANNOT_BE_THERE.some(boss => part.includes(`.${boss}`)))
}

describe('reduced motion is honoured by the TOKEN, not by a list of names', () => {
  /**
   * A GATE THAT NAMES SELECTORS BY HAND CANNOT FAIL, AND IT FORBIDS THE FIX.
   *
   * Asserting that a handful of named selectors are absent from a hand-written
   * kill list leaves a brand-new 400ms infinite marquee green, and it has no way
   * to see three selectors the list NAMES sitting later in the file at equal
   * specificity and therefore still animating. Worst of all, an assertion
   * demanding `.spinner { animation-duration: 1.4s }` LITERALLY red-lines the
   * correct implementation, because routing the durations through the token is
   * the fix. A gate that red-lines the correct implementation is worse than no
   * gate.
   *
   * So this one computes instead of grepping. The policy is a single token going
   * to zero, and this asserts the thing that policy depends on: **every transition
   * on the list panel reads that token.** A tenth of them spelling their own
   * duration is exactly why the whole sheet moves under reduced motion when there
   * is no block here to catch it and no token to reach through.
   */
  const itemSheet = readFileSync(new URL('../src/client/item/item.module.css', import.meta.url), 'utf8')
  const boardSheet = pageCss('board')

  /** Comments out, because a token named in prose is not a use. */
  const bare = (sheet: string): string =>
    sheet.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('a field holds its own parts at ONE distance, and the strip does not pay for it twice', () => {
    /* 一个字段里面（字段名 / 写入框 / 它带的附件）只有一个数，而字段与字段之间是另一个数。
       这条断言守的是**被算过两遍的那个间隔**：附件条曾经是那一列的直接子级，于是同时吃到
       父级的 22 与自己的 4——量到 26，而新建那张纸里同一段距离是 6（硬性规范 19 的探针：
       读四层的盒、在「有正文」与「没有正文」两种工件上各跑一次）。
       
       判据抽成函数，因为**一条从不失败的检查与没有检查是一回事**：下面拿一份故意写坏的
       样式表喂同一个函数，它必须报出来。 */
    const findings = (css: string): string[] => {
      const rules = declarationRules(bare(css))
      const bodyOf = (selector: string): string | undefined => rules.find(rule => rule.selector === selector)?.body
      const out: string[] = []
      const field = bodyOf('.itemBodyField')
      if (field === undefined) out.push('.itemBodyField 没了')
      else if (!field.includes('gap: var(--item-field-inner-gap)')) out.push('字段盒没有吃「字段里面的空气」那一个数')
      const strip = bodyOf('.itemAttachRow')
      if (strip === undefined) out.push('.itemAttachRow 没了')
      else if (/padding-block-start/.test(strip)) out.push('附件条又给自己加了一档内衬——间隔会被算两遍')
      const tokens = rules.find(rule => rule.body.includes('--item-field-inner-gap:'))?.body ?? ''
      if (!/--item-field-inner-gap:\s*6px/.test(tokens)) out.push('「字段里面」那个数没有声明（或不是 6px）')
      if (!/--item-field-gap:\s*var\(--s3\)/.test(tokens)) out.push('「字段之间」与「字段里面」被判成了同一个数')
      return out
    }
    expect(findings(itemSheet), '这一页的字段间距不再是一个数').toEqual([])
    // 探针自己会红：同一个函数喂三份写坏的样式表，三份都必须报出来。
    // （A 按**选择器锚定**再改：那同一个数在别处还有一个消费者，按字面替换会改到别人身上，
    //   而这条检查本来只该看`.itemBodyField`——一次没咬住，就是探针指错了地方。）
    const poisonedField = itemSheet.replace(/(\.itemBodyField \{[^}]*?)gap: var\(--item-field-inner-gap\)/, '$1gap: 6px')
    expect(findings(poisonedField), 'A 探针没有咬住「字段盒自己写死一个数」').not.toEqual([])
    expect(findings(itemSheet.replace(/\.itemAttachRow \{/, '.itemAttachRow {\n  padding-block-start: 4px;')), 'B 探针没有咬住「附件条又加内衬」').not.toEqual([])
    expect(findings(itemSheet.replace('--item-field-inner-gap: 6px', '--item-field-inner-gap: var(--s3)')), 'C 探针没有咬住「两个数被并成一个」').not.toEqual([])
  })

  it('the row can paint four states from four surfaces, and no two of them share a token', () => {
    // HOVER STUCK, THE STRUCTURAL VERSION. Four facts live on the row — the brief
    // pointer, the cursor position, the open sheet, the held row — and each
    // paints the row's own fill. The day two of them share ONE token, the
    // surface cannot tell 「the pointer left」 from 「the sheet stayed」 — that
    // is what 「放手之后那行一直是暗的」 was mechanically. So the rule is not
    // 「four nice colours」, it is 「four distinct custom properties」, and the
    // answer is computed off the sheets rather than by eye: an edit that
    // retargets one state's token onto another's turns this red.
    //
    // The CURSOR paints on the LEAD slot now, not on the row: a ring around the
    // whole row was 「一圈加粗的边」 on a touch screen, where the cursor is
    // carried only by the row that is open anyway. Its mark is a small ring
    // around the lead mark — a border, never a fill — and that is what is
    // asserted here: 状态不变，画法换到引导位上。
    const sheet = bare(itemSheet)
    /* **按「这一条规则说的是哪个状态」找规则，不按字面找。**
     *
     * 这里按「这一条规则说的是哪个状态」找，不按字面找：三条底色的先后**写在选择器里**
     * （`:not([data-open]):not([data-picked]):hover`）——那不是「换了个写法」，那是把
     * 「谁压谁」从源顺序搬到选择器里，正是这条断言本来要守的那件事的加强版。所以查找
     * 也读语义：先把 `:not(…)` 摘掉，再按状态记号找。一个按字面认选择的检查器，会逼着
     * 人把选择器写回脆弱的那一版来迁就它（硬性规范 14）。 */
    const owned = (selector: string): string => selector.replace(/:not\([^)]*\)/g, '').trim()
    const fillOf = (selector: string): string | undefined => {
      const block = declarationRules(sheet).find(rule => owned(rule.selector) === selector)
      expect(block, `the row fill ${selector} is not in the stylesheet at all`).toBeDefined()
      return /background:\s*([^;]+)/.exec(block?.body ?? '')?.[1]?.trim()
    }
    const fills = [
      ['.itemRow:hover', 'hover'],
      ['.itemRow[data-open]', 'open'],
      ['.itemRow[data-picked]', 'picked'],
    ].map(([selector, name]) => ({ name, value: fillOf(selector) }))
    const painted = fills.filter(f => f.value !== undefined)
    for (const fill of painted) {
      expect(fill.value, `${fill.name} paints with a var() it does not own`).toMatch(/^var\(--/)
    }
    const tokens = new Set(painted.map(fill => fill.value))
    expect(tokens.size, `hover, open and picked share a token: ${painted.map(f => f.name + '=' + f.value).join(' | ')}`)
      .toBe(painted.length)
    // THE CURSOR PAINTS NOTHING, not on the row and not on the lead: both a row
    // ring and a lead ring were shown on a screen and both were named 「加粗的
    // 红圈」 by the reader, so the state deliberately has no rule at all — that
    // is what keeps it unpaintable. The gate is the absence: any rule for the
    // cursor state is a regression that reintroduces a drawn line.
    expect(sheet.includes('.itemRow[data-cursor]'), 'the keyboard cursor paints somewhere on the row again — a drawn line is back').toBe(false)
  })

  it('the reduced-motion block is the LAST thing in the sheet, and that is load-bearing', () => {
    // POSITION, NOT COSMETICS. The block sat in the middle, and at equal
    // specificity the later declaration wins — so the five selectors it NAMES
    // (three entrances plus two `120ms` colour tints, all of which spell their
    // own duration instead of reading the token) were declared after it and all
    // kept animating. A reader with motion sensitivity got the fade-up anyway, and
    // every assertion in this file stayed green.
    //
    // So the invariant is mechanical: nothing may be declared after the block that
    // the block is meant to silence. Asserted as an ORDER, because the failure is
    // an order — and because a comment saying "keep this last" is exactly the kind
    // of instruction the next edit moves past.
    /* 判据按**每张表**各自成立，因为级联的边界是表：一个文件里「最后」才有意义，
       而看板这一页现在是多张表。拼接之后再问「最后一块」会变成「readdir 顺序里
       最后那张表的最后一块」，那不是这条法则要说的事。
       每一张表都必须满足：它的 reduced-motion 块之后没有任何声明。 */
    const boardSheets = clientSheets()
      .filter(sheet => sheet.rel === 'src/client/board.module.css' || sheet.rel.startsWith('src/client/board/'))
    expect(boardSheets.length, 'no board sheet found at all — this sweep would pass over nothing').toBeGreaterThan(0)
    let sawBlock = false
    for (const boardSheet of boardSheets) {
      const sheet = boardSheet.css
      const last = sheet.lastIndexOf('@media (prefers-reduced-motion: reduce)')
      if (last < 0) continue
      sawBlock = true
      const after = sheet.slice(last)
      // Inside the block is fine. After it, only whitespace and comments may appear.
      const close = after.indexOf('\n}')
      const tail = close >= 0 ? after.slice(close + 2) : after
      const declarations = tail
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/@media[^{]*\{[\s\S]*?\n\}/g, '')
        .trim()
      expect(declarations,
        `in ${boardSheet.rel}, something is declared AFTER the reduced-motion block, so at equal specificity it wins and the motion is not reduced: ${declarations.slice(0, 200)}`)
        .toBe('')
    }
    expect(sawBlock, 'no board sheet has a reduced-motion block at all — motion preference is not honoured anywhere')
      .toBe(true)
  })

  it('the token IS zeroed under reduced motion, on the scope that reaches both sheets', () => {
    // INSIDE THE BLOCK, AND THE BLOCK'S OWN SCOPE — the two things the old
    // reading threw away. It asked `boardSheet.includes('--dsh-tb-motion: 0s')`,
    // which is the WHOLE FILE: the token named anywhere satisfied it, a comment
    // naming it satisfied it, and a block that had stopped zeroing it was
    // invisible. And the loop ran that same check twice — the second iteration
    // was handed the board sheet under the name of the item sheet, so
    // 「both sheets」 was one sheet counted twice.
    const blocks = reducedMotionBlocks(bare(boardSheet))
    expect(blocks, 'the board sheet has no reduced-motion block at all — motion preference is honoured nowhere').not.toEqual([])
    // All of them, not the last one: the policy is not the only thing that
    // belongs under this query, and a component that later adds a block of its
    // own must not be able to move what this gate reads.
    const zeroing = blocks.filter(block => /--dsh-tb-motion\s*:\s*0s/.test(block))
    expect(zeroing, 'the motion token is never zeroed INSIDE a reduced-motion block, so every transition that reads it keeps moving').not.toEqual([])
    // And it has to be zeroed ON THE VIEW, not on a selector list — so a panel
    // mounted beside the board on the same stage is covered without being named.
    expect(
      zeroing.some(block => block.includes('[data-dsh-taskboard-view]')),
      'the zeroing is not on the view scope, so a panel beside the board is never reached by it',
    ).toBe(true)
    // The list panel has no block of its own and does not need one: it reads the
    // same token (the next gate proves every one of its transitions does) and it
    // renders INSIDE the scope above. Proved from the MARKUP, so 「it inherits
    // the policy」 is a fact about what ships rather than a hope about it.
    expect(
      renderPanel(fixtures()),
      'the list panel does not render inside the scope the block zeroes, so the policy never reaches it',
    ).toContain('data-dsh-taskboard-view')
  })

  it('every transition on the list panel reads the token, so the token reaches it', () => {
    // THE ASSERTION THAT WAS IMPOSSIBLE BEFORE. It is about the SHAPE of the
    // declaration rather than about a list of names, so it catches the tenth
    // transition someone adds next month as surely as it catches the ten that
    // were already there.
    const offenders = [...bare(itemSheet).matchAll(/(^|[;{])\s*transition\s*:\s*([^;}]+)/g)]
      .filter(match => !/var\(--dsh-tb-motion\)/.test(match[2] ?? ''))
      .map(match => (match[2] ?? '').trim())
    expect(
      offenders,
      `these transitions spell their own duration, so the reduced-motion token cannot reach them: ${offenders.join(' | ')}`,
    ).toEqual([])
  })

  it('and no transition on the board spells one either, except the ones the block silences', () => {
    // The board carries exactly two, both 120ms, both on a hover tint; they are
    // silenced in the block rather than tokenised, because they predate the token.
    // This pins that list so it cannot grow: a NEW literal has to be either
    // tokenised or silenced for its OWN selector, and both are decisions someone
    // makes on purpose.
    //
    // Asking `match[0].includes('reviewMessageText')` cannot make that decision,
    // because `match[0]` is the matched FRAGMENT — `{ transition: <value>` — which
    // is the DECLARATION and never the selector. So `isNamed` would be false for
    // every literal, the second half of the condition (`named.test(boardSheet)`,
    // true as long as the block names ONE selector at all) would carry the
    // assertion by itself, and the loop would be three identical `expect(true)` —
    // a boolean agreeing with itself.
    const unowned = unownedBoardTransitions(boardSheet)
    expect(
      unowned,
      `these board transitions spell their own duration and the reduced-motion block does not silence the selector they belong to, so they survive: ${unowned.map(found => `${found.selector} { transition: ${found.value} }`).join(' | ')}`,
    ).toEqual([])
    // The reader, on the two shapes it has to tell apart, so a green here means
    // the DETECTOR works rather than that the sheet happens to be tidy.
    const BLOCK = `@media (prefers-reduced-motion: reduce) {\n  .reviewCommentCancel { transition: none; }\n}\n`
    expect(
      unownedBoardTransitions(`.rowPeek { transition: opacity 240ms ease; }\n${BLOCK}`).map(found => found.selector),
      'a literal the block does NOT silence was not reported — the gate cannot see the owning selector',
    ).toEqual(['.rowPeek'])
    expect(
      unownedBoardTransitions(`.reviewCommentCancel { transition: color 120ms ease; }\n${BLOCK}`),
      'a literal the block DOES silence was reported — the gate would push the next author to tokenise a correct rule',
    ).toEqual([])
    // A block that names a DIFFERENT selector silences nothing, which is the
    // case a sheet-level test of the block could never see.
    expect(
      unownedBoardTransitions(`.reviewCommentCancel { transition: color 120ms ease; }\n${BLOCK.replace('.reviewCommentCancel', '.cruisePill')}`)
        .map(found => found.selector),
      'naming a different selector was accepted as silencing this one',
    ).toEqual(['.reviewCommentCancel'])
  })
})
/* ── THE EXPANSION DOES NOT MOVE GEOMETRY ─────────────────────────────────────
 *
 * 「展开有点卡」 was reported four times, and three fixes were shipped that all
 * tuned the ANIMATION OF HEIGHT — a different curve, then a different duration,
 * then a different mechanism. All three were measured as smooth (frame time
 * never left the idle range) and all three were still reported as 卡.
 *
 * The measurement that finally explained it is not about frame time at all:
 * `layout-shift` and LoAF observers on the real panel, at 1440 and 412.
 *
 *   height animated, 130ms       cumulative layout shift 0.374
 *   height animated,  60ms       shift 0.416, one frame carried 52% of travel
 *   height instant + 70ms fade   shift 0
 *
 * An expansion here holds 741px of content (1365px narrow). While the HEIGHT
 * moves, that much page is in motion every frame — and a reader calls that
 * stuttering no matter how even the curve is. Shortening the duration makes it
 * worse, not better: the travel is fixed, so fewer frames means each one jumps
 * further. **「更快」 and 「不卡」 are mutually exclusive while height animates.**
 *
 * So the row's height lands on the press, and only the content's opacity
 * animates — 70ms, from 0.2 rather than 0, because text fading up from fully
 * transparent sits as blurred grey for part of the transition and blurred text
 * also reads as 卡. The tests below pin the STRUCTURE that makes this true:
 * no `animation` on the container, no size property in the keyframes.
 */
describe('the expansion does not move geometry, only the content fades in', () => {
  it('the expansion does NOT animate its height, because the height is what cost', () => {
    /* THE FINDING THAT ENDED THREE EARLIER ATTEMPTS.
     *
     * Every version before this one animated the height, and every one was
     * reported as 「卡」. The reason was never the curve and never the duration:
     * an expansion here holds 741px of content (1365px on the narrow band), so
     * WHILE THE HEIGHT MOVES, A LARGE AREA OF THE PAGE IS IN MOTION EVERY FRAME.
     * That is what a reader calls stuttering, and no curve fixes it.
     *
     * Measured with LoAF and `layout-shift` observers on the real panel, at both
     * 1440 and 412:
     *
     *   height animated, 130ms            cumulative layout shift 0.374
     *   height animated,  60ms            shift 0.416, and ONE frame carried 52%
     *   height instant + 70ms fade        shift 0
     *
     * The middle row is the trap: shortening a FIXED amount of travel buys
     * 「faster」 only by making each frame jump further. 「更快」 and 「不卡」 are
     * mutually exclusive while the height is the thing being animated.
     *
     * So the row's height lands on the frame of the press, and the only thing
     * that animates is the content's opacity. Zero geometry moves. */
    const sheet = stripCssComments(itemSheet())
    /* READ THE RULE THAT STARTS WITH THIS EXACT SELECTOR.
     *
     * `rulesOf` answers 「which rules MENTION this class」, so `.itemDetail > *`
     * (where the fade correctly lives) also comes back under `.itemDetail`, and
     * the assertion below would read the child's `animation` as if the container
     * had one. `ruleTextOf` wants the selector alone on its line, which these
     * two are not, so the body is taken by brace matching from the exact
     * selector — strict about WHICH rule, indifferent to spelling. */
    const bodyOf = (selector: string): string => {
      const at = sheet.indexOf(`\n${selector} {`)
      if (at < 0) return ''
      let depth = 0
      for (let i = at; i < sheet.length; i += 1) {
        if (sheet[i] === '{') depth += 1
        else if (sheet[i] === '}') {
          depth -= 1
          if (depth === 0) return sheet.slice(at, i + 1)
        }
      }
      return ''
    }

    const rule = bodyOf('.itemRow > .itemDetail')
    expect(rule, 'there is no in-row detail rule').not.toBe('')
    expect(rule.replace(/\s+/g, ' '), 'the expansion animates again — with 741px of content that means a large area moving every frame, which is the 「卡」 this replaced')
      .not.toMatch(/animation\s*:/)
    expect(rule.replace(/\s+/g, ' '), 'the expansion clips its own content again, which only made sense while its height was moving')
      .not.toMatch(/overflow\s*:\s*hidden/)

    // The only animating thing is the content's opacity.
    const child = bodyOf('.itemRow > .itemDetail > *')
    expect(child, 'there is no rule for the expanded child').not.toBe('')
    expect(child.replace(/\s+/g, ' '), 'nothing animates the content at all, so an expansion has no transition whatsoever')
      .toMatch(/animation\s*:\s*itemDetailIn\s+var\(--dsh-tb-motion-fast\)/)

    const frames = /@keyframes\s+itemDetailIn\s*\{([\s\S]*?)\n\}/.exec(sheet)?.[1] ?? ''
    expect(frames, 'there is no itemDetailIn keyframes block').not.toBe('')
    // Opacity only — the moment a size property appears here, geometry moves again.
    expect(frames.replace(/\s+/g, ' '), 'the keyframes move a size again, and a moving size is the cost this replaced')
      .not.toMatch(/block-size|height|grid-template-rows/)
    expect(frames.replace(/\s+/g, ' '), 'the fade starts from too low a value, so the body text sits as blurred semi-transparent text over the row colour')
      .toMatch(/from\s*\{\s*opacity:\s*0\.[2-9]/)
  })

  it('and the detector bites on the shapes it was written for', () => {
    // THE CONTROLS. Each assertion above is exercised on a sample it cannot have
    // been tuned against, so a green here means the READER works rather than that
    // the sheet happens to be tidy.
    const ruleOf = (text: string): string => rulesOf(text, 'itemRow > .itemDetail').join('\n').replace(/\s+/g, ' ')
    // A growth animation on the container is exactly what was removed.
    expect(ruleOf('.itemRow > .itemDetail { animation: itemDetailIn var(--dsh-tb-motion-grow) both; }'))
      .toMatch(/animation\s*:/)
    // Opacity-only keyframes pass the size check; a size in them does not.
    const sizeInFrames = (text: string): boolean => /block-size|grid-template-rows/.test(text)
    expect(sizeInFrames('@keyframes x { from { opacity: 0.2 } to { opacity: 1 } }')).toBe(false)
    expect(sizeInFrames('@keyframes x { from { block-size: 0 } to { block-size: auto } }')).toBe(true)
    // And a fade from 0 is the blur this design exists to avoid.
    expect(/from\s*\{\s*opacity:\s*0\.[2-9]/.test('from { opacity: 0.2 }')).toBe(true)
    expect(/from\s*\{\s*opacity:\s*0\.[2-9]/.test('from { opacity: 0 }')).toBe(false)
  })
})

describe('the panel fills the stage it is given', () => {
  const css = panelCss()

  it('declares a definite height on a border-box root, so padding cannot push it over', () => {
    // The board carries this exact rule and explains why in a comment at
    // board.module.css:334-338: height:100% plus content-box padding makes the
    // panel taller than its own view, and the overflow lands at the bottom.
    // The reset lives in its own selector list now (`.itemRoot, .itemRoot *, …`),
    // so read every rule that names the root instead of only the first block.
    const roots = declarationRules(stripCssComments(panelCss()))
      .filter(rule => rule.selector.split(',').map(part => part.trim()).includes('.itemRoot'))
    expect(roots.length, 'there is no .itemRoot rule').toBeGreaterThan(0)
    const root = roots.map(rule => rule.body).join('\n')
    expect(root).toMatch(/box-sizing\s*:\s*border-box/)
    expect(root).toMatch(/(?:block-size|height)\s*:\s*100%/)
    // Both spellings count: the sheet is written in logical properties, and a
    // check that demanded the physical one would be sending the author back to
    // convert a correct file instead of finding a real defect.
    expect(root, 'the root can shrink below its content, so its scroller is not a scroller')
      .toMatch(/min-(?:block-size|height)\s*:\s*0/)
  })

  it('paints the CANVAS on the root AND on the plates that hold the content', () => {
    // THE CLAIM IS THE OPPOSITE OF THE OBVIOUS INDUCEMENT, and the reversal is the
    // finding.
    //
    // The obvious rule is that the root takes the canvas token and NOTHING INSIDE
    // it may. That is coherent-looking, and it is wrong in the way that only the
    // reader can see: the root is glass, and then the list card, the five overview
    // tiles and both sticky heads are painted with an OPAQUE layer token, which
    // covers the glass again one level down. The result reads as a flat plate with
    // a translucent border around it — the one thing a glass skin cannot recover
    // from — while the board, whose columns take the SAME canvas token, keeps
    // working throughout.
    //
    // The rule here is the board's own, and it splits the two cases that single
    // rule merges:
    //   - a plate that HOLDS CONTENT takes the canvas, because it is the same
    //     surface as the app's base and translucency has to compose through it;
    //   - a thing that FLOATS (a menu, a field, the danger zone) takes an opaque
    //     layer, because text has to survive whatever is behind it.
    const root = /\.itemRoot\s*\{[^}]*\}/s.exec(css)?.[0] ?? ''
    const background = /background\s*:\s*([^;]+)/.exec(root)?.[1] ?? ''
    expect(background, 'the panel root does not paint at all').not.toBe('')
    expect(background, 'the panel root must eat the canvas token, exactly as the board root does')
      .toMatch(/var\(--dsh-tb-bg\)/)

    // The same declaration as `.board`, to the character. The two roots are
    // siblings on the stage; a difference between them is a difference nobody
    // chose and nobody can see in a diff of the list's own sheet.
    const boardRoot = /\.board\s*\{[^}]*\}/s.exec(css)?.[0] ?? ''
    const boardBackground = /background\s*:\s*([^;]+)/.exec(boardRoot)?.[1]?.trim() ?? ''
    expect(background.trim(), 'the two stage roots have drifted apart').toBe(boardBackground)

    // THE CARDS, NAMED — and the rule they are held to is the one that answers the
    // question this panel actually has.
    //
    // Saying that a plate which HOLDS CONTENT takes the canvas token, on the
    // reasoning that the panel root is glass and translucency has to compose
    // through it, no longer answers anything: the root above paints the canvas
    // token ITSELF, so there is no glass left inside the panel for a card to
    // compose with — and a card painted exactly the canvas is a card a reader
    // cannot find, which is what 「文字都粘在左侧边缘上」 looks like when the whole
    // surface is one flat plane.
    //
    // THE CLAIM IS THE THREE STEPS, in order and no more than three: the page is
    // the canvas, a CARD IS EXACTLY ONE STEP ABOVE IT, and a floating surface is
    // the step above that. One step is checkable; 「however far above it happens to
    // land」 is not.
    const surface = /--item-surface\s*:\s*([^;]+)/.exec(css)?.[1]?.trim() ?? ''
    expect(surface, 'the card surface is not a named token — it is a colour written at each point of use').not.toBe('')
// THE CARD IS OPAQUE, **AND IT CARRIES A SHADOW** — and the second half is the
    // part that is easy to miss, because in the dark theme everything looks fine
    // without it.
    //
    // MEASURED ON THE HOST'S OWN TABLES: light `bg-base` / `bg-layer-1` /
    // `bg-layer-2` all resolve to `#fff`; dark gives three different values. So a
    // card can only be lifted BY COLOUR in the dark theme — in the light theme the
    // colour says nothing at all, and the shadow is the entire reason a reader sees
    // one card in front of another.
    //
    // **THE OBVIOUS DERIVATION IS THE WRONG ONE.** Deriving the card surface as a
    // `color-mix` from ink and rejecting `--dsh-tb-bg-raised` is the induction the
    // measurement refutes: ink is black in light and white in dark, so mixing
    // toward ink RAISES a card in the dark theme and **SINKS it in the light one**
    // — measured there as 7 levels darker than the page, which reads as a groove.
    // A rule that is right in one theme and inverts in the other is not a rule; it
    // is a coin flip that happens to land well most of the time on the machine you
    // built it on.
    //
    // So the claim is the one that survives both: **opaque surface, plus a shadow.**
    expect(surface, 'the card surface is a raw ink mix — it raises a card in the dark theme and SINKS it in the light one, so in one of the two it reads as a groove')
      .not.toMatch(/color-mix/)
    // AND THE FLOAT IS A DIFFERENT TOKEN, not the card wearing another name: a
    // popover and the card it covers must be separable where the host gives a
    // ladder, and the float carries the heavier shadow where it does not.
    const floatSurface = /--item-float\s*:\s*([^;]+)/.exec(css)?.[1]?.trim() ?? ''
    expect(floatSurface, 'the floating surface is the card surface wearing another name, so a popover and the card under it are one surface')
      .not.toBe(surface)
    // THE ROW IS THE CARD NOW, and the two wrappers are skeletons. The list, the
    // agenda and the rows on them share ONE card part — the board's own law
    // (canvas may be glass, inner cards may not): the row's BASE rule paints the
    // opaque card surface and the card's edge, radius and shadow; its states
    // paint their own four tokens (gated separately above). A shell card around
    // the row paints a second opaque layer over the row cards — the white wall
    // again, the thing this panel is being cured of — so the shell is gone and the
    // table paints nothing.
    const rowBase = (rulesOf(stripCssComments(css), 'itemRow')[0] ?? '').replace(/\s+/g, ' ')
    expect(rowBase, 'the row has no base rule — the card is painted by no rule').not.toBe('')
    // **THE CARD SURFACE IS STILL PAINTED BY THE ROW — it just says so through the
    // shared material's slot.** The row names the surface it stands on
    // (`--item-surface`) and the shared material class paints it; what this
    // assertion forbids is a row that borrows somebody else's surface (the shell
    // card painting a second opaque layer over the row cards) — the white wall
    // again, the thing this panel is being cured of.
    expect(rowBase, `.itemRow's base rule does not name the one card surface: ${rowBase}`)
      .toContain('--dsh-tb-paper-plane: var(--item-surface)')
    expect(rowBase, 'the row card is partly transparent, so text lands on whatever is behind the panel')
      .not.toMatch(/transparent/)
    // **AND IT IS THE SHADOW, not nothing.** In the light theme the host's three
    // background layers are the SAME colour, so a card with a hairline and no
    // shadow is a rectangle on a rectangle — which is 「文字粘在左侧边缘上」 seen
    // from the other side: the card is there, and nothing says it is in front.
    //
    // **The claim names the CAST LADDER, not the page's old alias.** `--item-card-shadow`
    // was this sheet's own name for `--dsh-tb-shadow-1` back when there was no
    // ladder; the design system now ships `--dsh-tb-cast-1/2/3` plus the rim, and a
    // page alias on top of a token that says exactly this is the second road the
    // palette rule exists to remove. So the gate reads what the claim actually
    // needs: a cast from the ladder AND the lit top edge that makes the card read
    // as a raised sheet rather than a shaded box.
    //
    // **Those two strokes are the shared material's now** (`design/base.module.css`):
    // the row hands the material its surface and says nothing about the shadow —
    // so the claim is read on the shared sheet, and the row must not carry a second
    // shadow of its own (two homes is the thing being removed).
    const materialSheet = readFileSync(new URL('../src/client/design/base.module.css', import.meta.url), 'utf8')
    const material = (rulesOf(stripCssComments(materialSheet), 'paperSheet')[0] ?? '').replace(/\s+/g, ' ')
    expect(material, 'the shared material class is gone — nothing paints a card surface any more').not.toBe('')
    expect(material, 'the shared material lost the lit top edge — a cast with no rim is a shadow under a box, not a raised sheet')
      .toContain('var(--dsh-tb-rim)')
    expect(material, 'the shared material lost the first cast, so in the light theme — where the host\'s three background layers are the SAME colour — nothing says this card is in front of the page')
      .toContain('var(--dsh-tb-cast-1)')
    expect(rowBase, '.itemRow paints a shadow of its own — the material has two homes again')
      .not.toMatch(/box-shadow/)
    // THE EDGE AND THE SHAPE: a card reads as an object — a hairline edge and the
    // card radius the board's own cards read (a card inside a panel is a THING,
    // not another panel).
    const rowBorder = /(?:^|[;{\s])border\s*:\s*([^;]+)/.exec(rowBase)?.[1] ?? ''
    expect(rowBorder, 'the row card has no hairline edge — a card without an edge is a wash, not a card')
      .toBe('var(--item-hair-strong)')
    /* **圆角走纸面的槽。** 共享的 `.paperSheet` 读 `--dsh-tb-paper-radius`、页面写它，
       两条声明作用于不同属性，不打同一场特异性官司（`border-radius` 与 `border-radius`
       是同一条属性，谁赢取决于两张表在产物里的先后——那是一条会在某次构建里静悄悄
       翻转的脆弱面）。判据要说的仍然是「这一档是 md」，只是那个值现在写在变量的右边。 */
    const rowRadius = /(?:^|[;{\s])--dsh-tb-paper-radius\s*:\s*([^;]+)/.exec(rowBase)?.[1] ?? ''
    expect(rowRadius, 'the row card is not on the card radius the board\'s own cards read')
      .toBe('var(--dsh-tb-radius-md)')
    for (const skeleton of ['itemShell', 'itemTable']) {
      const layers = backgroundOf(stripCssComments(css), skeleton)
      expect(layers, `.${skeleton} paints a face, but the rows are the cards now — a second opaque layer over them is the white wall again`)
        .toEqual([])
    }

    // AND THE OPEN TINT IS THE OPAQUE COMPOSITE. Reading the board's
    // `--dsh-tb-open` — translucent IN THE TOKEN — washes the fill out to nothing
    // under a glass skin. The claim: the token composes from the card surface and
    // the accent, contains no `transparent`, and nothing on this surface reads the
    // board's token.
    const openTint = /--item-open\s*:\s*([^;]+)/.exec(css)?.[1]?.trim() ?? ''
    expect(openTint, 'there is no --item-open token — the open row paints nothing or something shared').not.toBe('')
    expect(openTint, 'the open tint does not compose from the card surface, so a skin cannot be answered for what shows through it')
      .toMatch(/color-mix\(/)
    expect(openTint, 'the open tint does not compose from the card surface').toContain('var(--item-surface)')
    expect(openTint, 'the open tint is translucent in the token itself — the wash that vanishes under a glass skin')
      .not.toMatch(/transparent/)
    expect(stripCssComments(css).includes('--dsh-tb-open'),
      'a rule on this surface still reads the board\'s shared open token — the translucent wash is back').toBe(false)

    // AND THE OTHER HALF, which a single canvas/inner rule has no room for: the
    // things that float still have to be opaque. Without this the first half passes
    // by painting everything the canvas, and a menu over the wallpaper becomes
    // unreadable — the rule would be satisfied by a surface nobody can read.
    //
    // THE TOKEN MUST BE CHOSEN AND MEASURED. Reading `--dsh-tb-surface-menu`, which
    // resolves to the host's `--dsw-specific-menu`, gives the default skin's
    // `#f8f9fa94` — **58% alpha** — and this menu sits over every row's text, so a
    // translucent plate is text over text. The panel's own alpha is the SKIN's
    // business; a floating surface's is not.
    //
    // **SO THE CHECK IS NOT 「WHICH TOKEN」.** It is 「which token, AND does the
    // colour it resolves to actually resolve to something opaque」 — a check on the
    // name alone passes on a token whose value is 58% opaque, and does. The alpha
    // reader below is the part that is new: it takes a resolved `#rrggbbaa` and
    // asks whether the last two digits are `ff`.
    // (「the floating step is `--item-float` resolving to one of the host's own
    // surface tokens」 is NOT asserted here, and that absence is the finding rather
    // than a cleanup: it demands exactly the thing the measurement above refutes —
    // the host's three surface tokens resolve to one colour, so 「a float is one of
    // them」 is a float painted in the page. What stands in its place is the
    // derivation and the ORDER check above, which read the mix amount instead of a
    // name.)
    for (const name of ['itemRowMenu']) {
      const layers = backgroundOf(css, name).filter(value => value.includes('var(--item-float)'))
      expect(layers, `.${name} does not paint with the floating surface: ${JSON.stringify(backgroundOf(css, name))}`).not.toEqual([])
    }
    // AND THE NEW HALF, on the surface that actually floats over text.
    for (const name of ['itemRowMenu', 'itemCommandPalette']) {
      const resolved = tokenValueOf(`--dsh-tb-${name === 'itemRowMenu' ? 'surface-float' : 'surface-float'}`)
      const alpha = alphaOf(resolved)
      expect(
        alpha,
        `.${name} paints with --dsh-tb-surface-float, which resolves to "${String(resolved)}" — alpha ${String(alpha)} means the surface under this plate shows through, and this one sits on top of every row's text`,
      ).toBe(1)
    }
  })

  it('the probe bites: a floating surface resolved to 90% alpha is reported', () => {
    // Fed a resolved colour, because the failure is in the VALUE the token
    // resolves to and not in the name the stylesheet uses — which is exactly why
    // a token-name check passed for a plate nobody could read.
    expect(alphaOf('#f8f9fa94'), 'the probe did not bite — a 58%-alpha plate reads as opaque').toBeLessThan(1)
    expect(alphaOf('#f8f9faff')).toBe(1)
    expect(alphaOf('#f8f9fa'), 'a six-digit colour was read as transparent — the shorthand has no alpha and is fully opaque').toBe(1)
    expect(alphaOf('rgb(248 249 250)'), 'an opaque rgb() was read as transparent').toBe(1)
    expect(alphaOf('rgb(248 249 250 / 0.9)'), 'an opaque-looking rgb() with a slash alpha was read as opaque').toBeLessThan(1)
  })

  it('wraps the root in the stage that hands it a definite height', () => {
    // The board has this wrapper and the list did not, which is the structural
    // half of the same defect: without it the root's `height: 100%` has no
    // definite containing block to resolve against, and the four column tracks
    // collapse to zero and their text overflows on top of the header.
    //
    // The stage is named in the LIST's own family (`.itemPanelStage`), because
    // `.panelStage` belongs to the board — hard rule 3 keeps each surface's
    // class names to itself, and two surfaces sharing one class name is how a
    // fix to one silently restyles the other. So this looks for the item name.
    const stage = /\.itemPanelStage\s*\{[^}]*\}/s.exec(css)?.[0] ?? ''
    expect(stage, 'there is no .itemPanelStage rule').not.toBe('')
    expect(stage).toMatch(/min-block-size\s*:\s*0/)
    expect(stage).toMatch(/(?:block-size|height)\s*:\s*100%/)
  })

  it('never decides a layout from the viewport', () => {
    // The surface's own width is the only honest reference; a media query on
    // the viewport misjudges exactly when the shell sidebar is open. Comments
    // come off first for the same reason the token scan strips them: this file
    // explains the rule IN A COMMENT by quoting the query it forbids, and a
    // scanner that reads comments reports the explanation as a violation.
    // The touch-ergonomics query is not a layout decision and stays allowed.
    const live = stripCssComments(css)
    const widthQueries = [...live.matchAll(/@media[^{]*?\b(?:max|min)-width/g)].map(m => m[0].trim())
    expect(widthQueries, `a viewport width query decides this panel's layout: ${widthQueries.join(' | ')}`).toEqual([])
  })

  it('keeps the sanctioned touch-ergonomics query, and uses it for nothing else', () => {
    // `@media (hover: none) and (pointer: coarse)` may grow hit areas and
    // nothing more. If it ever grows a visual size, the phone stops being the
    // same product at a smaller width, which is the one thing rule 11 forbids.
    //
    // THE WHOLE VALUE, NOT ITS FIRST FEW CHARACTERS. The old pattern was
    // `…\s*:\s*(?!24px|44px|16px)[\d.]+px`, and the `\s*` between the colon and
    // the lookahead can match ZERO characters — so on `padding: 0 24px` the
    // engine backtracks onto the space before the `24px`, the lookahead sees
    // that space rather than the sanctioned value, the value is not `24px`, the
    // lookahead passes, and a 24px visual change on touch went unreported. A
    // lookahead that can be satisfied by the whitespace in front of the thing it
    // is guarding is not a lookahead.
    //
    // So the declaration is captured WHOLE and every length in its value is
    // judged, and the sanction is per PROPERTY rather than per number: the
    // sheet is allowed `font-size: 16px` (the anti-zoom rule) and a 24px swatch,
    // and nothing else. A 24px that arrives as padding is not the swatch.
    const live = stripCssComments(css)
    const SANCTIONED: Readonly<Record<string, ReadonlySet<string>>> = {
      // 「16px input text stops iOS/Android auto-zoom on focus」 — the one visual
      // change this query is allowed, because without it the phone zooms.
      'font-size': new Set(['16px']),
      // The 16px colour dots heated to a finger's 24px. Nothing else.
      width: new Set(['24px']),
      height: new Set(['24px']),
    }
    const sizes = (value: string): string[] => [...value.matchAll(/[\d.]+px/g)].map(call => call[0])
    for (const block of live.matchAll(/@media \(hover: none\) and \(pointer: coarse\) \{([\s\S]*?)\n\}/g)) {
      for (const declared of (block[1] ?? '').matchAll(
        /(?:^|[;{\s])(font-size|(?:min-)?(?:inline|block)-size|(?:min-)?(?:width|height)|padding[\w-]*|margin[\w-]*|gap|border-width[\w-]*)\s*:\s*([^;}]*)/g)) {
        const property = declared[1] as string
        const value = (declared[2] ?? '').trim()
        const unsanctioned = sizes(value).filter(size => !(SANCTIONED[property]?.has(size) ?? false))
        expect(
          unsanctioned,
          `the touch query changes a visual size (${property}: ${value}) — it may grow a hit area and nothing else`,
        ).toEqual([])
      }
    }
  })

  it('never asks a container query about the element that IS the container', () => {
    // A container query resolves against an element's nearest ANCESTOR with
    // the named container — and an element is not its own ancestor. So
    //
    //   .itemRoot { container-name: dsh-tb-item }
    //   @container dsh-tb-item (max-width: 719px) { .itemRoot { --inset: 12px } }
    //
    // parses, lints, and balances its braces, and then NEVER MATCHES. The
    // declaration is simply dead, and no other gate can see it: class names
    // resolve both ways, every token is declared, the file is clean. The
    // symptom is a phone rendering the desktop's padding, which reads as a
    // layout bug in a place nobody is looking.
    //
    // Two rules make the check itself honest, and both were found by reading
    // this comment and getting it wrong:
    //
    //   1. A NAME IS DECLARED BY A SET OF CLASSES, never by one. `.itemDetail`
    //      and `.itemDetailPane` both declare `dsh-tb-item-detail` — that is
    //      the mechanism for one component rendered in two places. A map that
    //      keeps only the last declarer would let a self-query on the other one
    //      through, which is the exact defect this exists to catch.
    //   2. THE PREDICATE IS BOUND TO THE QUERIED NAME. A block may legitimately
    //      mention a class that declares a DIFFERENT container:
    //      `@container dsh-tb-item { .itemDetail { display: none } }` is a real
    //      rule here, because `.itemDetail` answers to `dsh-tb-item-detail` and
    //      the block asks about the panel. A check that only asks "does this
    //      selector name a container at all" reports it, and the next reader
    //      deletes a correct rule to make the gate quiet.
    const live = stripCssComments(css)
    const dead = deadSelfQueries(live)
    expect(dead, `container queries that can never match:\n  ${dead.join('\n  ')}`).toEqual([])
  })
})

/** Which class declares which container name, per rule 1 above. */
function containerDeclarers(css: string): Map<string, string[]> {
  const declares = new Map<string, string[]>()
  for (const rule of css.matchAll(/\.([A-Za-z][\w-]*)\s*\{([^}]*)\}/g)) {
    for (const name of (rule[2] ?? '').matchAll(/container-name\s*:\s*([a-z][\w-]*)/g)) {
      declares.set(rule[1] as string, [...(declares.get(rule[1] as string) ?? []), name[1] as string])
    }
  }
  return declares
}

/** Self-queries in a sheet, bound to the name each block asks about. */
function deadSelfQueries(css: string): string[] {
  const declares = containerDeclarers(css)
  const dead: string[] = []
  for (const block of css.matchAll(/@container\s+([a-z][\w-]*)[^{]*\{([\s\S]*?)\n\}/g)) {
    const asked = block[1] as string
    for (const [selector, names] of declares) {
      if (names.includes(asked) && new RegExp(`\\.${selector}(?![\\w-])`).test(block[2] ?? '')) {
        dead.push(`@container ${asked} { … .${selector} … }`)
      }
    }
  }
  return dead
}

/**
 * THE GATE PROVES IT CAN BITE, on all three shapes of the question.
 *
 * A check that cannot fail is worse than no check: it is read as evidence and
 * it is never looked at again. So this feeds the scan the defect it exists to
 * catch, a SECOND declarer of the same container (the shape that a one-to-one
 * map would wave through), and — the one that matters most — a rule that is
 * CORRECT and must stay silent.
 *
 * The third case is what separates a working gate from a gate that passes
 * because its input happens to be clean. A scan that reported
 * `@container dsh-tb-item { .itemDetail … }` would be reporting a true rule:
 * `.itemDetail` answers to `dsh-tb-item-detail` and the block asks about the
 * panel. A gate that cries wolf there gets its rule deleted by the next reader,
 * and the real defect it was built for comes back with it.
 */
describe('the container self-query gate reacts', () => {
  const live = stripCssComments(panelCss())

  /**
   * Splice a self-query in front of the FIRST block that asks about `asked`.
   *
   * It matches any block for that name, not one particular breakpoint: the
   * list container is asked about at both 559px and 560px, and a helper
   * that planted at a breakpoint the sheet no longer uses would silently plant
   * nothing and report the gate as broken — which is how a probe ends up
   * deleted for the crime of the thing it was checking.
   */
  function plant(css: string, asked: string, selector: string, body: string): string {
    const pattern = new RegExp(`@container ${asked} \\(min-width:`)
    if (!pattern.test(css)) throw new Error(`no ${asked} block to plant into — the fixture is stale, not the gate`)
    return css
      .replace(pattern, (match) => `@container ${asked} (min-width: 1px) {\n  ${selector} { ${body} }\n}\n@media screen {\n${match}`)
      .replace(/\}\s*@media screen \{/g, '}\n@media screen {')
  }

  it('is quiet on the stylesheet as it stands', () => {
    expect(deadSelfQueries(live)).toEqual([])
  })

  it('catches the container asking about itself', () => {
    const caught = deadSelfQueries(plant(live, 'dsh-tb-item', '.itemRoot', '--probe: 1px;'))
    expect(caught.some(finding => finding.includes('.itemRoot'))).toBe(true)
  })

  it('catches every declarer of the live list container asking about itself', () => {
    // The probe plants on classes that DECLARE the container, and which classes
    // those are has to be read out of the sheet rather than written here. A probe
    // that names a class the sheet has since moved the declaration off is worse
    // than no probe: it plants nothing, finds nothing, and reports the gate as
    // broken — and the usual response to that is to delete the gate, which is
    // how a real container defect comes back with nobody watching.
    //
    // The list container is the live one: rows and their narrow/wide bands answer
    // to `dsh-tb-item-list`. Every declarer is checked, so a second declarer is
    // covered the day one returns.
    const declarers = [...containerDeclarers(live).entries()]
      .filter(([, names]) => names.includes('dsh-tb-item-list'))
      .map(([selector]) => `.${selector}`)
    expect(declarers.length, 'nothing in the sheet declares dsh-tb-item-list, so this probe has no subject').toBeGreaterThan(0)
    for (const declarer of declarers) {
      const caught = deadSelfQueries(plant(live, 'dsh-tb-item-list', declarer, '--probe: 1px;'))
      expect(caught.some(finding => finding.includes(declarer.slice(1))),
        `the probe planted on ${declarer} did not bite — it is not declaring the container any more, and the gate cannot tell`).toBe(true)
    }
  })

  it('stays silent on a correct rule that merely MENTIONS another container', () => {
    const planted = plant(live, 'dsh-tb-item', '.itemDetail', 'display: none;')
    expect(deadSelfQueries(planted)).toEqual([])
  })
})

/**
 * THE WORKBENCH'S INTERNAL GEOMETRY, and the four defects the render artifacts
 * made visible. Each gate names the failure it exists to catch; each is paired
 * with a planted bad value so the gate is known to be able to report.
 */
describe('the rail and in-row detail share one workbench', () => {
  const css = panelCss()

  /* The invariant, as a function rather than as one inline expectation, so it can
   * be pointed at a PLANTED violation and be seen to report. A gate that has never
   * been shown to fail is a gate nobody knows the shape of. */
  const workbenchGridFindings = (cssText: string): string[] => {
    const findings: string[] = []
    /* Track counting cannot be `split(' ')`: a track may be `minmax(0, 1fr)` and
     * that function's own argument contains a space, so a naive split reports two
     * tracks for a one-track value. Split at top-level whitespace only. */
    const tracksOf = (value: string): string[] => {
      const out: string[] = []
      let depth = 0
      let current = ''
      for (const ch of value) {
        if (ch === '(') depth += 1
        if (ch === ')') depth -= 1
        if (/\s/.test(ch) && depth === 0) {
          if (current !== '') out.push(current)
          current = ''
          continue
        }
        current += ch
      }
      if (current !== '') out.push(current)
      return out
    }
    // Comments come OFF first: the sheet explains the workbench in prose, and the
    // prose names the class — a raw-text scan turns the explanation into a fake
    // first rule (「box-sizing: border-box」), which is exactly the reading that
    // sends the next author to fix a correct comment.
    for (const body of rulesOf(stripCssComments(cssText), 'itemWorkbench')) {
      const flat = body.replace(/\s+/g, ' ')
      const columns = /grid-template-columns:\s*([^;]+);/.exec(flat)?.[1]
      const areas = /grid-template-areas:\s*([^;]+);/.exec(flat)?.[1]
      if (columns === undefined && areas === undefined) continue
      // HALF A STATEMENT: the other half comes from whatever else matches here.
      if (columns === undefined || areas === undefined) {
        findings.push(`a body declares half the pair: ${flat}`)
        continue
      }
      const rows = [...areas.matchAll(/'([^']+)'/g)].map(match => match[1].trim().split(/\s+/))
      if (rows.length === 0) {
        findings.push(`a body addresses no area: ${flat}`)
        continue
      }
      const names = [...new Set(rows.flat())].sort()
      if (names.join(',') !== 'list,rail') findings.push(`a body addresses ${names.join('/')}: ${flat}`)
      if (rows.some(row => row.length !== rows[0].length)) findings.push(`a body has a ragged area map: ${flat}`)
      const tracks = tracksOf(columns)
      if (tracks.length !== rows[0].length) {
        findings.push(`this body declares ${tracks.length} track(s) but addresses ${rows[0].length}: ${flat}`)
      }
    }
    return findings
  }

  it('NOTHING may declare the tracks without the areas that address them', () => {
    // The right-hand detail rail is not on this surface: renting land for a column
    // that holds nothing whenever no row is chosen is exactly what the grid must
    // not do. So the grid names exactly rail and list, with the rail fixed and the
    // list fluid.
    //
    // ONE DECLARATION, SO THE TWO COLUMNS CANNOT DRIFT APART. Joining every
    // `.itemWorkbench` body into one string and asking whether two patterns appear
    // *somewhere* cannot see a band that re-declares one half of the pair: the base
    // rule satisfies it on its own. Two bands may both match a width, and the one
    // that wins the columns does not necessarily win the areas — the loser's area
    // map then places both items in the first track and the second sits empty.
    //
    // So the check is PER BODY and it demands BOTH HALVES: a body that addresses
    // the tracks says how many there are, a body that declares the count says how
    // they are addressed.
    expect(workbenchGridFindings(css)).toEqual([])
  })

  it('and that gate reports a band that changes the tracks and not the areas', () => {
    // The two ways this goes wrong, as plants: a body stating half the pair, and a
    // body stating both halves with counts that disagree.
    const halfOnly = `${css}
@container dsh-tb-item (min-width: 720px) {
  .itemWorkbench {
    grid-template-columns: 260px minmax(0, 1fr);
  }
}`
    const findings = workbenchGridFindings(halfOnly)
    expect(findings.length, 'the gate cannot report the defect it exists for').toBeGreaterThan(0)
    expect(findings.join('\n')).toMatch(/half the pair/)
    const mismatched = `${css}
@container dsh-tb-item (min-width: 720px) {
  .itemWorkbench {
    grid-template-columns: 260px minmax(0, 1fr);
    grid-template-areas: 'rail' 'list';
  }
}`
    expect(workbenchGridFindings(mismatched).join('\n')).toMatch(/declares 2 track\(s\) but addresses 1/)
  })

  it('and the rail track is the SAME width in the default rule as it is measured', () => {
    // A track width no width can reach is the same false lead as a variable
    // nothing reads: the default rule must state the number the two-column bands
    // actually render, and no band may restate it, because two restatements are
    // two chances to disagree.
    const first = rulesOf(stripCssComments(css), 'itemWorkbench')[0].replace(/\s+/g, ' ')
    expect(first).toMatch(/grid-template-columns:\s*260px\s+minmax\(0,\s*1fr\)/)
    for (const body of rulesOf(stripCssComments(css), 'itemWorkbench').slice(1)) {
      expect(body.replace(/\s+/g, ' '), 'a band restates the tracks, so two bands can disagree again')
        .not.toMatch(/grid-template-columns:\s*260px\s+minmax\(0,\s*1fr\)/)
    }
  })

  it('the detail spans the row it belongs to and starts under a rule', () => {
    // In-row detail must not become a fourth content column: it spans the row it
    // expands, sits on its own grid row, and starts under the row's separator.
    // A detail that does not span reflows the title, tags and menu around it —
    // exactly the layout jump a reader reports as 「the list moved」.
    const detail = rulesOf(stripCssComments(css), 'itemRow > .itemDetail').join('\n')
    expect(detail, 'there is no in-row detail placement rule').not.toBe('')
    expect(detail.replace(/\s+/g, ' ')).toMatch(/grid-column:\s*1\s*\/\s*-1/)
    expect(detail.replace(/\s+/g, ' ')).toMatch(/grid-row:\s*3/)
    expect(drawsSeparator(detail, 'border-block-start'), 'the in-row detail has no top separator, so it reads as a continuation of the sentence').toBe(true)
  })

  it('the two regions are separated by air, not by a line', () => {
    // THE PROMISE, UNCHANGED: the rail reads as a column of navigation rather
    // than as a wide empty margin, so the two regions have to be separated by
    // SOMETHING.
    //
    // THE MECHANISM IS AIR, NOT A LINE. A line is the wrong instrument for this
    // seam: drawn on the list column's leading edge, which is 1px from the list
    // card's own edge, it measures **2px** on screen — heavier than every real
    // separator on the panel — and it cuts one main column into two halves that are
    // not halves: the rail is a direction and the list is the work, on the same
    // paper. A reader asked what that line was dividing cannot answer.
    //
    // So the promise is checked in the two directions that outlive the change:
    // the gap is real, and the line is gone. A gate that only demanded the line
    // would have been demanding the thing that read as a mistake.
    const workbench = rulesOf(stripCssComments(css), 'itemWorkbench').join('\n')
    expect(workbench, 'there is no .itemWorkbench rule').not.toBe('')
    const gap = /(?:^|[;{\s])column-gap\s*:\s*([^;]+)/.exec(workbench)?.[1]?.trim() ?? ''
    expect(gap === '' || gap === '0' || gap === '0px',
      `the two regions are separated by nothing (column-gap: ${gap || 'missing'}), so navigation reads as a margin`).toBe(false)

    // AND THE LINE IS GONE. Both inline sides, because a line moved from one
    // column's leading edge to the other's trailing edge is the same line.
    const column = rulesOf(stripCssComments(css), 'itemListColumn').join('\n')
    expect(drawsSeparator(column, 'border-inline-start'),
      'the list column draws a line again — it lands 1px from the card\'s own edge and reads as 2px').toBe(false)
    expect(drawsSeparator(column, 'border-inline-end'),
      'the list column draws a line on its trailing edge, which is the same line by another name').toBe(false)
  })

  it('the two probes both bite', () => {
    // The detectors are exercised on strings they cannot have been tuned
    // against, so a green here means the DETECTOR works. A control that leaned
    // on the real sheet's current state would pass by accident the day the
    // sheet is fixed, and prove nothing for ever after.
    const areas = (text: string): string => rulesOf(text, 'itemWorkbench').join('\n')
    expect(areas('.itemWorkbench { grid-template-areas: \'rail list\'; }')).toContain('rail list')
    expect(areas('.itemWorkbench { grid-template-areas: \'rail detail\'; }')).not.toContain('rail list')
    const spans = (text: string): string => rulesOf(text, 'itemRow > .itemDetail').join('\n')
    expect(spans('.itemRow > .itemDetail { grid-column: 1 / -1; }')).toContain('1 / -1')
    expect(spans('.itemRow > .itemDetail { grid-column: 2 / 3; }')).not.toContain('1 / -1')
    // The gap detector, both ways: a real gap passes and a reset fails.
    const gapped = (text: string): boolean => {
      const body = rulesOf(text, 'itemWorkbench').join('\n')
      const value = /(?:^|[;{\s])column-gap\s*:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? ''
      return value === '' || value === '0' || value === '0px'
    }
    expect(gapped('.itemWorkbench { column-gap: var(--s3); }'), 'the gap probe reported a real gap as absent').toBe(false)
    expect(gapped('.itemWorkbench { row-gap: 0; column-gap: 0; }')).toBe(true)
    expect(gapped('.itemWorkbench { display: grid; }'), 'the gap probe cannot see a missing gap').toBe(true)
    // And the line detector, on the selector that now must NOT carry one.
    expect(drawsSeparator('.itemListColumn { border-inline-start: var(--item-hair); }', 'border-inline-start')).toBe(true)
    expect(drawsSeparator('.itemListColumn { border-inline-start: 0; }', 'border-inline-start')).toBe(false)
  })
})

/**
 * THE FRAME'S AIR: ONE NUMBER, PAID AT BOTH ENDS.
 *
 * A row card's distance to the panel's two edges was a FUNCTION OF WIDTH: the
 * scroller paid `0` for a panel 720 and wider and `12px` below, while the left
 * column that gives a card a LEFT NEIGHBOUR only exists from 881 up — below that
 * the rail folds into a strip above the list. Measured on the render artifact
 * across a ladder of container widths (1600 -> 390): every rung from 1600 down to
 * 881 had the card's left gap at 0 and its right gap at 10, and the band
 * 720…880 had the same 0 **with nothing to its left at all** — the card sat flush
 * against the panel's own edge while the top bar's text and the strip above it
 * stayed at 16. A reader dragging the window watches the gap appear and vanish;
 * a reader on a narrow screen sees a card glued to the sidebar.
 *
 * WHY THIS GATE IS STRUCTURAL AND NOT NUMERICAL: 0 was the right value for the
 * desktop geometry it was chosen for — the defect is not the value, it is that
 * the air ANSWERED TO WIDTH while the thing that made 0 work (two columns)
 * answered to a DIFFERENT width. So the gate asks the two questions that defect
 * fails:
 *
 *   1. what the scroller pays is ONE value, declared exactly once and outside
 *      every conditional block;
 *   2. the two ends of a strip pay the SAME number — one declaration, one value,
 *      so the trailing end cannot carry a second sum.
 *
 * The geometry those two produce is measured where geometry can be measured:
 * `scripts/probes/probe-item-frame.js` walks the container width in a real
 * Chromium (`pnpm audit`, the `frame-ladder` stage) and reports both gaps per
 * rung. This is the half that runs on every `pnpm test`.
 */
describe('the frame pays one air at both ends', () => {
  const css = panelCss()
  /* The shared layer's sheets — where the strip inset (the thing that holds the
     two ends) lives. It is a different file from the page's own, which is the
     point: the shape is shared, so it cannot be written per page. */
  const design = designCss()

  /* The invariant as a function rather than as one inline expectation, so it can
   * be pointed at a PLANTED violation and be seen to report. */
  const frameAirFindings = (cssText: string, designText: string): string[] => {
    const findings: string[] = []
    const live = stripCssComments(cssText)
    const blocks = conditionalRanges(live)
    const insideABand = (at: number): boolean => blocks.some(([from, to]) => at > from && at < to)
    const declared = (name: string): RegExpMatchArray[] => [...live.matchAll(new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;}]+)`, 'g'))]

    // 1. THE SCROLLER PAYS ONE VALUE. `padding-inline: A B` is the asymmetry
    //    itself, written on one line; and a `padding` SHORTHAND here would set
    //    the block axis too, which is the scroller's vertical air — two axes,
    //    one declaration, and the next edit to either one moves both.
    const flowRules = declarationRules(live).filter(rule => /(?:^|[,\s])\.itemFlow(?:\s|,|$|\{)/.test(rule.selector))
    const inlinePads: string[] = []
    for (const rule of flowRules) {
      if (/(?:^|[;{\s])padding\s*:/.test(rule.body)) {
        findings.push('.itemFlow declares a `padding` shorthand, which also sets the block axis and can hide a second inline value')
      }
      for (const call of rule.body.matchAll(/(?:^|[;{\s])padding-inline\s*:\s*([^;]+)/g)) inlinePads.push((call[1] ?? '').trim())
    }
    if (inlinePads.length !== 1) {
      findings.push(`.itemFlow declares ${inlinePads.length} inline padding(s): one declaration is what says both ends pay the same, and a second one is a second answer`)
    }
    for (const value of inlinePads) {
      if (value.split(/\s+/).filter(part => part !== '').length !== 1) {
        findings.push(`.itemFlow pays its two ends different values (padding-inline: ${value}) — the left gap and the right gap are two numbers again`)
      }
    }

    // 2. THAT ONE VALUE IS DECLARED ONCE, AND NOT INSIDE A BAND. A band that
    //    restates the air is the defect whatever number it picks: it makes the
    //    gap answer to width, and the width it answers to need not be the width
    //    that gave the card a left neighbour.
    const air = /var\(\s*(--[a-z][\w-]*)\s*\)/.exec(inlinePads[0] ?? '')?.[1]
    if (air === undefined) {
      findings.push(`what .itemFlow pays is not a single token (${inlinePads[0] ?? 'missing'}), so nothing states the frame's air once`)
    } else {
      const airDeclarations = declared(air)
      if (airDeclarations.length !== 1) {
        findings.push(`${air} is declared ${airDeclarations.length} time(s) — the frame's air is a function of width again`)
      }
      for (const one of airDeclarations) {
        if (insideABand(one.index ?? 0)) {
          findings.push(`${air} is declared inside a conditional block, so the gap changes with the panel's width while the layout around it need not`)
        }
      }
    }

    // 3. THE TWO ENDS ARE THE SAME NUMBER. This is the question the deleted
    //    alias pair used to answer, asked of the thing that now holds the two
    //    ends: the strip inset is ONE inline declaration of ONE value, so both
    //    ends are that value by construction. A second sum at the trailing end
    //    is the same defect the pair was checked for — it just needs a different
    //    shape to hide in.
    const designLive = stripCssComments(designText)
    const stripRules = declarationRules(designLive).filter(rule => /stripInsetOuter/.test(rule.selector))
    const stripPads: string[] = []
    for (const rule of stripRules) {
      for (const call of rule.body.matchAll(/(?:^|[;{\s])padding-inline\s*:\s*([^;]+)/g)) stripPads.push((call[1] ?? '').trim())
    }
    if (stripPads.length !== 1) {
      findings.push(`the strip inset declares ${stripPads.length} inline padding(s) — one declaration is what says both ends pay the same, and a second one is a second answer`)
    }
    for (const value of stripPads) {
      /* A value's TOP-LEVEL parts: the whitespace inside `calc()` does not make
         it two values. `padding-inline: calc(a + b)` is one value, and it says
         both ends pay the same; `padding-inline: calc(a + b) 10px` is two, and
         it says they differ. */
      if (topLevelParts(value).length !== 1) {
        findings.push(`the strip inset pays its two ends different values (padding-inline: ${value}) — the left gap and the right gap are two numbers again`)
      }
      if (!/var\(\s*(--dsh-tb-frame-air|--item-air)\s*\)/.test(value)) {
        findings.push(`the strip inset does not read the frame's air (${value}), so the content line can drift from the card's own edge`)
      }
    }
    /* **两个名字必须是一个数。** 滚动体读 `--item-air`，条带读 `--dsh-tb-frame-air`——
       两个名字，所以这一条要钉住那条别名真的是「同一个数」，否则改一个不会带动另一个。 */
    const airAlias = declared('--item-air').at(-1)?.[1]?.trim() ?? ''
    if (air !== undefined && air === '--item-air' && airAlias !== 'var(--dsh-tb-frame-air)') {
      findings.push(`--item-air is not the frame's air (${airAlias || 'missing'}) — the scroller and the strips would pay two different airs`)
    }
    return findings
  }

  it('is quiet on the stylesheet as it stands', () => {
    expect(frameAirFindings(css, design)).toEqual([])
  })

  it('reports a banded air, an asymmetric pair, and a second sum at the trailing end', () => {
    const banded = `${css}\n@container dsh-tb-item (min-width: 720px) {\n  .itemWorkbench { --item-air: 0px; }\n}\n`
    expect(frameAirFindings(banded, design).join('\n'), 'the gate cannot report the air becoming a function of width').toMatch(/is declared 2 time/)
    // THE PLANT NAMES THE SCROLLER, NOT THE FIRST DECLARATION THAT HAPPENS TO READ
    // THE TOKEN. `--item-air` has a second reader now (the workbench bar, which is
    // the root's first row and therefore cannot see the workbench's own aliases),
    // and a literal `String.replace` would poison THAT rule while leaving
    // `.itemFlow` symmetric — the probe would then report nothing and read exactly
    // like a sheet with no defect. The claim is about the scroller, so the plant is.
    const scroller = /(\.itemFlow \{[^}]*padding-inline: )var\(--item-air\)/
    const asymmetric = css.replace(scroller, '$10px var(--item-air)')
    expect(asymmetric, 'the plant found nothing to replace — the fixture is stale, not the gate').not.toBe(css)
    expect(frameAirFindings(asymmetric, design).join('\n')).toMatch(/pays its two ends different values/)
    // THE SECOND SUM NOW HIDES IN THE SHARED CLASS, WHICH IS WHERE THE TWO ENDS
    // LIVE. The plant gives the trailing end its own sum — the same defect the
    // deleted alias pair was checked for, in the shape it now has.
    const secondSum = design.replace(
      /(\.stripInsetOuter \{[^}]*padding-inline: calc\(var\(--dsh-tb-frame-air\) \+ var\(--dsh-tb-row-pad\)\))/,
      '$1 calc(var(--dsh-tb-frame-air) + var(--s2))',
    )
    expect(secondSum, 'the plant found nothing to replace — the fixture is stale, not the gate').not.toBe(design)
    expect(frameAirFindings(css, secondSum).join('\n')).toMatch(/pays its two ends different values/)
  })

  it('does not read a sentence about the air as a declaration of it', () => {
    // This sheet explains itself in prose, so the reader has to survive the token
    // being NAMED where it is not written — the shape that made a sibling gate
    // demand a deleted rule back. The prose is planted in BOTH sheets: the
    // scroller's and the shared one, since the two ends now live in the latter.
    const prose = `/* the frame pays --item-air at both ends */\n.itemFlow { padding-block: 0; }\n`
    const proseDesign = `/* --dsh-tb-frame-air is the frame's air */\n.stripInsetOuter { padding-block: 0; }\n`
    expect(frameAirFindings(prose, proseDesign).join('\n')).toMatch(/declares 0 inline padding/)
  })
})

/**
 * THE PANEL'S HEIGHT IS DIVIDED, AND NOTHING IT CANNOT SHOW IS UNREACHABLE.
 *
 * The rail band's height follows its CONTENT — the month grid is 240px of it when
 * it is unfolded — and the band used to receive that content with `flex-wrap`,
 * which treats every one of the nineteen navigator chips as a thing that may
 * wrap. Measured on the render artifact: at a 412px panel an unfolded calendar
 * made the band **541px** tall, and in a 560px-tall panel that left the list
 * **19px** with a 32px scroller and NOTHING scrollable anywhere — the reader
 * could not reach a single button. That is the report this gate exists for.
 *
 * So the law is written as a promise TO THE WORK, not as a limit on the band:
 *
 *   1. the list's row carries a floor of half the panel (`minmax(50%, 1fr)`),
 *      which is what bounds the band above it;
 *   2. whatever the band cannot show, it must be able to SCROLL to — an
 *      `overflow-y: hidden` band with taller content is content nobody reaches;
 *   3. the navigator is ONE row in the strip band (it scrolls sideways), never
 *      nineteen chips each on a line of its own.
 *
 * The geometry all three produce is measured in a real Chromium by
 * `scripts/probes/probe-item-strip.js` (`pnpm audit`, the `rail-band` stage) over
 * a ladder of (width, height) pairs. This is the half that runs on every
 * `pnpm test`.
 */
describe('the list keeps half the panel, and nothing it cannot show is unreachable', () => {
  const css = panelCss()
  const STRIP_BAND = '@container dsh-tb-item (max-width: 880px)'

  /** Bodies of `name` rules inside EVERY block whose prelude matches. */
  const inBands = (cssText: string, prelude: string, name: string): string[] => {
    const live = stripCssComments(cssText)
    const out: string[] = []
    for (let at = live.indexOf(prelude); at >= 0; at = live.indexOf(prelude, at + 1)) {
      const open = live.indexOf('{', at)
      if (open < 0) continue
      let depth = 0
      let end = open
      for (; end < live.length; end += 1) {
        if (live[end] === '{') depth += 1
        else if (live[end] === '}') { depth -= 1; if (depth === 0) break }
      }
      out.push(...rulesOf(live.slice(open, end), name))
    }
    return out
  }
  const declaredIn = (bodies: readonly string[], property: string): string[] =>
    bodies.flatMap(body => [...body.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;}]+)`, 'g'))].map(call => (call[1] ?? '').trim()))
  /** Split a track list at TOP-LEVEL whitespace — a track may be `minmax(0, 1fr)`. */
  const tracksOf = (value: string): string[] => {
    const out: string[] = []
    let depth = 0
    let current = ''
    for (const ch of value) {
      if (ch === '(') depth += 1
      if (ch === ')') depth -= 1
      if (/\s/.test(ch) && depth === 0) {
        if (current !== '') out.push(current)
        current = ''
        continue
      }
      current += ch
    }
    if (current !== '') out.push(current)
    return out
  }

  const budgetFindings = (cssText: string): string[] => {
    const findings: string[] = []
    // 1. THE WORK ROW HAS A FLOOR.
    for (const value of declaredIn(inBands(cssText, STRIP_BAND, 'itemWorkbench'), 'grid-template-rows')) {
      const tracks = tracksOf(value)
      if (tracks.length < 2) {
        findings.push(`the strip band declares one track (${value}): the rail band and the list are then one row and the list has no floor`)
        continue
      }
      const floor = /^minmax\(\s*([\d.]+)%/.exec(tracks[tracks.length - 1] ?? '')?.[1]
      if (floor === undefined || Number(floor) < 50) {
        findings.push(`the list's row has no half-panel floor (grid-template-rows: ${value}) — a content-sized rail band can then take the whole panel`)
      }
    }
    // 2. WHAT DOES NOT FIT MUST BE SCROLLABLE.
    const base = declaredIn(inBands(cssText, STRIP_BAND, 'itemRail'), 'overflow-y')
    const open = declaredIn(inBands(cssText, STRIP_BAND, 'itemRail\\[data-calendar\\]'), 'overflow-y')
    const effective = open.length > 0 ? open[open.length - 1] : (base[base.length - 1] ?? '')
    if (effective !== 'auto' && effective !== 'scroll') {
      findings.push(`the unfolded band is ${effective || 'not declared'} on the block axis — content the floor pushes out of it is then neither reachable nor scrollable`)
    }
    // 3. ONE ROW, NOT NINETEEN.
    for (const value of declaredIn(inBands(cssText, STRIP_BAND, 'itemRail'), 'flex-wrap')) {
      if (value === 'wrap') findings.push('the strip wraps again: every navigator chip becomes a line of its own and the band eats the panel')
    }
    const chips = inBands(cssText, STRIP_BAND, 'itemRailChips')
    if (declaredIn(chips, 'flex-direction')[0] !== 'row') {
      findings.push('the navigator is not a row in the strip band, so the strip is not one row of chips')
    }
    if (!declaredIn(chips, 'overflow-x').some(one => one === 'auto' || one === 'scroll')) {
      findings.push('the navigator row does not scroll sideways, so a chip that does not fit is a chip nobody can press')
    }
    return findings
  }

  it('is quiet on the stylesheet as it stands', () => {
    expect(budgetFindings(css)).toEqual([])
  })

  it('reports a band with no floor, a hidden overflow, and a wrapping strip', () => {
    expect(budgetFindings(`${css}\n${STRIP_BAND} { .itemWorkbench { grid-template-rows: auto minmax(0, 1fr); } }\n`).join('\n'))
      .toMatch(/no half-panel floor/)
    expect(budgetFindings(`${css}\n${STRIP_BAND} { .itemRail[data-calendar] { overflow-y: hidden; } }\n`).join('\n'))
      .toMatch(/neither reachable nor scrollable/)
    expect(budgetFindings(`${css}\n${STRIP_BAND} { .itemRail { flex-wrap: wrap; } }\n`).join('\n'))
      .toMatch(/wraps again/)
  })

  it('does not read a sentence about the band as a rule in it', () => {
    const prose = `${css}\n/* in ${STRIP_BAND} the strip used to wrap, and a ` +
      '`grid-template-rows: auto minmax(0, 1fr)`' + ` was what let it eat the panel */\n`
    expect(budgetFindings(prose)).toEqual([])
  })
})

/**
 * THE TOP BAR TABS ITS CHIPS AND ITS ACTION WITH ONE GAP.
 *
 * The chips and the primary action are one row of pills, and the cluster hangs at
 * the row's end by its own auto margin — the same rule the wide band uses. The
 * strip band used to give the cluster a FULL ROW (`flex: 1 1 100%`) and the action
 * an auto margin of its own: measured on the render artifact that is a **500px**
 * gap between 「排序 要紧的先」 and 「＋新建一条」 at an 880px panel while the chips
 * beside them sat 4px apart, and when the cluster itself wrapped the action landed
 * 4px under the chips, reading as a row that is out of alignment.
 *
 * **A row with two gap sizes has no skeleton**, so the gate asks for the two
 * things that make it one: the cluster never takes a full row here, and when it
 * does wrap, its lines are separated by the bar's own gap.
 */
describe('the top bar tabs its chips and its action with one gap', () => {
  const css = panelCss()
  const STRIP_BAND = '@container dsh-tb-item (max-width: 880px)'

  const inBand = (cssText: string, name: string): string[] => {
    const live = stripCssComments(cssText)
    const out: string[] = []
    for (let at = live.indexOf(STRIP_BAND); at >= 0; at = live.indexOf(STRIP_BAND, at + 1)) {
      const open = live.indexOf('{', at)
      if (open < 0) continue
      let depth = 0
      let end = open
      for (; end < live.length; end += 1) {
        if (live[end] === '{') depth += 1
        else if (live[end] === '}') { depth -= 1; if (depth === 0) break }
      }
      out.push(...rulesOf(live.slice(open, end), name))
    }
    return out
  }
  const declared = (bodies: readonly string[], property: string): string[] =>
    bodies.flatMap(body => [...body.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;}]+)`, 'g'))].map(call => (call[1] ?? '').trim()))

  const gapFindings = (cssText: string): string[] => {
    const findings: string[] = []
    const tools = inBand(cssText, 'itemTopBarTools')
    for (const value of [...declared(tools, 'flex'), ...declared(tools, 'flex-basis')]) {
      if (/(?:^|\s)100%$/.test(value)) {
        findings.push(`the tool cluster takes a full row (flex: ${value}), so the action is pushed to the far end of it and a hole opens between them`)
      }
    }
    const bar = declared(inBand(cssText, 'itemTopBar'), 'row-gap')
    const cluster = declared(tools, 'row-gap')
    if (bar.length > 0 && cluster.length > 0 && bar[bar.length - 1] !== cluster[cluster.length - 1]) {
      findings.push(`a wrapped tool row is separated by ${cluster[cluster.length - 1]} while the bar's own rows are ${bar[bar.length - 1]} apart — two rhythms in one bar`)
    }
    return findings
  }

  it('is quiet on the stylesheet as it stands', () => {
    expect(gapFindings(css)).toEqual([])
  })

  it('reports a full-row cluster and a second rhythm under it', () => {
    expect(gapFindings(`${css}\n${STRIP_BAND} { .itemTopBarTools { flex: 1 1 100%; } }\n`).join('\n')).toMatch(/takes a full row/)
    expect(gapFindings(`${css}\n${STRIP_BAND} { .itemTopBarTools { row-gap: var(--s1); } }\n`).join('\n')).toMatch(/two rhythms/)
  })

  it('does not read a sentence about the cluster as a rule', () => {
    expect(gapFindings(`/* .itemTopBarTools used to take a full row */\n.a { color: red; }\n`)).toEqual([])
  })
})

describe('a fact that does not fit is truncated in its own text slot', () => {
  const css = panelCss()

  /**
   * The width of the longest date reading this surface can print, at the row's
   * own size: 「最早 2026年10月5日」, measured on a real rendering.
   *
   * It is a FLOOR, not a target. Any track wider than this is fine, and the
   * render artifact is what finally confirms the reader still sees the whole
   * date — a number in a test cannot measure a glyph.
   */
  const LONGEST_DATE_READING_PX = 110

  it('every date reading on a row can shrink and clip, so it cannot land on the next fact', () => {
    // THE ROW'S FACT LINE is a grid with a fixed date track, an `auto` count
    // track and a filler. The gate reading — 「最早 2026年10月5日」 — is the
    // longest date string this surface can print, and a fixed `ch` track that
    // cannot hold it does not truncate: the text leaves the box, and because
    // the overflow is not part of the track's content the `auto` track beside
    // it keeps its own starting position, so the two facts overlap on screen.
    //
    // So the requirement is NOT "the track is wide enough" — that is arithmetic
    // on CJK glyph widths done twice, in a test, by someone guessing. The
    // requirement is HARD RULE 11's second floor: text never leaves its box,
    // and truncation happens only in a text sub-slot. Any of widening the
    // track, sizing it to content, or letting the text clip satisfies it, and
    // the fixtures carry the combination (a gated row that also has a step
    // count) so the artifact shows it either way.
    // THE READINGS THAT CANNOT FIT are not `.itemDue` / `.itemStartsAfter` /
    // `.itemSteps` — three facts sharing one truncated line under a row's title.
    // The table gives each one its own cell, so the three readings are checked in
    // the cells that carry them, and a NEW reading added to a cell without a floor
    // is reported by name rather than counted away.
    // NOT CELLS. The three truncated cells under a title are three text slots: the
    // reading at the end of the sentence, the tags beside the menu, and the numbers
    // under the sentence. The promise is one — a fact that cannot fit is truncated
    // in ITS OWN slot, never by the row's — so it is checked on the slots that
    // exist.
    /* `itemRowDateText` left this list because the SLOT IT NAMED left the sheet:
     * the date reading now renders the design system's one truncation slot
     * (`.truncate`), so a rule of its own would be a second copy of those four
     * declarations. What must still hold is that the reading IS truncated in its
     * own slot — and the shared class is where that promise lives now. */
    const facts = ['itemRowMarks', 'itemRowDate', 'itemRowMeta']
    for (const name of facts) {
      const bodies = rulesOf(css, name)
      expect(bodies.length, `there is no .${name} rule`).toBeGreaterThan(0)
      // THE UNION OF THE RULES, NOT EACH ONE. Demanding that EVERY block naming the
      // class carry the shrink and the clip is a reading of CSS that does not exist:
      // declarations CASCADE, so a rule that adds only `font-variant-numeric` to a
      // class does not take the shrink away from the rule beside it. The three
      // readings share one block through `:is()` — the right way to say 「these three
      // have one floor」 — and a second block that tunes a number is not a second
      // floor.
      //
      // The claim is exactly as strong: if NO rule naming the class shrinks it, or
      // none of them clips it, the reading is still unbounded. What it must not do
      // is report a correct stylesheet as broken, which is the failure mode this
      // repository keeps warning about — a gate that pushes the implementation into
      // a worse shape gets loosened, and the defect it was built for comes back
      // with it.
      const all = bodies.join('\n')
      // EITHER SPELLING OF 「it can end」: a grid item shrinks with
      // `min-inline-size: 0`, an inline phrase ends with a ceiling and an
      // ellipsis. Both keep the promise — the reading never pushes the fact beside
      // it — so the test asks for the promise rather than for one shape's spelling.
      expect(
        /(?:^|[;{\s])min-inline-size\s*:\s*0/.test(all) || /max-inline-size/.test(all),
        `.${name} neither shrinks nor has a ceiling, so a long reading pushes the next track instead of truncating`,
      ).toBe(true)
      // A TAG ENDS BY WRAPPING. Cutting a tag in half in a fixed-height column is a
      // tag nobody can read back — so a long row of them takes a second line and the
      // row grows. Clipping is still accepted for the other two slots, which are
      // inline phrases inside a sentence.
      expect(
        /flex-wrap\s*:\s*wrap/.test(all)
          || /overflow\s*:\s*hidden/.test(all)
          || /text-overflow\s*:\s*ellipsis/.test(all),
        `.${name} neither wraps nor clips, so it is painted on top of the fact beside it`,
      ).toBe(true)
    }
  })

  it('the probe bites: a reading with no floor anywhere is reported, whatever the rules are split across', () => {
    // Both shapes the union reading has to tell apart: the declarations split
    // over two blocks, which is fine, and genuinely absent, which is the defect.
    // A union that answered `true` for anything containing the word would pass
    // the second one, and a union that demanded one block carry both would fail
    // the first — which is the reading this case replaced.
    const floors = (cssText: string, name: string): { shrink: boolean; clip: boolean } => {
      const all = rulesOf(cssText, name).join('\n')
      return {
        shrink: /(?:^|[;{\s])min-inline-size\s*:\s*0/.test(all),
        clip: /overflow\s*:\s*hidden/.test(all) || /text-overflow\s*:\s*ellipsis/.test(all),
      }
    }
    // Mirrors how the sheet actually reads: one shared block naming all three
    // readings through `:is()`, plus a second block that tunes the number.
    const split = [
      '.itemCellDue { min-inline-size: 0; overflow: hidden; }',
      '.itemCellDue { font-variant-numeric: tabular-nums; }',
    ].join('\n')
    expect(floors(split, 'itemCellDue'), 'the probe does not bite — a floor split over two rules reads as absent').toEqual({ shrink: true, clip: true })
    const none = '.itemCellDue { font-variant-numeric: tabular-nums; }'
    expect(floors(none, 'itemCellDue'), 'a reading with no floor at all was accepted — this is the defect the gate exists for').toEqual({ shrink: false, clip: false })
  })

  it('the date track is a NAMED token in a text-relative unit, and it is wide enough for its longest reading', () => {
    // THE SECOND HALF, and it is the half that keeps the first one honest.
    //
    // Clipping alone is not a fix: a one-line reading clipped to 「最早 2026年…5日」
    // is a reader who cannot tell how late they are, which is the whole reason
    // the fact line exists. So the track has to be WIDE ENOUGH as well.
    //
    // "Wide enough" is stated as a RELATION and not as a pixel equation, and
    // that is a deliberate choice rather than a way of dodging. The two shapes
    // a test can compute here are: a length in `em`, multiplied by the size the
    // row actually renders at; and a length in `ch`, which is the width of a
    // digit and says nothing about a CJK glyph. So the gate requires the unit
    // to be text-relative AND resolves it against the row's OWN declared size —
    // which is why that size must be declared on the row rather than inherited,
    // because an inherited size is a number this file cannot know.
    //
    // The floor below is the measured width of the longest reading the surface
    // can print, 「最早 2026年10月5日」. It is a floor, not a target: any wider
    // is fine, and the artifact is what confirms the reader still sees the whole
    // date.
    //
    // **BOTH UNITS ARE ACCEPTED, AND THAT IS THE FIX.** Rejecting a device-pinned
    // track outright on the reasoning that only a text-relative unit can be resolved
    // against the text it has to hold cannot stand: the date cell is a TABLE CELL, and
    // a table's column width is not a font measurement — it is a track in a grid, and
    // the whole point of a grid track is that it does not move when the type does. A
    // px track here is MORE resolvable than an `em` one, because `em` resolves against
    // a font-size declared somewhere else in the sheet and the reader has to go and
    // find it.
    //
    // So the claim is the claim it always was — **named token, and wide enough** — and
    // the unit is not part of it.
    // THE READING IS NOT A COLUMN, AND IT IS NOT INSIDE THE SENTENCE EITHER.
    // 它现在站在行右边那簇记号里（步数 · 卡 · 日期），与 ⋮ 相邻——所以「一个具名且够宽
    // 的轨道」这句话的对象变了：句子那条轨的地板保护的是**标题**（一条被挤到只剩几个字的
    // 标题不是标题），而读法自己的宽度由那一簇的轨道**按内容定**（`auto`），于是它永远
    // 拿得到自己需要的那几十像素，不靠一个写死的数去猜。
    const track = /grid-template-columns:\s*10px\s+minmax\((\d+)px,\s*1fr\)\s+auto/.exec(css)?.[1]
    expect(track, 'the sentence track has no named floor — a long reading column can squeeze it to a few characters').toBeDefined()
    // The row's marks track is CONTENT-SIZED, which is the claim that replaced 「wide enough」:
    // a fixed px track here would have to be at least the longest reading (110px), and a number
    // that says that is a number that goes stale the day a language is longer.
    expect(
      /grid-template-columns:\s*10px\s+minmax\(\d+px,\s*1fr\)\s+auto\s+28px/.test(css),
      'the marks track is not content-sized, so the longest date reading can be squeezed by a track measured for something else',
    ).toBe(true)
    // The reading states the size its own width has to hold text at, so anything that ever does
    // measure it resolves against this number rather than guessing.
    const cellSize = Number(/(?:^|[;{\s])font-size\s*:\s*([\d.]+)px/.exec(rulesOf(css, 'itemRowDate').join('\n'))?.[1] ?? 0)
    expect(cellSize, '.itemRowDate does not declare its own font-size, so a text-relative track on it resolves against a size this file cannot know').toBeGreaterThan(0)
    const resolved = Number(track)
    // AND THE READING ENDS INSIDE ITSELF. Two things have to be true together, and they are the
    // same promise the sentence's own floor makes: the sentence's floor is at least the longest reading
    // (so a reading that lands in the sentence would still start on screen in full), AND the
    // reading's own text slot declares how it ends (ellipsis), so a reading that cannot fit clips
    // in its OWN slot rather than pushing the fact beside it.
    expect(resolved, `the sentence's floor is ${resolved}px; a floor below the ${LONGEST_DATE_READING_PX}px the longest reading needs means that reading cannot start on screen at all`).toBeGreaterThanOrEqual(LONGEST_DATE_READING_PX)
    /* The reading wears the SHARED truncation slot now (`.truncate` in the design
     * sheet), so the two declarations this case protects are read there — one copy
     * of 「how it ends」 and 「它有自己的地板」 for the whole plugin, which is the
     * point of moving it. Reading them from the local sheet would assert a rule
     * that no longer exists and say nothing about what renders. */
    const slot = rulesOf(designCss(), 'truncate').join('\n')
    expect(slot, 'the shared text slot does not declare how it ends when it is full').toMatch(/text-overflow\s*:\s*ellipsis/)
    /* 地板是一条**槽**而不是写死的零：一枚药丸有自己的 24px 地板，共享形态把它钉成 0
     * 就等于替所有消费者做了决定。判据因此读「它声明了一条可以收缩的地板」，而槽的
     * 默认值就是零——`var(--dsh-tb-clip-floor, 0)`。 */
    expect(slot, 'the shared text slot does not declare a floor of its own, so it pushes its neighbours')
      .toMatch(/min-(?:inline-)?(?:width|size)\s*:\s*var\(--dsh-tb-clip-floor,\s*0\)/)
  })

  it('the probe bites, and a track that resolves too narrow is reported', () => {
    // Both units are accepted now, so this has to prove BOTH are read as the
    // reader above accepts them — otherwise the gate accepts a track it never
    // measured, and a `ch` track would pass by falling through to zero.
    // A `ch` track is not measured: it is the width of a digit and says nothing
    // about a CJK glyph, so it is the one spelling that is NOT a width here.
    const resolvesWideEnough = (track: string, cellSize: number): boolean => {
      const px = /^([\d.]+)px$/.exec(track)
      if (px !== null) return Number(px[1]) >= LONGEST_DATE_READING_PX
      const em = /^([\d.]+)(em|rem)$/.exec(track)
      if (em === null) return false
      return Number(em[1]) * cellSize >= LONGEST_DATE_READING_PX
    }
    expect(resolvesWideEnough('11ch', 13), 'a `ch` track was accepted — `ch` is the width of a digit, not of a CJK glyph').toBe(false)
    expect(resolvesWideEnough('10em', 13), '10em at 13px is 130px, which clears the longest reading').toBe(true)
    expect(resolvesWideEnough('8em', 13), '8em at 13px is 104px and does not clear it — the floor is a floor, not an equality').toBe(false)
    // THE SHAPE, exercised: a device-pinned track is accepted, and only because it
    // clears the floor. A rule that judged by unit instead of by measurement gets
    // both of these wrong.
    expect(resolvesWideEnough('112px', 13), 'a fixed 112px column was rejected, but it clears the longest reading').toBe(true)
    expect(resolvesWideEnough('96px', 13), 'a 96px column was accepted although the longest reading needs 110px').toBe(false)
    // The size is part of the relation, so the same track at a smaller row
    // resolves narrower and has to be reported: a track that only fits because
    // the row happens to be 12px today is a track that will not fit after the
    // next type-scale change.
    expect(resolvesWideEnough('10em', 10), 'the same track at 10px is 100px and no longer clears it, and the gate has to notice').toBe(false)
  })

  it('the probe bites, and the gate is not just asking for a class name', () => {
    // The detector is exercised on strings it cannot have been tuned against,
    // so a green here means the DETECTOR works, not that the sheet happens to
    // satisfy it. A control that depended on the real sheet's current state
    // would pass by accident the day the sheet is fixed, and then it would be
    // proving nothing for ever after.
    const clips = (text: string): boolean => rulesOf(text, 'itemDue')
      .some(body => /overflow\s*:\s*hidden/.test(body) || /text-overflow\s*:\s*ellipsis/.test(body))
    expect(clips('.itemDue { overflow: hidden; }')).toBe(true)
    expect(clips('.itemDue { text-overflow: ellipsis; }')).toBe(true)
    expect(clips('.itemDue { color: red; }')).toBe(false)
    // The track probe: a length pinned to the device is reported; a
    // text-relative one is not. `11ch` is the real value and is deliberately
    // NOT a finding — the arithmetic of whether it is enough belongs to the
    // rendered artifact, not to a suite that cannot measure glyphs.
    const pinned = (text: string): boolean => {
      const value = /--item-meta-date-col\s*:\s*([^;]+)/.exec(/\.itemRoot\s*\{([\s\S]*?)\n\}/.exec(text)?.[1] ?? '')?.[1]?.trim() ?? ''
      return value === '' || /\d+(?:px|pt)\b/.test(value)
    }
    expect(pinned('.itemRoot {\n  --item-meta-date-col: 74px;\n}\n')).toBe(true)
    expect(pinned('.itemRoot {\n  --item-meta-date-col: 11ch;\n}\n')).toBe(false)
  })
})

const CONTENT_SIZED_IN_INLINE_AXIS = /align-self\s*:\s*(?:start|flex-start)/

describe('the triage sentence is a sentence, not filler', () => {
  const css = panelCss()
  // The SURFACE, not one file: the sentence moved to the list page when the
  // panel was split, and a gate wired to a path is a gate that reports a move as
  // a break. See `itemSurfaceSource` for why the fix is to enumerate rather than
  // to repoint.
  const panelSource = itemSurfaceSource()

  it('a section caption does not outrank the fields it introduces', () => {
    // MEASURED, THEN FIXED, THEN PINNED. The caption was 12px/**600** in `text-3`
    // — the only 600 in the whole form, on its faintest ink, while every value it
    // introduces was 400. So the eye landed on 「标题与正文」 before the title
    // field that caption names, and it competed with the one control allowed to
    // be alarming. A container label that outranks its own contents is not a label.
    //
    // The gate is the ORDER, not three numbers: whatever the sizes are, the ladder
    // has to run value → label → caption, in ink as well as in size. Asserted as
    // a comparison so the next person to retune one of them cannot quietly
    // promote the caption again.
    const size = (name: string): number => {
      const body = declarationRules(css)
        .filter(rule => new RegExp(`\\.${name}(?![\\w-])`).test(rule.selector))
        .map(rule => /font-size\s*:\s*([\d.]+)px/.exec(rule.body)?.[1])
        .find(v => v !== undefined)
      return body === undefined ? NaN : Number(body)
    }
    // THE READER RESOLVES THE ALIAS, and that is the whole finding. Looking for a
    // LITERAL `--dsh-tb-text-N` inside the rule fails the moment the sheet gives its
    // three ink steps names of their own: the reader finds nothing and answers `-1`,
    // which is the same value it answers when it has not looked. **A gate that
    // cannot tell 「not found」 from 「found nothing there」 reports a correct
    // stylesheet as broken**, and the only way to make it green is to delete the
    // names.
    //
    // So both spellings mean the same step. Three ink layers with names is the
    // feature, not the defect: the ladder is the panel's own, and the host's
    // tokens are where its values come from.
    const ink = (name: string): number => {
      const order = ['--dsh-tb-text-1', '--dsh-tb-text-2', '--dsh-tb-text-3']
      const body = declarationRules(css)
        .filter(rule => new RegExp(`\\.${name}(?![\\w-])`).test(rule.selector))
        .map(rule => /color\s*:\s*([^;]+)/.exec(rule.body)?.[1] ?? '')
        .map(value => value.replace(/--item-ink-([123])/g, (_match, step: string) => `--dsh-tb-text-${step}`))
        .find(v => order.some(token => v.includes(token)))
      return order.findIndex(token => (body ?? '').includes(token))
    }
    // And the three steps are DECLARED, which is the claim the whole ladder
    // rests on: a step nothing declares is a step nothing can be measured
    // against, and the reader above would silently degrade to reading three
    // raw host tokens instead of three levels.
    for (const step of [1, 2, 3]) {
      expect(css, `--item-ink-${step} is not declared, so the ink ladder has a rung nothing resolves to`)
        .toMatch(new RegExp(`--item-ink-${step}\\s*:\\s*var\\(--dsh-tb-text-${step}\\)`))
    }
    const value = size('itemInput')
    // `.itemOptName` IS the label that draws the property table; `.itemFieldLabel`
    // belongs to a form this panel no longer has.
    const label = size('itemOptName')
    const caption = size('itemOpenCaption')
    // SIZE IS NOT THE LEVER, and the design says so: `.x-cap` and `.f-name` are both
    // 12px, because a caption a size below the names it introduces reads as a label
    // FOR the label. So the two are separated by INK — checked below — and this
    // assertion now only guards that neither of them has drifted onto the value's
    // own size.
    expect(caption, 'the section caption has drifted onto the value tier').toBeLessThanOrEqual(label)
    expect(label, 'a field label is not smaller than the value it names')
      .toBeLessThanOrEqual(value)
    // SIZE IS NOT THE LEVER. The caption and the field name are both 12px — a caption
    // a size below its own field names reads as a label FOR the label — so the three
    // tiers have to be separated by something else.
    //
    // IT IS NO LONGER INK, AND INK RAN OUT OF ROOM RATHER THAN FALLING OUT OF FAVOUR.
    // The three used to be ink-1/2/3, but ink-3 is the host's
    // `--dsw-alias-label-tertiary` (#81858c) — 3.7:1 on white, below AA for text — and
    // the host ships NO token between it and `--dsw-alias-label-secondary`
    // (#61666b, 5.6:1). A quieter-AND-readable third ink is not expressible, so both
    // labels came up to ink-2, and the ladder moved to WEIGHT — the panel's table is
    // {12: [400, 600]}, so the only step available at this size is 400 against the
    // field name's 600, and 400 is the right one: the caption is the quietest.
    //
    // The claim is unchanged and still pinned — a caption must not outrank the field
    // names it introduces — but it is read from the axis that now carries it. The ink
    // assertions stay, at the value they now share, so a caption that drifts back down
    // onto a quieter tier is still caught.
    const weight = (name: string): number => {
      const body = declarationRules(css)
        .filter(rule => new RegExp(`\\.${name}(?![\\w-])`).test(rule.selector))
        .map(rule => /font-weight\s*:\s*(\d+)/.exec(rule.body)?.[1])
        .find(v => v !== undefined)
      return body === undefined ? NaN : Number(body)
    }
    expect(weight('itemOpenCaption'), 'the caption outranks the field names it introduces')
      .toBeLessThan(weight('itemOptName'))
    expect(weight('itemOptName'), 'a field name does not outrank the value it names')
      .toBeGreaterThanOrEqual(weight('itemRowMeta'))
    expect(ink('itemOpenCaption'), 'the caption drifted back onto a quieter tier')
      .toBeGreaterThanOrEqual(ink('itemOptName'))
    expect(ink('itemOptName'), 'a field name is not louder than the value it names')
      .toBeGreaterThanOrEqual(ink('itemInput'))
  })

  it('an odd field in a two-column grid is named, so the last row is not half empty', () => {
    // 计划与期限 seats 状态|优先级 / 开始|计划 / 截止 — five into two, which
    // measured as a 382 × 53px hole at the end of the section a reader scans FOR
    // DATES. The fix names the field (`data-wide`) rather than reaching for
    // `:last-child`, because 「the last child of the grid」 is a position and the
    // hard deadline is a field; a reordering would silently move the span.
    // NO TWO-COLUMN GRID, SO NO ODD FIELD. The five fields were seated two to a row
    // and the fifth left a 382x53px hole at the end of the section a reader scans FOR
    // DATES. The dates are a list now — one date per full-width row — so the hole
    // cannot come back, and the promise it was standing in for is that every date row
    // is a whole row.
    const axis = rulesOf(css, 'itemDateAxis li').join('\n')
    expect(axis, 'the date axis has no row rule, so a date can be half a row').not.toBe('')
    expect(axis, 'a date row is not its own block, so the three dates are not three rows').toMatch(/display\s*:\s*flex/)
    expect(readFileSync(new URL('../src/client/item/detail-pane.tsx', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
      'the date axis is drawn by nobody, so the fields are back to a form')
      .toContain('itemDateAxis')
  })

  it('the STANDALONE sentence does not grow vertically, so it cannot open a hole in the column', () => {
    // The panel prints 「没有等你动手的事」 as a paragraph of its own inside the
    // page body, which is a COLUMN flex container. `flex: 1 1 auto` on a direct
    // child of a column container is `flex-grow: 1` along the block axis, so a
    // one-line sentence is stretched to fill 660px of a list column and the
    // reader sees a void with a caption at the top of it.
    //
    // The class is read off the MARKUP (the `<p>` that carries the standalone
    // sentence) rather than named here, so renaming the class cannot make this
    // quiet and cannot make it red for a rename.
    // The class is legitimately `flex: 1 1 auto` where it sits BESIDE a button in
    // a row — that is what lines the triage actions up — so what this gate asks is
    // about the STANDALONE use, and the markup plus the selector's ancestors are
    // what tell the two apart.
    // page body, which is a COLUMN flex container. `flex: 1 1 auto` on a direct
    // child of a column container is `flex-grow: 1` along the block axis, so a
    // one-line sentence is stretched to fill 660px of a list column and the
    // reader sees a void with a caption at the top of it.
    //
    // THE CLASS IS READ OFF THE MARKUP, NOT NAMED HERE — and the markup is the
    // TABLE's. The sentence is a PROP handed to the table
    // (`empty={nothingToShow}`), not an inline `<p>{t('item.triage.nothing')}</p>`
    // in the page, because the table is what knows whether it is drawing rows or an
    // empty state. So the gate looks for **the box the table puts that sentence
    // in**, which is the only place a standalone sentence can live.
    expect(panelSource, 'the page hands the table no empty-state sentence, so a list that needs nothing tells the reader nothing')
      .toMatch(/empty=\{[^}]*nothingToShow|noMatch=\{/)
    const standalone = /<[a-z]+ className=\{css\.([A-Za-z]\w*)\}>\s*\{props\.(?:empty|noMatch)\}/.exec(panelSource)
      ?? /className=\{css\.(itemListEmpty|itemNoMatch)\}/.exec(panelSource)
    expect(standalone, 'cannot find the box the table renders the standalone sentence in — the reader is told nothing on a list that needs nothing').not.toBeNull()
    // THE NAME IS USED AS WRITTEN. `panelCss()` reads the stylesheet AS A FILE, where
    // the class names are still literal, so routing the name through the built
    // class map only bought a chance to come back empty — which is what it did,
    // and the gate reported 「no rule」 about a rule sitting three lines above it.
    const className = standalone?.[1] ?? ''
    // ONLY THE RULES THAT CAN MATCH THAT ELEMENT, and the distinction is the
    // selector's ANCESTORS rather than the class name: a class may legitimately be
    // `1 1 auto` beside a button in a row. A gate that collected every rule with
    // this class and called any growth a hole was reporting the row's correct
    // behaviour as the column's defect — it could not see WHICH box it was in.
    const applicable = declarationRules(css)
      .filter(rule => new RegExp(`\\.${className}(?![\\w-])`).test(rule.selector))
      .filter(rule => canMatchStandalone(rule.selector, className))
    expect(applicable.length, `there is no .${className} rule that the standalone sentence is actually subject to`).toBeGreaterThan(0)
    for (const rule of applicable) {
      const grow = /(?:^|[;{\s])flex(?:-grow)?\s*:\s*([^;]+)/.exec(rule.body)?.[1] ?? ''
      const grows = /(?:^|\s)1(?:\s|$)/.test(grow.split(/\s+/)[0] ?? '') && !/^0/.test(grow.trim())
      expect(grows, `${rule.selector} grows along the block axis (flex: ${grow.trim()}) — a one-line sentence then becomes the height of the column`).toBe(false)
    }
  })

  it('the probe bites: a planted grow is reported, and the ROW rule is not mistaken for it', () => {
    // THE PLANT IS AIMED AT THE CLASS THE MARKUP NAMES, never at a name typed in
    // here. Planting into `.itemTriageText` keeps the probe biting only while the
    // sentence keeps that name: the day the sentence moves into the table as a prop,
    // the plant lands in a rule nothing renders and the probe reports 「did not bite」
    // about a gate that is fine. **A probe that has to be re-aimed by hand after
    // every rename is a probe measuring itself.**
    const standalone = /<[a-z]+ className=\{css\.([A-Za-z]\w*)\}>\s*\{props\.(?:empty|noMatch)\}/.exec(panelSource)
      ?? /className=\{css\.(itemListEmpty|itemNoMatch)\}/.exec(panelSource)
    expect(standalone, 'the standalone sentence is gone from the panel markup, so there is nothing to plant into').not.toBeNull()
    const className = standalone?.[1] ?? ''
    // `[^{]*` rather than `\s*`, and that one class of characters is the whole
    // difference. The rule is written as a SHARED selector —
    // `.itemListEmpty,\n.itemNoMatch {` — so a pattern that wants the class
    // immediately followed by `{` finds nothing, the plant lands nowhere, and the
    // probe reports 「did not bite」 about a gate that is fine. A probe that cannot
    // see how the sheet is actually written is a probe measuring its own pattern.
    // AIM AT THE RULE, NOT AT THE CLASS'S POSITION IN IT. The empty state's rule is
    // written as a SHARED selector head — `.itemListEmpty,\n.itemNoMatch {` — so a
    // pattern anchored on the class finds the brace only by crossing the sibling,
    // and anchoring on `\\b[^{]*` is what makes that cross a deliberate one.
    // PLANTED AS ITS OWN RULE. Inserting into the first rule naming the class lands
    // inside a SHARED selector head — `.itemListEmpty,\n.itemNoMatch {` — so the
    // declaration sits on the sibling's half and the reader, which correctly asks
    // whether the class can stand alone there, says the plant did not bite.
    // A probe plants a defect it could not have been tuned against, and the cleanest
    // such defect is a rule of its own.
    const planted = `${css}\n.${className} {\n  flex: 1 1 auto;\n}\n`
    expect(planted, `the plant did not land — the sheet has no rule for ${className}, the class the markup names, so this probe has nothing to test`).not.toBe(css)
    const growsWhere = (sheet: string, name: string): boolean => declarationRules(sheet)
      .filter(rule => new RegExp(`\\.${name}(?![\\w-])`).test(rule.selector))
      .filter(rule => canMatchStandalone(rule.selector, className))
      .some(rule => /flex\s*:\s*1\s+1\s+auto/.test(rule.body))
    // The first assertion already said the class is not in the markup; if the sheet
    // has no rule for it either, there is nothing here to plant into and reporting
    // 「did not bite」 about it is the probe describing itself rather than the sheet.
    if (planted !== css) {
      expect(growsWhere(planted, className), 'the plant did not bite — the gate is not testing the defect').toBe(true)
    }
    expect(growsWhere(css, className), 'the real sheet is reported as growing, so this gate can only be red').toBe(false)
    expect(growsWhere(planted, 'itemNothingHere'), 'the plant leaked into a class that does not exist — the probe is not testing the detector').toBe(false)
  })
})

describe('the search box is the same width on every page', () => {
  const css = panelCss()

  it('no page can change the field\'s own box', () => {
    // The field is in the header, and the header is the same on all three
    // pages — so if the field's markup is identical on all three and its own
    // declarations do not size it from its content or from its siblings, its
    // width is identical on all three. That is the whole proof, and it is why
    // this gate is two checks and not a screenshot: the two ways a page can
    // change a box it does not own are an inline style in the markup, and a
    // content-based size in the sheet. Both are listed by name.
    const markups = PAGES.map(page => {
      const html = renderPanel(fixtures(), 'wide', page)
      const field = /<input[^>]*class="([^"]*)"[^>]*>/.exec(html)?.[0] ?? ''
      return { page, field }
    })
    expect(fieldPresence(markups), 'the search field was not found on every page').toEqual(markups.map(m => m.page))
    // Same classes, same attributes, and above all no inline geometry.
    const shapes = new Set(markups.map(m => m.field.replace(/value="[^"]*"/, 'value=""')))
    expect(shapes.size, `the search field is not the same element on every page:\n${[...shapes].join('\n')}`).toBe(1)
    for (const match of markups[0]?.field.matchAll(/style="([^"]*)"/g) ?? []) {
      expect(match[1] ?? '', 'the search field carries an inline width').not.toMatch(/(?:^|;)\s*(?:width|inline-size)\s*:/)
    }
    // And the sheet sizes it from its own box, never from its content.
    for (const name of ['itemSearch', 'itemSearchRow']) {
      for (const value of [...declaredOf(css, name, 'inline-size'), ...declaredOf(css, name, 'width')]) {
        expect(value, `.${name} is sized from its content (${value}), so its measure depends on what is in it`).not.toMatch(/\b(?:auto|max-content|min-content|fit-content)\b/)
      }
    }
  })

  it('the probe bites: a content-sized field is reported', () => {
    // PLANTED AS ITS OWN RULE. The search box declares no `inline-size` at all —
    // it is `flex: 1 1 auto` with a cap — so a plant shaped as 「replace that
    // declaration」 found nothing and the probe reported 「did not bite」 about a
    // gate that was never asked anything. A later rule wins by source order, so
    // this is both the simpler plant and the only one that works against a
    // declaration that may be absent.
    const planted = `${css}\n.itemSearch {\n  inline-size: max-content;\n}\n`
    const sizedFromContent = [...declaredOf(planted, 'itemSearch', 'inline-size')].some(value => /\bmax-content\b/.test(value))
    expect(sizedFromContent, 'the plant did not bite').toBe(true)
    const real = [...declaredOf(css, 'itemSearch', 'inline-size')]
    expect(real.some(value => /\b(?:max-content|fit-content|min-content)\b/.test(value)), 'the real sheet is already content-sized — the negative control is not proving anything').toBe(false)
  })
})

/** Which pages actually carry a search field, as the markup reports. */
function fieldPresence(markups: readonly { page: Page; field: string }[]): Page[] {
  return markups.filter(markup => markup.field.includes('type="text"') || /aria-label/.test(markup.field)).map(markup => markup.page)
}

/**
 * WHAT A `--dsh-tb-*` ALIAS ACTUALLY RESOLVES TO, through both layers.
 *
 * The alias layer maps the plugin's own name onto a host `--dsw-*` name, and the
 * host is the one that gives it a colour. Reading only the first layer is how a
 * check can pass on a token whose value is 58% opaque: the NAME was right and
 * the plate was still text over text. So this follows the name all the way to a
 * colour, and returns `''` when the chain is broken — which the caller has to
 * treat as 「cannot vouch for it」 rather than as 「fine」.
 */
function tokenValueOf(name: string): string {
  const alias = new RegExp(`${name}\\s*:\\s*([^;]+)`).exec(aliasLayer())?.[1]?.trim() ?? ''
  const host = /var\((--dsw-[\w-]+)\)/.exec(alias)?.[1]
  if (host === undefined) return ''
  const value = new RegExp(`${host}\\s*:\\s*([^;]+)`).exec(hostTokens().css)?.[1]?.trim() ?? ''
  return value
}

/**
 * THE ALPHA OF A COLOUR, 0..1, and `1` for anything it cannot read.
 *
 * `1` is the safe default and it is deliberate: a colour this cannot parse is
 * something the host has written in a form this file has not been taught, and
 * answering 「opaque」 for an unknown form means a new notation cannot quietly make
 * every floating surface readable. The three forms actually used by the host are
 * handled, and a four-digit hex is treated as opaque for the same reason a
 * six-digit one is.
 */
function alphaOf(colour: string): number {
  const hex = /^#([0-9a-f]{6,8})$/i.exec(colour)?.[1]
  if (hex !== undefined) {
    // 8 digits carry alpha in the last byte; 6 carry none; a 3-digit shorthand
    // would need expanding to compare and is not used by this host's surfaces.
    return hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1
  }
  const slash = /^rgba?\([^)]*?[/,]\s*([\d.]+%?)\s*\)$/i.exec(colour)?.[1]
  if (slash !== undefined) return slash.endsWith('%') ? Number.parseFloat(slash) / 100 : Number.parseFloat(slash)
  return 1
}

describe('a phone gets the same surface, only narrower', () => {
  const css = panelCss()

  it('a segmented control on this surface is allowed to give way', () => {
    // The measured failure: the sort control rendered two of its options and
    // the rest ran off the right edge of a 390px screen with no wrap, no scroll
    // and nothing to reach. A segmented control that neither wraps nor scrolls
    // does not "shorten" itself — it CLIPS, and hard rule 11 forbids a phone
    // being a lesser citizen by way of a hidden control.
    //
    // THE CONTROL IS SHARED WITH THE BOARD, SO THE GATE READS WHAT APPLIES TO
    // THIS SURFACE rather than what the shared sheet says on its own. There are
    // two ways to give the control the ability to give way: fix the shared
    // rule, or grant the ability from the surface that renders it. The second
    // is the better one here — the board's own rail is not the thing that
    // overflowed, and a fix in the shared sheet would restyle a surface nobody
    // reported a problem with. Demanding the FIRST would make the cheapest way
    // to pass be to edit somebody else's sheet.
    //
    // So: every rule that applies to a segmented control RENDERED BY THIS
    // SURFACE is read — the shared one and any rule on this surface that names
    // the class the panel puts on it — and the union has to permit giving way.
    const shared = rulesOf(designCss(), 'segmentedRow')
    expect(shared.length, 'the shared segmented control has no rule — the gate is reading a control that does not exist').toBeGreaterThan(0)
    // The classes this surface puts on a segmented control, discovered from the
    // markup rather than named here, so a rename moves the gate with the code.
    // It has to read the palette, not `filter-bar.tsx`, which is retired: the filter
    // faces and the orders are in the command palette, and the batch door is an
    // action in it.
    const panel = readFileSync(new URL('../src/client/item/panel.tsx', import.meta.url), 'utf8')
    const palette = readFileSync(new URL('../src/client/item/command-palette.tsx', import.meta.url), 'utf8')
    const members = [...cssMembersOf(panel).keys(), ...cssMembersOf(palette).keys()]
      .filter(member => /Facet|Statebar/i.test(member))
      .map(member => member.charAt(0).toLowerCase() + member.slice(1))
    const grants = members.flatMap(member => rulesOf(css, member))
    expect(grants.length + shared.length, 'neither the shared control nor this surface says anything about how the filter band lays out').toBeGreaterThan(0)
    // The union: at least one of the rules that apply must let the control wrap
    // or scroll. This is a positive about the SURFACE'S ABILITY, not a demand
    // that the shared rule alone carry it.
    const capable = [...shared, ...grants].some(givesWay)
    expect(capable, 'no rule that applies to this surface\'s segmented control lets it wrap or scroll — at 390px it clips the options it cannot fit, and a clipped control is a hidden control').toBe(true)
    // And the control, on the three shapes it must tell apart.
    expect(givesWay('.x { flex-wrap: wrap; }')).toBe(true)
    expect(givesWay('.x { overflow-x: auto; }')).toBe(true)
    expect(givesWay('.x { white-space: normal; }')).toBe(true)
    expect(givesWay('.x { display: inline-flex; }')).toBe(false)
  })

  it('the probe bites: nowrap with no scroll is exactly the reported failure', () => {
    const plantedShared = '.segmentedRow {\n  display: inline-flex;\n  white-space: nowrap;\n}\n'
    expect(givesWay(plantedShared), 'the probe did not bite — the gate cannot tell a clipped control from a giving one').toBe(false)
    expect(givesWay('.segmentedRow {\n  display: inline-flex;\n  flex-wrap: wrap;\n}\n')).toBe(true)
    // The direction lead ruled on, proved as a CAPABILITY rather than as a
    // preference: the surface's own rule satisfies the gate, the shared sheet
    // is untouched, and the reported failure shape still does not pass. A gate
    // that only the shared sheet could satisfy would make the cheapest way to
    // pass be to edit somebody else's sheet.
    const surfaceRule = '.itemFilterWide {\n  display: flex;\n  flex-wrap: wrap;\n}\n'
    expect([plantedShared, surfaceRule].some(givesWay), 'a surface-scoped grant was not accepted').toBe(true)
    expect(givesWay(plantedShared), 'the shared rule alone passed, so the union is not doing any work').toBe(false)
  })
})

describe('a status is stated once, and it is a column rather than a heading', () => {
  const css = panelCss()
  const listPage = readFileSync(new URL('../src/client/item/pages/list.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  it('the list page draws no bucket and no bucket summary, so a status cannot be stated twice', () => {
    // THE DEFECT THIS GATE EXISTS FOR, in one sentence: a status as a GROUP — a
    // heading with a fold arrow and a count — is ALSO the row's own mark, and ALSO
    // the name on the 「进行中 0 · 受阻 0 · 已完成 0」 summary of the buckets that
    // happen to be empty. One fact, three places, and a reader cannot tell which of
    // the three is telling the truth about the list in front of them.
    //
    // So the status is a COLUMN, and the rule is the simple one: there is exactly
    // one place on the page that says what a row's state is, and it is the cell.
    // The gate is a negative on the MARKUP rather than a count on the stylesheet,
    // because 「the group is back」 is a fact about what gets rendered, and a
    // stylesheet can hold a rule for a class nothing renders — which is how a count
    // on the stylesheet can sit green over a page it cannot see.
    // The status buckets are gone, and the claim is stated the way the page says
    // it: the table is handed ONE flattened list, and the only section left on the
    // page is the archive's — which is a heading for the ARCHIVE, not for a
    // status, and a reader who opens 「已删除」 is answering a different question.
    //
    // Banning `itemGroupHead` outright would ban the archive's heading too — and a
    // gate that cannot tell the two apart pushes the next author to delete the
    // archive's heading as well, which is the shape of a check that has stopped
    // being about its claim.
    expect(listPage, 'the list page does not hand the table one flat list, so the status buckets are back as sections')
      .toMatch(/flatMap\([^)]*slice[^)]*\.items/)
    const sections = [...listPage.matchAll(/<section\b[^>]*>/g)].length
    expect(sections, `the list page wraps ${sections} things in a section — one of them is a status bucket again, and the only one that may keep a heading is the archive`)
      .toBe(1)
    expect(listPage, 'the one section that is left is not the archive, so something without a name is wearing a heading')
      .toMatch(/item\.archive\.title/)
    expect(listPage, 'the list page renders the empty-bucket summary again, so 「进行中」 is a heading, a row mark and a zero')
      .not.toMatch(/itemEmptyGroup/)

    // AND THE COLUMN IS REAL, so the gate is not satisfied by deleting the
    // status off the page entirely. A status the reader cannot see is not a
    // second answer — it is no answer. **READ FROM THE ROW, NOT FROM THE PAGE**:
    // the cell is drawn by the row and the page only hands it rows, so asking the
    // page's own text about it asks the wrong file and reports the column missing
    // while the column is right there in the other file.
    const rowFile = readFileSync(new URL('../src/client/item/row-line.tsx', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    // FOUR SHAPES, NOT FOUR WORDS. The row's lead mark IS the status now — the word
    // moved off the row entirely — so the promise is that each state draws a different
    // shape, readable with the colour taken away.
    expect(rowFile, 'no component draws a state mark, so a row says nothing about where it stands')
      .toMatch(/itemRowLead/)
    const mark = rulesOf(css, 'itemRowLead').join('\n')
    expect(mark, 'there is no .itemRowLead rule — the state mark is drawn by no rule').not.toBe('')
    // Chosen by an ATTRIBUTE, so the class-name reader cannot see these rules — and
    // the point of the check is that each state has ink of its own.
    for (const status of ['inProgress', 'blocked']) {
      const rule = new RegExp(`\\.itemRow\\[data-status='${status}'\\][^{]*\\{[^}]*color\\s*:`).exec(css)
      expect(rule, `the ${status} state has no ink of its own — two states would draw the same mark`).not.toBeNull()
    }
  })

  it('the day header is a filled shape, not a heading floating on air alone', () => {
    // THE OPPOSITE PROMISE, AND A REAL ONE. The table head this replaced floated
    // over rows and needed a rule to separate; a day header does not float — it is
    // a pill with its own ground and its own air — so a rule on it would draw a
    // second edge around a shape that already has one.
    //
    // Judged by DECLARATION, never by looking at a capture: at the width the
    // captures are taken a 4% tint can fall below the visible threshold, so
    // 「I could not see it in the PNG」 is not a fact about the code.
    //
    // **两页一枚**：这一枚与日程页的节头是同一个元件（`GroupHead`），所以判据落在
    // `.itemGroupHead` 上——两处各写一条，就是同一个形状有两个判据。
    const head = rulesOf(css, 'itemGroupHead').join('\n')
    expect(head, 'the day header is not in the sheet at all').not.toBe('')
    const draws = /(?:^|[;{\s])border-block-end\s*:\s*([^;]+)/.exec(head)?.[1]?.trim() ?? ''
    expect(['0', 'none'], `the day header draws a rule ("${draws}") around a shape that already has a ground`).not.toContain(draws)
    expect(head, 'the day header has no ground of its own, so it IS a caption floating on air — the failure the rule would have hidden')
      .toMatch(/background(?:-color)?\s*:\s*var\(--item-fill\)/)
  })

  it('and the reader bites, on a sheet that has the defect', () => {
    // The same pair, in the other order: no ground is the defect, and a ground set
    // to nothing is not a ground. Both halves matter — a reader that only looks for
    // the tint reports a header whose background is `transparent` as fine.
    const hasGround = (text: string): boolean => {
      const body = rulesOf(text, 'itemGroupHead').join('\n')
      const value = /(?:^|[;{\s])background(?:-color)?\s*:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? ''
      return value !== '' && !['0', 'none', 'transparent'].includes(value)
    }
    expect(hasGround('.itemGroupHead { background: transparent; }'),
      'a ground set to nothing was counted as a ground, so the gate cannot see the defect it exists for').toBe(false)
    expect(hasGround('.itemGroupHead { padding-block-end: 8px; }'),
      'a header with only air around it was accepted').toBe(false)
    expect(hasGround('.itemGroupHead { background: var(--item-fill); }'),
      'a real ground was not seen — the reader has stopped biting').toBe(true)
  })
})


describe('一行里的记号与字：胶囊居中自己的盒子，几块字共享一条基线', () => {
  const css = stripCssComments(itemSheet())

  it('两个页面共用一枚组头，没有第二份内联实现', () => {
    /* 「一枚记号 + 一个词 + 一个数」曾经在两处各写了一遍（清单页的日分段与日程页的节头）——
       同一个毛病因此在两个页面上长得不一样，而修一处不修另一处。现在两处都读那一枚元件，
       这条闸门看的是**两边都导入了它、而且都没有再内联一份标记**。 */
    const pages = ['src/client/item/pages/schedule.tsx', 'src/client/item/item-table.tsx']
    for (const path of pages) {
      const source = readFileSync(join(repoRoot, path), 'utf8')
      expect(source, `${path} 没有导入那一枚组头`).toContain('group-head.tsx')
      // 一份内联的组头：一个图形后面跟着 `<b>` 与 `<i>`。
      const inline = /<svg[\s\S]{0,300}<b>[\s\S]{0,160}<i/.test(source)
      expect(inline, `${path} 里又内联了一份「记号 + 词 + 数」`).toBe(false)
    }
    // 而这把尺子咬得动：把同一段标记喂给它，它必须报。
    const planted = '<div className={css.itemDayHead}><svg viewBox="0 0 13 13" width="13"></svg><b>{word}</b><i>{n}</i></div>'
    expect(/<svg[\s\S]{0,300}<b>[\s\S]{0,160}<i/.test(planted), '内联的组头被放过了').toBe(true)
  })

  /* ── 这一族只有一条律：**胶囊把装字的盒子居中**，而标记只标记 ─────────────────
   *
   * `data-dsh-tb-pilltext` 是给审计按结构认领用的**纯标记**：它说「这一串是这一格的文字」，
   * 它自己不声明任何属性。它一旦去排版，被改掉的就不只是它自己——装字的盒子换了一个高度，
   * 于是「墨在不在盒心」、胶囊有多高、旁边那枚记号对着哪条线，三件事一起变，而屏上只会表现
   * 为几处各自偏一点。所以这一族**没有按字体量出来的数**：`padding-block-end: 1px` 在一种
   * 字体上量出来是对的，换一套度量就偏半格，而没有任何一处会说这句话。
   *
   * 真判据在 `scripts/probes/probe-item-capsules.js`（`pnpm audit`）：它开真 Chromium 逐颗量墨心、
   * 切割与高度地板，两档宽 × 三档 DPR × 两种指针能力 + 一档换字体。这条闸门管的是另一半
   * ——**机制不许回来**，读的是两张表的结构，注释里提到这些名字不算一次使用（硬性规范 14）。
   */
  /** 标记属性的名字：只写一处，闸门的消息也读它，免得两处对不上。 */
  const MARKER = 'data-dsh-tb-pilltext'
  /** 这一族不许再有的两个令牌：一个给装字的盒子垫底衬，一个给记号垫位移。 */
  const DEAD_TOKENS = ['--item-ink-lift', '--dsh-tb-slot-lift'] as const

  /** 一次读法的三条出口。三条各自成列，因为三条的修法完全不同（删规则 / 删声明 / 删令牌）。 */
  interface MarkerStyling {
    /** 把标记写进**选择器**的规则（选择器原文）。 */
    readonly selectors: readonly string[]
    /** 声明位置上的 `text-box` 那一族属性（属性名，含探测式写法里的那一种）。 */
    readonly boxes: readonly string[]
    /** 表里还留着的死令牌（令牌名）。 */
    readonly tokens: readonly string[]
  }

  /**
   * 一张表里让标记参与排版的三条路子，各读各的。
   *
   * **三条分开报，是因为它们在同一次改动里一起回来**：选择器里的标记是那套机制的入口，
   * `text-box` 是它的手段，两个令牌是它留下的数。只报一个布尔的话，读的人得自己去猜坏在
   * 哪一条，而三处的修法完全不同；只报第一条的话，另外两条会安静地长回来。
   *
   * 注释先剥掉：散文里**提到**一个选择器或一个令牌不是一次使用（硬性规范 14）。这不是
   * 洁癖——两张表都用大段散文解释自己，不剥的话它们会把自己判成有病，而被逼着改的会是
   * 那段解释。
   * @param text - 一张样式表，注释有没有都行。
   * @returns 三条出口各自的发现，全空才是对的。
   */
  const markerStyling = (text: string): MarkerStyling => {
    const live = stripCssComments(text)
    return {
      selectors: declarationRules(live).map(rule => rule.selector).filter(one => one.includes(MARKER)),
      // 读的是**声明位置**（`属性:`），不是「那个词在文件里出现过几次」：`@supports not
      // (text-box: …)` 那种回退式探测也落在这一条里，而它正是那套机制的伴生写法。
      boxes: [...live.matchAll(/(?:^|[;{\s(])(text-box(?:-trim|-edge)?)\s*:/g)].map(one => one[1] as string),
      tokens: DEAD_TOKENS.filter(token => live.includes(token)),
    }
  }

  /* 两张表各读一遍。只读一张表，就是让另一张表里的同一套机制随它去——而这两张表里各有一族
     药丸，同一个标记在两边都能被写成排版规则。 */
  const SHEETS = [
    'src/client/board.module.css',
    'src/client/item/item.module.css',
  ].map(path => ({ path, source: readFileSync(join(repoRoot, path), 'utf8') }))

  it('标记只标记、不排版：两张表的三个出口都是空的', () => {
    for (const sheet of SHEETS) {
      // 读空了要说话：一条对空串成立的断言什么都没断言。
      expect(sheet.source, `${sheet.path} 读出来是空的——这条闸门在空转`).not.toBe('')
      // 而「读到 0 条规则」会让三个出口也全空——那是空转，不是干净，两者在报告里长得一模一样。
      expect(declarationRules(stripCssComments(sheet.source)).length,
        `${sheet.path} 一条规则都没读出来——三个出口全空是空转，不是干净`).toBeGreaterThan(1)
      const found = markerStyling(sheet.source)
      expect(found.selectors,
        `${sheet.path} 的选择器里出现 ${MARKER}——标记一参与排版，装字的盒子、胶囊有多高、旁边那枚记号对着哪条线会一起变`).toEqual([])
      expect(found.boxes,
        `${sheet.path} 声明了 ${found.boxes.join('、')}——按字体裁出来的盒子会切掉墨，也会把胶囊压矮`).toEqual([])
      expect(found.tokens,
        `${sheet.path} 里还留着 ${found.tokens.join('、')}——没人读的令牌会让下一个人以为它还在生效`).toEqual([])
    }
  })

  it('而这把尺子咬得动：三条子句各报各的，一条都不许空转', () => {
    /** 一颗病只许由**一条**子句报出来——三条读的是同一件事的三个面，串起来报就说不出坏在哪。 */
    const onlyOne = (found: MarkerStyling, clause: keyof MarkerStyling): readonly string[] => {
      expect(found[clause].length, `种进去的那颗病没有被「${clause}」读出来——这一条子句在空转`).toBeGreaterThan(0)
      for (const other of ['selectors', 'boxes', 'tokens'] as const) {
        if (other === clause) continue
        expect(found[other], `「${clause}」读出来的病被「${other}」顺手也报了一次——两条子句读的是同一件事`).toEqual([])
      }
      return found[clause]
    }
    // 反向对照：一张干净的胶囊规则，三条都是空的——否则这三条读的是「规则」，不是「病」。
    expect(markerStyling('.itemPill { display: inline-flex; align-items: center; }'),
      '一张干净的胶囊规则被读成了有病').toEqual({ selectors: [], boxes: [], tokens: [] })
    // 子句一：标记进了选择器——两个形状，一个是它自己一条规则，一个是「除它之外」那一族规则。
    expect(onlyOne(markerStyling(`.itemPill ${MARKER} { display: block; }`), 'selectors'),
      'the plant did not bite — 选择器里的标记没有被读出来').toHaveLength(1)
    expect(onlyOne(markerStyling(`.itemPill:not(:has(${MARKER})) { padding-block-end: 1px; }`), 'selectors'),
      'the plant did not bite — 「除它之外」那一族的写法没有被读出来').toHaveLength(1)
    // 子句二：那一族属性写在规则体里，以及写在 `@supports not (…)` 的探测里——后者是回退的
    // 写法，一条只读规则体的读法在这里会沉默。
    expect(onlyOne(markerStyling('.itemPill { text-box: trim-both cap alphabetic; }'), 'boxes')).toEqual(['text-box'])
    expect(onlyOne(markerStyling('@supports not (text-box-trim: trim-both) { .itemPill { padding-block-end: 1px; } }'), 'boxes'),
      'the plant did not bite — 回退探测里的那一族属性没有被读出来').toEqual(['text-box-trim'])
    // 子句三：两个死令牌各来一颗。
    expect(onlyOne(markerStyling('.itemPill { padding-block-end: var(--item-ink-lift); }'), 'tokens')).toEqual(['--item-ink-lift'])
    expect(onlyOne(markerStyling('.itemPill { margin-block-start: var(--dsh-tb-slot-lift); }'), 'tokens')).toEqual(['--dsh-tb-slot-lift'])
    // 反向对照第二半：**注释里提到那些名字不算一次使用**。两张真表就是这么写的（各自用一段
    // 散文说「这个标记不排版」），先剥注释的那条读法必须放它们过去。
    expect(markerStyling(
      `/* ${MARKER} 是纯标记，不排版；这里也没有 --item-ink-lift 那种按字体量出来的数 */\n.itemPill { display: inline-flex; }`),
      '散文里提到标记或令牌，被判成了一次使用——被逼着改的会是那段解释').toEqual({ selectors: [], boxes: [], tokens: [] })
  })

  /* 下面一条读法各写**一处**、被两个断言读：一次读真表（契约），一次读种了病的
     表（证明这契约破得掉）。读法内联在断言里，就只能永远同意自己。
     读法本身是共享的 `lastDeclaredOf`（「这个类**最终**是什么值」——读最后一条声明，
     不是「曾经写过」），所以这里不再包一层只服务于一种对齐值的壳子。 */
  /** `.itemNote` 的揭示钩子数——**读结构，不读钩子叫什么名字**：凡是选择器指着它、
      又把 `display` 打开的规则，就是一个入口（第三个入口换了名字也一样数得进来）。 */
  const noteReveals = (text: string): number =>
    declarationRules(text).filter(rule =>
      /\.itemNote(?![\w-])/.test(rule.selector) && /display:\s*block/.test(rule.body)).length
  /** `.itemNote` 平时收着吗：它的规则里有一条 `display: none`。默认值是**基础规则**
      说的那一个，所以这里读的是「有没有这样一条」，不是「最后一条是什么」。 */
  const noteHidden = (text: string): boolean => /display:\s*none/.test(rulesOf(text, 'itemNote').join('\n'))

  it('几块字**每段各自居中**，于是墨心齐平（不是靠基线共线）', () => {
    /* 这条用例的**意图**一直没变：一枚药丸里两种字（中文的词、拉丁的数字）的墨心必须
       齐平。变的是**机制**，而旧机制是错的——`align-items: baseline` 对齐的是「字的底」，
       而眼睛看的是「墨的中心」：汉字一个 em 的墨几乎全在基线之上（`inkAscent ≈ 0.88em`），
       拉丁数字只占上面约 `0.71em`，所以同一条基线上汉字天生偏高。
       量过（`scripts/probes/probe-text-runs.js`，同一枚组头，词 13px / 数 12px）：
         baseline   → 词 0.5 / 数 1.0（相差 0.5）
         各段居中   → 词 0.5 / 数 0.5（相差 0）
       所以判据是两件事：容器 `align-items: center`，且**每一段自己的行盒等于自己的字号**
    for (const name of ['itemGroupText', 'itemRailRow', 'itemEmptyGroup']) {
       `align-items`，少了它这一段就还是跟着父级的行盒走。 */
    for (const name of ['itemGroupText', 'itemRailRow', 'itemEmptyGroup']) {
      expect(lastDeclaredOf(css, name, 'align-items'), `.${name} 没有按内容盒居中，两段字的墨心要靠运气`)
        .toBe('center')
    }
    expect(css, 'itemGroupText 的段没有自己的行盒，1em 就不会按字号解析')
      // **两种写法都是同一条法则**：字面 `1em`，或者令牌 `--dsh-tb-text-line-h`
      // （它就是 `1em`）。判据读「这一段有没有自己的行盒」，不读那一个数怎么写——
      // `scripts/verify-capsule-centring.mjs` 也按这两族一起认。
      .toMatch(/\.itemGroupText > \*\s*\{[\s\S]{0,200}?line-height:\s*(?:1em|var\(--dsh-tb-text-line-h\))/)
  })

  it('而这把尺子咬得动：把其中一处改回基线共线，它就报', () => {
    /* 种在真表后面的一条同名规则——浏览器就是这么读的（后写的赢），所以读法也这么读。
       种的是**旧机制**（`align-items: baseline`）：那正是这条用例在防的那件事——有人
       出于好意把它「改回统一基线」，于是中文又比数字高半像素，而屏上不会有人说一句话。 */
    const planted = `${css}\n.itemEmptyGroup {\n  align-items: baseline;\n}\n`
    expect(lastDeclaredOf(planted, 'itemEmptyGroup', 'align-items'), 'the plant did not bite — 后写的规则没有改变读数').toBe('baseline')
    // 反向对照：同一张表里另外两处不受影响，说明报的不是「谁都不对齐」。
    expect(lastDeclaredOf(planted, 'itemGroupText', 'align-items')).toBe('center')
    expect(lastDeclaredOf(planted, 'itemRailRow', 'align-items')).toBe('center')
    expect(lastDeclaredOf(css, 'itemEmptyGroup', 'align-items'), '真表里那一处被读成基线了——尺子量错了地方').toBe('center')
  })

  it('运行配置那一行：头那一行与 ⓘ 同在一格行里，折叠体在下一行', () => {
    /* **这一行付过的账。** 头与折叠体焊在同一个 `Disclosure` 里，所以「一枚 ⓘ 站在头那一行末尾」
       要靠盒树说：行是网格（`align-items: center`），中间那两层盒子不画（`display: contents`），
       于是按钮与折叠体各自是一格，而 ⓘ 与头那一行同在**第 1 行**。改回一条普通行时，交叉轴尺寸
       由那一整块给，展开之后 ⓘ 会落到正文中间去（量过：233.5px）。 */
    /* 一条**选择器逐字相等**的规则体：`rulesOf` 读的是前缀，`.itemRunConfigHeadRow` 也会匹配到
       它那几条后代规则（`> section` / `> .itemGroupWhy`），于是「那一行自己声明了什么」会被
       最后一条后代规则答掉。 */
    const ownRule = (selector: string): string =>
      declarationRules(css)
        .filter(rule => rule.selector.split(',').map(one => one.trim()).includes(selector))
        .map(rule => rule.body).join('\n')
    const headRow = ownRule('.itemRunConfigHeadRow')
    expect(headRow, '它是空的：这一行自己没有任何声明').not.toBe('')
    expect(/display:\s*grid/.test(headRow), '那一行不再是网格——ⓘ 与它左边那串字不再共处一格行').toBe(true)
    expect(/align-items:\s*center/.test(headRow), '那一行不再按中线对齐，记号得自己算位置').toBe(true)
    expect(/grid-template-columns:/.test(headRow), '那一行没有两列：折叠体与 ⓘ 抢同一格').toBe(true)
    expect(/row-gap:/.test(headRow), '头那一行与折叠体之间没有那一档空气了').toBe(true)
    // 中间那两层盒子不画，否则按钮与折叠体落不到各自的格子里。
    expect(ownRule('.itemRunConfigHeadRow > section'), '那一层 `<section>` 又被画出来了：网格里只剩它一格')
      .toMatch(/display:\s*contents/)
    expect(ownRule('.itemRunConfigHeadRow > .itemGroupWhy'), 'ⓘ 不在头那一行那一格')
      .toMatch(/grid-area:\s*1\s*\/\s*2/)
    /* **那一行不许再套一层盒子。** 包一层再把它 `display: contents` 掉，与不包是同一条律的两种写法；
       而这一行只剩一条：DOM 就是网格的子项（组件那边读的是这一条）。注释先剥掉再匹配（规范 14）：
       一句**提到**那个类名的说明不是一个实现。 */
    const strip = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(strip(readSource('client/item/run-config-block.tsx')),
      '那一行又套上了一层盒子——头那一行与折叠体落不到各自的格子里')
      .not.toContain('itemRunConfigHeadText')
    expect(css, '样式表里还留着那一层盒子的类（孤儿类）').not.toContain('itemRunConfigHeadText')
  })

  it('说明小字的行长按物理行长给：`ch` 不是中文的尺子', () => {
    /* **`ch` 量的是「0」的宽度，不是汉字的宽度。** 在 12px 下 `46ch` 只有 297.56px——约 23 个
       汉字，而这一页最长的那几句有 43 个字（量出来的单行宽 516px，加上让出左沿的 16px 是
       532px）：必然折两行，而右边留一大片空。所以限宽读一枚**声明在令牌层**的行长，单位是
       `em`（中文一个字一个 em），那个数说的才是「一行放得下几个字」。 */
    const limit = lastDeclaredOf(css, 'itemNote', 'max-inline-size')
    expect(limit, '说明的限宽不再是那一枚令牌——下一个改的人会在两个数之间挑一个')
      .toBe('var(--item-note-measure)')
    const declared = declaredOf(css, 'itemRoot', '--item-note-measure')
    expect(declared, '那一枚行长没有在令牌层声明一次——读它的规则会整条失效').toHaveLength(1)
    expect(declared[0], '行长又写成字符数了：`ch` / `ex` 量的是「0」和「x」的宽，不是汉字的宽')
      .toMatch(/^\d+(?:\.\d+)?em$/)
    // 咬得动：写回 `ch` 的那一版必须被读出来。
    expect(lastDeclaredOf(`${css}\n.itemNote { max-inline-size: 46ch; }`, 'itemNote', 'max-inline-size'))
      .toBe('46ch')
  })

  it('说明平时不显示，而揭示它的只有两个钩子', () => {
    // 三句话常驻在屏上就是一面文字墙；而收起来必须有一个**看得见**的入口（触屏没有悬停，
    // 必要的信息不许只挂在 `title=` 上）。所以平时 `display: none`，开着由两个属性钩子说：
    // `data-note`（按下/聚焦，真开）与 `data-note-hover`（指着那件东西时偷看）。
    expect(noteHidden(css), '.itemNote 平时是显示着的——文字墙又回来了').toBe(true)
    expect(noteReveals(css), '揭示说明的钩子不止两个（或者一个都没有）——多一个就是多一套副路径').toBe(2)
  })

  it('而这把尺子也咬得动：第三个钩子、或者没钩子，它都报', () => {
    // 第三个入口可以叫任何名字：读法看的是"谁把它打开"，不是钩子叫什么。
    expect(noteReveals(`${css}\n[data-note-elsewhere] .itemNote {\n  display: block;\n}\n`),
      'the plant did not bite — 多出来的入口没有被数进去').toBe(3)
    expect(noteReveals('.itemNote { display: none; }'),
      'the plant did not bite — 一个入口都没有时它也报 2，说明它数的不是入口').toBe(0)
    expect(noteHidden('.itemNote { display: block; }'),
      'the plant did not bite — 常驻显示的说明被读成了收着的').toBe(false)
    expect(noteHidden(css), '真表里那份说明也读成没收起来——尺子量错了地方').toBe(true)
  })
})

describe('the type scale is a scale, and not a pile of near-identical sizes', () => {
  const css = panelCss()
  /* **每一块内容的名字，一处定义、两条判据读**：这条是「它声明了自己的 margin 与字号
     吗」，下面那条探针是「这份读者咬不咬得动」。名单各写一份，就是探针在测另一个名字
     ——而它会永远绿。 */
  const HEADINGS = ['itemGroupHead'] as const

  it('the panel uses a closed set of sizes, and each size carries only its own weights', () => {
    // NEAR-MISSING SIZES ARE THE THING. A 12px label against a 13px body and a
    // 14px row title gives the page one flat tone: the reader cannot tell a
    // heading from a fact from a hint, and everything is equally neither.
    //
    // The weight table is the design's, stated whole rather than as a count,
    // because a count cannot tell the difference between "this size has two
    // weights and they are the right two" and "this size has two weights and
    // one of them is 700". A rule that sets a size without a weight INHERITS
    // 400, so it is read as 400 — which is why 16px is allowed only 600: a
    // heading that silently fell back to body weight is the exact failure the
    // table exists to prevent.
    //
    // THE SCALE SEPARATES BY STEP, NOT BY COUNT. Six NEIGHBOURING sizes
    // (11/12/13/14/15/16) put 14 between 13 and 15 — exactly the near-miss the
    // paragraph above is about: a reader cannot see a step that small, so six
    // numbers buy two or three visible levels.
    //
    // The panel's constitution says 「字靠字重分四层，不靠字号堆」 — the levels
    // separate by WEIGHT and by how much ink is left in them, and the sizes that
    // survive are the ones far enough apart to be read on their own. So: two big
    // numbers at 700, one title at 600, one body line at 400, and the two small
    // labels at 600.
    //
    // READ OFF THE SHEET, NOT INVENTED: this table is what the stylesheet
    // actually declares, checked by the assertion below it.
    const TABLE: Readonly<Record<number, readonly number[]>> = {
      28: [700], 26: [700], 15: [600], 13: [400, 600], 12: [400, 600], 11: [400, 600],
    }
    const bySize = new Map<number, Set<number>>()
    // THE LIST'S OWN SHEET, AND ONLY IT. The board's sheet holds a Markdown
    // renderer's 12.5px / 15px / 17px headings, and this panel does not import
    // the renderer, so those sizes are not reachable from this surface — the
    // same scoping rule the token-coverage check already uses. A gate that
    // spans both sheets reports a fact about a component this page never draws,
    // and the only way to make it green is to break the board's headings.
    for (const rule of declarationRules(stripCssComments(itemSheet()))) {
      const size = /(?:^|[;{\s])font-size\s*:\s*([\d.]+)px/.exec(rule.body)?.[1]
      if (size === undefined) continue
      const weight = Number(/(?:^|[;{\s])font-weight\s*:\s*(\d+)/.exec(rule.body)?.[1] ?? 400)
      if (!bySize.has(Number(size))) bySize.set(Number(size), new Set())
      bySize.get(Number(size))?.add(weight)
    }
    const sizes = [...bySize.keys()].sort((a, b) => a - b)
    expect(sizes.length, 'no font-size was read at all — the gate is asserting nothing').toBeGreaterThan(1)
    const stray = sizes.filter(size => TABLE[size] === undefined)
    expect(stray, `sizes outside the scale: ${stray.join(', ')}px — a near-miss reads as no hierarchy at all`).toEqual([])
    const offTable = [...bySize.entries()]
      .filter(([size]) => TABLE[size] !== undefined)
      .flatMap(([size, weights]) => [...weights].filter(weight => !(TABLE[size] ?? []).includes(weight)).map(weight => `${size}px w${weight}`))
    expect(offTable, `weights the table does not allow at their size: ${offTable.join(', ')}`).toEqual([])
  })

  it('every heading in this sheet declares its own margin and size, because nothing resets the UA ones', () => {
    // THE FAILURE NOBODY CAN SEE: a heading louder than the page.
    //
    // This sheet has NO `h1`–`h6` reset. `board.module.css` resets `p` and
    // nothing else, so a `<h2>` in this panel arrives carrying the user agent's
    // `font-size: 1.5em; font-weight: bold; margin: .83em 0` — 19.5px to 24px of
    // BOLD, against a 16px page title. A heading like that is the loudest type in
    // the column, which is the one thing a column's heading is not allowed to be,
    // and every other assertion in this file is green about it: the type-scale check
    // reads DECLARED sizes and this heading declares none, so the scale has nothing
    // to say — and a 19.5px inherited size is not a "size outside the scale", it is
    // the absence of a declaration.
    //
    // So the claim is about the DECLARATION, not the computed value: a heading
    // that says its own `margin: 0` and its own `font-size` is a heading this
    // sheet is in charge of. `margin` is in the claim for the same reason — the
    // UA's `.83em` is a margin nobody chose, and it is the reason an empty
    // heading with a bottom border reads as a page that failed to finish loading.
    // TWO, NOT THREE. `.itemDetailHead` went with the five sections the detail used
    // to have; what names a group of rows now is a section CAPTION.
    // **而议程那一页现在只有一种节头。** 上一版有三种（日节 15/600 无底线、门与托盘
    // 13/600 带发丝线、说明是一枚 11px 的回执胶囊），读者读到的不是「几种节」，是同一页
    // 上几个不一样的东西。所以名单从两个名字收成一个 `.itemAgendaHead`——判据本身没变：
    // 一个 `<h2>` 不声明自己的 margin 与字号，就是 UA 在排版它。
    //
    // **两处读法跟着表走。** ① 一枚药丸现在是**一条选择器列表**里的一个成员
    // （`.itemGroupHead, .itemEmptyGroups`——同一族只写一次），所以规则按「列表里有它」
    // 找，而不是按「选择器恰好等于它」找；② 字号可以是一个**字阶令牌**
    // （`var(--dsh-tb-type-body-size)`）。第二条是硬性规范 14 的那一面：字号搬进令牌层
    // 之后，一个只认 `px` 的读法会逼着表把令牌抄回像素——而它抄的那一份正是会漂的那份。
    const sizesItsOwnType = (body: string): boolean =>
      /(?:^|[;{\s])font-size\s*:\s*(?:[\d.]+px|var\(--dsh-tb-type-[\w-]+\))/
        .test(body)
    const ruleFor = (rules: readonly { selector: string; body: string }[], name: string): { selector: string; body: string } | undefined =>
      rules.find(entry => entry.selector.split(',').map(one => one.replace(/\s+/g, ' ').trim()).includes(`.${name}`))
    const rules = declarationRules(stripCssComments(itemSheet()))
    for (const name of HEADINGS) {
      const rule = ruleFor(rules, name)
      expect(rule, `.${name} has no rule at all, so the heading it styles is the user agent's`).not.toBeUndefined()
      expect(
        /(?:^|[;{\s])margin\s*:\s*0(?:;|\s|$)/m.test(rule?.body ?? ''),
        `.${name} does not declare its own margin — it inherits the UA's .83em, which is nobody's choice`,
      ).toBe(true)
      expect(
        sizesItsOwnType(rule?.body ?? ''),
        `.${name} declares no font-size, so it renders at the UA's 1.5em — 19.5px of bold above a 16px page title`,
      ).toBe(true)
    }
  })

  it('a rule that sets a weight also sets a size, so 12px does not grow a third weight', () => {
    // The same mechanism, one declaration away, and it is how the same defect
    // arrives without an `<h2>`. A rule that declares `font-weight: 500` and no
    // `font-size` inherits whatever size it lands on — usually 12px — and so
    // creates a weight the scale's table for that size never approved. The
    // 12px/500 combination is the reason a label read as a third tone on a page
    // that has two.
    //
    // READ AS A PAIR, and the reading is deliberately a pair: a detector that
    // asked only 「is there a font-weight」 would flag every heading in the sheet,
    // and one that asked only 「is there a font-size」 would pass the defect. The
    // question is whether the rule knows what size it is bold AT.
    //
    // **400 IS EXEMPT, AND THAT EXEMPTION IS THE POINT.** A rule may write
    // `font-weight: 400` to UNDO an inherited or user-agent weight — a `<button>`
    // resetting the platform's default, a control returning to body weight — and
    // such a rule changes nothing about how anything renders: 400 is what the
    // text would have been anyway. Demanding a `font-size` beside it would force
    // a stylesheet to pin a size in order to say 「nothing」, which is a size
    // copied into a second place and free to drift from the one it duplicates.
    // What this gate is about is a weight that INVENTS a tone, and 400 invents
    // nothing. The table above is where 400 is allowed or not; this is where it
    // is asked to mean something.
    const offenders: string[] = []
    for (const rule of declarationRules(stripCssComments(itemSheet()))) {
      const weight = /(?:^|[;{\s])font-weight\s*:\s*(\d+)/.exec(rule.body)?.[1]
      if (weight === undefined || weight === '400') continue
      if (!/(?:^|[;{\s])font-size\s*:/.test(rule.body)) offenders.push(`${rule.selector} (w${weight})`)
    }
    expect(
      offenders,
      `these rules set a weight without saying what size it is at, so each one invents a tone the scale never approved: ${offenders.join(' | ')}`,
    ).toEqual([])
  })

  it('the probe bites: a heading that inherits the UA, and a weight with no size', () => {
    // THE SAME READER the two gates above use, run over a planted sheet. A
    // control written as a second copy of the detector tests the copy, and a
    // copy drifts from its original the first time the original is fixed — which
    // is how a probe ends up green over a gate that cannot fail.
    //
    // Four shapes: a heading that declares a size but not a margin; one that
    // declares neither; a weight with no size; and a rule that is entirely
    // correct. The last one matters most — a reader that reports a correct sheet
    // as broken gets its gate deleted by the next reader, and the defect it was
    // built for comes back with it.
    const reads = (source: string): { headings: string[]; unanchoredWeights: string[] } => {
      // SETS, NOT LISTS. The reader walks RULES, so a class with two rules in the
      // plant was pushed twice — and a test written around that accident is a test
      // shaped by a reader's slip. 「which headings」 has one answer per selector.
      //
      // AND A RULE MAY NAME SEVERAL SELECTORS. The pill family is written once
      // (`.itemGroupHead, .itemEmptyGroups`), so "the rule that styles this heading"
      // is the rule whose SELECTOR LIST contains it — reading only an exact match
      // reports the heading as unstyled. A font-size is a declaration whether it is
      // `14px` or `var(--dsh-tb-type-body-size)`; the second one is where the type
      // scale now lives.
      const headings = new Set<string>()
      const unanchoredWeights = new Set<string>()
      for (const rule of declarationRules(source)) {
        const names = rule.selector.split(',').map(one => one.replace(/\s+/g, ' ').trim())
        const isHeading = names.some(one => HEADINGS.includes(one.replace(/^\./, '') as typeof HEADINGS[number]))
        const hasSize = /(?:^|[;{\s])font-size\s*:\s*(?:[\d.]+px|var\(--dsh-tb-type-[\w-]+\))/.test(rule.body)
        if (isHeading && (!/(?:^|[;{\s])margin\s*:\s*0(?:;|\s|$)/m.test(rule.body) || !hasSize)) {
          headings.add(rule.selector)
        }
        const weight = /(?:^|[;{\s])font-weight\s*:\s*(\d+)/.exec(rule.body)?.[1]
        if (weight !== undefined && weight !== '400' && !/(?:^|[;{\s])font-size\s*:/.test(rule.body)) {
          unanchoredWeights.add(rule.selector)
        }
      }
      return { headings: [...headings], unanchoredWeights: [...unanchoredWeights] }
    }
    /* 种在 `tests/` 里的是**同一份名单**上的名字，而不是另抄一份：名单换了名字而这里
       不改，探针就变成了「一个不可能匹配的名字」，
       于是它永远咬不动——而那正是这一条自测存在的理由。 */
    const planted = reads([
      '.itemGroupHead { font-size: 14px; font-weight: 600; }',
      '.itemGroupHead { font-weight: 600; margin: 8px 0; }',
      '.itemGroupHead { font-weight: 600; }',
      '.itemTopBarLabel { font-weight: 500; }',
      '.itemRailCaption { font-size: 12px; margin: 4px 0; }',
      '.itemRecentRowMain { font-family: inherit; font-weight: 400; }',
    ].join('\n'))
    expect(planted.headings, 'the probe did not bite — a heading inheriting the UA is invisible to this reader').toEqual([
      '.itemGroupHead',
    ])
    // `.itemRecentRowMain` is in the plant ON PURPOSE: it is a `<button>` writing
    // 400 to undo the platform's own weight, which renders identically to saying
    // nothing. A reader that reported it would force a size into a rule whose
    // whole content is 「nothing», and that size would then be a second copy of
    // one declared elsewhere.
    expect(planted.unanchoredWeights, 'the probe did not bite — a weight that invents a tone is invisible to this reader')
      .toEqual(['.itemGroupHead', '.itemTopBarLabel'])
    const clean = reads('.itemGroupHead { margin: 0; font-size: 14px; font-weight: 600; }')
    expect(clean.headings, 'the reader reports a correct heading as broken — its gate would get deleted, and the defect would come back with it').toEqual([])
    expect(clean.unanchoredWeights, 'the reader reports a correctly anchored weight as broken').toEqual([])
  })

  it('a box that declares an inline-size container is never content-sized on the inline axis', () => {
    // THE WORST FAILURE IN THIS FILE'S FAMILY, and it is worth writing the whole
    // argument out, because no assertion about the markup or the sheet's colours
    // can see it.
    //
    // A box that declares `container-type: inline-size` gets inline-size
    // containment, which makes its inline size INDEPENDENT of its contents. So the
    // one way such a box can still learn how wide it is, is to be told: an explicit
    // inline size, or the cross-axis stretch that its parent would otherwise give
    // it. Remove both — and `align-self: start` on a column flex item removes the
    // stretch, because in a column the cross axis IS the inline one — and the box
    // computes to ZERO WIDTH, and everything inside it lays out in zero width and
    // paints nothing.
    //
    // That is the shape of the failure at `.itemDetailPane`: it can read its width
    // from neither its contents nor the track, so it computes to zero — and it
    // draws its head and its rule and then eight hundred pixels of nothing, while
    // the markup is present, `flex` is a sensible value, every computed colour is
    // right, and every assertion in the suite is green. **Nothing that reads a
    // stylesheet or a markup string can see a box that is the right height and the
    // wrong width** — so the check has to be about the DECLARATION, and the probe
    // has to plant exactly the pair of declarations that causes it.
    const CONTENT_SIZED_IN_INLINE_AXIS = /align-self\s*:\s*(?:start|flex-start)/
    // The same guard the triage loop below carries: an absent subject iterates
    // zero times, and the box that computes to zero width is exactly the one a
    // renamed selector hides.
    // **The claim is about the box that carries the detail's container, not about a
    // name.** A name would be wrong in both directions: `.itemDetailPane` is the box
    // today, and pinning `.itemDetailInner` passes this gate on a sheet with no such
    // rule at all — which is the failure it exists to catch: a container with no
    // width computes to zero and the pane paints nothing, and no capture shows it.
    const inner = rulesOf(css, 'itemOpenMain').filter(body => /grid-template-columns/.test(body))
    expect(inner, 'no rule lays the detail out — its width would come from neither its contents nor a track, and it would paint nothing').not.toEqual([])
    for (const body of inner) {
      expect(
        CONTENT_SIZED_IN_INLINE_AXIS.test(body) && !/inline-size\s*:\s*(?!0)/.test(body),
        '.itemDetailPane is align-self: start AND container-type: inline-size AND has no inline-size of its own, so its width comes from neither its contents nor the stretch — it computes to zero and the whole detail pane paints nothing',
      ).toBe(false)
    }
  })

  it('the probe bites: a content-sized inline container with no width is reported', () => {
    const rule = (body: string): string => `.probeInner {\n${body}\n}\n`
    const bad = rule('  align-self: start;\n  container-type: inline-size;\n  container-name: dsh-tb-item-detail;\n')
    const good = rule('  align-self: start;\n  inline-size: 100%;\n  container-type: inline-size;\n')
    const isBad = (body: string): boolean => /container-type\s*:\s*inline-size/.test(body)
      && CONTENT_SIZED_IN_INLINE_AXIS.test(body)
      && !/inline-size\s*:\s*(?!0)/.test(body)
    expect(isBad(bad), 'the plant did not bite — the detector is not testing the defect').toBe(true)
    expect(isBad(good), 'the detector rejects a correctly sized box, so it is not usable').toBe(false)
  })

  it('a sentence in the triage strip may wrap, and its action is text rather than a pill', () => {
    // TWO THINGS THE STRIP GOT WRONG, and they are the same mistake: the
    // sentence was `nowrap` with an ellipsis, so the longest fact on the page
    // was the one fact that got cut; and the action beside it was drawn as a
    // pill, which makes a sentence's own action louder than the sentence. The
    // action is a TEXT action — no fill, no border, the quietest ink on the row
    // — and the sentence gives way instead of truncating.
    // THE SUBJECT HAS TO EXIST BEFORE IT IS ITERATED. `rulesOf` answers `[]` for
    // a name the sheet has not got — by rename, or by a delete — and a loop over
    // an empty list checks nothing while still reading like a check. That is the
    // shape of failure this file's own gates keep documenting, and the guard is
    // one line: the same one at the fact-line gate above.
    // A STAT LABEL IS A NAME, NOT A SENTENCE, so it stays on one line — and the
    // sentence that must give way instead of truncating moved with it. This used
    // to be the other way round, and the inversion is the finding: the strip it
    // guarded was a sentence carrying the page's longest fact, where a `nowrap`
    // cut the one thing the strip existed to say. A stat card's label is three
    // characters; letting it wrap would only make three cards of different
    // heights, and a ragged row of cards is a worse defect than a short label.
    // The sentence is now `.itemNoMatch` — 「没有匹配的结果。清空搜索或换个筛选看看。」 —
// and THAT is the one that has to wrap.
    // THE THREE NUMBERS MOVED TO THE RAIL, beside the things they count — so the
    // label that must not wrap is the rail's count, and a count that wrapped would
    // put a two-digit number under a one-digit one.
    // THE UNION, NOT EACH RULE. The count has a base rule and a current-row step, and
    // declarations CASCADE — so asking the step to repeat the base's `nowrap` is
    // asking it to restate a fact it does not own, and the answer would be a sheet
    // where the same number is written down four times.
    const labels = rulesOf(css, 'itemRailCount')
    expect(labels, 'there is no .itemRailCount rule — the count below is checking nothing').not.toEqual([])
    const counts = labels.join('\n')
    expect(counts, '.itemRailCount wraps, so a two-digit count sits under a one-digit one').toMatch(/white-space\s*:\s*nowrap/)
    expect(counts, '.itemRailCount does not use tabular figures, so 「10」 jumps when 「9」 becomes 「10」').toMatch(/font-variant-numeric\s*:\s*tabular-nums/)
    const sentences = rulesOf(css, 'itemNoMatch')
    expect(sentences, 'there is no .itemNoMatch rule — the sentence below is checking nothing').not.toEqual([])
    for (const body of sentences) {
      expect(body, '.itemNoMatch refuses to wrap, so the longest sentence on the page is the one that gets cut').not.toMatch(/white-space\s*:\s*nowrap/)
    }
    // AND THE CARD ITSELF IS THE ACTION — not a pill inside it. The top band is
    // three cards and every one of them is a filter, so a reader aims at the CARD.
    // A pill drawn inside would say 「this part is the button」 and put a second
    // target under the first one, which is the arrangement a strip of a sentence
    // with four buttons beside it has, none of them bigger than the sentence they
    // are about.
    // THE CARD IS THE RAIL ROW. The three numbers the reader counts are the rail's
    // own counts, beside the things they count — so what must not be a pill inside a
    // button is the rail row's mark: a reader aims at the ROW.
    const cards = rulesOf(css, 'itemRailRow')
    expect(cards, 'there is no .itemRailRow rule — the row below is checking nothing').not.toEqual([])
    // ONLY THE RULES THAT DECLARE A FILL. A state block that tunes a number
    // carries no background and inherits the card's — demanding one of every
    // block would be asking for a second copy of a declaration, which is how a
    // stylesheet starts saying the same thing twice.
    // A COLUMN OF FILLS IS A COLUMN OF THINGS. The row paints nothing until the
    // reader is on it, so the base is `background: none` and the WASH is on the
    // states — and what has to be checked is that wash, on every rule that paints
    // one.
    const painted = rulesOf(css, 'itemRailRow').filter(body => /(?:^|[;{\s])background(?:-color)?\s*:/.test(body))
      .concat(rulesOf(css, 'itemRailRow:hover'), rulesOf(css, "itemRailRow[aria-current='true']"))
      .filter(body => /(?:^|[;{\s])background(?:-color)?\s*:/.test(body))
    const filled = painted.filter(body => {
      const value = /(?:^|[;{\s])background(?:-color)?\s*:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? ''
      return value !== '' && !['0', 'none', 'transparent'].includes(value)
    })
    expect(filled, 'no .itemRailRow state paints the row wash, so the row is whatever the list under it happens to be').not.toEqual([])
    for (const body of filled) {
      // A RAIL ROW IS NOT A CARD FLOATING OVER THE LIST — it is a row in a column, so
      // it paints a WASH and never a surface. And the two states paint two different
      // washes on purpose: the hover one is the reader’s pointer and the standing
      // one is where they are. What would be wrong is a card surface here, which
      // would make twenty rows look like twenty things lying on top of the list.
      //
      // **「薄洗」是一条性质，不是两个名字。** 白名单里的两个洗令牌只是这条性质的
      // 两个名字；真实判据是**值里让它透**：知名的两个洗令牌，或者任何带 `transparent`
      // 的配方（`color-mix(in srgb, currentColor 12%, transparent)` 就属于这一类——
      // 它按墨推色，任何主题都与背景相反，那也正是读者那次「白底上看不见」之后选中的
      // 那一条）。白名单会逼着一个正确的实现去迁就它（硬性规范 14），而按性质判就
      // 不会：卡片面（`--item-float`、`--item-card`）没有 `transparent`，照样被拦下来。
      const fills = body.match(/(?:^|[;{\s])background(?:-color)?\s*:\s*([^;]+)/)?.[1]?.trim() ?? ''
      const isWash = ['var(--item-fill)', 'var(--dsh-tb-hover)'].includes(fills) || /\btransparent\b/.test(fills)
      expect(isWash,
        `a rail row paints "${fills}" rather than a wash, so it reads as something lying on top of the list`)
        .toBe(true)
      const radii = body.match(/(?:^|[;{\s])border-radius\s*:\s*([^;]+)/)?.[1]?.trim() ?? ''
      expect(radii === '' || radii === 'var(--item-radius-ctl)',
        `a rail row uses "${radii}" rather than the control radius, so it does not match the other controls in the column`)
        .toBe(true)
    }
    /* 判据会咬人的证明（硬性规范 16 的同一条精神：一条读什么都通过的检查等于没有检查）。
       这张面令牌是一张卡片面，它没有 `transparent`，也不在白名单里——所以它必须被拒。 */
    const SURFACE_IS_NOT_A_WASH = 'var(--item-float)'
    expect(['var(--item-fill)', 'var(--dsh-tb-hover)'].includes(SURFACE_IS_NOT_A_WASH)
      || /\btransparent\b/.test(SURFACE_IS_NOT_A_WASH), 'the wash reader no longer refuses a card surface').toBe(false)
    // The reader is proved on the four shapes it has to tell apart, so a future
    // edit to the pattern cannot quietly turn it into one that matches nothing.
    const BORDER = /(?:^|[;{\s])border(?:-[a-z]+)?\s*:\s*(?!\s*(?:0|none)\b)/
    expect('.a { border: 0; }'.match(BORDER)).toBeNull()
    expect('.a { border: none; }'.match(BORDER)).toBeNull()
    expect('.a { border-radius: 0; }'.match(BORDER)).toBeNull()
    // A real border IS reported. The lookahead is zero-width, so the match ends
    // at the colon — asserting on the text would pin an accident of where the
    // pattern stops, so what is checked is that it matched and that what it
    // matched is the border property rather than some other one.
    const real = '.a { border: 1px solid red; }'.match(BORDER)
    expect(real, 'a real border was not reported — the reader has stopped biting').not.toBeNull()
    expect(real?.[0]).toMatch(/border:\s*$/)
    // And the GUARD is proved too, because a guard nobody checked is the same
    // defect as the loop it guards: a sheet the sentence has been renamed out of
    // answers `[]` and the loop over it would pass in silence.
    const rulesNamed = (text: string, name: string): number => rulesOf(text, name).length
    expect(rulesNamed('.itemNoMatch { white-space: normal; }', 'itemNoMatch')).toBe(1)
    expect(
      rulesNamed('.itemNoMatchRenamed { white-space: nowrap; }', 'itemNoMatch'),
      'the reader cannot tell a renamed class from a compliant one, so the guard above is the only thing standing between a rename and a silent pass',
    ).toBe(0)
  })

  it('the list track grows in exactly one place, and it is the scroller', () => {
    // THE RULE THAT WAS HERE DEMANDED A BLANKET CHILD RULE, and the blanket rule
    // it demanded is what broke the list. It required a `.itemListColumn > *`
    // selector with `flex: 0` — "no direct child may grow along the block axis" —
    // and that selector has the SAME specificity as `.itemFlow`'s own
    // `flex: 1 1 auto` and is written later in the sheet, so it won. The scroller
    // stopped growing, sized itself to its content instead, overflowed a column
    // that is `overflow: hidden`, and **the last rows became unreachable with no
    // scrollbar and nothing on screen to say why.**
    //
    // The intent was sound and is kept: no ROW may grow, because a one-line
    // sentence that becomes the height of the column reads as an empty box with a
    // caption. What was wrong was the subject — the rule named the track's
    // children, and the track's children are not all rows; one of them is the
    // scroller, whose whole job is to take the remaining height.
    //
    // Three statements, and each one is a promise a reader can see:
    const rules = declarationRules(css)
    const growOf = (rule: Rule): string => (/(?:^|[;{\s])flex(?:-grow)?\s*:\s*([^;]+)/.exec(rule.body)?.[1] ?? '').trim().split(/\s+/)[0] ?? ''
    const grows = (value: string): boolean => /^[1-9]/.test(value)
    const named = (name: string): Rule[] => rules.filter(rule => new RegExp(`(?:^|[,\\s])${name.replace('.', '\\.')}(?:\\s|,|$|:|\\{)`).test(rule.selector))

    // 1. NO ROw GROWS. This is the 660px hole as a rule rather than a measurement.
    for (const rule of named('.itemRow')) {
      expect(grows(growOf(rule)),
        `${rule.selector} grows (flex: ${growOf(rule)}) — a one-line sentence then becomes the height of the column`).toBe(false)
    }

    // 2. THE SCROLLER DOES GROW. The other half, and the half that was missing:
    //    without it the list is taller than its column and the column clips it.
    expect(named('.itemFlow').some(rule => grows(growOf(rule))),
      'no rule lets the list area take the remaining height, so it sizes to its content and the column clips the last rows').toBe(true)

    // 3. NO BLANKET CHILD RULE ON THIS TRACK. Not a style preference: any
    //    `.itemListColumn > *` rule outranks the children's own declarations by
    //    source order at equal specificity, so re-adding one silently re-breaks
    //    statement 2 — and the way it breaks is a clipped list, not a red gate.
    expect(rules.filter(rule => /\.itemListColumn\s*>\s*\*/.test(rule.selector)),
      'a blanket `.itemListColumn > *` rule is back — it outranks `.itemFlow`\'s own flex and the list stops scrolling again').toHaveLength(0)

    // And the readings are proved both ways, on strings they cannot have been
    // tuned against, so this cannot pass by finding nothing.
    const rowsGrow = (text: string): boolean => declarationRules(text)
      .filter(rule => /(?:^|[,\s])\.itemRow(?:\s|,|$|:|\{)/.test(rule.selector))
      .some(rule => grows((/(?:^|[;{\s])flex(?:-grow)?\s*:\s*([^;]+)/.exec(rule.body)?.[1] ?? '').trim().split(/\s+/)[0] ?? ''))
    expect(rowsGrow('.itemRow { flex: 1 1 auto; }'), 'the probe did not bite on a growing row').toBe(true)
    expect(rowsGrow('.itemRow { flex: 0 1 auto; }')).toBe(false)
    expect(rowsGrow('.itemRowText { flex: 1 1 auto; }'), 'the probe bit on a rule that is not the row').toBe(false)
    const flowGrows = (text: string): boolean => declarationRules(text)
      .filter(rule => /(?:^|[,\s])\.itemFlow(?:\s|,|$|\{)/.test(rule.selector))
      .some(rule => grows((/(?:^|[;{\s])flex(?:-grow)?\s*:\s*([^;]+)/.exec(rule.body)?.[1] ?? '').trim().split(/\s+/)[0] ?? ''))
    expect(flowGrows('.itemFlow { flex: 1 1 auto; }')).toBe(true)
    expect(flowGrows('.itemFlow { flex: none; }'), 'the probe reported a scroller that cannot grow as fine').toBe(false)

    // AND A SENTENCE ABOUT A RULE IS NOT A RULE. Every claim above is answered by
    // reading the sheet, and this sheet explains itself in prose — so the reader
    // has to survive a rule being NAMED where it is not written, which is the
    // shape that made this gate demand the deleted rule back.
    const blanket = (text: string): number => declarationRules(text)
      .filter(rule => /\.itemListColumn\s*>\s*\*/.test(rule.selector)).length
    expect(blanket('/* a .itemListColumn > * rule used to live here */\n.a { flex: none; }'),
      'a comment naming the blanket selector was reported as the blanket rule').toBe(0)
    expect(blanket('.itemListColumn > * { flex: none; }'),
      'the probe cannot see the blanket rule it exists to forbid').toBe(1)
  })

  it('a date tone changes the ink and nothing else, so urgency is not also shouting', () => {
    // The four date readings are told apart by COLOUR, which is the one channel
    // reserved for "this one matters". If a tone also went bold, the loudest
    // thing on a row would be whichever row is latest rather than whichever row
    // is late — and the page would carry two competing signals, one of them
    // about scheduling.
    //
    // THE SELECTOR HALF, OR NOTHING. Reading `rulesOf(css, 'itemDue')` and filtering
    // the BODIES for `[data-tone` cannot work: a body never contains its own
    // selector, so the filter matches nothing, the loop never runs, and the gate
    // asserts that an empty array has no extra properties in it. The tone rules are
    // named by their selector (`.itemRowMeta [data-tone='over']`), which is precisely
    // the half `rulesOf` throws away and `declarationRules` keeps.
    const TONE = /\[data-tone[^\]]*\]/
    // COMMENTS OFF, and the reason is this sheet's own prose: the note above the
    // ink rules says in words that `[data-tone]` selects the reading, and a
    // selector is everything between the previous `}` and this `{` — so a reader
    // that keeps the comments hands the tone attribute to the rule AFTER the
    // comment, which has nothing to do with a tone. That is the whole of rule 14
    // turned round: a checker that reads the decoration reports the explanation
    // as the thing it forbids, and the cheapest way to quiet it is to delete a
    // correct note.
    const live = stripCssComments(css)
    /* WHAT A TONE MAY TOUCH, and it is two lists rather than one.
     *
     * The claim is that a tone is ONE signal. Ink is that signal: colour, its
     * background, its border, its fill. Everything that adds a SECOND way of
     * being loud is therefore forbidden — a heavier weight, italics, an
     * underline, a scale, a lift. That list is short and it is the point of the
     * gate.
     *
     * The second list is the SLOT. `display`, `min-inline-size`, `overflow`,
     * `text-overflow`, `white-space`, `font-size` and `line-height` are how a
     * reading EXISTS at all, and the sheet states that as its design: the tone
     * rule is where placement and truncation are defined, together, precisely so
     * the two halves cannot drift. Reading those as "a tone shouting" flags the
     * slot's own definition and asks for it to be deleted — which is rule 14 from
     * the other end: a checker whose reading makes the correct sheet look wrong.
     */
    const INK = new Set(['color', 'background', 'background-color', 'border-color', 'fill', 'stroke', 'opacity'])
    const SLOT = new Set([
      'display', 'min-inline-size', 'inline-size', 'overflow', 'text-overflow',
      'white-space', 'font-size', 'line-height', 'flex', 'flex-shrink', 'min-width',
    ])
    const shouting = (text: string): { selector: string; property: string }[] => declarationRules(stripCssComments(text))
      .filter(rule => TONE.test(rule.selector))
      .flatMap(rule => [...rule.body.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:/g)]
        .map(match => ({ selector: selectorName(rule.selector), property: match[1] as string }))
        .filter(found => !INK.has(found.property) && !SLOT.has(found.property)))
    const tones = declarationRules(live).filter(rule => TONE.test(rule.selector))
    expect(
      tones,
      'no rule in either sheet selects a tone attribute, so this gate is about nothing — the readings are told apart by that attribute and nothing else is',
    ).not.toEqual([])
    const offenders = shouting(live)
    expect(
      offenders,
      `a tone changes ${offenders.map(found => `${found.property} (${found.selector})`).join(', ')} as well as the ink — a tone is one signal, and a second one competes with it`,
    ).toEqual([])
    // The reader, on the two shapes it has to tell apart, so a green here means
    // the DETECTOR works and not that the sheet happens to be tidy.
    expect(shouting(`.itemRowMeta [data-tone='over'] { color: var(--dsh-tb-danger); }`), 'an ink-only tone was reported').toEqual([])
    expect(
      shouting(`.itemRowMeta [data-tone='over'] { color: var(--dsh-tb-danger); font-weight: 600; }`),
      'a tone that also shouts was not reported — the gate has stopped biting',
    ).toEqual([{ selector: ".itemRowMeta [data-tone='over']", property: 'font-weight' }])
  })

  it('the two detectors bite on shapes they cannot have been tuned against', () => {
    // THE TABLE IS RESTATED RATHER THAN IMPORTED, on purpose: a probe that reads
    // the same constant the gate reads proves nothing about the constant, only
    // that the file is internally consistent. These two copies are the cost of
    // being able to fail, and the pair is checked by the gate above.
    const TABLE: Readonly<Record<number, readonly number[]>> = {
      16: [600], 15: [500], 14: [500, 600], 13: [400, 600], 12: [400, 600], 11: [400],
    }
    const stray = (sizes: number[]): number[] => sizes.filter(size => TABLE[size] === undefined)
    // 15 is ON the scale now, so the near-miss has to be a different size for
    // this probe to bite: 13.5 is a near-miss of 13 and 12 in the way this check
    // is about, and a size one step off any rung.
    expect(stray([12, 13, 13.5, 14])).toEqual([13.5])
    expect(stray([11, 12, 13, 14, 15, 16])).toEqual([])
    // A weight the table does not allow at its size, and one it does. 15 is the
    // row title and is allowed 500 only — a row title at 600 would be a heading.
    expect((TABLE[16] ?? []).includes(400)).toBe(false)
    expect((TABLE[15] ?? []).includes(600)).toBe(false)
    expect((TABLE[15] ?? []).includes(500)).toBe(true)
    expect((TABLE[12] ?? []).includes(600)).toBe(true)
  })
})

describe('the colour budget is a budget, counted at the token layer', () => {
  // The LIST's own sheet, and only it. The budget is a statement about this
  // panel; the board has its own, much older, much larger set of positions and
  // folding the two together would produce a number nobody could act on — and a
  // budget that is already blown before anyone touches the list is a budget
  // that gets switched off.
  const css = stripCssComments(itemSheet())

  /**
   * How many VISUAL POSITIONS a semantic ink is used at.
   *
   * Counted by DECLARATION rather than by looking at a capture, and that is not
   * a compromise — it is the only honest place to count. The running accent is a
   * layer the theme service applies from the reader's own settings, so the
   * bench's captures carry the host's default where the product carries the
   * reader's; counting coloured regions in a picture would be counting the
   * host. What a rule says is a fact about this repository.
   *
   * The unit is the VISUAL POSITION, not the declaration: a rule that sets a
   * colour and a border-colour is one place, and a control's resting and hover
   * states are one place because the reader sees one control. A declaration
   * that is only a FALLBACK paints nothing and is not a place at all — the
   * author has already answered for the case where the host is silent, and
   * counting one would make the budget unreachable for a correct sheet.
   */
  /**
   * VISUALLY ONE THING IS ONE POSITION — **a position, not a selector**, and that
   * is the half a selector count cannot see. Counting selectors makes the keyboard
   * focus ring cost eighteen positions: one ring, drawn on eighteen controls. A
   * budget is a claim about what a reader SEES, and a reader sees one ring. So the
   * states that draw the same mark for the same reason are collapsed by name here,
   * and everything else stands on its own selector.
   *
   * The list is short ON PURPOSE: a family nobody named is counted per selector,
   * which is the strict reading — so a new focus-like state costs its full price
   * and the budget says so loudly, rather than quietly reinterpreting itself.
   */
  const FAMILIES: ReadonlyArray<{ readonly key: string; readonly is: (s: string) => boolean }> = [
    { key: '键盘焦点环', is: s => /:focus-visible\b/.test(s) },
    {
      key: '日期轴珠',
      // 日期轴的珠子是**一颗珠子的几个状态**，不是几处用量：挂着截止的空心红环
      // 与已经超了的实心红，读者看到的是同一个位置换了个状态——按名折叠成一档，
      // 而不是按选择器计两份。匹配只收以 `> i` 收尾的珠子规则，读法行的红
      // （`> span`）不在族里，它自己算一份。
      is: s => s.startsWith('.itemDateAxis') && />\s?i$/.test(s),
    },
  ]

  /**
   * NOT EVERY POSITION SPENDS THE SAME INK, and the budget only means something
   * while that distinction is drawn.
   *
   * A **decoration** position is where the product says something: the current
   * page, the row you are on, the pill that says a run is live, the cursor in a
   * palette. Six of those and the colour is the product's, and the one row that
   * is genuinely urgent arrives in the same ink as the chrome.
   *
   * An **affordance** position is the platform's own answer to a question the
   * reader asked — the ring around whatever has the keyboard, the tint on a
   * native checkbox. They are not spending the ink to be noticed; they are
   * spending it because not spending it would be worse. A focus ring drawn in
   * some neutral grey is a ring a reader cannot find on a phone, and a native
   * checkbox in the host's own tint next to everything else in accent is a
   * control that looks borrowed.
   *
   * So the two are counted SEPARATELY, each with its own allowance, and the
   * total is checked too — otherwise a sheet can pass by moving everything into
   * the affordance column, which is the cheapest way to make this gate green and
   * the worst way to use accent.
   */
  const AFFORDANCES: ReadonlyArray<{ readonly key: string; readonly is: (s: string) => boolean }> = [
    { key: '键盘焦点环', is: s => /:focus-visible\b/.test(s) || /--dsh-tb-ring/.test(s) },
    { key: '原生控件的色调', is: s => /(?:^|[;{\s])(?:accent-color|appearance)\s*:/.test(s) },
    /* **指针停在左栏的那一行上，是平台在回答，不是产品在说话。** 它与「你站在这儿」
       用的是同一把尺子（`--dsh-tb-wash` 的一半与整档），而两件事分开记：一行说「你在
       这儿」（装饰位置），另一行说「它按得动」（affordance）。把悬停记进装饰预算，等于
       让「指针路过」和「这一页是当前页」花同一笔预算——而前者每一屏都会发生在不同的
       行上，后者永远只有一处。 */
    { key: '左栏行的悬停', is: s => /\.itemRailRow:hover/.test(s) },
  ]
  /**
   * **一种墨的每一种写法都要被看见，否则计数器报的是一个数字，而那个数字看起来像
   * 一个答案。** 焦点环现在画在 `--dsh-tb-ring` 上（accent 的一族影，理由写在
   * `board.module.css`：`outline` 不跟着 `corner-shape` 走，超椭圆族下环与边会在每个
   * 角上分叉）。环从「一个属性里的 var()」换成「一个令牌」之后，只认
   * `var(--dsh-tb-accent)` 的读法会**少看见一个位置**——而「少看见」正是这条断言存在
   * 的原因：环改用令牌之后，十七个 focus outline、一处 `color-mix`、一处
   * `accent-color` 会一起隐形，于是三个没登记的位置顶替三个登记过的，数字刚好落在
   * 上限上、看起来像个答案。
   *
   * 所以这里接受一组拼写。令牌自己的**声明**仍然不算位置（按本族已有的规则：只存
   * 不画的声明不是位置）。
   */
  const SPELLINGS: Readonly<Record<string, readonly string[]>> = {
    '--dsh-tb-accent': ['--dsh-tb-accent', '--dsh-tb-ring'],
  }
  function splitPositions(token: string): { readonly decoration: readonly string[]; readonly affordance: readonly string[] } {
    const seen = (where: 'decoration' | 'affordance', name: string): void => {
      const key = `${where}:${name}`
      if (buckets.has(key)) return
      buckets.set(key, where)
      where === 'decoration' ? decoration.push(name) : affordance.push(name)
    }
    const buckets = new Map<string, 'decoration' | 'affordance'>()
    const decoration: string[] = []
    const affordance: string[] = []
    const spellings = SPELLINGS[token] ?? [token]
    for (const rule of declarationRules(css)) {
      if (!spellings.some(one => paintsToken(rule.body, one))) continue
      const family = FAMILIES.find(entry => entry.is(rule.selector))
      const name = family === undefined ? rule.selector : family.key
      // BOTH HALVES OF THE RULE ARE OFFERED TO THE MATCHER, and that is not sloppiness:
      // 「a state selector names the ring」 but 「a native control's tint is named by
      // the property that draws it」, and a matcher that only ever saw the selector
      // would score every `accent-color` as a decoration — which is the exact
      // inversion this split exists to prevent.
      const affordanceFamily = AFFORDANCES.find(entry => entry.is(rule.selector) || entry.is(rule.body))
      seen(affordanceFamily === undefined ? 'decoration' : 'affordance', name)
    }
    return { decoration, affordance }
  }

  it('accent, attention and danger each stay inside their stated budget', () => {
    // The budgets are small on purpose. A semantic ink used in eight places is
    // not a signal any more; it is the colour of the product, and the one row
    // that is genuinely urgent arrives in the same ink as the chrome.
    //
    // THE READER BELOW SEES EVERY SPELLING, and that is the whole point of it: this
    // sheet spends a semantic ink in four ways, and a reader that matches only a BARE
    // `var(--token)` reads one of them. **A
    // counter that cannot see a spelling reports a number, and the number looks
    // like an answer.** Each spelling below is proved to move or paint.
    // SEVEN, and every one of them is named in `DESIGN.md`. A counter that saw only
    // some of the spellings would agree with that record BY COINCIDENCE: miss
    // `outline` (eighteen focus rings), `color-mix` or `accent-color`, and three
    // unlisted things stand in for three listed ones and land on the number. That
    // is the trap this gate is for.
    //
    // The two focus families are counted apart on purpose: the field's focus is a
    // border AND a ring, every other control's is a ring only, so they are two
    // drawings of one idea rather than one drawing. Collapsing them would make the
    // number smaller than the page, which is the same lie in the other direction.
    //
    // FIVE DECORATION POSITIONS, and every one of them is the product speaking:
    // the current page, the selected row, the live pill, the cursor in a palette,
    // and 优先级「高」那一枚穿 accent 的芯片（读者点名要的一档颜色），与「重复一遍
    // 旁边的数字」那一种不同类。一条 2px 的量条重述旁边已经印着的数，是同一句话的
    // 第二次，不是一处位置——**这个数字说的是有多少件事在说话**，不是有多少处着色。
    //
    // The two affordances on top of it (the focus ring, the native checkbox tint)
    // are counted in their own column rather than added to these five, so the
    // figure above is still five and still means five things the product is
    // saying. Their allowance is small and their total is checked, so moving the
    // page's own marks into the affordance column is not a way to buy headroom.
    // 两个 affordance（焦点环、原生控件的色调）仍旧各算一档，所以总数是 7。
    // 五条装饰位置都写在 `DESIGN.md` 的颜色节里。
    //
    // **accent 的 affordance 从 2 变成 3**：左栏那一行的悬停现在读同一把洗底尺子的一半
    // （`color-mix(accent, wash / 2)`）。它不是第六个「产品在说话」的位置——它是指针在
    // 回答「这一行按得动」，与焦点环同一类；所以它记在 affordance 一栏，装饰仍然是五处。
    const budget: Readonly<Record<string, { readonly decoration: number; readonly affordance: number; readonly total: number }>> = {
      '--dsh-tb-accent': { decoration: 5, affordance: 3, total: 8 },
      '--dsh-tb-attention': { decoration: 2, affordance: 0, total: 2 },
      // 危险色五处，其中一处是优先级「紧急」那一枚实心芯片。红在这一面上
      // 说的都是同一件事的两个方向——「已经错了」（句末读法 / 日期轴上过了的截止 /
      // 新建那张纸上三个日期互相矛盾时那一句）与「别让它错」（最响的那一档优先级）。
      // 读法与珠子算一档，是 `FAMILIES` 里那句「一颗珠子的几个状态不是几处用量」。
      //
      // **第五处（新建纸那一句）是挣来的，不是顺手加的。** 它是**同一句判词**在另一张
      // 地面上的出口：读者正在写那三个日期，而那三个日期互相矛盾——这一屏上唯一一件
      // 「已经错了」的事。写成灰的会让它混进那一段注解里，而读者就要带着一组不可能的
      // 日期按「存下这一条」——之后再在行尾读到同一句话，那时已经晚了。它只在真的矛盾
      // 时出现（`data-warn`），所以它不是一层常驻的红，是一次被触发的判词。
      '--dsh-tb-danger': { decoration: 5, affordance: 0, total: 5 },
    }
    for (const [token, limit] of Object.entries(budget)) {
      const { decoration, affordance } = splitPositions(token)
      const all = [...decoration, ...affordance]
      expect(all.length, `${token} paints ${all.length} positions in all (${decoration.length} the product says + ${affordance.length} affordances), over its total of ${limit.total}: ${all.join(' | ')}`)
        .toBeLessThanOrEqual(limit.total)
      expect(decoration.length, `${token} paints ${decoration.length} positions of its own, over its budget of ${limit.decoration}: ${decoration.join(' | ')}`)
        .toBeLessThanOrEqual(limit.decoration)
      expect(affordance.length, `${token} paints ${affordance.length} affordances, over its allowance of ${limit.affordance}: ${affordance.join(' | ')}`)
        .toBeLessThanOrEqual(limit.affordance)
    }
  })

  it('the counter sees all four spellings, and only the fallback is not a position', () => {
    // Every shape this sheet actually uses, planted at once.
    const painted = [
      '.a { color: var(--dsh-tb-accent); }',
      '.b { border-color: var(--dsh-tb-accent); }',
      // the focus ring — `outline` was not in the property list at all, which is
      // how eighteen declarations stayed invisible
      '.c:focus-visible { outline: 2px solid var(--dsh-tb-accent); }',
      // the wash — a `color-mix` of the token is the same ink spent
      '.d[data-active] { background: color-mix(in srgb, var(--dsh-tb-accent) 10%, transparent); }',
      // the native control's tint
      '.e input { accent-color: var(--dsh-tb-accent); }',
      // and the two that are NOT positions, for the reason already given
      '.f { color: var(--dsh-tb-accent, red); }',
      '.g { --x: var(--dsh-tb-accent); }',
    ].join('\n')
    const count = (text: string): number => {
      const selectors = new Set<string>()
      for (const rule of declarationRules(text)) {
        if (paintsToken(rule.body, '--dsh-tb-accent')) selectors.add(rule.selector)
      }
      return selectors.size
    }
    // Five paint: a, b, c, d, e. The fallback does not (the author already
    // answered for the silent host), and a custom property that merely STORES the
    // token paints nothing.
    expect(count(painted), 'the counter is blind to a spelling this sheet uses, so the budget counts the wrong things').toBe(5)
  })
})

/**
 * Does this declaration body PAINT the token, in any of the spellings?
 *
 * A budget is a claim about what a reader SEES, so the reader has to recognise
 * every way the ink can reach a surface. The four that matter, and the two that
 * look like them but are not:
 *
 * - a bare `var(--token)` on a colour-bearing property, including `outline` and
 *   `accent-color`, which a focus ring and a native checkbox both ride on;
 * - a `color-mix()` OF the token, which is the same ink at a lower alpha and
 *   therefore the same POSITION — a wash beside a rail is still a wash beside a rail;
 * - a value that merely STORES the token in a custom property paints nothing;
 * - a value that uses the token as a FALLBACK (`var(--token, red)`) is the
 *   author's own answer for a silent host, not a position they spent.
 *
 * @param body - one declaration block, comments already stripped.
 * @param token - the custom property name.
 * @returns whether the block paints that token.
 */
function paintsToken(body: string, token: string): boolean {
  // After the token comes either `)` (a real use) or `,` (a fallback), so the
  // lookahead excludes the COMMA. Excluding the paren instead — which reads like
  // the same guard — rejects every bare `var(--token)` and leaves only the
  // fallback-shaped ones, which is the exact inverse of the intent.
  const use = new RegExp(`var\\(\\s*${token.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*(?!\\s*,)`)
  if (!use.test(body)) return false
  return /(?:^|[;{\s])(?:color|background(?:-color)?|border[\w-]*color|outline|accent-color|fill|stroke)\s*:/.test(body)
}

/**
 * THE SHEET IS WELL-FORMED, and this is the one check in the file that is not
 * about a claim the panel makes.
 *
 * It exists because of a real edit, made here, that deleted a single comment
 * terminator from the middle of a comment. CSS has no nested comments, so the
 * comment that opened 25 lines earlier swallowed everything up to the next
 * terminator — which took `.itemWorkbench { display: grid }` with it, and with
 * it the entire two-column workbench. The page still rendered: one column, full
 * width, every row readable, nothing broken-looking. **A diff does not show it**
 * (the deleted characters are inside a comment, so the hunk reads as a rewrite of
 * prose), and the geometry assertions in this file did not catch it either,
 * because the workbench they measure is the one that stopped being a grid.
 *
 * (This paragraph is itself the lesson: the first draft of it spelled the
 * terminator out as two characters, which closed this comment and took the rest
 * of the file with it. The check below is not a formality.)
 *
 * So the check is on the file, not on the claim: every `/*` in a sheet is closed,
 * and every `{` is closed. Both are one-line invariants of a text file, both are
 * silent when broken, and both cost nothing to hold.
 */
describe('the stylesheets this panel renders from are well-formed', () => {
  /**
   * Walk a sheet the way the PARSER walks it, not by counting.
   *
   * Counting openers against terminators is the reading that looks obvious and
   * is wrong: both sheets legitimately mention a comment opener inside prose
   * (there are rules on this file that talk about what a comment does), and a
   * count sees those as an extra opener. That is hard rule 14 from the other
   * side — a check whose reading is wrong sends the next author to "fix" a
   * correct sheet — so the scan keeps the open/closed state and only reports a
   * terminator that never arrives.
   *
   * (And the same trap caught the author of this paragraph twice: spelling the
   * two-character terminator inside this comment closed it, and took the rest of
   * the file with it. Hence the check is not a formality.)
   */
  function commentWalk(source: string): { live: string; unclosedAt: number } {
    let live = ''
    let inComment = false
    let openedAt = -1
    for (let i = 0; i < source.length; i += 1) {
      if (!inComment) {
        if (source.startsWith('/*', i)) { inComment = true; openedAt = i; i += 1; continue }
        live += source[i]
      } else if (source.startsWith('*/', i)) { inComment = false; i += 1 }
    }
    return { live, unclosedAt: inComment ? openedAt : -1 }
  }

  for (const sheet of ['src/client/board.module.css', 'src/client/item/item.module.css'] as const) {
    it(`${sheet} closes every comment and every block`, () => {
      const source = readFileSync(join(repoRoot, sheet), 'utf8')
      const { live, unclosedAt } = commentWalk(source)
      expect(unclosedAt,
        `${sheet} has an unclosed comment at line ${unclosedAt < 0 ? 0 : source.slice(0, unclosedAt).split('\n').length}: CSS has no nested comments, so the parser is reading the rest of the file as prose and every rule after it is silently gone — the page still renders, just not the page that was written`
      ).toBe(-1)
      // Braces are counted in the text the parser actually sees, so a brace
      // inside prose cannot be mistaken for a block.
      expect((live.match(/\{/g) ?? []).length, `${sheet} does not balance its blocks`).toBe((live.match(/\}/g) ?? []).length)
    })
  }
})

/**
 * THE RENDER ARTIFACT.
 *
 * Only written when `DSH_PANEL_HTML` names a path, so the suite stays a suite.
 * With it set, `scripts/shot-panel.mjs` can capture the same page the assertions
 * above measure — one instrument, two readings.
 */
describe('the render artifact', () => {
  it('writes a standalone page when asked, and the page carries the real tokens', () => {
    const target = process.env.DSH_PANEL_HTML
    if (target === undefined || target === '') return
    const band = process.env.DSH_PANEL_BAND === 'narrow' ? 'narrow' : 'wide'
    // Every page, and rendering ONE of them is what the harness must not do: a
    // surface with two thirds of itself never looked at is a surface half-changed.
    // The page is the other half of the band switch, and the agenda — whose primary
    // form is a day-sequence rather than a grouped list — is the one that differs
    // most from the default, so it is the one most worth being able to see.
    const asked = process.env.DSH_PANEL_PAGE
    const page: Page = asked === 'inbox' || asked === 'schedule' ? asked : 'list'
    // An empty document is the FIRST thing a reader with a fresh install sees,
    // and it is this repository's own state right now. A fixture full of rows
    // would never show it, so the artifact can be rendered empty on purpose —
    // the empty state is a designed state, and it is the one most likely to be
    // drawn badly.
    const empty = process.env.DSH_PANEL_EMPTY === '1'
    // The dark capture resolves against the host's own dark semantic table, so
    // it is a reading of the shell's output rather than of a guess rebuilt here.
    const scheme = process.env.DSH_PANEL_DARK === '1' ? 'dark' : 'light'
    // NO SEED FOR THE SEARCH BOX, and that is not an omission: the search text is
    // the one view field deliberately NOT remembered, so a harness cannot open
    // the artifact on a filtered page. The filtered page is proven where it can
    // be — by pressing a facet, in `item-workbench.spec.ts`.
    // DSH_PANEL_ROW names a row to expand, because the expansion is the one
    // state a static render cannot reach by itself — and it is the largest thing
    // on this panel, so 「nobody looked at it」 is not a state it may stay in. It
    // is its OWN variable: `DSH_PANEL_OPEN` names a layer, and one variable
    // cannot answer both questions at once.
    const openRow = openRowOfEnv()
    writeRenderArtifact(target, empty ? [] : fixtures(), band, page, scheme, openRow === '' ? undefined : openRow)
    expect(existsSync(target)).toBe(true)
  })
})

describe('the stylesheets this panel renders from survive the real transform', () => {
  const SHEETS = ['item/item.module.css', 'board.module.css']

  const build = (text: string, filename: string) => () => lightningcss.transform({
    filename,
    code: Buffer.from(text),
    minify: false,
    errorRecovery: false,
  })

  it('the probe bites, on strings it cannot have been tuned against', () => {
    // A detector that only ever sees real sources is green for the same reason a
    // broken one is green: it was never given anything to fail on.
    const open = String.fromCharCode(47, 42)
    const shut = String.fromCharCode(42, 47)
    const eol = String.fromCharCode(10)
    expect(build('.a { color: red; }', 'p.css'), 'the probe calls a valid sheet broken').not.toThrow()
    expect(build(open + ' real ' + shut + ' .a { color: red; }', 'p.css'), 'the probe rejects a sheet with a real comment').not.toThrow()
    // The exact shape that broke this panel: a comment body with no opening.
    expect(build('.a { color: red; }' + eol + ' * body with no opening', 'p.css'),
      'the probe cannot see a comment whose opening was eaten').toThrow()
  })

  it('both sheets transform, so every selector in them can match something', () => {
    for (const sheet of SHEETS) {
      const source = readFileSync(join(repoRoot, 'src/client', sheet), 'utf8')
      expect(build(source, join('src/client', sheet)),
        sheet + ' is not CSS the build will accept, so every selector in it silently matches nothing').not.toThrow()
    }
  })
})

describe('标签框按内容定宽', () => {
  const css = panelCss()

  it('宽度由里面那把尺子给，不由 input 自己的默认值给', () => {
    // 量过：空着时**框 54px、尺子 54px**（一模一样），而改之前是 100px——`<input>` 的固有宽度
    // 由 `size` 决定、默认二十个字符，那就是这段死空的来处（读者：「它这个空的地方也太长了，
    // 字却挤在左边」）。三条声明缺一条，这把尺子就不成立。
    expect(lastDeclaredOf(css, 'itemTagAddField', 'display'), '那一格不再是网格，两样东西就不在同一格里').toBe('inline-grid')
    expect(lastDeclaredOf(css, 'itemTagAddMirror', 'inline-size'), '尺子不再按内容取宽').toBe('max-content')
    expect(lastDeclaredOf(css, 'itemTagAdd', 'inline-size'), '输入框不再跟着那一格走，于是它按自己的默认字符数定宽').toBe('100%')
  })

  it('the probe bites: a field sized by the input default is reported', () => {
    const planted = `${css}\n.itemTagAdd {\n  inline-size: auto;\n}\n`
    expect(lastDeclaredOf(planted, 'itemTagAdd', 'inline-size'), 'the plant did not bite').not.toBe('100%')
  })
})

describe('行尾那一簇记号与标题共一条线', () => {
  const css = panelCss()

  it('宽档：簇高就是标题的行高，不是它自己内容的高度', () => {
    // 行的网格是 `align-items: start`，于是这一簇的盒顶与标题的盒顶齐平；而它里面最高的一件
    // 只有 18px（那三枚胶囊：步骤 / 状态 / 日期）——**量出来的是这一簇的墨心 272，而标题、
    // 珠子与 ⋮ 都是 274**。读者看到的正是「标题右边那些东西比标题高一点点」。
    // 钉法就是让两者声明同一个数；改一个而不改另一个，这一条就红。
    //
    // **读的是基础档**（顶层那一条），因为这一条说的是**宽档**的样子：窄档另有其形
    // （见下一条），问「最终值」会读到窄档去，答的就不是这一条问的那件事了。
    expect(baseDeclaredOf(css, 'itemRowMarks', 'block-size'), '行尾那一簇的高度不再与标题的行高同一个数，于是它们不再共线')
      .toBe(baseDeclaredOf(css, 'itemRowTitle', 'line-height'))
  })

  it('窄档：那一簇自己占一行，于是放开高——定高 + 换行 = 画到盒外', () => {
    // 窄档（`@container dsh-tb-item-list (max-width: 559px)`）里这一簇会**换行**：
    // 量过最坏的一行（附件 + 步骤 + 卡 + 长日期）在 320px 下要 225px，而那一格只有 222px
    // ——于是它折成两行，而盒高还是 22px 时**第二行画到了盒外**（量到 scrollHeight 38 >
    // clientHeight 22，16px 露在纸面上）。
    // 所以窄档放开高：**定高的盒子不许装会换行的内容**（`verify-fixed-height-wrap` 守着
    // 这一条，它读的是结构：定高与 `flex-wrap: wrap` 不能同时成立）。
    expect(lastDeclaredOf(css, 'itemRowMarks', 'block-size'), '窄档那一簇仍是定高，于是折行时第二行画到了盒外')
      .toBe('auto')
  })

  it('the probe bites: a cluster sized by its content is reported', () => {
    // 高度改回按内容算时两个数就不同了——那正是这一条要报的那件事。
    // 种的是**顶层**那一条，所以读数也必须是**基础档**那个（窄档那条与它无关）。
    const planted = `${css}\n.itemRowMarks {\n  block-size: auto;\n}\n`
    expect(baseDeclaredOf(planted, 'itemRowMarks', 'block-size'), 'the plant did not bite')
      .not.toBe(baseDeclaredOf(planted, 'itemRowTitle', 'line-height'))
  })

  it('the reader keeps the two bands apart', () => {
    // **分档读的判据自己也要有判据。** 种一条窄档规则：它该改「最终读数」（窄档赢），
    // 而**基础档的读数一个字节都不许动**。两件事都成立，才说明这把尺子分得清两档。
    const planted = `${css}\n@container dsh-tb-item-list (max-width: 559px) {\n  .itemRowMarks {\n    block-size: 3px;\n  }\n}\n`
    expect(baseDeclaredOf(planted, 'itemRowMarks', 'block-size'), '窄档的值漏进了基础档的读数')
      .toBe(baseDeclaredOf(css, 'itemRowMarks', 'block-size'))
    expect(lastDeclaredOf(planted, 'itemRowMarks', 'block-size'), '窄档的值没有盖住最终读数').toBe('3px')
  })
})

/**
 * **一个东西只有一个实现，而这一节是它的守门人。**
 *
 * 这一页最贵的缺陷形状是「同一件事各搞一套」：写入框两处各有一套高度与滚动，日期框两处
 * 各有一套对「读不懂」的答复（一处当场拒绝，一处默默丢掉）。把它们对齐一次只在今天成立；
 * **只留下一个，才是一直成立**。
 *
 * 所以这一节问的不是「两处像不像」，而是**第二处还在不在**——而且问的都是结构与文件，
 * 不是这一版的样子：一条 `<textarea>` 的所有权、高度的两个数的出处在哪、那句拒绝由谁
 * 说出口。任何一条红都指向「又一个实现长出来了」，而不是「某个数字变了」。
 */
describe('写入框与日期框：一处实现，一处拒绝', () => {
  /* 这一节只说**清单这一张表**（`itemSheet()`）。看板那张表里还有它自己的文本域（卡片
   * 提示词，按设计随内容长、到上限为止），那是另一个表面上的另一个控件；把两张表合在
   * 一起问，只会让这一节对着一张不属于它的纸下结论。 */
  const css = stripCssComments(itemSheet())
  /**
   * 按**整条选择器**取一个声明，而不是按类名包含。
   *
   * `rulesOf(css, 'itemProseGrip')` 会把 `.itemProseGrip > span` 一起收进来（它是抓条上
   * 那根画出来的握痕），于是「抓条多高」读到的会是 2px——那是握痕的高度，不是抓条的。
   * 一个把两个盒子混起来的读数比没有读数更坏：它给出一个看起来对的数字。
   */
  const boxOf = (selector: string): string =>
    declarationRules(css).find(rule => rule.selector.trim() === selector)?.body ?? ''
  const sizeIn = (selector: string, property: string): string | undefined =>
    new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;]+)`).exec(boxOf(selector))?.[1]?.trim()
  /**
   * 先剥注释再匹配。一条**提到** `<textarea>` 的注释不是一个实现，而一个会把注释
   * 当成实现的扫描器，唯一的绿色修法是去改那句注释（硬性规范 14）。
   */
  const code = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('写入框只有一处：`<textarea>` 只住在 prose-field.tsx', () => {
    const owners = itemSurfaceFiles().filter(file => /<textarea[\s/>]/.test(code(file.source))).map(file => file.path)
    expect(owners, `自己写文本域的文件：${owners.join('、') || '（一个都没有）'}——写入框是 prose-field.tsx 一个元件，五处都该用它`)
      .toEqual(['prose-field.tsx'])
  })

  it('the probe bites: a second textarea is reported', () => {
    // 这条断言的全部价值在于「第二个实现长出来时会红」。种一个进去，看它红不红。
    const planted = [
      { path: 'prose-field.tsx', source: '<textarea ref={field} />' },
      { path: 'detail-pane.tsx', source: '<textarea className={css.itemProse} />' },
    ]
    expect(planted.filter(file => /<textarea[\s/>]/.test(code(file.source))).map(file => file.path),
      'the plant did not bite').toEqual(['prose-field.tsx', 'detail-pane.tsx'])
  })

  it('高度归版面：三个令牌在样式表里，JS 里没有第二个数', () => {
    expect(sizeIn('.itemProse', 'block-size'), '写入框的高度不再由读者拖出来的那个数给出')
      .toBe('var(--item-prose-h, var(--item-write-floor))')
    expect(sizeIn('.itemProse', 'min-block-size'), '地板不再是那一个令牌').toBe('var(--item-write-floor)')
    expect(sizeIn('.itemProse', 'max-block-size'), '天花板不再是那一个令牌').toBe('var(--item-write-ceil)')
    const drag = code(readSource('client/item/prose-field.tsx'))
    expect(drag, 'prose-field.tsx 读不到了').not.toBe('')
    for (const name of ['--item-write-floor', '--item-write-ceil']) {
      expect(drag.includes(name), `拖拽的夹取范围把 ${name} 抄进了 JS——版面与手势会各说一个数`).toBe(false)
    }
    for (const property of ['min-block-size', 'max-block-size']) {
      expect(drag.includes(property), `拖拽没有从布局里读回 ${property}，于是它按自己记着的数夹`).toBe(true)
    }
  })

  it('地板与天花板按真实行盒算：四行就是四行', () => {
    /* **两个数写在一处、行盒写在另一处，就是它们对不上的原因。** 地板与天花板写的都是「几行」，
       而一个「行」是**字**给的：字号 13 × 行距 1.65 = 21.45px。这两条曾经按 20px 算，
       于是「地板 = 四行」只有 3.07 行——读者写满四行，框右边就冒出一条滚动条，而那条滚动条
       比设计早来一行。所以字号与行距各自成令牌，行盒由它们算出来，四条声明读同一枚数。
       **量法**（硬性规范 19）在 `scripts/probes/probe-item-rail.js` 的第十段：`(clientHeight − 内衬) ÷
       行盒` 报「装得下几行」，再往框里塞四行看 `scrollHeight === clientHeight`。 */
    expect(sizeIn('.itemProse', 'font-size'), '写入框的字号不再来自令牌——行盒就没有出处了')
      .toBe('var(--item-write-size)')
    expect(sizeIn('.itemProse', 'line-height'), '写入框的行距不再来自令牌').toBe('var(--item-write-leading)')
    const line = declaredOf(css, 'itemRoot', '--item-write-line')
    expect(line, '行盒没有在令牌层声明一次').toHaveLength(1)
    expect(line[0], '行盒不是那两枚令牌算出来的——写死一个数就是第二个数')
      .toBe('calc(var(--item-write-size) * var(--item-write-leading))')
    const floor = declaredOf(css, 'itemRoot', '--item-write-floor')
    const ceil = declaredOf(css, 'itemRoot', '--item-write-ceil')
    expect(floor.length, '地板没有声明').toBe(1)
    expect(ceil.length, '天花板没有声明').toBe(1)
    expect(floor[0], '地板不是按那一枚行盒算出来的：它又会比设计早一行或者晚一行')
      .toContain('4 * var(--item-write-line)')
    expect(ceil[0], '天花板不是按那一枚行盒算出来的').toContain('24 * var(--item-write-line)')
    // 咬得动：按 20px 行盒写回去的那一版必须被读出来（那就是这一轮修掉的那一版）。
    const planted = `${css}\n.itemRoot { --item-write-floor: calc(4 * 20px + 16px + 2px); }`
    expect(declaredOf(planted, 'itemRoot', '--item-write-floor').at(-1) ?? '',
      'the plant did not bite — 按 20px 算的那一版被读成了「从行盒算出来」')
      .not.toContain('var(--item-write-line)')
  })

  it('高度只由这一处给：没有 field-sizing，没有原生拖拽，抓条压在自己那一条空气里', () => {
    /* **这条规矩说的是「多行写入框的高度由读者定，不由键入定」**，而它原先问的是整张表
       （`css.includes('field-sizing')`）。那是判据把自己放大成了一个「这个属性在本项目里
       一次都不许出现」的禁令——于是它误伤了一个正当用途：**单行的「新卡名字」输入框**，
       宽度本来就该由内容定（它的 `size={13}` 只给了 123px，而一句卡片标题要 294px，
       字被裁掉）。宽度随内容长 ≠ 高度随键入长，两件事。

       所以判据精确到那个类：**多行框不许有 `field-sizing`**（那是这条规矩的对象），
       单行输入框不在它的范围内。 */
    const proseBody = declarationRules(css)
      .filter(rule => rule.selector.includes('.itemProse'))
      .map(rule => rule.body)
      .join('\n')
    expect(proseBody, '多行写入框有 `field-sizing`：框会随每一次键入自己长高，而高度是读者的')
      .not.toContain('field-sizing')
    expect(css.includes('::-webkit-resizer'), '在给一个不存在的原生抓手化妆').toBe(false)
    /* 读**声明**，不写一条带前瞻的正则：`resize\s*:\s*(?!none)` 会被回溯放过——`\s*`
       可以只吃零个空白，于是前瞻去看那个空格，正好「不是 none」。数出来的值不会骗人。 */
    const resizes = declarationRules(css)
      .flatMap(rule => [...rule.body.matchAll(/(?:^|[;{\s])resize\s*:\s*([^;]+)/g)].map(hit => (hit[1] as string).trim()))
    expect(resizes.filter(value => value !== 'none'), `能被原生拖拽的文本域：${resizes.join('、')}——拖拽区是那条抓条，整条下沿`)
      .toEqual([])
    // 抓条站在框内下沿之上，而它站的那一格由框自己的下衬让出来：抓条一档空气、
    // 内衬两档，所以最后一行字永远不会落在它底下。
    expect(sizeIn('.itemProseGrip', 'block-size'), '抓条的高度不再是那一档空气').toBe('var(--s2)')
    expect(sizeIn('.itemProse', 'padding-block-end'), '框下沿不再为抓条留两格空气，最后一行字会被它盖住')
      .toBe('calc(2 * var(--s2))')
  })

  it('一个日期框：两个界面都导入它，谁也不自己读日期', () => {
    for (const file of ['client/item/detail-pane.tsx', 'client/item/item-create-dialog.tsx']) {
      const source = code(readSource(file))
      expect(source, `${file} 读不到了`).not.toBe('')
      expect(source, `${file} 没有用那个共用的写入框`).toContain("from './prose-field.tsx'")
      expect(source, `${file} 没有用那个共用的日期框`).toContain("from './date-field.tsx'")
      expect(source, `${file} 自己读日期了：判定必须是 readDateDraft，拒绝由 DateField 说`)
        .not.toMatch(/\bparseItemDate\s*\(/)
    }
  })

  it('那句话只有一处拼出来，别处都是问它', () => {
    /* **判据变了，因为结构变了**：拒绝从一句话变成三句（不认识的写法 / 今年已经过了 /
       日历上没有这一天——三种改法），而它们仍然只该有一个出口。所以现在钉两件事：
       句子的键只许出现在 `date-field.tsx`，而**拼句子的那个函数**由别处调用。 */
    const spellers = itemSurfaceFiles().filter(file => code(file.source).includes('item.dates.bad.')).map(file => file.path)
    expect(spellers, `拼「这个读法我没读懂」的文件：${spellers.join('、') || '（一个都没有）'}——同一句拒绝只该有一个出口`)
      .toEqual(['date-field.tsx'])
    const askers = itemSurfaceFiles().filter(file => code(file.source).includes('dateBadWords(')).map(file => file.path)
    expect(askers.sort(), `问那句话的文件：${askers.join('、')}——那三句拒绝只有这一个出口`)
      .toEqual(['date-field.tsx'])
  })

  it('一张纸上只有一个保存控件，而它是那个表面的', () => {
    /* **两个保存控件就是读者猜不出哪一个带着他刚填的字段。** 所以这条钉的是「那张纸上
       到底有几枚保存动词」：只剩纸尾那一枚，而它的词是这张纸自己的。 */
    const sheet = code(readSource('client/item/item-create-dialog.tsx'))
    expect(sheet, '新建那张纸自己不再有保存动词了').toContain("t('item.create.submit')")
    // 全表扫一遍：`item.create.submit` 只许出现在这张纸上，别处再画一枚就是第二个保存控件。
    const drawers = itemSurfaceFiles().filter(file => code(file.source).includes('item.create.submit')).map(file => file.path)
    expect(drawers, `画保存动词的文件：${drawers.join('、')}——同一张纸上只该有一处`).toEqual(['item-create-dialog.tsx'])
  })

  it('同一个字段的词只有一份：那张纸的词不许被别处读走', () => {
    /* 「正文（可留空）」那一句本来是照新建纸的排版写的，却被详情那一栏拿去当了占位——
       于是同一句在地面上说不通的话，出现在两个地方。字段的词归 `item.field.*`，
       那张纸自己的词（它的标题、它的按钮、它的段名）归 `item.create.*`。 */
    const readers = itemSurfaceFiles().filter(file => code(file.source).includes('item.create.')).map(file => file.path)
    expect(readers, `读新建那张纸的词的文件：${readers.join('、')}`).toEqual(['item-create-dialog.tsx'])
  })
})

/**
 * 这一轮的统一：**同一件事被写了两遍**的那一类病。
 *
 * 七处缺陷是同一个形状——一句话、一个数、一副骨架在四个地方各抄了一份，于是改一处不报错，
 * 而屏上「同一件事在两个位置上长得不一样」。所以这一节的每条断言问的都是**出口数**：
 * 那枚入口有几处渲染、那个数有几处声明、那副骨架有几处写、那句常驻的话还剩几个使用者。
 * 每一条都配一个「咬得动」的对照——一条不能失败的检查比没有检查更坏。
 */
describe('说明小字：一处机制、一处数字、一副骨架', () => {
  const css = panelCss()
  /** 只读清单那一张表：看板那张表里的同族规则是另一个表面上的另一件事。 */
  /** JS/TS 注释剥掉：散文里提到一个类名不算一次使用（硬性规范 14）。 */
  const code = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  /**
   * 哪些文件自己渲染了一枚「这里有一句话」的按钮。
   *
   * 读的是**两样一起**：那一族的类名（`.itemGroupWhy`）与 `aria-controls`。只读
   * `aria-controls` 会把这一页上另外几枚折叠头一起收进来（命令面板、左栏、行末的 ⋯ 各有
   * 自己的 `aria-expanded`/`aria-controls`，那是对的），于是这条闸门会永远红着——而一条
   * 永远红的闸门与一条永远绿的一样，读的人最终都不再看它。
   * @param files - 清单半区的源文件。
   * @returns 自己渲染那枚按钮的文件名。
   */
  const inlineNoteButtons = (files: readonly { readonly path: string; readonly source: string }[]): string[] =>
    files
      .filter(file => {
        const text = code(file.source)
        return text.includes('css.itemGroupWhy') && /aria-controls=\{/.test(text)
      })
      .map(file => file.path)

  it('那枚 ⓘ 只有一处渲染：十二行只留一份', () => {
    /* 它是一枚**真按钮**：可达名、`aria-expanded`、`aria-controls` 三样都在，所以它比一枚记号
       多出四行。抄成五个副本之后，第一个先过期的一定是 `aria-controls` 指到的那一句——而指错了
       的按钮在屏幕上与对的那一枚长得一模一样，读屏读到的却是别人的话。 */
    const owners = inlineNoteButtons(itemSurfaceFiles())
    expect(owners, `内联那枚按钮的文件：${owners.join('、') || '（一个都没有）'}——那 12 行只许有一份（group-head.tsx 的 NoteEntry）`)
      .toEqual(['group-head.tsx'])
  })

  it('咬得动：第二个副本会长出来，而读法会报', () => {
    const planted = [
      { path: 'group-head.tsx', source: '<button className={css.itemGroupWhy} aria-expanded={note.open} aria-controls={note.id} />' },
      { path: 'detail-pane.tsx', source: '<button className={css.itemGroupWhy} aria-expanded={cardNote.open} aria-controls={cardNote.id} />' },
    ]
    expect(inlineNoteButtons(planted), 'the plant did not bite').toEqual(['group-head.tsx', 'detail-pane.tsx'])
    /* **另一半对照：别处的 `aria-controls` 不算这一族。** 命令面板、左栏、行末的 ⋯ 各有自己的
       折叠头（`aria-expanded` + `aria-controls` 是对的），把它们的开合读成这一族的副本，这条
       闸门就会永远红着——那正是「一个不看上下文的检查器」（硬性规范 14）。 */
    expect(inlineNoteButtons([{ path: 'rail.tsx', source: '<button aria-expanded={open} aria-controls={id} />' }]),
      '别处的折叠头被当成了这一族的一份').toEqual([])
  })

  it('五个消费点都经那一枚入口（四个位置 + 组头自己）', () => {
    /* 入口只有一处渲染（上一条），这一条钉的是**谁在用**：位置漏一个，那一处就会自己长回一份
       内联的按钮——而它长回来的样子正是上面那条闸门要报的那一种。 */
    for (const file of [
      'client/item/group-head.tsx',
      'client/item/pages/schedule.tsx',
      'client/item/item-create-dialog.tsx',
      'client/item/detail-pane.tsx',
      'client/item/run-config-block.tsx',
    ]) {
      const source = code(readSource(file))
      expect(source, `${file} 读不到了`).not.toBe('')
      expect(source, `${file} 没有用那枚共用的入口`).toMatch(/<NoteEntry\b|NoteEntry note=/)
    }
  })

  it('常驻的只剩那一条事实，而搬进 ⓘ 的那一句仍然有一扇门', () => {
    /* **够得上按需的收进 ⓘ，够不上的原样留下**——这条闸门钉的是那个决定没有被下一次改动悄悄抹平。
       「没有看板可写」那一条是**这一格的答案本身**（状态），所以常驻；而「它正在跑——这一条会
       接着说进那条会话」说的是**按下去之后的后果**，是一句条件句，常驻就把条件读成了事实
       （读者的原话：不要显示在它旁边）。它现在是一枚 ⓘ：指着偷看一句、按下去留住
       （触屏没有 hover，所以按得动是承重的）。 */
    const users = itemSurfaceFiles()
      .flatMap(file => [...code(file.source).matchAll(/css\.itemOptsFoot/g)].map(() => file.path))
    expect(users.length, `常驻脚注的使用者：${users.join('、')}——剩下的应当只有那一格答案`)
      .toBe(1)
    const detail = code(readSource('client/item/detail-pane.tsx'))
    expect(detail, '那一格答案不见了').toContain("t('item.status.card')")
    expect(detail, '搬走的那一句不见了').toContain("t('item.ask.continues')")
    expect(detail, '搬走的那一句又变回常驻了——它是一句条件句，不是这一条的现状')
      .toMatch(/running && \(\s*<span data-note=\{askNote\.open/)
  })

  it('说明小字的限宽是一个数，而且按**物理行长**给', () => {
    /* `ch` 是「这一档字号下 0 的宽度」，中文一个字有它近两倍宽：`46ch` 在 12px 下只有
       297.56px，约 23 个汉字，而这一页最长的那一句有 **43** 个字（量出来单行 516px，
       加上让出左沿的一档是 532px）——必然折两行、右边留一大片空。
       `em` 才是中文的尺子（一个字一个 em）。 */
    expect(declaredOf(css, 'itemRoot', '--item-note-measure'), '限宽没有在令牌层声明一次')
      .toHaveLength(1)
    expect(lastDeclaredOf(css, 'itemNote', 'max-inline-size'), '说明不再读那枚令牌')
      .toBe('var(--item-note-measure)')
    expect((lastDeclaredOf(css, 'itemRoot', '--item-note-measure') ?? '').endsWith('em'),
      '限宽不是按字（em）给的——按 ch 给就是把行长说成「多少个 0」').toBe(true)
    // 咬得动：按 `ch` 写回去的那一版必须被读出来——读法是同一个 `lastDeclaredOf`。
    expect(lastDeclaredOf(`${css}\n.itemNote { max-inline-size: 46ch; }`, 'itemNote', 'max-inline-size'),
      'the plant did not bite — 按 ch 写回去的那一版没有被读出来').toBe('46ch')
  })

  it('安静行与节头是同一副骨架：头 / 说明 / 内容之间同一档', () => {
    /* 安静行是**零行的节**，不是另一种节。它此前是一个没有 gap 的列，于是那句话说在药丸下沿上，
       而节头下面同样那句话隔着一档——同一个零件（`.itemNote`）在两处两个距离。 */
    const quiet = lastDeclaredOf(css, 'itemQuiet', 'gap')
    expect(quiet, '安静行没有 gap——它那句说明会贴在药丸上').toBeDefined()
    expect(quiet, '安静行与节头的骨架不是同一档').toBe(lastDeclaredOf(css, 'itemAgendaBlock', 'gap'))
    expect(quiet).toBe('var(--s2)')
    // 咬得动：把 gap 拿掉的那一版（这一轮修掉的那一版）读出来是 undefined。
    expect(lastDeclaredOf(panelCss().replace(/\.itemQuiet \{[^}]*\}/, '.itemQuiet { display: flex; }'), 'itemQuiet', 'gap'))
      .toBeUndefined()
  })

  it('展开区三段：两个间距是两个数，段名三个都在', () => {
    /* 「段名与它引入的内容」比「段与段」近一档——名字属于它下面那一段。曾经只有一个 `--s3`，
       而「近一档」是拿 `.itemOpenCaption` 的 `margin-block-end: calc(var(--s1) * -1)` 凑的：
       那一句**从来没生效过**（`<p>` 上的 margin 在本面板里一律无效），所以两个数一直是一个数。 */
    expect(lastDeclaredOf(css, 'itemOpenText', 'gap'), '三段之间不再读那个令牌')
      .toBe('var(--item-open-section-gap)')
    expect(lastDeclaredOf(css, 'itemOpenSection', 'gap'), '段名与它引入的内容之间不再读那个令牌')
      .toBe('var(--item-open-caption-gap)')
    expect(declaredOf(css, 'itemRoot', '--item-open-section-gap')).toHaveLength(1)
    expect(declaredOf(css, 'itemRoot', '--item-open-caption-gap')).toHaveLength(1)
    // 段名自己不再带外边距：那一条是无效的那一条（`<p>` + UA 重置 specificity (0,1,1)）。
    expect(declaredOf(css, 'itemOpenCaption', 'margin-block-end'),
      '段名的外边距又写回来了——它在本面板里算 0，于是第三个「看起来在被遵守」的数').toEqual([])
    // 三段各有一个段名：正文 / 步骤 / 上下文备注。
    const detail = code(readSource('client/item/detail-pane.tsx'))
    expect([...detail.matchAll(/itemOpenCaption/g)].length, '左列不是三段各有段名').toBe(3)
  })

  it('附件条：芯片一行、句子带地板，而那一行不许长大', () => {
    /* 句子与芯片**同排**，装不下就整句换行；那一行**不长大**——长大了它就把句子推到整行的
       最右边（量到过：736 宽的一格里装了 24px 的「＋」，而句子落在离它 440px 的右端），
       而句子是来解释左边那几样东西的。 */
    expect(lastDeclaredOf(css, 'attachStrip', 'flex-wrap'), '附件条不再换行：句子只能挤在芯片旁边').toBe('wrap')
    expect(lastDeclaredOf(css, 'attachRow', 'flex'), '那一行要么被压扁、要么把句子推到最右边').toBe('0 1 auto')
    expect(lastDeclaredOf(css, 'attachRow', 'min-inline-size'), '芯片那一行没有地板，会被压成零宽').toBe('0')
    expect(lastDeclaredOf(css, 'attachHint', 'min-inline-size'),
      '句子没有宽度地板——窄一点它就是一根一个字一行的竖条（412 上真的量到过十一行单字）')
      .toBe('min(22em, 100%)')
  })

  it('属性表的字段名自己是一枚盒子：它要能参与那一行的对齐', () => {
    /* 那一行里也站着一枚 ⓘ，而「字段名」这三个字本来是一段**裸文本**：裸文本在行里是一枚
       匿名盒子，谁都点不到它——样式表里写不出它的名字，审计也认领不到它，于是「字与记号在
       不在同一条线上」既改不了、也量不了。现在这三个字由这一枚盒子装着，垂直位置由那一行
       居中给（这一条里**不写任何数**：按字体量出来的补偿在一种字体上是对的，换一套度量就偏
       半格，而屏上没有任何一处会说这句话）。
       只读清单那一张表：字段名这枚盒子只在这一张表里，看板那张表是另一个表面上的另一件事。 */
    const sheet = stripCssComments(itemSheet())
    expect(rulesOf(sheet, 'itemOptNameText').join('\n'),
      '字段名那枚盒子在表里没有规则——它和裸文本就是同一件事，那一行的对齐又只能靠运气').not.toBe('')
    expect(lastDeclaredOf(sheet, 'itemOptName', 'align-items'),
      '字段名那一行不按中线对齐，那枚盒子不在任何一条对齐的线上').toBe('center')
    expect(code(readSource('client/item/item-create-dialog.tsx')), '字段名又变回了裸文本')
      .toContain('css.itemOptNameText')
    // 咬得动：把那一枚盒子从表里拿掉（同名规则换成别的类），读法必须说「没有规则」。
    const planted = sheet.replace(/\.itemOptNameText\s*\{[^}]*\}/, '.itemElsewhere { min-inline-size: 0; }')
    expect(rulesOf(planted, 'itemOptNameText').join('\n'),
      'the plant did not bite — 那一枚盒子拿掉之后还读得到规则').toBe('')
  })
})

/* ── 药丸的几何：一条基座，微调一个也没有 ─────────────────────────────────────
 *
 * 这一页只有一条对齐机制（胶囊把装字的盒子居中），而它此前是**每个族各写一遍**：一个族漏掉
 * 一条时，屏上只表现为「那一枚的字有点歪」，没有任何一处说得出为什么。所以判据不落在「量出来
 * 多少像素」上，而落在**结构**上：基座那一条必须在、基座列出的族里不许再有第二份几何、逐元素
 * 的竖向微调（照一种字体试出来的长度）一个也不许有。
 *
 * 读法先剥注释（硬性规范 14）：注释里出现「vertical-align」不是一次声明——这一条自己就要被
 * 下面那个「种一颗」的用例证明。 */
describe('药丸的几何只写一次', () => {
  const css = stripCssComments(itemSheet())
  const FAMILIES = ['itemOpt', 'itemPrioChip', 'itemTag']
  /* `line-height` 不在这张表里，这是量出来的：**行盒是每一族自己那一档**（`itemTag` 16px、
   * `itemOpt` 12px），而「由高度推出来」的那一版反而读到 −0.5px（`DESIGN.md` 那一节有两条
   * 读数）。所以行盒跟着族走，要收敛的是**高度**——一族一档，写一次。 */
  const SHARED = ['display', 'align-items', 'justify-content', 'box-sizing']

  /** 一条规则体里的声明，`{ 属性: 值 }`。 */
  const declsOf = (body: string): Map<string, string> => {
    const out = new Map<string, string>()
    for (const match of body.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:\s*([^;}]+)/g)) {
      out.set(match[1] as string, (match[2] as string).trim())
    }
    return out
  }

  /* 逐元素的竖向微调：值既不是关键词、也不是由令牌推出来的算式，就算一条。**只认负数**的
   * 那一半是有意的：`margin-block-end: 1px` 是排版里的空气（正数），而把一枚记号往上挪才是
   * 一次「微调」。 */
  const nudgesOf = (text: string): string[] => declarationRules(stripCssComments(text))
    .flatMap(rule => {
      const decls = declsOf(rule.body)
      const found: string[] = []
      const watched: readonly (readonly [string, boolean])[] = [
        ['vertical-align', false], ['translate', false],
        ['margin-block-start', true], ['margin-block-end', true],
      ]
      for (const [property, negativeOnly] of watched) {
        const value = decls.get(property)
        if (value === undefined) continue
        if (/^[a-z-]+$/.test(value)) continue
        if (/^(calc|min|max|clamp)\(/.test(value)) continue
        if (negativeOnly && !/^-/.test(value)) continue
        found.push(`${rule.selector.replace(/\s+/g, ' ').trim()} { ${property}: ${value} }`)
      }
      return found
    })

  it('两块表里的基座是同一套机制：声明相同，各自命中各自的节点', () => {
    /* 构建是 CSS Modules：同一个字面类名在两个表里编出两个不同的运行时类，所以基座
       必须在两个表里各写一次——只写在共用表里，清单的药丸在生产包里回到 UA 的行内块，
       字全部偏上，而工件页因为字面类名拼接看着全绿。两个拷贝结构一致，由这一条数着：
       改一处不改另一处就红。 */
    const itemBase = declarationRules(css)
      .find(rule => rule.selector.replace(/\s+/g, ' ').trim() === ':where(.itemOpt, .itemPrioChip, .itemTag)')
    expect(itemBase, '清单表里的药丸基座不见了——生产包里的药丸回到 UA 行内块').toBeDefined()
    /* 共用的一半现在在 design 表里，而且只写它自己拥有的类。旧写法把清单那三个药丸类
       也列进共用表的选择器——那是跨表的类名，编出来的是本表永远不渲染的哈希，声明被丢掉
       且不报错。 */
    const boardBase = declarationRules(stripCssComments(designCss()))
      .find(rule => rule.selector.includes(':is(') && rule.selector.includes('.chip'))
    expect(boardBase, '共用表里的基座不见了').toBeDefined()
    for (const property of ['display', 'align-items', 'justify-content'] as const) {
      const itemValue = declsOf(itemBase?.body ?? '').get(property)
      const boardValue = declsOf(boardBase?.body ?? '').get(property)
      expect(itemValue, `清单基座不再声明 ${property}`).toBeDefined()
      expect(boardValue, `两块表分叉了：${property} 在清单是 ${itemValue}，在共用表是 ${boardValue}`).toBe(itemValue)
    }
    // 清单的类由清单那张表自己列——那是唯一渲染得出它们的表。
    for (const name of FAMILIES) {
      expect(itemBase?.selector, `清单表基座的名单里没有 .${name}`).toContain(`.${name}`)
    }
  })

  it('药丸文字有自己的槽，而不是裸文本匿名项', () => {
    /* 看板 `Chip` 的 `.chipBody` 在这一侧的同形：裸文本在 flex 药丸里是匿名项，
       各浏览器与各字体放的位置不一样；包成槽之后居中的是槽。输入框没有孩子，
       走行盒那条路，不用它。 */
    const slot = declarationRules(css).find(rule => rule.selector.replace(/\s+/g, ' ').trim() === '.itemPillText')
    expect(slot, '文字槽 .itemPillText 不见了——药丸回到裸文本匿名项').toBeDefined()
    expect(declsOf(slot?.body ?? '').get('display'), '文字槽不再是块级盒').toBe('block')
  })

  /* **按钮与输入框继承产品字体。** UA 给表单控件自己的一套字，中文按字回退到另一套
     字体——度量与产品字栈不一样，桌面与手机还各不一样。「盒子居中了、字还是偏」剩下的
     那一半就是它：同一枚药丸在两台设备上是两套字。

     **顶栏那两枚已经不在名单里**：`.itemTopBarChip` / `.itemNewButton` 现在是共用
     `Button` 的布局把手（`flex: none` / 窄档整宽），外观由 `design/components.module.css`
     给——在那里给这一枚按钮写第二条 `font-family` 是把两页的字又分一次家。这一页的
     按钮字体由 `board.module.css` 的设计系统层兜住
     （`[data-dsh-taskboard-view] :where(button, input, select, textarea) { font-family: inherit }`），
     那是比逐个类更宽的一条：这一页上**每一枚**按钮与输入框都落在它下面。 */
  const FORM_CONTROLS = ['itemOpt', 'itemTag', 'itemTagAdd', 'itemOptNaming', 'itemRailNavBtn', 'itemRailToday', 'itemRowAttach', 'itemRailRow', 'itemFacetChip', 'itemArchiveToggle', 'itemRowCardChip']

  /* 共用的字段不在这张表里：它的字由 `SearchField`（design 表）给，而这张表只扫清单自己
     的表。它被单独点名，是因为这页顶栏那一格正是它——把「这里不用 UA 的字」这条判据
     留在清单页，等于留了一个没人看的证明。 */
  const SHARED_CONTROLS = ['searchField']

  const declsFor = (text: string, name: string): Map<string, string> => {
    const out = new Map<string, string>()
    for (const rule of declarationRules(stripCssComments(text))) {
      for (const one of rule.selector.split(',')) {
        const normalized = one.replace(/\s+/g, ' ').trim().replace(/^[a-zA-Z]+\./, '.')
        if (normalized !== `.${name}`) continue
        for (const [property, value] of declsOf(rule.body)) out.set(property, value)
      }
    }
    return out
  }

  const controlsMissingFont = (text: string, controls: readonly string[] = FORM_CONTROLS): string[] => controls.filter(name => {
    const decls = declsFor(text, name)
    return !/inherit/.test(decls.get('font-family') ?? decls.get('font') ?? '')
  })

  it('按钮与输入框继承产品字体，不读 UA 那套字', () => {
    const design = designCss()
    const missing = [...controlsMissingFont(css), ...controlsMissingFont(design, SHARED_CONTROLS)]
    expect(missing, `这些控件的字是 UA 给的，不是产品字栈的：${missing.join(', ')}——中文按字回退，桌面与手机各用一套度量`).toEqual([])
    const planted = [...FORM_CONTROLS, ...SHARED_CONTROLS].map(name => name === 'itemOpt'
      ? '.itemOpt { color: red; }'
      : `.${name} { font-family: inherit; }`).join('\n')
    expect(controlsMissingFont(planted, [...FORM_CONTROLS, ...SHARED_CONTROLS]), 'the probe bites').toEqual(['itemOpt'])
  })

  it('基座列出的族里，没有第二份几何', () => {
    const redeclared = FAMILIES.flatMap(name => declarationRules(css)
      .filter(rule => rule.selector.replace(/\s+/g, ' ').trim() === `.${name}`)
      .flatMap(rule => {
        const decls = declsOf(rule.body)
        return SHARED.filter(property => decls.has(property)).map(property => `${name} { ${property} }`)
      }))
    expect(redeclared,
      `这些族各自又声明了一遍几何：${redeclared.join(', ')}——第二份定义只会和基座悄悄分叉`).toEqual([])
  })

  it('清单表里没有逐元素的竖向微调', () => {
    const found = nudgesOf(css)
    expect(found,
      `这些是按字体试出来的竖向长度：${found.join(', ')}——换一套度量就把那一枚从邻居那条线上挪开半个到一个像素`).toEqual([])
  })

  it('the probe bites: 三种微调都读得出来，关键词、正数与算式不误报', () => {
    expect(nudgesOf('.itemTag { vertical-align: 1px; }'), 'the plant did not bite')
      .toEqual(['.itemTag { vertical-align: 1px }'])
    expect(nudgesOf('.itemRowDots { margin-block-start: -3px; }'), 'the plant did not bite')
      .toEqual(['.itemRowDots { margin-block-start: -3px }'])
    expect(nudgesOf('.itemTag { translate: 0 -1px; }'), 'the plant did not bite')
      .toEqual(['.itemTag { translate: 0 -1px }'])
    expect(nudgesOf('.itemPrioButton { vertical-align: top; }'), '关键词被误报').toEqual([])
    expect(nudgesOf('.itemStepKind { margin-block-end: 1px; }'), '排版里的正数空气被误报').toEqual([])
    expect(nudgesOf('.itemRowDots { margin-block-start: calc((var(--item-row-line) - var(--item-dots-h)) / 2); }'),
      '由令牌推出来的算式被误报').toEqual([])
    expect(nudgesOf('/* vertical-align: 1px; */ .itemTag { color: red; }'), '注释里的字样被当成声明').toEqual([])
  })

  /* **行盒必须是声明过的数。** 看板那边不出问题的一半原因就在这里：它的胶囊自己说行盒
   * （`.chip { line-height: 1.5 }`）。清单这边漏过一处——日期轴那一行的标签落到 `normal`，
   * 于是珠子按一种字体凑出来的 `5px` 只在那种字体上落在中线上，手机上就看见「珠子与
   * 开始/计划/截止不在一条线上」。缺省的行盒跟着字体度量走，屏上没有任何一处说得出这句话。 */
  const normalLineBoxes = (text: string): string[] => declarationRules(stripCssComments(text))
    .filter(rule => declsOf(rule.body).get('line-height') === 'normal')
    .map(rule => rule.selector.replace(/\s+/g, ' ').trim())

  it('每一处行盒都是声明过的数，不是字体给的 normal', () => {
    const found = normalLineBoxes(css)
    expect(found, `这些行盒是字体给的，不是我们给的：${found.join(', ')}`).toEqual([])
    expect(normalLineBoxes('.x { line-height: normal; }'), 'the probe bites').toEqual(['.x'])
  })

  it('珠子落在标签那一行的中线上，位置由两个令牌算出来', () => {
    const axis = declarationRules(css).find(rule => rule.selector.replace(/\s+/g, ' ').trim() === '.itemDateAxis li')
    const top = declsOf(axis?.body ?? '').get('--item-bead-top') ?? ''
    expect(top.startsWith('calc('), `珠子又挂在一个长度上了：${top}——换一套字体度量就偏`).toBe(true)
    expect(top, '珠子那个算式里没有行盒令牌').toContain('var(--item-date-line)')
    expect(top, '珠子那个算式里没有珠子自己的令牌').toContain('var(--item-bead-size)')
    const label = declarationRules(css).find(rule => rule.selector.replace(/\s+/g, ' ').trim() === '.itemDateAxis li > b')
    expect(declsOf(label?.body ?? '').get('line-height'), '标签那一行不再声明行盒，珠子就没有可算的中线')
      .toBe('var(--item-date-line)')
  })
})
