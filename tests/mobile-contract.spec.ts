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
 *   2. Compact columns: the five-up grid becomes a horizontal scroll-snap
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

const cssPath = fileURLToPath(new URL('../src/client/board.module.css', import.meta.url))
const source = readFileSync(cssPath, 'utf8')

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
function ruleOf(name: string): string {
  return blockFrom(line => line.trim() === `.${name} {`)
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
    // …and there must be NO leftover viewport width media query driving the
    // board's own column grid (the old @media (max-width: …) mechanism).
    expect(source).not.toMatch(/@media\s*\(max-width:\s*7\d\dpx\)/)
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
    const chrome = blockFrom(line => line.trim() === '.modal, .detail, .review {')
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
    // A column is capped well under full width — roughly two columns plus the
    // next column's edge share a phone board (「一列占满整屏」 fix).
    const column = compact.slice(compact.indexOf('.column {'))
    expect(column).toMatch(/flex:\s*0 0 clamp\(\d+px,\s*\d+cqw,\s*3\d\dpx\)/)
  })
})

describe('touch parity block (invisible ergonomics only)', () => {
  const touch = blockFrom(line => /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)/.test(line))

  it('exists', () => {
    expect(touch).not.toBe('')
  })

  it('never force-reveals the hover-only affordances (mobile IS desktop)', () => {
    // The user's contract: quick-run / color bar / copy ride hover exactly
    // like on the desktop board — an always-visible override is a regression.
    expect(touch).not.toMatch(/\.cardQuickRun\s*\{[^}]*opacity:\s*1/)
    expect(touch).not.toMatch(/\.cardColorBar\s*\{[^}]*display:\s*flex/)
    expect(touch).not.toMatch(/\.promptCopy\s*\{[^}]*opacity:\s*1/)
  })

  it('the touch reorder button pair is gone (drag stays the only reorder)', () => {
    // The affordance was removed on user request: session reorder is the
    // press-and-drag gesture, everywhere, exactly like desktop.
    expect(source).not.toMatch(/sessionRowMove/)
  })

  it('grows small hit areas without changing visual size', () => {
    // The ::before overlay pattern on the compact controls.
    expect(touch).toMatch(/\.buttonSm::before[\s\S]*?inset:\s*-7px/)
    expect(touch).toMatch(/position:\s*absolute/)
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
    expect(ruleOf('autoRuleRow')).toMatch(/gap:\s*4px/)
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
    expect(board).toMatch(/aria-label=\{t\(STATUS_KEY\[column\.status\]\)\}/)
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
    const status = ruleOf('boardStatus')
    expect(status).not.toMatch(/overflow:\s*hidden/)
    expect(ruleOf('boardStatusText')).toMatch(/overflow:\s*hidden/)
    expect(ruleOf('boardStatusText')).toMatch(/text-overflow:\s*ellipsis/)
  })

  it('the compact board header is a DETERMINISTIC split (never a wrap soup)', () => {
    // The old shape was one flex-wrap row soup: the engine banner appearing
    // pushed 整理/自动化 to a second line and 自动巡航 to a fourth. Compact
    // fixes the SHAPE with a named grid: line 1 = back + title + 新建任务,
    // line 2 = 状态 (spanning, left) + 自动巡航 (right).
    // Why the cruise switch is NOT beside the new-task button on a phone: the
    // fixed members of that line would be back 28 + cruise pill ~132 + primary
    // ~96 + gaps 24 = 280 of a 320px phone's 296 — the board title would
    // ellipsize to a stub, i.e. "labels survive" broken by arithmetic.
    const nav = ruleIn(compact, '.boardRowNav')
    expect(nav).toMatch(/display:\s*grid/)
    expect(nav).toMatch(/grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/)
    expect(nav).toMatch(/grid-template-areas:[\s\S]*"back title new"[\s\S]*"state state cruise"/)
    expect(compact).toMatch(/\.boardRowNav \.boardSpacer\s*\{\s*\n?\s*display:\s*none/)
    expect(compact).toMatch(/\.boardRowNav \.boardTitle\s*\{[^}]*grid-area:\s*title/)
    expect(compact).toMatch(/\.boardRowNav \.boardState\s*\{[^}]*grid-area:\s*state/)
    expect(compact).toMatch(/\.boardRowNav \.cruiseWrap\s*\{[^}]*grid-area:\s*cruise/)
    expect(compact).toMatch(/\.boardRowNav \.boardNewTask\s*\{[^}]*grid-area:\s*new/)
    // Hierarchy is AREAS, never `order` + auto margins (auto margin right-aligns
    // whichever item happens to START a wrapped line, so a wrap scatters it).
    expect(compact).not.toMatch(/margin-left:\s*auto/)
    expect(compact).not.toMatch(/\.boardRowNav[^{]*\{[^}]*order:/)
    // Groups keep members together; the cruise label survives at every width
    // (hiding words to buy pixels is the forbidden trade).
    expect(ruleOf('boardModes')).toMatch(/display:\s*inline-flex/)
    expect(ruleOf('boardState')).toMatch(/display:\s*inline-flex/)
    expect(compact).not.toMatch(/\.cruisePill \.switchLabel\s*\{\s*\n?\s*display:\s*none/)
    // The engine note is a real button (touch has no hover to reveal a `title`).
    const tsxPath = fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url))
    const board = readFileSync(tsxPath, 'utf8')
    expect(board).toContain('css.boardStatusButton')
    expect(board).toMatch(/onClick=\{\(\) => \{ setEngineNote\('stale'\) \}\}/)
    // The status line omits zero segments (「排队 0」 is noise — the same
    // quietness grammar as the context meter's legend).
    expect(board).toMatch(/snapshot\.stats\.running > 0 \? \[t\('board\.statusRunning'/)
    expect(board).toMatch(/snapshot\.stats\.queued > 0 \? \[t\('board\.statusQueued'/)
  })

  it('the header rows carry the agreed MEMBERS at both widths', () => {
    // Desktop AND compact share one DOM: nav row = back, title, state, spacer,
    // cruise, NEW TASK; tools row = search, MODES. The user's re-flow: 整理/
    // 自动化 move next to the filter, 新建任务 swaps places with 自动巡航 and
    // the statuses read on the left.
    const tsxPath = fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url))
    const board = readFileSync(tsxPath, 'utf8')
    const navRow = board.slice(board.indexOf('css.boardRowNav'), board.indexOf('css.boardRowTools'))
    const toolsRow = board.slice(board.indexOf('css.boardRowTools'), board.indexOf('organizeBar'))
    expect(navRow).toMatch(/boardNewTask[\s\S]*<\/div>/)
    expect(navRow.indexOf('cruiseWrap')).toBeLessThan(navRow.indexOf('boardNewTask'))
    expect(navRow.indexOf('boardState')).toBeLessThan(navRow.indexOf('cruiseWrap'))
    expect(navRow).not.toContain('boardModes')
    expect(toolsRow).toMatch(/className=\{css\.search\}/)
    expect(toolsRow).toContain('boardModes')
    expect(toolsRow).not.toContain('boardNewTask')
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
    expect(card).toMatch(/padding:\s*10px 0 12px/)
    expect(ruleOf('interactionCardBody')).toMatch(/overflow-y:\s*auto[\s\S]*?padding:\s*0 12px/)
    expect(ruleOf('interactionActions')).toMatch(/padding:\s*0 12px/)
  })

  it('the compact tool row is deterministic: the filter owns a whole line', () => {
    // The filter field used to share the tool row and get crushed to one
    // glyph ("筛"); a width floor only hides the structure problem. Compact
    // fixes the SHAPE: the search takes a full-width line on its own (the
    // placeholder always reads whole — 「那一行只保留筛选任务这条白长条」), and
    // the mode group takes the next line right-aligned. 新建任务 no longer
    // lives here at all (it moved to the nav row).
    const tools = ruleIn(compact, '.boardRowTools')
    expect(tools).toMatch(/display:\s*grid/)
    expect(tools).toMatch(/grid-template-areas:[\s\S]*"search"[\s\S]*"modes"/)
    const search = ruleIn(compact, '.boardRowTools .search')
    expect(search).toMatch(/grid-area:\s*search/)
    expect(search).toMatch(/max-width:\s*none/)
    const modes = ruleIn(compact, '.boardRowTools .boardModes')
    expect(modes).toMatch(/grid-area:\s*modes/)
    expect(modes).toMatch(/justify-self:\s*end/)
    expect(compact).not.toMatch(/\.boardRowTools \.boardNewTask/)
  })

  it('row actions collapse to glyphs compact so the title keeps its quota', () => {
    // The text cluster ("查看会话 → / 隐藏") was a ~156px fixed tax that left
    // the title three characters. Labels fold, glyphs take over — and the
    // compact row-top grid gives the lead the whole leftover track (minmax(0,
    // 1fr)) with one 4px rhythm.
    expect(compact).toMatch(/\.sessionRowActions \.rowActionText\s*\{\s*\n?\s*display:\s*none/)
    expect(compact).toMatch(/\.sessionRowActions \.rowActionIcon\s*\{\s*\n?\s*display:\s*inline-flex/)
    const top = ruleIn(compact, '.sessionRowTop')
    expect(top).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\) auto/)
    expect(top).toMatch(/row-gap:\s*4px/)
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
    for (const member of ['sessionFacts', 'sessionRailHead > \\.detailSection', 'commentsScroll', 'reviewComposer']) {
      expect(source).toMatch(new RegExp(`\\.${member}[^}]*var\\(--dsh-tb-rail-inset\\)`))
    }
    // The head's fold row must NOT add a second inset (that was the 28px).
    expect(source).not.toMatch(/\.sessionRailHead \.detailDisclosure\s*\{[^}]*margin/)
    // The session row's identity column is one derived x, not a magic 19px.
    expect(source).toMatch(/--dsh-tb-lead-x:\s*calc\(/)
  })

  it('paragraphs carry no inherited spacing inside the board', () => {
    // A `<p>` used as a LAYOUT row kept the UA's 1em margin (an invisible 16px
    // above and below) — the whole 「会话 3 下面一大片空」 gap. Rhythm here is
    // always declared, never inherited.
    expect(source).toMatch(/\[data-dsh-taskboard-view\] p\s*\{\s*\n?\s*margin:\s*0/)
  })

  it('a control beside a text line is centered by a DERIVED offset, not a hand-tuned px', () => {
    // The session toolbar used to carry `margin-top: 3px` — the magnitude of
    // the right formula with the WRONG sign, leaving the 24px pill 6px below
    // the 18px line's center.
    const row = ruleOf('sessionHintRow')
    expect(row).toMatch(/margin:\s*0/)
    expect(source).toMatch(/\.sessionHintRow \.sessionToolbarActions\s*\{[^}]*margin-top:\s*calc\(\(var\(--dsh-tb-hint-line\)\s*-\s*var\(--dsh-tb-button-h-sm\)\)\s*\/\s*2\)/)
  })

  // (The review-family contracts — the two-dropdown comment panel, the
  // context dock above the composer, the ONE scroll body and the
  // panel-anchored breakpoints — live in review-page.spec.ts, the owner of
  // the review surface.)
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
    expect(compact).not.toMatch(/\.sessionRowLeading \.sessionRowName\s*\{[^}]*flex:\s*1 1 100%/)
  })

  it('no row-level unread badge — the marker machinery is gone (unread breaths on the card only)', () => {
    // The per-row unread marker (overlay dot + halo) was removed: a row next
    // to an unread card must not repeat the signal; the card is the ONLY
    // unread surface. The marker class is gone from the sheet, and the row
    // geometry still derives from the declared line box (no magic px on an
    // inherited `normal` line height).
    expect(source).not.toMatch(/\.attentionDot\s*\{/)
    expect(source).toMatch(/--dsh-tb-row-line:/)
    expect(ruleOf('sessionRowLeading')).toMatch(/line-height:\s*var\(--dsh-tb-row-line\)/)
  })

  it('the detail title and board title are shrinkable', () => {
    expect(ruleOf('detailTitle')).toMatch(/min-width:\s*0/)
    expect(ruleOf('boardTitle')).toMatch(/min-width:\s*0/)
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

describe('no raw color literals leak in (design-system rule)', () => {
  it('the whole sheet stays token-fed: no hex/rgb color literals', () => {
    // The board's hard rule: colors ride --dsw-*/--dsh-tb-* tokens only.
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toMatch(/rgba?\(\s*\d/)
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
  // There are several reduced-motion blocks; the LAST one carries the spinner
  // + entrance rules. Grab it by brace-balancing from its @media line.
  const reduced = (() => {
    const marker = '@media (prefers-reduced-motion: reduce) {'
    const start = source.lastIndexOf(marker)
    if (start < 0) return ''
    let depth = 0
    for (let i = start + marker.length - 1; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1) }
    }
    return ''
  })()

  it('the spinner keeps animating (only calmer) under reduced motion', () => {
    expect(reduced).toMatch(/\.spinner\s*\{\s*\n?\s*animation-duration:\s*[\d.]+s/)
    expect(reduced).not.toMatch(/\.spinner\s*\{\s*\n?\s*animation:\s*none/)
  })

  it('the breathing RING also survives — it is a state message, not decoration', () => {
    // A still ring reads as "stuck" (the opposite of "running") and cannot be
    // told apart from a finished-and-unread card, so the ring joins the
    // spinner's exemption: slower and gentler, never `animation: none`.
    expect(reduced).not.toMatch(/\.card\[data-(unviewed|active)\][\s\S]{0,80}animation:\s*none/)
    expect(reduced).not.toMatch(/\.sessionRow::after\s*\{\s*\n?\s*animation:\s*none/)
    // The amplitude lives in tokens, which is how the pulse is softened
    // instead of deleted.
    expect(reduced).toMatch(/--dsh-tb-breath:\s*[\d.]+s/)
    expect(reduced).toMatch(/--dsh-tb-breath-spread:/)
    expect(source).toMatch(/@keyframes dshTbBreathRing\s*\{[\s\S]*?var\(--dsh-tb-breath-spread\)/)
  })

  it('decorative entrance motion is still suppressed', () => {
    expect(reduced).toMatch(/\.modalBackdrop[\s\S]*?animation:\s*none/)
  })
})
