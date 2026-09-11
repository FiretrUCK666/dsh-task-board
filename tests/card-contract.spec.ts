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
import { runningStateLabel, settledChipLabel, blockedAutomation, showsBlockedChip, showsSessionBlocked } from '../src/client/board/TaskCard.tsx'
import { createTask, withSchedule } from '../src/core/tasks.ts'
import { withSessionRules } from '../src/core/automation.ts'

const cssPath = fileURLToPath(new URL('../src/client/board.module.css', import.meta.url))
const source = readFileSync(cssPath, 'utf8')

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

describe('design-system contracts: pill geometry + frosted canvas', () => {
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

  it('frosted canvas: the board blurs the skin wallpaper behind it', () => {
    // Dense work surface over any wallpaper: both the standard and the
    // -webkit line must survive (older Chromium/WebKit need the prefix).
    expect(source).toContain('-webkit-backdrop-filter: blur(')
    expect(source).toContain('backdrop-filter: blur(')
  })

  it('compact rhythm derives from the single strip token (symmetric by construction)', () => {
    expect(source).toContain('row-gap: var(--dsh-tb-strip-gap)')
    expect(source).toContain('padding: var(--dsh-tb-strip-gap) 0')
  })
})
describe('card chip label composition', () => {
  function useLanguage(lang: string): void {
    vi.stubGlobal('document', { documentElement: { lang } })
  }

  afterEach(() => { vi.unstubAllGlobals() })

  it('running state: plain running keeps a short one-word label (zh)', () => {
    useLanguage('zh')
    expect(runningStateLabel(undefined)).toBe('进行中')
  })

  it('running state: each user-blocking kind is named (zh)', () => {
    useLanguage('zh')
    expect(runningStateLabel('approval')).toBe('等待回应 · 权限审批')
    expect(runningStateLabel('plan-review')).toBe('等待回应 · 计划确认')
    expect(runningStateLabel('question')).toBe('等待回应 · 提问')
  })

  it('running state: english mirror', () => {
    useLanguage('en')
    expect(runningStateLabel(undefined)).toBe('Running')
    expect(runningStateLabel('approval')).toBe('Waiting for you · Approval')
    expect(runningStateLabel('plan-review')).toBe('Waiting for you · Plan review')
    expect(runningStateLabel('question')).toBe('Waiting for you · Question')
  })

  it('refining never reads as running: the chip uses display truth, the guard stays on hasOpenRun', () => {
    // 一点完善整卡变进行中 — the spinner chip must ride display truth
    // (`executing`, refine excluded, now via card-view.ts) while quick-run
    // blocking keeps the open-round gate (`hasOpenRun` via view.running).
    const cardPath = fileURLToPath(new URL('../src/client/board/TaskCard.tsx', import.meta.url))
    const card = readFileSync(cardPath, 'utf8')
    const viewPath = fileURLToPath(new URL('../src/client/board/card-view.ts', import.meta.url))
    const view = readFileSync(viewPath, 'utf8')
    expect(card).toMatch(/showingRunning \?/)
    expect(view).toMatch(/executing\(task\)/)
    expect(view).toMatch(/hasOpenRun\(task\)/)
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
    expect(showsBlockedChip(armedEmpty)).toBe(true)
    const armedReady = withSchedule(
      createTask({ title: 'A', description: '', prompt: 'run' }, at, 'a'),
      { enabled: true, cron: '* * * * *', nextRunAt: undefined }, at,
    )
    expect(showsBlockedChip(armedReady)).toBe(false)
    expect(showsBlockedChip(createTask({ title: 'A', description: '', prompt: '' }, at, 'a'))).toBe(false)
  })

  it('session-blocked: an enabled usePrompt rule with an empty prompt blocks, custom text never does', () => {
    const at = 1_700_000_000_000
    const usePromptRule = {
      id: 'r1', sessionId: 's-1', instruction: '', usePrompt: true,
      trigger: 'cron' as const, cron: '* * * * *', send: 'queue' as const, enabled: true,
    }
    const blocked = withSessionRules(createTask({ title: 'A', description: '', prompt: '' }, at, 'a'), [usePromptRule])
    expect(showsSessionBlocked(blocked)).toBe(true)
    expect(blockedAutomation(blocked)).toBe(true)
    const customRule = {
      id: 'r1', sessionId: 's-1', instruction: 'do it', trigger: 'cron' as const,
      cron: '* * * * *', send: 'queue' as const, enabled: true,
    }
    const custom = withSessionRules(createTask({ title: 'A', description: '', prompt: '' }, at, 'a'), [customRule])
    expect(showsSessionBlocked(custom)).toBe(false)
    expect(blockedAutomation(custom)).toBe(false)
    const off = withSessionRules(createTask({ title: 'A', description: '', prompt: '' }, at, 'a'),
      [{ ...usePromptRule, enabled: false }])
    expect(showsSessionBlocked(off)).toBe(false)
  })

  it('blocked automation owns the slot: one cause, one chip', () => {
    const at = 1_700_000_000_000
    const both = withSessionRules(withSchedule(
      createTask({ title: 'A', description: '', prompt: '' }, at, 'a'),
      { enabled: true, mode: 'chain', cron: '', nextRunAt: undefined }, at,
    ), [{ id: 'r1', sessionId: 's-1', instruction: '', usePrompt: true, trigger: 'cron' as const, cron: '* * * * *', send: 'queue' as const, enabled: true }])
    // Task-level AND session-level blocked agree — still a single slot.
    expect(blockedAutomation(both)).toBe(true)
    expect(showsBlockedChip(both)).toBe(true)
    expect(showsSessionBlocked(both)).toBe(true)
  })
})
