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
import { Button } from './ui.tsx'

/** New-task form overlay. */
export function NewTaskModal({ controller, onClose }: { controller: BoardController; onClose: () => void }) {
  const [draft, setDraft] = useState<TaskDraft>({
    title: '',
    description: '',
    prompt: '',
    // Default landing column is 待规划 (backlog): a fresh task starts as an
    // idea being shaped, not scheduled work; the selector stays available.
    status: 'backlog',
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
          <Button onClick={onClose}>
            {t('new.cancel')}
          </Button>
          <Button type="submit" variant="primary">
            {t('new.submit')}
          </Button>
        </footer>
      </form>
    </Dialog>
  )
}
