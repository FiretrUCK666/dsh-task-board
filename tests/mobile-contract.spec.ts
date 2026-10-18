/**
 * The mobile contract — one CSS guarantee, frozen so a future refactor that
 * quietly removes any pillar of the responsive/touch design fails the build
 * instead of regressing the phone back to a desktop-only board.
 *
 * Pillars:
 *   1. ONE responsive reference: the board box is a size container
 *      (`container-type: inline-size` + a named container), and the compact
 *      geometry lives in `@container dsh-tb` blocks — never a viewport
 *      `@media` width query for the board's own layout.
 *   2. Compact columns: the five-up grid becomes a horizontal free-scroll
 *      track (each column wide enough to read) below the threshold.
 *   3. Floating panels size to the board box (percentages), not `vh`/`vw`,
 *      and the backdrop can scroll a panel taller than the box.
 *   4. Touch parity: interactions on touch are IDENTICAL to desktop (hover-
 *      revealed actions stay hover-revealed, drag reorder stays the reorder —
 *      no always-on overrides, no extra button pairs). The coarse-pointer
 *      block carries ONLY invisible ergonomics (hit-area growth, 16px inputs).
 *   5. Font-boosting defence + safe-area + 16px inputs.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { activeColumnIndexAt, scrollLeftForColumn } from '../src/client/board/column-tabs.ts'
import { keyboardOverlapPx } from '../src/client/board/keyboard-inset.ts'
import { panelCss, spacingPx, stripCssComments } from './panel-harness.ts'

/**
 * The `gap` inside a rule body, in pixels.
 *
 * A gap may be a literal or a ladder step; the ladder's number is resolved from
 * the sheet that declares it, so the rhythm claims below survive a step moving
 * — and a step that moves wrongly moves them with it.
 */
function gapPxIn(body: string): number | undefined {
  return spacingPx(/(?:^|[;{\s])(?:row-|column-)?gap\s*:\s*([^;}]+)/.exec(body)?.[1])
}

/**
 * The board surface AS IT RENDERS: every sheet the client half owns.
 *
 * Not the board's own sheet alone. The design variables (`--dsh-tb-*`) are
 * declared once for the whole plugin, in their own sheet, because both panels
 * read them — so a claim about a token, the corner-shape rule or the
 * reduced-motion policy is a claim about a rule that may live in any of them.
 * Reading one path made these assertions answer 「which file」 instead of
 * 「does the policy hold」, and the day the layer moved they went red on a
 * surface that was exactly as it should be.
 */
const source = panelCss()

/** EVERY block that starts at a matching line.
 *
 *  The coarse-pointer block now exists once per SHEET — the surface's controls
 *  in one, the design system's in the other — and the grammar is the union of
 *  the two. A reader that takes only the first match sees half of it and reports
 *  the other half as missing. */
function blocksFrom(pred: (line: string) => boolean): string {
  const lines = source.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!pred(lines[i])) continue
    let depth = 0
    const chunks: string[] = []
    let closed = false
    for (let j = i; j < lines.length && !closed; j++) {
      chunks.push(lines[j])
      for (const ch of lines[j]) {
        if (ch === '{') depth++
        else if (ch === '}') { depth--; if (depth === 0) { closed = true; break } }
      }
    }
    out.push(chunks.join('\n'))
  }
  return out.join('\n')
}

/** Extract a brace-balanced block that STARTS at the first line matching pred. */
function blockFrom(pred: (line: string) => boolean): string {
  const lines = source.split('\n')
  const start = lines.findIndex(pred)
  if (start < 0) return ''
  let depth = 0
  const chunks: string[] = []
  for (let j = start; j < lines.length; j++) {
    chunks.push(lines[j])
    for (const ch of lines[j]) {
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) return chunks.join('\n') }
    }
  }
  return chunks.join('\n')
}

/** The rule block whose body matches `marker` (first hit). */
function blockWith(marker: RegExp): string {
  const found = source.search(marker)
  if (found < 0) return ''
  const open = source.lastIndexOf('{', found)
  const selectorStart = source.lastIndexOf('}', open) + 1
  let depth = 0
  let end = open
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  return source.slice(selectorStart, end + 1)
}

/** The rule block whose selector line is exactly `.name {`. */
/** One class's own rule, TOP LEVEL first.
 *
 *  A conditional block may carry a same-named rule (`.modal` appears again
 *  inside the reduced-motion block with `animation: none`), and a trimmed
 *  comparison hits the indented one first — so "how wide is the panel" read
 *  `animation: none`. The top-level rule is the class's own; the nested ones are
 *  overrides under a condition, and they are read through `ruleIn` with the
 *  block they belong to. */
function ruleOf(name: string): string {
  return blockFrom(line => line === `.${name} {`) || blockFrom(line => line.trim() === `.${name} {`)
}

/** One rule's OWN text inside a scope (up to its closing brace) — never the
 *  slice to the end of the block, which would swallow later rules and make
 *  "must not contain" assertions meaningless. */
function ruleIn(scope: string, selector: string): string {
  const at = scope.indexOf(`${selector} {`)
  if (at < 0) return ''
  const end = scope.indexOf('}', at)
  return scope.slice(at, end < 0 ? undefined : end)
}

/** One rule's own text with its comments removed — comments carry prose, and a
 *  sentence ABOUT a declaration must never answer for the declaration itself. */
function withoutComments(rule: string): string {
  return rule.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The rule whose selector is EXACTLY `selector` in a scope — never a
 *  descendant selector that merely ends with it (`.boardRowTools .columnTabs`
 *  must not answer for `.columnTabs`). */
function ruleExact(scope: string, selector: string): string {
  const at = scope.indexOf(`\n  ${selector} {`)
  if (at < 0) return ''
  const end = scope.indexOf('}', at)
  return scope.slice(at, end < 0 ? undefined : end)
}

/**
 * Every `<marker> {` block in a sheet, brace-matched — ALL of them, not the last.
 *
 * `lastIndexOf` reads ONE block and calls it the block, and a sheet is allowed
 * to have several: the board has three reduced-motion blocks today. So the next
 * component that appends a block of its own silently moves what every
 * reduced-motion assertion is looking at, and a correct sheet goes red. Blocks
 * are COLLECTED here, and a claim about the policy asks whether ANY of them
 * carries it.
 *
 * Comments come off first. A comment that quotes a block would otherwise be
 * brace-matched exactly like a real one, and this repo's own rule 14 says a
 * checker that reads the decoration reports the explanation as the thing it
 * forbids.
 * @param marker - the opening text, braces included.
 * @param text - the sheet; the board's own unless a caller passes a fixture.
 * @returns each block's own text, in source order.
 */
function allBlocksOf(marker: string, text: string = withoutComments(source)): string[] {
  const out: string[] = []
  for (let at = text.indexOf(marker); at >= 0; at = text.indexOf(marker, at + 1)) {
    let depth = 0
    for (let i = at + marker.length - 1; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') { depth--; if (depth === 0) { out.push(text.slice(at, i + 1)); break } }
    }
  }
  return out
}

/**
 * `ruleOf`, but it PROVES the subject is there before the caller negates it.
 *
 * `ruleOf` answers `''` for a name the sheet has not got, and every "must not
 * contain" assertion over `''` passes — so a renamed or deleted rule turned a
 * negative into a green tick. The helper is added rather than folded into
 * `ruleOf` itself because the SAME reader is used in both polarities in this
 * file, and several of those call sites ask about a rule that is allowed to be
 * absent (`presetModal`, `autoModal`): a reader that threw would turn those into
 * failures about a rule nobody promised.
 * @param name - the class, without the dot.
 * @returns the rule's own text, with a guard attached to the assertion.
 */
function ruleOfPresent(name: string): string {
  const rule = ruleOf(name)
  expect(rule, `there is no .${name} rule in the board sheet, so this gate is reading nothing`).not.toBe('')
  return rule
}

describe('responsive container mechanism', () => {
  it('the board view root is a named size container', () => {
    const root = blockWith(/container-type:\s*inline-size/)
    expect(root).toMatch(/\[data-dsh-taskboard-view\]\s*\{/)
    expect(root).toMatch(/container-name:\s*dsh-tb/)
  })

  it('defeats Android/WeChat font boosting on the root', () => {
    const root = blockWith(/container-type:\s*inline-size/)
    expect(root).toMatch(/text-size-adjust:\s*100%/)
    expect(root).toMatch(/-webkit-text-size-adjust:\s*100%/)
  })

  it('the compact geometry is container-scoped, not a viewport width media query', () => {
    // The columns rule must be overridden inside a @container dsh-tb block…
    const compact = blockFrom(line => /@container\s+dsh-tb\s*\(max-width:\s*680px\)/.test(line))
    expect(compact).not.toBe('')
    // …and there must be NO viewport width media query driving the board's own
    // column grid (the old @media (max-width: …) mechanism).
    //
    // THE OLD CHECK NAMED ONE PREFIX. `/@media\s*\(max-width:\s*7\d\dpx\)/` matches
    // 700px–799px and nothing else: `640px`, `900px`, `1024px`, any other width,
    // and every `min-width` a future author writes all pass, while the project
    // bans the construct outright (「响应式禁 @media(max-width)」, the only switch
    // is `useSurfaceNarrow`). A check that can only catch the spelling it was
    // written for is a check that reports the mistake it remembers.
    //
    // COMMENTS OFF FIRST, and that is this repo's own rule 14: the sheet explains
    // the ban in prose, and a reader that keeps the comments reports the
    // explanation as the violation — leaving the next author to delete a correct
    // note rather than delete the query.
    // The WHOLE condition, not just the feature, so the failure names the query
    // a reader has to go and delete rather than the half of it they can grep.
    const widthQueriesIn = (text: string): string[] => [...withoutComments(text).matchAll(/@media[^{]*?\([^)]*\b(?:max|min)-width[^)]*\)/g)]
      .map(match => match[0].trim())
    const widthQueries = widthQueriesIn(source)
    expect(widthQueries, `a viewport width media query decides this board's layout: ${widthQueries.join(' | ')}`).toEqual([])
    // The reader, on the four shapes the old prefix could not see and the one it
    // must not answer to.
    for (const banned of ['@media (max-width: 640px) { .a { color: red; } }', '@media (max-width: 900px) { .a { color: red; } }', '@media screen and (min-width: 700px) { .a { color: red; } }']) {
      expect(widthQueriesIn(banned), `the reader cannot see ${banned.split('(')[1]?.split(')')[0]}`).toHaveLength(1)
    }
    expect(widthQueriesIn('@media (hover: none) and (pointer: coarse) { .a { color: red; } }'), 'a non-width media query was reported').toHaveLength(0)
    expect(widthQueriesIn('/* the old mechanism was @media (max-width: 700px) */\n.a { color: red; }'), 'a query quoted in a comment was read as a violation').toHaveLength(0)
  })

  it('shape switches read the surface, never the viewport (single truth)', () => {
    // P6 freeze: the cruise popover/Dialog switch and the panel fold
    // defaults both measure the surface the CSS queries. A viewport proxy
    // disagrees exactly when it matters (mid-size window + shell sidebar
    // open), so `useNarrow` is frozen and no caller may import it.
    const boardPath = fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url))
    const board = readFileSync(boardPath, 'utf8')
    expect(board).toMatch(/useSurfaceNarrow\('\[data-dsh-taskboard-view\]', bandNarrowMax\('board', 680\)\)/)
    expect(board).not.toMatch(/useNarrow\(/)
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    expect(readFileSync(panelPath, 'utf8')).toMatch(/useSurfaceNarrow\('\[data-dsh-taskboard-panel\]', bandNarrowMax\('sessionPanel', 600\)\)/)
    const hookPath = fileURLToPath(new URL('../src/client/design/use-narrow.ts', import.meta.url))
    expect(readFileSync(hookPath, 'utf8')).toMatch(/@deprecated/)
  })
})

describe('compact columns + panel geometry', () => {
  const compact = blockFrom(line => /@container\s+dsh-tb\s*\(max-width:\s*680px\)/.test(line))

  it('columns become a free horizontal swipe track (NO snap — resize-stable)', () => {
    // The .columns override inside the compact block.
    const columns = compact.slice(compact.indexOf('.columns'))
    expect(columns).toMatch(/overflow-x:\s*auto/)
    expect(columns).toMatch(/display:\s*flex/)
    // Snap is deliberately GONE: it re-anchored by pixel scrollLeft on every
    // container resize, so opening/closing the shell sidebar shifted the whole
    // board a little each time (cumulative drift). The tab strip jumps columns.
    expect(columns).not.toMatch(/scroll-snap-type/)
  })

  it('each compact column is wide enough to read (no snap-align)', () => {
    const column = compact.slice(compact.indexOf('.column {'))
    expect(column).toMatch(/flex:\s*0 0/)
    expect(column).toMatch(/cqw/)
    expect(column).not.toMatch(/scroll-snap-align/)
  })

  it('floating panels size to the board box at EVERY width, never vh/vw', () => {
    // The overlay chrome (margin:auto + max-height + opaque float) is ONE
    // shared rule for the whole family; each panel adds only its own width.
    const chrome = /* 顶层的那一条：.modal 在 @media 里也有一条（reduced motion 的 animation:none），
       trim 过的比较会先命中缩进的那一条。chrome 是顶层规则，所以按列位匹配。 */
    blockFrom(line => line === '.modal {')
    expect(chrome).toMatch(/max-height:\s*100%/)
    expect(chrome).toMatch(/margin:\s*auto/)
    expect(chrome).toMatch(/overflow:\s*hidden/)
    // Every panel owns a board-box width (min(Npx, 100%)) — never a viewport unit.
    for (const panel of ['modal', 'detail', 'review']) {
      expect(ruleOf(panel)).toMatch(/width:\s*min\(\d+px,\s*100%/)
      expect(ruleOf(panel)).not.toMatch(/\d+(vh|vw)\b/)
    }
    for (const panel of ['presetModal', 'autoModal']) {
      expect(ruleOf(panel)).not.toMatch(/\d+(vh|vw)\b/)
    }
    // …and the compact block carries no viewport units either.
    expect(compact).not.toMatch(/\dvh/)
    expect(compact).not.toMatch(/\dvw/)
  })

  it('the backdrop scrolls, pads by the keyboard inset, and contains itself', () => {
    const backdrop = ruleOf('modalBackdrop')
    // The stage scrolls vertically (its bar is hidden — the grammar lives in
    // the panel body), never horizontally.
    expect(backdrop).toMatch(/overflow-y:\s*auto/)
    expect(backdrop).toMatch(/overflow-x:\s*hidden/)
    // One CSS variable feeds every overlay: the soft keyboard shrinks the
    // stage instead of burying panel headers (「添加已有会话」标题被遮 root fix).
    expect(backdrop).toMatch(/var\(--dsh-tb-kb,\s*0px\)/)
    expect(backdrop).toMatch(/overscroll-behavior:\s*contain/)
  })

  it('the session row is a NAMED GRID (structural slots, never content-driven wrap)', () => {
    expect(compact).toMatch(/\.modalFooter[\s\S]*?flex-wrap:\s*wrap/)
    // Base: one row, three structural columns (lead flexes, chip + act hug
    // their tracks) — so the chip/actions land at the SAME x on every row no
    // matter the title length (the 「没对齐」 class, closed structurally).
    const row = ruleOf('sessionRowTop')
    expect(row).toMatch(/display:\s*grid/)
    expect(row).toMatch(/grid-template-areas:\s*"lead chip act"/)
    expect(ruleOf('sessionRowLead')).toMatch(/grid-area:\s*lead/)
    expect(ruleOf('sessionRowChip')).toMatch(/grid-area:\s*chip/)
    expect(ruleOf('sessionRowActions')).toMatch(/grid-area:\s*act/)
    // Compact: the grid re-templates to two rows (chip under lead, act spans
    // the right) — still structural, never a content-driven wrap.
    expect(compact).toMatch(/\.sessionRowTop\s*\{[\s\S]*?grid-template-areas:[\s\S]*?"lead act"[\s\S]*?"chip act"/)
  })

  it('a column navigator strip exists, hidden by default, and is FIVE EQUAL cells compact', () => {
    // Desktop: all five columns share the screen, no tabs needed (base hides).
    expect(ruleOf('columnTabs')).toMatch(/display:\s*none/)
    // Compact: an equal five-cell grid — content-width pills overflowed a
    // phone board, so the navigator itself needed a swipe (a navigator you
    // cannot see is no navigator). All five always fit; names ellipsize.
    expect(compact).toMatch(/\.columnTabs\s*\{\s*\n?\s*display:\s*grid/)
    expect(compact).toMatch(/grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/)
    expect(compact).toMatch(/\.columnTabLabel\s*\{[^}]*text-overflow:\s*ellipsis/)
    // The strip owns symmetric breathing from the ONE strip token (never a
    // hand-typed px pair that rots apart — the 「上面有空隙下面紧贴」 class).
    expect(ruleExact(compact, '.columnTabs')).toMatch(/padding:\s*var\(--dsh-tb-strip-gap\) 0/)
    expect(source).toMatch(/--dsh-tb-strip-gap:\s*\d+px/)
    // A column is capped well under full width — roughly two columns plus the
    // next column's edge share a phone board (「一列占满整屏」 fix).
    const column = compact.slice(compact.indexOf('.column {'))
    expect(column).toMatch(/flex:\s*0 0 clamp\(\d+px,\s*\d+cqw,\s*3\d\dpx\)/)
  })
})

describe('touch parity block (invisible ergonomics only)', () => {
  const touch = blocksFrom(line => /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)/.test(line))

  it('exists', () => {
    expect(touch).not.toBe('')
  })

  it('never force-reveals the hover-only affordances (mobile IS desktop)', () => {
    // The user's contract: quick-run / copy ride hover exactly
    // like on the desktop board — an always-visible override is a regression.
    expect(touch).not.toMatch(/\.cardQuickRun\s*\{[^}]*opacity:\s*1/)
    expect(touch).not.toMatch(/\.promptCopy\s*\{[^}]*opacity:\s*1/)
  })

  it('the touch reorder button pair is gone (drag stays the only reorder)', () => {
    // The affordance was removed on user request: session reorder is the
    // press-and-drag gesture, everywhere, exactly like desktop.
    expect(source).not.toMatch(/sessionRowMove/)
  })

  it('grows small hit areas without changing visual size', () => {
    // The ::before overlay pattern on the compact controls. **The outset is a TOKEN,
    // never a literal**: two sheets each writing their own `inset: -7px` / `-8px -3px`
    // is how one concept grew three values (board 7, item 8 block / 3 inline), and a
    // number that is only right in one place is wrong in the next one. Both touch
    // blocks read `--dsh-tb-hit-ring-block` / `-inline`, declared once in the layer.
    expect(touch).toMatch(/\.buttonSm::before[\s\S]*?position:\s*absolute/)
    expect(touch).toMatch(/inset:\s*calc\(-1 \* var\(--dsh-tb-hit-ring-block\)\)/)
    expect(touch).not.toMatch(/inset:\s*-\d+px/)
    // Planted bite: the literal-ban above must react when a literal comes back.
    expect(/inset:\s*-\d+px/.test(`${touch}\n.x::before { inset: -7px; }`)).toBe(true)
  })

  it('inputs reach 16px to stop the mobile auto-zoom on focus', () => {
    expect(touch).toMatch(/\.input[\s\S]*?font-size:\s*16px/)
  })
})

describe('drag reorder machinery survives (the user gesture)', () => {
  it('the drop indicator and reordering breathing room stay styled', () => {
    // Press-and-drag session reorder (desktop + mobile alike) depends on
    // these CSS surfaces; a "touch cleanup" must never strip them.
    expect(ruleOf('dropIndicator')).toMatch(/position:\s*absolute/)
    expect(source).toMatch(/\.sessionList\[data-reordering\]/)
  })
})

describe('form-row grammar (give way, never crush)', () => {
  const compact = blockFrom(line => /@container\s+dsh-tb\s*\(max-width:\s*680px\)/.test(line))

  it('every track that can hold an input declares a zero floor', () => {
    // A bare `1fr` track has an MINIMUM of `auto`, so one nowrap button in the
    // row blows the track past the container and the input — the only
    // flexible member — collapses to its padding (the "Cron 框只剩一个小圆角").
    expect(ruleOf('scheduleGrid')).toMatch(/minmax\(0,\s*1fr\)/)
    expect(ruleOf('presetNew')).toMatch(/minmax\(\d+ch,\s*1fr\)/)
    expect(ruleOf('presetRow')).toMatch(/minmax\(\d+ch,\s*1fr\)/)
  })

  it('the flexible input carries a real width floor and the row wraps', () => {
    expect(ruleOf('scheduleInput')).toMatch(/flex:\s*1 1 \d+px/)
    expect(ruleOf('scheduleCronRow')).toMatch(/flex-wrap:\s*wrap/)
  })

  it('the select arrow inset comes from ONE token (text can never slide under it)', () => {
    const wrap = ruleOf('selectWrap')
    expect(wrap).toMatch(/--dsh-tb-select-arrow-inset:/)
    expect(ruleOf('selectWrap select')).toMatch(/padding-right:\s*var\(--dsh-tb-select-arrow-inset\)/)
    expect(ruleOf('selectWrap select')).toMatch(/text-overflow:\s*ellipsis/)
    // The dead `flex: none` on the inner select (the flex item is the WRAPPER)
    // must not come back — it "fixed" nothing and hid the real cause.
    expect(source).not.toMatch(/\.schedulePreset\s*\{[^}]*flex:\s*none/)
  })

  it('hierarchy is expressed by grid AREAS, not by auto margins + wrap', () => {
    // `margin-left:auto` + `border-left` "right-aligns" the FIRST item of
    // whichever line it lands on — so a narrow panel scattered 删除 right and
    // 创建于 left with a floating hairline between them.
    const footer = ruleOf('detailFooter')
    expect(footer).toMatch(/display:\s*grid/)
    expect(footer).toMatch(/grid-template-areas:\s*"actions meta danger"/)
    expect(source).not.toMatch(/\.detailFooterDanger\s*\{[^}]*margin-left:\s*auto/)
    // …and the compact form re-STACKS rows (never re-adds a flex-wrap).
    expect(compact).toMatch(/\.detailFooter\s*\{[^}]*grid-template-areas:/)
    expect(compact).not.toMatch(/\.detailFooter\s*,[^}]*flex-wrap/)
  })

  it('no auto-margin is used to right-align anything, anywhere on the board', () => {
    // The rule is general: `margin-left:auto` right-aligns whichever item
    // happens to START the line it lands on, so every one of them is a
    // wrap-away-from-becoming-a-mess waiting to happen. The whole sheet is
    // swept (code declarations only — prose in comments is matched by the
    // `;` requirement), so a new one fails the build instead of review.
    const declarations = source.match(/margin-(left|right):\s*auto\s*;/g) ?? []
    expect(declarations).toEqual([])
  })

  it('secondary dialog actions live in the action row, not on a row of their own', () => {
    // A full-width flex-end toolbar above an empty list is the "big blank top
    // with one stray button" look.
    expect(source).not.toMatch(/\.presetToolbar/)
  })

  it('a section head keeps its action cluster on the SAME line at every width', () => {
    // 「会话规则和新增会话规则在电脑端一条水平线，手机端不是」: the compact
    // template stacked title over action, "solving" a squeeze that cannot
    // happen — the title track is minmax(0,1fr) and ellipsizes, so the row
    // gives way by shortening the LABEL, never by breaking the pair.
    expect(ruleOf('sectionHead')).toMatch(/grid-template-areas:\s*"title action"/)
    expect(compact).not.toMatch(/\.sectionHead\s*\{[^}]*grid-template-areas:\s*"title"\s*"action"/)
    // The give-way member is the text slot (truncation never lives in a
    // container that hides its children).
    expect(ruleOf('sectionHead h4')).toMatch(/text-overflow:\s*ellipsis/)
  })

  it('row hierarchy is a named grid, never margin-left:auto (automation rows)', () => {
    // The auto-margin spelling right-aligns whichever item happens to start
    // the line, so a wrapped line scatters the pair.
    expect(source).not.toMatch(/\.autoRuleButtons\s*\{[^}]*margin-left:\s*auto/)
    expect(ruleOf('autoRuleActions')).toMatch(/grid-template-areas:\s*"switch buttons"/)
    // …and no off-grid 2px/3px leftovers in the rule row's own rhythm.
    expect(gapPxIn(ruleOf('autoRuleRow')), 'the rule row left the ladder').toBe(4)
  })

  it('the automation body never repeats the fold row summary', () => {
    // scheduleSummary is the disclosure's (and the overview row's) one-liner;
    // rendering it again inside the expanded body is the lone second
    // 「未启用」 line the user pointed at.
    const autoPath = fileURLToPath(new URL('../src/client/board/automation-ui.tsx', import.meta.url))
    const auto = readFileSync(autoPath, 'utf8')
    const editor = auto.slice(auto.indexOf('export function AutomationEditor'))
    expect(editor).not.toMatch(/scheduleMeta">\{summary\}/)
    expect(editor).toMatch(/scheduleSummary is the FOLD/)
  })
})

describe('board header and navigator legibility', () => {
  const compact = blockFrom(line => /@container\s+dsh-tb\s*\(max-width:\s*680px\)/.test(line))

  it('the compact column navigator shows SHORT names and drops the redundant dot', () => {
    // Five equal cells on a phone leave ~1.6 Chinese characters: full names all
    // ellipsize to 「待…」「进…」 and the navigator stops naming anything.
    // Short labels are locale data (one source), the dot gives way (the column
    // header below already carries it), and the full name survives as the
    // tab's accessible name.
    expect(compact).toMatch(/\.columnTab \.statusDot\s*\{\s*\n?\s*display:\s*none/)
    expect(source).toMatch(/\.columnTabLabel\s*\{[^}]*text-overflow:\s*ellipsis/)
    const tsxPath = fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url))
    const board = readFileSync(tsxPath, 'utf8')
    expect(board).toMatch(/t\(STATUS_SHORT_KEY\[column\.status\]\)/)
    /* 全名仍然进可达名——但走**藏起来的那一串**，不走 `aria-label`。后者**替换**内容，
       于是屏上那串字（短名 + 计数）被挡在名字之外：一个用嘴操作的人念出他看见的
       「规划 1」对不上，而检查器报的正是同一件事（`label-content-name-mismatch`，五枚
       标签一起报）。藏起来的字进名字、不进可见文字，于是「全名照读出来」与「名字里有
       屏上那串字」（WCAG 2.5.3）两件同时成立。 */
    expect(board).toMatch(/<span className=\{css\.srOnly\}>\{t\(STATUS_KEY\[column\.status\]\)\}<\/span>/)
    const statusPath = fileURLToPath(new URL('../src/client/board/status.ts', import.meta.url))
    const statusSource = readFileSync(statusPath, 'utf8')
    for (const key of ['backlog', 'todo', 'running', 'review', 'done']) {
      expect(statusSource).toContain(`board.statusShort.${key}`)
    }
  })

  it('the live-status row clips its TEXT, never the dot glow', () => {
    // `overflow: hidden` on the container also cut the 4px box-shadow of the
    // child dot (and its 12px line box was shorter than dot + glow), so the
    // warning indicator read as chopped in half.
    //
    // THE NEGATIVE NEEDS A SUBJECT. `ruleOf` answers `''` for a name the sheet
    // has not got, and `expect('').not.toMatch(/overflow:\s*hidden/)` is true —
    // so renaming or deleting `.boardStatus` turned this assertion into a green
    // tick about a rule that no longer exists. The two positives below already
    // prove the reader works (an absent rule fails a `toMatch`); this one could
    // not, which is why it is the only one that needed the guard.
    const status = ruleOfPresent('boardStatus')
    expect(status).not.toMatch(/overflow:\s*hidden/)
    // 省略号形态只有一处家（设计系统的 `.truncate`，四个文字子槽共用）。这里断言的那
    // 两句说的是**这个形态**能省略，第三句说的是状态行**应用**了它——读结构，不读字样。
    const ellipsis = ruleOfPresent('truncate')
    expect(ellipsis).toMatch(/overflow:\s*hidden/)
    expect(ellipsis).toMatch(/text-overflow:\s*ellipsis/)
    const boardTsx = readFileSync(fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url)), 'utf8')
    expect(boardTsx, '状态行没有应用省略号那一类').toMatch(/components\.truncate\}/)
  })

  it('the compact board header is a DECLARED tool grid (never a wrap soup)', () => {
    // 工作台栏之后只剩一条命令带。它的窄档形状由具名区域说死：第 1 行
    // 搜索 | 巡航 | 新建，第 2 行模式簇，第 3 行列导航。报告簇（诉求 + 状态）
    // 只在真有话说时占第 0 行——一个常驻的空槽就是一条死掉的带。
    const tools = ruleIn(compact, '.boardRowTools')
    expect(tools).toMatch(/display:\s*grid/)
    expect(tools).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+auto/)
    expect(tools).toMatch(/grid-template-areas:[\s\S]*"search cruise new"[\s\S]*"modes modes modes"[\s\S]*"tabs tabs tabs"/)
    // 报告行是一个条件行：簇里有内容时模板才多出那一行；空簇本身不渲染
    // （没有孩子的 flex 项仍会白吃两侧间隙，读起来像一条空槽）。
    expect(compact).toMatch(/\.boardRowTools:has\(\.boardDemand,\s*\.boardState\)\s*\{[\s\S]*?"reports reports reports"/)
    expect(source).toMatch(/\.boardReports:not\(:has\(>\s*\*\)\)\s*\{\s*\n?\s*display:\s*none/)
    // 每个成员都由区域定位，没有一件靠 `order` 或 auto margin 获得位置。
    for (const [member, area] of [
      ['.boardRowTools .search', 'search'],
      ['.boardRowTools .cruiseWrap', 'cruise'],
      ['.boardRowTools .boardNewTask', 'new'],
      ['.boardRowTools .boardModes', 'modes'],
      ['.boardRowTools .columnTabs', 'tabs'],
    ] as const) {
      expect(ruleIn(compact, member), `${member} has no declared area`).toMatch(new RegExp(`grid-area:\\s*${area}`))
    }
    // 宽档的弹性留白在窄档退场（它只为把动作簇推到右端而生）。
    expect(compact).toMatch(/\.boardRowTools \.boardSpacer\s*\{\s*\n?\s*display:\s*none/)
    expect(compact).not.toMatch(/margin-left:\s*auto/)
    expect(compact).not.toMatch(/\.boardRowTools[^{]*\{[^}]*order:/)
    // 320–400px：搜索的 140px 地板 + 两个动作装不下一行，于是搜索独占一行
    // （换行，不压扁）。
    expect(compact).toMatch(/@container dsh-tb \(max-width: 400px\)[\s\S]*?"search search"[\s\S]*?"cruise new"/)
    // 主行动与铃不再被搬去第二条栏：两个宽度都在这条工具带里。
    expect(compact).not.toMatch(/\.boardNewTask\s*\{[^}]*display:\s*none/)
    expect(compact).not.toMatch(/\.boardModes \.notifyBell\s*\{[^}]*display:\s*none/)
    /* 引擎席位的说明仍是真按钮（触屏没有 hover 可以揭示一个 title）——但它现在住在
       工作台级的警告条里，不再住在看板的读数槽里：警告只有一页看得见，等于另外两页
       看不见。所以判据读的是那个组件，不是看板那张表。 */
    const noticePath = fileURLToPath(new URL('../src/client/design/WorkbenchNotice.tsx', import.meta.url))
    const notice = readFileSync(noticePath, 'utf8')
    expect(notice, 'the warning entry must be a real button').toContain('<button')
    // 状态行省略零段（「排队 0」是噪音——与上下文计量同一条静默文法）。这两条读的是
    // 看板那张表，所以变量在**这一条用例里**重新读一次（上面那一段的 `board` 已经
    // 不属于这个 describe）。
    const boardSrc = readFileSync(fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url)), 'utf8')
    expect(boardSrc).toMatch(/snapshot\.stats\.running > 0 \? \[t\('board\.statusRunning'/)
    expect(boardSrc).toMatch(/snapshot\.stats\.queued > 0 \? \[t\('board\.statusQueued'/)
  })

  it('the tool row carries the agreed MEMBERS at both widths', () => {
    // ONE command lane serves both widths: search, the report cluster (demand +
    // state), cruise, the primary action, the modes cluster (organize /
    // automation / card-from-sessions / activity / update check / bell) and the
    // compact column navigator. Each control has ONE DOM node — the old
    // 「窄档搬去拇指栏」 twins are gone, so nothing can be visible twice or
    // missing once.
    const tsxPath = fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url))
    const board = readFileSync(tsxPath, 'utf8')
    const toolsRow = board.slice(board.indexOf('css.boardRowTools'), board.indexOf('organizeBar'))
    for (const member of [
      'css.search', 'css.boardReports', 'css.boardDemand', 'css.boardState',
      'css.cruiseWrap', 'css.boardNewTask', 'css.boardModes', 'renderNotifyBell()',
      'css.columnTabs',
    ]) {
      expect(toolsRow, `${member} left the tool row`).toContain(member)
    }
    // Actions stay at the right end: cruise → primary → modes cluster.
    expect(toolsRow.indexOf('css.cruiseWrap')).toBeLessThan(toolsRow.indexOf('css.boardNewTask'))
    expect(toolsRow.indexOf('css.boardNewTask')).toBeLessThan(toolsRow.indexOf('css.boardModes'))
    // The workbench bar is the board's FIRST child, and the way out is ITS
    // exit: there is no second back button in the header.
    expect(board.indexOf('<WorkbenchBar')).toBeLessThan(board.indexOf('<header className={css.boardHeader}'))
    expect(board, 'a second back control came back into the header').not.toContain('css.boardBack')
    expect(board).not.toContain("t('board.close')")
    // The primary action and the bell exist once.
    expect(board.match(/\{t\('board\.new'\)\}/g)).toHaveLength(1)
    expect(board, 'the removed thumb bar came back').not.toMatch(/<nav className=\{css\.thumbBar\}/)
    // The modes cluster is one named group; its name is dictionary copy, not a
    // string typed on the screen (touch has no hover to explain the cluster).
    expect(board).toContain('role="group" aria-label={t(\'board.thumbBar\')}')
    // Batch run rides the organize bar as its apex action (primary): only
    // prompt-ready cards fire, through the single launch point.
    expect(board).toContain("t('board.organizeRun', {")
    expect(board).toContain('runnableIds(snapshot.tasks, liveIds)')
    expect(board).toContain("controller.runTask(id, 'manual')")
    // The destructive confirm restates its blast radius (count + object —
    // a bare "Delete" trains click-through) and every `{n}` template in
    // locales rides a call site that passes it (silent no-param renders leak
    // the braces to users).
    expect(board).toMatch(/deleteSelectedOk', \{ n:/)
    // Activity joins the modes cluster as a quiet ghost (read-only feed,
    // rows open the task — derived, never synced).
    expect(board).toContain("t('board.activity')")
    expect(board).toContain('setShowActivity(true)')
    expect(board).toContain('activityOf(snapshot.tasks,')
    // Card-from-sessions rides the modes cluster at BOTH widths — one node, no
    // twin.
    expect(toolsRow).toContain("t('board.newFromSessions')")
    expect(board).toContain('setShowCardFromSessions(true)')
    // The board frame is height:100% plus padding: without border-box it runs
    // ~30px taller than its view, and the columns lose their bottom edge.
    expect(ruleOf('board')).toMatch(/box-sizing:\s*border-box/)
    // The strip really lives inside that row (DOM, not just CSS): the JSX nests
    // it there, so the declared tracks actually own it.
    expect(toolsRow).toContain('css.columnTabs')
  })

  it('feed rows keep their box AND land on the session thread (no right-bleed, no stuck hover, no bare task open)', () => {
    // Geometry: width:100% + horizontal padding with no box-sizing bleeds
    // past the list's right edge under content-box (the host guarantees no
    // global reset) — the highlight bar "glued to the right margin".
    expect(ruleOf('notifyRow')).toMatch(/box-sizing:\s*border-box/)
    // Touch has no hover: a tap leaves unconditional :hover paint stuck on
    // the row, turning a transient glance into a persistent bar. Hover paint
    // lives behind (hover:hover) only — no bare top-level rule survives.
    const hoverMedia = blockFrom(line => line.trim() === '@media (hover: hover) {')
    expect(hoverMedia).toContain('.notifyRow:hover')
    expect(hoverMedia).toMatch(/background:\s*var\(--dsh-tb-hover\)/)
    expect(source.replace(hoverMedia, '')).not.toContain('.notifyRow:hover')
    // Deep link: both feed dialogs share one helper opening the task AT the
    // row's session (its comment thread), gated on the native side still
    // knowing the session — a review row's task-id fallback degrades to a
    // plain open, never a panel for a garbage id.
    const tsxPath = fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url))
    const board = readFileSync(tsxPath, 'utf8')
    expect(board).toContain('openTaskAtSession(note.taskId, note.sessionId)')
    expect(board).toContain('openTaskAtSession(item.taskId, item.sessionId)')
    expect(board).toMatch(/controller\.sessionTitle\(sessionId\) !== undefined/)
    expect(board).toContain('requestSessionId={detailSessionRequest')
    // The detail consumes the request exactly once, then the parent resets.
    const detailPath = fileURLToPath(new URL('../src/client/board/TaskDetail.tsx', import.meta.url))
    const detail = readFileSync(detailPath, 'utf8')
    expect(detail).toContain('requestSessionId?: string')
    expect(detail).toMatch(/setLinkedSession\(requestSessionId\)/)
    expect(detail).toContain('onRequestSessionConsumed?.()')
  })
})

describe('alignment grammar (the OCD contract)', () => {
  const compact = blockFrom(line => /@container\s+dsh-tb\s*\(max-width:\s*680px\)/.test(line))

  it('a scroll region owns its inner padding, so its bar lands on the surface edge', () => {
    // The single scrollbar grammar: the SCROLLER carries the horizontal inset
    // (bar flush to the card edge, text inset). A padded parent with an
    // unpadded scroller floats the bar beside the text — the「滚动条贴着文字」
    // complaint on the interaction (question/plan) card.
    const card = ruleOf('interactionCard')
    // The narrow rail is where the box is at its shortest — the folds block is
    // capped here, so a phone's comments box is 273px while a question with
    // four described options is 292px. The card is CONTENT (no cap, no clip of
    // its own: the law and the measurement behind it live in
    // `review-page.spec.ts`), because a cap can only ever be a promise about a
    // box this tier is the one to break.
    expect(card, 'the card caps itself again — on a phone its box is shorter than its own floor').not.toMatch(/max-height/)
    // The bodies own their horizontal inset (the text keeps the card's line) and
    // are NOT scroll regions: the comments box is the region that scrolls.
    expect(ruleOf('interactionBody')).toMatch(/padding:\s*8px 12px/)
    expect(ruleOf('interactionCardBody')).toMatch(/padding:\s*0 12px/)
    expect(ruleOf('interactionActions')).toMatch(/padding:\s*0 12px/)
    // Two option grammars, deliberately distinct: the read-only card QUOTES the
    // options in `li` rows (no pointer cursor, no hover lift, no focus ring),
    // while the interactive menu row is a button with its own hover. The label
    // pill (`.interactionOption`) is gone for good — it looked pressable and was
    // not, which is the 「approve / keep planning 点了没反应」 report.
    expect(source).toMatch(/^\.interactionOffered\s*\{/m)
    expect(source).toMatch(/\.interactionOptionButton:hover:not\(:disabled\)/)
    expect(source).not.toMatch(/\.interactionOffered[^,{]*:hover/)
    expect(source).not.toMatch(/\.interactionOffered[^,{]*:focus-visible/)
    expect(source, '那条「看着能按、其实按不动」的胶囊不许回来').not.toMatch(/^\.interactionOption\s*\{/m)
  })

  it('the interactive question card stays fully operable on a phone', () => {
    // 双端同治：交互卡（提问/计划）是窄档最容易被挤坏的一块——选项行、输入行、
    // 动作行必须都留在卡里，且**不许靠藏标签/缩字号省地方**（硬性规范 10）。
    // 这里钉死四条：动作行换行、可点目标有地板、正文可换行、字号不缩。
    const footer = ruleOf('interactionFooter')
    expect(footer).toContain('flex-wrap: wrap')
    expect(footer).toMatch(/padding:\s*8px 12px 10px/)
    // Every tap target keeps a floor (option rows and the custom row).
    expect(ruleOf('interactionOptionButton')).toMatch(/min-height:\s*36px/)
    expect(ruleOf('interactionCustomRow')).toMatch(/min-height:\s*36px/)
    // The option's one text line wraps (label / 推荐 / description) instead of
    // clipping the description away.
    expect(ruleOf('interactionOptionLine')).toContain('flex-wrap: wrap')
    expect(ruleOf('interactionOptionLine')).toContain('min-width: 0')
    // Text never leaves its box, and the font size never shrinks for space.
    // The bound is a FLOOR, not a ceiling: hard rule 11 forbids shrinking type to
    // save room, and DESIGN.md's Four-Size Rule puts the title step at 16px. This
    // asserted `1[1-5]px`, which is an upper bound wearing a floor's name — it
    // rejected the 16px title tier the design system itself sanctions, so a size
    // moving UP onto the scale failed a test about sizes shrinking.
    // The real invariant: interface text never goes below 11px.
    for (const name of ['interactionTitle', 'interactionOptionLabel', 'interactionProgress']) {
      const size = Number(/font-size:\s*(\d+(?:\.\d+)?)px/.exec(ruleOf(name) ?? '')?.[1])
      expect(size, `.${name} must not shrink below the 11px floor`).toBeGreaterThanOrEqual(11)
    }
    expect(ruleOf('interactionOptionLabel')).toContain('overflow-wrap: anywhere')
    // The custom answer field's textarea mirrors the field's own metrics, so
    // the auto-grown height can never disagree with the text inside it.
    const field = ruleOf('interactionField')
    expect(field).toBeTruthy()
    expect(source).toMatch(/\.interactionField > \* \{[^}]*font-size:\s*13px/)
    expect(source).toMatch(/\.interactionField > \* \{[^}]*line-height:\s*20px/)
  })

  it('the compact tool row keeps ONE rhythm and the strip owns its last track', () => {
    // 同一张 grid 里的间距由轨道与 row-gap 声明，不从「上一行盒子的底边」推导
    // ——那条底边在真机上会被行盒悄悄吃掉几像素。列导航条是这张 grid 的第三条
    // 轨，条带自己再声明一条单行的药丸轨，任何一侧的行盒异动都够不到间距。
    const tools = ruleIn(compact, '.boardRowTools')
    expect(tools).toMatch(/row-gap:\s*var\(--dsh-tb-strip-gap\)/)
    expect(ruleIn(compact, '.boardRowTools .columnTabs')).toMatch(/grid-area:\s*tabs/)
    expect(ruleExact(compact, '.columnTabs')).toMatch(/grid-template-rows:\s*var\(--dsh-tb-button-h\)/)
    // The search fills its track here: no 520px desktop cap in a 388px row.
    expect(ruleIn(compact, '.boardRowTools .search')).toMatch(/max-width:\s*none/)
  })

  it('row actions KEEP THEIR WORDS compact, and give way instead of hiding', () => {
    // The text cluster ("查看会话 / 重命名 / 隐藏") is a real tax on a 412px row,
    // and the first answer to it was to hide the words and show glyphs. That is
    // hard rule 11's forbidden move, and it cost more than it saved: the glyphs
    // left 24x16 touch targets whose only explanation was a `title`, and one of
    // those titles is the session ID rather than the action.
    //
    // The tax is answered by GIVING WAY. The words stay at every width and the
    // cluster wraps; the title keeps its quota because the compact grid still
    // gives the lead the whole leftover track (`minmax(0, 1fr)`).
    expect(compact).not.toMatch(/rowActionText\s*\{[^}]*display:\s*none/)
    expect(compact).not.toMatch(/rowActionIcon/)
    expect(compact).toMatch(/\.sessionRowActions\s*\{[^}]*flex-wrap:\s*wrap/)
    const top = ruleIn(compact, '.sessionRowTop')
    expect(top).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\) auto/)
    expect(top).toMatch(/row-gap:\s*var\(--dsh-tb-space-2\)/)
    expect(compact).toMatch(/\.sessionRowTop \.sessionRowChip\s*\{[^}]*padding-left:\s*0/)
    // The identity slot is a NAMED GRID whose flexible track is declared, and
    // the identity block is placed BY NAME. Auto-placement into a fixed track
    // is the bug that ate the title on a phone (a row without an unread marker
    // landed in the marker's 12px column → a 0px name, a vanished workspace).
    const lead = ruleIn(compact, '.sessionRowLead')
    expect(lead).toMatch(/display:\s*grid/)
    expect(lead).toMatch(/grid-template-areas:\s*"identity"/)
    expect(lead).not.toMatch(/grid-template-columns:\s*12px/)
    const leading = ruleIn(compact, '.sessionRowLeading')
    expect(leading).toMatch(/grid-area:\s*identity/)
    expect(leading).toMatch(/column-gap:\s*var\(--dsh-tb-lead-gap\)/)
  })

  it('ONE rail/content line per surface comes from a token, never a re-typed number', () => {
    // The 「上下文与运行配置往右移了一点」 class: each rail member wrote its
    // own 14px, and the head wrote it TWICE (section padding + button margin)
    // while the state row wrote it ZERO. One token, consumed once per member.
    expect(source).toMatch(/--dsh-tb-rail-inset:\s*14px/)
    for (const member of ['sessionFacts', 'railHeadSection', 'commentsScroll', 'reviewComposer']) {
      expect(source).toMatch(new RegExp(`\\.${member}[^}]*var\\(--dsh-tb-rail-inset\\)`))
    }
    // The head's fold row must NOT add a second inset (that was the 28px).
    expect(source).not.toMatch(/\.railDisclosure\s*\{[^}]*margin/)
    // The session row's identity column is one DERIVED x, not a magic 19px —
    // and the derivation is a GRID, not a `calc()` someone has to remember to
    // use: a named mark track plus a named gutter. This used to assert that a
    // `--dsh-tb-lead-x: calc(…)` token existed; the token had no consumer, so
    // the claim was about a declaration rather than about the layout, and it
    // passed while every member could have re-typed the number. What is
    // load-bearing is that the two numbers are tokens AND that the grid spends
    // them.
    expect(source).toMatch(/grid-template-columns:\s*var\(--dsh-tb-lead-icon\)\s+minmax\(0,\s*1fr\)/)
    expect(source).toMatch(/column-gap:\s*var\(--dsh-tb-lead-gap\)/)
  })

  it('the workbench bar is the only page-level control inside the board', () => {
    // 「工具栏不能重写轨道线」的那条旧断言随拇指栏一起退场：那条栏已经不存在，
    // 留一条关于死代码的测试只会让下一个人以为它还需要。它守的「同一件事只有
    // 一个数」现在由工具带的具名区域接管（见 compact header 那一条）。
    expect(source).not.toContain('.thumbNew')
    expect(source).not.toContain('.thumbBarButton')
  })

  it('a widget role that promises arrow keys implements them', () => {
    // `role="tablist"` and `role="radiogroup"` are not decoration: ARIA defines both
    // as composites whose arrow keys move within the widget, and both also define
    // roving tabindex (the widget is ONE stop in the page's tab order). The board
    // announced both roles while implementing neither — a keyboard user walked five
    // tab stops for one navigator, and a screen reader was told to expect an
    // interaction that did not exist. Announcing less would also have been honest;
    // implementing the grammar is better, because the roles were correct.
    //
    // This check is deliberately coarse — it asserts that the file which declares the
    // role also handles arrow keys and sets a tabIndex — because the alternative
    // (rendering the component and driving keys) is not available in this suite. It
    // catches the failure mode that actually happened: role present, behaviour absent.
    const probe = (file: string, role: string) => {
      const text = readFileSync(fileURLToPath(new URL(`../src/client/${file}`, import.meta.url)), 'utf8')
      expect(text, `${file} must still declare ${role}`).toContain(role)
      expect(text, `${file} declares ${role} so it must handle arrow keys`).toMatch(/Arrow(Right|Left|Down|Up)/)
      expect(text, `${file} declares ${role} so it needs roving tabindex`).toContain('tabIndex=')
    }
    probe('board/TaskBoard.tsx', 'role="tablist"')
    probe('board/InteractionCard.tsx', "'radiogroup'")
  })

  it('paragraphs carry no inherited spacing inside the board', () => {
    // A `<p>` used as a LAYOUT row kept the UA's 1em margin (an invisible 16px
    // above and below) — the whole 「会话 3 下面一大片空」 gap. Rhythm here is
    // always declared, never inherited.
    expect(source).toMatch(/\[data-dsh-taskboard-view\] p\s*\{\s*\n?\s*margin:\s*0/)
  })

  it('a control beside a text line is centered by a DERIVED offset, not a hand-tuned px', () => {
    // A hand-tuned `margin-top: 3px` here is the right formula's magnitude with
    // the WRONG sign, leaving the 24px pill 6px below the 18px line's center,
    // so the offset is DERIVED.
    const row = ruleOf('sessionHintRow')
    expect(row).toMatch(/margin:\s*0/)
    expect(source).toMatch(/\.sessionHintRow \.sessionToolbarActions\s*\{[^}]*margin-top:\s*calc\(\(var\(--dsh-tb-hint-line\)\s*-\s*var\(--dsh-tb-button-h-sm\)\)\s*\/\s*2\)/)
  })

  // (The review-family contracts — the comments fold default-open at every
  // width with its own capped scroll, the context dock above the composer,
  // and the panel-anchored breakpoints — live in review-page.spec.ts, the
  // owner of the review surface.)
})

describe('session row overlap fix', () => {
  it('the workspace chip shrinks + ellipsizes (never pushes actions over the title)', () => {
    const ws = ruleOf('sessionRowWorkspace')
    expect(ws).toMatch(/flex:\s*0 1 auto/)
    expect(ws).toMatch(/min-width:\s*0/)
    expect(ws).toMatch(/text-overflow:\s*ellipsis/)
  })

  it('compact session rows: actions ride the TITLE line, the pill is content-width', () => {
    // The action cluster aligns to the TOP of its spanning cell so the
    // buttons sit ON the title's line (the 「按钮没和标题同步」 fix), and the
    // identity slot is a NAMED GRID — icon + title share line 1 (the icon is
    // never stranded above the name), the workspace pill takes line 2 at
    // CONTENT width starting on the row's content edge (under the MARK, so
    // mark / pill / chip / meta are one x — a stretched 100% bar under the
    // buttons read as "按钮叠在白条上").
    const compact = blockFrom(line => /@container\s+dsh-tb\s*\(max-width:\s*680px\)/.test(line))
    expect(ruleIn(compact, '.sessionRowTop')).toMatch(/align-items:\s*start/)
    expect(compact).toMatch(/\.sessionRowTop \.sessionRowActions\s*\{[^}]*align-self:\s*start/)
    const leading = ruleIn(compact, '.sessionRowLeading')
    expect(leading).toMatch(/display:\s*grid/)
    expect(leading).toMatch(/grid-template-areas:[\s\S]*"icon name"/)
    expect(leading).toMatch(/"workspace workspace"/)
    expect(compact).toMatch(/\.sessionRowLeading \.sessionRowWorkspace\s*\{[^}]*justify-self:\s*start/)
  })

  it('no row-level unread BADGE — the marker machinery is gone (the glow is a separate mechanism)', () => {
    // The per-row unread marker (overlay dot + halo class) was removed: a row
    // next to an unread card must not repeat the signal with a second MARKER.
    // The row's unread BREATH (data-glow='unread', one halo with the live
    // states) is a different mechanism — a state light, not a badge — and the
    // row geometry still derives from the declared line box (no magic px on
    // an inherited `normal` line height).
    expect(source).not.toMatch(/\.attentionDot\s*\{/)
    expect(source).toMatch(/--dsh-tb-row-line:/)
    expect(ruleOf('sessionRowLeading')).toMatch(/line-height:\s*var\(--dsh-tb-row-line\)/)
  })

  it('the detail title and the workbench tab labels are shrinkable', () => {
    // The detail's title and the bar's destination labels are the two places a
    // long name meets a fixed neighbour (the close button / the exit). Both
    // ellipsize instead of pushing it away.
    expect(ruleOf('detailTitle')).toMatch(/min-width:\s*0/)
    expect(ruleOf('workbenchTabLabel')).toMatch(/min-inline-size:\s*0/)
  })
})

describe('button geometry (one base for every variant)', () => {
  it('the danger-ghost variant rides the SHARED button base (pill + row height)', () => {
    // The square, off-height 「删除」 was this variant missing from the base
    // rule (browser-default geometry). Every variant now shares height,
    // padding, radius and the flex row.
    const base = blockFrom(line => line.trim() === '.primaryButton,')
    expect(base).toMatch(/\.dangerGhostButton\s*\{/)
    expect(base).toMatch(/height:\s*var\(--dsh-tb-button-h\)/)
    expect(base).toMatch(/border-radius:\s*var\(--dsh-tb-button-radius\)/)
  })

  it('height MEANS outer height on the row controls (border-box, no 2px drift)', () => {
    // Content-box made every bordered 28px control really 30 (search 30 vs
    // cruise 28 never agreed; every clearance formula silently lost 2px).
    const base = blockFrom(line => line.trim() === '.primaryButton,')
    expect(base).toMatch(/box-sizing:\s*border-box/)
    for (const name of ['buttonSm', 'columnTab', 'searchField']) {
      expect(ruleOf(name), `.${name} missing`).toMatch(/box-sizing:\s*border-box/)
    }
  })

  it('buttons stay dainty like the reference (13px on 0 14px, never widened back)', () => {
    // Roundness feel is the aspect ratio, not the radius (already clamped to
    // the semicircle): the 0 18px widening read squarer and was reverted.
    const base = blockFrom(line => line.trim() === '.primaryButton,')
    expect(base).toMatch(/padding:\s*0 14px/)
    expect(base).toMatch(/font-size:\s*var\(--dsh-tb-type-body-size\)/)
    expect(base).toMatch(/height:\s*var\(--dsh-tb-button-h\)/)
  })

  it('the quiet ghost track stays one step smaller (12px on 0 12px, reference parity)', () => {
    // The reference runs two type scales (primary 13px, ghost 12px): the small
    // quiet pill reads round where the wide one reads square-arc.
    expect(ruleOf('ghostButton')).toMatch(/font-size:\s*12px/)
    expect(ruleOf('ghostButton')).toMatch(/padding:\s*0 12px/)
    // NOTE: ruleOf('dangerGhostButton') would land on the shared base selector
    // list (its last line reads `.dangerGhostButton {`), so anchor on the
    // variant's own comment instead.
    const dangerGhost = blockFrom(line => line.includes('Row-level destructive'))
    expect(dangerGhost).toMatch(/font-size:\s*12px/)
    expect(dangerGhost).toMatch(/padding:\s*0 12px/)
  })

  it('a quiet button is a FILLED chip like the tabs (a hollow pill reads as a frame)', () => {
    // Measured on a real phone: the mode-button pill was geometrically perfect
    // (corner arc 41px on a 94px-tall button) yet still read 「方的」 because a
    // transparent pill's only ink is its outline. The quiet family therefore
    // carries the SAME filled-chrome grammar as .columnTab / .search — one
    // chip language, no second hollow variant:
    const ghost = ruleOf('ghostButton')
    expect(ghost).not.toMatch(/background:\s*transparent/)
    // ONE fill for the whole quiet family, and it is the LADDER's inlay plane: a
    // host-supplied face (the shell's opaque white) does not move with the page,
    // which is exactly why 整理/自动化/动态/检查更新 read as a different family
    // from the field beside them under a skin (「跟其他按钮都不一样」).
    expect(ghost).toMatch(/background:\s*var\(--dsh-tb-chip-fill\)/)
    expect(ghost).toMatch(/border:\s*var\(--dsh-tb-border\)/)
    // The token itself resolves to the ladder, and every member of the family
    // consumes it — the labels the user compared must not drift.
    expect(source).toMatch(/--dsh-tb-chip-fill:\s*var\(--dsh-tb-plane-inlay\)/)
    expect(source).toMatch(/--dsh-tb-input-bg:\s*var\(--dsh-tb-chip-fill\)/)
    for (const name of ['searchField', 'columnTab', 'chipFill']) {
      expect(ruleOf(name), `.${name} must consume the shared chip fill`).toContain('var(--dsh-tb-chip-fill)')
    }
    // The field is the same family, from the same ladder.
    expect(ruleOf('searchField')).toContain('var(--dsh-tb-chip-fill)')
    // No member of the family may go back to the private layer token.
    for (const name of ['ghostButton', 'searchField', 'columnTab', 'chipFill']) {
      expect(ruleOf(name), `.${name} must not use the private layer fill`).not.toContain('--dsh-tb-surface-sunken')
    }
    // The tool row's own icon member takes the same surface, and it must be
    // declared AFTER the .iconButton BASE (the one that sets `background:
    // transparent; border: none`) or the chip never wins the cascade — the
    // exact way this one stayed bare.
    const bell = source.indexOf('.boardModes .notifyBell {')
    const iconBase = source.indexOf('background: transparent;\n  border: none;')
    expect(bell).toBeGreaterThan(iconBase)
    expect(source.slice(bell, source.indexOf('}', bell))).toContain('var(--dsh-tb-chip-fill)')

    // THE OUTCOME, WHICH THE CASCADE GATE ABOVE CANNOT SEE. Asserting that the
    // rule comes later proves the chip fill wins; it says nothing about SIZE, and
    // the bell measured 30×30 against five 28px siblings — one pixel proud above
    // and below, which reads as a control dropped in rather than one placed.
    //
    // The cause was a dead declaration: `.notifyBell` declared 28×28 near the top
    // of a 7500-line sheet, and `.iconButton` declares 30×30 about 1700 lines
    // later at the SAME specificity, so the later one won and the 28 was
    // decorative. So the size is stated in the rule that already exists to beat
    // `.iconButton`, from the shared token — one number, and a sibling that
    // changes the control height moves the bell with it.
    const bellRule = source.slice(bell, source.indexOf('}', bell))
    expect(bellRule, 'the bell declares no size, so .iconButton decides it and it stands 1px proud of its five siblings')
      .toMatch(/inline-size:\s*var\(--dsh-tb-button-h\)/)
    expect(bellRule, 'the bell declares no height, so it is 30x30 while every sibling is 28x28')
      .toMatch(/block-size:\s*var\(--dsh-tb-button-h\)/)
  })

  it('the compact column header is declared ONCE (no dead second padding)', () => {
    // Two competing paddings lived in the same compact block (12px 20px with
    // the contract comment, then a bare 10px 12px that won) — the top-rhythm
    // churn behind conflicting reports. One declaration survives.
    const compact = blockFrom(line => /@container\s+dsh-tb\s*\(max-width:\s*680px\)/.test(line))
    expect(compact.match(/\.columnHeader\s*\{/g) ?? []).toHaveLength(1)
    // The compact head shares the BASE rule's inline sides — the header and the
    // cards under it are one alignment — so this is the same calc spelled with
    // the compact block's own vertical padding, not a second number to drift.
    expect(ruleIn(compact, '.columnHeader')).toMatch(/padding:\s*12px 20px 12px calc\(var\(--column-frame\)/)
  })

  it('the button radius token IS the pill (true round at every height)', () => {
    // 22px only covers the 28px row; beside 999px pills (search/cruise/
    // columnTab) it reads as 「方形圆弧」. The token is the single truth so
    // 34px preset rows and the 44px touch floor stay semicircular too.
    expect(source).toMatch(/--dsh-tb-button-radius:\s*(var\(--dsh-tb-pill\)|999px)/)
    expect(source).toMatch(/--dsh-tb-pill:\s*999px/)
  })

  it('every button-family member is a pill, never sm/md (no omissions)', () => {
    // Full census: core Button variants ride the shared base above; every
    // other clickable button lists here explicitly so a future square-arc
    // addition fails the build instead of shipping beside the pills.
    // (Inputs/selects/panels/cards are NOT in this list — see the next test.)
    for (const name of [
      'buttonSm',
      'iconButton',
      'cruisePill',
      'cruiseMore',
      'columnTab',
      'feedAction',
      'searchField',
      'cardQuickRun',
      'columnCount',
      'notifyBadge',
      'segmentedButton',
      'timeFieldCalendar',
      'attachAdd',
      'attachChip',
    ]) {
      const rule = ruleOf(name)
      expect(rule, `.${name} missing`).not.toBe('')
      expect(rule, `.${name} must be pill`).toMatch(/border-radius:\s*(var\(--dsh-tb-pill\)|999px|50%)/)
      expect(rule, `.${name} must not use sm/md`).not.toMatch(/border-radius:\s*var\(--dsh-tb-radius-(sm|md|lg|xl)\)/)
    }
  })

  it('non-buttons keep the stepped ladder (pill must not leak into containers)', () => {
    // Over-rounding is the mirror bug: cards/columns/panels/inputs stay on
    // sm/md/lg/xl so a button fix never turns the whole board into bubbles.
    /* `segmentedRow` 不在这张名单上，理由是形状而不是宽容：它是**装着若干胶囊的
     * 一条轨道**，圆角必须与里面的胶囊一致（都是 pill），否则轨道两端的半圆与第一
     * 枚胶囊的半圆不同心，读起来像两个不同的控件叠在一起。它属于上面那一族。 */
    for (const [name, ladder] of [
      ['card', 'md'],
      ['column', 'lg'],
      ['input', 'md'],
      ['schedulePreset', 'md'],
      ['cruiseLimit', 'sm'],
    ] as const) {
      const rule = ruleOf(name)
      expect(rule, `.${name} missing`).not.toBe('')
      expect(rule, `.${name} must stay ${ladder}`).toMatch(new RegExp(`border-radius:\\s*var\\(--dsh-tb-radius-${ladder}\\)`))
    }
    for (const panel of ['modal', 'detail', 'review']) {
      expect(ruleOf(panel), `.${panel} missing`).not.toBe('')
    }
    const chrome = /* 顶层的那一条：.modal 在 @media 里也有一条（reduced motion 的 animation:none），
       trim 过的比较会先命中缩进的那一条。chrome 是顶层规则，所以按列位匹配。 */
    blockFrom(line => line === '.modal {')
    expect(chrome).toMatch(/border-radius:\s*var\(--dsh-tb-radius-xl\)/)
  })
})

describe('corner geometry (true circles, never rounded squares)', () => {
  /* radius and SHAPE are two different axes: `border-radius` decides how big a
     corner is, `corner-shape` decides whether that corner is a circular ARC.
     Only the second one can turn an 8px 50% dot or a 999px pill into a rounded
     square, and it is NOT inherited (A value on a parent box leaves every child
     at the initial value — reproducible in the browser, see the probe below).
     So it must be stated for the whole subtree in ONE zero-specificity rule:
     per-element declarations are the drift-prone answer, and a root-only
     declaration does nothing at all.
     History: the 「圆变方」 family came back after every previous radius-only
     pass because those passes only ever changed radius VALUES — and these very
     tests asserted those values, so the geometry was never covered. */

  // Found by the rule's own unique declaration (one line, like every other
  // rule-hunting helper in this file).
  const rule = blockFrom(line => line.includes('corner-shape: var(--dsh-tb-corner, round)'))
  const selector = (() => {
    const at = source.indexOf(rule)
    return at < 0 ? '' : source.slice(source.lastIndexOf('}', at) + 1, at).trim()
  })()

  it('one rule states the corner shape for the whole board surface', () => {
    expect(rule, 'the corner-shape rule is missing').not.toBe('')
    const body = withoutComments(rule)
    expect(selector, 'must cover the board root').toContain('[data-dsh-taskboard-view]')
    // `*[class]`, not a bare `*`: the class qualifier is what raises the
    // specificity above `[data-dsh-taskboard-view] *`, which measured EQUAL to a
    // class-level leak (both 0,2,0). With `!important` on both sides the tie is
    // decided by specificity, so the bare form loses and the dots stay square.
    expect(selector, 'must cover every widget the board renders').toContain('[data-dsh-taskboard-view] *[class]')
    expect(selector, 'must cover the panel surface too').toContain('[data-dsh-taskboard-panel]')
    // Specificity would be a guess about a stylesheet the board does not
    // control: measured, a class-level leak on the same elements beats this
    // rule without the marker, and the dots stay square. The escape door for a
    // skin is the token, not a weaker declaration.
    expect(body, 'must win against an unknown leak').toMatch(/corner-shape:\s*var\(--dsh-tb-corner,\s*round\)\s*!important/)
    expect(body, 'must ride the corner-family switch').toMatch(/corner-shape:\s*var\(--dsh-tb-corner,\s*round\)/)
  })

  it('it is the ONLY shape declaration, and the switch has ONE definition', () => {
    expect((source.match(/(^|\s)corner-shape\s*:/g) ?? []).length, 'exactly one corner-shape declaration').toBe(1)
    expect((source.match(/--dsh-tb-corner\s*:/g) ?? []).length, 'exactly one corner-family definition').toBe(1)
    expect(withoutComments(source)).toMatch(/--dsh-tb-corner:\s*round/)
  })

  it('the true circles keep being circles by radius', () => {
    // The rule above supplies the SHAPE; these rules keep supplying the radius.
    // A future edit that "fixes roundness" by swapping 50% for a px radius
    // fails here instead of shipping rounded rectangles.
    for (const name of [
      'statusDot',
      'cardColorMark',
      'cardSessionDot',
      'cardWorkspaceDot',
      'boardStatusDot',
      'boardDemandDot',
      'switchKnob',
      'notifyDot',
    ]) {
      const widget = ruleOf(name)
      expect(widget, `.${name} missing`).not.toBe('')
      expect(widget, `.${name} must stay a true circle`).toMatch(/border-radius:\s*50%/)
    }
    expect(ruleOf('switchTrack')).toMatch(/border-radius:\s*var\(--dsh-tb-pill\)/)
  })

  it('the shipped bundle carries it (a source-only fix cannot ship)', () => {
    const bundle = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
    expect(bundle, 'lib/client.js must be rebuilt and committed').toContain('--dsh-tb-corner:round')
    expect(bundle).toContain('corner-shape:var(--dsh-tb-corner,round)')
  })
})

describe('section entry buttons (hint row for the session area, action slot for the rules)', () => {
  it('the session area buttons ride the HINT row; the rules section keeps the Section action slot', () => {
    // The session area: 「添加会话 / 新建会话」 sit on the HINT row's right —
    // ONE horizontal plane with "状态为该次执行自身的结果" (the user's ask) —
    // never wedged between a title and its own explanation.
    const detailPath = fileURLToPath(new URL('../src/client/board/TaskDetail.tsx', import.meta.url))
    const detail = readFileSync(detailPath, 'utf8')
    expect(detail).toMatch(/sessionHintRow[\s\S]*?sessionToolbarActions/)
    expect(detail).not.toMatch(/action=\{[\s\S]*?sessionToolbarActions/)
    expect(detail).not.toMatch(/className=\{css\.sessionToolbar\}/)
    // The rules section keeps its add button in the Section action slot.
    const autoPath = fileURLToPath(new URL('../src/client/board/automation-ui.tsx', import.meta.url))
    const auto = readFileSync(autoPath, 'utf8')
    expect(auto).toMatch(/<Section[\s\S]*?action=\{formKey === undefined/)
  })
})

describe('composer under the soft keyboard (no row overlap)', () => {
  it('no composer child shrinks below its content', () => {
    // The composer is a height-constrained flex column when the keyboard
    // shrinks the panel. A shrinking child is the overlap: the attachment
    // strip collapsed to its 24px floor while its wrapped second line
    // overflowed onto the send row (「排队/插话 和图片重叠」). flex:none on
    // every child makes rows keep their real height and stack, never collide.
    const guard = blockFrom(line => line.trim() === '.reviewComposer > * {')
    expect(guard).toMatch(/flex:\s*none/)
  })
  it('the attachment strip keeps its chips on one scrollable line, and its sentences out of it', () => {
    // 芯片那一行是**一条横滚行**：换行的芯片与键盘上方的发送行打架，所以它不折行、横向滚。
    // 断言读 `attachRow`——那是**真正装芯片的那个盒子**。
    const row = ruleOf('attachRow')
    expect(row).toMatch(/flex-wrap:\s*nowrap/)
    expect(row).toMatch(/overflow-x:\s*auto/)
    /* 而**句子与芯片同排是可以的，被压成一根竖条不可以**。这一条是量出来的：412 上，
       「随这一条保存；变成卡片时一起过去」与两枚芯片、「＋」同排时，被压成**一个字一行**
       的竖条（`flex-shrink` 的默认值 1 加上中文的换行机会），读者看到的是十一行单字。
       所以这里钉的是**让位的机制**，不是某一种排版：整条可换行（装不下就整句落到下一行），
       芯片那一行吃掉余下的空位，而句子带一条**宽度地板**——地板是那个竖条唯一的挡板，
       少了它，`flex-shrink` 的默认值 1 就会把句子重新压回去。 */
    const strip = ruleOf('attachStrip')
    expect(strip, '句子与芯片排不进一行时无处可去——这一条不是可换行的行').toMatch(/flex-wrap:\s*wrap/)
    expect(strip, '滚动的那个盒子回到了整条 strip 上——句子又会被拉进那条横滚行').not.toMatch(/overflow-x/)
    /* 地板是这一条唯一承重的那半：`min-inline-size` 不是装饰，它挡的正是上面那个竖条。
       `flex-grow` 归谁、句子落在左端还是右端是**排版的自由**，这里不钉——钉住它会让下一个人
       为了改一个观感而被迫删掉一条关于缺陷的门禁。 */
    const hint = ruleOf('attachHint')
    expect(hint, '那句说明没有宽度地板——它又会被压成一个字一行的竖条').toMatch(/min-inline-size:\s*min\(/)
    // 结构那一半：那两个句子必须是 `.attachStrip` 的**直接子级**，不在 `.attachRow` 里。
    const tsx = readFileSync(fileURLToPath(new URL('../src/client/design/AttachmentStrip.tsx', import.meta.url)), 'utf8')
    const rowBlock = /<div className=\{css\.attachRow\}>([\s\S]*?)\n {6}<\/div>/.exec(tsx)?.[1] ?? ''
    expect(rowBlock, '找不到 `.attachRow` 那一段——这个检查扫不到东西').toContain('attachChip')
    for (const line of ['attachHint', 'attachError']) {
      expect(rowBlock, `${line} 被放回了横向滚动那一行里`).not.toContain(line)
    }
  })
  it('attachment chips keep their width so the strip scrolls instead of squeezing', () => {
    expect(ruleOf('attachChip')).toMatch(/flex:\s*none/)
    expect(ruleOf('attachAdd')).toMatch(/flex:\s*none/)
  })
})

describe('no raw color literals leak in (design-system rule)', () => {
  it('the whole sheet stays token-fed: no hex/rgb color literals', () => {
    // The board's hard rule: colors ride --dsw-*/--dsh-tb-* tokens only.
    //
    // 判据只读**结构**，不读字样（硬性规范 14）：注释里写出一个 hex，不是这张表画了
    // 一种颜色。这条原先对着整份源码匹配，于是它逮住的是「解释浏览器默认占位符色在
    // 深色下值多少」的那句注解——一个不看上下文的检查器会逼着人把那句解释改糊。先剥
    // 注释再匹配，力度一点没少：声明里真写了 hex 照样红。
    const live = source.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(live).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(live).not.toMatch(/rgba?\(\s*\d/)
  })

  it('the unseen arrival dot is static and token-fed (no second breathing source)', () => {
    const dot = ruleOf('notifyDot')
    expect(dot).toContain('--dsh-tb-attention')
    expect(dot).not.toMatch(/animation|transition/)
  })

  it('the arrival ping is a one-shot tense on the same dot (same tone, breath tokens, reduced-motion safe)', () => {
    // The dot says "something is new" (static); the ping tenses it to "JUST
    // arrived" — same element, same attention tone, never a second signal.
    // One-shot (iteration count 1), so a landed fact rests as the dot instead
    // of looping forever; reduced-motion replays it slower, never zeroes it
    // (it IS the arrival tense, same law as the breath lights).
    const pulse = ruleOf('notifyPulse')
    expect(pulse).toContain('dshTbNotifyPing')
    expect(pulse).toMatch(/animation:[^;]*\b1\b/)
    expect(source).toMatch(/@keyframes dshTbNotifyPing\s*\{[\s\S]*?var\(--dsh-tb-attention/)
    // The demand row flashes the same tense while the board stays open (the
    // bell alone is behind a tap): one-shot halo, attention tone, resting
    // back to the static row. Anchored on the attribute selector (the static
    // `.boardDemand` rule never animates — the flash is the tense, not the row).
    // blockWith answers with the ENCLOSING block, so match the attribute
    // inside it rather than demanding the exact selector text.
    const demandFresh = blockWith(/dshTbDemandFlash/)
    expect(demandFresh, 'the demand flash must be anchored on the fresh state').toContain('.boardDemand[data-fresh]')
    expect(source).toMatch(/@keyframes dshTbDemandFlash\s*\{[\s\S]*?var\(--dsh-tb-attention/)
    // The waiting-row excerpt is a second-line scan slot inside the wrapping
    // row: full-width by line (让位), clamped, QUIETER INK than the row's title,
    // unbreakable-safe.
    //
    // The ink is tier 2, not tier 3. Tier 3 is the host's --dsw-alias-label-tertiary`n    // (#81858c, 3.7:1) and this is a line of real text a reader scans — below AA,
    // so it moved up. What the claim needs is that it is a STEP BELOW the title,
    // and tier 2 is that step.
    const excerpt = ruleOf('notifyExcerpt')
    expect(excerpt).toContain('flex: 1 1 100%')
    expect(excerpt).toContain('-webkit-line-clamp: 2')
    expect(excerpt, 'the excerpt must stay a step quieter than the row title').toContain('var(--dsh-tb-text-2)')
    expect(excerpt).toContain('overflow-wrap: anywhere')
  })
})

describe('column tab math', () => {
  it('the column nearest the scroll position owns the tab', () => {
    expect(activeColumnIndexAt(0, [0, 240, 480, 720, 960])).toBe(0)
    expect(activeColumnIndexAt(480, [0, 240, 480, 720, 960])).toBe(2)
    expect(activeColumnIndexAt(599, [0, 240, 480, 720, 960])).toBe(2)
    expect(activeColumnIndexAt(601, [0, 240, 480, 720, 960])).toBe(3)
    // Overscroll at either end clamps to the first/last column.
    expect(activeColumnIndexAt(5000, [0, 240, 480])).toBe(2)
  })

  it('the inverse aims at the left edge of a column and stays inside the track', () => {
    // Column identity is the truth; the pixel value is always derived — tab
    // jumps and container-resize re-anchoring share this one function, so the
    // board cannot "shift right a little" per sidebar toggle anymore.
    expect(scrollLeftForColumn(2, [0, 240, 480, 720, 960], 500, 1400)).toBe(480)
    // Clamped to the scrollable range (the last columns can never overscroll).
    expect(scrollLeftForColumn(4, [0, 240, 480, 720, 960], 500, 1400)).toBe(900)
    expect(scrollLeftForColumn(-1, [0, 240], 500, 1400)).toBe(0)
    expect(scrollLeftForColumn(0, [], 500, 1400)).toBe(0)
  })
})

describe('keyboard inset math', () => {
  it('reports the keyboard height once it clears the toolbar noise floor', () => {
    expect(keyboardOverlapPx(800, 500, 0)).toBe(300) // a real keyboard
    expect(keyboardOverlapPx(800, 740, 0)).toBe(0)   // the dynamic toolbar (~60px)
    expect(keyboardOverlapPx(800, 800, 0)).toBe(0)   // nothing open
    expect(keyboardOverlapPx(800, 650, 60)).toBe(0)  // 90px below the floor: toolbar noise, not a keyboard
    expect(keyboardOverlapPx(800, 460, 40)).toBe(300) // keyboard below a hidden toolbar
  })
})

describe('reduced-motion functional exemption', () => {
  // EVERY reduced-motion block, not the last one.
  //
  // There are three in this sheet, and the old reader took `lastIndexOf` — so it
  // read one of them and called it the block. That has two failure directions
  // and both of them are wrong in a way nobody can see: a block that is not the
  // last is invisible (a component that adds its own reduced-motion block for
  // its own thing is never read), and a block APPENDED at the end silently
  // becomes the one everything is asserted against, which turns these five
  // tests red on a correct sheet the day a new component needs a block of its
  // own. The question each of these asks is 「does the policy hold somewhere
  // under this query」, and that is a question about ALL of them.
  const REDUCED = '@media (prefers-reduced-motion: reduce) {'
  const reducedBlocks = allBlocksOf(REDUCED)
  expect(
    reducedBlocks.length,
    'the board sheet has no reduced-motion block at all — motion preference is honoured nowhere',
  ).toBeGreaterThan(0)
  /**
   * Whether ANY ONE block says this — and only ever within a single block.
   *
   * The per-block form matters for the negatives: joining the blocks into one
   * string and matching across the seam would pair a selector named in one
   * block with a declaration in the next, which is a finding about no rule at
   * all, and it is exactly the kind of wrong that deletes a correct rule.
   */
  const inAnyBlock = (pattern: RegExp): boolean => reducedBlocks.some(block => pattern.test(block))

  it('the spinner keeps animating (only calmer) under reduced motion', () => {
    expect(inAnyBlock(/\.spinner\s*\{\s*\n?\s*animation-duration:\s*[\d.]+s/)).toBe(true)
    expect(inAnyBlock(/\.spinner\s*\{\s*\n?\s*animation:\s*none/)).toBe(false)
  })

  it('the breathing RING also survives — it is a state message, not decoration', () => {
    // A still ring reads as "stuck" (the opposite of "running") and cannot be
    // told apart from a finished-and-unread card, so the ring joins the
    // spinner's exemption: slower and gentler, never `animation: none`.
    //
    // THE TWO NEGATIVES BELOW USED TO NAME SELECTORS THAT APPEAR IN NO BLOCK AT
    // ALL, so they could not fail: the block under `lastIndexOf` is the policy
    // one, and it says nothing about `.card[data-light]` or `.sessionRow::after`.
    // Read over every block they become the claim they were always meant to be
    // — no block may silence a state message — and the subjects really are
    // stylesheet rules, so a block that silenced one would now be caught.
    expect(inAnyBlock(/\.card\[data-light=[^\]]+\][\s\S]{0,80}animation:\s*none/)).toBe(false)
    expect(inAnyBlock(/\.sessionRow::after\s*\{\s*\n?\s*animation:\s*none/)).toBe(false)
    expect(inAnyBlock(/\.notifyPulse\s*\{[\s\S]{0,80}animation:\s*none/)).toBe(false)
    expect(inAnyBlock(/\.notifyPulse\s*\{[\s\S]*?animation-duration:/)).toBe(true)
    // The amplitude lives in tokens, which is how the pulse is softened
    // instead of deleted.
    expect(inAnyBlock(/--dsh-tb-breath:\s*[\d.]+s/)).toBe(true)
    expect(inAnyBlock(/--dsh-tb-breath-spread:/)).toBe(true)
    expect(source).toMatch(/@keyframes dshTbBreathRing\s*\{[\s\S]*?var\(--dsh-tb-breath-spread\)/)
  })

  it('decorative entrance motion is still suppressed', () => {
    expect(inAnyBlock(/\.modalBackdrop[\s\S]*?animation:\s*none/)).toBe(true)
  })

  it('the reader sees a block that is not the last, and a block that silences a state message', () => {
    // Both shapes that broke the old reader, on sheets it cannot have been
    // tuned against. The first is the trap this whole describe was living in:
    // append a block for a new component and `lastIndexOf` moves the goalposts
    // without anyone deciding to move them.
    const notLast = allBlocksOf(REDUCED, `${REDUCED}\n  .thingNew { animation: none; }\n}\n.unrelated { color: red; }\n${REDUCED}\n  .spinner { animation-duration: 1.4s; }\n}\n`)
    expect(
      notLast.some(block => /\.spinner\s*\{\s*\n?\s*animation-duration:/.test(block)),
      'the reader cannot see a policy block that is not the last one',
    ).toBe(true)
    // And the shape the two negatives could not see at all: a block that
    // silences the row halo.
    const silencing = allBlocksOf(REDUCED, `${REDUCED}\n  .sessionRow::after { animation: none; }\n}\n`)
    expect(
      silencing.some(block => /\.sessionRow::after\s*\{\s*\n?\s*animation:\s*none/.test(block)),
      'a state message silenced in a block is invisible to the reader, so the negative can never fire',
    ).toBe(true)
  })

  it('the entrance grammar is ONE keyframes, joined — never a second family', () => {
    // A family of entrance animations minted one keyframes per surface (fade-up
    // here, dialog-in there, a staggered row entrance somewhere else) is three
    // names for one idea, each with its own timing, stacking into a stagger of
    // staggers. One family means: the board owns `dshTbBoardIn`, the overlay
    // family owns `dshTbDialogIn` (scale = depth, a different meaning), and a
    // pure fade owns `dshTbFadeIn`. Nothing else animates a mount.
    for (const name of ['dshTbBoardIn', 'dshTbDialogIn', 'dshTbFadeIn']) {
      expect(source).toContain(`@keyframes ${name}`)
    }
    expect(source).not.toContain('@keyframes dshTbFadeUp')
    expect(source).not.toContain('@keyframes dshTbSelectIn')
    expect(source).not.toMatch(/animation-delay:\s*\d+ms/)
  })

  it('a newcomer arrives once from structure, never from a re-render', () => {
    // The FLIP hook stamps cards absent from its previous snapshot with
    // `data-fresh`; the CSS reveals exactly those once. A class or a bare
    // re-mount animation would replay on every re-render of an old card.
    expect(source).toMatch(/\.card\[data-fresh\]\s*\{[^}]*animation:\s*dshTbBoardIn/)
    const flipPath = fileURLToPath(new URL('../src/client/board/use-flip.ts', import.meta.url))
    const flip = readFileSync(flipPath, 'utf8')
    expect(flip).toContain("setAttribute('data-fresh', '')")
    expect(flip).toContain("removeAttribute('data-fresh')")
    expect(flip).toContain('requestAnimationFrame')
    // The stamp lives exactly one frame batch beside the candidate loop that
    // already knows newcomers are not FLIP-eligible (no old rect to play
    // from) — one structural filter, not two mechanisms disagreeing.
    expect(flip).toContain('flipCandidatesOf(previousStructures.current, structures)')
  })
})

describe('template library wiring', () => {
  it('new-task modal stamps from the library; detail saves into it (one seam each)', () => {
    // The modal fills its draft from the picked template (editable before
    // creating) and deletes the picked one behind a confirm; the detail
    // snapshots content without leaving the card.
    const modalPath = fileURLToPath(new URL('../src/client/board/NewTaskModal.tsx', import.meta.url))
    const modal = readFileSync(modalPath, 'utf8')
    expect(modal).toContain('listTemplates()')
    expect(modal).toContain('draftFromTemplate(template)')
    expect(modal).toContain('deleteTemplate(pickedId)')
    expect(modal).toContain('ConfirmDialog')
    const detailPath = fileURLToPath(new URL('../src/client/board/TaskDetail.tsx', import.meta.url))
    const detail = readFileSync(detailPath, 'utf8')
    expect(detail).toContain('saveTemplate(current.id)')
    // Templates never carry automation: no schedule/rules field flows into
    // the template shape or the stamped input (the words may appear in
    // comments explaining the exclusion, never as data).
    const corePath = fileURLToPath(new URL('../src/core/task-templates.ts', import.meta.url))
    const core = readFileSync(corePath, 'utf8')
    expect(core).not.toMatch(/schedule\??:/)
    expect(core).not.toMatch(/rules\??:/)
  })

  it('the compact organize bar is three deterministic rows (count never underlaps actions)', () => {
    // 「已选N张被按钮盖住」: count + five wrapping buttons shared one row
    // and the actions column sized to max-content, painting over the count.
    // Areas own a row each now (colors / count / actions) — nothing shares,
    // nothing overlaps, at any selection size.
    const compact = blockFrom(line => /@container\s+dsh-tb\s*\(max-width:\s*680px\)/.test(line))
    expect(ruleIn(compact, '.organizeBar')).toMatch(/grid-template-areas:[\s\S]*"colors"[\s\S]*"count"[\s\S]*"actions"/)
    expect(ruleIn(compact, '.organizeBar')).not.toMatch(/"count actions"/)
  })

  it('compact crowds nothing: the action cluster shares the board content edge', () => {
    // The modes cluster is the whole action row at this width; right-aligning it
    // leaves the left two-thirds void, so it starts on the same x as the
    // search field and the columns below.
    const compact = blockFrom(line => /@container\s+dsh-tb\s*\(max-width:\s*680px\)/.test(line))
    expect(ruleIn(compact, '.boardRowTools .boardModes')).toMatch(/justify-self:\s*start/)
    // The board meets the shell edge-to-edge: separation is a hairline, not
    // air (padding alone never reads as separation against the shell head).
    // Wide is 14 top against 16 sides; compact is 12/12 — the SAME relationship
    // with the OPPOSITE sign in the two bands, which is what makes the narrow
    // board square. No dock token: the thumb bar that spent it is gone.
    expect(ruleIn(compact, '.board')).toMatch(/padding:\s*12px\s+12px\s+calc\(12px\s*\+\s*env\(safe-area-inset-bottom\)\)/)
    expect(ruleIn(compact, '.board')).toMatch(/border-top:\s*var\(--dsh-tb-separator\)/)
    // Column heads own their separation explicitly (12px vertical on narrow
    // glass; the cards' 6px top pad belongs to the drop indicator, never to
    // rhythm). The inline start is COMPUTED from the column's own three numbers
    // — hairline + the cards' gutter + the card's mark rail — so the column name
    // cannot be notched right of every card title under it. A literal stands in
    // for the sum at its peril: 20 and 28 each drop one of those three and put
    // the name 1px, then 8px, off the cards' line, so writing it as the sum is
    // the only spelling that cannot.
    expect(ruleIn(compact, '.columnHeader')).toMatch(/padding:\s*12px 20px 12px calc\(var\(--column-frame\)/)
  })

  it('the narrow rail keeps ONE rhythm (a single gap owns between)', () => {
    // 「间距全都不一样」: 8px row pads + 12px head bottom + hairline + 10px
    // block pads + 14px transcript top stacked ad-hoc. Narrow unifies to one
    // 10px gap (desktop keeps its own rhythm — base rules untouched).
    const compact = blockFrom(line => /@container\s+dsh-tb-panel\s*\(max-width:\s*600px\)/.test(line))
    expect(gapPxIn(ruleIn(compact, '.sessionRailFolds')), 'the narrow rail left the ladder').toBe(10)
    expect(ruleIn(compact, '.sessionRailHead')).toMatch(/padding-bottom:\s*0/)
    expect(ruleIn(compact, '.sessionRailHead')).toMatch(/border-bottom:\s*none/)
    expect(ruleIn(compact, '.reviewMain')).toMatch(/padding:\s*10px 14px/)
  })
})

describe('feed row grammar (notify + activity share one line: give way, never crush)', () => {
  /** TaskBoard.tsx source (the row builders live there). */
  const board = readFileSync(fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url)), 'utf8')

  it('identity floor: the row wraps its action cluster instead of squeezing titles into slivers', () => {
    // The floor is what makes wrapping DETERMINISTIC: [task+session+status]
    // refuses to compress below min(100%, 16rem), so when it cannot sit
    // beside the buttons the buttons move to the next line (硬性规范 11①:
    // 让位, never 压扁). The cap at 100% keeps a phone-width row one full
    // line instead of overflowing.
    expect(ruleOf('notifyMain')).toMatch(/min-width:\s*min\(100%,\s*16rem\)/)
    // Both titles ellipsize at their own floors; the status chip never shrinks.
    expect(ruleOf('notifyTask')).toMatch(/min-width:\s*6em/)
    expect(ruleOf('notifyTask')).toMatch(/text-overflow:\s*ellipsis/)
    expect(ruleOf('notifySession')).toMatch(/min-width:\s*4em/)
    expect(ruleOf('notifySession')).toMatch(/max-width:\s*40%/)
    expect(source).toMatch(/\.notifyMainChip\s*\{[^}]*flex:\s*none/)
  })

  it('every row answers WHEN, on the row\'s RIGHT: a fixed time slot keeps action placement stable', () => {
    expect(ruleOf('notifyMeta')).toMatch(/flex:\s*none/)
    expect(ruleOf('notifyMeta')).toMatch(/min-width:\s*10ch/)
    expect(ruleOf('notifyMeta')).toMatch(/text-align:\s*right/)
    expect(ruleOf('notifyMeta')).toMatch(/font-variant-numeric:\s*tabular-nums/)
    // The slot reserves the full compact-date width, so `21h` and
    // `2026-09-24` cannot make otherwise identical rows wrap differently.
    // The stamp lives ONCE — inside the shared row — and both drawers hand it
    // their moment.
    const feedRowSource = readFileSync(fileURLToPath(new URL('../src/client/board/FeedRow.tsx', import.meta.url)), 'utf8')
    const actionsAt = feedRowSource.indexOf('css.notifyActions')
    expect(actionsAt).toBeGreaterThan(-1)
    expect(feedRowSource.slice(actionsAt)).toContain('css.notifyMeta}>{time}')
    expect(board).toContain('time={formatTime(note.at)}')
    expect(board).toContain('time={formatTime(item.at)}')
    // The action line's own left edge is the row's left edge: the buttons
    // lead and the stamp trails, with the row carrying the gap. A stamp that
    // LEADS the cluster inside its reserved slot pushes the buttons a whole
    // slot right and opens a hole under the task name.
    const line = feedRowSource.slice(actionsAt)
    expect(line.indexOf('css.notifyActionCluster')).toBeLessThan(line.indexOf('css.notifyMeta'))
    expect(ruleOf('notifyActions')).toMatch(/justify-content:\s*space-between/)
    expect(ruleOf('notifyActions')).toMatch(/width:\s*100%/)
    expect(ruleOf('notifyActionCluster')).toMatch(/flex-wrap:\s*wrap/)
  })

  it('ONE row skeleton serves both drawers: [task][session][status] …… [time][actions], no aria-label', () => {
    // 「排版各搞一块」根治的结构保证：身份槽顺序、时间戳、动作簇只住在
    // FeedRow 里；两个抽屉都渲染它，谁也不许再手拼一行。
    const feedRow = readFileSync(fileURLToPath(new URL('../src/client/board/FeedRow.tsx', import.meta.url)), 'utf8')
    expect(feedRow.indexOf('css.notifyTask')).toBeGreaterThan(-1)
    expect(feedRow.indexOf('css.notifyTask')).toBeLessThan(feedRow.indexOf('css.notifySession'))
    expect(feedRow.indexOf('css.notifySession')).toBeLessThan(feedRow.indexOf('<Chip'))
    // The skeleton carries NO aria-label — the row's accessible name IS its
    // content (titles, session, status, excerpt); an overriding label would
    // silence exactly the parts users asked to see.
    expect(feedRow).not.toContain('aria-label=')
    const notifySlice = board.slice(board.indexOf('const renderNotifyRow'), board.indexOf('return visibleNotes.map(renderNotifyRow)'))
    const activitySlice = board.slice(board.indexOf('const renderActivityRow'), board.indexOf('const renderFold'))
    expect(notifySlice).toContain('<FeedRow')
    expect(activitySlice).toContain('<FeedRow')
    // ……and neither drawer hand-rolls the identity slots anymore.
    expect(notifySlice).not.toContain('css.notifyTask')
    expect(notifySlice).not.toContain('css.notifySession')
    expect(activitySlice).not.toContain('css.notifyTask')
    expect(activitySlice).not.toContain('css.notifySession')
  })

  it('the old fold machinery stays dead; the NEW task-fold machinery is wired', () => {
    const notifications = readFileSync(fileURLToPath(new URL('../src/client/board/notifications.ts', import.meta.url)), 'utf8')
    const activity = readFileSync(fileURLToPath(new URL('../src/client/board/activity.ts', import.meta.url)), 'utf8')
    for (const dead of [
      'expandedFoldKey', 'foldNotesByTask', 'snoozed', 'splitGroupItems',
      'remainderKeyOf', 'groupActivityByObjectDay', 'activityGroupKeyOf', 'notificationsOf',
    ]) {
      expect(board.includes(dead) || notifications.includes(dead) || activity.includes(dead), `"${dead}" must not survive`).toBe(false)
    }
    // The activity drawer folds by TASK × DAY again (the user-decided shape),
    // sections by session, caps with a remainder — one constructor each.
    expect(board).toContain('foldFeedByTaskDay')
    expect(board).toContain('sectionFoldBySession')
    expect(board).toContain('splitFoldItems')
    expect(board).toContain('activityFoldKeyOf(')
    expect(activity).toContain('foldRestKeyOf(')
    // The bell badge counts ROWS — the exact unit the drawer opens to.
    expect(board).toContain('const total = notes.length')
  })

  it('the session section header DRESSES as a header (the 「分不清哪个是标题」 root)', () => {
    // The fold head carries the task, the section header carries the session,
    // and every row below ALSO prints the session name inline — at the SAME
    // 12px/secondary spec the header wore, title and content were visually
    // identical. The header now differs on all three axes at once: weight,
    // ink tier, and a hairline above that starts the group. The size stays
    // 12px (hard rule 11: no shrinking type; the distinction is never made by
    // hiding or shrinking anything).
    const section = ruleOf('feedSection')
    expect(section).toMatch(/font-size:\s*12px/)
    expect(section).toMatch(/font-weight:\s*600/)
    expect(section).toMatch(/color:\s*var\(--dsh-tb-text-1\)/)
    // The hairline is read from the layer (`--dsh-tb-border-soft`), not typed as
    // a literal: a hand-written `1px solid` here was a second, invisible edge
    // token that no skin could move. Either form passes — the assertion is
    // 「there is a hairline above」, not 「it is spelled this way」.
    expect(section).toMatch(/border-top:\s*(?:1px solid|var\(--dsh-tb-border-soft\))/)
    // It stays a quiet label: ellipsis for long session names, never a control.
    expect(section).toContain('text-overflow: ellipsis')
    expect(section).toContain('white-space: nowrap')
  })

  it('the row status word comes from ONE table; both dictionaries carry every state', () => {
    expect(board).toContain('noteStatusShapeOf(note)')
    // The board resolves the KEY at the call site; FeedRow renders the word.
    expect(board).toContain('label: t(status.label)')
    const feedRow = readFileSync(fileURLToPath(new URL('../src/client/board/FeedRow.tsx', import.meta.url)), 'utf8')
    expect(feedRow).toContain('status.label')
    const locales = readFileSync(fileURLToPath(new URL('../src/client/locales.ts', import.meta.url)), 'utf8')
    expect(locales.match(/'board\.notifyReviewFailed':/g), 'the decision word exists in both languages').toHaveLength(2)
    expect(locales.match(/'card\.dotUnread':/g), 'dot unread copy exists in both languages').toHaveLength(2)
    // A CANCELLED run has no row to word: the drawer's review tier is gated on
    // the human gate, and an abort is not something a person rules on. The
    // word was removed rather than left unreachable, so it must not come back
    // as a third "decision" state beside 待审核 / 待决策.
    expect(locales).not.toMatch(/'board\.notifyCancelled':/)
    // The task fold's remainder line ships its copy in both languages too
    // (the feature returned with a user; only its OLD names are banned above).
    expect(locales.match(/'board\.activityGroupRest':/g)).toHaveLength(2)
  })
})

describe('content-box family + interaction-card containment (the desktop truncation roots)', () => {
  /** Every rule block (selector tail + body) in the sheet. */
  const rules = [...source.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(match => ({
    selectors: match[1].trim().split('\n').pop()?.trim() ?? '',
    body: match[2],
  }))
  /** A padding/border value that adds no chrome (empty / none / zeros). */
  const chromeless = (value: string): boolean => {
    const cleaned = value.replace(/;/g, '').trim()
    if (cleaned === '' || cleaned === 'none') return true
    return cleaned.split(/\s+/).every(token => /^0(px)?$/.test(token))
  }

  it('every width:100% rule with real padding/border declares border-box (the overflow family)', () => {
    // THE 「电脑端提问截断/横条」root, generalized: under the host's
    // content-box default, width:100% + padding/border makes a box WIDER
    // than its parent; any overflow-y scroller (whose other axis computes to
    // auto per spec) then shows a horizontal scrollbar. Whole-sheet scan, so
    // the family can never quietly return.
    const offenders: string[] = []
    for (const { selectors, body } of rules) {
      if (!/(?<!max-)width:\s*100%/.test(body)) continue
      if (/box-sizing:\s*border-box/.test(body)) continue
      const padding = /padding:\s*([^;]+)/.exec(body)?.[1]
      const border = /(?:^|\n)\s*border:\s*([^;]+)/.exec(body)?.[1]
      const padded = padding !== undefined && !chromeless(padding)
      const bordered = border !== undefined && !chromeless(border)
      if (padded || bordered) offenders.push(`${selectors} (padding: ${padding ?? '-'}; border: ${border ?? '-'})`)
    }
    expect(offenders, 'these rules overflow their parent by their own chrome — add box-sizing: border-box (or strip the chrome)').toEqual([])
  })

  it('the interaction card cannot pierce its rails (wrap at every layer, one scrollbar grammar)', () => {
    // Plan body: the ONLY content wrapper that lacked the break-word law its
    // siblings carry — a plan's long token overflowed and the implicit
    // overflow-x scrolled sideways on desktop (「plan 卡也出横条」).
    expect(ruleOf('interactionPlanBody')).toMatch(/overflow-wrap:\s*break-word/)
    // Question body rows: chrome stays inside width:100%.
    expect(ruleOf('interactionOptionButton')).toMatch(/box-sizing:\s*border-box/)
    expect(ruleOf('interactionCustomRow')).toMatch(/box-sizing:\s*border-box/)
    // The read-only card's quoted rows keep their labels and descriptions inside
    // the card: a flex column with a min-width floor, and a label line that
    // breaks anywhere (an unbreakable path cannot pierce the rail).
    expect(ruleOf('interactionOffered')).toMatch(/min-width:\s*0/)
    expect(ruleOf('interactionOptionLabel')).toMatch(/overflow-wrap:\s*anywhere/)
    // The plan's reading window is the card's ONE scroller, and it rides the ONE
    // scrollbar grammar (its bar looks like every other bar on the board — thin
    // and themed, not the system default that outed the desktop-only bug). The
    // list is a claim about WHICH regions scroll, so every member must declare
    // its own scroll — a class that never produces a bar is a scrolling rule for
    // something that cannot scroll.
    expect(source).toMatch(/:is\([^)]*\.interactionPlanBody[^)]*\)\s*\{/)
    const listed = /:is\(([^)]+)\)::-webkit-scrollbar-button/.exec(source)?.[1]
      ?.split(',').map(name => name.trim()).filter(name => name.startsWith('.'))
      ?? []
    expect(listed.length, 'the scrollbar grammar lost its member list').toBeGreaterThan(4)
    const notScrolling = listed.filter(name => !/overflow(-y)?:\s*(auto|scroll)/.test(ruleOf(name.slice(1))))
    expect(notScrolling, 'these ride the scrollbar grammar but never scroll — a bar that can never appear').toEqual([])
    // 咬得动：一个不滚动的成员必须被判出来（种在测试里，硬性规范 16）。
    const scrolls = (text: string): boolean => /overflow(-y)?:\s*(auto|scroll)/.test(text)
    expect(scrolls('.interactionBody { overflow-y: auto; }'), 'the predicate stopped seeing a scroller').toBe(true)
    expect(scrolls('.interactionBody { padding: 8px 12px; }'), 'the predicate cannot tell a scroller from plain content').toBe(false)
    // WHICH implementation renders is decided by the @supports gate, measured
    // on the running Edge: with scrollbar-width declared ungated, Chromium
    // silences every ::-webkit-scrollbar rule below and draws its native bar
    // WITH arrow buttons (「电脑端冒出原生箭头」). The gate must therefore own
    // the ONLY thin+color declaration, and the webkit path must hide its
    // buttons explicitly — strip the gate and no thin may remain; the button
    // pseudo must be display:none.
    // 判据读结构，不读字样（硬性规范 14）：注释里提到一个属性不是一次声明，而两张表
    // 现在各自解释这条文法，所以扫描先剥注释再匹配——否则一次措辞改动就会让这条红。
    const structural = stripCssComments(source)
    const gate = /@supports not selector\(::-webkit-scrollbar\) \{[\s\S]*?\n\}/.exec(structural)
    expect(gate, 'the standard scrollbar props must live behind the webkit gate').not.toBeNull()
    expect(gate?.[0]).toContain('scrollbar-width: thin')
    expect(gate?.[0]).toContain('scrollbar-color:')
    const ungated = structural.replace(/@supports not selector\(::-webkit-scrollbar\) \{[\s\S]*?\n\}/g, '')
    expect(ungated, 'no styling scrollbar-width outside the gate — it silences the webkit rules in Chromium').not.toContain('scrollbar-width: thin')
    expect(structural).toMatch(/::-webkit-scrollbar-button\s*\{\s*display:\s*none/)
  })

  it('a plan card body keeps a floor computed from its own line box, and the card yields', () => {
    /* THE REPORTED 「正文只有一条缝」. Its root is the CARD's `max-height`: the
       decision rows pinned under the body spend that cap first, and the body gets
       the remainder — measured on the bench's plan card, 131px of a 322px card for
       a 228px plan, and the reported card is that state with one more decision row
       under it. So the body carries its own floor, and the floor is computed from
       THIS rule's own line box (`font-size × line-height`), because a literal pixel
       would stop following the text the day the type scale moves. The ceiling moves
       onto the body too (a long plan still scrolls inside it), and the CARD yields:
       a box too short for chrome + floor is absorbed by the region that scrolls,
       never by the plan. Rule text is read with its comments removed (硬性规范 14). */
    const body = withoutComments(ruleOf('interactionPlanBody'))
    const floor = /min-block-size:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? ''
    expect(floor, 'the plan body has no floor — three decision rows squeeze it back into a sliver').not.toBe('')
    expect(floor, 'the floor is a pixel literal: it stops following this paragraph the day the type scale moves')
      .not.toMatch(/\d+(?:\.\d+)?px/)
    expect(floor, 'the floor is not computed from the line box (`--plan-body-line`)').toContain('var(--plan-body-line)')
    // The line box's TWO numbers live in one place, and the paragraph reads them.
    expect(body, 'the line box is no longer font-size × line-height in one declaration')
      .toMatch(/--plan-body-line:\s*calc\(\s*var\(--plan-body-ink\)\s*\*\s*var\(--plan-body-lead\)\s*\)/)
    expect(body, 'the paragraph stopped reading the size token it computed its floor from')
      .toMatch(/font-size:\s*var\(--plan-body-ink\)/)
    expect(body, 'the paragraph stopped reading the leading token it computed its floor from')
      .toMatch(/line-height:\s*var\(--plan-body-lead\)/)
    expect(body, 'a long plan no longer scrolls inside its own region').toMatch(/max-block-size:\s*var\(--plan-body-ceiling\)/)
    // The pinned rows stay pinned, and the card is the thing that gives way.
    expect(ruleOf('interactionPlanActions'), 'the decision rows stopped being pinned under the body').toMatch(/flex:\s*none/)
    // ONE height rule for both kinds of card: the card never caps itself, so a
    // plan-specific exception has nothing left to undo — the cap was its only
    // reason to exist. The plan's ceiling lives on the BODY, asserted above.
    expect(ruleOf('interactionCard'), 'the card caps itself again: the plan loses its reading window and the question loses its footer')
      .not.toMatch(/max-height/)
    // 咬得动：写回一个像素数的地板，这条读法必须报。
    expect(/\d+(?:\.\d+)?px/.test('min-block-size: 78.5px'), 'the plant did not bite').toBe(true)
    expect(/min-block-size:\s*([^;]+)/.exec('min-block-size: calc(3 * var(--plan-body-line));')?.[1], 'the plant did not bite')
      .toContain('var(--plan-body-line)')
  })
})
