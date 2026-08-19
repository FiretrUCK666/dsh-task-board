/**
 * Card no-breakout CSS contract. The compact kanban card must never let any
 * text escape its box, whatever content lands inside it now or later. That
 * guarantee is enforced by the CSS in board.module.css; this spec freezes the
 * contract so a future refactor that removes or weakens any layer fails the
 * build instead of regressing the bug silently.
 *
 * Contract (three layers):
 *   1. the card box is a hard clip boundary (overflow: hidden);
 *   2. every text path inside the card truncates rather than stretching
 *      (min-width: 0 on every flex child, shredder-able cardTime, the chip
 *      body ellipsis wrapper, overflow-wrap on title/excerpt);
 *   3. chips may shrink but never exceed their container.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
  })

  it('badges row still wraps and can shrink', () => {
    const badges = expectRule('cardBadges')
    expect(badges).toContain('flex-wrap: wrap')
    expect(badges).toContain('min-width: 0')
  })
})
