/**
 * Dialog: the shared modal skeleton — backdrop, centered panel, optional
 * header with a close button. Every overlay (new-task, preset manager,
 * confirmations) rides the same backdrop and panel styling, so the board's
 * dialogs share one look and one motion and can never drift apart. The
 * review page keeps its custom header (badge + session jump) but uses the
 * same backdrop/panel rules via its own classes.
 *
 * NESTED dialogs (an overlay opened from inside another overlay — the run-
 * preset manager inside the new-task dialog, a confirm inside any dialog)
 * MUST pass `portal`: the inner panel then renders into the board box
 * (`[data-dsh-taskboard-view]`), the same layer every board dialog anchors
 * to. Without it the inner backdrop (position:absolute, inset:0) anchors to
 * the outer panel (`position:relative`) and is clipped by its
 * `overflow:hidden` — the "modal is size-limited and cut off" regression.
 */
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Icon } from './ui.tsx'

/** The board box: the anchor every board dialog's backdrop covers. Exported
 *  for overlay shells that portal directly (SessionFrame). */
export function boardBox(): Element {
  return document.querySelector('[data-dsh-taskboard-view]') ?? document.body
}

/** One centered modal panel (see module doc). */
export function Dialog({ title, label, onClose, className, children, portal = false }: {
  /** Optional header title; when absent the header (and its close button) are omitted. */
  title?: string
  /** aria-label for the dialog role. */
  label: string
  onClose: () => void
  /** Extra panel class (width overrides, e.g. the preset modal). */
  className?: string
  /** Render into the board box instead of the current DOM position — REQUIRED
   *  for a dialog nested inside another dialog (see module doc). */
  portal?: boolean
  children: ReactNode
}) {
  const panel = (
    <div className={css.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div
        className={`${css.modal}${className !== undefined ? ` ${className}` : ''}`}
        role="dialog"
        aria-label={label}
      >
        {title !== undefined && (
          <header className={css.dialogHeader}>
            <h2 className={css.modalTitle}>{title}</h2>
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('detail.close')}
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          </header>
        )}
        {children}
      </div>
    </div>
  )
  if (!portal) return panel
  return createPortal(panel, boardBox())
}
