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
import { NEW_TASK_DRAFT_KEY, draftStore } from './drafts.ts'
import { draftToNewInput, type TaskDraft } from './task-draft.ts'
import { Button } from './ui.tsx'

/** The fresh draft shape ('' = default / not set; landing column 待规划). */
function freshDraft(): TaskDraft {
  return {
    title: '',
    description: '',
    prompt: '',
    status: 'backlog',
    agentPreset: '',
    workspaceId: '',
    provider: '',
    model: '',
    reasoningEffort: '',
    permission: '',
  }
}

/** New-task form overlay. */
export function NewTaskModal({ controller, onClose }: { controller: BoardController; onClose: () => void }) {
  // Draft memory: opening the modal restores the last unsaved new-task draft
  // (typing, closing, reopening keeps the text); it is cleared by a create
  // only — closing the modal without creating deliberately keeps it.
  const [draft, setDraft] = useState<TaskDraft>(() => {
    const stored = draftStore.get(NEW_TASK_DRAFT_KEY)
    if (stored !== undefined) {
      try {
        const parsed = JSON.parse(stored) as TaskDraft
        if (typeof parsed.title === 'string' && typeof parsed.prompt === 'string') return parsed
      } catch {
        // A corrupt draft falls through to a fresh form.
      }
    }
    return freshDraft()
  })
  const [error, setError] = useState<string | undefined>(undefined)

  const changeDraft = (next: TaskDraft): void => {
    setDraft(next)
    draftStore.set(NEW_TASK_DRAFT_KEY, JSON.stringify(next))
  }

  const submit = (): void => {
    const task = controller.createTask(draftToNewInput(draft))
    if (task === undefined) {
      setError(t('new.required'))
      return
    }
    draftStore.clear(NEW_TASK_DRAFT_KEY)
    onClose()
  }

  return (
    <Dialog label={t('board.new')} onClose={onClose} title={t('board.new')}>
      <form
        className={css.modalForm}
        onSubmit={event => { event.preventDefault(); submit() }}
      >
        <TaskForm draft={draft} onChange={changeDraft} controller={controller} withStatus />

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
