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

/** Small confirm overlay. */
export function ConfirmDialog({ title, message, confirmLabel, danger, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog title={title} label={title} onClose={onCancel}>
      <p className={css.confirmMessage}>{message}</p>
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
