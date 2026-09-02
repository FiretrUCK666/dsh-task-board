/**
 * The sidebar footer action entry: the task-board's OFFICIAL sidebar seat.
 *
 * Registers into the shell's `sidebar.footer.action` slot — a LIST-kind hole
 * beside Settings, declared by the sidebar's own SidebarRoot. It is the only
 * third-party sidebar affordance the shell renders in EVERY presentation
 * (wide column, collapsed rail and the mobile overlaid drawer are the same
 * React tree, so the entry is always rendered). This REPLACES the old
 * DOM-injection row (`sidebar-entry.ts`), which only landed in the column's
 * inner subtree — the mobile overlaid render never showed it, which is the
 * root of the "按钮时隐时现" problem.
 *
 * The component is plain React (the shell renders it with the slot's owner
 * props); the controller is the bridge to the board: a `toggle` callback and
 * a `boardOpen` snapshot. mountUiBody binds the real board controller once
 * the UI mounts; before that the row renders but clicks are inert (a bound
 * board always arrives within the frame the board mounts).
 */

import type { SnapshotSelector } from './platform.ts'
import { createSnapshotStore, type SnapshotStore } from './platform.ts'
import { t } from './locales.ts'
import css from './board.module.css'

/** The footer action's display state (what the component renders). */
export interface SidebarFooterState {
  /** Whether the board is currently open (accent highlight). */
  boardOpen: boolean
  /**
   * A click arrived before the board bound (mountUiBody still syncing): the
   * open intent is queued and will fire the instant the board is bound. Until
   * then the row shows the waiting treatment — a click is never silently
   * swallowed (the "点了没反应" on slow tunnels).
   */
  pendingOpen: boolean
}

/** The registration-side face the slot entry injects. */
export interface SidebarFooterFace {
  hooks: {
    sidebarFooter: SnapshotStore<SidebarFooterState>
  }
  /** Request the board to toggle (queues until bound; never a silent drop). */
  toggle: () => void
}

/**
 * The footer action controller: owns the display snapshot and the toggle
 * callback. The toggle is a settable handle — mountUiBody binds the real
 * board controller later, so this controller can be created (and the slot
 * registered) before the heavier board stack exists. A click before binding
 * is QUEUED (pendingOpen) and fires on bindBoard — the slow-network window
 * where the board is still syncing never eats a user's tap.
 */
export class SidebarFooterController {
  private store: SnapshotStore<SidebarFooterState> | undefined
  private open = false
  private pending = false
  private toggleFn: (() => void) | undefined

  /** Bind the board's toggle callback (and its open state) once the UI mounts.
   *  A queued click fires immediately; the pending flag clears. */
  bindBoard(open: () => boolean, toggle: () => void): void {
    this.toggleFn = toggle
    this.setOpen(open())
    if (this.pending) {
      this.pending = false
      this.publish()
      toggle()
    }
  }

  /** Reflect a board open/close transition into the row's highlight. */
  setOpen(open: boolean): void {
    if (this.open === open) return
    this.open = open
    this.publish()
  }

  /** Detach the board and clear the highlight (disposal path). */
  dispose(): void {
    this.toggleFn = undefined
    this.pending = false
    this.open = false
    this.store?.set({ boardOpen: false, pendingOpen: false })
  }

  /**
   * Build the face the slot registration injects. Called once by the slot
   * machinery; the component receives the snapshot store via useSidebarFooter.
   */
  inject(): SidebarFooterFace {
    this.store ??= createSnapshotStore<SidebarFooterState>({ boardOpen: this.open, pendingOpen: false })
    return {
      hooks: { sidebarFooter: this.store },
      toggle: () => {
        if (this.toggleFn !== undefined) {
          this.toggleFn()
          return
        }
        // Board not bound yet (mountUiBody still awaiting sync): queue the
        // open intent and show the waiting treatment — never a silent drop.
        if (!this.pending) {
          this.pending = true
          this.publish()
        }
      },
    }
  }

  private publish(): void {
    this.store?.set({ boardOpen: this.open, pendingOpen: this.pending })
  }
}

/** Props the shell binds for the footer entry: owner share + inject face. */
type SidebarFooterProps =
  & { wide: boolean }
  & { useSidebarFooter: SnapshotSelector<SidebarFooterState> }
  & { toggle: () => void }

/**
 * Render the sidebar footer action: a labeled row in the wide column, an icon
 * in the rail/collapsed form. The shell supplies `wide` (its column state);
 * the accent shows while the board is open, and the pending treatment while a
 * queued click is waiting for the board to bind (slow network).
 */
export function SidebarFooter(props: SidebarFooterProps) {
  const state = props.useSidebarFooter(snapshot => snapshot)
  const label = t('entry.label')
  return (
    <button
      type="button"
      className={css.sidebarFooterAction}
      data-pending={state.pendingOpen ? 'true' : undefined}
      aria-label={state.pendingOpen ? t('entry.opening') : label}
      title={label}
      onClick={props.toggle}
    >
      <span className={css.sidebarFooterIcon} aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
          <path d="M2 6.5h12M6.5 6.5v7" />
        </svg>
      </span>
      {props.wide === true ? <span className={css.sidebarFooterLabel}>{label}</span> : null}
    </button>
  )
}
