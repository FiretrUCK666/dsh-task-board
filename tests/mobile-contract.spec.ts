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

  it('floating panels size to the board box, never vh/vw', () => {
    const modal = compact.slice(compact.indexOf('.modal,') >= 0 ? compact.indexOf('.modal,') : compact.indexOf('.modal'))
    // The compact override uses percentages (board-box relative)…
    expect(modal).toMatch(/max-height:\s*calc\(100%\s*-\s*\d+px\)/)
    // …and the compact block contains no vh/vw at all.
    expect(compact).not.toMatch(/\dvh/)
    expect(compact).not.toMatch(/\dvw/)
  })

  it('the backdrop scrolls a panel taller than the box', () => {
    const backdrop = compact.slice(compact.indexOf('.modalBackdrop'))
    expect(backdrop).toMatch(/overflow:\s*auto/)
  })

  it('action rows and the session row wrap instead of overflowing', () => {
    expect(compact).toMatch(/\.modalFooter[\s\S]*?flex-wrap:\s*wrap/)
    expect(compact).toMatch(/\.sessionRowTop[\s\S]*?flex-wrap:\s*wrap/)
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
