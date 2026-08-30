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
import { activeColumnIndexAt } from '../src/client/board/column-tabs.ts'
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

  it('columns become a horizontal scroll-snap track', () => {
    // The .columns override inside the compact block.
    const columns = compact.slice(compact.indexOf('.columns'))
    expect(columns).toMatch(/overflow-x:\s*auto/)
    expect(columns).toMatch(/scroll-snap-type:\s*x/)
    expect(columns).toMatch(/display:\s*flex/)
  })

  it('each compact column is wide enough to read + snaps', () => {
    const column = compact.slice(compact.indexOf('.column {'))
    expect(column).toMatch(/flex:\s*0 0/)
    expect(column).toMatch(/cqw/)
    expect(column).toMatch(/scroll-snap-align/)
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

  it('a column navigator strip exists, hidden by default and revealed compact', () => {
    // Desktop: all five columns share the screen, no tabs needed (base hides).
    expect(ruleOf('columnTabs')).toMatch(/display:\s*none/)
    // Compact: the tabs ride above the swipeable track.
    expect(compact).toMatch(/\.columnTabs\s*\{\s*\n?\s*display:\s*flex/)
    // A column is capped well under full width — roughly two columns plus the
    // next column's edge share a phone board (「一列占满整屏」 fix).
    const column = compact.slice(compact.indexOf('.column {'))
    expect(column).toMatch(/flex:\s*0 0 clamp\(\d+px,\s*\d+cqw,\s*3\d\dpx\)/)
    // FLIP flights pin the snap off so it cannot yank the animating card.
    expect(compact).toMatch(/\.columns\[data-flip-active\][\s\S]*?scroll-snap-type:\s*none/)
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

describe('session row overlap fix', () => {
  it('the workspace chip shrinks + ellipsizes (never pushes actions over the title)', () => {
    const ws = ruleOf('sessionRowWorkspace')
    expect(ws).toMatch(/flex:\s*0 1 auto/)
    expect(ws).toMatch(/min-width:\s*0/)
    expect(ws).toMatch(/text-overflow:\s*ellipsis/)
  })

  it('the detail title and board title are shrinkable', () => {
    expect(ruleOf('detailTitle')).toMatch(/min-width:\s*0/)
    expect(ruleOf('boardTitle')).toMatch(/min-width:\s*0/)
  })
})

describe('off-canvas entry fallback', () => {
  it('the fallback button is fixed + safe-area aware', () => {
    const fb = ruleOf('entryFallback')
    expect(fb).toMatch(/position:\s*fixed/)
    expect(fb).toMatch(/env\(safe-area-inset-bottom\)/)
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
