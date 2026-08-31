/**
 * Shared detail-panel shell for every session surface on the board — the
 * execution review page (ReviewDetail) and the linked-session view
 * (SessionDetail): one backdrop + container + header (title + type badge +
 * context readout + actions + close) + two-column body (left conversation,
 * right rail).
 *
 * THE header grammar (both widths, one DOM):
 * - wide: one line — title | actions | × (rightmost);
 * - narrow: TWO deterministic lines — line 1 = title + badge + × on ONE
 *   horizontal plane (the close at the top-right corner, the title
 *   single-line ellipsis so the three never drift onto different baselines),
 *   line 2 = the action cluster right-aligned.
 *
 * The session context readout is NOT in the header — it belongs beside the
 * composer (see SessionRail), so the header stays a clean identity bar.
 *
 * The shell is PURE LAYOUT: business content — the review page's context
 * meter, live config, comment thread and composer, or the linked view's
 * read-only facts — stays in the caller. That boundary is deliberate: the
 * execution semantics (comment drives the task) and the linked-session
 * semantics (read-only live view) must never leak into each other through
 * a shared component.
 *
 * The whole backdrop PORTALS to the board box (the same layer every nested
 * overlay anchors to). ReviewDetail/SessionDetail render from INSIDE the task
 * detail panel, whose `position:relative + overflow:hidden` would otherwise
 * anchor and clip the backdrop — on a phone (where the detail is nearly the
 * whole box and its height is content-driven) that made the comment panel
 * "pop open" into an unseeable sliver. Portaling gives the frame the full
 * board box on every surface, exactly like the shared Dialog.
 */
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Icon } from './ui.tsx'
import { boardBox } from './Dialog.tsx'
import { useEscapeStack } from './escape-stack.ts'

/** The shared panel frame (see module doc). */
export function SessionFrame({ title, badge, ariaLabel, actions, main, rail, onClose }: {
  /** Panel title (the task title on both surfaces). */
  title: string
  /** Optional type badge text — its family identity; absent hides the badge. */
  badge?: string
  /** Dialog aria-label. */
  ariaLabel: string
  /** Header actions (refresh / view session). */
  actions: ReactNode
  /** Left column: the conversation region (caller owns its scroll region). */
  main: ReactNode
  /** Right column: the rail (caller owns its content). */
  rail: ReactNode
  onClose: () => void
}) {
  // Escape closes the frame through the family's ONE stack — a dialog opened
  // OVER this panel (a future confirm) closes first, the panel never pops
  // together with what sits on top of it.
  useEscapeStack(onClose)
  return createPortal(
    <div className={css.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className={css.review} role="dialog" aria-label={ariaLabel}>
        <header className={css.reviewHeader}>
          <div className={css.reviewTitleWrap}>
            {/* The title is single-line ellipsis on a phone (so it stays on the
                same plane as the badge + close); the full name is reachable via
                the tooltip + the dialog's aria-label. */}
            <h2 className={css.reviewTitle} title={title}>{title}</h2>
            {badge !== undefined && <span className={css.reviewBadge}>{badge}</span>}
          </div>
          <div className={css.reviewActions}>{actions}</div>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('detail.close')}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className={css.reviewBody}>
          <div className={css.reviewMain}>{main}</div>
          <aside className={css.reviewRail}>{rail}</aside>
        </div>
      </div>
    </div>,
    boardBox(),
  )
}
