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
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { Dialog } from './Dialog.tsx'
import { TaskForm } from './TaskForm.tsx'
import { NEW_TASK_DRAFT_KEY, draftStore } from './drafts.ts'
import { draftFromTemplate, draftToNewInput, normalizeDraft, type TaskDraft } from './task-draft.ts'
import { Button } from './ui.tsx'

/** The fresh draft shape ('' = default / not set; landing column 待规划). */
function freshDraft(): TaskDraft {
  return {
    title: '',
    description: '',
    prompt: '',
    promptImages: [],
    status: 'backlog',
    agentPreset: '',
    workspaceId: '',
    provider: '',
    model: '',
    reasoningEffort: '',
    permission: '',
    dueDate: '',
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
        // A stored draft may predate a field (promptImages) — normalize fills
        // the gaps rather than crash on a missing array.
        const parsed = normalizeDraft(JSON.parse(stored) as Partial<TaskDraft>)
        if (parsed !== undefined) return parsed
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

  // Template library: picking a template fills the form (editable before
  // creating — stamping is a start, not a commitment); the danger-ghost
  // delete removes the PICKED template and confirms first (a template is
  // user-authored content).
  const templates = controller.listTemplates()
  const [pickedId, setPickedId] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const applyTemplate = (id: string): void => {
    setPickedId(id)
    const template = templates.find(candidate => candidate.id === id)
    if (template === undefined) return
    changeDraft(draftFromTemplate(template))
  }
  const removePicked = (): void => {
    if (pickedId !== '') controller.deleteTemplate(pickedId)
    setPickedId('')
    setConfirmDelete(false)
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
          {templates.length > 0 && (
            <div className={css.field}>
              <label className={css.fieldLabel} htmlFor="dsh-tb-template-picker">
                {t('new.fromTemplate')}
              </label>
              {/* Picker + delete share one line: the select flexes, the danger
                  action keeps its width (让位不压扁 — never a dangling lone
                  button on the next line). */}
              <div className={css.templateRow}>
                <span className={css.selectWrap}>
                  <select
                    id="dsh-tb-template-picker"
                    className={css.input}
                    value={pickedId}
                    onChange={event => { applyTemplate(event.target.value) }}
                  >
                    <option value="">{t('new.pickTemplate')}</option>
                    {templates.map(template => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                </span>
                <Button
                  variant="dangerGhost"
                  title={t('new.deleteTemplateTitle')}
                  disabled={pickedId === ''}
                  onClick={() => { setConfirmDelete(true) }}
                >
                  {t('new.deleteTemplate')}
                </Button>
              </div>
              {confirmDelete && pickedId !== '' && (
                <ConfirmDialog
                  title={t('new.deleteTemplate')}
                  message={t('new.deleteTemplateConfirm')}
                  confirmLabel={t('new.deleteTemplate')}
                  danger
                  onCancel={() => { setConfirmDelete(false) }}
                  onConfirm={removePicked}
                />
              )}
            </div>
          )}
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
