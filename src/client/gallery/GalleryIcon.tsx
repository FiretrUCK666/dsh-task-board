/**
 * The design-system gallery's entry in the shell's global-panel list.
 *
 * The same shape as the board's and the list's entries: the shell owns the row
 * (button, geometry, hover/active fill, the label, the icon-only form in the
 * collapsed rail) and calls `ctx.layout.selectPanel(<id>)` itself. This
 * component contributes the glyph plus the one behaviour the shell does not
 * have — its `selectPanel` only ever OPENS a panel, so clicking this row while
 * the gallery is open must become `selectPanel(null)`.
 *
 * The `id` this entry registers under MUST equal the `main` slot key the
 * gallery panel registers; the shell resolves a row to its stage by that id.
 */
import { useRef } from 'react'
import { usePanelRowExit } from '../design/use-panel-row-exit.ts'
import css from '../board.module.css'

/** Props the shell binds for a panel-list entry. */
export interface GalleryIconProps {
  /** Requested square edge in pixels (the shell sizes wide vs rail). */
  size: number
  /** Whether this panel is selected in the main column. */
  active: boolean
  /** Leave the gallery; absent = pure glyph, the row still opens it. */
  onExit?: () => void
}

/**
 * Render the gallery glyph, wired for row-toggle exit while it is open.
 * @param props - the shell's icon share plus the injected exit.
 * @returns the icon element.
 */
export function GalleryIcon({ size, active, onExit }: GalleryIconProps) {
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
      {/* A row of swatches over a baseline: a specimen sheet, read at a glance
          as "the parts", where the board's divided rectangle reads as "columns
          of work" and the list's tick rows read as "things to do". */}
      <rect x="2.5" y="3" width="4" height="4" rx="1.2" />
      <rect x="9.5" y="3" width="4" height="4" rx="1.2" />
      <rect x="2.5" y="9" width="4" height="4" rx="1.2" />
      <path d="M9.5 9.5h4M9.5 12.5h2.5" />
    </svg>
  )
}
