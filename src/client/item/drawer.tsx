/**
 * The task list as OUR OWN surface, not a tab in the host's right sidebar.
 *
 * WHY IT STOPPED BEING A SIDEBAR TAB. The sidebar remembers its whole surface
 * PER SESSION — "a session's initial surface is: collapsed, one pane, no tabs"
 * — so a tab could never satisfy what was actually asked for: open once, stay
 * put, and still be there in the next session. That is the sidebar's data
 * model, and no amount of cleverness gets around it. So the list is a drawer
 * of our own, and it does not care what session you are in.
 *
 * WHY IT NEVER COEXISTS WITH THE OFFICIAL SIDEBAR. Only one panel may own the
 * right edge, so whoever opens last wins. The honest half of that is in
 * launcher.tsx; the dishonest half is stated here, because it is a real gap
 * and not a design choice:
 *
 *   THE KNOWN GAP. We CANNOT be told when the official sidebar expands —
 *   `isExpanded()` is a one-time read and the package emits no event. So if
 *   you open us and then open the official sidebar, the worst case is both on
 *   screen until you touch us again: our drawer is over the top (this layer
 *   floats above every column), and collapsing it resolves it. That is the
 *   user's own recovery, and it is written in the README rather than buried
 *   here. Nothing else about it is guessed — the collapse we DO control is
 *   asserted, and the residual is named.
 *
 * WIDTH IS ONE DECLARATION, NOT A BREAKPOINT. `min(width, 100%)` covers the
 * narrow case with no media query and no invented threshold: the drawer is as
 * wide as it wants and never wider than what it has.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { t } from '../locales.ts'
import { ListOpenPill } from './launcher.tsx'
import { ItemListPanel } from './panel.tsx'
import { stage, type ItemListFace } from './register.tsx'
import css from '../board.module.css'

/** Our own persistence key. NOT the sidebar's per-session layout. */
const DRAWER_KEY = 'dsh.taskBoard.drawer.v1'

/**
 * The drawer's identity, for the edge to point at.
 *
 * `aria-expanded` on its own promises a control with no name, and a screen
 * reader has nothing to move to. The id is stable rather than generated per
 * render so the pairing survives every re-render. It is resolved by the drawer
 * when it is present, and naming an element that is not there YET is still a
 * correct answer — that element is exactly what this button brings in.
 */
const DRAWER_ID = 'dsh-task-board-item-drawer'

/** The one piece of state both outlets share. */
let open = false
let listeners: (() => void)[] = []
const notify = (): void => { for (const fn of [...listeners]) fn() }

/** Read the remembered state. Absent storage simply means "collapsed". */
function readStored(): boolean {
  try {
    return window.localStorage.getItem(DRAWER_KEY) === 'open'
  } catch {
    return false
  }
}

function writeStored(next: boolean): void {
  try {
    if (next) window.localStorage.setItem(DRAWER_KEY, 'open')
    else window.localStorage.removeItem(DRAWER_KEY)
  } catch {
    // A browser with no storage keeps working for this session; the control
    // still does what it says, it just will not be remembered.
  }
}

/** Whether the drawer is open, read fresh on every call. */
export function isDrawerOpen(): boolean {
  return open
}

/** Open the list. The one thing every outlet goes through. */
export function openDrawer(): void {
  open = true
  writeStored(true)
  notify()
}

/** Close it, for the same reason. */
export function closeDrawer(): void {
  if (!open) return
  open = false
  writeStored(false)
  notify()
}

/** Restore what the reader last had open. Called once, when composed. */
export function restoreDrawer(): void {
  open = readStored()
}

/** Re-read the store when it changes, so two outlets cannot disagree. */
export function useDrawerOpen(): boolean {
  return useSyncExternalStore(
    (onChange: () => void) => {
      listeners.push(onChange)
      return () => { listeners = listeners.filter(fn => fn !== onChange) }
    },
    isDrawerOpen,
    isDrawerOpen,
  )
}

/** Forget the shared state with the plugin: nothing stays subscribed. */
export function resetDrawer(): void {
  open = false
  listeners = []
  notify()
}

/**
 * The whole surface: the edge that is always there, and the panel when open.
 *
 * Rendered into the shell's `shell.overlay` seat, which is the official
 * frame-wide layer — a fresh id is added BESIDE the shipped ones, the layer
 * itself is click-through, and an entry opts back into pointer events. So the
 * collapsed edge never blocks the app, and the open panel floats above every
 * column without a hand-rolled portal into the shell's DOM.
 */
export function TaskDrawer() {
  const isOpen = useDrawerOpen()
  useEffect(() => {
    // The reader's own lifetime, not the host's: this is no longer a tab body,
    // so the host hands us no signal and the plugin owns its own. Every timer
    // and subscription inside hangs here, and only here.
    const controller = new AbortController()
    stage.bindSignal(controller.signal)
    return () => { controller.abort(); stage.unbind() }
  }, [])

  return (
    <div className={css.itemDrawerHost} data-dsh-taskboard-view="" data-open={isOpen ? '' : undefined}>
      {!isOpen && (
        <button
          type="button"
          className={css.itemDrawerEdge}
          aria-label={t('itemTab.open')}
          aria-expanded={false}
          aria-controls={DRAWER_ID}
          onClick={openDrawer}
        >
          <span className={css.itemDrawerEdgeChevron} aria-hidden="true" />
        </button>
      )}
      {isOpen && (
        <aside
          className={css.itemDrawer}
          id={DRAWER_ID}
          role="complementary"
          aria-label={t('itemTab.title')}
        >
          <header className={css.itemDrawerHead}>
            <h2 className={css.itemDrawerTitle}>{t('itemTab.title')}</h2>
            <div className={css.itemDrawerTools}>
              <ListOpenPill />
              <button
                type="button"
                className={css.itemDrawerClose}
                aria-label={t('itemDrawer.close')}
                onClick={closeDrawer}
              >
                {t('itemDrawer.closeGlyph')}
              </button>
            </div>
          </header>
          <ItemListPanel face={{ replica: stage.replica(), controller: stage.controller() } satisfies ItemListFace} signal={stage.signal()} />
        </aside>
      )}
    </div>
  )
}
