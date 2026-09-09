/**
 * Shared task form: content fields (title / description / prompt) plus the
 * run-configuration selector row — the config FIELDS themselves are the ONE
 * RunConfigFields block (preset picker + RunConfigEditor) shared with the
 * new-session dialog, so a task and a session configure the same things in
 * the same order. Used by the new-task modal and the detail edit mode so
 * both surfaces stay identical. Fully controlled: the parent owns the draft.
 *
 * The execution prompt carries an attachment ledger (the shared composer
 * hook, controlled by the draft): images persist as bytes; files persist as
 * name + bytes and are RE-STAGED per run session at send time (receipts are
 * per-Agent, never persisted). Pick / drop / paste anywhere on the prompt
 * field, capped in count — and every run path (manual / cron / cruise /
 * chain) sends the same attachments with the text.
 */
import type { BoardController } from '../../core/controller.ts'
import type { RunConfigPresetConfig } from '../../core/run-presets.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { AttachmentStrip, attachBusyLabel } from './AttachmentStrip.tsx'
import { MAX_TASK_IMAGES, TASK_IMAGE_BUDGET } from './attach.ts'
import { useComposerImages } from './composer-images.ts'
import { PromptInput } from './PromptInput.tsx'
import { RunConfigFields } from './RunConfigFields.tsx'
import type { TaskDraft } from './task-draft.ts'

/** The shared new/edit task form. */
export function TaskForm({ draft, onChange, controller, withStatus = false, sessionId }: {
  draft: TaskDraft
  onChange: (next: TaskDraft) => void
  controller: BoardController
  /** Show the landing-column selector (new-task modal only). */
  withStatus?: boolean
  /** The session scoping the run prompt's official '@' reference menu — the
   *  task's own session when editing; a resolved current/first session (or
   *  undefined = '@' closed) when creating. */
  sessionId?: string
}) {
  /** The form's current run-config — the add preset seeds from it. */
  const currentConfig: RunConfigPresetConfig = {
    ...draft.workspaceId !== '' ? { workspaceId: draft.workspaceId } : {},
    ...draft.provider !== '' ? { provider: draft.provider } : {},
    ...draft.model !== '' ? { model: draft.model } : {},
    ...draft.reasoningEffort !== '' ? { reasoningEffort: draft.reasoningEffort } : {},
    ...draft.agentPreset !== '' ? { agentPreset: draft.agentPreset } : {},
    ...draft.permission !== '' ? { permission: draft.permission } : {},
  }

  /** The shared config block writes back into the draft fields. */
  const applyConfig = (next: RunConfigPresetConfig): void => {
    onChange({
      ...draft,
      workspaceId: next.workspaceId ?? '',
      agentPreset: next.agentPreset ?? '',
      provider: next.provider ?? '',
      model: next.model ?? '',
      reasoningEffort: next.reasoningEffort ?? '',
      permission: next.permission ?? '',
    })
  }

  // The prompt's attachment ledger, CONTROLLED by the draft (it round-trips
  // through save/restore and persists onto the task). Images persist as
  // bytes; files persist as name + bytes (receipts are per-Agent and are
  // re-staged at send time). The task form has no session yet, so the file
  // lane stages lazily at send (see the execution wiring).
  const attachments = useComposerImages(TASK_IMAGE_BUDGET, MAX_TASK_IMAGES, {
    images: draft.promptImages,
    onChange: next => { onChange({ ...draft, promptImages: [...next] }) },
  })

  return (
    <>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('new.title')}</span>
        <input
          className={css.input}
          value={draft.title}
          placeholder={t('new.titlePlaceholder')}
          onChange={event => { onChange({ ...draft, title: event.target.value }) }}
        />
      </label>

      <label className={css.field}>
        <span className={css.fieldLabel}>{t('new.description')}</span>
        <textarea
          className={css.input}
          rows={3}
          value={draft.description}
          placeholder={t('new.descriptionPlaceholder')}
          onChange={event => { onChange({ ...draft, description: event.target.value }) }}
        />
      </label>

      {/* Due date (optional calendar date; empty = none). Day granularity by
          design — defer/start ride the automation schedule, never a second
          date field. Native date input (keyboard + picker + mobile wheels),
          same field grammar as title/description. */}
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('new.dueDate')}</span>
        <input
          className={css.input}
          type="date"
          value={draft.dueDate}
          onChange={event => { onChange({ ...draft, dueDate: event.target.value }) }}
        />
      </label>

      {/* Prompt field: the text plus its image ledger (pick / drop / paste
          anywhere on the field). A <div>, not a <label> — the strip holds
          buttons, and a label would route their clicks to the input. */}
      <div className={css.field} {...attachments.dropProps}>
        <span className={css.fieldLabel}>{t('new.prompt')}</span>
        <PromptInput
          value={draft.prompt}
          onChange={next => { onChange({ ...draft, prompt: next }) }}
          placeholder={t('new.promptPlaceholder')}
          rows={4}
          controller={controller}
          sessionId={sessionId}
        />
        <AttachmentStrip
          images={draft.promptImages}
          onAdd={attachments.addFiles}
          onRemoveImage={id => { onChange({ ...draft, promptImages: draft.promptImages.filter(image => image.id !== id) }) }}
          busy={attachments.busy}
          busyLabel={attachments.busy ? attachBusyLabel(attachments.busyKind) : undefined}
          error={attachments.error}
        />
        <span className={css.fieldHint}>{t('new.promptImagesHint', { max: String(MAX_TASK_IMAGES) })}</span>
      </div>

      {/* Landing-column selector: new-task modal only. Choosing a column is
          about where the task rests until it is started; auto rules never
          run a not-yet-started task, so this does not change execution. */}
      {withStatus && (
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.status')}</span>
          <span className={css.selectWrap}>
            <select
              className={css.input}
              value={draft.status}
              onChange={event => { onChange({ ...draft, status: event.target.value as 'backlog' | 'todo' }) }}
            >
              <option value="todo">{t('board.status.todo')}</option>
              <option value="backlog">{t('board.status.backlog')}</option>
            </select>
          </span>
          <span className={css.fieldHint}>{t('new.statusHint')}</span>
        </label>
      )}

      <RunConfigFields value={currentConfig} onChange={applyConfig} controller={controller} />
    </>
  )
}
