/**
 * Dialog focus contract (client/board/dialog-focus.ts + its three readers):
 * the shared modal skeleton owns the whole focus loop — Dialog, TaskDetail
 * and SessionFrame all read the ONE hook, none manages focus on its own.
 * Source-text pins (jsdom render coverage would duplicate the trap logic
 * instead of pinning the single implementation).
 */
import { describe, expect, it } from 'vitest'
import { pageCss } from './panel-harness.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const hookPath = fileURLToPath(new URL('../src/client/design/dialog-focus.ts', import.meta.url))
const hook = readFileSync(hookPath, 'utf8')
const dialogPath = fileURLToPath(new URL('../src/client/design/Dialog.tsx', import.meta.url))
const dialog = readFileSync(dialogPath, 'utf8')
const detailPath = fileURLToPath(new URL('../src/client/board/TaskDetail.tsx', import.meta.url))
const detail = readFileSync(detailPath, 'utf8')
const framePath = fileURLToPath(new URL('../src/client/board/SessionFrame.tsx', import.meta.url))
const frame = readFileSync(framePath, 'utf8')
const createSheetPath = fileURLToPath(new URL('../src/client/item/item-create-dialog.tsx', import.meta.url))
const createSheet = readFileSync(createSheetPath, 'utf8')
const palettePath = fileURLToPath(new URL('../src/client/item/command-palette.tsx', import.meta.url))
const palette = readFileSync(palettePath, 'utf8')

describe('useDialogFocus (one implementation, three surfaces)', () => {
  it('enters on the declared control, else the first control, else the panel', () => {
    expect(hook).toContain('[data-autofocus]')
    expect(hook).toContain('focusFirst(')
    expect(hook).toContain('visible[0]')
  })

  it('returns to the opener, else falls back to the board box (never strands on body)', () => {
    expect(hook).toContain('const previous = document.activeElement')
    expect(hook).toContain('document.contains(previous)')
    expect(hook).toContain('[data-dsh-taskboard-view]')
  })

  it('filters invisible controls out of the loop (hidden/aria-hidden/display-none)', () => {
    expect(hook).toContain("element.type === 'hidden'")
    expect(hook).toContain('aria-hidden="true"')
    expect(hook).toContain("style.display !== 'none'")
  })

  it('a declared target joins only through the visible set (no blind focus)', () => {
    expect(hook).toContain('visible.includes(declared)')
  })

  it('re-aims on identity swaps without touching the return chain', () => {
    expect(hook).toContain('focusKey')
    expect(hook).toContain('focusFirst(')
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

  it('every surface that declares aria-modal reads the hook (no second implementation)', () => {
    // FIVE, NOT THREE. The list panel's two overlays also declare `aria-modal`
    // and were not on it: Tab walked out of both into the list behind the mask,
    // and the new-row sheet dropped focus on `<body>` when it closed. A surface
    // that makes the promise has to be in this loop — that is the whole point of
    // having one implementation to read.
    for (const source of [dialog, detail, frame, createSheet, palette]) {
      expect(source).toContain('useDialogFocus(')
      expect(source).toContain('aria-modal="true"')
      expect(source).toContain('onKeyDown={')
    }
    // The panel-hosted ones trap Tab inside their own panel element; the two
    // design-system shells put `tabIndex={-1}` on it so the mount target is
    // reachable. Both are the hook's contract, not a per-surface choice.
    for (const source of [dialog, detail, frame]) expect(source).toContain('tabIndex={-1}')
    for (const source of [dialog, detail, frame, createSheet, palette]) {
      expect(source).not.toContain("addEventListener('keydown'")
    }
  })

  it('Escape rides the shared stack, never a per-surface copy', () => {
    // ONE LAYER, ONE ESCAPE. A surface that closes ITSELF on Escape has taken the
    // stack's job, and the layer behind it stops hearing its own.
    //
    // An INNER layer may still read the key for itself — the new-row sheet's card
    // naming field cancels the naming step and calls `stopPropagation`, which is
    // exactly how a nested layer yields to the one above it. So this pins the
    // CLOSING path, not the string: both sheets register with the stack, and
    // neither closes itself from an Escape branch.
    for (const source of [createSheet, palette]) {
      expect(source).toContain('useEscapeStack(')
      expect(source).not.toMatch(/key !== 'Escape'[\s\S]{0,140}?onClose\(\)/)
      expect(source).not.toMatch(/key === 'Escape'[\s\S]{0,140}?onClose\(\)/)
    }
  })

  it('the Dialog shell labels its title for assistive tech', () => {
    expect(dialog).toContain('aria-labelledby={title !== undefined ? titleId : undefined}')
    expect(dialog).toContain('<h2 id={titleId}')
    expect(dialog).toContain('useEscapeStack(onClose)')
  })

  it('initial focus is declared, never raced (no native autoFocus in Dialog subtrees)', () => {
    expect(hook).toContain('[data-autofocus]')
    const boardPath = fileURLToPath(new URL('../src/client/board/TaskBoard.tsx', import.meta.url))
    const board = readFileSync(boardPath, 'utf8')
    // No remaining board Dialog needs declared focus (the hook's first-control
    // fallback owns them) — but native autoFocus must never sneak back in.
    expect(board).not.toContain('autoFocus')
    const presetsPath = fileURLToPath(new URL('../src/client/board/RunPresetManager.tsx', import.meta.url))
    const presets = readFileSync(presetsPath, 'utf8')
    expect(presets).toContain('data-autofocus')
    expect(presets).not.toContain('autoFocus')
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

describe('the overlay family composes the shared chrome', () => {
  /* THE CARD IS NOT THE PANEL'S. Background, border, radius, shadow, the flex
     column, `margin: auto` centring and the height cap all belong to the overlay
     FAMILY and are declared once, on `.modal` in `design/components.module.css`.
     A surface panel supplies only what is its own — `.detail` its 640px cap,
     `.review` its 880px cap and its container.

     So a call site has to apply BOTH classes, and forgetting one is silent: the
     panel still renders, still holds all its content, and comes out as a
     transparent, un-centred block with the board showing through it. That is
     exactly what happened when the chrome was moved out of the board's sheet —
     the rule had covered `.modal, .detail, .review` together, the move turned it
     into a class, and two call sites were not updated. No gate could see it:
     `verify-design-docs.mjs` checks that `css.detail` EXISTS in the sheet its
     alias resolves to, and it did.

     These two assertions are the invariant that was missing. The first says the
     call sites compose; the second says the panel classes do NOT declare the
     chrome themselves — together they mean the composition is both required and
     present, so a panel can never come out half-dressed again. */
  const boardSheet = pageCss('board')

  /** The declaration block of a top-level class, comments stripped. */
  function ruleBody(sheet: string, name: string): string {
    const withoutComments = sheet.replace(/\/\*[\s\S]*?\*\//g, '')
    const at = withoutComments.indexOf(`\n.${name} {`)
    expect(at, `.${name} 在表里不存在`).toBeGreaterThanOrEqual(0)
    return withoutComments.slice(at, withoutComments.indexOf('}', at))
  }

  /** Does this panel's markup apply the shared chrome alongside its own class?
   *  Pure, so the assertion below can be shown to bite on a planted input rather
   *  than only on the files as they happen to stand. */
  function composesChrome(src: string, own: string): boolean {
    return src.includes('className={`${components.modal} ${css.' + own + '}`}')
  }

  /** And the MASK, which is the other half of the same pair. Losing it is the
   *  same visible failure — a panel with no dimmed stage behind it, positioned
   *  against whatever ancestor happens to be positioned — so the invariant covers
   *  both, not just the one that was broken first. */
  function composesBackdrop(src: string): boolean {
    return src.includes('className={components.modalBackdrop}')
  }

  it('the composition check bites (planted both ways)', () => {
    // A checker that answers the same thing on a good and a bad input is not a
    // checker. This is the planted pair — the bad one is what shipped, verbatim.
    expect(composesChrome('<div className={`${components.modal} ${css.detail}`}>', 'detail')).toBe(true)
    expect(composesChrome('<div className={css.detail}>', 'detail')).toBe(false)
    expect(composesChrome('<div className={`${css.detail}`}>', 'detail')).toBe(false)
    // And the twin that must NOT be accepted: the right classes in the wrong place.
    expect(composesChrome('<div className={`${css.detail}`} data-x={components.modal}>', 'detail')).toBe(false)
    // The mask's half of the pair, planted the same way.
    expect(composesBackdrop('<div className={components.modalBackdrop}>')).toBe(true)
    expect(composesBackdrop('<div className={css.detail}>')).toBe(false)
    expect(composesBackdrop('<div className={`${components.modalBackdrop} x`}>')).toBe(false)
  })

  it('every surface panel applies the chrome AND the mask', () => {
    for (const [who, src, own] of [
      ['TaskDetail', detail, 'detail'],
      ['SessionFrame', frame, 'review'],
    ] as const) {
      expect(composesChrome(src, own), `${who} 的面板没挂共享 chrome，会画成一块透明的、不居中的东西`)
        .toBe(true)
      expect(composesBackdrop(src), `${who} 的外层没挂遮罩，浮层会对着随便哪个定位祖先摆`)
        .toBe(true)
    }
  })

  it('the panel classes own only their sizing, so the chrome has to come from somewhere', () => {
    for (const own of ['detail', 'review']) {
      const body = ruleBody(boardSheet, own)
      // If any of these ever move back into the panel class, this assertion is
      // telling the reader that the composition above is now redundant — decide
      // which home the chrome has, do not keep both.
      expect(body, `.${own} 自己声明了卡片的一部分，chrome 就有了两个家`)
        .not.toMatch(/background|box-shadow|border-radius|margin:\s*auto|flex-direction/)
    }
  })
})
