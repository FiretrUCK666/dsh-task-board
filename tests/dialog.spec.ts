/**
 * Dialog focus contract (client/board/Dialog.tsx): the shared modal skeleton
 * owns the whole focus loop — every caller inherits it, none manages focus
 * on its own. Source-text pins (jsdom render coverage would duplicate the
 * trap logic instead of pinning the single implementation).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dialogPath = fileURLToPath(new URL('../src/client/board/Dialog.tsx', import.meta.url))
const dialog = readFileSync(dialogPath, 'utf8')

describe('Dialog focus loop (one implementation, all callers)', () => {
  it('labels the modal for assistive tech (modal + labelledby)', () => {
    expect(dialog).toContain('aria-modal="true"')
    expect(dialog).toContain('aria-labelledby={title !== undefined ? titleId : undefined}')
    expect(dialog).toContain('<h2 id={titleId}')
  })

  it('enters on the first control and falls back to the panel itself', () => {
    expect(dialog).toContain('controls[0].focus()')
    expect(dialog).toContain('tabIndex={-1}')
  })

  it('cycles Tab inside the panel (both directions, control-less panels hold)', () => {
    expect(dialog).toContain("if (event.key !== 'Tab') return")
    expect(dialog).toContain('event.shiftKey && document.activeElement === first')
    expect(dialog).toContain('!event.shiftKey && document.activeElement === last')
  })

  it('returns focus to whoever held it (guarded against unmounted triggers)', () => {
    expect(dialog).toContain('const previous = document.activeElement')
    expect(dialog).toContain('document.contains(previous)')
    expect(dialog).toContain('previous.focus({ preventScroll: true })')
  })

  it('shares the ONE Escape stack (focus never double-handles Escape)', () => {
    expect(dialog).toContain('useEscapeStack(onClose)')
    expect(dialog).not.toContain("addEventListener('keydown'")
  })
})
