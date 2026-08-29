/**
 * New-task modal: the shared task form (content + run configuration) on a
 * fresh draft. Creates through the controller (which persists immediately).
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import {
  defaultRunPresetOf, normalizeRunPresetDocument, type RunPresetStore,
} from '../../core/run-presets.ts'
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

/** The initial draft of a NEW task: the run-config preset marked DEFAULT is
 *  applied (the fallback chain in run-presets.ts — never set / deleted ->
 *  部署默认 = the previous behavior). Only the run-config fields;
 *  title/description/prompt always start empty. */
function initialDraft(presetStore: RunPresetStore): TaskDraft {
  const doc = normalizeRunPresetDocument(presetStore.load())
  const config = defaultRunPresetOf(doc).config
  return {
    ...freshDraft(),
    ...config.workspaceId !== undefined ? { workspaceId: config.workspaceId } : {},
    ...config.provider !== undefined ? { provider: config.provider } : {},
    ...config.model !== undefined ? { model: config.model } : {},
    ...config.reasoningEffort !== undefined ? { reasoningEffort: config.reasoningEffort } : {},
    ...config.agentPreset !== undefined ? { agentPreset: config.agentPreset } : {},
    ...config.permission !== undefined ? { permission: config.permission } : {},
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
    return initialDraft(controller.runPresetStore())
  })

  const changeDraft = (next: TaskDraft): void => {
    setDraft(next)
    draftStore.set(NEW_TASK_DRAFT_KEY, JSON.stringify(next))
  }

  const submit = (): void => {
    // Title/description/prompt are all optional: a blank prompt just makes
    // the task inert, and the first real run auto-supplements the rest.
    const task = controller.createTask(draftToNewInput(draft))
    if (task === undefined) return
    draftStore.clear(NEW_TASK_DRAFT_KEY)
    onClose()
  }

  return (
    <Dialog label={t('board.new')} onClose={onClose} title={t('board.new')}>
      <form
        className={css.modalForm}
        onSubmit={event => { event.preventDefault(); submit() }}
      >
        {/* The ONE scroll region of the dialog: the fields scroll, the header
            and the 创建/取消 footer stay pinned (see .modal / .modalScroll). */}
        <div className={css.modalScroll}>
          <TaskForm
            draft={draft}
            onChange={changeDraft}
            controller={controller}
            withStatus
            sessionId={controller.referenceSessionOf(undefined)}
          />
        </div>

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
