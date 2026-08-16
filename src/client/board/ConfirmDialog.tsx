/**
 * Generic confirm dialog used by destructive actions (task delete). Rides
 * the shared Dialog skeleton.
 */
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Dialog } from './Dialog.tsx'

/** Confirm overlay props. */
export interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  /** Render the confirm button in the danger style. */
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Small confirm overlay. */
export function ConfirmDialog({ title, message, confirmLabel, danger, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog title={title} label={title} onClose={onCancel}>
      <p className={css.confirmMessage}>{message}</p>
      <footer className={css.modalFooter}>
        <button type="button" className={css.ghostButton} onClick={onCancel}>
          {t('delete.cancel')}
        </button>
        <button
          type="button"
          className={danger ? css.dangerButton : css.primaryButton}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </footer>
    </Dialog>
  )
}
