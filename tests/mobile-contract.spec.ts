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

/** The rule whose selector is EXACTLY `selector` in a scope — never a
 *  descendant selector that merely ends with it (`.boardRowTools .columnTabs`
 *  must not answer for `.columnTabs`). */
function ruleExact(scope: string, selector: string): string {
  const at = scope.indexOf(`\n  ${selector} {`)
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

  it('shape switches read the surface, never the viewport (single truth)', () => {
    // P6 freeze: the cruise popover/Dialog switch and the panel fold
    // defaults both measure the surface the CSS queries. A viewport proxy
    // disagrees exactly when it matters (mid-size window + shell sidebar
    // open), so `useNarrow` is frozen and no caller may import it.
    const boardPath = fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url))
    const board = readFileSync(boardPath, 'utf8')
    expect(board).toMatch(/useSurfaceNarrow\('\[data-dsh-taskboard-view\]', 680\)/)
    expect(board).not.toMatch(/useNarrow\(/)
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    expect(readFileSync(panelPath, 'utf8')).toMatch(/useSurfaceNarrow\('\[data-dsh-taskboard-panel\]', 600\)/)
    const hookPath = fileURLToPath(new URL('../src/client/board/use-narrow.ts', import.meta.url))
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
  const touch = blockFrom(line => /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)/.test(line))

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
    // fixes the SHAPE with a named grid: line 1 = back + title + cruise
    // (the always-on toggle fills the right end the relocated 新建 left);
    // line 2 = the state announcement, full width, ONLY when it has
    // content (stateless = single line, no dead band).
    // Why the cruise switch is NOT beside the new-task button on a phone: the
    // fixed members of that line would be back 28 + cruise pill ~132 + primary
    // ~96 + gaps 24 = 280 of a 320px phone's 296 — the board title would
    // ellipsize to a stub, i.e. "labels survive" broken by arithmetic. So
    // 新建 moved to the thumb bar and cruise took line 1 right alone.
    const nav = ruleIn(compact, '.boardRowNav')
    expect(nav).toMatch(/display:\s*grid/)
    expect(nav).toMatch(/align-items:\s*center/)
    expect(nav).toMatch(/grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/)
    expect(nav).toMatch(/grid-template-areas:[\s\S]*"back title cruise"[\s\S]*"state state state"/)
    expect(compact).toMatch(/\.boardRowNav:not\(:has\(\.boardState\)\)[\s\S]*?"back title cruise"/)
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
    // The notification bell rides the modes cluster (never a third header
    // row): one shared helper renders both twins (header + thumb bar), so one
    // tap opens the waiting-sessions dialog at either width.
    expect(toolsRow).toContain('renderNotifyBell()')
    expect(board).toContain('css.notifyBell')
    expect(board).toContain('setShowNotify(true)')
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
    // Thumb bar: compact-only twins reusing the header handlers (one
    // behavior, never a second implementation). Hidden at base; in the compact
    // tier it is the board column's LAST FLEX CHILD — overlap with the columns
    // is then structurally impossible (no reserved padding, no keyboard-lift
    // var: the board's own gap separates, a shrinking viewport lifts an
    // in-flow bar by itself). It still FILLS edge to edge like the old pinned
    // dock (never an inset box): negative margins spend exactly the board's
    // dock-bleed tokens, which live on the compact board rule once. An
    // absolutely positioned bar plus a derived reservation formula is the
    // banned spelling (the 「列底部被拇指栏压住」 family: two numbers that
    // must agree forever).
    expect(board).toContain('css.thumbBar')
    expect(board).toContain("t('board.thumbBar')")
    expect(ruleOf('thumbBar')).toMatch(/display:\s*none/)
    // The board frame is height:100% plus padding: without border-box it runs
    // ~30px taller than its view and the in-flow thumb bar lands in the
    // overflowed strip (「底部被截断」); the pinned bar used to hide this.
    expect(ruleOf('board')).toMatch(/box-sizing:\s*border-box/)
    // The bleed tokens live on the compact board rule and feed its padding.
    expect(compact).toMatch(/--dsh-tb-dock-x:\s*12px/)
    expect(compact).toMatch(/--dsh-tb-dock-b:\s*12px/)
    expect(ruleIn(compact, '.thumbBar')).toMatch(/display:\s*flex/)
    expect(ruleIn(compact, '.thumbBar')).toMatch(/flex:\s*none/)
    expect(ruleIn(compact, '.thumbBar')).not.toMatch(/position:\s*absolute/)
    expect(ruleIn(compact, '.thumbBar')).not.toMatch(/--dsh-tb-kb/)
    // Full-bleed spends the tokens, never re-typed 12s.
    expect(ruleIn(compact, '.thumbBar')).toMatch(/-1 \* var\(--dsh-tb-dock-x\)/)
    expect(ruleIn(compact, '.thumbBar')).toMatch(/-1 \* \(var\(--dsh-tb-dock-b\)/)
    // The columns carry no bottom reservation for the bar anymore (in-flow
    // needs none) — and no hand-typed clearance may come back.
    expect(ruleIn(compact, '.columns')).not.toMatch(/padding-bottom:/)
    expect(ruleIn(compact, '.columns')).not.toMatch(/64px/)
    // Relocation, not duplication: the header twins hide on compact (their
    // thumb-bar twins carry the same handlers). One visible instance per
    // width — two DOM nodes, never two on screen.
    expect(compact).toMatch(/\.boardNewTask\s*\{[^}]*display:\s*none/)
    expect(compact).toMatch(/\.boardModes \.notifyBell\s*\{[^}]*display:\s*none/)
    expect(compact).toMatch(/\.boardModes \.modeDynamic\s*\{[^}]*display:\s*none/)
    expect(board).toContain('css.modeDynamic')
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
    // The narrow rail is exactly where the card's cap must be container-bound:
    // the comments box is 285px on a phone, so a 320px card overflowed it and
    // its pinned action row landed outside every scrollport (盘点「选项在、
    // 按钮按不了」). min() keeps the reading ceiling AND the container bound.
    expect(card).toMatch(/max-height:\s*min\(320px,\s*100%\)/)
    // The interactive card's ONE scroller is the question body (detail,
    // options, custom answer field); the read-only shell's plain-text body
    // keeps its own. Both own their horizontal inset.
    expect(ruleOf('interactionBody')).toMatch(/overflow-y:\s*auto[\s\S]*?padding:\s*8px 12px/)
    expect(ruleOf('interactionCardBody')).toMatch(/overflow-y:\s*auto[\s\S]*?padding:\s*0 12px/)
    expect(ruleOf('interactionActions')).toMatch(/padding:\s*0 12px/)
    // Two option grammars, deliberately distinct: the read-only shell's chips
    // are plain text (no pointer cursor, no hover lift, no focus ring), while
    // the interactive menu row is its own class with its own hover.
    expect(source).toMatch(/^\.interactionOption\s*\{/m)
    expect(source).toMatch(/\.interactionOptionButton:hover:not\(:disabled\)/)
    expect(source).not.toMatch(/[^.:\w]interactionOption:hover/)
    expect(source).not.toMatch(/[^\w.]interactionOption:focus-visible/)
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

  it('the compact tool row is deterministic: modes above, the filter owns the line below it (贴状态列)', () => {
    // The filter field used to share the tool row and get crushed to one
    // glyph ("筛"); a width floor only hides the structure problem. Compact
    // fixes the SHAPE by REORDERING the two lines (user decision): 整理/自动化
    // take the FIRST line left-aligned (the cluster shrank after the
    // relocation — right-aligning two pills voids the left two-thirds), the
    // search takes a full-width line BELOW it — so the long filter strip
    // sits directly above the five status columns. 新建任务 no longer lives
    // here at all (it moved to the nav row).
    const tools = ruleIn(compact, '.boardRowTools')
    expect(tools).toMatch(/display:\s*grid/)
    expect(tools).toMatch(/grid-template-areas:[\s\S]*"modes"[\s\S]*"search"[\s\S]*"tabs"/)
    // All three tracks are DECLARED (two button rows + the strip), and the one
    // rhythm token owns the row gap: the strip then sits exactly gap + its own
    // padding below the search field and the columns sit exactly its own
    // padding + the board gap below the pills. Deriving that spacing from a
    // neighbour's BOX EDGE is what let a device-side line box eat ~3px above
    // the strip (pristine render: 20/20; real phone: 23.6/19.3 across three
    // releases — the measurement that motivated moving the strip into this
    // grid).
    expect(tools).toMatch(/grid-template-rows:\s*var\(--dsh-tb-button-h\) var\(--dsh-tb-button-h\) auto/)
    expect(tools).toMatch(/row-gap:\s*var\(--dsh-tb-strip-gap\)/)
    expect(ruleIn(compact, '.boardRowTools .columnTabs')).toMatch(/grid-area:\s*tabs/)
    // The strip declares its own single pill row too, so no line box inside it
    // can inflate its box either.
    expect(ruleExact(compact, '.columnTabs')).toMatch(/grid-template-rows:\s*var\(--dsh-tb-button-h\)/)
    const search = ruleIn(compact, '.boardRowTools .search')
    expect(search).toMatch(/grid-area:\s*search/)
    expect(search).toMatch(/max-width:\s*none/)
    const modes = ruleIn(compact, '.boardRowTools .boardModes')
    expect(modes).toMatch(/grid-area:\s*modes/)
    expect(modes).toMatch(/justify-self:\s*start/)
    expect(compact).not.toMatch(/\.boardRowTools \.boardNewTask/)
    // The strip really lives inside that grid (DOM, not just CSS): the JSX
    // nests it in the tools row, so the declared tracks actually own it.
    const boardPath = fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url))
    const board = readFileSync(boardPath, 'utf8')
    const toolsRow = board.slice(board.indexOf('css.boardRowTools'), board.indexOf('organizeBar'))
    expect(toolsRow).toContain('css.columnTabs')
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

  it('the dock does not re-type the rail line either', () => {
    // Same class as above, one surface further out: the compact dock's negative
    // margins spend the dock tokens, and its padding had `14px` written by hand —
    // the rail token's value, typed instead of referenced. It could not disagree
    // with the rail members TODAY, which is what makes it dangerous: the day the
    // rail line moves, the dock's contents stay behind and nothing fails.
    const compact = blockFrom(line => /@container\s+dsh-tb\s*\(max-width:\s*680px\)/.test(line))
    const bar = ruleIn(compact, '.thumbBar')
    expect(bar).toMatch(/padding:\s*10px var\(--dsh-tb-rail-inset\)/)
    expect(bar).not.toMatch(/padding:[^;]*\b14px\b/)
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

  it('height MEANS outer height on the row controls (border-box, no 2px drift)', () => {
    // Content-box made every bordered 28px control really 30 (search 30 vs
    // cruise 28 never agreed; every clearance formula silently lost 2px).
    const base = blockFrom(line => line.trim() === '.primaryButton,')
    expect(base).toMatch(/box-sizing:\s*border-box/)
    for (const name of ['buttonSm', 'search', 'columnTab']) {
      expect(ruleOf(name), `.${name} missing`).toMatch(/box-sizing:\s*border-box/)
    }
  })

  it('buttons stay dainty like the reference (13px on 0 14px, never widened back)', () => {
    // Roundness feel is the aspect ratio, not the radius (already clamped to
    // the semicircle): the 0 18px widening read squarer and was reverted.
    const base = blockFrom(line => line.trim() === '.primaryButton,')
    expect(base).toMatch(/padding:\s*0 14px/)
    expect(base).toMatch(/font-size:\s*13px/)
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
    // ONE fill for the whole quiet family, and it is the NATIVE input surface:
    // the hand-picked layer token this used to carry is an opaque colour the
    // shell never remaps, which is exactly why 整理/自动化/动态/检查更新 drifted
    // away from 筛选任务 under a skin (「跟其他按钮都不一样」).
    expect(ghost).toMatch(/background:\s*var\(--dsh-tb-chip-fill\)/)
    expect(ghost).toMatch(/border:\s*var\(--dsh-tb-border\)/)
    // The token itself resolves to the native input face, and every member of
    // the family consumes it — the labels the user compared must not drift.
    expect(source).toMatch(/--dsh-tb-chip-fill:\s*var\(--dsh-tb-input-bg\)/)
    expect(source).toMatch(/--dsh-tb-input-bg:\s*var\(--dsw-specific-input-major\)/)
    for (const name of ['search', 'columnTab', 'chipFill', 'feedSearch']) {
      expect(ruleOf(name), `.${name} must consume the shared chip fill`).toContain('var(--dsh-tb-chip-fill)')
    }
    // No member of the family may go back to the private layer token.
    for (const name of ['ghostButton', 'search', 'columnTab', 'chipFill', 'feedSearch']) {
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
  })

  it('the compact column header is declared ONCE (no dead second padding)', () => {
    // Two competing paddings lived in the same compact block (12px 20px with
    // the contract comment, then a bare 10px 12px that won) — the top-rhythm
    // churn behind conflicting reports. One declaration survives.
    const compact = blockFrom(line => /@container\s+dsh-tb\s*\(max-width:\s*680px\)/.test(line))
    expect(compact.match(/\.columnHeader\s*\{/g) ?? []).toHaveLength(1)
    expect(ruleIn(compact, '.columnHeader')).toMatch(/padding:\s*12px 20px/)
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
      'boardBack',
      'cruisePill',
      'cruiseMore',
      'columnTab',
      'feedFilter',
      'feedAction',
      'feedSearch',
      'search',
      'cardQuickRun',
      'columnCount',
      'notifyBadge',
      'segmentedButton',
      'timeFieldCalendar',
      'interactionOption',
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
    for (const [name, ladder] of [
      ['card', 'md'],
      ['column', 'lg'],
      ['input', 'md'],
      ['segmentedRow', 'md'],
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
    const chrome = blockFrom(line => line.trim() === '.modal, .detail, .review {')
    expect(chrome).toMatch(/border-radius:\s*var\(--dsh-tb-radius-xl\)/)
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
  it('the attachment strip is one scrollable line, never a wrapping block', () => {
    const strip = ruleOf('attachStrip')
    expect(strip).toMatch(/flex-wrap:\s*nowrap/)
    expect(strip).toMatch(/overflow-x:\s*auto/)
  })
  it('attachment chips keep their width so the strip scrolls instead of squeezing', () => {
    expect(ruleOf('attachChip')).toMatch(/flex:\s*none/)
    expect(ruleOf('attachAdd')).toMatch(/flex:\s*none/)
  })
})

describe('no raw color literals leak in (design-system rule)', () => {
  it('the whole sheet stays token-fed: no hex/rgb color literals', () => {
    // The board's hard rule: colors ride --dsw-*/--dsh-tb-* tokens only.
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toMatch(/rgba?\(\s*\d/)
  })

  it('the unseen arrival dot is static and token-fed (no second breathing source)', () => {
    const dot = ruleOf('notifyDot')
    expect(dot).toContain('--dsh-tb-attention')
    expect(dot).not.toMatch(/animation|transition/)
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

  it('compact crowds nothing: modes share the left x', () => {
    // After the relocation the modes cluster is two pills — right-aligning
    // them leaves the left two-thirds void. Left shares the x-line with
    // 返回/筛选.
    const compact = blockFrom(line => /@container\s+dsh-tb\s*\(max-width:\s*680px\)/.test(line))
    expect(ruleIn(compact, '.boardRowTools .boardModes')).toMatch(/justify-self:\s*start/)
    // The board meets the shell edge-to-edge: separation is a hairline, not
    // air (padding alone never reads as separation against the shell head).
    // Padding rides the dock-bleed tokens (same values, single source).
    expect(ruleIn(compact, '.board')).toMatch(/padding:\s*14px var\(--dsh-tb-dock-x\)/)
    expect(ruleIn(compact, '.board')).toMatch(/border-top:\s*var\(--dsh-tb-separator\)/)
    // Column heads own their separation explicitly (12px vertical on narrow
    // glass; the cards' 6px top pad belongs to the drop indicator, never to
    // rhythm). Sides stay 20px (the cards' content line).
    expect(ruleIn(compact, '.columnHeader')).toMatch(/padding:\s*12px 20px/)
  })

  it('the narrow rail keeps ONE rhythm (a single gap owns between)', () => {
    // 「间距全都不一样」: 8px row pads + 12px head bottom + hairline + 10px
    // block pads + 14px transcript top stacked ad-hoc. Narrow unifies to one
    // 10px gap (desktop keeps its own rhythm — base rules untouched).
    const compact = blockFrom(line => /@container\s+dsh-tb-panel\s*\(max-width:\s*600px\)/.test(line))
    expect(ruleIn(compact, '.sessionRailFolds')).toMatch(/gap:\s*10px/)
    expect(ruleIn(compact, '.sessionRailHead')).toMatch(/padding-bottom:\s*0/)
    expect(ruleIn(compact, '.sessionRailHead')).toMatch(/border-bottom:\s*none/)
    expect(ruleIn(compact, '.reviewMain')).toMatch(/padding:\s*10px 14px/)
  })
})
