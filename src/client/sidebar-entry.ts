/**
 * Sidebar entry injection.
 *
 * dsh's sidebar shell exposes no slot an external plugin can register into
 * (`sidebar.workspaces` / `sidebar.settings` are single-occupant and already
 * taken), so — following the established DOM-extension approach — the
 * entry row is injected between the shell's New Session button and the
 * workspace browser. The injection self-heals: a MutationObserver watches the
 * body (structure + drawer/rail classes) and re-adopts + re-paints the row
 * whenever the sidebar mounts, is wiped by a React re-render, or toggles
 * (re-insertion happens in the same frame, before paint, so no flicker). The
 * row's geometry is pure CSS (a full-width sidebar row), never mirrored from
 * the native button — a JS pixel mirror reads 0 while the drawer is closed and
 * leaves the row invisible (the flaky "button won't show" this design avoids).
 *
 * The row is plain DOM (no React tree) so it can never disturb the shell's
 * reconciliation; the board view it toggles is a separate React root mounted
 * in the center column (see board-mount.ts).
 */
import type { BoardController } from '../core/controller.ts'
import { t } from './locales.ts'
import css from './board.module.css'

/** The inline icon (the sidebar entry row). */
const ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M6.5 6.5v7"/></svg>`

/** Find the sidebar shell root element, or undefined while not yet mounted. */
function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  // Current shells wrap the sidebar UI: column > wrapper > root(logoRow owner).
  // Prefer the element that owns the logo row — the real sidebar UI root —
  // and fall back to the column's first child for legacy shells.
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined)
}

/** The New Session button: nested in the logo row on current shells, a direct child on legacy shells. */
function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement
  }
  return undefined
}

/** Build the entry row (a detached button; insert once the shell is up). */
function createEntry(controller: BoardController): HTMLButtonElement {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.dataset.dshTaskboardEntry = ''
  entry.className = css.entry
  entry.setAttribute('aria-label', t('entry.label'))
  entry.innerHTML = `<span class="${css.entryIcon}">${ICON}</span><span class="${css.entryLabel}">${t('entry.label')}</span>`
  entry.addEventListener('click', () => { controller.toggleBoard() })
  return entry
}

/** Re-insert the entry after the New Session row (before the browser region). */
function placeEntry(root: HTMLElement, entry: HTMLButtonElement): boolean {
  const button = newSessionButton(root)
  if (button === undefined) return false
  if (entry.parentElement !== root) {
    // Current shells nest the button inside the logo row: insert after that
    // row. Legacy shells keep the button as a direct child: insert after it.
    const row = button.closest('[class*="logoRow"]')
    if (row !== null && row.parentElement === root) {
      root.insertBefore(entry, row.nextElementSibling)
    } else if (button.parentElement === root) {
      root.insertBefore(entry, button.nextElementSibling)
    } else {
      root.appendChild(entry)
    }
  }
  return true
}

/**
 * Make the entry row the native New Session button's twin: adopt the native
 * button's OWN class list so the entry is styled by the exact same rules —
 * size, border, radius, background and every skin variable. A hand-copied
 * subset (a guessed height, a computed backgroundColor) is what made the row
 * a hair taller than the native button and blind to skin gradients (which
 * live in background-image, not background-color); copying the class removes
 * the guesswork — one source of truth, and it follows any skin automatically.
 * `css.entry` stays appended for the board-open ring and the inner icon/label
 * layout; the collapsed-rail CSS keeps the icon-only form.
 */
function syncEntrySurface(entry: HTMLButtonElement, root: HTMLElement): void {
  const button = newSessionButton(root)
  if (button === undefined) return
  const native = button.className.trim()
  entry.className = native === '' ? css.entry : `${native} ${css.entry}`
}

/**
 * Mount the sidebar entry row: wait for the shell sidebar to render, insert
 * the row once it appears, and self-heal on later React re-renders (the
 * sidebar root is re-queried on EVERY pass — never frozen — so a remounted
 * sidebar in a brand-new subtree is re-adopted instead of silently losing its
 * entry). There is deliberately NO floating corner fallback: the entry IS the
 * sidebar row; the board stays reachable through the shell's own sidebar on
 * every screen.
 * @param controller - the board controller the entry toggles.
 * @returns disposer removing the entry and its observer.
 */
export function mountSidebarEntry(controller: BoardController): () => void {
  const entry = createEntry(controller)
  let disposed = false

  /** One idempotent placement pass: adopt the CURRENT sidebar root (re-queried,
   *  never frozen — a remounted sidebar in a new subtree is re-adopted) and
   *  re-paint the surface. Cheap to call on every mutation. */
  const place = (): void => {
    if (disposed) return
    const root = sidebarRoot()
    if (root === undefined) return
    if (placeEntry(root, entry)) syncEntrySurface(entry, root)
  }

  // The shell re-renders its own way (boot settlement, pending UI swaps) and
  // toggles the drawer / rail via classes: watch structural changes (mount /
  // wipe of the row) AND attribute flips (collapse, drawer open/close) so the
  // row is re-adopted and re-painted the moment anything relevant moves.
  const observer = new MutationObserver(() => { place() })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'aria-hidden', 'hidden', 'data-sidebar-collapsed'],
  })

  // Reflect the board's open state on the row (active highlight).
  const unsubscribe = controller.subscribe(() => {
    entry.dataset.active = controller.getSnapshot().boardOpen ? 'true' : undefined
  })
  entry.dataset.active = controller.getSnapshot().boardOpen ? 'true' : undefined

  place()

  return () => {
    disposed = true
    observer.disconnect()
    unsubscribe()
    entry.remove()
  }
}
