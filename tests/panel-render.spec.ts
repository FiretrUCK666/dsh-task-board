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
 * THE CANVAS / INNER SPLIT, as two token lists and nothing else.
 *
 * The rule is already written in the alias layer that defines these names
 * (board.module.css, `[data-dsh-taskboard-view]`): the wallpaper wash belongs
 * to the CANVAS layer only, and every inner surface consumes the opaque layer
 * tokens — the same "inner surfaces stay opaque" convention a glass skin uses
 * natively. So the panel root is a canvas, exactly like the board root beside
 * it, and everything drawn ON the panel is a layer.
 *
 * IT USED TO BE THE OTHER WAY ROUND, and the reason it was is worth keeping:
 * the old test asserted the root was NOT the canvas token, on the grounds that
 * "only the opaque inner tokens keep the wallpaper out". That reasoning is not
 * wrong about the INNER layer and wrong about the ROOT: a root painted with an
 * opaque layer token is a second opaque surface stacked on the canvas, which is
 * what makes a list read as a box rather than as a page. The reversal below
 * therefore STRENGTHENS the contract — it asserts BOTH sides, where the old one
 * asserted one and forbade the other.
 */
const CANVAS_TOKENS: readonly string[] = ['--dsh-tb-bg', '--dsh-tb-glass']
const OPAQUE_LAYER_TOKENS: readonly string[] = ['--dsh-tb-surface-sunken', '--dsh-tb-surface-menu', '--dsh-tb-surface-float']

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
 * Every rule that paints with a CANVAS token, named with its selector.
 *
 * This is the direction that catches a regression nobody would notice by
 * reading: a chip, a sticky group head or a row that quietly starts naming the
 * canvas token looks fine in the file and renders as the wallpaper coming
 * through a surface the reader was told was solid.
 * @param css - the sheet.
 * @returns one entry per offending rule.
 */
function canvasPainters(css: string): { selector: string; value: string }[] {
  const out: { selector: string; value: string }[] = []
  for (const rule of declarationRules(css)) {
    for (const match of rule.body.matchAll(/background(?:-color)?\s*:\s*([^;]+)/g)) {
      const value = (match[1] ?? '').trim()
      if (CANVAS_TOKENS.some(token => value.includes(`var(${token})`))) out.push({ selector: rule.selector, value })
    }
  }
  return out
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
    expect(/\.item[A-Z]/.test(css) && css.includes('src/client/board.module.css')).toBe(true)
    const boardOnly = readFileSync(join(cssPanelRoot(), 'board.module.css'), 'utf8')
    const leftover = [...boardOnly.matchAll(/^\.item[A-Z][A-Za-z]*\s*\{/gm)].map(m => m[0])
    expect(leftover, `these list rules are still in board.module.css: ${leftover.join(', ')}`).toEqual([])
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

  it('paints the CANVAS on the root and OPAQUE LAYERS on everything inside it', () => {
    // BOTH SIDES, and the second side is what the old version of this test
    // forgot. It asserted the root was not the canvas token and said nothing
    // about what the inner surfaces then used, so swapping the root for another
    // layer token passed — which is how the root ended up a second opaque box
    // stacked on the canvas, and the list read as a widget rather than a page.
    const root = /\.itemRoot\s*\{[^}]*\}/s.exec(css)?.[0] ?? ''
    const background = /background\s*:\s*([^;]+)/.exec(root)?.[1] ?? ''
    expect(background, 'the panel root does not paint at all').not.toBe('')
    expect(background, 'the panel root must eat the canvas token, exactly as the board root does — a root painted with a layer token is a second box on the page')
      .toMatch(/var\(--dsh-tb-bg\)/)
    // The same declaration as `.board`, to the character. The two roots are
    // siblings on the stage; a difference between them is a difference nobody
    // chose and nobody can see in a diff of the list's own sheet.
    const boardRoot = /\.board\s*\{[^}]*\}/s.exec(css)?.[0] ?? ''
    const boardBackground = /background\s*:\s*([^;]+)/.exec(boardRoot)?.[1]?.trim() ?? ''
    expect(background.trim(), 'the two stage roots have drifted apart').toBe(boardBackground)

    // The inner side: NO other rule on this surface may reach for the canvas.
    // Scoped to the LIST's own sheet, for the same reason the token-coverage
    // check is: the board is a different surface, and a check that spans both
    // is a check nobody can act on. `.board` and `.column` are canvas layers of
    // the board and are supposed to say so.
    const others = canvasPainters(itemSheet()).filter(finding => !/^\.itemRoot\b/.test(finding.selector))
    expect(others, `an inner surface is painting with the canvas token: ${others.map(o => `${o.selector} → ${o.value}`).join(' | ')}`).toEqual([])

    // And positively: the danger zone, the row menu and the card layer each
    // name an opaque LAYER token. Two of the three are named because the design
    // committed to which token each one takes; the card layer is checked as a
    // TOKEN rather than as a class, because a card is the unit the whole page
    // is made of and a rule that forgot to paint it would leave the wallpaper
    // showing through the surface the reader was told was solid.
    for (const [name, token] of [['itemDangerZone', '--dsh-tb-surface-sunken'], ['itemRowMenu', '--dsh-tb-surface-menu']] as const) {
      const layers = backgroundOf(css, name).filter(value => value.includes(`var(${token})`))
      expect(layers, `.${name} does not paint with ${token}: ${JSON.stringify(backgroundOf(css, name))}`).not.toEqual([])
    }
    const cardLayer = declarationRules(css)
      .filter(rule => /background(?:-color)?\s*:/.test(rule.body))
      .filter(rule => OPAQUE_LAYER_TOKENS.some(token => rule.body.includes(`var(${token})`)))
    expect(cardLayer.map(rule => rule.selector), 'nothing on this surface paints an opaque layer, so the tiles and the list cards are canvas').not.toEqual([])
    expect(cardLayer.some(rule => rule.body.includes('var(--dsh-tb-surface-float)')),
      'no card on this surface paints the card layer — the tiles and the list cards have no surface of their own').toBe(true)
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
    const live = stripCssComments(css)
    for (const block of live.matchAll(/@media \(hover: none\) and \(pointer: coarse\) \{([\s\S]*?)\n\}/g)) {
      const body = block[1] ?? ''
      expect(body, 'the touch query changes a visual size, not just a hit area').not.toMatch(
        /(?:font-size|inline-size|block-size|width|height|padding|border-width)\s*:\s*(?!24px|44px|16px)[\d.]+px/,
      )
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

  it('the STANDALONE sentence does not grow vertically, so it cannot open a hole in the column', () => {
    // The panel prints 「没有等你动手的事」 as a paragraph of its own inside the
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
    const bodies = rulesOf(css, className ?? '')
    expect(bodies.length, `there is no .${className} rule`).toBeGreaterThan(0)
    for (const body of bodies) {
      const grow = /(?:^|[;{\s])flex(?:-grow)?\s*:\s*([^;]+)/.exec(body)?.[1] ?? ''
      const grows = /(?:^|\s)1(?:\s|$)/.test(grow.split(/\s+/)[0] ?? '') && !/^0/.test(grow.trim())
      expect(grows, `.${className} grows along the block axis (flex: ${grow.trim()}) — a one-line sentence then becomes the height of the column`).toBe(false)
    }
  })

  it('the probe bites: a planted grow is reported, and the real sheet is not', () => {
    const planted = css.replace(/(\.itemTriageText\s*\{)/, '$1\n  flex: 1 1 auto;')
    const grows = (className: string): boolean => rulesOf(planted, className)
      .some(body => /flex\s*:\s*1\s+1\s+auto/.test(body))
    expect(grows('itemTriageText'), 'the plant did not bite').toBe(true)
    expect(grows('itemNothingHere'), 'the plant leaked into a class that does not exist — the probe is not testing the detector').toBe(false)
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
    const heads = declarationRules(css).filter(rule => /(?:itemGroupHead|itemAgendaDay|itemNoDateTray|itemGatedFold)/.test(rule.selector))
      .filter(rule => /(?:^|[;{\s])(border-block-end|border-bottom)\s*:\s*([^;]+)/.test(rule.body))
    expect(heads.length, 'no bucket head draws a rule under itself').toBeGreaterThan(0)
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
    for (const body of rulesOf(css, 'itemDetailInner')) {
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
    for (const body of rulesOf(css, 'itemTriageText')) {
      expect(body, '.itemTriageText refuses to wrap, so the longest sentence on the page is the one that gets cut').not.toMatch(/white-space\s*:\s*nowrap/)
    }
    for (const body of rulesOf(css, 'itemTriageAction')) {
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
    for (const body of rulesOf(css, 'itemDue').filter(text => /\[data-tone/.test(text))) {
      const allowed = new Set(['color', 'background', 'background-color', 'border-color', 'fill', 'stroke', 'opacity'])
      const declared = [...body.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:/g)].map(match => match[1] as string)
      const extra = declared.filter(property => !allowed.has(property) && property !== 'data-tone')
      expect(extra, `a date tone changes ${extra.join(', ')} as well as the ink — a tone is one signal, and a second one competes with it`).toEqual([])
    }
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
    const paints = new RegExp(`(?:^|[;\\s])(?:color|background(?:-color)?|border[\\w-]*color|fill|stroke)\\s*:\\s*var\\(${token}\\)(?!\\s*,)`)
    const selectors = new Set<string>()
    for (const rule of declarationRules(css)) {
      if (paints.test(rule.body)) selectors.add(rule.selector)
    }
    return [...selectors]
  }

  it('accent, attention and danger each stay inside their stated budget', () => {
    // The budgets are small on purpose. A semantic ink used in eight places is
    // not a signal any more; it is the colour of the product, and the one row
    // that is genuinely urgent arrives in the same ink as the chrome.
    const budget: Readonly<Record<string, number>> = {
      '--dsh-tb-accent': 5,
      '--dsh-tb-attention': 3,
      '--dsh-tb-danger': 4,
    }
    for (const [token, limit] of Object.entries(budget)) {
      const positions = positionsOf(token)
      expect(positions.length, `${token} paints ${positions.length} positions, over its budget of ${limit}: ${positions.join(' | ')}`).toBeLessThanOrEqual(limit)
    }
  })

  it('the counter bites, and a colour that is only a fallback is not a position', () => {
    const painted = '.a { color: var(--dsh-tb-accent); }\n.b { border-color: var(--dsh-tb-accent); }\n.c { color: var(--dsh-tb-accent, red); }\n.d { --x: var(--dsh-tb-accent); }\n'
    const count = (text: string): number => {
      const selectors = new Set<string>()
      for (const rule of declarationRules(text)) {
        if (/(?:^|[;\s])(?:color|background(?:-color)?|border[\w-]*color)\s*:\s*var\(--dsh-tb-accent\)(?!\s*,)/.test(rule.body)) {
          selectors.add(rule.selector)
        }
      }
      return selectors.size
    }
    // Two paint; the fallback does not (the author already answered for the
    // silent host), and a custom property that merely stores the token paints
    // nothing at all.
    expect(count(painted), 'the counter is wrong about which declarations paint').toBe(2)
  })
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
    writeRenderArtifact(target, empty ? [] : fixtures(), band, page)
    expect(existsSync(target)).toBe(true)
  })
})
