/**
 * The card contract (domain grouping — the two halves of ONE guarantee):
 *
 * card no-breakout CSS contract — the compact kanban card must never let any
 * text escape its box, whatever content lands inside it now or later. That
 * guarantee is enforced by the CSS in board.module.css; this spec freezes the
 * contract so a future refactor that removes or weakens any layer fails the
 * build instead of regressing the bug silently.
 *
 * Contract (three layers):
 *   1. the card box is a hard clip boundary (overflow: hidden);
 *   2. every text path inside the card truncates rather than stretching
 *      (min-width: 0 on every flex child, shrinkable cardTime, the chip
 *      body ellipsis wrapper, overflow-wrap on title/excerpt);
 *   3. chips may shrink but never exceed their container.
 *
 * card chip label composition — the compact card's badges are assembled from
 * locale copy through the pure helpers in TaskCard.tsx; this pins the exact
 * strings in both languages for every run state (plain running + each waiting
 * kind), so the card's text can never drift from its copy and the composed
 * labels stay short enough to truncate gracefully instead of overflowing.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { primaryChipLabel, settledChipLabel } from '../src/client/board/TaskCard.tsx'
import { blockedCauseOf } from '../src/core/automation.ts'
import { cardUpdatedAtOf } from '../src/client/board/card-view.ts'
import { createTask, withSchedule } from '../src/core/tasks.ts'
import { withSessionRules } from '../src/core/automation.ts'

const cssPath = fileURLToPath(new URL('../src/client/board.module.css', import.meta.url))
const source = readFileSync(cssPath, 'utf8')

/** The [start, end) character ranges of every conditional block of one kind
 *  (`@media` / `@container`), found by brace-walking — used to prove a rule is
 *  NOT inside one (both ends must share it). */
function conditionalRanges(css: string, kind: '@media' | '@container'): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const opener = new RegExp(`${kind}[^{]*\\{`, 'g')
  let match: RegExpExecArray | null
  while ((match = opener.exec(css)) !== null) {
    let depth = 1
    let cursor = match.index + match[0].length
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1
      else if (css[cursor] === '}') depth -= 1
      cursor += 1
    }
    ranges.push([match.index, cursor])
  }
  return ranges
}

/** Extract the top-level rule block whose opening line is exactly ".name {". */
function ruleOf(name: string): string | undefined {
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== `.${name} {`) continue
    let depth = 0
    const chunks: string[] = []
    for (let j = i; j < lines.length; j++) {
      const line = lines[j]
      chunks.push(line)
      for (const ch of line) {
        if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0) return chunks.join('\n')
        }
      }
    }
    return chunks.join('\n')
  }
  return undefined
}

function expectRule(name: string): string {
  const block = ruleOf(name)
  if (block === undefined) throw new Error(`rule ".${name}" not found in board.module.css`)
  return block
}

describe('the column header and the cards under it share ONE text edge', () => {  // MEASURED, NOT ASSUMED. Before this contract, one board column showed body
  // text at four left edges: status dot 37, column title 51, card title 38,
  // coloured-card title 53, workspace name 49. The column's own NAME was 13px
  // right of the cards sitting under it, which is what 「没对齐」 looks like
  // when you cannot name the number.
  //
  // The cause was not the padding — `.columnHeader`'s box already EQUALS the
  // cards' content box (cards 8px inset + card 12px padding). It was the 8px
  // status dot sitting INSIDE that box as a flex child, pushing the title out
  // by 8 + the gap. So the invariant is not 「the paddings match」, which was
  // already true and so gated nothing; it is that NOTHING IN FLOW may precede
  // the title, which is the thing that was actually wrong.
  it('keeps the column name on the same left edge as the cards under it', () => {
  const header = ruleOf('columnHeader') ?? ''
  expect(header, '.columnHeader is gone — the column name has no row of its own').not.toBe('')
  expect(header.match(/gap:\s*(\d+)/)?.[1],
    'the header has a gap again, so anything in flow is offset from the title').toBe('0')
  // The dot must be out of flow, and it must hang in the inset the cards leave.
  // `ruleOf` matches one bare class, so the compound selector is read directly.
  const dot = ruleFor('.columnHeader > .statusDot')
  expect(dot, 'the header status dot is back in flow, so it pushes the title off the card edge').not.toBe('')
  expect(dot).toMatch(/position:\s*absolute/)
  // A containing block, or the dot resolves against the BOARD and lands in the
  // same place in every column. This is the specific way the fix can be absent
  // and every declaration can still be present.
  expect(header, 'the dot is absolute but the header is not positioned, so it escapes to the board')
    .toMatch(/position:\s*relative/)
  expect(dot, 'the dot must be centred against the header height, not the top edge').toMatch(/inset-block-start:\s*50%/)
  // ── THE RAIL, AND WHAT IS ACTUALLY BEING CLAIMED ABOUT IT ────────────────
  //
  // The claim is not a number. It is: **a mark hangs in the card's rail — air in
  // front of it, a gap behind it — and it hangs there by being IN FLOW, so it
  // sits on the line of the words beside it.** All four are relations, and they
  // are asserted as relations on purpose: earlier versions of these assertions
  // pinned a literal (21px, then 28px, then 32px) and every fix to the rail had
  // to go and restate it, which is how a number stops meaning anything.
  //
  // What broke three times, and every time silently, was the SHAPE:
  //
  //   1. marks in the flow, so a coloured card's title sat 13px right of a plain
  //      one's — four text edges in one column;
  //   2. marks hung at a literal offset inside a padding too small to hold them,
  //      so an 8px mark ended exactly where the title began: 0px of gap on one
  //      side and 4px on the other. The dot touched the title AND the card's
  //      edge, and neither reads as a number — it reads as 「间距不太对」;
  //   3. marks back out of flow, which fixed 2 and cost the VERTICAL: an
  //      absolutely positioned mark takes its top from the static position rather
  //      than from the line of the text beside it, so the 6px dot in front of a
  //      session name floated half a pixel high and the row read as two things at
  //      two heights. **This is the one the horizontal numbers could never have
  //      shown**, which is why the assertion below is about the mark being in
  //      flow and not about any offset.
  const columnRule = ruleOf('column') ?? ''
  const air = /--card-mark-air:\s*([\d.]+)px/.exec(columnRule)?.[1]
  const markGap = /--card-mark-gap:\s*([\d.]+)px/.exec(columnRule)?.[1]
  expect(air, '--card-mark-air is gone from `.column`, so nothing states the room in front of a mark').toBeDefined()
  expect(markGap, '--card-mark-gap is gone from `.column`, so nothing states the room behind it').toBeDefined()
  // The substantive number: the air must be at least the mark's own width, which
  // is the width at which a dot stops reading as a mark and starts reading as a
  // bullet jammed against the card's border. 24 / 28 / 32 / 36 and 6 / 8 / 10 were
  // all rendered side by side at the real width before these were chosen.
  expect(Number(air), `a ${air}px air around an 8px mark reads as a bullet, not as a mark`).toBeGreaterThanOrEqual(8)
  // The rail is the SUM, declared as a sum — a rail written as one number is a
  // number that has to be re-guessed every time either half moves.
  expect(columnRule, 'the rail is a literal again, so the air and the gap can drift apart')
    .toMatch(/--card-mark-col:\s*calc\(var\(--card-mark-air\)\s*\+\s*8px\s*\+\s*var\(--card-mark-gap\)\)/)

  // The card's left padding IS the rail, spelled by name.
  const cardPadding = (ruleOf('card') ?? '').match(/padding:\s*([^;]+)/)?.[1] ?? ''
  expect(cardPadding.trim().split(/\s+/)[3],
    'the card\'s left padding is a literal again, so the rail and the marks\' offsets can drift apart')
    .toBe('var(--card-mark-col)')

  // BOTH MARKS, IN FLOW, HUNG BY A NEGATIVE MARGIN. The `position: absolute`
  // check is the load-bearing half: a mark that is out of flow is out of flow
  // vertically too, and the symptom is a dot sitting half a pixel above the name
  // it belongs to.
  for (const [selector, centreNudge] of [['.cardColorMark', ''], ['.cardWorkspaceDot', '\\s*\\+\\s*1px']] as const) {
    const body = ruleFor(selector)
    expect(body, `${selector} is positioned out of flow, so its top comes from the static position and it floats above the line of the words beside it`)
      .not.toMatch(/position:\s*absolute/)
    expect(body, `${selector} is not hung in the card's rail by a negative margin, so it either pushes the text right or lands on it`)
      .toMatch(new RegExp(`margin-inline-start:\\s*calc\\(var\\(--card-mark-air\\)${centreNudge}\\s*-\\s*var\\(--card-mark-col\\)\\)`))
  }

  // And the room BEHIND the mark is the same number on both rows. They were 7 and
  // 0 at one point, which is the same complaint about two different rows.
  for (const row of ['.cardTitleRow', '.cardWorkspace'] as const) {
    expect(ruleFor(row), `${row} does not read the rail's gap, so 「the words are too far from the dot」 is true of one row and not the other`)
      .toMatch(/gap:\s*var\(--card-mark-gap\)/)
  }

  // The column's two numbers read the same tokens, so the header cannot drift
  // from the cards: the name sits where the cards' titles sit, and its dot where
  // the cards' marks sit.
  expect(header,
    'the column name no longer reads the cards\' rail, so the header and the cards under it can drift')
    .toMatch(/padding:[^;]*var\(--column-frame\)\s*\+\s*var\(--card-gutter\)\s*\+\s*var\(--card-mark-col\)/)
  expect(dot,
    'the header dot no longer reads the cards\' mark line, so the column shows two marks at two x')
    .toMatch(/inset-inline-start:\s*calc\(var\(--column-frame\)\s*\+\s*var\(--card-gutter\)\s*\+\s*var\(--card-mark-air\)\)/)
  })

  it('a mark is dropped onto the x-height band, and there is ONE number for it', () => {
    // A LINE BOX IS NOT THE TYPE. It reserves room for descenders whether or not
    // the string has any, so its centre sits above the band where the glyphs
    // actually are, and a dot centred on it reads high. Measured on this surface:
    // at 11px the name's x-height band ran y=186..192 (mid 189) and the dot's
    // centre measured 189 after the correction and 188 before it — one pixel,
    // which is exactly what 「那个点还是比它高了一点点」 is, and exactly what a
    // horizontal measurement can never have found.
    //
    // The check is that the correction is a NAMED token rather than a literal,
    // and that it is a `transform` rather than a margin. The margin form is the
    // trap: on an `align-items: center` flex item the free space is halved around
    // the margins, so a 1px `margin-top` moves the box by HALF a pixel and the
    // correction silently under-delivers — which is indistinguishable, in a
    // screenshot, from not having fixed it at all.
    const root = /\[data-dsh-taskboard-view\][^{]*\{([^}]*)\}/s.exec(source)?.[1] ?? ''
    expect(root, '--dsh-tb-mark-drop is not declared, so every mark will re-guess its own optical centring')
      .toMatch(/--dsh-tb-mark-drop:\s*[\d.]+px/)
    for (const selector of ['.cardWorkspaceDot'] as const) {
      const body = ruleFor(selector)
      expect(body, `${selector} does not read the shared optical-centring number`)
        .toMatch(/transform:\s*translateY\(var\(--dsh-tb-mark-drop\)\)/)
      expect(body, `${selector} corrects its height with a margin, which on a centred flex item moves the box by half of it`)
        .not.toMatch(/margin-top:\s*[\d.]+px/)
    }
  })

  it('a chip on a card is an object, not a run-on word in a sentence', () => {
    // MEASURED: a card carrying four chips rendered as one sentence — 「3会话 验收通过
    // 硬期限9/30」 — because every card chip is `fill={false}` (plain 12/500 text,
    // deliberately, so the primary line does not have to shout over a row of
    // pills) AND `.cardBadges` uses the same 8px as the meta row above it. Plain
    // text with no edge, at one rhythm with everything else, is a paragraph.
    //
    // The check is that the chip OWNS a boundary. A filled pill is not required —
    // that would undo the quiet-card decision — so the assertion is on a
    // hairline, which is the quietest edge the design system has.
    const rule = ruleFor('.cardBadges .chip')
    expect(rule, 'card chips have no edge again, so a multi-chip card reads as one sentence').not.toBe('')
    // THE CLAIM, NOT THE SPELLING. This used to read
    // `border: var(--dsh-tb-border-soft)`, which pins ONE way of writing a
    // hairline rather than the hairline itself — and this same file has already
    // ruled that move out twice (see the colour mark and the workspace dot
    // below, where the mechanism is explicitly left free). What has to hold is
    // that the chip draws an edge that is not zero.
    expect(rule, 'the chip declares no border, so the two words of a chip row touch').toMatch(/(?:^|[;\s])border(?:-[a-z-]+)?\s*:\s*(?!0\b|none\b)/)
    // Padding is what makes it read as an edge the chip owns rather than a rule
    // floating between two words. It is a TOKEN now, and the reason is below.
    expect(rule, 'the chip has a border but no bearing, so the edge touches the text')
      .toMatch(/(?:^|[;\s])padding(?:-inline)?\s*:\s*0\s+var\(--card-badge-pad\)/)

    // THE COMPENSATION, and this is the half the old assertion could not see.
    // A chip's own bearing plus its hairline pushes its TEXT right of the meta
    // row directly above it, which spends no bearing of its own — MEASURED: the
    // 待你决断 / 新留言 row sat 7px right of 「更新于 …」 on the same card, so the
    // badge row read as indented rather than as aligned.
    //
    // So the row gives back exactly what the chip takes, and the two numbers are
    // named ONCE on the row and spent by the chip through the same tokens. That
    // is the whole reason they are tokens: a hand-written `calc(-1 * 7px)` is
    // correct on the day it is written and silently wrong the day somebody rounds
    // the border from 1px to 2px.
    const row = ruleFor('.cardBadges')
    const hair = /--card-badge-hair\s*:\s*([^;]+)/.exec(row)?.[1]?.trim()
    const pad = /--card-badge-pad\s*:\s*([^;]+)/.exec(row)?.[1]?.trim()
    expect(hair, 'the badge row does not name the hairline width it gives back').toBeDefined()
    expect(pad, 'the badge row does not name the bearing it gives back').toBeDefined()
    expect(hair, 'the hairline the row gives back is not a length').toMatch(/^\d*\.?\d+px$/)
    expect(pad, 'the bearing the row gives back is not a length').toMatch(/^\d*\.?\d+px$/)
    expect(rule, 'the chip spends a border width the row does not give back').toContain('border: var(--card-badge-hair) solid')
    expect(rule, 'the chip spends a bearing the row does not give back').toContain('padding: 0 var(--card-badge-pad)')
    // **AND THE ROW IS NOT SHIFTED — zero offset, in EITHER direction.** Two
    // mistakes look like one problem here and both were made in this file:
    //
    //   1. no offset at all → the chips' TEXT sits one bearing right of 「更新于」,
    //      which reads as 「这一行往右偏了」;
    //   2. compensating by the chip's bearing → the chips' BOX then hangs LEFT of
    //      the content edge, which reads as 「有东西从卡片里探出来」.
    //
    // **Neither is the fix, and that is the finding.** A chip with a visible border
    // is aligned by its BOX: the box belongs on the content edge — the same x as
    // 「更新于」 above and the card title above that — and the text inside it yields
    // to its own bearing, which is the chip's business and not this row's alignment.
    // The reference workbench puts its badges flush with the text column for exactly
    // this reason, and its badges are bordered too.
    //
    // So the claim is one line and it is checkable: **this row is not moved.**
    expect(row, 'the badge row is shifted along the inline axis, so its chips no longer start on the same left edge as the line above — either sign of a shift is the same defect')
      .not.toMatch(/margin-inline-start|translate|left:/)
  })

  it('every LEADING MARK on a card hangs in the padding, so one column has one text edge', () => {
    // MEASURED across the whole board: a single column's left rail held FOUR
    // distinct text x — card title 38, workspace name 49, column name 51 (before
    // the header fix), coloured card title 53. Seven ragged left edges on one
    // screen, before reading a word.
    //
    // The column name is fixed by the header padding. The other two are INSIDE
    // the card, and they have the same cause as each other and as the header's
    // status dot: a leading MARK placed inside the content box spends the very
    // position the text is supposed to start at. 38 + 6 + 5 = 49 for the
    // workspace dot; 38 + 8 + 7 = 53 for the colour mark.
    //
    // So the invariant is one sentence: a mark is not content, and content that
    // leads text must not be what decides where the text starts. All three are
    // checked here rather than in three places, because it is ONE rule and the
    // failure repeats.
    // THE INVARIANT IS NOT THE MECHANISM. This used to read
    // `expect(mark).toMatch(/position:\s*absolute/)`, which pinned the spell rather
    // than the claim — and the spell is what cost the vertical alignment: a mark
    // out of flow takes its top from the static position rather than from the line
    // of the words beside it, so the workspace dot floated half a pixel above the
    // session name and the row read as two things at two heights.
    //
    // The claim is one sentence and it survives every mechanism tried so far: **a
    // mark is not content, and a mark that leads text must not be what decides
    // where the text starts.** So this asserts the only thing that actually
    // decides it — the mark's own inline bearing, which has to be NEGATIVE, i.e.
    // it must give its width back — and the mechanism is left to be chosen again.
    // The claim is one sentence: a mark is not content, so it must not occupy the
    // text's own column. **Two mechanisms satisfy that, and which one a given mark
    // uses is a fact about THAT mark's rail** — a card mark hangs in the rail by
    // handing its width back, while a column's dot hangs in the gutter the cards
    // leave by leaving the flow entirely. Asking for one spelling would forbid the
    // other, so this asks the question.
    //
    // A mark that is out of flow must also say WHERE it lands: `position: absolute`
    // with no inset is a mark floating over whatever happens to be to its left, and
    // that is a worse defect than the one it replaced.
    const MARKS: readonly (readonly [string, string, boolean])[] = [
      ['the colour mark', '.cardColorMark', false],
      ['the workspace dot', '.cardWorkspaceDot', false],
      ["the column's status dot", '.columnHeader > .statusDot', true],
    ]
    for (const [name, selector, outOfFlow] of MARKS) {
      const mark = ruleFor(selector)
      if (outOfFlow) {
        expect(/position\s*:\s*absolute/.test(mark),
          `${name} is supposed to hang in the gutter the cards leave, and it is in the text's own column instead — the column's name gets pushed right by the dot's own width`).toBe(true)
        expect(mark,
          `${name} is out of flow but says nowhere to land, so it floats over whatever is to its left`).toMatch(/inset-inline-start\s*:|inset\s*:/)
        continue
      }
      const bearing = /margin-inline-start\s*:\s*([^;]+)/.exec(mark)?.[1] ?? ''
      expect(bearing, `${name} is in the text's own column and gives nothing back, so it pushes the text off the line — the rail exists so a mark can hang in the padding instead`).not.toBe('')
      expect(bearing, `${name} occupies width in the text's column — it must hand its width back, or its width becomes the title's indent`)
        .toMatch(/^calc\(.*-\s*var\(--card-mark-col\)\)$/)
    }
  })

  it('a row that slipped BOTH dates says both, and the plan never wears the hard tone', () => {
    // `view.soft` has existed with a doc comment reading 「so a row with both dates
    // says both」, and NOTHING read it. The combined `posture` ranks the hard
    // deadline ahead of the plan — correctly, because missing a hard deadline is
    // worse — but that ranking is a choice about which fact to LEAD with, and it
    // had quietly become a choice about which facts to SAY. A row that slipped both
    // showed only 「超期 N 天」, so the plan's slip was invisible.
    //
    // The gate is on the SURFACE, because the defect was a derivation nobody read:
    // the model was always right, so every model-level gate was green throughout.
    const row = readFileSync(fileURLToPath(new URL('../src/client/item/row-line.tsx', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const detail = readFileSync(fileURLToPath(new URL('../src/client/item/detail-pane.tsx', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(detail, 'the plan is judged on its own, beside the column that names it').toContain('item.dates.behind')
    // AND THE ROW CARRIES ONE READING. Two is how 「超期」 stops meaning one thing:
    // the tail is the only date reading the row prints, so the plan's slip has
    // exactly one place to live, and it is not here.
    const tails = (row.match(/css\.itemRowTail/g) ?? []).length
    expect(tails, `the row prints a date reading in ${tails} places — one word cannot mean two things`).toBe(1)
    // A SLIPPED PLAN IS NEVER PAINTED IN THE HARD TONE. Painting it red is how a
    // soft deadline becomes a hard one without anybody deciding that — and the tone
    // is chosen where the verdict is, not where it is printed.
    expect(row, 'a slipped plan is painted with the hard tone').not.toMatch(/case 'behind':[\s\S]{0,120}tone: 'over'/)

    expect(row, 'the hard verdict is spoken only for the hard date').toMatch(/case 'hardOverdue':[\s\S]{0,120}tone: 'over'/)

    // AND THE ROW PRINTS THE VERDICT ITS POSTURE NAMES. `dueLine` is a switch over
    // one `posture.kind` and every arm names its own tone, so there is no path that
    // prints a verdict the posture did not choose — which is the shape a row carries
    // one reading in.
    expect(row, 'the verdict is chosen by the posture, not beside it').toMatch(/function dueLine[\s\S]*switch \(posture\.kind\)/)
  })

  it('a contradiction names the two fields that DISAGREE, not a fixed pair', () => {
    // MEASURED: `itemDateConflict` reports three possible pairs, and the row's
    // contradiction sentence named 「最早开始 / 截止」 for all of them. So a row
    // whose 截止 sat past its 硬期限 read
    // 「最早开始晚于它该守的截止」 — it named a field that was never in conflict
    // and pointed at the one that was as though it were the bound.
    //
    // `DESIGN.md` requires the sentence to name the two that actually disagree,
    // and that is only possible if BOTH travel with the conflict. So the gate is
    // on the conflict carrying both, not on the row: a row-level assertion would
    // pass as soon as one pair reads right, which is the state this was in.
    const item = readFileSync(fileURLToPath(new URL('../src/core/item.ts', import.meta.url)), 'utf8')
    expect(item, 'the conflict reports the offending field but not the one it is bounded by')
      .toMatch(/readonly limitField: 'startsAfter' \| 'dueAt' \| 'hardDueAt'/)
    // All THREE pairs must carry it — a `limitField` on only one of them is the
    // same defect one row narrower.
    for (const [of, by] of [['startsAfter', 'dueAt'], ['dueAt', 'hardDueAt'], ['startsAfter', 'hardDueAt']] as const) {
      const conflict = new RegExp(`field: '${of}'[^}]*limitField: '${by}'`).test(item)
      expect(conflict, `the ${of} > ${by} conflict does not say which field the bound belongs to`)
        .toBe(true)
    }
    // And the row must read both names OFF the conflict, never restate a pair.
    const row = readFileSync(fileURLToPath(new URL('../src/client/item/row-line.tsx', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(row, 'the contradiction sentence still names a fixed pair')
      .not.toMatch(/a: t\('item\.field\.startsAfter'\)/)
    expect(row, 'the contradiction sentence does not read its two names off the conflict')
      .toMatch(/a: t\(DATE_FIELD_KEY\[posture\.conflict\.field\]\)/)
    expect(row).toMatch(/b: t\(DATE_FIELD_KEY\[posture\.conflict\.limitField\]\)/)
  })

  it('a page with NO batch bar can never draw a pickbox', () => {
    // PRODUCT.md says the inbox and the agenda have no multi-select at all, and
    // per AGENTS.md PRODUCT wins: the code is what changes. It did not.
    //
    // The panel's comment claimed the omission was "enforced by not handing them
    // the slot". **The slot was not the only channel**: the shared `renderRows`
    // read the holding itself, so arm on the list, switch to the agenda, and the
    // agenda's rows carried checkboxes that tick into a holding with no bar on the
    // page and no way to disarm.
    //
    // The gate is on the CHANNEL, not on each page's good behaviour: `renderRows`
    // must take the picking state AND the armed mode as arguments, so a page
    // cannot inherit either by being handed the same factory. A per-page
    // assertion ("inbox passes false") would be three assertions that each need
    // remembering; this is one. THE MODE TRAVELS WITH THE PAGE FACT, because the
    // tickbox is armed mode's face: a page that could get `armed` without a batch
    // bar, or a bar over rows whose boxes absent, would be the same defect in the
    // opposite direction — so both arguments are pinned on the contract and on
    // every call the gate knows about.
    const props = readFileSync(fileURLToPath(new URL('../src/client/item/pages/page-props.ts', import.meta.url)), 'utf8')
    expect(props, 'renderRows takes no picking argument, so every page inherits the shared holding')
      .toMatch(/renderRows: \(list: readonly ItemRecord\[\], picking: boolean, armed: boolean\)/)
    for (const [name, call] of [['schedule', /renderRows\(bucket\.items,\s*false,\s*false\)/]] as const) {
      const page = readFileSync(fileURLToPath(new URL(`../src/client/item/pages/${name}.tsx`, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(call.test(page), `${name}.tsx draws pickboxes although PRODUCT.md gives it no multi-select`)
        .toBe(true)
    }
    /* AND THE GATE COVERS EVERY PAGE BY CONSTRUCTION, not by a hand-kept list of
     * files to check. 收件 used to be the second entry here; it is gone, and the
     * thing that has to survive its removal is the REASON this loop exists — that a
     * page cannot inherit the holding by being handed the shared factory. So the
     * check is `ITEM_PAGES` read off disk against the loop's own names: a page added
     * tomorrow without an entry here is a red test rather than a page nobody
     * checked. */
    const pagesSource = readFileSync(fileURLToPath(new URL('../src/core/item-counts.ts', import.meta.url)), 'utf8')
    const declared = /export const ITEM_PAGES = \[([^\]]*)\]/.exec(pagesSource)?.[1] ?? ''
    const pages = [...declared.matchAll(/'([a-z]+)'/g)].map(match => match[1])
    const batched = ['list']
    for (const page of pages) {
      const expected = batched.includes(page)
      const covered = expected || ['schedule'].includes(page)
      expect(covered, `the page 「${page}」 is not covered by the pickbox gate, so its rows are unchecked`).toBe(true)
    }
    // And the one page that DOES batch takes the real state, not a constant.
    const list = readFileSync(fileURLToPath(new URL('../src/client/item/pages/list.tsx', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // THE SECOND ARGUMENT IS THE CLAIM, so the gate reads that and not the row list.
    // It pinned `renderRows(slice.items, props.picking)` — the list page's rows
    // arrive as ONE flattened list now that the status buckets are gone, so the
    // spelling moved and the behaviour did not.
    // A bounded span rather than `[^)]*`, because the first argument is now
    // `slices.flatMap(slice => slice.items)` and **the first `)` is inside it** —
    // so a pattern that stops at the first closing parenthesis reads a truncated
    // call and reports the page as having lost the argument. A gate whose pattern
    // cannot count one level of nesting is a gate that will keep finding defects in
    // the pattern.
    // THE THIRD ARGUMENT IS THE MODE, and it must be the page's own `armed`
    // reading — a constant `true` here would put boxes on every list page no
    // matter what the palette's 「多选」 did, which is the invisible mode all
    // over again.
    expect(list, 'the list page has a batch bar but does not hand renderRows the real picking state')
      .toMatch(/renderRows\([\s\S]{0,160}?,\s*props\.picking,\s*props\.armed === true\s*\)/)
  })

  /**
   * WHAT THE PANEL RECONCILES ITS HOLDING AGAINST, and whether the set is built
   * by asking the matcher over the document.
   *
   * THE CLAIM IS ABOUT A NAME, NOT ABOUT A LINE. The defect is a value that
   * answers the wrong question: a set of rows that is 「the rows the detail rail
   * is about」 rather than 「the rows that pass the filter」. On the wide band the
   * rail is always present, so a row being read is the NORMAL state and such a
   * set collapses to one id — arm, tick three other rows, type one character in
   * the search box, and all three are dropped. A holding died from a keystroke
   * that had nothing to do with selecting.
   *
   * THE READING IS SHAPE-AGNOSTIC, and getting there took two tries, both
   * instructive. A version matching `const x = items.filter(item => itemMatches(`
   * demanded one particular SPELLING: wrapping the value in `useMemo` — which is
   * what a list of forty rows needs — turned a true claim red. Fixing that with
   * 「up to the first newline that closes a call」 was no better: it then rejected
   * a correct ONE-LINER, because the terminator it waited for never arrived. A
   * check that pushes the implementation into a worse shape is a check about
   * typography, and the project already wrote that rule down. So the gate asks
   * the QUESTION — is the reconciled set built by the matcher over the document?
   * — inside a bounded window after the declaration, and reads whatever shape
   * the answer is written in.
   */
  function readHolding(src: string): { readonly name: string | undefined; readonly built: boolean } {
    // The updater's own parameter name is NOT part of the claim — it is whatever
    // the enclosing arrow function called it — so the call is read as
    // `reconcile(<anything>, <name>)`.
    const name = /reconcile\(\s*\w+\s*,\s*(\w+)\s*\)/.exec(src)?.[1]
    if (name === undefined) return { name, built: false }
    // 400 characters: comfortably more than any one-line or `useMemo` form of
    // this expression, and short enough that the following statement — which is
    // the `reconcile` call itself — cannot supply a match on the value's behalf.
    const window = new RegExp(`(?:const|let)\\s+${name}\\s*=([\\s\\S]{0,400})`).exec(src)?.[1] ?? ''
    return { name, built: /items\s*\.\s*filter\(/.test(window) && /itemMatches\(/.test(window) }
  }

  it('a holding is reconciled against the FILTER, not against what the page happens to draw', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/client/item/panel.tsx', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const { name, built } = readHolding(src)
    expect(name, 'the holding is reconciled against something the gate cannot name').toBeDefined()
    // Neither the page's rows nor the whole document: one is the wrong question,
    // the other ignores the filter entirely.
    expect(name, 'the holding is reconciled against the page or the whole document, so the filter is not what bounds it')
      .not.toMatch(/^(shown|items)$/)
    expect(built, `${String(name)} is not built by filtering the document through the matcher, so rows the filter hides stay held`).toBe(true)
  })

  it('the probe bites: a set built from the PAGE is reported, whatever shape it is written in', () => {
    // Fed synthetic sources rather than the current file: a control written
    // against today's implementation passes by accident the day the defect is
    // fixed, and then proves nothing for ever after. Three shapes, because two
    // of them are shapes this reader has already got wrong once.
    const reconcile = 'setSelection(c => reconcile(c, pointable))'
    expect(
      readHolding(`const pointable = items.filter(item => itemMatches(item, q, c)).map(r => r.id)\n${reconcile}`).built,
      'the probe does not recognise a correct one-line set — this probe proves nothing',
    ).toBe(true)
    expect(
      readHolding(`const pointable = useMemo(\n  () => items.filter(item => itemMatches(item, q, c)).map(r => r.id),\n  [items, q, c],\n)\n${reconcile}`).built,
      'the reader still demands one particular spelling, so a correct `useMemo` reads as broken',
    ).toBe(true)
    expect(
      readHolding(`const pointable = items.filter(r => r.id === selected)\n${reconcile}`).built,
      'a set built from the page\'s rows was accepted',
    ).toBe(false)
  })

  it('both READMEs name the surface the way the surface names itself', () => {
    // CAUGHT BY A REAL BUG: the Chinese README described the overview strip as
    // 「待办、逾期、今天、本周」 and the English one mirrored it. Neither `今天`
    // nor `本周` is a tile — `item-view` computes both and RENDERS NEITHER — and
    // three tiles that are actually there (进行中 / 受阻 / 已完成) were not
    // mentioned at all. A reader looks for two numbers that cannot appear and
    // concludes they misremembered, which costs more than a missing feature.
    //
    // The READMEs ship, so this is the one document layer a reader meets first.
    // A wrong claim there is worse than a missing one, because it is acted on.
    //
    // The rule is deliberately NARROW: the surface's OWN vocabulary, taken from
    // the locale table, must appear in both. Not "the README mentions the
    // feature" — it already did, wrongly. **The words the interface uses are the
    // words the documentation uses**, and a term the locale table does not
    // define cannot be a thing a reader can go looking for.
    const locales = readFileSync(fileURLToPath(new URL('../src/client/locales.ts', import.meta.url)), 'utf8')
    const readmes = {
      'README.md': readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8'),
      'README.en.md': readFileSync(fileURLToPath(new URL('../README.en.md', import.meta.url)), 'utf8'),
    }
    // One entry per UI noun a reader is told to go and find. Each is the string
    // the interface actually prints, taken from the locale table.
    const CLAIMED: ReadonlyArray<{ key: string; zh: string; en: string }> = [
      { key: 'item.group.inProgress', zh: '进行中', en: 'In progress' },
      { key: 'item.group.open', zh: '待办', en: 'To do' },
      { key: 'item.group.blocked', zh: '受阻', en: 'Blocked' },
      { key: 'item.group.done', zh: '已完成', en: 'Done' },
      { key: 'item.due.overdueShort', zh: '超期', en: 'Past due' },
    ]
    for (const entry of CLAIMED) {
      expect(locales, `${entry.key} is gone from the locale table, so this list must be re-read`).toContain(`'${entry.key}'`)
    }
    // The two READMEs must be able to name the SAME five things. Checking both
    // sides is the point: a one-sided fix leaves the other reader misled, and
    // the two files drifted together precisely because nobody compared them.
    for (const zh of CLAIMED.map(entry => entry.zh)) {
      expect(readmes['README.md'], `README.md does not name 「${zh}」, so a reader cannot find that part of the interface`)
        .toContain(zh)
    }
    for (const en of CLAIMED.map(entry => entry.en)) {
      expect(readmes['README.en.md'], `README.en.md does not name "${en}", so an English reader cannot find that part of the interface`)
        .toContain(en)
    }
  })

  it('no label that names a destructive button is reachable only by hover', () => {
    // Hard rule 11③: 触屏没有 hover —— a reason that lives only in a `title` is
    // a reason a phone reader never gets. Two of them were exactly that, and both
    // are the NAME of a row whose other button is 删除.
    //
    // The preset name and the automation summary were each truncated to one line
    // with the remainder in a `title`. On a phone: a row of preset names where the
    // reader could not tell which one they were about to delete, and a rule chip
    // whose only statement of whether it is armed and when it next fires they
    // could not read. 换行 is one of the four mechanisms rule 11 allows; the
    // ellipsis is not one of them.
    const sheet = readFileSync(fileURLToPath(new URL('../src/client/board.module.css', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(sheet, 'the board sheet is empty, so every ruleFor below reads nothing').not.toBe('')
    for (const name of ['.runPresetName', '.autoTaskSummary']) {
      const rule = ruleFor(name)
      expect(rule, `${name} is gone, so this gate is checking fewer than two rows`).not.toBe('')
      expect(rule, `${name} truncates with an ellipsis, so on a phone the row cannot be read before 删除 is pressed`)
        .not.toMatch(/text-overflow:\s*ellipsis/)
      expect(rule, `${name} refuses to wrap, so the text it hides is unreachable without a hover`)
        .not.toMatch(/white-space:\s*nowrap/)
    }
  })

  it('a long list is ONE tab stop, not one per row', () => {
    // The session picker made every row a plain tabbable button, so reaching
    // 取消/添加 meant one Tab for EVERY session — and the 未分组 group routinely
    // holds hundreds. A keyboard reader could not get out of the list.
    //
    // The roving tabindex is the board's OWN pattern (InteractionCard's option
    // group already ships it), so this asserts the second surface adopting the
    // first. The gate is on the SHAPE — exactly one row carrying tabIndex 0 — not
    // on a count, because 「one stop」 is the property and a count would go stale
    // the moment a row renders conditionally.
    const src = readFileSync(fileURLToPath(new URL('../src/client/board/SessionPickerDialog.tsx', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src, 'the rows carry no roving tabindex, so every session is its own tab stop').toMatch(/tabIndex=\{index === stopIndex \? 0 : -1\}/)
    // The stop must land on something: the first PICKED row, else the first row.
    // Landing on row 0 always would throw away the reader's place on reopen.
    expect(src, 'the group has no picked-aware stop, so reopening always lands on the first session').toMatch(/stopIndex = firstPicked >= 0 \? firstPicked : 0/)
    // And the arrows must MOVE without toggling — a cursor that commits is a
    // cursor that edits, and this is a multi-select.
    const handler = src.slice(src.indexOf('onKeyDown'), src.indexOf('onKeyDown') + 900)
    expect(handler, 'the arrow handler toggles as it moves, so browsing changes the answer')
      .not.toMatch(/onToggleSession\(/)
  })

  it('every field pair on every surface is ONE grammar, not four', () => {
    // MEASURED: the same concept — a label over a control in the run-config
    // block — was written four times, and the four disagreed on BOTH axes.
    // Label-to-control gaps 5, 6, 4, 4. Label sizes 12, 12, 12, 11.
    //
    // That is the owner's 「没有间隙的感觉」 as arithmetic: a reader moving
    // between the create form, the automation editor and the review rail read
    // one control at 12px and the next at 11px, with the label sitting a
    // different distance above each. Nothing about the review rail is denser
    // than the rest; it is the same rail seen from another surface, which is
    // exactly what makes the drift invisible to anyone testing one at a time.
    //
    // The list is the FOUR places the concept appears today and the assertion is
    // that they AGREE — so a fifth surface has to pick one, and picking a new one
    // goes red here instead of quietly becoming a fifth grammar.
    const PAIRS: ReadonlyArray<readonly [string, string]> = [
      ['.field', '.fieldLabel'],
      ['.scheduleGrid', '.scheduleLabel'],
      ['.autoField', '.autoFieldLabel'],
      ['.reviewConfigRow', '.reviewConfigLabel'],
    ]
    for (const [row, label] of PAIRS) {
      expect(ruleFor(row), `${row} is gone, so the gap it owns is unchecked and this gate is counting fewer than four`).not.toBe('')
      expect(ruleFor(label), `${label} is gone, so the size it owns is unchecked`).not.toBe('')
    }
    // The three STACKED pairs share one vertical gap. The grid pair is excluded
    // on purpose: a shared left label column is a different SHAPE, not a
    // different value, and its row gap was already 6px.
    const stacked = ['.field', '.autoField', '.reviewConfigRow']
    const gaps = stacked.map(name => ruleFor(name).match(/gap:\s*([\d.]+)px/)?.[1])
    expect(new Set(gaps).size, `the label-to-control gap is not one value: ${stacked.map((n, i) => `${n}=${gaps[i]}`).join(', ')}`).toBe(1)
    // One label size on every pair. 11px was below this ladder's floor, and it
    // was the only surface where a reader could see a label change size.
    const sizes = PAIRS.map(([, label]) => ruleFor(label).match(/font-size:\s*([\d.]+)px/)?.[1])
    expect(new Set(sizes).size, `the label size is not one value: ${PAIRS.map(([, l], i) => `${l}=${sizes[i]}`).join(', ')}`).toBe(1)
  })

  it('the compact band tells a group boundary from the gap inside a group', () => {
    // MEASURED: on a 390px phone every gap in the header was 10px — demand row
    // to nav row 10, nav to tools 10, tools to the column track 10. The two gaps
    // that BOUND a band were the same size as the gaps WITHIN a band, so
    // 「诉求行 / 导航行 / 工具行」 had no visible grouping: it read as one flat
    // stack of three rows.
    //
    // The invariant is the RELATIONSHIP, not a set of numbers: the gap across a
    // group boundary must be LARGER than the gap inside a group. Asserting the
    // relationship is what makes this hold for a fourth row added later —
    // three tuned numbers would agree today and say nothing about tomorrow.
    const compact = source.slice(source.indexOf('@container dsh-tb (max-width: 680px) {'))
    const between = Number(compact.match(/\.board \{[\s\S]*?gap:\s*(\d+)px/)?.[1])
    const within = Number(compact.match(/\.boardHeader \{[\s\S]*?gap:\s*(\d+)px/)?.[1])
    expect(Number.isFinite(between) && Number.isFinite(within),
      'the compact band no longer states both gaps, so the relationship cannot be checked').toBe(true)
    expect(between, 'the gap between groups is not larger than the gap inside one, so a phone has no visible grouping')
      .toBeGreaterThan(within)
  })
})

/** Extract the rule block whose opening line is exactly the given SELECTOR. */
function ruleFor(selector: string): string {
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== `${selector} {`) continue
    let depth = 0
    const chunks: string[] = []
    for (let j = i; j < lines.length; j++) {
      const line = lines[j]
      chunks.push(line)
      for (const ch of line) {
        if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0) return chunks.join('\n')
        }
      }
    }
  }
  return ''
}

describe('card no-breakout CSS contract', () => {
  it('layer 1: the card box is a hard clip boundary', () => {
    const card = expectRule('card')
    expect(card).toContain('overflow: hidden')
    expect(card).toContain('min-width: 0')
  })

  it('layer 2: the meta row children can shrink to their content width', () => {
    expect(expectRule('cardMetaRow')).toContain('min-width: 0')
    expect(expectRule('cardWorkspace')).toContain('min-width: 0')

    // Workspace name: must be allowed to shrink so its ellipsis engages.
    const name = expectRule('cardWorkspaceName')
    expect(name).toContain('min-width: 0')
    expect(name).toContain('text-overflow: ellipsis')

    // Updated-at label: shrinkable (never flex: none) so the ellipsis trio
    // engages instead of overflowing the card.
    const time = expectRule('cardTime')
    expect(time).toContain('flex: 0 1 auto')
    expect(time).toContain('min-width: 0')
    expect(time).toContain('text-overflow: ellipsis')
    expect(time).not.toContain('flex: none')
  })

  it('layer 2: title and excerpt wrap unbreakable tokens instead of overflowing', () => {
    expect(expectRule('cardTitle')).toContain('overflow-wrap: anywhere')
    expect(expectRule('cardExcerpt')).toContain('overflow-wrap: anywhere')
  })

  it('layer 2/3: badges truncate on their body instead of stretching (component-level)', () => {
    // The chip itself may shrink but must never exceed the container.
    const chip = expectRule('chip')
    expect(chip).toContain('flex: 0 1 auto')
    expect(chip).toContain('max-width: 100%')
    expect(chip).toContain('min-width: 0')
    expect(chip).not.toContain('flex: none')

    // The body span (every Chip wraps its text children in it) is the
    // ellipsis slot: overflow hidden + single line + ellipsis, shrinkable.
    const body = expectRule('chipBody')
    expect(body).toContain('display: block')
    expect(body).toContain('min-width: 0')
    expect(body).toContain('overflow: hidden')
    expect(body).toContain('text-overflow: ellipsis')
    expect(body).toContain('white-space: nowrap')
  })

  it('two-slot grammar: a lead glyph keeps its box geometry outside the text body', () => {
    // The chip's gap feeds the spacing between the lead glyph and the text,
    // so it must survive.
    expect(expectRule('chip')).toContain('gap: 5px')

    // The lead-glyph slot is a real flex item of the chip (NOT inside the
    // ellipsizing body): an activity spinner/icon keeps its width/height.
    const lead = expectRule('chipLead')
    expect(lead).toContain('display: inline-flex')
    expect(lead).toContain('flex: none')
    expect(lead).toContain('align-items: center')

    // The spinner itself is context-independent: even outside a flex item
    // an inline element would ignore width/height and collapse to a strip,
    // so it carries its own inline-block geometry as a belt.
    expect(expectRule('spinner')).toContain('display: inline-block')

    // The spinner is the board's ONE turning circle (running cards, session
    // rows, execution rows, todo glyphs): a square box with a 50% radius is
    // what makes it a circle — either half missing reads as 「方的圈」.
    const spinner = expectRule('spinner')
    expect(spinner).toContain('border-radius: 50%')
    expect(spinner).toMatch(/width:\s*10px/)
    expect(spinner).toMatch(/height:\s*10px/)
    expect(spinner).toContain('animation: dshTbSpin')
  })

  it('badges row still wraps and can shrink', () => {
    const badges = expectRule('cardBadges')
    expect(badges).toContain('flex-wrap: wrap')
    expect(badges).toContain('min-width: 0')
  })
})

describe('design-system contracts: pill geometry + compact rhythm', () => {
  /**
   * WHY (the 「改了好多次都没弄回来」 family): pills used to drift to a fixed
   * px radius one member at a time (columnTab compact override,
   * interactionOption, attachChip, …) and each fix only repaired the instance
   * on the current screenshot. The single truth is the --dsh-tb-pill /
   * --dsh-tb-button-radius token pair; this block fails the build the moment
   * any pill stops consuming it, so the family can never drift piecemeal
   * again. Shapes that are NOT pills (cards/panels/inputs on the sm/md/lg/xl
   * ladder, dots, code, meter, the native bubble/sidebar benchmarks) are
   * intentionally absent — see the px allowlist below.
   */
  it('token chain: the button radius rides the pill token', () => {
    expect(source).toMatch(/--dsh-tb-pill:\s*999px/)
    expect(source).toMatch(/--dsh-tb-button-radius:\s*var\(--dsh-tb-pill\)/)
    // The shared button rule is the only consumer of the button token; every
    // variant (primary/ghost/danger/dangerGhost) inherits it from there.
    expect(source).toContain('border-radius: var(--dsh-tb-button-radius)')
  })

  it('every pill-geometry rule consumes the pill token (never a fixed px)', () => {
    for (const name of [
      'boardBack', 'search', 'cruisePill', 'cruiseMore', 'columnTab',
      'columnCount', 'chipFill', 'feedFilter', 'feedSearch', 'feedAction',
      'segmentedButton', 'iconButton', 'buttonSm', 'notifyBadge',
      'cardQuickRun', 'promptCopy', 'reviewJumpLatest', 'attachAdd',
      'attachChip', 'interactionOption', 'timeFieldCalendar', 'switchTrack',
    ]) {
      expect(expectRule(name), `.${name} must stay a true pill`).toContain('var(--dsh-tb-pill)')
    }
  })

  it('no new fixed-px corner radii outside the documented allowlist', () => {
    // Any future `border-radius: Npx` on a control fails here with its file
    // line: reach for var(--dsh-tb-pill) (pills) or the sm/md/lg/xl ladder
    // (panels/inputs) instead. Each allowlist entry names its reason.
    const allowed: { px: string; why: RegExp }[] = [
      { px: '12px', why: /sidebarFooterAction|interactionCard/ },
      { px: '22px', why: /reviewMessage/ },
      { px: '3px', why: /dropIndicator/ },
      { px: '4px', why: /scrollbar-thumb|mdCode|attachRemove/ },
      { px: '1px', why: /MeterSegment/ },
      { px: '2px', why: /MeterSwatch/ },
    ]
    const bad: string[] = []
    const lines = source.split('\n')
    lines.forEach((line, index) => {
      const hit = line.match(/border-radius:\s*(\d+px)/)
      if (hit === null || line.includes('border-radius: inherit')) return
      const px = hit[1]
      // Nearest enclosing selector: walk back to the closest opening brace.
      let open = index
      while (open >= 0 && open > index - 40 && !lines[open].includes('{')) open--
      const context = lines.slice(Math.max(0, open), index + 1).join('\n')
      if (!allowed.some(entry => entry.px === px && entry.why.test(context))) {
        bad.push(`L${index + 1}: ${line.trim()}`)
      }
    })
    expect(bad, 'fixed-px radii must join the allowlist with a reason, or use the pill/ladder tokens').toEqual([])
  })

  it('the fold body spaces the sections it stacks (the rhythm law has an owner)', () => {
    // The board's rhythm law: paragraphs carry `margin: 0`, so EVERY declaration
    // of vertical space belongs to a container's `gap` — never to inherited
    // margins. Every stacking container on the session rail declares it
    // (.detailSection 6px, .reviewContextMeter 6px, .reviewConfig 8px) EXCEPT
    // the one that stacks the folds' own sections: Disclosure's body was a bare
    // <div>, `display: block` with no gap, so the pair of sections inside it sat
    // at a measured 0px. 「运行配置（当前会话）」 landed flush against the token
    // totals above it — the gap the user pointed at, "跟其他地方不一样".
    const body = expectRule('detailSectionBody')
    expect(body).toContain('display: flex')
    expect(body).toContain('flex-direction: column')
    const gap = /gap:\s*(\d+)px/.exec(body)
    expect(gap, '.detailSectionBody must own its section gap explicitly').not.toBeNull()
    // A section gap must out-rank a section's OWN internal gap, or the fold
    // reads as one block: .reviewConfig spaces its title from its grid by 8px.
    const configGap = Number(/gap:\s*(\d+)px/.exec(expectRule('reviewConfig'))?.[1] ?? '0')
    expect(Number(gap?.[1] ?? '0'), 'the section gap must exceed a section\'s internal gap').toBeGreaterThan(configGap)
    // And the fold body must be the ONE owner: the Disclosure component is the
    // only place that renders it, so no caller can forget it.
    const ui = readFileSync(fileURLToPath(new URL('../src/client/board/ui.tsx', import.meta.url)), 'utf8')
    expect(ui).toContain('className={css.detailSectionBody}')
    // The body also relays its fold's definite height to the scroll region
    // inside (grow + shrinkable to zero): a height-bounded fold must be able
    // to hand its share down, or the scroll box inside grows to full content
    // and can never scroll on its own (the desktop comments-box defect).
    expect(body).toMatch(/flex:\s*1 1 auto/)
    expect(body).toMatch(/min-height:\s*0/)
  })

  it('every interface font-size sits on the declared scale', () => {
    // DESIGN.md's Four-Size Rule: interface text uses 11/12/13/14px plus the
    // 16px title step, and the Content-Pass Exemption reserves 15/17/12.5px for
    // RENDERED CONTENT (the Markdown pass), which is laid out as prose rather
    // than as UI. Nothing enforced that: the detector cannot read CSS Modules,
    // and review does not notice an off-scale size — it just looks slightly
    // wrong. `.interactionTitle` sat at 15px for exactly that reason: on no
    // tier, in no allowlist, reported by nobody.
    //
    // Both stylesheets are covered, like the token audit is: the settings card is
    // a second surface with its own scale, and it happened to be correct — which
    // is exactly why it needs the same guarantee rather than luck.
    //
    // A new size must either join this allowlist with its reason, or move onto
    // the scale. Keep the list short; the point is that the scale is a decision,
    // not a drift.
    const SCALE = new Set(['11px', '12px', '13px', '14px', '16px'])
    const CONTENT_PASS: { px: string; why: RegExp }[] = [
      { px: '12.5px', why: /mdCodeBlock/ },
      { px: '15px', why: /mdHeading/ },
      { px: '17px', why: /mdHeading/ },
    ]
    const bad: string[] = []
    for (const [label, text] of [
      ['board.module.css', source],
    ] as const) {
      const lines = text.split('\n')
      lines.forEach((line, index) => {
        const hit = line.match(/font-size:\s*(\d+(?:\.\d+)?px)/)
        if (hit === null) return
        const px = hit[1]
        if (SCALE.has(px)) return
        // Nearest enclosing selector, same walk as the radius allowlist above.
        let open = index
        while (open >= 0 && open > index - 40 && !lines[open].includes('{')) open--
        const context = lines.slice(Math.max(0, open), index + 1).join('\n')
        if (!CONTENT_PASS.some(entry => entry.px === px && entry.why.test(context))) {
          bad.push(`${label} L${index + 1}: ${line.trim()}`)
        }
      })
    }
    expect(bad, 'font sizes must be on 11/12/13/14/16, or join the content-pass allowlist with a reason').toEqual([])
  })

  it('an invisible control cannot receive a tap, and the unread light outranks in-flight work', () => {
    // Two hazards that no visual review catches, both previously live:
    //
    // 1. `.cardQuickRun` rests at `opacity: 0` and is revealed by hover. Opacity
    //    does NOT disable hit-testing, so on a touch device — which has no hover —
    //    a tap in the card's top-right corner was delivered to that span, fired
    //    `onQuickRun`, and started a real DSH agent session while showing nothing.
    //    An invisible control must decline the pointer until it is revealed.
    const quickRun = expectRule('cardQuickRun')
    expect(quickRun, 'the hidden quick-run must decline pointer events').toContain('pointer-events: none')
    expect(quickRun).toContain('opacity: 0')
    // ...and hand them straight back the moment it is visible, or the desktop path
    // would be broken (hover reveals it, then it must be clickable).
    expect(source).toMatch(/\.card:hover \.cardQuickRun,\s*\n\s*\.cardQuickRun:focus-visible \{\s*\n\s*opacity: 1;\s*\n\s*pointer-events: auto;/)

    // The SAME rule for every other control that hides behind `opacity: 0`, swept
    // rather than fixed one at a time: `opacity: 0` does not remove an element from
    // hit-testing, so a hidden control can still receive a tap. The quick-run was the
    // severe case (a mis-tap launched a real agent run); the prompt block's copy pill
    // was the second (a tap to scroll or select text silently copied the prompt).
    // A rule that only guards the instance that was reported is a patch; this sweep is
    // the fix for the class.
    //
    // The line between "needs a guard" and "must stay tappable" is FUNCTIONAL vs
    // TRANSITIONAL hiding: a control revealed on hover/focus is transitional and must
    // decline the pointer while invisible; a control that is permanently invisible
    // because a wrapper draws it (`.tagCustomColor`, the native colour input inside the
    // rainbow swatch) is functional, and guarding it would BREAK it — the wrapper's
    // `:focus-within` and the colour picker both depend on the input being hittable.
    const revealedOnInteraction = (name: string) =>
      new RegExp(`[^}]*\\.${name}[^{]*\\{[^}]*opacity:\\s*1`).test(source)
    const opacityHidden = [...source.matchAll(/\.([a-zA-Z][\w]*)\s*\{[^}]*opacity:\s*0;[^}]*\}/g)]
      .map((m) => ({ name: m[1], body: m[0] }))
      .filter((r) => !r.body.includes('display: none'))
      .filter((r) => revealedOnInteraction(r.name))
    expect(opacityHidden.length, 'the sweep must find the transitional hidden controls').toBeGreaterThan(0)
    for (const rule of opacityHidden) {
      expect(rule.body, `.${rule.name} is revealed on interaction but rests at opacity 0 without a pointer guard, so an invisible control can receive a tap`)
        .toContain('pointer-events: none')
    }

    // 2. "a run finished and you have not looked" and "work is in flight" were the
    //    SAME animation, duration and colour, so the one light on the card could
    //    not separate the state that asks you to look from the state that is merely
    //    ambient. They must differ in FORM: the unread ring (outer, full strength)
    //    versus the in-flight halo (inset, soft alpha).
    const unread = source.match(/\.card\[data-light='ring'\] \{\s*\n\s*animation:\s*(\S+)/)?.[1]
    const active = source.match(/\.card\[data-light='halo'\] \{\s*\n\s*animation:\s*(\S+)/)?.[1]
    expect(unread, 'the unread card must use a breath animation').toBeTruthy()
    expect(active, 'the live card must use a breath animation').toBeTruthy()
    expect(unread, 'the two card lights must not be the same animation').not.toBe(active)
    // The inset variant is the only one whose shadow is contained by the card's own
    // clipped box, so the states must not be swapped by accident.
    expect(active).toBe('dshTbBreathHalo')

    // 3. FORM is asserted at the KEYFRAME level too, not only through the two
    //    animation names: a swap of the two keyframe BODIES would keep the name
    //    assertions green while the in-flight halo silently became the light
    //    that asks you to look (and vice versa). The contract is the shape —
    //    halo = INNER (`inset`) shadow at the SOFT alpha step, ring = OUTER
    //    spread at the STRONGER step — and both rest transparent so each light
    //    is a pulse, never a permanent glow.
    /** The 50% frame of one `@keyframes <name>` block (the pulse's peak). */
    const peakOf = (name: string): string => {
      const block = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1]
      expect(block, `${name} must exist`).toBeTruthy()
      return /50%\s*\{([^}]*)\}/.exec(block ?? '')?.[1] ?? ''
    }
    const haloPeak = peakOf('dshTbBreathHalo')
    expect(haloPeak, 'the live halo must be an INSET shadow').toMatch(/\binset\b/)
    expect(haloPeak, 'the halo amplitude token is the inset blur').toContain('var(--dsh-tb-breath-halo)')
    expect(haloPeak, 'the halo INSET wears the soft alpha step').toContain('var(--dsh-tb-attention-alpha-soft)')
    // …and it carries an OUTER component too: an inset-only pulse has no edge
    // presence next to the card's static full-strength yellow border —
    // 「进行中的卡边缘根本不呼吸」, misdiagnosed twice as the judgment. The
    // outer component peaks at the FULL 22% step (the same alpha the ring
    // uses): a soft-edged glow at10% was still invisible against the border,
    // so visibility itself became part of the contract — the halo stays
    // distinct from the ring by FORM (3px blur + inset wash vs the ring's
    // hard spread, ring-only), never by hiding below the visibility floor.
    expect(haloPeak, 'the halo breathes AT THE EDGE as well').toMatch(
      /,\s*0 0 var\(--dsh-tb-breath-spread\) var\(--dsh-tb-breath-color, var\(--dsh-tb-attention-alpha\)\)/,
    )
    expect(haloPeak, 'the halo edge peaks at the FULL attention alpha (visibility floor)').toContain(
      'var(--dsh-tb-attention-alpha)',
    )
    const ringPeak = peakOf('dshTbBreathRing')
    expect(ringPeak, 'the unread ring must be an OUTER shadow').not.toMatch(/\binset\b/)
    expect(ringPeak, 'the ring amplitude token is the outer spread').toContain('var(--dsh-tb-breath-spread)')
    expect(ringPeak, 'the ring wears the stronger alpha step').toContain('var(--dsh-tb-attention-alpha)')
    for (const name of ['dshTbBreathRing', 'dshTbBreathHalo']) {
      expect(source, `${name} must rest transparent (a pulse, not a permanent glow)`).toMatch(
        new RegExp(`@keyframes ${name} \\{\\s*0%, 100% \\{ box-shadow: [^}]*transparent; \\}`),
      )
    }
  })

  it('the light and the yellow border are ONE end-agnostic pair (both ends read the same two attributes)', () => {
    // The reported defect was a card with the yellow border and no breath: the
    // border read `task.status`, the light read `executing(task)`. They are one
    // derivation now — the light's `active` includes the card's own column — so
    // the two attributes cannot disagree, and NOTHING may re-decide either of
    // them per end (硬性规范 11: 桌面与窄屏同治).
    //
    // 1. The client half is end-free: no viewport read, no narrow flag, no
    //    second derivation. The light comes from one attribute in one place.
    const card = readFileSync(fileURLToPath(new URL('../src/client/board/TaskCard.tsx', import.meta.url)), 'utf8')
    expect(card).toContain('data-status={task.status}')
    expect(card).toContain('data-light={light}')
    const view = readFileSync(fileURLToPath(new URL('../src/client/board/card-view.ts', import.meta.url)), 'utf8')
    expect(view, 'the light must not be re-decided per screen').not.toMatch(/matchMedia|innerWidth|useSurfaceNarrow/)
    expect(view, 'the card column is part of the light derivation').toContain("task.status === 'running'")

    // 2. The stylesheet half: both rules sit OUTSIDE every `@media`/`@container`
    //    block, so 窄屏 and desktop read exactly the same declarations. (The
    //    board's only compact query touching `.card` is the colour-bar hover —
    //    it drives neither the border nor the breath.)
    const ranges = [...conditionalRanges(source, '@media'), ...conditionalRanges(source, '@container')]
    for (const selector of [".card[data-status='running']", ".card[data-light='halo']", ".card[data-light='ring']"]) {
      const at = source.indexOf(selector)
      expect(at, `${selector} must exist`).toBeGreaterThan(-1)
      expect(
        ranges.some(([start, end]) => at >= start && at < end),
        `${selector} must not sit inside a conditional block (both ends share one rule)`,
      ).toBe(false)
    }
  })

  it('the badge row ranks its primary first, and never gates the row on automation', () => {
    // Two structural facts about the card's chip row, both previously wrong in ways
    // no visual review surfaces:
    //
    // 1. ORDER. `cardViewModelOf` computes a priority (waiting > running
    //    > queued > failed > review > idle) and the render used to emit that winner
    //    LAST, behind every automation badge — the row's reading order contradicted
    //    the view model's own ranking, on the surface whose whole job is a scan.
    const card = readFileSync(fileURLToPath(new URL('../src/client/board/TaskCard.tsx', import.meta.url)), 'utf8')
    const primaryAt = card.indexOf('{primaryChip}')
    const autoAt = card.indexOf('{automationChips}')
    expect(primaryAt, 'the row must render the primary chip').toBeGreaterThan(-1)
    expect(autoAt, 'the row must render the automation chips').toBeGreaterThan(-1)
    expect(primaryAt, 'the primary chip must come before the automation chips').toBeLessThan(autoAt)

    // 2. THE GATE. The row was wrapped in `schedule?.enabled === true || latest !==
    //    undefined`, which is FALSE for a card that has never run and has no
    //    schedule — precisely the shape of "somebody just made this card and the
    //    agent is asking a question". The view model reported `primary: waiting`
    //    while the gate hid the whole row, so the one signal asking the user to act
    //    was unrenderable exactly when it mattered. Each chip carries its own
    //    condition, so the row must not reintroduce a shared one.
    expect(card, 'the badge row must not be gated on automation/execution again')
      .not.toContain('{(task.schedule?.enabled === true || latest !== undefined) && (')
    expect(card).toContain('if (!hasAnything) return null')

    // 3. The primary group must cover every state the view model can rank, so a
    //    future primary kind cannot silently render as an empty row.
    for (const key of ['card.awaitingDecision', 'card.pending', 'card.newContent']) {
      expect(card, `${key} must still be rendered by the card`).toContain(key)
    }
  })

  it('a fact painted as geometry is also stated in words', () => {
    // The session dots encode "who is working on this card, and how many" as colour
    // and position, and the overflow is a `+N` glyph. Both used to sit inside an
    // `aria-hidden` container whose only text lived in a `title` on a non-focusable
    // span — unreachable by keyboard, unread by a screen reader, so the fact was
    // available only to sighted hovering users. Hard rule 11③ forbids exactly that
    // (「触屏没有 hover——承载必要信息的说明不能只挂 title=」), and the bell was fixed
    // for the same reason one round earlier; this is its second instance.
    const card = readFileSync(fileURLToPath(new URL('../src/client/board/TaskCard.tsx', import.meta.url)), 'utf8')
    const strip = card.slice(card.indexOf('css.cardSessions'), card.indexOf('css.cardSessions') + 1600)
    expect(strip, 'the strip must carry a text alternative').toContain('css.visuallyHidden')
    expect(strip, 'the text alternative must use a locale key, never a raw string').toContain("t('card.sessionsForAt'")
    // The dots stay decorative (announcing "status dot, status dot" is noise), which
    // is only correct BECAUSE the words are present in the same strip.
    expect(strip).toContain('aria-hidden="true"')
    // And the utility must be real: hiding it from the a11y tree would defeat it.
    const util = expectRule('visuallyHidden')
    expect(util).toContain('clip-path')
    expect(util, 'display:none would remove it from the accessibility tree').not.toContain('display: none')
    expect(util, 'visibility:hidden would remove it from the accessibility tree').not.toContain('visibility: hidden')
  })

  it('the turning spinner keeps its circle grammar (square box + 50% + cut + spin)', () => {
    const spinner = expectRule('spinner')
    expect(spinner).toContain('border-radius: 50%')
    expect(spinner).toMatch(/width:\s*10px/)
    expect(spinner).toMatch(/height:\s*10px/)
    // The transparent cut is what reads as motion; without it the ring is a
    // static dot that can be misread as a stuck square at small sizes.
    expect(spinner).toContain('border-top-color: transparent')
    expect(spinner).toContain('animation: dshTbSpin')
  })

  it('compact rhythm derives from the single strip token (symmetric by construction)', () => {
    expect(source).toContain('row-gap: var(--dsh-tb-strip-gap)')
    expect(source).toContain('padding: var(--dsh-tb-strip-gap) 0')
  })
})
describe('card reading measure (one line for what IS vs HAS)', () => {
  function ruleOfMeasure(name: string): string {
    return expectRule(name)
  }

  it('the fact line stays single: title and verb are the two reading slots', () => {
    // A doubled title is one wide card away from fitting; a doubled verb is
    // a second reading of the same state the primary chip already names.
    // The excerpt carries the only longer thought on the card.
    const next = ruleOfMeasure('cardNext')
    expect(next).toContain('white-space: nowrap')
    expect(next).toContain('text-overflow: ellipsis')
    expect(next).not.toContain('-webkit-line-clamp')
  })

  it('rendered links read as links (colour alone is not an affordance)', () => {
    const link = ruleOfMeasure('mdLink')
    expect(link).toMatch(/text-decoration:\s*underline/)
    expect(link).toMatch(/text-underline-offset:\s*2px/)
  })
})
describe('card chip label composition', () => {
  function useLanguage(lang: string): void {
    vi.stubGlobal('document', { documentElement: { lang } })
  }

  afterEach(() => { vi.unstubAllGlobals() })

  it('running state: plain running keeps a short one-word label (zh)', () => {
    useLanguage('zh')
    expect(primaryChipLabel({ kind: 'running' })).toBe('进行中')
  })

  it('running state: each user-blocking kind is named (zh)', () => {
    useLanguage('zh')
    expect(primaryChipLabel({ kind: 'waiting', waiting: 'approval', count: 1 })).toBe('等待回应 · 权限审批')
    expect(primaryChipLabel({ kind: 'waiting', waiting: 'plan-review', count: 1 })).toBe('等待回应 · 计划确认')
    expect(primaryChipLabel({ kind: 'waiting', waiting: 'question', count: 1 })).toBe('等待回应 · 提问')
  })

  it('several blocked conversations say so in one word, not a list', () => {
    useLanguage('zh')
    expect(primaryChipLabel({ kind: 'waiting', waiting: 'question', count: 3 })).toBe('待处理 3')
    useLanguage('en')
    expect(primaryChipLabel({ kind: 'waiting', waiting: 'question', count: 3 })).toBe('Pending 3')
  })

  it('the gate names its outcome, and the run counter is history (zh)', () => {
    useLanguage('zh')
    expect(primaryChipLabel({ kind: 'gate', failed: false })).toBe('待你决断')
    expect(primaryChipLabel({ kind: 'gate', failed: true })).toBe('失败待决断')
    expect(primaryChipLabel({ kind: 'runs', count: 3, failed: false })).toBe('3 次执行')
  })

  it('running state: english mirror', () => {
    useLanguage('en')
    expect(primaryChipLabel({ kind: 'running' })).toBe('Running')
    expect(primaryChipLabel({ kind: 'waiting', waiting: 'approval', count: 1 })).toBe('Waiting for you · Approval')
    expect(primaryChipLabel({ kind: 'waiting', waiting: 'plan-review', count: 1 })).toBe('Waiting for you · Plan review')
    expect(primaryChipLabel({ kind: 'waiting', waiting: 'question', count: 1 })).toBe('Waiting for you · Question')
  })

  it('the chip is the model\'s primary, not a second chain beside it', () => {
    // The card used to rank its chips in the component while the view model
    // ranked `primary` separately, so the model's own winner never reached the
    // screen (a queued card showed no primary; a failed one named itself twice).
    // The render now reads `view.primary` and the next-action line reads the
    // same value — one ranking, two renderings of it.
    const card = readFileSync(fileURLToPath(new URL('../src/client/board/TaskCard.tsx', import.meta.url)), 'utf8')
    const view = readFileSync(fileURLToPath(new URL('../src/client/board/card-view.ts', import.meta.url)), 'utf8')
    expect(card).toMatch(/const primary = view\.primary/)
    expect(card).not.toMatch(/plainRunsOf|lastPlain|ruleReadiness/)
    expect(view).toMatch(/let primary: CardPrimary/)
    // ONE open-round judgment, not a display/gate pair that never differed.
    expect(view).toMatch(/hasOpenRun\(task\)/)
    expect(view).not.toMatch(/executing\(task\)/)
  })

  it('settled count label (zh / en)', () => {
    useLanguage('zh')
    expect(settledChipLabel(0)).toBe('0 次执行')
    expect(settledChipLabel(3)).toBe('3 次执行')
    useLanguage('en')
    expect(settledChipLabel(0)).toBe('0 runs')
    expect(settledChipLabel(3)).toBe('3 runs')
  })

  it('blocked chip: an armed rule with an empty prompt shows it, otherwise not', () => {
    const at = 1_700_000_000_000
    const armedEmpty = withSchedule(
      createTask({ title: 'A', description: '', prompt: '' }, at, 'a'),
      { enabled: true, cron: '* * * * *', nextRunAt: undefined }, at,
    )
    expect(blockedCauseOf(armedEmpty)).toBe('schedule')
    const armedReady = withSchedule(
      createTask({ title: 'A', description: '', prompt: 'run' }, at, 'a'),
      { enabled: true, cron: '* * * * *', nextRunAt: undefined }, at,
    )
    expect(blockedCauseOf(armedReady)).toBeUndefined()
    expect(blockedCauseOf(createTask({ title: 'A', description: '', prompt: '' }, at, 'a'))).toBeUndefined()
  })

  it('session-blocked: an enabled usePrompt rule with an empty prompt blocks, custom text never does', () => {
    const at = 1_700_000_000_000
    const usePromptRule = {
      id: 'r1', sessionId: 's-1', instruction: '', usePrompt: true,
      trigger: 'cron' as const, cron: '* * * * *', send: 'queue' as const, enabled: true,
    }
    const blocked = withSessionRules(createTask({ title: 'A', description: '', prompt: '' }, at, 'a'), [usePromptRule])
    expect(blockedCauseOf(blocked)).toBe('session')
    const customRule = {
      id: 'r1', sessionId: 's-1', instruction: 'do it', trigger: 'cron' as const,
      cron: '* * * * *', send: 'queue' as const, enabled: true,
    }
    const custom = withSessionRules(createTask({ title: 'A', description: '', prompt: '' }, at, 'a'), [customRule])
    expect(blockedCauseOf(custom)).toBeUndefined()
    const off = withSessionRules(createTask({ title: 'A', description: '', prompt: '' }, at, 'a'),
      [{ ...usePromptRule, enabled: false }])
    expect(blockedCauseOf(off)).toBeUndefined()
  })

  it('blocked automation owns the slot: one cause, one chip', () => {
    const at = 1_700_000_000_000
    const both = withSessionRules(withSchedule(
      createTask({ title: 'A', description: '', prompt: '' }, at, 'a'),
      { enabled: true, mode: 'chain', cron: '', nextRunAt: undefined }, at,
    ), [{ id: 'r1', sessionId: 's-1', instruction: '', usePrompt: true, trigger: 'cron' as const, cron: '* * * * *', send: 'queue' as const, enabled: true }])
    // Task-level AND session-level blocked are NAMED, and still one slot.
    expect(blockedCauseOf(both)).toBe('both')
  })
})

describe('session unread glow family (row breath + dot breath, one clock)', () => {
  it('the card session dot wears the OUTER ring breath in the one attention color', () => {
    const rule = /\.cardSessionDot\[data-state='unread'\]\s*\{([^}]*)\}/.exec(source)?.[1] ?? ''
    expect(rule, 'the unread dot must exist as its own rule').not.toBe('')
    expect(rule).toMatch(/animation:\s*dshTbBreathRing/)
    expect(rule).toMatch(/background:\s*var\(--dsw-alias-state-warn-primary\)/)
    // Live dots keep their SOLID colors — one breathing dot state, never a
    // second animation competing inside the 8px strip.
    expect(source).toMatch(/\.cardSessionDot\[data-state='running'\]\s*\{[^}]*background/)
    expect(source).toMatch(/\.cardSessionDot\[data-state='waiting'\]\s*\{[^}]*background/)
    // The shared keyframe rests transparent (a pulse, not a permanent glow).
    expect(source).toMatch(/@keyframes dshTbBreathRing \{\s*0%, 100% \{ box-shadow: [^}]*transparent; \}/)
  })

  it('the session row glows attention OR unread through ONE attribute (two rules, one breath)', () => {
    expect(source).toMatch(/\.sessionRow\[data-glow='attention'\]::after\s*\{[^}]*opacity:\s*1/)
    expect(source).toMatch(/\.sessionRow\[data-glow='unread'\]::after\s*\{[^}]*opacity:\s*1/)
    expect(source).toMatch(/\.sessionRow\[data-glow='unread'\]::after\s*\{[^}]*animation-play-state:\s*running/)
    // The derivation lives once, on the row, fed by the run rows' read clock.
    const rowPath = fileURLToPath(new URL('../src/client/board/SessionRow.tsx', import.meta.url))
    const row = readFileSync(rowPath, 'utf8')
    expect(row).toContain('unviewed?: boolean')
    expect(row).toContain("const glow = state === 'waiting' || state === 'running'")
    expect(row).toContain("unviewed === true ? 'unread' : 'none'")
    const detail = readFileSync(fileURLToPath(new URL('../src/client/board/TaskDetail.tsx', import.meta.url)), 'utf8')
    // BOTH row families pass the same clock — run rows AND linked rows — and
    // nothing may hand-roll a different read-state input.
    expect(detail.match(/unviewed=\{sessionUnviewedOf\(task, sessionId\)\}/g)).toHaveLength(2)
    expect(detail).not.toContain('row.unviewed')
  })

  it('the dot derivation is ONE precedence, consumed by the board render (3-dot cap pinned)', () => {
    const viewPath = fileURLToPath(new URL('../src/client/board/card-view.ts', import.meta.url))
    const view = readFileSync(viewPath, 'utf8')
    const waitingAt = view.indexOf("return 'waiting'")
    const runningAt = view.indexOf("return 'running'")
    const unreadAt = view.indexOf("return 'unread'")
    expect(waitingAt).toBeGreaterThan(-1)
    expect(runningAt).toBeGreaterThan(waitingAt)
    expect(unreadAt, 'live outranks unread: the precedence order is structural').toBeGreaterThan(runningAt)
    const board = readFileSync(fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url)), 'utf8')
    expect(board).toContain('cardSessionDotStateOf(task, sessionId')
    // The strip renders at most 3 dots with the overflow counted — same cap
    // the (+N) glyph reads.
    expect(board).toContain('relatedIds.slice(0, 3)')
    expect(board).toContain('t(\'card.dotUnread\')')
  })
})

/**
 * 会话选择器面板的契约（两处入口共用那一个面板）。
 *
 * 钉的是「不许退回旧样子」的几件事：折叠必须走全板那一个 Disclosure 折叠文法
 * （第二个手写折叠就是箭头像不转的那一类 bug）；页脚不许用 auto-margin 靠右；
 * 选中的行不许自己造一套颜色；以及那份名单只能由核心推导产出，界面不得再摊平
 * 全量会话目录。
 */
describe('session picker contract', () => {
  const pickerPath = fileURLToPath(new URL('../src/client/board/SessionPickerDialog.tsx', import.meta.url))
  // Comments stripped: prose may NAME the banned thing while explaining why
  // it is banned, and only CODE counts as an occurrence (same law as
  // locales.spec.ts). A regression reintroduces the expression, not the note.
  const picker = readFileSync(pickerPath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('the group fold is the board ONE Disclosure, not a second hand-rolled fold', () => {
    expect(picker).toContain('<Disclosure')
    expect(picker).toContain('open={open}')
    expect(picker).toContain('onToggle={onToggle}')
    // A foldable the picker owns would carry its own chevron / aria-expanded.
    expect(picker).not.toContain('aria-expanded')
    expect(picker).not.toMatch(/chevron/i)
  })

  it('the footer count owns the free space; no auto-margin right-alignment', () => {
    expect(picker).toContain('css.pickerCount')
    expect(picker).not.toMatch(/marginLeft|margin-left/)
    const rule = ruleOf('pickerCount')
    expect(rule).toMatch(/flex:\s*1 1 auto/)
    expect(rule).toMatch(/min-width:\s*0/)
  })

  it('the selected row reuses the board accent idiom, not a new colour', () => {
    const selected = /\.addSessionRow\[data-selected\]\s*\{([^}]*)\}/.exec(source)?.[1] ?? ''
    expect(selected).toContain('--dsh-tb-accent')
    // The state is never colour-only: the icon swaps and aria-pressed states it.
    expect(picker).toContain("data-selected={on ? '' : undefined}")
    expect(picker).toContain('aria-pressed={on}')
    expect(picker).toContain("name={on ? 'check' : 'link'}")
  })

  it('every session row is a border-box member (the board overflow family)', () => {
    expect(ruleOf('addSessionRow')).toMatch(/box-sizing:\s*border-box/)
  })

  it('the list is the CORE derivation, never a flattened catalog re-filtered in the view', () => {
    expect(picker).toContain('controller.offerableSessionGroups(exclude)')
    // The old implementation's two defects, frozen so they cannot come back.
    expect(picker).not.toContain('referenceSessionCatalog')
    expect(picker).not.toMatch(/\.slice\(0,\s*\d+\)/)
  })

  it('both entry points mount the SAME component (one picker, two submit actions)', () => {
    const detail = readFileSync(fileURLToPath(new URL('../src/client/board/TaskDetail.tsx', import.meta.url)), 'utf8')
    const board = readFileSync(fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url)), 'utf8')
    expect(detail).toContain('<SessionPickerDialog')
    expect(board).toContain('<SessionPickerDialog')
    expect(detail).toContain('controller.addTaskSources(current.id,')
    expect(board).toContain('controller.createBoundTask(')
    // The superseded single-session modal is gone, not merely unused.
    expect(() => readFileSync(fileURLToPath(new URL('../src/client/board/AddSessionModal.tsx', import.meta.url)), 'utf8')).toThrow()
  })

  it('a card born from picked sessions is blank: no title, no content, no run config, lands in 待规划', () => {
    const board = readFileSync(fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url)), 'utf8')
    expect(board).toMatch(/createBoundTask\(\s*\n?\s*sessionIds\.map[\s\S]*\{\s*title:\s*'',\s*description:\s*'',\s*prompt:\s*'',\s*status:\s*'backlog'\s*\}/)
  })
})

/**
 * 卡片的「更新于」与同步戳必须分开。
 *
 * `task.updatedAt` 是**同步戳**：改一次列内顺序（一次顶格、一次手动拖动）会给
 * 被让位的同门每张都盖上新戳——同步合并按它排序，漏盖就是两台设备顺序漂移。
 * 可它一旦直接上屏，一次顶格就会让整栏几百张卡一起写「刚刚」，恰好把「哪个
 * 先完成」这个信号抹平。所以屏上读的是卡片自己的工作推进。
 */
describe('the card 更新于 clock is the card own progress, not the sync stamp', () => {
  it('the meta line reads the derivation, never task.updatedAt', () => {
    const card = readFileSync(fileURLToPath(new URL('../src/client/board/TaskCard.tsx', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(card).toContain('formatTime(cardUpdatedAtOf(task))')
    expect(card).toContain('formatDateTime(cardUpdatedAtOf(task))')
    expect(card).not.toMatch(/\{t\('board\.updated'\)\} \{formatTime\(task\.updatedAt\)\}/)
  })

  it('the derivation reads the rounds, and a column re-sort cannot move it', () => {
    const base = createTask({ title: 't', description: '', prompt: 'p' }, 1000, 't', 0)
    // A fresh card: its own birth.
    expect(cardUpdatedAtOf(base)).toBe(1000)
    // A run that has not ended yet still counts at its start.
    const started = { ...base, executions: [{ id: 'e1', sessionId: undefined, startedAt: 2000, endedAt: undefined, result: undefined, error: undefined }] }
    expect(cardUpdatedAtOf(started)).toBe(2000)
    // Ending it moves the reading forward — the card itself advanced.
    const ended = { ...started, executions: [{ ...started.executions[0]!, endedAt: 3000, result: 'succeeded' as const }] }
    expect(cardUpdatedAtOf(ended)).toBe(3000)
    // A promotion stamps `updatedAt` all over the column; the reading must not
    // budge, or every sibling would claim to be 「刚刚」.
    const reshuffled = { ...ended, order: 0, updatedAt: 999_999 }
    expect(cardUpdatedAtOf(reshuffled)).toBe(3000)
  })
})
