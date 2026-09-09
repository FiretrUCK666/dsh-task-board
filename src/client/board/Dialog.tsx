/**
 * Dialog: the shared modal skeleton — backdrop, centered panel, optional
 * header with a close button. Every overlay (new-task, preset manager,
 * confirmations) rides the same backdrop and panel styling, so the board's
 * dialogs share one look and one motion and can never drift apart. The
 * review page keeps its custom header (badge + session jump) but uses the
 * same backdrop/panel rules via its own classes.
 *
 * PORTAL IS THE DEFAULT: every board dialog anchors to the board box
 * (`[data-dsh-taskboard-view]`) — the one layer whose geometry is the honest
 * board-box reference. A dialog left in its DOM position instead anchors its
 * backdrop to the nearest positioned ancestor (a board header, an open panel)
 * and is clipped by its `overflow:hidden` — the "new-task run-config is dead /
 * size-limited / cut off" regression. A caller opts OUT only with an explicit
 * `portal={false}` when it is already a top-level board overlay (none today);
 * forgetting `portal` can no longer reintroduce the bug.
 *
 * ESC closes the dialog — through the SHARED Escape stack (escape-stack.ts),
 * so a nested overlay (a confirm over a manager) closes ONE layer per press,
 * never the whole stack at once. TaskDetail and SessionFrame register through
 * the same hook; the whole family shares one grammar.
 *
 * FOCUS is a closed loop here too: opening moves focus to the first control
 * (or the panel itself when there is none), Tab cycles inside the panel
 * (never leaks to the board behind), and closing returns focus to whatever
 * held it — the trigger the user came from. Every caller inherits this; no
 * dialog manages focus on its own.
 */
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Icon } from './ui.tsx'
import { useEscapeStack } from './escape-stack.ts'

/** The board box: the anchor every board dialog's backdrop covers. Exported
 *  for overlay shells that portal directly (SessionFrame). */
export function boardBox(): Element {
  return document.querySelector('[data-dsh-taskboard-view]') ?? document.body
}

/** Tabbable controls inside a root (keyboard order = DOM order). */
function focusablesOf(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter(element => !element.hasAttribute('disabled'))
}

/** Keep Tab cycling inside the panel (the board behind stays unreachable —
 *  CSS-Tricks' "no need to trap" applies to native showModal, not to this
 *  portal div, so the loop is explicit here). */
function trapTabIn(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab') return
  const panel = event.currentTarget
  const items = focusablesOf(panel)
  if (items.length === 0) {
    event.preventDefault()
    panel.focus()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

/** One centered modal panel (see module doc). */
export function Dialog({ title, label, onClose, className, children, portal = true }: {
  /** Optional header title; when absent the header (and its close button) are omitted. */
  title?: string
  /** aria-label for the dialog role. */
  label: string
  onClose: () => void
  /** Extra panel class (width overrides, e.g. the preset modal). */
  className?: string
  /** Render into the board box (the default; see module doc). */
  portal?: boolean
  children: ReactNode
}) {
  // Escape closes — through the family's ONE stack (top layer only).
  useEscapeStack(onClose)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  // Focus loop: enter on the first control (panel itself when control-less),
  // leave by returning to whoever held focus. Runs once per mount — the
  // dialog IS the mount, so no dependency can meaningfully change it.
  useEffect(() => {
    const panel = panelRef.current
    const previous = document.activeElement
    const controls = panel === null ? [] : focusablesOf(panel)
    if (controls.length > 0) controls[0].focus()
    else panel?.focus()
    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus({ preventScroll: true })
      }
    }
  }, [])
  const panel = (
    <div className={css.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`${css.modal}${className !== undefined ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={title !== undefined ? titleId : undefined}
        onKeyDown={trapTabIn}
      >
        {title !== undefined && (
          <header className={css.dialogHeader}>
            <h2 id={titleId} className={css.modalTitle}>{title}</h2>
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
