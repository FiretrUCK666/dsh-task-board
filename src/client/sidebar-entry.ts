/**
 * Sidebar entry injection.
 *
 * dsh's sidebar shell exposes no slot an external plugin can register into
 * (`sidebar.workspaces` / `sidebar.settings` are single-occupant and already
 * taken), so — following the established DOM-extension approach — the
 * entry row is injected between the shell's New Session button and the
 * workspace browser. The injection self-heals: a MutationObserver watches the
 * sidebar root and re-inserts the row whenever a React re-render displaces it
 * (re-insertion happens in the same frame, before paint, so no flicker).
 *
 * The row is plain DOM (no React tree) so it can never disturb the shell's
 * reconciliation; the board view it toggles is a separate React root mounted
 * in the center column (see board-mount.ts).
 */
import type { BoardController } from '../core/controller.ts'
import { t } from './locales.ts'
import css from './board.module.css'

/** The inline icon (shared by the sidebar row and the off-canvas fallback). */
const ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M6.5 6.5v7"/></svg>`

/** How long to wait for the shell sidebar before offering the floating
 *  fallback (a settled boot mounts the sidebar well inside this). */
const FALLBACK_AFTER_MS = 4_000

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
 * Mirror the shell's New Session button onto the entry row — geometry
 * (width, right-aligned) plus the visual surface (fill + text color, exposed
 * as CSS custom properties consumed by .entry). The fill is mirrored as a
 * CSS variable so the stylesheet keeps control of hover/active states while
 * the actual fill always matches the native button: under a glass skin the
 * native button stays solid, and copying its computed fill is exactly what
 * keeps the entry from turning translucent. Every mirrored value resets on
 * the collapsed rail (icon-only, transparent like the shell).
 */
function syncEntrySurface(entry: HTMLButtonElement, root: HTMLElement): void {
  const collapsed = root.closest('[data-sidebar-collapsed]') !== null
  if (collapsed) {
    entry.style.width = ''
    entry.style.marginLeft = ''
    entry.style.marginRight = ''
    entry.style.removeProperty('--dsh-tb-entry-fill')
    entry.style.removeProperty('--dsh-tb-entry-color')
    return
  }
  const button = newSessionButton(root)
  if (button === undefined) return
  entry.style.width = `${button.offsetWidth}px`
  entry.style.marginLeft = 'auto'
  entry.style.marginRight = '2px'
  const native = getComputedStyle(button)
  entry.style.setProperty('--dsh-tb-entry-fill', native.backgroundColor)
  entry.style.setProperty('--dsh-tb-entry-color', native.color)
}

/** Build the off-canvas fallback button (a floating corner affordance shown
 *  only when the shell sidebar never mounts — e.g. a mobile shell that hides
 *  it entirely — so the board is always reachable). */
function createFallback(controller: BoardController): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.dshTaskboardFallback = ''
  button.className = css.entryFallback
  button.setAttribute('aria-label', t('entry.label'))
  button.innerHTML = `<span class="${css.entryIcon}">${ICON}</span>`
  button.addEventListener('click', () => { controller.toggleBoard() })
  return button
}

/**
 * Mount the sidebar entry, waiting for the shell to render and self-healing
 * on later React re-renders. If the sidebar never appears within the boot
 * settle window (an off-canvas / hidden mobile sidebar), a floating corner
 * button takes over; if the sidebar later mounts, the row wins and the
 * fallback retires — one entry, whichever shell shape is live.
 * @param controller - the board controller the entry toggles.
 * @returns disposer removing the entry and its observers.
 */
export function mountSidebarEntry(controller: BoardController): () => void {
  const entry = createEntry(controller)
  let root: HTMLElement | undefined
  let placed = false
  let fallback: HTMLButtonElement | undefined
  let disposed = false

  const removeFallback = (): void => {
    if (fallback === undefined) return
    fallback.remove()
    fallback = undefined
  }

  const tryPlace = (): void => {
    if (placed) return
    root ??= sidebarRoot()
    if (root === undefined) return
    placed = placeEntry(root, entry)
    if (placed) {
      // The real sidebar arrived: retire the fallback (the row is the entry).
      removeFallback()
      syncEntrySurface(entry, root)
      rootObserver.observe(root, { childList: true, subtree: true, attributes: true })
    }
  }

  // The shell renders after boot settlement; watch for its arrival.
  const waitObserver = new MutationObserver(() => { tryPlace() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  // Self-heal: if a React re-render displaces the row, re-insert it in the
  // same frame (microtask before paint → no visible flicker); attribute
  // changes (sidebar collapse) re-sync the entry's width.
  const rootObserver = new MutationObserver(() => {
    if (root === undefined || !root.isConnected) {
      placed = false
      tryPlace()
      return
    }
    if (!root.contains(entry)) {
      placed = placeEntry(root, entry)
    }
    syncEntrySurface(entry, root)
  })

  // The off-canvas fallback: only if the sidebar is still absent after the
  // boot settle window (a settled shell mounts the sidebar well inside it).
  const fallbackTimer = setTimeout(() => {
    if (disposed || placed || fallback !== undefined) return
    if (sidebarRoot() !== undefined) return
    fallback = createFallback(controller)
    fallback.dataset.active = controller.getSnapshot().boardOpen ? 'true' : undefined
    document.body.appendChild(fallback)
  }, FALLBACK_AFTER_MS)

  // Reflect the board's open state on the row (active highlight).
  const unsubscribe = controller.subscribe(() => {
    const active = controller.getSnapshot().boardOpen
    entry.dataset.active = active ? 'true' : undefined
    if (fallback !== undefined) fallback.dataset.active = active ? 'true' : undefined
  })
  entry.dataset.active = controller.getSnapshot().boardOpen ? 'true' : undefined

  tryPlace()

  return () => {
    disposed = true
    clearTimeout(fallbackTimer)
    waitObserver.disconnect()
    rootObserver.disconnect()
    unsubscribe()
    removeFallback()
    entry.remove()
  }
}
