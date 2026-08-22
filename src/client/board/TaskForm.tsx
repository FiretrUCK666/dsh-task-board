/**
 * Shared task form: content fields (title / description / prompt) plus the
 * run-configuration selector row — the config FIELDS themselves are the ONE
 * RunConfigEditor shared with the preset manager, so a task and a preset
 * configure the same things in the same order. Used by the new-task modal
 * and the detail edit mode so both surfaces stay identical. Fully controlled:
 * the parent owns the draft.
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import {
  defaultRunPresetOf, findRunPreset, LocalStorageRunPresetStore, mergedRunPresets,
  normalizeRunPresetDocument, type RunConfigPresetConfig, type RunPresetsDocument,
} from '../../core/run-presets.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { PromptInput } from './PromptInput.tsx'
import { RunConfigEditor } from './RunConfigEditor.tsx'
import { RunPresetManager } from './RunPresetManager.tsx'
import type { TaskDraft } from './task-draft.ts'

/** The shared new/edit task form. */
export function TaskForm({ draft, onChange, controller, withStatus = false, mentions = [] }: {
  draft: TaskDraft
  onChange: (next: TaskDraft) => void
  controller: BoardController
  /** Show the landing-column selector (new-task modal only). */
  withStatus?: boolean
  /** The task's related sessions for the prompt's @ mention (the edit form
   *  supplies them; a new task has none yet). */
  mentions?: ReadonlyArray<{ id: string; title: string }>
}) {
  // The run-config preset state (the SAME store the new-task modal and the
  // edit form share — one grammar, one source; both surfaces instant-switch).
  const [presetStore] = useState(() => new LocalStorageRunPresetStore())
  const [presetDoc, setPresetDoc] = useState<RunPresetsDocument>(() =>
    normalizeRunPresetDocument(presetStore.load()))
  const [showPresetManager, setShowPresetManager] = useState(false)

  /** The form's current run-config — the add preset seeds from it. */
  const currentConfig: RunConfigPresetConfig = {
    ...draft.workspaceId !== '' ? { workspaceId: draft.workspaceId } : {},
    ...draft.provider !== '' ? { provider: draft.provider } : {},
    ...draft.model !== '' ? { model: draft.model } : {},
    ...draft.reasoningEffort !== '' ? { reasoningEffort: draft.reasoningEffort } : {},
    ...draft.agentPreset !== '' ? { agentPreset: draft.agentPreset } : {},
    ...draft.permission !== '' ? { permission: draft.permission } : {},
  }

  /** The shared config editor writes back into the draft fields. */
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

  /** Pick a preset: INSTANTLY rewrites the form's run-config fields. */
  const applyRunPreset = (id: string): void => {
    const preset = findRunPreset(presetDoc, id)
    if (preset === undefined) return
    applyConfig(preset.config)
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
          mentions={mentions}
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

      <div className={css.field}>
        <span className={css.fieldLabel}>{t('new.runConfig')}</span>

        {/* 配置预设 row: ONE picker for both surfaces. Choosing a preset
            instantly rewrites the fields below (瞬切); 管理 opens the shared
            manager — whose add/edit form is the SAME RunConfigEditor, so a
            preset's content is visible and editable, never a hidden snapshot. */}
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.runPresets')}</span>
          <span className={css.selectWrap}>
            <select
              className={css.input}
              value=""
              aria-label={t('new.runPresets')}
              onChange={event => {
                if (event.target.value === '') return
                if (event.target.value === '__manage') {
                  setShowPresetManager(true)
                  return
                }
                applyRunPreset(event.target.value)
              }}
            >
              <option value="">{t('runPreset.placeholder')}…</option>
              {mergedRunPresets(presetDoc).map(preset => (
                <option
                  key={preset.id}
                  value={preset.id}
                >
                  {preset.name}
                  {preset.id === defaultRunPresetOf(presetDoc).id ? ` (${t('runPreset.defaultBadge')})` : ''}
                </option>
              ))}
              <option value="__manage">{t('runPreset.manage')}…</option>
            </select>
          </span>
        </label>

        <RunConfigEditor value={currentConfig} onChange={applyConfig} controller={controller} />
      </div>

      {showPresetManager && (
        <RunPresetManager
          store={presetStore}
          doc={presetDoc}
          current={currentConfig}
          controller={controller}
          onChanged={setPresetDoc}
          onClose={() => { setShowPresetManager(false) }}
        />
      )}
    </>
  )
}
