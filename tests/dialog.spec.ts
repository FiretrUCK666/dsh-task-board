/**
 * Dialog focus contract (client/board/dialog-focus.ts + its three readers):
 * the shared modal skeleton owns the whole focus loop — Dialog, TaskDetail
 * and SessionFrame all read the ONE hook, none manages focus on its own.
 * Source-text pins (jsdom render coverage would duplicate the trap logic
 * instead of pinning the single implementation).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const hookPath = fileURLToPath(new URL('../src/client/board/dialog-focus.ts', import.meta.url))
const hook = readFileSync(hookPath, 'utf8')
const dialogPath = fileURLToPath(new URL('../src/client/board/Dialog.tsx', import.meta.url))
const dialog = readFileSync(dialogPath, 'utf8')
const detailPath = fileURLToPath(new URL('../src/client/board/TaskDetail.tsx', import.meta.url))
const detail = readFileSync(detailPath, 'utf8')
const framePath = fileURLToPath(new URL('../src/client/board/SessionFrame.tsx', import.meta.url))
const frame = readFileSync(framePath, 'utf8')

describe('useDialogFocus (one implementation, three surfaces)', () => {
  it('enters on the first control and falls back to the panel itself', () => {
    expect(hook).toContain('controls[0].focus()')
    expect(hook).toContain('panel?.focus()')
  })

  it('cycles Tab inside the panel (both directions, control-less panels hold)', () => {
    expect(hook).toContain("if (event.key !== 'Tab') return")
    expect(hook).toContain('event.shiftKey && document.activeElement === first')
    expect(hook).toContain('!event.shiftKey && document.activeElement === last')
  })

  it('returns focus to whoever held it (guarded against unmounted triggers)', () => {
    expect(hook).toContain('const previous = document.activeElement')
    expect(hook).toContain('document.contains(previous)')
    expect(hook).toContain('previous.focus({ preventScroll: true })')
  })

  it('all three surfaces read the hook (no second implementation)', () => {
    for (const source of [dialog, detail, frame]) {
      expect(source).toContain('useDialogFocus(')
      expect(source).toContain('tabIndex={-1}')
      expect(source).toContain('aria-modal="true"')
      expect(source).toContain('onKeyDown={')
    }
    expect(dialog).not.toContain("addEventListener('keydown'")
    expect(detail).not.toContain("addEventListener('keydown'")
    expect(frame).not.toContain("addEventListener('keydown'")
  })

  it('the Dialog shell labels its title for assistive tech', () => {
    expect(dialog).toContain('aria-labelledby={title !== undefined ? titleId : undefined}')
    expect(dialog).toContain('<h2 id={titleId}')
    expect(dialog).toContain('useEscapeStack(onClose)')
  })
})

describe('ConfirmDialog destructive grammar (same overlay family)', () => {
  const confirmPath = fileURLToPath(new URL('../src/client/board/ConfirmDialog.tsx', import.meta.url))
  const confirm = readFileSync(confirmPath, 'utf8')

  it('renders cancel first (safe default focus) and the danger action last', () => {
    // The Dialog focus loop lands on the FIRST control — cancel must own it,
    // so Enter never fires the destructive action by accident.
    const cancelAt = confirm.indexOf('onClick={onCancel}')
    const confirmAt = confirm.indexOf('onClick={onConfirm}')
    expect(cancelAt).toBeGreaterThanOrEqual(0)
    expect(confirmAt).toBeGreaterThan(cancelAt)
    expect(confirm).toContain("variant={danger ? 'danger' : 'primary'}")
  })

  it('rides the shared Dialog (backdrop-cancel, Escape, focus loop inherited)', () => {
    expect(confirm).toContain('<Dialog title={title} label={title} onClose={onCancel} portal>')
  })
})
