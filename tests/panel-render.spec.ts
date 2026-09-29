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
import { join } from 'node:path'
import { itemSurfaceSource, PAGES, repoRoot, type Page } from './panel-harness.ts'
import {
  aliasLayer,
  backgroundOf,
  cssMembersOf,
  declaredOf,
  dswNamesReferenced,
  fixtures,
  hostTokenCss,
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
 * @param css - the sheet.
 * @returns one entry per declaration rule, in source order.
 */
function declarationRules(css: string): Rule[] {
  const out: Rule[] = []
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    const start = (match.index ?? 0) + match[0].length - 1
    let depth = 0
    let end = start
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++
      else if (css[end] === '}') { depth--; if (depth === 0) break }
    }
    const body = css.slice(start + 1, end)
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

/** Whether any rule on this surface still draws a vertical rule. */
function drawsRule(css: string): boolean {
  return [...css.matchAll(/(?:^|[;{\s])border-inline-start\s*:\s*([^;]+)/g)].some(match => (match[1] ?? '').includes('var(--dsh-tb-border'))
}

describe('the panel renders against the host it will actually run in', () => {
  const tokens = hostTokenCss()
  const css = panelCss()
  const itemSheetText = itemSheet()

  it('finds the host token stylesheets, so nothing is measured against a snapshot', () => {
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

  it('names only tokens the host declares, in the list\'s own sheet and in the shared alias layer', () => {
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
    const inbox = renderPanel(fixtures(), 'wide', 'inbox')
    const schedule = renderPanel(fixtures(), 'wide', 'schedule')
    const list = renderPanel(fixtures(), 'wide', 'list')
    // The inbox is the page that deliberately has no second-level chrome, and
    // the agenda is the only one whose primary form is a day sequence.
    expect(inbox).toContain('收件只放还没分流的想法')
    expect(schedule).toContain('没有日期')
    expect(schedule).toContain('还没到开始时间')
    // And they must be three DIFFERENT documents, not one rendered three times.
    expect(new Set([inbox, schedule, list]).size).toBe(3)
  })

  it('really narrows to the band it was asked for', () => {
    // Same reason, for the band: the viewport proxy is only the FIRST value
    // the hook can hold, and a stub in the wrong slot leaves every capture in
    // the wide band while looking perfectly healthy.
    const wide = renderPanel(fixtures(), 'wide')
    const narrow = renderPanel(fixtures(), 'narrow')
    expect(narrow).not.toBe(wide)
    // The detail pane is the wide band's own track; a narrow one has no pane.
    expect(wide).toContain('itemDetailPane')
    expect(narrow).not.toContain('itemDetailPane')
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
 * @param selector - the selector the sheet wrote.
 * @returns whether the standalone element can be subject to it.
 */
function canMatchStandalone(selector: string): boolean {
  const compound = selector.split(',').map(part => part.trim()).filter(part => part.includes('itemTriageText'))
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
    const root = /\.itemRoot\s*\{[^}]*\}/s.exec(css)?.[0] ?? ''
    expect(root, 'there is no .itemRoot rule').not.toBe('')
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

    // The plates, NAMED. These are the ones the reader actually sees, and each
    // one is named rather than pattern-matched so a rename cannot quietly turn
    // this into a check about nothing.
    for (const plate of ['itemListCard', 'itemTile', 'itemGroupHead', 'itemAgendaDayLabel']) {
      const layers = backgroundOf(css, plate).filter(value => value.includes('var(--dsh-tb-bg)'))
      expect(layers, `.${plate} does not take the canvas token, so it covers the skin: ${JSON.stringify(backgroundOf(css, plate))}`).not.toEqual([])
    }

    // AND THE OTHER HALF, which the old rule had no room for: the things that
    // float still have to be opaque. Without this the first half passes by
    // painting everything the canvas, and a menu over the wallpaper becomes
    // unreadable — the rule would have been satisfied by a surface nobody can read.
    for (const [name, token] of [['itemDangerZone', '--dsh-tb-surface-sunken'], ['itemRowMenu', '--dsh-tb-surface-menu']] as const) {
      const layers = backgroundOf(css, name).filter(value => value.includes(`var(${token})`))
      expect(layers, `.${name} does not paint with ${token}: ${JSON.stringify(backgroundOf(css, name))}`).not.toEqual([])
    }
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
   * detail's own container is only ever asked about at 360px, and a helper
   * that planted at 720px would silently plant nothing and report the gate as
   * broken — which is how a probe ends up deleted for the crime of the thing
   * it was checking.
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

  it('catches it through a SECOND declarer of the same container', () => {
    // The probe plants on a class that DECLARES the container, and which class
    // that is has to be read out of the sheet rather than written here. A probe
    // that names a class the sheet has since moved the declaration off is worse
    // than no probe: it plants nothing, finds nothing, and reports the gate as
    // broken — and the usual response to that is to delete the gate, which is
    // how a real container defect comes back with nobody watching.
    //
    // So the declarers are DISCOVERED, all of them, and the probe is planted on
    // one that is not the first. That is also the stronger case: a map that kept
    // only the last declarer would let a second one through, which is the defect
    // wearing a different class name.
    const declarers = [...containerDeclarers(live).entries()]
      .filter(([, names]) => names.includes('dsh-tb-item-detail'))
      .map(([selector]) => `.${selector}`)
    expect(declarers.length, 'nothing in the sheet declares dsh-tb-item-detail, so this probe has no subject').toBeGreaterThan(0)
    for (const declarer of declarers) {
      const caught = deadSelfQueries(plant(live, 'dsh-tb-item-detail', declarer, '--probe: 1px;'))
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
describe('the detail rail runs the full height of the workbench', () => {
  const css = panelCss()

  it('the pane is stretched by its track, so its rule is a rule and not a stub', () => {
    // The rule between the list and the detail is the only vertical line on the
    // page, and a line that stops at the bottom of a short detail reads as a
    // rendering fault rather than as a column. The mechanism that decides this
    // is the pane's own `align-self`: a grid item stretches by default, and
    // `align-self: start` — which is what this sheet carried, so that a short
    // detail would not sit in a 730px box — is exactly what makes the line stop
    // early. Any correct fix removes it or says `stretch`; the gate accepts
    // both and nothing else, so it does not dictate how the box is built.
    const bodies = rulesOf(css, 'itemDetailPane')
    expect(bodies.length, 'there is no .itemDetailPane rule').toBeGreaterThan(0)
    for (const body of bodies) {
      const align = /(?:^|[;{\s])align-self\s*:\s*([^;]+)/.exec(body)?.[1]?.trim()
      expect(align === undefined || align === 'stretch' || align === 'normal',
        `.itemDetailPane sets align-self: ${align ?? '?'} — the rule then stops at the content height instead of running the workbench`).toBe(true)
    }
  })

  it('and the pane still draws its separator, so the stretch is not a blank column', () => {
    // The other half. A pane that stretches and paints nothing is a wide empty
    // column, which is the exact thing the `align-self: start` was there to
    // avoid — so the fix has to be "stretch AND rule", and a gate that only
    // checked the first would have passed a fix that made it worse.
    expect(drawsRule(css), 'the detail rail draws no vertical rule at all').toBe(true)
  })

  it('the two probes both bite', () => {
    // The detectors are exercised on strings they cannot have been tuned
    // against, so a green here means the DETECTOR works. A control that leaned
    // on the real sheet's current state would pass by accident the day the
    // sheet is fixed, and prove nothing for ever after.
    const stretched = (text: string): boolean => !rulesOf(text, 'itemDetailPane')
      .some(body => /(?:^|[;{\s])align-self\s*:\s*(?:start|flex-start|end|self-end)/.test(body))
    expect(stretched('.itemDetailPane { display: flex; }'), 'a stretched pane was reported as short').toBe(true)
    expect(stretched('.itemDetailPane { align-self: stretch; }'), 'an explicit stretch was reported as short').toBe(true)
    expect(stretched('.itemDetailPane { align-self: start; }'), 'the align-self probe did not bite').toBe(false)
    // Probe two: a stretched pane with no rule is not the fix.
    expect(drawsRule('.itemDetailPane { border-inline-start: var(--dsh-tb-border-soft); }')).toBe(true)
    expect(drawsRule('.itemDetailPane { border-inline-start: 0; }'), 'the border probe did not bite — the second half of the gate is vacuous').toBe(false)
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
    const facts = ['itemDue', 'itemStartsAfter', 'itemSteps']
    for (const name of facts) {
      const bodies = rulesOf(css, name)
      expect(bodies.length, `there is no .${name} rule`).toBeGreaterThan(0)
      for (const body of bodies) {
        const clips = /overflow\s*:\s*hidden/.test(body) || /text-overflow\s*:\s*ellipsis/.test(body)
        const canShrink = /(?:^|[;{\s])min-inline-size\s*:\s*0/.test(body)
        expect(canShrink, `.${name} cannot shrink, so a long reading pushes the next track instead of truncating`).toBe(true)
        expect(clips, `.${name} does not clip its own overflow, so a reading longer than its track is painted on top of the fact beside it`).toBe(true)
      }
    }
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
    // can print, 「最早 2026年10月5日」, at the row's size. It is a floor, not a
    // target: any wider is fine, and the artifact is what confirms the reader
    // still sees the whole date.
    const root = /\.itemRoot\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    const track = /--item-meta-date-col\s*:\s*([^;]+)/.exec(root)?.[1]?.trim() ?? ''
    expect(track, 'the fact line\'s date track is not a token on the root — it is a number written at the point of use').not.toBe('')
    expect(track, `the date track is ${track}, which is pinned to the device rather than to the text`).not.toMatch(/\d+(?:px|pt)\b/)
    // The row states the size its own tracks are resolved against.
    const rowSize = /(?:^|[;{\s])font-size\s*:\s*([\d.]+)px/.exec(rulesOf(css, 'itemRowMain').join('\n'))?.[1]
    expect(rowSize, '.itemRowMain does not declare its own font-size, so a `ch`/`em` track on it resolves against a size this file cannot know').toBeDefined()
    const em = /^([\d.]+)(em|rem)$/.exec(track)
    expect(em, `the date track is ${track}: only a text-relative unit can be resolved against the text it has to hold`).not.toBeNull()
    const resolved = Number(em?.[1] ?? 0) * Number(rowSize ?? 0)
    expect(resolved, `the date track resolves to ${resolved}px at ${rowSize}px, under the ${LONGEST_DATE_READING_PX}px the longest reading needs — the reading is then painted on top of the fact beside it`).toBeGreaterThanOrEqual(LONGEST_DATE_READING_PX)
    // And every consumer reads the token, never a second number.
    const meta = rulesOf(css, 'itemRowMeta').join('\n')
    expect(meta, 'the fact line does not size its date track from the token').toMatch(/var\(--item-meta-date-col\)/)
  })

  it('the probe bites, and a track that resolves too narrow is reported', () => {
    // Both directions, on numbers, so the control does not depend on the sheet
    // being broken today: a text-relative track is accepted, a device-pinned
    // one is not, and the floor is a floor rather than an equation.
    const resolvesWideEnough = (track: string, rowSize: number): boolean => {
      const em = /^([\d.]+)(em|rem)$/.exec(track)
      if (em === null) return false
      return Number(em[1]) * rowSize >= LONGEST_DATE_READING_PX
    }
    expect(resolvesWideEnough('11ch', 12), 'a `ch` track was accepted — `ch` is the width of a digit, not of a CJK glyph').toBe(false)
    expect(resolvesWideEnough('10em', 12), '10em at 12px is 120px, which clears the longest reading').toBe(true)
    expect(resolvesWideEnough('9em', 12), '9em at 12px is 108px and does not clear it — the floor is a floor, not an equality').toBe(false)
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
  const members = cssMembersOf(panelSource)

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
    const ink = (name: string): number => {
      const order = ['--dsh-tb-text-1', '--dsh-tb-text-2', '--dsh-tb-text-3']
      const body = declarationRules(css)
        .filter(rule => new RegExp(`\\.${name}(?![\\w-])`).test(rule.selector))
        .map(rule => /color\s*:\s*([^;]+)/.exec(rule.body)?.[1] ?? '')
        .find(v => order.some(token => v.includes(token)))
      const at = order.findIndex(token => (body ?? '').includes(token))
      return at
    }
    const value = size('itemInput')
    const label = size('itemFieldLabel')
    const caption = size('itemSectionTitle')
    expect(caption, 'the section caption is the same size as a field label, so nothing separates them but ink')
      .toBeLessThan(label)
    expect(label, 'a field label is not smaller than the value it names')
      .toBeLessThanOrEqual(value)
    expect(ink('itemSectionTitle'), 'the caption is not the quietest of the three')
      .toBeGreaterThan(ink('itemFieldLabel'))
    expect(ink('itemFieldLabel'), 'a field label is not quieter than the value it names')
      .toBeGreaterThanOrEqual(ink('itemInput'))
  })

  it('an odd field in a two-column grid is named, so the last row is not half empty', () => {
    // 计划与期限 seats 状态|优先级 / 最早开始|截止 / 硬期限 — five into two, which
    // measured as a 382 × 53px hole at the end of the section a reader scans FOR
    // DATES. The fix names the field (`data-wide`) rather than reaching for
    // `:last-child`, because 「the last child of the grid」 is a position and the
    // hard deadline is a field; a reordering would silently move the span.
    const detail = readFileSync(new URL('../src/client/item/detail-pane.tsx', import.meta.url), 'utf8')
    expect(detail.replace(/\/\*[\s\S]*?\*\//g, ''), 'the odd field out of the two-column grid is no longer named, so the hole can come back')
      .toMatch(/<Field label=\{t\('item\.field\.hardDueAt'\)\} wide>/)
    const field = /^\.itemFieldGrid > \.itemField\[data-wide\]/m.exec(css)
    expect(field, 'nothing in the sheet acts on data-wide, so naming the field achieves nothing')
      .toBeDefined()
    expect(css, 'the named field does not actually span the row').toMatch(/grid-column\s*:\s*1\s*\/\s*-1/)
    expect(detail.replace(/\/\*[\s\S]*?\*\//g, ''), 'the field is positioned by an nth-child rule instead of by name')
      .not.toMatch(/itemField:\s*nth-child/)
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
    // The class is read off the MARKUP (the `<p>` that carries the standalone
    // sentence) rather than named here, so renaming the class cannot make this
    // quiet and cannot make it red for a rename. The same class is legitimately
    // `flex: 1 1 auto` where it sits BESIDE a button in a row — so the gate is
    // about the standalone use, and the markup is what distinguishes them.
    const standalone = /<p className=\{css\.([A-Za-z]\w*)\}>\s*\{t\('item\.triage\.nothing'\)/.exec(panelSource)
    expect(standalone, 'the standalone triage sentence is gone from the panel — the reader is told nothing on a list that needs nothing').not.toBeNull()
    const className = members.get(standalone?.[1] ?? '')
    expect(className, `cannot resolve the css member ${standalone?.[1] ?? '?'}`).toBeDefined()
    // ONLY THE RULES THAT CAN MATCH THE STANDALONE `<p>`, and the distinction is
    // the selector's ANCESTORS rather than the class name. That element is a
    // direct child of the page's column scroller, so a selector that requires an
    // `.itemTriageRow` ancestor cannot reach it — and the same class IS
    // legitimately `1 1 auto` inside such a row, which is what makes the three
    // actions on a triage block line up. A gate that collected every rule with
    // this class and called any growth a hole was therefore reporting the row's
    // correct behaviour as the column's defect: it could not see WHICH box the
    // sentence was in, and a check that cannot see the box it is checking is
    // checking the wrong thing. This one can, and it is strictly more specific.
    const applicable = declarationRules(css)
      .filter(rule => new RegExp(`\\.${className}(?![\\w-])`).test(rule.selector))
      .filter(rule => canMatchStandalone(rule.selector))
    expect(applicable.length, `there is no .${className} rule that the standalone sentence is actually subject to`).toBeGreaterThan(0)
    for (const rule of applicable) {
      const grow = /(?:^|[;{\s])flex(?:-grow)?\s*:\s*([^;]+)/.exec(rule.body)?.[1] ?? ''
      const grows = /(?:^|\s)1(?:\s|$)/.test(grow.split(/\s+/)[0] ?? '') && !/^0/.test(grow.trim())
      expect(grows, `${rule.selector} grows along the block axis (flex: ${grow.trim()}) — a one-line sentence then becomes the height of the column`).toBe(false)
    }
  })

  it('the probe bites: a planted grow is reported, and the ROW rule is not mistaken for it', () => {
    // Plant the exact defect the gate exists for, on the exact selector the
    // standalone sentence is subject to, and prove it is reported.
    const planted = css.replace(/(\.itemTriageText\s*\{)/, '$1\n  flex: 1 1 auto;')
    const growsWhere = (sheet: string, className: string): boolean => declarationRules(sheet)
      .filter(rule => new RegExp(`\\.${className}(?![\\w-])`).test(rule.selector))
      .filter(rule => canMatchStandalone(rule.selector))
      .some(rule => /flex\s*:\s*1\s+1\s+auto/.test(rule.body))
    expect(growsWhere(planted, 'itemTriageText'), 'the plant did not bite — the gate is not testing the defect').toBe(true)
    expect(growsWhere(css, 'itemTriageText'), 'the real sheet is reported as growing, so this gate can only be red').toBe(false)
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
    const planted = css.replace(/(\.itemSearch\s*\{[^}]*?)inline-size\s*:\s*[^;]+;/s, '$1inline-size: max-content;')
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
    // The class the panel puts on the wide band's filter wrapper, discovered
    // from the markup rather than named here, so a rename moves the gate with
    // the code.
    const panel = readFileSync(new URL('../src/client/item/panel.tsx', import.meta.url), 'utf8')
    const filterBar = readFileSync(new URL('../src/client/item/filter-bar.tsx', import.meta.url), 'utf8')
    const members = [...cssMembersOf(panel).keys(), ...cssMembersOf(filterBar).keys()]
      .filter(member => /Filter/i.test(member))
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

describe('the group arithmetic is stated once, and the counts do not follow a hidden switch', () => {
  const css = panelCss()

  it('every bucket head is separated from its rows by a rule, not by air alone', () => {
    // Judged by DECLARATION, never by looking at a capture: at the width the
    // captures are taken a l1 hairline can fall below the visible threshold, so
    // "I could not see it in the PNG" is not a fact about the code. The
    // question the code can answer is whether the head draws a rule, and it
    // does — the same declaration for every bucket, which is the point of
    // declaring it once on the head rather than per bucket.
    //
    // ALL FOUR, NOT ONE. The scan named four bucket families and then asserted
    // `length > 0`, which cannot tell four from one: drop the rule under three of
    // the heads and the gate is still green, because the fourth is still there.
    // So the question is asked PER FAMILY, and the family list is the gate's
    // whole content — a family with no line under any of its heads is reported
    // by name rather than counted away.
    const BUCKETS = ['itemGroupHead', 'itemAgendaDay', 'itemNoDateTray', 'itemGatedFold'] as const
    // A line is a VALUE, so `border-block-end: 0` — the rule that takes a day
    // label's line away when the day has no list — is not one.
    const bucketsOnAir = (text: string): string[] => {
      const rules = declarationRules(text)
      const drawsLine = (family: string): boolean => rules
        .filter(rule => rule.selector.includes(family))
        .some(rule => [...rule.body.matchAll(/(?:^|[;{\s])(?:border-block-end|border-bottom)\s*:\s*([^;]+)/g)]
          .some(call => !/^\s*(?:0|none)\s*$/.test(call[1] ?? '')))
      return BUCKETS.filter(family => !drawsLine(family))
    }
    const airOnly = bucketsOnAir(css)
    expect(
      airOnly,
      `these buckets draw no rule under their head: ${airOnly.join(', ')} — ${BUCKETS.length - airOnly.length} of ${BUCKETS.length} do, and a head is a caption floating over rows, which air alone does not separate`,
    ).toEqual([])
    // The reader, on a sheet that has all four families and one of them without
    // a line — the exact shape `length > 0` cannot see, because the other three
    // still carry theirs.
    const sheet = BUCKETS.map(family => `.${family}Head { border-block-end: var(--dsh-tb-border); }`).join('\n')
    expect(bucketsOnAir(sheet), 'the reader reports a sheet that gives every bucket a line').toEqual([])
    const GATED = '.itemGatedFoldHead { border-block-end: var(--dsh-tb-border); }'
    expect(
      bucketsOnAir(sheet.replace(GATED, '.itemGatedFoldHead { padding-block-end: 7px; }')),
      'a bucket whose line was removed was not reported by name, so the gate still cannot tell four from one',
    ).toEqual(['itemGatedFold'])
    // And the line taken away EXPLICITLY is not a line either — that is the
    // spelling the sheet itself uses to drop a day label's rule when the day has
    // no list, and reading it as a line would make a removal look like a fix.
    expect(
      bucketsOnAir(sheet.replace(GATED, '.itemGatedFoldHead { border-block-end: 0; }')),
      'a line explicitly set to 0 was counted as a line',
    ).toEqual(['itemGatedFold'])
  })

  it('the head keeps its arithmetic beside its name, not pushed to the end of the track', () => {
    // A toggle that grows takes the whole measure, so the step ratio beside it
    // is pushed to the far edge — hundreds of pixels from the group it counts.
    // Two numbers that belong together, printed at opposite ends of a line, no
    // longer read as one fact, and the reader's eye has to travel to do the
    // addition.
    //
    // STATED AS A NEGATIVE, NOT AS A REQUIREMENT, and that is the difference
    // between a gate that can be satisfied and one that cannot. The first
    // version of this demanded that EVERY rule naming the toggle declare
    // `flex: 0` — including the state rules (`:focus-visible`, the folded
    // selector), which legitimately declare no flex at all. The only ways to
    // satisfy that were to delete working rules or to rename classes, and both
    // are worse than the defect. What the gate is really for is "nothing here
    // grows", and that is checkable without asking anything of the rules that
    // are not about growth.
    const grows = declarationRules(css)
      .filter(rule => /\.itemGroupToggle(?![\w-])/.test(rule.selector))
      .flatMap(rule => [...rule.body.matchAll(/(?:^|[;{\s])flex(?:-grow)?\s*:\s*([^;]+)/g)]
        .map(match => ({ selector: rule.selector, value: (match[1] ?? '').trim() }))
        .filter(found => found.value.split(/\s+/)[0] === '1'))
    expect(grows, `the group head grows (${grows.map(g => `${g.selector}: flex: ${g.value}`).join(' | ')}) — the group's own arithmetic is then pushed to the far end of the track`).toEqual([])
    // The control, on strings it cannot have been tuned against.
    const growsIn = (text: string): number => declarationRules(text)
      .filter(rule => /\.itemGroupToggle(?![\w-])/.test(rule.selector))
      .flatMap(rule => [...rule.body.matchAll(/(?:^|[;{\s])flex(?:-grow)?\s*:\s*([^;]+)/g)])
      .filter(match => (match[1] ?? '').trim().startsWith('1')).length
    expect(growsIn('.itemGroupToggle { flex: 0 1 auto; }')).toBe(0)
    expect(growsIn('.itemGroupToggle:focus-visible { color: red; }')).toBe(0)
    expect(growsIn('.itemGroupToggle { flex: 1 1 auto; }')).toBe(1)
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
    const TABLE: Readonly<Record<number, readonly number[]>> = {
      16: [600], 14: [500, 600], 13: [400, 600], 12: [400, 600], 11: [400],
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
    const inner = rulesOf(css, 'itemDetailInner')
    expect(inner, 'there is no .itemDetailInner rule — the detail box below is checking nothing').not.toEqual([])
    for (const body of inner) {
      const isInlineContainer = /container-type\s*:\s*inline-size/.test(body)
      if (!isInlineContainer) continue
      expect(
        CONTENT_SIZED_IN_INLINE_AXIS.test(body) && !/inline-size\s*:\s*(?!0)/.test(body),
        '.itemDetailInner is align-self: start AND container-type: inline-size AND has no inline-size of its own, so its width comes from neither its contents nor the stretch — it computes to zero and the whole detail pane paints nothing',
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
    const sentences = rulesOf(css, 'itemTriageText')
    expect(sentences, 'there is no .itemTriageText rule — the sentence below is checking nothing').not.toEqual([])
    for (const body of sentences) {
      expect(body, '.itemTriageText refuses to wrap, so the longest sentence on the page is the one that gets cut').not.toMatch(/white-space\s*:\s*nowrap/)
    }
    const actions = rulesOf(css, 'itemTriageAction')
    expect(actions, 'there is no .itemTriageAction rule — the action beside the sentence is checking nothing').not.toEqual([])
    for (const body of actions) {
      // THE SPACE BELONGS INSIDE THE LOOKAHEAD, and that is not a detail.
      // Written as `border…\s*:\s*(?!0|none)`, the `\s*` after the colon can
      // match ZERO characters, so the lookahead is left looking at the space
      // BEFORE the `0` — which is not `0`, the lookahead passes, and `border: 0`
      // reports a border. The cheapest way to make that rule green is then to
      // delete a declaration that is already correct, which is the whole failure
      // hard rule 14 is about. Put the space in the lookahead, where the engine
      // cannot give it back.
      const drawn = body.match(/(?:^|[;{\s])border(?:-[a-z]+)?\s*:\s*(?!\s*(?:0|none)\b)/)?.[0]?.trim()
      expect(drawn, `.itemTriageAction draws "${drawn}", so a sentence's own action outranks the sentence`).toBeUndefined()
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
    expect(rulesNamed('.itemTriageText { white-space: normal; }', 'itemTriageText')).toBe(1)
    expect(
      rulesNamed('.itemTriageTextRenamed { white-space: nowrap; }', 'itemTriageText'),
      'the reader cannot tell a renamed class from a compliant one, so the guard above is the only thing standing between a rename and a silent pass',
    ).toBe(0)
  })

  it('nothing in the list track grows along the block axis', () => {
    // The 660px hole, as a rule rather than as a measurement. A column flex
    // container hands its direct children `flex-grow: 0` by default, and any
    // one of them that asks to grow becomes the height of the column: a
    // one-line sentence then reads as an empty box with a caption. Stating it
    // once for the track's children is the structural fix, and it covers the
    // sentence of today and whatever replaces it tomorrow.
    //
    // READ THE SELECTOR, NOT THE BODY. The universal selector can only appear
    // in the SELECTOR half of a rule — no spelling puts a `*` inside a
    // declaration block — so a version of this gate that searched the body
    // could never match anything, and the fix it demands (write
    // `.itemListCard > * { … }`) is exactly the fix it refuses to see. A gate
    // that reports "no rule here" for a rule that is sitting right there sends
    // the next author looking anywhere but the right place.
    const rules = declarationRules(css).filter(rule => /\.itemListCard\s*>\s*\*/.test(rule.selector))
    expect(rules.length, 'no rule states how the list track\'s direct children behave — the rule is left to each child, which is how one of them grew').toBeGreaterThan(0)
    for (const rule of rules) {
      const grow = /(?:^|[;{\s])flex(?:-grow)?\s*:\s*([^;]+)/.exec(rule.body)?.[1]?.trim() ?? ''
      // `flex: none` and `flex: 0` are the same promise written two ways, so
      // both answer the question; `flex: initial` and a missing declaration do
      // not, and are reported rather than assumed.
      expect(['0', 'none'], `${rule.selector} grows (flex: ${grow}) — a one-line sentence then becomes the height of the column`).toContain(grow.split(/\s+/)[0] ?? '')
    }
    // And the reader is proved both ways, on strings it cannot have been tuned
    // against, so this cannot pass by finding nothing.
    const growsOn = (text: string): boolean => declarationRules(text)
      .filter(rule => /\.itemListCard\s*>\s*\*/.test(rule.selector))
      .some(rule => !['0', 'none'].includes((/(?:^|[;{\s])flex(?:-grow)?\s*:\s*([^;]+)/.exec(rule.body)?.[1] ?? '').trim().split(/\s+/)[0] ?? ''))
    expect(growsOn('.itemListCard > * { flex: none; }')).toBe(false)
    expect(growsOn('.itemListCard > * { flex: 0 1 auto; }')).toBe(false)
    expect(growsOn('.itemListCard > * { flex: 1 1 auto; }')).toBe(true)
    // A universal selector that is NOT scoped to the track is a different rule
    // and must not be mistaken for this one.
    expect(growsOn('.somethingElse > * { flex: 1 1 auto; }')).toBe(false)
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
    const TABLE: Readonly<Record<number, readonly number[]>> = {
      16: [600], 14: [500, 600], 13: [400, 600], 12: [400, 600], 11: [400],
    }
    const stray = (sizes: number[]): number[] => sizes.filter(size => TABLE[size] === undefined)
    expect(stray([12, 13, 15])).toEqual([15])
    expect(stray([11, 12, 13, 14, 16])).toEqual([])
    // A weight the table does not allow at its size, and one it does.
    expect((TABLE[16] ?? []).includes(400)).toBe(false)
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
  function positionsOf(token: string): string[] {
    // A POSITION, NOT A SELECTOR — and that is the second half of what was wrong.
    //
    // Counting selectors made the keyboard focus ring cost eighteen positions: one
    // ring, drawn on eighteen different controls. A budget is a claim about what a
    // reader SEES, and a reader sees one ring. So the families that are visually
    // one thing are collapsed by their state, and everything else stands alone.
    //
    // The list is short ON PURPOSE. A family that is not named here is counted per
    // selector, which is the strict reading — so adding a new focus-like state
    // without naming it costs eighteen, and the budget says so loudly rather than
    // quietly reinterpreting itself.
    const FAMILIES: ReadonlyArray<{ readonly key: string; readonly is: (s: string) => boolean }> = [
      { key: '键盘焦点环', is: s => /:focus-visible\b/.test(s) },
    ]
    const positions = new Map<string, string[]>()
    for (const rule of declarationRules(css)) {
      if (!paintsToken(rule.body, token)) continue
      const family = FAMILIES.find(entry => entry.is(rule.selector))
      const key = family === undefined ? rule.selector : family.key
      const bucket = positions.get(key)
      if (bucket === undefined) positions.set(key, [rule.selector])
      else if (!bucket.includes(rule.selector)) bucket.push(rule.selector)
    }
    return [...positions.values()].map(group => group.join(' + '))
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
    const budget: Readonly<Record<string, number>> = {
      '--dsh-tb-accent': 7,
      '--dsh-tb-attention': 3,
      '--dsh-tb-danger': 3,
    }
    for (const [token, limit] of Object.entries(budget)) {
      const positions = positionsOf(token)
      expect(positions.length, `${token} paints ${positions.length} positions, over its budget of ${limit}: ${positions.join(' | ')}`).toBeLessThanOrEqual(limit)
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
    // NO SEED FOR THE SEARCH BOX, and that is not an omission: the search text is
    // the one view field deliberately NOT remembered, so a harness cannot open
    // the artifact on a filtered page. The filtered page is proven where it can
    // be — by pressing a facet, in `item-workbench.spec.ts`.
    writeRenderArtifact(target, empty ? [] : fixtures(), band, page)
    expect(existsSync(target)).toBe(true)
  })
})
