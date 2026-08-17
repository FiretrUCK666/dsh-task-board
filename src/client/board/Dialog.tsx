/**
 * Dialog: the shared modal skeleton — backdrop, centered panel, optional
 * header with a close button. Every overlay (new-task, preset manager,
 * confirmations) rides the same backdrop and panel styling, so the board's
 * dialogs share one look and one motion and can never drift apart. The
 * review page keeps its custom header (badge + session jump) but uses the
 * same backdrop/panel rules via its own classes.
 */
import type { ReactNode } from 'react'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Icon } from './ui.tsx'

/** One centered modal panel (see module doc). */
export function Dialog({ title, label, onClose, className, children }: {
  /** Optional header title; when absent the header (and its close button) are omitted. */
  title?: string
  /** aria-label for the dialog role. */
  label: string
  onClose: () => void
  /** Extra panel class (width overrides, e.g. the preset modal). */
  className?: string
  children: ReactNode
}) {
  return (
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
}
