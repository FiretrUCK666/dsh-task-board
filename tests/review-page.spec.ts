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
  it('the interaction card is shrinkable and sits on the rail 14px box', () => {
    const card = ruleOf('interactionCard')
    expect(card).toContain('min-width: 0')
    expect(card).toContain('margin: 0 14px 2px')
  })

  it('HEIGHT CONTRACT: the interaction card is capped, its body scrolls, its actions stay pinned', () => {
    const card = ruleOf('interactionCard')
    expect(card).toContain('max-height: min(320px, 40vh)')
    expect(card).toContain('overflow: hidden')
    // The body is the scroll slot (never the card itself): long plan/question
    // text scrolls inside while the action row remains visible at the bottom.
    const body = ruleOf('interactionCardBody')
    expect(body).toContain('overflow-y: auto')
    expect(body).toContain('min-height: 0')
  })

  it('the rail clips its own box — nothing can spill past and cover other UI', () => {
    expect(ruleOf('reviewRail')).toContain('overflow: hidden')
  })

  it('action rows wrap instead of bursting the card right edge', () => {
    const actions = ruleOf('interactionActions')
    expect(actions).toContain('flex-wrap: wrap')
  })

  it('the scroll region and the composer stay inside the rail content box', () => {
    expect(ruleOf('sessionRailScroll')).toContain('min-width: 0')
    // The rail owns ONE 12px vertical rhythm; each segment keeps only its
    // own 14px content box (the composer's bottom breathing stays its own).
    expect(ruleOf('reviewComposer')).toContain('padding: 0 14px 12px')
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

  it('the rail owns ONE scroll body; the composer is its only pinned element', () => {
    // The height contract that ends the whole squeeze-and-clip family: the
    // composer is visible at ANY rail height because it is the only fixed
    // segment, and everything else is reachable because it scrolls in ONE
    // body. Expansion can only ever add scrollable height.
    const scroll = ruleOf('sessionRailScroll')
    expect(scroll).toMatch(/flex:\s*1/)
    expect(scroll).toMatch(/min-height:\s*0/)
    expect(scroll).toMatch(/overflow-y:\s*auto/)
    expect(ruleOf('reviewComposer')).toMatch(/flex:\s*none/)
    // The scroll body owns the rail's 14px inset (the single-scrollbar
    // grammar); segments inside it must NOT add a second horizontal inset.
    expect(scroll).toMatch(/padding:\s*12px 14px 10px/)
    expect(ruleOf('sessionFacts')).not.toMatch(/padding:\s*0 14px/)
    expect(ruleOf('reviewThreadHeader')).not.toMatch(/padding:\s*0 14px/)
    // Inside the rail the interaction card drops its margin for the same law.
    expect(cssSource).toMatch(/\.sessionRailScroll \.interactionCard\s*\{[^}]*margin:\s*0 0 2px/)
    // The rail itself clips nothing away from reach: its only children are
    // the scroll body and the composer.
    expect(ruleOf('reviewRail')).toContain('overflow: hidden')
  })

  it('the stacked layout never re-declares the scroll model (one model, two geometries)', () => {
    const block = stacked()
    // The base rail IS the scroll grammar — a stacked-mode re-fork of it is
    // exactly the per-mode drift this contract forbids.
    expect(block).not.toMatch(/\.sessionRailScroll\s*\{/)
    // The two regions share the panel height vertically; the page itself
    // never scrolls as one.
    expect(block).toMatch(/\.reviewBody\s*\{[^}]*overflow: hidden/)
    expect(block).toMatch(/\.reviewRail\s*\{[^}]*order: 1/)
    expect(block).toMatch(/\.reviewMain\s*\{[^}]*order: 2/)
    expect(ruleIn(block, '.reviewRail')).toMatch(/flex: 1 1 \d+%/)
    expect(ruleIn(block, '.reviewMain')).toMatch(/flex: 1 1 \d+%/)
    // No container/viewport unit for the height share (the board box is
    // inline-size only, so a block container unit would silently become one).
    expect(block).not.toMatch(/(max-height|flex-basis|height):\s*[\d.]+(cqh|cqb|vh|dvh)/)
    // The conversation keeps its own scroller in the stacked form too.
    expect(ruleIn(block, '.reviewTranscriptScroll')).toMatch(/overflow-y:\s*auto/)
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

  it('the header splits into a title line + ONE tools line, close at the top-right corner', () => {
    const block = stacked()
    // Line 1: the title alone. The × rides the panel's TOP-RIGHT CORNER as an
    // absolutely-positioned element (where a finger looks for it) and the
    // title reserves its gutter, so the close stays on line one no matter how
    // many lines the title wraps into.
    expect(ruleIn(block, '.reviewTitleWrap')).toMatch(/flex: 1 1 100%/)
    expect(ruleIn(block, '.reviewTitleWrap')).toMatch(/padding-right:\s*32px/)
    expect(block).toMatch(/\.reviewHeader\s*\{[^}]*flex-wrap:\s*wrap/)
    expect(block).toMatch(/\.reviewHeader\s*\{[^}]*position:\s*relative/)
    const close = ruleIn(block, '.reviewHeader > .iconButton')
    expect(close).toMatch(/position:\s*absolute/)
    expect(close).toMatch(/right:\s*14px/)
    // Line 2: context head left (information about the conversation), actions
    // right. The cluster takes the leftover line width and right-aligns its
    // content, so it sits at the same x with or without the context block.
    expect(ruleIn(block, '.reviewHeaderContext')).toMatch(/flex: 1 1 auto/)
    expect(ruleIn(block, '.reviewActions')).toMatch(/flex: 1 1 auto/)
    expect(ruleIn(block, '.reviewActions')).toMatch(/justify-content:\s*flex-end/)
  })

  it('a header-anchored context expansion is CAPPED and scrolls (never eats the screen)', () => {
    // An in-flow header expansion without a cap grew past the whole screen
    // and pushed every function out of reach (「上下文占满屏幕把上面的挤掉」).
    const panel = ruleIn(stacked(), '.reviewHeaderContext .sessionContextPanel')
    expect(panel).toMatch(/position:\s*static/)
    expect(panel).toMatch(/max-height:\s*240px/)
    expect(panel).toMatch(/overflow-y:\s*auto/)
  })

  it('the review title wraps in flow — never a clamp that paints outside its box', () => {
    const title = ruleIn(stacked(), '.reviewTitle')
    expect(title).toMatch(/white-space:\s*normal/)
    expect(title).toMatch(/overflow-wrap:\s*anywhere/)
    // `-webkit-line-clamp` belongs to the TRUNCATING grammar and needs
    // `overflow: hidden`; paired with `overflow: visible` it reserves a 2-line
    // box while painting 5 lines OUTSIDE it — the title drew over the
    // comments below. A wrapping title must simply grow its box.
    expect(title).not.toMatch(/line-clamp/)
    expect(title).not.toMatch(/overflow:\s*visible/)
  })

  it('the header action cluster is same-height (24px pills + 24px close)', () => {
    // 「同一排控件同级高」: a 30px circle beside 24px pills is the misalignment
    // the eye reads as sloppiness.
    expect(cssSource).toMatch(/\.reviewHeader \.iconButton\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px/)
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

  it('the rail head is STICKY with a capped, internally-scrolling body', () => {
    // The desktop reads as "config pinned on top, comments scroll beneath"
    // WITHOUT a second scroll root; the cap is what makes sticky safe — a
    // pinned block taller than its scrollport would cover everything.
    const head = ruleOf('sessionRailHead')
    expect(head).toMatch(/position:\s*sticky/)
    expect(head).toMatch(/top:\s*0/)
    expect(head).toMatch(/max-height:\s*60%/)
    expect(head).toMatch(/background:\s*var\(--dsh-tb-surface-float\)/)
    const body = ruleOf('sessionRailHeadBody')
    expect(body).toMatch(/overflow-y:\s*auto/)
    expect(body).toMatch(/min-height:\s*0/)
    // The fold row itself never scrolls away (the body absorbs overflow).
    expect(cssSource).toMatch(/\.sessionRailHead > \.detailSection\s*\{[^}]*min-height:\s*0/)
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
    // No hand-rolled scrollTop pinning left in the panel (one mechanism).
    expect(panelSource).not.toMatch(/scrollTop = \w+\.scrollHeight/)
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
})
