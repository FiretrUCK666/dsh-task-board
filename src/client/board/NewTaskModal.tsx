/**
 * New-task modal: the shared task form (content + run configuration) on a
 * fresh draft. Creates through the controller (which persists immediately).
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Dialog } from './Dialog.tsx'
import { TaskForm } from './TaskForm.tsx'
import { draftToNewInput, type TaskDraft } from './task-draft.ts'

/** New-task form overlay. */
export function NewTaskModal({ controller, onClose }: { controller: BoardController; onClose: () => void }) {
  const [draft, setDraft] = useState<TaskDraft>({
    title: '',
    description: '',
    prompt: '',
    status: 'todo',
    agentPreset: '',
    workspaceId: '',
    provider: '',
    model: '',
    reasoningEffort: '',
    permission: '',
  })
  const [error, setError] = useState<string | undefined>(undefined)

  const submit = (): void => {
    const task = controller.createTask(draftToNewInput(draft))
    if (task === undefined) {
      setError(t('new.required'))
      return
    }
    onClose()
  }

  return (
    <Dialog label={t('board.new')} onClose={onClose} title={t('board.new')}>
      <form
        className={css.modalForm}
        onSubmit={event => { event.preventDefault(); submit() }}
      >
        <TaskForm draft={draft} onChange={setDraft} controller={controller} withStatus />

        {error !== undefined && <p className={css.formError}>{error}</p>}

        <footer className={css.modalFooter}>
          <button type="button" className={css.ghostButton} onClick={onClose}>
            {t('new.cancel')}
          </button>
          <button type="submit" className={css.primaryButton}>
            {t('new.submit')}
          </button>
        </footer>
      </form>
    </Dialog>
  )
}
