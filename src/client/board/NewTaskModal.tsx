/**
 * New-task modal: the shared task form (content + run configuration) on a
 * fresh draft. Creates through the controller (which persists immediately).
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
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
    <div className={css.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <form
        className={css.modal}
        role="dialog"
        aria-label={t('board.new')}
        onSubmit={event => { event.preventDefault(); submit() }}
      >
        <h2 className={css.modalTitle}>{t('board.new')}</h2>

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
    </div>
  )
}
