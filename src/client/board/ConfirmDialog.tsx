/**
 * Generic confirm dialog used by destructive actions (task delete). Rides
 * the shared Dialog skeleton.
 */
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Dialog } from './Dialog.tsx'
import { Button } from './ui.tsx'

/** Confirm overlay props. */
interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  /** Render the confirm button in the danger style. */
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Small confirm overlay. AlWAYS portaled: a confirmation is an overlay on
 *  an overlay — it must escape the enclosing dialog's box (see Dialog). */
export function ConfirmDialog({ title, message, confirmLabel, danger, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog title={title} label={title} onClose={onCancel} portal>
      {/* The ONE scroll region of the dialog (a long message scrolls; the
          actions stay pinned — see .modal / .modalScroll). */}
      <div className={css.modalScroll}>
        <p className={css.confirmMessage}>{message}</p>
      </div>
      <footer className={css.modalFooter}>
        <Button onClick={onCancel}>
          {t('delete.cancel')}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </footer>
    </Dialog>
  )
}
