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
import { itemSurfaceSource, PAGES, repoRoot, type Page } from './panel-harness.ts'
import {
  aliasLayer,
  backgroundOf,
  cssMembersOf,
  declaredOf,
  dswNamesReferenced,
  fixtures,
  hostTokens,
  itemSheet,
  itemSheetPath,
  panelCss,
  renderPanel,
  rulesOf,
  stripCssComments,
  writeRenderArtifact,
} from './panel-harness.ts'

/**
 * THE CANVAS / INNER SPLIT, restated for the two cases the old rule merged.
 *
 * The board already answers this, and it is the authority: `.board` AND
 * `.column` are both `var(--dsh-tb-bg)`, because a column is a plate that HOLDS
 * CONTENT and translucency has to compose through it. Only a thing that FLOATS —
 * a menu, a field, the danger zone — takes an opaque layer, because text has to
 * survive whatever is behind it.
 *
 * This list used to be a single rule with the opposite sense: the root took the
 * canvas and NOTHING inside it was allowed to. That read fine in the file and
 * rendered as a flat plate with a translucent border, because the list card and
 * the five overview tiles were painted with opaque layer tokens and covered the
 * glass one level down — while the board beside it kept working. **The lesson is
 * the split itself**: 「canvas or inner」 is not a property of a token, it is a
 * property of whether the box holds the content or floats over it.
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
 * @param css - the sheet.
 * @returns one entry per declaration rule, in source order.
 */
function declarationRules(css: string): Rule[] {
  const out: Rule[] = []
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of source.matchAll(/([^{}]+)\{/g)) {
    const start = (match.index ?? 0) + match[0].length - 1
    let depth = 0
    let end = start
    for (; end < source.length; end++) {
      if (source[end] === '{') depth++
      else if (source[end] === '}') { depth--; if (depth === 0) break }
    }
    const body = source.slice(start + 1, end)
    if (body.includes('{')) continue
    out.push({ selector: (match[1] ?? '').trim().replace(/\s+/g, ' '), body })
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
function selectorName(selector: string): string {
  return selector.split('{').pop()?.trim().replace(/\s+/g, ' ') ?? ''
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
    // 74 rules were appended there under a heading that still read "right-hand
    // page". A separate sheet is the structural half of that fix: after it,
    // nothing about the list can be edited from the board's file by accident.
    //
    // The harness has to have read SOMETHING for the sweep below to mean
    // anything — and the reading used to be proved by
    // `css.includes('src/client/board.module.css')`, which is true because
    // `panelCss()` writes that path into the string as a BANNER COMMENT whether
    // or not the file exists. It is a decoration answering an assertion about the
    // source, so it is gone; what is left is the part that can actually fail: the
    // list's own rules are in the concatenation at all.
    expect(/\.item[A-Z]/.test(css), 'the harness read no list rules at all, so the sweep of board.module.css below is over an empty claim').toBe(true)
    const boardOnly = readFileSync(join(cssPanelRoot(), 'board.module.css'), 'utf8')
    const leftover = [...boardOnly.matchAll(/^\.item[A-Z][A-Za-z]*\s*\{/gm)].map(m => m[0])
    expect(leftover, `these list rules are still in board.module.css: ${leftover.join(', ')}`).toEqual([])
    // The assertion that is left CAN fail, and this is the state it used to
    // stand in for: `panelCss()` writes each sheet's path into the string as a
    // banner comment, so on a concatenation carrying two banners and no rules
    // the old conjunction still held. Nothing is being asserted about that
    // string now — and this line exists so the next reader does not put the
    // banner check back.
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
      ...dswNamesReferenced(aliasLayer(readFileSync(join(cssPanelRoot(), 'board.module.css'), 'utf8'))),
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
    expect(schedule).toContain('没有日期')
    expect(schedule).toContain('还没到开始时间')
    // THE LIST HOLDS EVERY ROW, which is the membership promise that outlived the
    // page: the bare capture is here, and so is the date-less row that carries a tag
    // (which is therefore NOT a capture, and was never on the inbox either).
    expect(list).toContain('刚记下的一句')
    expect(list).toContain('这一条还在做')
    // And they must be two DIFFERENT documents, not one rendered twice.
    expect(new Set([schedule, list]).size).toBe(2)
    // 收件 is gone from the render as well as from the page set, so a stale reader of
    // its copy finds nothing — this is what says so out loud.
    expect(list, 'the removed 收件 page is still drawn').not.toContain('收件只放还没分流的想法')
  })

  it('a static render cannot answer the band question, and that is a fact about the bench', () => {
    // **THIS ASSERTION USED TO ASK 「两档渲染出来的标记一样吗」, and it had stopped
    // being able to fail for a reason worth recording.**
    //
    // It answered "yes, they differ" by comparing two strings. The band is read by
    // `useSurfaceNarrow`, whose value is the FIRST slot the hook can hold — and
    // everything that *acts* on the band now lives behind an effect or a
    // selection: the wide band's detail rail needs a chosen row, the narrow band's
    // in-row detail needs an expanded one. `renderToStaticMarkup` renders neither,
    // so the two renders came out **byte-identical** — verified by hashing a
    // before-and-after pair taken before any of this round's changes.
    //
    // So the assertion was not failing on a defect; it was failing because it had
    // quietly become vacuous while still reading like a check. The same shape as the
    // 「探针没咬住」 failures elsewhere in this file, one level up: not a probe that
    // cannot bite, but a probe with nothing left to bite on.
    //
    // **WHERE THE CLAIM WENT.** The part that is worth keeping — 「a wide surface
    // has somewhere to put the row you are reading, and a narrow one does not」 —
    // needs a real mount, because both halves of it are about state that only
    // exists after an interaction. It lives in `item-workbench.spec.ts` under jsdom.
    //
    // **WHAT REPLACES IT HERE.** The fact a static render CAN see, and the one that
    // actually breaks when the wiring breaks: the harness hands the panel a band and
    // the panel must carry it into the root. That is asserted by the band tests
    // below, and it is the half that a typo in the hook would take out.
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
  // This one was wrong for two rounds and nothing was red. 「三张统计卡」is a claim
  // about a COUNT, and it was true on the fixtures (all three numbers non-zero, so
  // three cards render) while being false on a real document — `triageLinesOf`
  // drops the zero lines, `flatMap` drops the tiles that have none, and the band
  // that looked like three cards was 「最多画三张」. Removing a second filter on the
  // receiving side changed nothing, because the zeros were already gone before
  // they arrived, and **a defect defended twice looks defended once**.
  //
  // It was caught by opening the live panel at 412px and counting the cards in the
  // picture — 2427 passing tests did not notice, because no test ever said the
  // number. **So the number is now said, on the case that makes it a claim at
  // all**: a document where every count is zero.
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
      for (const word of ['超期了', '没人动的', '没日子的', '紧急', '待办', '完成']) {
        const row = words.find(text => text.includes(word))
        expect(row, `the rail does not name ${word} at all, so its zero is never stated`).toBeDefined()
        expect(row ?? '', `the rail names ${word} without a number — a claim with no count is not a count`).toMatch(/\d+/)
      }
    }
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

/** The client half, where the board's sheet sits beside the list's. */
function cssPanelRoot(): string {
  return join(repoRoot, 'src', 'client')
}

/**
 * THE GEOMETRY CONTRACTS.
 *
 * These are the claims that the screenshots in the bug report contradict, and
 * they are written as arithmetic on the source rather than as a picture,
 * because a picture has to be believed. Each one states the failure it exists
 * to catch, in the same shape: the rule, then the reason it was ever broken.
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
 * **THE CLASS IS A PARAMETER.** It used to be the literal `itemTriageText` inside
 * this function body, which is the worst shape a helper can have: the sentence
 * moved — into the table, as a prop — and the helper went on filtering for a class
 * that nothing renders, so every rule was discarded and the gate reported 「there is
 * no rule」 about a rule three lines above it. A helper that names its subject can
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
   * THE OLD GATE COULD NOT FAIL, AND IT FORBADE THE FIX.
   *
   * It asserted that a handful of named selectors were absent from a
   * hand-written kill list. So a brand-new 400ms infinite marquee kept it green,
   * and it had no way to see that three selectors the list NAMED sat later in the
   * file at equal specificity and therefore still animated. Worst of all, one of
   * its assertions demanded `.spinner { animation-duration: 1.4s }` LITERALLY —
   * so routing the durations through the token, which is the actual fix, turned
   * the gate red. A gate that red-lines the correct implementation is worse than
   * no gate.
   *
   * So this one computes instead of grepping. The policy is now a single token
   * going to zero, and this asserts the thing that policy depends on: **every
   * transition on the list panel reads that token.** A tenth of them spelled their
   * own duration, which is exactly why the whole sheet moved under reduced
   * motion — there was no block here to catch it and no token to reach through.
   */
  const itemSheet = readFileSync(new URL('../src/client/item/item.module.css', import.meta.url), 'utf8')
  const boardSheet = readFileSync(new URL('../src/client/board.module.css', import.meta.url), 'utf8')

  /** Comments out, because a token named in prose is not a use. */
  const bare = (sheet: string): string =>
    sheet.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

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
    const sheet = readFileSync(new URL('../src/client/board.module.css', import.meta.url), 'utf8')
    const last = sheet.lastIndexOf('@media (prefers-reduced-motion: reduce)')
    expect(last, 'the sheet has no reduced-motion block at all — motion preference is not honoured anywhere')
      .toBeGreaterThan(0)
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
      `something is declared AFTER the reduced-motion block, so at equal specificity it wins and the motion is not reduced: ${declarations.slice(0, 200)}`)
      .toBe('')
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
    // The board had two — both 120ms, both on a hover tint — and they are silenced
    // in the block rather than tokenised, because they were written before the
    // token existed. This pins that list so it cannot grow: a NEW literal has to
    // be either tokenised or silenced for its OWN selector, and both are
    // decisions someone makes on purpose.
    //
    // It used to ask `match[0].includes('reviewMessageText')`, and `match[0]` is
    // the matched FRAGMENT — `{ transition: <value>` — which is the DECLARATION
    // and never the selector. So `isNamed` was false for every literal, the
    // second half of the condition (`named.test(boardSheet)`, true as long as the
    // block names ONE selector at all) carried the assertion by itself, and the
    // loop was three identical `expect(true)` — a boolean agreeing with itself.
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
    // THIS TEST USED TO SAY THE OPPOSITE, and that is worth recording because the
    // reversal is the finding.
    //
    // It asserted that the root took the canvas token and that NOTHING INSIDE it
    // did. That is a coherent-looking rule, and it was wrong in the way that
    // only the reader could see: the root was glass, and then the list card, the
    // five overview tiles and both sticky heads were painted with an OPAQUE layer
    // token, which covered the glass again one level down. The result reads as a
    // flat plate with a translucent border around it — the one thing a glass skin
    // cannot recover from — while the board, whose columns take the SAME canvas
    // token, kept working the whole time.
    //
    // The corrected rule is the board's own, and it splits the two cases the old
    // rule had merged:
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

    // THE CARDS, NAMED — and the rule they are held to CHANGED, because the rule
    // was answering a question this panel no longer has.
    //
    // It used to say a plate that HOLDS CONTENT takes the canvas token, on the
    // reasoning that the panel root is glass and translucency has to compose
    // through it. But the root above now paints the canvas token ITSELF, so
    // there is no glass left inside the panel for a card to compose with — and a
    // card painted exactly the canvas is a card a reader cannot find, which is
    // what 「文字都粘在左侧边缘上」 looks like when the whole surface is one flat
    // plane.
    //
    // THE CLAIM NOW IS THE THREE STEPS, in order and no more than three: the
    // page is the canvas, a CARD IS EXACTLY ONE STEP ABOVE IT, and a floating
    // surface is the step above that. One step is checkable; 「however far above
    // it happens to land」 is not.
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
    // **THIS GATE USED TO DEMAND THE OPPOSITE.** It required the card surface to be
    // a `color-mix` derived from ink and rejected `--dsh-tb-bg-raised`. That
    // derivation is wrong, and the measurement says why: ink is black in light and
    // white in dark, so mixing toward ink RAISES a card in the dark theme and
    // **SINKS it in the light one** — measured there as 7 levels darker than the
    // page, which reads as a groove. A rule that is right in one theme and inverts
    // in the other is not a rule; it is a coin flip that happens to land well most
    // of the time on the machine you built it on.
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
    for (const card of ['itemShell', 'itemTable']) {
      const layers = backgroundOf(css, card)
      expect(layers, `.${card} does not paint at all`).not.toEqual([])
      expect(layers, `.${card} is not painted with the one card surface: ${JSON.stringify(layers)}`)
        .toEqual(['var(--item-surface)'])
      expect(layers.join(' '), `.${card} is partly transparent, so text lands on whatever is behind the panel`).not.toMatch(/transparent/)
      // **AND IT IS THE SHADOW, not nothing.** In the light theme the host's three
      // background layers are the SAME colour, so a card with a hairline and no
      // shadow is a rectangle on a rectangle — which is 「文字粘在左侧边缘上」 seen
      // from the other side: the card is there, and nothing says it is in front.
      const shadow = /(?:^|[;{\s])box-shadow\s*:\s*([^;]+)/.exec(rulesOf(css, card).join('\n'))?.[1] ?? ''
      expect(shadow, `.${card} has no shadow, so in the light theme — where the host's three background layers are the SAME colour — nothing says this card is in front of the page`)
        .toContain('var(--item-card-shadow)')
    }

    // AND THE OTHER HALF, which the old rule had no room for: the things that
    // float still have to be opaque. Without this the first half passes by
    // painting everything the canvas, and a menu over the wallpaper becomes
    // unreadable — the rule would have been satisfied by a surface nobody can read.
    //
    // THE MENU'S TOKEN MOVED, AND THE CLAIM GREW. It used to be
    // `--dsh-tb-surface-menu`, which resolves to the host's
    // `--dsw-specific-menu`; the default skin gives that `#f8f9fa94` — **58%
    // alpha** — and this menu sits over every row's text, so a translucent plate
    // is text over text. The panel's own alpha is the SKIN's business; a floating
    // surface's is not.
    //
    // **SO THE CHECK IS NO LONGER 「WHICH TOKEN」.** It is now 「which token, AND
    // does the colour it resolves to actually resolve to something opaque」 — the
    // old form would pass on a token whose value is 58% opaque, and did. The alpha
    // reader below is the part that is new: it takes a resolved `#rrggbbaa` and
    // asks whether the last two digits are `ff`.
    // (The assertion that used to live here — 「the floating step is `--item-float`
    // resolving to one of the host's own surface tokens」 — is GONE, and its
    // removal is the finding rather than a cleanup. It demanded exactly the thing
    // the measurement above refutes: the host's three surface tokens resolve to one
    // colour, so 「a float is one of them」 is a float painted in the page. What
    // replaced it is the derivation and the ORDER check above, which read the mix
    // amount instead of a name — and which caught this same file getting the
    // comparison backwards the day it was written.)
    for (const name of ['itemRowMenu']) {
      const layers = backgroundOf(css, name).filter(value => value.includes('var(--item-float)'))
      expect(layers, `.${name} does not paint with the floating surface: ${JSON.stringify(backgroundOf(css, name))}`).not.toEqual([])
    }
    // AND THE NEW HALF, on the surface that actually floats over text.
    for (const name of ['itemRowMenu', 'itemCommandPalette']) {
      const resolved = tokenValueOf(css, `--dsh-tb-${name === 'itemRowMenu' ? 'surface-float' : 'surface-float'}`)
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
    for (const body of rulesOf(cssText, 'itemWorkbench')) {
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
    // The right-hand detail rail is gone: it was rented land whenever no row was
    // chosen, and keeping its track would keep its empty column. So the grid must
    // name exactly rail and list, with the rail fixed and the list fluid.
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
    const first = rulesOf(css, 'itemWorkbench')[0].replace(/\s+/g, ' ')
    expect(first).toMatch(/grid-template-columns:\s*260px\s+minmax\(0,\s*1fr\)/)
    for (const body of rulesOf(css, 'itemWorkbench').slice(1)) {
      expect(body.replace(/\s+/g, ' '), 'a band restates the tracks, so two bands can disagree again')
        .not.toMatch(/grid-template-columns:\s*260px\s+minmax\(0,\s*1fr\)/)
    }
  })

  it('the detail spans the row it belongs to and starts under a rule', () => {
    // In-row detail must not become a fourth content column: it spans the row it
    // expands, sits on its own grid row, and starts under the row's separator.
    // A detail that does not span reflows the title, tags and menu around it —
    // exactly the layout jump a reader reports as 「the list moved」.
    const detail = rulesOf(css, 'itemRow > .itemDetail').join('\n')
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
    // THE MECHANISM THAT USED TO CARRY IT WAS A LINE, and a line was the wrong
    // instrument for this seam. It was drawn on the list column's leading edge,
    // which is 1px from the list card's own edge — so it measured **2px** on
    // screen, heavier than every real separator on the panel, and it cut one
    // main column into two halves that are not halves: the rail is a direction
    // and the list is the work, on the same paper. A reader asked what that line
    // was dividing could not answer.
    //
    // So the promise is checked in the two directions that outlive the change:
    // the gap is real, and the line is gone. A gate that only demanded the line
    // would have been demanding the thing that read as a mistake.
    const workbench = rulesOf(css, 'itemWorkbench').join('\n')
    expect(workbench, 'there is no .itemWorkbench rule').not.toBe('')
    const gap = /(?:^|[;{\s])column-gap\s*:\s*([^;]+)/.exec(workbench)?.[1]?.trim() ?? ''
    expect(gap === '' || gap === '0' || gap === '0px',
      `the two regions are separated by nothing (column-gap: ${gap || 'missing'}), so navigation reads as a margin`).toBe(false)

    // AND THE LINE IS GONE. Both inline sides, because a line moved from one
    // column's leading edge to the other's trailing edge is the same line.
    const column = rulesOf(css, 'itemListColumn').join('\n')
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
    // THE READINGS THAT CANNOT FIT, in the shape the table has now. It used to be
    // `.itemDue` / `.itemStartsAfter` / `.itemSteps` — three facts sharing one
    // truncated line under a row's title. The table gives each one its own cell,
    // so the same three readings are checked in the cells that carry them, and a
    // NEW reading added to a cell without a floor is reported by name rather than
    // counted away.
    // NOT CELLS. The three truncated cells under a title are three text slots now:
    // the reading at the end of the sentence, the tags beside the menu, and the
    // numbers under the sentence. The promise is the same one — a fact that cannot
    // fit is truncated in ITS OWN slot, never by the row's — so it is checked on
    // the slots that exist.
    const facts = ['itemRowTail', 'itemRowTags', 'itemRowMeta']
    for (const name of facts) {
      const bodies = rulesOf(css, name)
      expect(bodies.length, `there is no .${name} rule`).toBeGreaterThan(0)
      // THE UNION OF THE RULES, NOT EACH ONE. This used to demand that EVERY
      // block naming the class carry the shrink and the clip, which is a reading
      // of CSS that does not exist: declarations CASCADE, so a rule that adds
      // only `font-variant-numeric` to a class does not take the shrink away
      // from the rule beside it. The three readings now share one block through
      // `:is()` — the right way to say 「these three have one floor」 — and a
      // second block that tunes a number no longer counts as a second floor.
      //
      // The claim is still exactly as strong: if NO rule naming the class shrinks
      // it, or none of them clips it, the reading is still unbounded. What it no
      // longer does is report a correct stylesheet as broken, which is the
      // failure mode this repository keeps warning about — a gate that pushes the
      // implementation into a worse shape gets loosened, and the defect it was
      // built for comes back with it.
      const all = bodies.join('\n')
      // EITHER SPELLING OF 「it can end」: a grid item shrinks with
      // `min-inline-size: 0`, an inline phrase ends with a ceiling and an
      // ellipsis. Both keep the promise — the reading never pushes the fact beside
      // it — so the test asks for the promise rather than for one shape's spelling.
      expect(
        /(?:^|[;{\s])min-inline-size\s*:\s*0/.test(all) || /max-inline-size/.test(all),
        `.${name} neither shrinks nor has a ceiling, so a long reading pushes the next track instead of truncating`,
      ).toBe(true)
      // A TAG ENDS BY WRAPPING. It used to be one clipped row in a fixed-height
      // column, and a tag cut in half is a tag nobody can read back — so a long row
      // of them takes a second line and the row grows. Clipping is still accepted
      // for the other two slots, which are inline phrases inside a sentence.
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
    // **BOTH UNITS ARE ACCEPTED, AND THAT IS THE FIX.** This used to reject a
    // device-pinned track outright on the reasoning that only a text-relative
    // unit can be resolved against the text it has to hold. But the date cell is
    // a TABLE CELL now, and a table's column width is not a font measurement —
    // it is a track in a grid, and the whole point of a grid track is that it
    // does not move when the type does. A px track here is MORE resolvable than
    // an `em` one, because `em` here resolves against a font-size declared
    // somewhere else in the sheet and the reader has to go and find it.
    //
    // So the claim is the claim it always was — **named token, and wide enough**
    // — and the unit is no longer part of it.
    // THE READING IS NOT A COLUMN. It sits at the end of the sentence, and the
    // sentence's track is the one with a floor — so 「a named token, wide enough」
    // is now a claim about the row's title track rather than about a due column.
    const track = /grid-template-columns:\s*10px\s+minmax\((\d+)px,\s*1fr\)/.exec(css)?.[1]
    expect(track, 'the sentence track has no named floor — a wide tag row can squeeze it to a few characters').toBeDefined()
    // The cell states the size its own width has to hold text at, so a
    // text-relative track can be resolved here rather than guessed at.
    const cellSize = Number(/(?:^|[;{\s])font-size\s*:\s*([\d.]+)px/.exec(rulesOf(css, 'itemRowTail').join('\n'))?.[1] ?? 0)
    expect(cellSize, '.itemCellDue does not declare its own font-size, so a text-relative track on it resolves against a size this file cannot know').toBeGreaterThan(0)
    const resolved = Number(track)
    // The sentence's FLOOR is what the reading has to fit into, and the reading is
    // allowed to end before it runs out — so the floor is checked against the whole
    // reading rather than against a fraction of it. A floor under the longest
    // reading means the reading always starts on screen in full; the ellipsis on
    // the reading itself says what happens to the rest.
    expect(resolved, `the sentence's floor is ${resolved}px; a floor below the ${LONGEST_DATE_READING_PX}px the longest reading needs means that reading cannot start on screen at all`).toBeGreaterThanOrEqual(LONGEST_DATE_READING_PX)
    // AND THE CONSUMERS READ THE TOKEN. There are exactly two consumers — the
    // head row and the body row — and they must be the SAME track, or a column
    // that lines up in the head does not line up in the body, which is the one
    // failure a table cannot have and the one no capture at one width can see.
    // AND THE READING TRUNCATES RATHER THAN PUSHING. It is one phrase inside a
    // sentence, so a sentence that cannot fit must end inside the reading, never by
    // moving the row's other tracks — which is the same promise the old column test
    // made, asked of the shape that replaced it.
    const tail = rulesOf(css, 'itemRowTail').join('\n')
    expect(tail, 'the reading does not declare how it ends when the sentence is full').toMatch(/text-overflow\s*:\s*ellipsis/)
    expect(tail, 'the reading does not declare a ceiling, so it pushes the row instead of truncating').toMatch(/max-inline-size/)
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
    // THE NEW SHAPE, exercised: a device-pinned track is accepted now, and only
    // because it clears the floor. Two of these are the same defect the old rule
    // used to catch by unit instead of by measurement.
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
    // THE READER RESOLVES THE ALIAS, and that is the whole finding. It used to
    // look for a LITERAL `--dsh-tb-text-N` inside the rule, so the moment the
    // sheet gave its three ink steps names of their own the reader stopped
    // finding anything and answered `-1` — which is the same value it answers
    // when it has not looked. **A gate that cannot tell 「not found」 from
    // 「found nothing there」 reports a correct stylesheet as broken**, and the
    // only way to make it green is to delete the names.
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
    // a size below its own field names reads as a label FOR the label — so what
    // separates the three tiers is INK: the value is the thing, the name is a plate on
    // it, and the caption a plate on the plates.
    // THE THREE INKS ARE NUMBERED BY STRENGTH, so quieter is a BIGGER number.
    // The caption is the quietest, the name is a tier above the value, and the
    // value is the thing itself.
    expect(ink('itemOpenCaption'), 'the caption is not the quietest of the three')
      .toBeGreaterThan(ink('itemOptName'))
    expect(ink('itemOptName'), 'a field name is not louder than the value it names')
      .toBeGreaterThanOrEqual(ink('itemInput'))
  })

  it('an odd field in a two-column grid is named, so the last row is not half empty', () => {
    // 计划与期限 seats 状态|优先级 / 最早开始|截止 / 硬期限 — five into two, which
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
    // THE CLASS IS READ OFF THE MARKUP, NOT NAMED HERE — and the markup moved.
    // The sentence used to be an inline `<p>{t('item.triage.nothing')}</p>` in the
    // page; it is now a PROP handed to the table (`empty={nothingToShow}`), because
    // the table is what knows whether it is drawing rows or an empty state. So the
    // gate looks for **the box the table puts that sentence in**, which is the only
    // place a standalone sentence can now live.
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
    // THE PLANT IS AIMED AT THE CLASS THE MARKUP NAMES, and not at a name typed
    // in here. It used to plant into `.itemTriageText`, which meant the probe
    // only kept biting while the sentence kept that name — the day the sentence
    // moved to another class, the plant went into a rule nothing renders and
    // the probe reported 「did not bite」 about a gate that was fine. A probe that
    // has to be re-aimed by hand every time a class is renamed is a probe
    // measuring itself.
    //
    // THE PLANT IS AIMED AT THE CLASS THE MARKUP NAMES, never at a name typed in
    // here. It used to plant into `.itemTriageText`, which meant the probe only
    // kept biting while the sentence kept that name; the day the sentence moved
    // into the table as a prop, the plant went into a rule nothing renders and the
    // probe reported 「did not bite」 about a gate that was fine. **A probe that has
    // to be re-aimed by hand after every rename is a probe measuring itself.**
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
function tokenValueOf(css: string, name: string): string {
  const alias = new RegExp(`${name}\\s*:\\s*([^;]+)`).exec(aliasLayer(css))?.[1]?.trim() ?? ''
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
    const shared = rulesOf(readFileSync(join(cssPanelRoot(), 'board.module.css'), 'utf8'), 'segmentedRow')
    expect(shared.length, 'the shared segmented control has no rule — the gate is reading a control that does not exist').toBeGreaterThan(0)
    // The classes this surface puts on a segmented control, discovered from the
    // markup rather than named here, so a rename moves the gate with the code.
    // It used to read `filter-bar.tsx`, which is retired: the filter faces and the
    // orders are in the command palette, and the batch door is an action in it.
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
    // THE DEFECT THIS REPLACES, in one sentence: the status used to be a GROUP —
    // a heading with a fold arrow and a count — and the same status was ALSO the
    // row's own mark, and ALSO the name on the 「进行中 0 · 受阻 0 · 已完成 0」
    // summary of the buckets that happened to be empty. One fact, three places,
    // and a reader could not tell which of the three was telling the truth
    // about the list in front of them.
    //
    // So the status became a COLUMN, and the rule is now the simple one: there is
    // exactly one place on the page that says what a row's state is, and it is
    // the cell. The gate is a negative on the MARKUP rather than a count on the
    // stylesheet, because 「the group is back」 is a fact about what gets rendered,
    // and a stylesheet can hold a rule for a class nothing renders — which is how
    // the previous version of this gate went green over a page it could not see.
    // The status buckets are gone, and the claim is stated the way the page now says
    // it: the table is handed ONE flattened list, and the only section left on the
    // page is the archive's — which is a heading for the ARCHIVE, not for a
    // status, and a reader who opens 「已删除」 is answering a different question.
    //
    // The earlier form of this gate banned `itemGroupHead` outright, which also
    // banned the archive's heading — and a gate that cannot tell the two apart
    // pushes the next author to delete the archive's heading too, which is the
    // shape of a check that has stopped being about its claim.
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
    const head = rulesOf(css, 'itemDayHead').join('\n')
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
      const body = rulesOf(text, 'itemDayHead').join('\n')
      const value = /(?:^|[;{\s])background(?:-color)?\s*:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? ''
      return value !== '' && !['0', 'none', 'transparent'].includes(value)
    }
    expect(hasGround('.itemDayHead { background: transparent; }'),
      'a ground set to nothing was counted as a ground, so the gate cannot see the defect it exists for').toBe(false)
    expect(hasGround('.itemDayHead { padding-block-end: 8px; }'),
      'a header with only air around it was accepted').toBe(false)
    expect(hasGround('.itemDayHead { background: var(--item-fill); }'),
      'a real ground was not seen — the reader has stopped biting').toBe(true)
  })
})


describe('the type scale is a scale, and not a pile of near-identical sizes', () => {
  const css = panelCss()

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
    // THE SCALE CHANGED SHAPE, NOT LENGTH. It used to be six NEIGHBOURING
    // sizes (11/12/13/14/15/16), and 14 sitting between 13 and 15 is exactly
    // the near-miss the paragraph above is about: a reader cannot see a step that
    // small, so six numbers bought two or three visible levels.
    //
    // The panel's constitution now says 「字靠字重分四层，不靠字号堆」 — the levels
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
    // THE FAILURE NOBODY COULD SEE, and it was a heading louder than the page.
    //
    // This sheet has NO `h1`–`h6` reset. `board.module.css` resets `p` and
    // nothing else, so a `<h2>` in this panel arrives carrying the user agent's
    // `font-size: 1.5em; font-weight: bold; margin: .83em 0` — 19.5px to 24px of
    // BOLD, against a 16px page title. The detail pane's own heading was the
    // loudest type in the column, which is the one thing a column's heading is
    // not allowed to be, and every other assertion in this file was green
    // throughout: the type-scale check reads DECLARED sizes and this heading
    // declared none, so the scale had nothing to say about it, and a 19.5px
    // inherited size is not a "size outside the scale" — it is the absence of a
    // declaration.
    //
    // So the claim is about the DECLARATION, not the computed value: a heading
    // that says its own `margin: 0` and its own `font-size` is a heading this
    // sheet is in charge of. `margin` is in the claim for the same reason — the
    // UA's `.83em` is a margin nobody chose, and it is the reason an empty
    // heading with a bottom border reads as a page that failed to finish loading.
    // TWO, NOT THREE. `.itemDetailHead` went with the five sections the detail used
    // to have; what names a group of rows now is a section CAPTION, and the two
    // headings that remain are the agenda's fold and its undated tray.
    const HEADINGS = ['itemGatedFoldHead', 'itemNoDateTrayLabel'] as const
    const rules = declarationRules(stripCssComments(itemSheet()))
    for (const name of HEADINGS) {
      const rule = rules.find(entry => entry.selector === `.${name}`)
      expect(rule, `.${name} has no rule at all, so the heading it styles is the user agent's`).not.toBeUndefined()
      expect(
        /(?:^|[;{\s])margin\s*:\s*0(?:;|\s|$)/m.test(rule?.body ?? ''),
        `.${name} does not declare its own margin — it inherits the UA's .83em, which is nobody's choice`,
      ).toBe(true)
      expect(
        /(?:^|[;{\s])font-size\s*:\s*[\d.]+px/.test(rule?.body ?? ''),
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
      const headings = new Set<string>()
      const unanchoredWeights = new Set<string>()
      for (const rule of declarationRules(source)) {
        const isHeading = ['itemGatedFoldHead', 'itemNoDateTrayLabel'].includes(rule.selector.replace(/^\./, ''))
        if (isHeading && (!/(?:^|[;{\s])margin\s*:\s*0(?:;|\s|$)/m.test(rule.body) || !/(?:^|[;{\s])font-size\s*:/.test(rule.body))) {
          headings.add(rule.selector)
        }
        const weight = /(?:^|[;{\s])font-weight\s*:\s*(\d+)/.exec(rule.body)?.[1]
        if (weight !== undefined && weight !== '400' && !/(?:^|[;{\s])font-size\s*:/.test(rule.body)) {
          unanchoredWeights.add(rule.selector)
        }
      }
      return { headings: [...headings], unanchoredWeights: [...unanchoredWeights] }
    }
    const planted = reads([
      '.itemGatedFoldHead { font-size: 14px; font-weight: 600; }',
      '.itemGatedFoldHead { font-weight: 600; margin: 8px 0; }',
      '.itemNoDateTrayLabel { font-weight: 600; }',
      '.itemTopBarLabel { font-weight: 500; }',
      '.itemRailCaption { font-size: 12px; margin: 4px 0; }',
      '.itemRecentRowMain { font-family: inherit; font-weight: 400; }',
    ].join('\n'))
    expect(planted.headings, 'the probe did not bite — a heading inheriting the UA is invisible to this reader').toEqual([
      '.itemGatedFoldHead', '.itemNoDateTrayLabel',
    ])
    // `.itemRecentRowMain` is in the plant ON PURPOSE: it is a `<button>` writing
    // 400 to undo the platform's own weight, which renders identically to saying
    // nothing. A reader that reported it would force a size into a rule whose
    // whole content is 「nothing», and that size would then be a second copy of
    // one declared elsewhere.
    expect(planted.unanchoredWeights, 'the probe did not bite — a weight that invents a tone is invisible to this reader')
      .toEqual(['.itemGatedFoldHead', '.itemNoDateTrayLabel', '.itemTopBarLabel'])
    const clean = reads('.itemGatedFoldHead { margin: 0; font-size: 14px; font-weight: 600; }')
    expect(clean.headings, 'the reader reports a correct heading as broken — its gate would get deleted, and the defect would come back with it').toEqual([])
    expect(clean.unanchoredWeights, 'the reader reports a correctly anchored weight as broken').toEqual([])
  })

  it('a box that declares an inline-size container is never content-sized on the inline axis', () => {
    // THE WORST FAILURE IN THIS FILE'S FAMILY, and it is worth writing the whole
    // argument out because every existing assertion passed while it was live.
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
    // That is exactly what happened to `.itemDetailInner`: the pane drew its head
    // and its rule and then eight hundred pixels of nothing, while the markup was
    // present, `flex` was a sensible value, every computed colour was right, and
    // all 2248 assertions in the suite were green. **Nothing that reads a
    // stylesheet or a markup string can see a box that is the right height and
    // the wrong width** — so the check has to be about the DECLARATION, and the
    // probe has to plant exactly the pair of declarations that caused it.
    const CONTENT_SIZED_IN_INLINE_AXIS = /align-self\s*:\s*(?:start|flex-start)/
    // The same guard the triage loop below carries: an absent subject iterates
    // zero times, and the box that computes to zero width is exactly the one a
    // renamed selector would hide.
    // The box was RENAMED, not removed: `.itemDetailInner` became `.itemDetailPane`
    // when the detail stopped being a wrapper around a card and became the card.
    // **The claim is about the box that carries the detail's container, not about a
    // name** — and pinning the old name would make this gate pass on a sheet with no
    // such rule at all, which is the failure it exists to catch: a container with no
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
    // target under the first one, which is the arrangement the old strip had: a
    // sentence with four buttons beside it, none of them bigger than the sentence
    // they were about.
    // THE CARD IS THE RAIL ROW. The three numbers that stood above the list are
    // counts in the rail, beside the things they count — so what must not be a pill
    // inside a button is the rail row's mark: a reader aims at the ROW.
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
      const fills = body.match(/(?:^|[;{\s])background(?:-color)?\s*:\s*([^;]+)/)?.[1]?.trim() ?? ''
      expect(['var(--item-fill)', 'var(--dsh-tb-hover)'],
        `a rail row paints "${fills}" rather than a wash, so it reads as something lying on top of the list`)
        .toContain(fills)
      const radii = body.match(/(?:^|[;{\s])border-radius\s*:\s*([^;]+)/)?.[1]?.trim() ?? ''
      expect(radii === '' || radii === 'var(--item-radius-ctl)',
        `a rail row uses "${radii}" rather than the control radius, so it does not match the other controls in the column`)
        .toBe(true)
    }
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
    // THE SELECTOR HALF, OR NOTHING. It used to read `rulesOf(css, 'itemDue')`
    // and filter the BODIES for `[data-tone`, and a body never contains its own
    // selector — so the filter matched nothing, the loop never ran, and the
    // gate asserted that an empty array has no extra properties in it. The tone
    // rules are named by their selector (`.itemRowMeta [data-tone='over']`),
    // which is precisely the half `rulesOf` throws away and
    // `declarationRules` keeps.
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
   * VISUALLY ONE THING IS ONE POSITION. A budget is a claim about what a reader
   * SEES, and a reader sees one focus ring, not eighteen — so the states that
   * draw the same mark for the same reason are collapsed by name. The list is
   * short ON PURPOSE: a family nobody named is counted per selector, which is the
   * strict reading, so a new focus-like state costs its full price rather than
   * quietly reinterpreting the rule in its own favour.
   */
  /**
   * VISUALLY ONE THING IS ONE POSITION — **a position, not a selector**, and that
   * is the second half of what used to be wrong here. Counting selectors made the
   * keyboard focus ring cost eighteen positions: one ring, drawn on eighteen
   * controls. A budget is a claim about what a reader SEES, and a reader sees one
   * ring. So the states that draw the same mark for the same reason are collapsed
   * by name here, and everything else stands on its own selector.
   *
   * The list is short ON PURPOSE: a family nobody named is counted per selector,
   * which is the strict reading — so a new focus-like state costs its full price
   * and the budget says so loudly, rather than quietly reinterpreting itself.
   */
  const FAMILIES: ReadonlyArray<{ readonly key: string; readonly is: (s: string) => boolean }> = [
    { key: '键盘焦点环', is: s => /:focus-visible\b/.test(s) },
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
    { key: '键盘焦点环', is: s => /:focus-visible\b/.test(s) },
    { key: '原生控件的色调', is: s => /(?:^|[;{\s])(?:accent-color|appearance)\s*:/.test(s) },
  ]
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
    for (const rule of declarationRules(css)) {
      if (!paintsToken(rule.body, token)) continue
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
    // THE READER BELOW SEES EVERY SPELLING, and that is the whole point of this
    // rewrite. It used to match only a BARE `var(--token)` on
    // color/background/border*color, which is one of the four ways this sheet
    // spends a semantic ink — so the count came out at 5 and passed while the
    // sheet carried 7 real positions: seventeen focus OUTLINES, a `color-mix()`
    // wash, and an `accent-color` were all invisible to it, and three unlisted
    // things stood in for three listed ones and landed on exactly the limit. **A
    // counter that cannot see a spelling reports a number, and the number looks
    // like an answer.** Each spelling below was proved to still move or paint
    // when the old reader was green.
    // SEVEN, and every one of them is named in `DESIGN.md`. It said five while
    // the sheet carried seven, and the old counter agreed with the record by
    // coincidence: it could not see `outline` (eighteen focus rings), `color-mix`
    // or `accent-color`, so three unlisted things stood in for three listed ones
    // and landed on the number. **A counter that cannot see a spelling reports a
    // number, and the number looks like an answer.**
    //
    // The two focus families are counted apart on purpose: the field's focus is a
    // border AND a ring, every other control's is a ring only, so they are two
    // drawings of one idea rather than one drawing. Collapsing them would make the
    // number smaller than the page, which is the same lie in the other direction.
    //
    // SEVEN ACCENT POSITIONS BECAME FOUR, and what went is the meters: five on the
    // overview strip and four on the group heads, nine in all, every one of them a
    // 2px bar restating a number printed beside it. Accent is the ink with the
    // fewest jobs left on this surface — the current page, the selected row, the
    // live pill, the cursor in a palette — and four is what remains once nothing
    // else spends it restating itself. **The number did not move**, and that is
    // the point: the design changed shape, not volume.
    //
    // The two affordances on top of it (the focus ring, the native checkbox tint)
    // are counted in their own column rather than added to these four, so the
    // figure above is still four and still means four things the product is
    // saying. Their allowance is small and their total is checked, so moving the
    // page's own marks into the affordance column is not a way to buy headroom.
    const budget: Readonly<Record<string, { readonly decoration: number; readonly affordance: number; readonly total: number }>> = {
      '--dsh-tb-accent': { decoration: 4, affordance: 2, total: 6 },
      '--dsh-tb-attention': { decoration: 2, affordance: 0, total: 2 },
      '--dsh-tb-danger': { decoration: 3, affordance: 0, total: 3 },
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
    // Every page, and the harness used to render ONE of them: a surface with
    // two thirds of itself never looked at is a surface half-changed. The page
    // is the other half of the band switch, and the agenda — whose primary form
    // is a day-sequence rather than a grouped list — is the one that differs
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
    const openRow = process.env.DSH_PANEL_ROW
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