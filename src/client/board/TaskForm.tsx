/**
 * Shared task form: content fields (title / description / prompt) plus the
 * run-configuration selector row — the config FIELDS themselves are the ONE
 * RunConfigFields block (preset picker + RunConfigEditor) shared with the
 * new-session dialog, so a task and a session configure the same things in
 * the same order. Used by the new-task modal and the detail edit mode so
 * both surfaces stay identical. Fully controlled: the parent owns the draft.
 */
import type { BoardController } from '../../core/controller.ts'
import type { RunConfigPresetConfig } from '../../core/run-presets.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
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

      <label className={css.field}>
        <span className={css.fieldLabel}>{t('new.prompt')}</span>
        <PromptInput
          value={draft.prompt}
          onChange={next => { onChange({ ...draft, prompt: next }) }}
          placeholder={t('new.promptPlaceholder')}
          rows={4}
          controller={controller}
          sessionId={sessionId}
        />
      </label>

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
