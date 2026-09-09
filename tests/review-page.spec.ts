/**
 * Review-page pure logic (domain grouping): the transcript folding + usage
 * sum, the context-meter arithmetic, the slash-menu flip judgment and the
 * session to-do readout — the pure helpers the review page / session panel
 * render from, tested together as one contract file.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { foldTranscript, sumUsage, type TranscriptEvent } from '../src/client/board/review-transcript.ts'
import { contextOccupancy, contextSegments, formatTokens } from '../src/client/board/context-meter.ts'
import { shouldFlipMenuUp } from '../src/client/board/menu-direction.ts'
import { contextWorthOf, isOpenTodo, latestSessionTodos } from '../src/client/board/interaction.ts'

const cssPath = fileURLToPath(new URL('../src/client/board.module.css', import.meta.url))
const cssSource = readFileSync(cssPath, 'utf8')

/** The first top-level `.name { … }` rule body (line-start match, trim-tolerant
 *  so indented @container rules are also findable). */
function ruleOf(name: string): string {
  const lines = cssSource.split('\n')
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
  }
  throw new Error(`rule ".${name}" not found in board.module.css`)
}

describe('rail layout CSS contract (interaction card never bursts the rail)', () => {
  it('the interaction card is shrinkable and sits on the rail content line', () => {
    const card = ruleOf('interactionCard')
    expect(card).toContain('min-width: 0')
    // The rail's ONE content line comes from the token (a member that re-types
    // 14px is how the rail grew a 28px row beside a 0px one).
    expect(card).toMatch(/margin:\s*0 var\(--dsh-tb-rail-inset\) 2px/)
  })

  it('HEIGHT CONTRACT: the interaction card is capped, its body scrolls, its actions stay pinned', () => {
    const card = ruleOf('interactionCard')
    // A px cap, never a viewport unit: the card lives inside a panel that is
    // itself sized against the BOARD box, so `40vh` measured a different box
    // than the one that has to hold it (and the mobile contract bans viewport
    // units board-wide — the two tests used to disagree about this line).
    expect(card).toMatch(/max-height:\s*320px/)
    expect(card).not.toMatch(/\d+(vh|dvh|vw)\b/)
    expect(card).toContain('overflow: hidden')
    // The body is the scroll slot (never the card itself): long plan/question
    // text scrolls inside while the action row remains visible at the bottom.
    const body = ruleOf('interactionCardBody')
    expect(body).toContain('overflow-y: auto')
    expect(body).toContain('min-height: 0')
  })

  it('the rail clips horizontally; the FOLDS block owns the only scroll', () => {
    // Horizontal: nothing spills past and covers other UI. Vertical: the rail
    // does NOT scroll — a scrollport that contains the composer is exactly how
    // the send box used to be pushed out of reach, and a `display: contents`
    // rail cannot scroll at all (a declared-but-dead scroller is a lie the
    // follow logic could walk into). The folds block owns the last resort.
    expect(ruleOf('reviewRail')).toContain('overflow: hidden')
    expect(ruleOf('reviewRail')).not.toMatch(/overflow-y:\s*auto/)
    expect(ruleOf('sessionRailFolds')).toMatch(/overflow-y:\s*auto/)
    expect(ruleOf('sessionRailFolds')).toMatch(/min-height:\s*0/)
  })

  it('action rows wrap instead of bursting the card right edge', () => {
    const actions = ruleOf('interactionActions')
    expect(actions).toContain('flex-wrap: wrap')
  })

  it('the comments region and the composer stay inside the rail content box', () => {
    expect(ruleOf('commentsScroll')).toContain('min-width: 0')
    // The comments region is the rail's ONLY scroller (one bar per surface).
    expect(ruleOf('commentsScroll')).toContain('overflow-y: auto')
    // The rail owns ONE 12px vertical rhythm; each segment keeps only its
    // own 14px content box (the composer's bottom breathing stays its own).
    expect(ruleOf('reviewComposer')).toMatch(/padding:\s*0 var\(--dsh-tb-rail-inset\) 12px/)
  })

  it('the transcript text shrinks and inline code breaks (never pierces the column)', () => {
    expect(ruleOf('reviewMessageText')).toContain('min-width: 0')
    expect(ruleOf('mdCode')).toContain('overflow-wrap: anywhere')
  })
})

describe('review rail scroll contract (ONE scroll body + pinned composer, every width)', () => {
  /** A whole `@container … { … }` block, brace-balanced from its marker. */
  function containerBlock(marker: string): string {
    const open = cssSource.indexOf(marker)
    if (open < 0) throw new Error(`container block "${marker}" is missing`)
    let depth = 0
    for (let i = open + marker.length - 1; i < cssSource.length; i++) {
      if (cssSource[i] === '{') depth++
      else if (cssSource[i] === '}') {
        depth--
        if (depth === 0) return cssSource.slice(open, i + 1)
      }
    }
    throw new Error('unbalanced container block')
  }

  /** One rule's OWN text inside a scope (up to its closing brace). */
  function ruleIn(scope: string, selector: string): string {
    const at = scope.indexOf(`${selector} {`)
    if (at < 0) return ''
    const end = scope.indexOf('}', at)
    return scope.slice(at, end < 0 ? undefined : end)
  }

  const stacked = (): string => containerBlock('@container dsh-tb-panel (max-width: 600px) {')

  it('the rail is [state] + [head, full render no scrollbar] + [comments own scroll] + [pinned composer]', () => {
    // The height contract the user restored: the head renders its config
    // FULLY (no internal scrollbar — a config cut at the model row with its
    // own slider is the 「显示不全」 failure), the comments own the rail's ONE
    // scroll region, and the composer is ALWAYS visible (flex none).
    expect(ruleOf('reviewComposer')).toMatch(/flex:\s*none/)
    // The head renders at its NATURAL height (flex none — it never shrinks a
    // config into a clipped box) and never caps or scrolls its own config.
    const head = ruleOf('sessionRailHead')
    expect(head).toMatch(/flex:\s*none/)
    expect(ruleOf('sessionRailHead > .detailSection')).not.toMatch(/max-height/)
    expect(ruleOf('sessionRailHead > .detailSection')).not.toMatch(/overflow-y/)
    // The comments region absorbs the leftover height and owns the scroller.
    expect(ruleOf('sessionRailComments[data-open=\'true\']')).toMatch(/flex:\s*1 1 auto/)
    expect(ruleOf('sessionRailComments[data-open=\'true\']')).toMatch(/min-height:\s*0/)
    const comments = ruleOf('commentsScroll')
    expect(comments).toMatch(/flex:\s*1 1 auto/)
    expect(comments).toMatch(/overflow-y:\s*auto/)
    expect(comments).toMatch(/min-height:\s*0/)
    // The scroll region owns the rail's content line; segments inside add none.
    expect(comments).toMatch(/padding:\s*10px var\(--dsh-tb-rail-inset\)/)
    expect(ruleOf('sessionFacts')).toMatch(/padding-inline:\s*var\(--dsh-tb-rail-inset\)/)
    // Inside the comments region the interaction card drops its margin.
    expect(cssSource).toMatch(/\.commentsScroll \.interactionCard\s*\{[^}]*margin:\s*0 0 2px/)
    // The rail clips on both axes; the folds block is the only scroller
    // (check the rail layout contract — a scrolling rail could push the
    // composer out of reach again).
    expect(ruleOf('reviewRail')).toContain('overflow: hidden')
    // No trace of the retired single-scroll-body / dock grammars.
    expect(cssSource).not.toMatch(/\.sessionRailScroll\s*\{/)
    expect(cssSource).not.toMatch(/\.sessionContextDock\s*\{/)
  })

  it('the narrow panel is a THREE-ROW grid: capped folds / conversation / composer', () => {
    // The structural end of the截断 family. The old stacked form was a flex
    // chain sharing a height: the config head was `flex: none` (it never
    // yields), the comments collapsed toward zero to absorb the pressure, and
    // the composer — the LAST item in the rail's scroll content — ended up
    // below the fold, unreachable. A grid with a capped top row and the
    // composer as its OWN row makes that outcome unrepresentable.
    const block = stacked()
    const body = ruleIn(block, '.reviewBody')
    expect(body).toMatch(/display:\s*grid/)
    // `minmax(0, auto)` on BOTH content rows, not a fixed percentage: a fixed
    // `45%` track reserves 45% of the panel even with both folds collapsed (a
    // dead band above the conversation), and an unshrinkable `auto` composer
    // row gets clipped by `overflow: hidden` when a tall composer meets a short
    // panel (soft keyboard). min 0 + own scroll = always reachable; max auto =
    // never reserves space it does not need.
    expect(body).toMatch(/grid-template-rows:\s*minmax\(0,\s*auto\)\s+minmax\(0,\s*1fr\)\s+minmax\(0,\s*auto\)/)
    expect(body).toMatch(/grid-template-areas:[\s\S]*"folds"[\s\S]*"transcript"[\s\S]*"composer"/)
    expect(body).toMatch(/overflow:\s*hidden/)
    // The rail stops being a BOX so its segments can join the panel grid.
    expect(ruleIn(block, '.reviewRail')).toMatch(/display:\s*contents/)
    // Each region owns its scroll: the folds block is capped, the comments
    // box owns its capped scroll at EVERY width (one grammar — 滑到最新
    // drives it, desktop and phone), the conversation scrolls, the composer
    // never does.
    expect(ruleIn(block, '.sessionRailFolds')).toMatch(/grid-area:\s*folds/)
    expect(ruleIn(block, '.sessionRailFolds')).toMatch(/min-height:\s*0/)
    expect(ruleIn(block, '.commentsScroll')).toMatch(/overflow-y:\s*auto/)
    expect(ruleIn(block, '.commentsScroll')).toMatch(/max-height:\s*300px/)
    expect(ruleIn(block, '.reviewMain')).toMatch(/grid-area:\s*transcript/)
    expect(ruleIn(block, '.reviewComposer')).toMatch(/grid-area:\s*composer/)
    // The one case a non-shrinkable row cannot solve — a tall composer (long
    // draft, attached pictures) on a short panel (soft keyboard on a small
    // phone) — must degrade to a scrolling composer, never to a send button
    // cut off OUTSIDE every scrollport by the panel's own overflow:hidden.
    expect(ruleIn(block, '.reviewComposer')).toMatch(/min-height:\s*0/)
    expect(ruleIn(block, '.reviewComposer')).toMatch(/overflow-y:\s*auto/)
    // Placement is by NAMED AREA, never by `order` (an order on an item of a
    // contents parent reads against the wrong container).
    expect(block).not.toMatch(/\.reviewMain\s*\{[^}]*order:/)
    expect(block).not.toMatch(/\.reviewRail\s*\{[^}]*order:/)
    // No container/viewport unit for a height share (the board box is
    // inline-size only, so a block container unit would silently become one).
    expect(block).not.toMatch(/(max-height|flex-basis|height):\s*[\d.]+(cqh|cqb|vh|dvh)/)
    // The conversation keeps its own scroller in the stacked form too.
    expect(ruleIn(block, '.reviewTranscriptScroll')).toMatch(/overflow-y:\s*auto/)
  })

  it('the rail is TWO blocks at every width: folds (flexes) + composer (pinned)', () => {
    // The wide form is unchanged in GEOMETRY — the four segments simply live
    // in one wrapper now, which is what the narrow grid can cap.
    const folds = ruleOf('sessionRailFolds')
    expect(folds).toMatch(/flex:\s*1 1 auto/)
    expect(folds).toMatch(/min-height:\s*0/)
    expect(folds).toMatch(/display:\s*flex/)
    expect(ruleOf('reviewComposer')).toMatch(/flex:\s*none/)
    // The composer explains itself (a fold that starts collapsed on a phone
    // must not hide the send-mode / blocking-reason line behind a hover).
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panelSource = readFileSync(panelPath, 'utf8')
    const composer = panelSource.slice(panelSource.indexOf('export function SessionComposer'))
    expect(composer).toMatch(/hint\?: string/)
    expect(composer).toMatch(/\{hint \?\? t\('detail\.sessionDriveHint'\)\}/)
    // …and the rail no longer takes it.
    const rail = panelSource.slice(panelSource.indexOf('export function SessionRail'), panelSource.indexOf('export function SessionComposer'))
    expect(rail).not.toMatch(/hint\?: string/)
  })

  it('the review family queries its OWN panel width, declared on .review', () => {
    // A wide board with a capped 880px panel no longer keeps a cramped
    // one-row header, and split screens stack honestly: the geometry
    // reference is the surface that must fit, not the window.
    const review = ruleOf('review')
    expect(review).toMatch(/container-type:\s*inline-size/)
    expect(review).toMatch(/container-name:\s*dsh-tb-panel/)
    expect(stacked()).not.toBe('')
    // The panel cannot query itself: its own width inset rides the board
    // container (panel = board − 48 backdrop padding → a 600px panel floor
    // is a 648px board floor).
    const boardSized = containerBlock('@container dsh-tb (max-width: 648px) {')
    expect(boardSized).toMatch(/\.review\s*\{[^}]*width:\s*calc\(100% - 16px\)/)
    // The old board-anchored 600px review block is gone.
    expect(cssSource).not.toMatch(/@container dsh-tb \(max-width: 600px\) \{/)
  })

  it('the narrow header is a deterministic grid: title+badge+× one plane (× ALWAYS top-right), then context LEFT + actions RIGHT', () => {
    const block = stacked()
    // The header is a NAMED GRID at BOTH widths (never flex-wrap + order,
    // which drifted the layout with content — × sometimes fell to line 2's
    // left, 刷新/查看会话 sometimes squeezed onto line 1). The narrow block
    // only RE-MAPS the same five names (title/badge/context/actions/close)
    // to two lines: line 1 = title | badge | close (× always top-right,
    // centered with the title); line 2 = context | actions. The title stays
    // single-line. The base rule carries display:grid + areas; the narrow
    // block carries only the override.
    expect(ruleOf('reviewHeader')).toMatch(/display:\s*grid/)
    expect(ruleOf('reviewHeader')).toMatch(/grid-template-areas:[\s\S]*"title badge context actions close"/)
    expect(ruleIn(block, '.reviewHeader')).toMatch(/grid-template-areas:[\s\S]*"title badge close"[\s\S]*"context actions actions"/)
    expect(ruleIn(block, '.reviewHeader > .iconButton')).not.toMatch(/position:\s*absolute/)
    // WIDE: everything on ONE line — context between the badge and actions,
    // capped, same center baseline (the 「标题栏不在同一水平面」 fix).
    const wideContext = ruleOf('reviewHeaderContext')
    expect(wideContext).toMatch(/grid-area:\s*context/)
    expect(wideContext).toMatch(/max-width:\s*320px/)
  })

  it('the header context expansion is capped + in-flow on a phone (never eats the screen)', () => {
    // A header-anchored in-flow expansion without a cap grew past the whole
    // screen and pushed every function out of reach (「上下文占满屏幕」).
    const panel = ruleIn(stacked(), '.reviewHeaderContext .sessionContextPanel')
    // In-flow = NOT absolute (relative keeps it in the header's flow AND
    // carries the isolation z-index; static cannot paint under the actions).
    expect(panel).not.toMatch(/position:\s*absolute/)
    expect(panel).toMatch(/max-height:\s*240px/)
    expect(panel).toMatch(/overflow-y:\s*auto/)
  })

  it('the header context cell is isolated: its expansion paints UNDER the actions, never over them', () => {
    // The 「上下文与刷新/查看会话重叠」 family: the context cell owns an
    // isolation context; the expanded panel (wide popover AND narrow
    // in-flow) sits at z-index 1 while the head row, the actions and the
    // close sit at z-index 2. A long to-do list slides BENEATH the buttons.
    const context = ruleOf('reviewHeaderContext')
    expect(context).toMatch(/isolation:\s*isolate/)
    expect(cssSource).toMatch(/\.reviewHeaderContext \.sessionContextPanel\s*\{[^}]*z-index:\s*1/)
    expect(cssSource).toMatch(/\.reviewActions,\s*\n\.reviewHeader > \.iconButton\s*\{[^}]*z-index:\s*2/)
    // The header wrap surrenders its own 14px (the cell owns the column's
    // padding — a second inset double-indents the head and shrinks the
    // popover anchor, which painted head text under the actions).
    expect(cssSource).toMatch(/\.reviewHeaderContext \.sessionContextWrap\s*\{[^}]*padding:\s*0/)
  })

  it('the review title is single-line ellipsis on a phone (header stays one plane)', () => {
    // The narrow header keeps the title on one line so title/badge/× never
    // drift apart; the full name is in the tooltip. (No line-clamp — that
    // reserves a box while painting outside it.)
    const title = ruleIn(stacked(), '.reviewTitle')
    expect(title).not.toMatch(/line-clamp/)
    expect(title).not.toMatch(/white-space:\s*normal/)
  })

  it('the header action cluster is same-height (24px pills + 24px close)', () => {
    // 「同一排控件同级高」: a 30px circle beside 24px pills is the misalignment
    // the eye reads as sloppiness. The size rides the sm token (or its equal
    // literal) — the test pins the VALUE, never the spelling.
    expect(cssSource).toMatch(/\.reviewHeader \.iconButton\s*\{[^}]*(width:\s*(24px|var\(--dsh-tb-button-h-sm\));[^}]*height:\s*(24px|var\(--dsh-tb-button-h-sm\))|height:\s*(24px|var\(--dsh-tb-button-h-sm\));[^}]*width:\s*(24px|var\(--dsh-tb-button-h-sm\)))/)
  })

  it('the fold defaults follow the PANEL width, not the viewport', () => {
    // A mid-size window with the shell sidebar open already renders the
    // stacked panel (the container query) while `matchMedia` still says
    // "wide" — a default that followed the viewport would disagree with the
    // geometry the user is looking at. The hook measures the same surface the
    // CSS queries, and the panel is stamped for it.
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panelSource = readFileSync(panelPath, 'utf8')
    expect(panelSource).toMatch(/useSurfaceNarrow\('\[data-dsh-taskboard-panel\]', 600\)/)
    // The comments fold starts OPEN at every width (one grammar — the thread
    // is the first screen, collapsible on tap); only the config head keeps
    // the narrow-default-folded split.
    expect(panelSource).toMatch(/useState\(true\)/)
    expect(panelSource).toMatch(/useState\(!narrowPanel\)/)
    const framePath = fileURLToPath(new URL('../src/client/board/SessionFrame.tsx', import.meta.url))
    expect(readFileSync(framePath, 'utf8')).toContain('data-dsh-taskboard-panel=""')
    const hookPath = fileURLToPath(new URL('../src/client/board/use-narrow.ts', import.meta.url))
    const hook = readFileSync(hookPath, 'utf8')
    expect(hook).toMatch(/new ResizeObserver\(measure\)/)
    // Every observer is disposed (lifecycle rule 6).
    expect(hook).toMatch(/return \(\) => \{ observer\.disconnect\(\) \}/)
  })

  it('the rail head folds through the SHARED Disclosure (turning chevron, no hand-rolled twin)', () => {
    // The hand-rolled toggle row was a Disclosure copy that forgot the
    // rotation — "the symbol never changes" was duplication, not taste.
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panelSource = readFileSync(panelPath, 'utf8')
    expect(panelSource).toMatch(/<Disclosure/)
    expect(cssSource).not.toMatch(/sessionRailHeadToggle/)
    expect(cssSource).not.toMatch(/sessionRailHeadTitle/)
    // The fold grammar turns: collapsed points right, expanded points down.
    expect(cssSource).toMatch(/\.detailDisclosure\[aria-expanded='false'\] \.detailChevron\s*\{[^}]*rotate\(-90deg\)/)
    expect(cssSource).toMatch(/\.sessionContextHead\[aria-expanded='false'\] \.sessionContextChevron\s*\{[^}]*rotate\(-90deg\)/)
    expect(cssSource).not.toMatch(/sessionContextChevronOpen/)
  })

  it('the engine-note dialog body rides the shared .modalScroll (no flush text)', () => {
    // Every other Dialog wraps its children in .modalScroll; the one call
    // site that skipped it printed the explanation flush against the panel.
    const tsxPath = fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url))
    const board = readFileSync(tsxPath, 'utf8')
    const at = board.indexOf('engineNote !== undefined')
    expect(at).toBeGreaterThan(-1)
    const dialog = board.slice(at, at + 1500)
    expect(dialog).toContain('css.modalScroll')
  })

  it('the context popover caps in px, never a viewport unit', () => {
    const panel = ruleOf('sessionContextPanel')
    expect(panel).toMatch(/max-height:\s*320px/)
    expect(panel).not.toMatch(/\dvh/)
  })

  it('the rail is TWO folds: head renders FULLY, comments own the region', () => {
    // The user's model: the head (config) renders completely — no internal
    // scrollbar; the comments are the rail's ONE scroll region and stay
    // foldable. Both are Disclosures (one fold grammar).
    const head = ruleOf('sessionRailHead')
    expect(head).not.toMatch(/position:\s*sticky/)
    // No capped internal body — the config shows 100%.
    expect(cssSource).not.toMatch(/sessionRailHeadBody/)
    // The comments region exists and scrolls (checked in the rail contract).
    expect(cssSource).toMatch(/\.sessionRailComments\s*\{/)
    expect(cssSource).toMatch(/\.commentsScroll\s*\{/)
    // session-panel renders TWO Disclosure folds (config + comments); the
    // comments scroll box drives the follow; NO context dock (it is in the
    // header now).
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panelSource = readFileSync(panelPath, 'utf8')
    const disclosures = panelSource.match(/<Disclosure/g) ?? []
    expect(disclosures.length).toBeGreaterThanOrEqual(2)
    expect(panelSource).toMatch(/commentsScroll/)
    expect(panelSource).not.toMatch(/sessionContextDock/)
    expect(panelSource).not.toMatch(/context=\{context\}/)
    // A pending interaction must FORCE the comments fold open — the
    // InteractionCard carries the answer affordance (in place on legacy
    // hosts, navigate-to-answer on 0.1.5), so a collapsed fold can never
    // hide it.
    expect(panelSource).toMatch(/open=\{commentsOpen \|\| interaction !== undefined\}/)
    // The 0.1.5 mirror card is read-only: the mirror branch renders options
    // as spans (never buttons), one navigate action, no submit path that
    // could race the native answerer. (The legacy in-place branch keeps its
    // button grammar for pre-0.1.5 hosts.)
    const cardPath = fileURLToPath(new URL('../src/client/board/InteractionCard.tsx', import.meta.url))
    const cardSource = readFileSync(cardPath, 'utf8')
    expect(cardSource).toMatch(/function MirrorQuestionCard/)
    expect(cardSource).toMatch(/review\.interactionGoAnswer/)
    const mirrorBranch = cardSource.slice(cardSource.indexOf('function MirrorQuestionCard'))
    expect(mirrorBranch).not.toMatch(/<button/)
    // The meter head is one line at every width (reading | percent | figures);
    // the breakdown is one row per bucket — never a wrapping flex cluster
    // (the 「对话消息另起一行」 family).
    expect(cssSource).toMatch(/\.reviewMeterHead\s*\{[^}]*white-space:\s*nowrap/)
    expect(cssSource).toMatch(/\.reviewMeterRows\s*\{[^}]*display:\s*grid/)
    // 滑到最新 binds ONLY the comments scroller (the 「跳转范围错误」 fix).
    expect(panelSource).toMatch(/onCommentsScroll/)
  })

  it('the rail is flexible in the base layout (two columns survive down to the floor)', () => {
    // A rigid 344px rail forced the stacked fallback far too early; the base
    // width must be a container-query clamp, not a fixed px.
    const rail = ruleOf('reviewRail')
    expect(rail).toContain('width: min(344px, 46cqw)')
  })
})

describe('scroll-follow is ONE mechanism (no per-mode fork)', () => {
  const tsxPath = fileURLToPath(new URL('../src/client/board/use-transcript.tsx', import.meta.url))
  const followSource = readFileSync(tsxPath, 'utf8')
  const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
  const panelSource = readFileSync(panelPath, 'utf8')

  it('the tail resolves the real scroller and listens in the capture phase', () => {
    // The stacked panel scrolls its BODY, not the inner region: following must
    // follow the resolved scroller, and scroll events (which do not bubble)
    // are seen through a window-level capture listener.
    expect(followSource).toMatch(/export function resolveScroller/)
    expect(followSource).toMatch(/addEventListener\('scroll', handler, true\)/)
    expect(followSource).toMatch(/export function useFollowScroll/)
  })

  it('the comment thread reuses the same hook instead of re-rolling it', () => {
    expect(panelSource).toMatch(/useFollowScroll\(/)
    // No hand-rolled scrollTop pinning left in the panel (one mechanism —
    // the only scrollTop writes are the follow/jump/anchor paths).
    const writes = panelSource.match(/scrollTop\s*=/g) ?? []
    expect(writes.length).toBe(0)
  })

  it('the tail accumulates (poll extends, never replaces) and pages backward natively', () => {
    // The 「刷新即暂无对话内容」 fix: the poll merges by seq (no
    // same-watermark replace), and earlier pages prepend above the window
    // through the native session.page grammar (beforeSeq = the window's
    // first seq), anchored to the bottom.
    expect(followSource).toMatch(/loadEarlier/)
    expect(followSource).toMatch(/loadTranscriptPage/)
    expect(followSource).toMatch(/floorRef/)
    expect(followSource).toMatch(/scrollHeight/)
    expect(followSource).toMatch(/scrollTop/)
    const platformPath = fileURLToPath(new URL('../src/client/platform.ts', import.meta.url))
    const platformSource = readFileSync(platformPath, 'utf8')
    expect(platformSource).toMatch(/beforeSeq/)
    // The "load earlier" row lives ABOVE the list (older lives above), and
    // renders whenever the host says there is more — even over an EMPTY
    // window (a misaligned tail that folds to zero lines with hasMore must
    // still offer the way back; empty text with no button is a dead end).
    expect(cssSource).toMatch(/\.transcriptEarlierRow/)
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panelSource2 = readFileSync(panelPath, 'utf8')
    expect(panelSource2).toMatch(/transcriptEarlierRow/)
    expect(panelSource2).toMatch(/review\.loadEarlier/)
    // The paging row is OUTSIDE the empty/list conditional (visible over an
    // empty window), and the handler falls back to the window's first seq
    // when the host sends hasMore without a floorSeq (a visible button that
    // no-ops is the "点了没反应" bug).
    const pagingAt = panelSource2.indexOf('transcriptEarlierRow')
    const emptyAt = panelSource2.indexOf('review.transcriptEmpty')
    expect(pagingAt).toBeGreaterThan(-1)
    expect(emptyAt).toBeGreaterThan(-1)
    expect(pagingAt).toBeLessThan(emptyAt)
    expect(followSource).toMatch(/floorRef\.current \?\? eventsRef\.current/)
  })

  it('a failed earlier-page read is SAID (the button stays — tapping retries)', () => {
    // An old host without the page endpoint answers every click with
    // undefined: without this the button spins once and goes quiet (the
    // second "点了没反应"). The hook keeps hasMore, flags pageError, and
    // the row shows a quiet retry line under the button.
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panelSource = readFileSync(panelPath, 'utf8')
    expect(followSource).toMatch(/pageError/)
    expect(followSource).toMatch(/setPageError\(true\)/)
    expect(panelSource).toMatch(/pageError/)
    expect(panelSource).toMatch(/review\.loadEarlierFailed/)
  })

  it('the attachment busy line names the in-flight intake, never the ledger', () => {
    // A staging file is not in the ledger yet: naming the busy line from
    // settled chips is exactly the "传文件却显示图片压缩中" lie. The hook
    // tracks per-lane in-flight counts; every caller renders the helper.
    const composerPath = fileURLToPath(new URL('../src/client/board/composer-images.ts', import.meta.url))
    const composer = readFileSync(composerPath, 'utf8')
    expect(composer).toMatch(/busyKind/)
    expect(composer).toMatch(/busyKindOf\(/)
    const stripPath = fileURLToPath(new URL('../src/client/board/AttachmentStrip.tsx', import.meta.url))
    expect(readFileSync(stripPath, 'utf8')).toMatch(/attachBusyLabel/)
    for (const name of ['session-panel.tsx', 'RefineSection.tsx', 'TaskForm.tsx']) {
      const caller = readFileSync(fileURLToPath(new URL(`../src/client/board/${name}`, import.meta.url)), 'utf8')
      expect(caller).toContain('attachBusyLabel(attachments.busyKind)')
    }
    // No caller may still name the busy line from settled chips.
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    expect(readFileSync(panelPath, 'utf8')).not.toMatch(/attachedFiles\.length > 0 \? t\('review\.attachFileBusy'\)/)
  })

  it('the Agent row reads served-truth first, the applied ledger second (never a ghost field)', () => {
    // The host serves no preset read-back (no list field, no models-API
    // field, no projection) — a row reading only the host field shows
    // "部署默认" forever, however the session actually runs. The board
    // records every successful switch into the ledger; the row prefers a
    // served value when a future host serves one.
    const corePath = fileURLToPath(new URL('../src/core/controller.ts', import.meta.url))
    const core = readFileSync(corePath, 'utf8')
    expect(core).toMatch(/summary\.agentPreset \?\? applied/)
    const execPath = fileURLToPath(new URL('../src/core/execution.ts', import.meta.url))
    const exec = readFileSync(execPath, 'utf8')
    // Both apply sites report success (failures never fire — the session
    // kept its previous preset; recording it would be a lie).
    expect(exec.match(/onAgentApplied\?\.\(sessionId/g)?.length).toBe(2)
    const wiringPath = fileURLToPath(new URL('../src/client/index.ts', import.meta.url))
    const wiring = readFileSync(wiringPath, 'utf8')
    expect(wiring).toContain('onAgentApplied: (sessionId, preset)')
    expect(wiring).toContain('sessionAgentStore')
  })
})

describe('foldTranscript', () => {
  const base = { seq: 1, time: 1000 }

  /** A user/message event with the native flat shape. */
  function userMessage(id: string, text: string, sourceKind = 'user', extra: Record<string, unknown> = {}): TranscriptEvent {
    return {
      ...base,
      type: 'user/message',
      data: {
        id,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: sourceKind, ...extra },
      },
    }
  }

  it('folds user messages (flat shape) and assistant messages (wrapped message)', () => {
    const events: TranscriptEvent[] = [
      userMessage('m1', '你好'),
      {
        ...base,
        seq: 2,
        time: 2000,
        type: 'assistant/message',
        data: {
          turn: 1,
          step: 1,
          message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '你好，我是 agent' }] },
        },
      },
    ]
    expect(foldTranscript(events)).toEqual([
      { kind: 'message', id: 'm1', role: 'user', text: '你好', at: 1000 },
      { kind: 'message', id: 'm2', role: 'assistant', text: '你好，我是 agent', at: 2000 },
    ])
  })

  it('keeps durable image refs (the host-promoted form) and image-only messages', () => {
    const events: TranscriptEvent[] = [
      {
        ...base,
        type: 'user/message',
        data: {
          id: 'm1',
          role: 'user',
          source: { kind: 'user' },
          content: [
            { type: 'text', text: '看这张图' },
            // The stored (post-admission) shape: a durable ref, not bytes.
            { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', name: 'a.png', bytes: 10, width: 2, height: 2 } },
            { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png' } }, // dup → dropped
            { type: 'image', attachment: { mediaType: 'image/png' } }, // no id → skipped
          ],
        },
      },
      {
        ...base,
        seq: 2,
        type: 'user/message',
        data: { id: 'm2', role: 'user', source: { kind: 'user' }, content: [{ type: 'image', attachment: { attachmentId: 'att-2', mediaType: 'image/jpeg' } }] },
      },
    ]
    const lines = foldTranscript(events)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ kind: 'message', text: '看这张图', images: [{ attachmentId: 'att-1', mediaType: 'image/png', name: 'a.png' }] })
    // An image-only message is NOT dropped (empty text, one image).
    expect(lines[1]).toMatchObject({ kind: 'message', text: '', images: [{ attachmentId: 'att-2' }] })
  })

  it('turns system/plugin injections into context rows, never user bubbles', () => {
    const events: TranscriptEvent[] = [
      // AGENTS.md / skill / runtime-context injections (plugin source).
      userMessage('c1', '<system-reminder>instructions…</system-reminder>', 'plugin', { plugin: 'dsh-agent-instructions' }),
      userMessage('c2', 'Current runtime context…', 'plugin', { plugin: 'dsh-time-context', form: 'snapshot' }),
      // A notice-form injection carries a one-line summary.
      userMessage('c3', '…', 'plugin', { plugin: 'dsh-cron', form: 'notice', summary: 'cron: 每天 9 点任务已触发' }),
      // A real user message still becomes a bubble.
      userMessage('m1', '真正的问题', 'user'),
    ]
    expect(foldTranscript(events)).toEqual([
      { kind: 'context', id: 'c1', plugin: 'dsh-agent-instructions', summary: '', at: 1000 },
      { kind: 'context', id: 'c2', plugin: 'dsh-time-context', summary: '', at: 1000 },
      { kind: 'context', id: 'c3', plugin: 'dsh-cron', summary: 'cron: 每天 9 点任务已触发', at: 1000 },
      { kind: 'message', id: 'm1', role: 'user', text: '真正的问题', at: 1000 },
    ])
  })

  it('joins multiple text blocks and skips empty messages and non-message events', () => {
    const events: TranscriptEvent[] = [
      {
        ...base,
        type: 'user/message',
        data: { id: 'm1', role: 'user', content: [{ type: 'text', text: '  a ' }, { type: 'text', text: ' b ' }], source: { kind: 'user' } },
      },
      // Empty content and non-message events are skipped.
      { ...base, seq: 2, type: 'user/message', data: { id: 'm2', role: 'user', content: [], source: { kind: 'user' } } },
      { ...base, seq: 3, type: 'turn/start', data: { turn: 1 } },
      { ...base, seq: 4, type: 'tool/call', data: { name: 'bash' } },
      { ...base, seq: 5, type: 'tool/result', data: { message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 't', content: [] }] } } },
    ]
    expect(foldTranscript(events)).toEqual([
      { kind: 'message', id: 'm1', role: 'user', text: 'a\nb', at: 1000 },
    ])
  })

  it('falls back to the event sequence for messages without an id', () => {
    const events: TranscriptEvent[] = [
      { ...base, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } } },
    ]
    const folded = foldTranscript(events)
    expect(folded[0].kind).toBe('message')
    if (folded[0].kind === 'message') expect(folded[0].id).toBe('1')
  })

  it('returns an empty list for an empty or all-skipped event list', () => {
    expect(foldTranscript([])).toEqual([])
    expect(foldTranscript([{ ...base, type: 'turn/end', data: { turn: 1 } }])).toEqual([])
  })
})

describe('transcript usage', () => {
  const base = { seq: 1, time: 1000 }

  it('carries the native usage payload on assistant messages', () => {
    const events: TranscriptEvent[] = [
      {
        ...base,
        type: 'assistant/message',
        data: {
          turn: 1,
          step: 1,
          message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
          usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, reasoningTokens: 3 },
        },
      },
    ]
    const folded = foldTranscript(events)
    expect(folded[0].kind).toBe('message')
    if (folded[0].kind === 'message') {
      expect(folded[0].usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, reasoningTokens: 3 })
    }
  })

  it('sums usage across assistant messages, skipping optional fields when absent', () => {
    const lines = [
      { kind: 'message' as const, id: 'a', role: 'user' as const, text: 'q', at: 0 },
      { kind: 'message' as const, id: 'b', role: 'assistant' as const, text: '1', at: 1, usage: { inputTokens: 10, outputTokens: 5 } },
      { kind: 'context' as const, id: 'c', plugin: 'x', summary: '', at: 2 },
      { kind: 'message' as const, id: 'd', role: 'assistant' as const, text: '2', at: 3, usage: { inputTokens: 4, outputTokens: 1, cacheWriteTokens: 7, reasoningTokens: 2 } },
    ]
    expect(sumUsage(lines)).toEqual({
      inputTokens: 14,
      outputTokens: 6,
      cacheWriteTokens: 7,
      reasoningTokens: 2,
    })
    expect(sumUsage([lines[0]])).toBeUndefined()
  })

  it('the meter prefers whole-log projection totals over the paged-window sum', () => {
    // P7: `tokenUsage` is durable whole-log; the 30-message `sumUsage` is
    // only the fallback when the meter package is absent. The stats line
    // comes from `sessionStats` (turns/steps/times), never recomputed.
    const panelPath = fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url))
    const panel = readFileSync(panelPath, 'utf8')
    expect(panel).toMatch(/projections\?\.tokenUsage/)
    expect(panel).toMatch(/review\.usageTotal/)
    expect(panel).toMatch(/projections\?\.sessionStats/)
    expect(panel).toMatch(/review\.statsTurns/)
  })
})

describe('contextOccupancy / contextSegments / formatTokens', () => {
  it('computes the native percentage (rounded, clamped at 100)', () => {
    expect(contextOccupancy({ projectedTokens: 639_000, contextWindow: 1_000_000 }))
      .toEqual({ percent: 64, usedTokens: 639_000, contextWindow: 1_000_000 })
    expect(contextOccupancy({ projectedTokens: 2_000_000, contextWindow: 1_000_000 })?.percent).toBe(100)
    expect(contextOccupancy({ projectedTokens: 0, contextWindow: 1_000_000 })?.percent).toBe(0)
  })

  it('prefers projectedTokens and falls back to the bare provider sample', () => {
    expect(contextOccupancy({ pressureTokens: 100, contextWindow: 1_000 })?.usedTokens).toBe(100)
    expect(contextOccupancy({ pressureTokens: 100, projectedTokens: 250, contextWindow: 1_000 })?.usedTokens).toBe(250)
  })

  it('returns undefined until both a numerator and a capacity are known', () => {
    expect(contextOccupancy(undefined)).toBeUndefined()
    expect(contextOccupancy({})).toBeUndefined()
    expect(contextOccupancy({ pressureTokens: 100 })).toBeUndefined()
    expect(contextOccupancy({ contextWindow: 1_000 })).toBeUndefined()
  })

  it('falls back to one uncolored full-width segment without a breakdown', () => {
    const occupancy = { percent: 50, usedTokens: 500, contextWindow: 1_000 }
    expect(contextSegments(occupancy, undefined)).toEqual([{ key: 'total', className: undefined, width: 50 }])
  })

  it('splits the bar into colored segments by the breakdown composition', () => {
    const occupancy = { percent: 50, usedTokens: 500, contextWindow: 1_000 }
    const segments = contextSegments(occupancy, { systemTokens: 100, toolsTokens: 200, messageTokens: 300 })
    expect(segments).toEqual([
      { key: 'systemTokens', className: 'meterSystem', width: 50 * (100 / 600) },
      { key: 'toolsTokens', className: 'meterTools', width: 50 * (200 / 600) },
      { key: 'messageTokens', className: 'meterMessages', width: 50 * (300 / 600) },
    ])
  })

  it('drops buckets that contribute no tokens (including an all-empty breakdown)', () => {
    const occupancy = { percent: 50, usedTokens: 500, contextWindow: 1_000 }
    const segments = contextSegments(occupancy, { systemTokens: 0, toolsTokens: 0, messageTokens: 100 })
    expect(segments).toEqual([{ key: 'messageTokens', className: 'meterMessages', width: 50 }])
    expect(contextSegments(occupancy, { systemTokens: 0, toolsTokens: 0, messageTokens: 0 }))
      .toEqual([{ key: 'total', className: undefined, width: 50 }])
  })

  it('matches the native compact formatting (K/M with one decimal under 100)', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_000)).toBe('1K')
    expect(formatTokens(4_600)).toBe('4.6K')
    expect(formatTokens(16_800)).toBe('16.8K')
    expect(formatTokens(99_999)).toBe('100K')
    expect(formatTokens(465_000)).toBe('465K')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(2_500_000)).toBe('2.5M')
  })
})

describe('shouldFlipMenuUp', () => {
  /** A field 40px tall inside a 600px-tall modal. */
  const field = { top: 520, bottom: 560 }
  const modal = { top: 100, bottom: 700 }
  const VIEWPORT = 900

  it('keeps the default downward opening when there is enough room below', () => {
    // 140px below the field — less than the 284px needed (menu 280 + gap 4).
    expect(shouldFlipMenuUp(field, modal, VIEWPORT)).toBe(true)
    const roomyField = { top: 200, bottom: 240 }
    expect(shouldFlipMenuUp(roomyField, modal, VIEWPORT)).toBe(false)
  })

  it('opens upward when the bottom of the modal clips the menu', () => {
    // Field flush with the modal's bottom edge: nothing below, everything
    // above → flip.
    const flush = { top: 660, bottom: 700 }
    expect(shouldFlipMenuUp(flush, modal, VIEWPORT)).toBe(true)
  })

  it('does not flip when both directions clip (downward stays the default)', () => {
    // 100px of modal above and 40px below: above > below, so it flips
    // (the better of two bad options).
    const squeezed = { top: 200, bottom: 660 }
    expect(shouldFlipMenuUp(squeezed, modal, VIEWPORT)).toBe(true)
    // Truly symmetric: more room below than above → keep downward even
    // though it clips.
    const asymmetric = { top: 120, bottom: 680 }
    expect(shouldFlipMenuUp(asymmetric, modal, VIEWPORT)).toBe(false)
  })

  it('falls back to viewport judgment without a clipping ancestor', () => {
    // No modal: the viewport bottom is the boundary.
    const nearBottom = { top: 820, bottom: 860 }
    expect(shouldFlipMenuUp(nearBottom, undefined, VIEWPORT)).toBe(true)
    const middle = { top: 300, bottom: 340 }
    expect(shouldFlipMenuUp(middle, undefined, VIEWPORT)).toBe(false)
  })

  it('respects a custom menu height', () => {
    // 140px below the field: a short menu fits, a tall one flips.
    expect(shouldFlipMenuUp(field, modal, VIEWPORT, 120)).toBe(false)
    expect(shouldFlipMenuUp(field, modal, VIEWPORT, 200)).toBe(true)
  })
})

describe('latestSessionTodos (session live to-do readout)', () => {
  it('reads the newest todo/write snapshot (last write wins)', () => {
    const events = [
      { type: 'todo/write', seq: 1, data: { todos: [{ content: '旧', status: 'pending' }] } },
      { type: 'todo/write', seq: 2, data: { todos: [{ content: '新', status: 'in_progress' }, { content: '完成', status: 'completed' }] } },
    ]
    const todos = latestSessionTodos(events)
    expect(todos?.map(row => row.content)).toEqual(['新', '完成'])
    expect(isOpenTodo(todos![0])).toBe(true)
    expect(isOpenTodo(todos![1])).toBe(false)
  })

  it('returns undefined when the session never wrote a todo', () => {
    expect(latestSessionTodos([{ type: 'user/message', data: { id: 'm' } }])).toBeUndefined()
    expect(latestSessionTodos([])).toBeUndefined()
  })

  it('drops malformed rows and normalizes unknown statuses to pending', () => {
    const todos = latestSessionTodos([
      { type: 'todo/write', seq: 1, data: { todos: [{ content: '', status: 'x' }, { content: 'ok', status: 'weird' }, 'junk'] } },
    ])
    expect(todos).toEqual([{ content: 'ok', status: 'pending' }])
  })
})

describe('contextWorthOf (show only UNFINISHED context)', () => {
  const allDone = { todos: [{ content: 'a', status: 'completed' as const }, { content: 'b', status: 'completed' as const }] }

  it('hides a fully-completed todo list (the all-done still shows bug)', () => {
    expect(contextWorthOf(allDone)).toBe(false)
    expect(contextWorthOf({ todos: [] })).toBe(false)
    expect(contextWorthOf({})).toBe(false)
  })

  it('shows when any todo is still open, and keeps the done rows as progress context', () => {
    expect(contextWorthOf({ todos: [{ content: 'a', status: 'completed' as const }, { content: 'b', status: 'pending' as const }] })).toBe(true)
    expect(contextWorthOf({ todos: [{ content: 'a', status: 'in_progress' as const }] })).toBe(true)
  })

  it('shows only an ACTIVE goal; a non-active/completed goal is finished business', () => {
    expect(contextWorthOf({ goal: { active: true } })).toBe(true)
    expect(contextWorthOf({ goal: { active: false } })).toBe(false)
  })

  it('shows unfinished subagents; finished ones hide; an unknown status is treated as active', () => {
    expect(contextWorthOf({ subagents: [{ title: 'w', status: 'running' }] })).toBe(true)
    expect(contextWorthOf({ subagents: [{ title: 'w' }] })).toBe(true)
    expect(contextWorthOf({ subagents: [{ title: 'w', status: 'finished' }] })).toBe(false)
    expect(contextWorthOf({ subagents: [{ title: 'w', status: 'done' }] })).toBe(false)
    // The native activity word the host bridge maps ('inactive' = finished).
    expect(contextWorthOf({ subagents: [{ title: 'w', status: 'inactive' }] })).toBe(false)
  })
})

describe('session context panel row grammar (badge never spills over the text)', () => {
  const cssPath = fileURLToPath(new URL('../src/client/board.module.css', import.meta.url))
  const cssSource = readFileSync(cssPath, 'utf8')

  function ruleOf(name: string): string {
    const lines = cssSource.split('\n')
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
    }
    throw new Error(`rule ".${name}" not found in board.module.css`)
  }

  const tsxPath = fileURLToPath(new URL('../src/client/board/SessionContextBlock.tsx', import.meta.url))
  const tsxSource = readFileSync(tsxPath, 'utf8')

  it('the badge rides the FIRST text line (never centered over a multi-line block)', () => {
    expect(ruleOf('sessionContextRow')).toContain('align-items: flex-start')
    expect(ruleOf('sessionContextRow')).not.toContain('align-items: center')
  })

  it('the badge chip never shrinks below its label (a squeezed box would overflow)', () => {
    expect(ruleOf('sessionContextGoalOn')).toContain('flex: none')
    expect(ruleOf('sessionContextSubagent')).toContain('flex: none')
  })

  it('the badge label rides the shared Chip two-slot grammar, never a naked .chip', () => {
    // The goal/subagent badges must flow through <Chip> (label into .chipBody,
    // ellipsis instead of overflow); a naked css.chip + nowrap is the root
    // cause of the label spilling over the goal paragraph.
    expect(tsxSource).toContain('<Chip fill={false} className={css.sessionContextGoalOn}>')
    expect(tsxSource).toContain('<Chip fill={false} className={css.sessionContextSubagent}>')
    expect(tsxSource).not.toContain('`${css.chip}')
  })

  it('the goal row is the interactive strip when verbs are served (official GoalBar grammar)', () => {
    // 暂停/开启/修改/删除 ride the official `remote.goals` verbs with the
    // call-time CAS ref; the legacy read-only row stays only for hosts
    // without the face. The strip mirrors GoalBar: complete/cleared render
    // nothing, one action at a time, failures inline.
    expect(tsxSource).toContain('<GoalStrip')
    expect(tsxSource).toContain('controller.goalVerbs(sessionId)')
    const stripPath = fileURLToPath(new URL('../src/client/board/goal-strip.tsx', import.meta.url))
    const strip = readFileSync(stripPath, 'utf8')
    expect(strip).toContain('clearedGoalId')
    expect(strip).toContain("phase === 'complete'")
    expect(strip).toContain('pendingRef')
    expect(strip).toContain('verbs.pause')
    expect(strip).toContain('verbs.resume')
    expect(strip).toContain('verbs.clear')
    expect(strip).toContain('verbs.edit')
    expect(ruleOf('goalStrip')).toContain('flex-wrap: wrap')
    expect(ruleOf('goalStripActions')).toContain('flex: none')
  })
})
