/**
 * The task list's entry in the shell's global-panel list.
 *
 * Registered into `sidebar.panellist`, the same list the board's entry is in,
 * with the same shape: the shell owns the whole row (button, geometry,
 * hover/active fill, the `aria-current="page"` highlight, the label in the wide
 * column, the icon-only form in the collapsed rail) and it calls
 * `ctx.layout.selectPanel(<id>)` itself. This component contributes the glyph
 * plus the ONE behavior the shell does not have: its `selectPanel` only ever
 * OPENS a panel, so clicking this row while the list is open must turn into
 * `selectPanel(null)` — click to enter, click again to leave.
 *
 * The list is a main-stage panel for the same reason the board is: it is a
 * full page of work, and the shell's chrome (left sidebar collapsed or wide,
 * narrow viewport, the panel toggle) is the one that already handles all of it.
 * A right-edge drawer had to re-derive none of that, which is how it ended up
 * with a width that no declared token set.
 *
 * The `id` this entry registers under MUST equal the `main` slot key the list
 * panel registers — the shell resolves a row to its stage by that id.
 *
 * THE TOGGLE ITSELF IS NOT WRITTEN HERE. The mechanism (which button the
 * listener lands on, why it must be a native listener, and the disposer that
 * takes it off again) lives in `design/use-panel-row-exit.ts` — one hook, four
 * panel rows (home, board, list, gallery), so the four cannot drift apart.
 */
import { useRef } from 'react'
import { usePanelRowExit } from '../design/use-panel-row-exit.ts'
import css from '../board.module.css'

/** Props the shell binds for a panel-list entry. */
interface TaskListIconProps {
  /** Requested square edge in pixels (the shell sizes wide vs rail). */
  size: number
  /** Whether this panel is selected in the main column. */
  active: boolean
  /**
   * Leave the list (select the Conversation). Injected by the registrant, which
   * owns the single way out — the same `selectPanel(null)` funnel the board's
   * entry uses, so leaving can never mean two different things on two panels.
   * Absent = pure glyph: no listener, no toggle, the row still opens.
   */
  onExit?: () => void
}

/**
 * Render the list glyph, wired for row-toggle exit while the list is open.
 * @param props - the shell's icon share plus the injected exit.
 * @returns the icon element.
 */
export function TaskListIcon({ size, active, onExit }: TaskListIconProps) {
  const rootRef = useRef<SVGSVGElement>(null)
  usePanelRowExit(rootRef, active, onExit)
  return (
    <svg
      ref={rootRef}
      className={css.panelIcon}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Three rows, each with a tick box: a checklist, read at a glance as
          "things to do" where the board's divided rectangle reads as
          "columns of work in flight". */}
      <path d="M2.5 4.5h1.2M6 4.5h7.5" />
      <path d="M2.5 8h1.2M6 8h7.5" />
      <path d="M2.5 11.5h1.2M6 11.5h7.5" />
    </svg>
  )
}
