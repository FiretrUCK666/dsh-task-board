/**
 * Shared task form: content fields (title / description / prompt) plus the
 * run-configuration selectors (agent / workspace / model / effort /
 * permission). Used by the new-task modal and the detail edit mode so both
 * surfaces stay identical. Fully controlled: the parent owns the draft.
 */
import { useEffect, useMemo, useState } from 'react'
import type { AgentPresetRow, BoardController, ModelGroupRow, PermissionRow } from '../../core/controller.ts'
import {
  defaultRunPresetOf, findRunPreset, LocalStorageRunPresetStore, mergedRunPresets,
  normalizeRunPresetDocument, type RunConfigPresetConfig, type RunPresetsDocument,
} from '../../core/run-presets.ts'
import { permissionLabel } from '../permission-label.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { PromptInput } from './PromptInput.tsx'
import { RunPresetManager } from './RunPresetManager.tsx'
import type { TaskDraft } from './task-draft.ts'

/** Model-select value encoding: provider + model, joined by a NUL separator. */
const MODEL_SEP = '\u0000'

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
  const [presets, setPresets] = useState<readonly AgentPresetRow[]>([])
  const [groups, setGroups] = useState<readonly ModelGroupRow[]>([])
  // undefined while loading or when the deployment exposes no permission
  // service — the selector is hidden then, mirroring the native capability.
  const [permissionRows, setPermissionRows] = useState<readonly PermissionRow[] | undefined>(undefined)

  // The run-config preset state (the SAME store the new-task modal and the
  // edit form share — one grammar, one source; both surfaces instant-switch).
  const [presetStore] = useState(() => new LocalStorageRunPresetStore())
  const [presetDoc, setPresetDoc] = useState<RunPresetsDocument>(() =>
    normalizeRunPresetDocument(presetStore.load()))
  const [showPresetManager, setShowPresetManager] = useState(false)

  /** The form's current run-config — the snapshot add/edit captures. */
  const currentConfig: RunConfigPresetConfig = {
    ...draft.workspaceId !== '' ? { workspaceId: draft.workspaceId } : {},
    ...draft.provider !== '' ? { provider: draft.provider } : {},
    ...draft.model !== '' ? { model: draft.model } : {},
    ...draft.reasoningEffort !== '' ? { reasoningEffort: draft.reasoningEffort } : {},
    ...draft.agentPreset !== '' ? { agentPreset: draft.agentPreset } : {},
    ...draft.permission !== '' ? { permission: draft.permission } : {},
  }

  /** Pick a preset: INSTANTLY rewrites the form's run-config fields. */
  const applyRunPreset = (id: string): void => {
    const preset = findRunPreset(presetDoc, id)
    if (preset === undefined) return
    onChange({
      ...draft,
      workspaceId: preset.config.workspaceId ?? '',
      agentPreset: preset.config.agentPreset ?? '',
      provider: preset.config.provider ?? '',
      model: preset.config.model ?? '',
      reasoningEffort: preset.config.reasoningEffort ?? '',
      permission: preset.config.permission ?? '',
    })
  }

  const catalog = controller.runCatalog()

  // Workspace rows are synchronous; presets, model groups and the permission
  // catalog load once per form mount.
  const workspaceRows = useMemo(() => catalog?.listWorkspaces() ?? [], [catalog])
  useEffect(() => {
    let alive = true
    void (async () => {
      if (catalog === undefined) return
      const [loadedPresets, loadedGroups, loadedPermissions] = await Promise.all([
        catalog.listAgentPresets(),
        catalog.listModelGroups(),
        catalog.listPermissions(),
      ])
      if (alive) {
        setPresets(loadedPresets)
        setGroups(loadedGroups)
        setPermissionRows(loadedPermissions)
      }
    })()
    return () => { alive = false }
  }, [catalog])

  /** Efforts of the selected model (empty when none advertised). */
  const effortOptions = useMemo(() => {
    if (draft.provider === '' || draft.model === '') return []
    const group = groups.find(candidate => candidate.provider === draft.provider)
    const model = group?.models.find(candidate => candidate.id === draft.model)
    return model?.efforts ?? []
  }, [groups, draft.provider, draft.model])

  /** Select a provider/model pair; the effort resets with the model. */
  const setModel = (key: string): void => {
    const sepIndex = key.indexOf(MODEL_SEP)
    onChange({
      ...draft,
      provider: sepIndex >= 0 ? key.slice(0, sepIndex) : '',
      model: sepIndex >= 0 ? key.slice(sepIndex + 1) : '',
      reasoningEffort: '',
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
            manager (add / edit / delete / set default). */}
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

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.agentPreset')}</span>
          <span className={css.selectWrap}>
            <select
            className={css.input}
            value={draft.agentPreset}
            onChange={event => { onChange({ ...draft, agentPreset: event.target.value }) }}
          >
            <option value="">{t('new.agentPresetDefault')}</option>
            {presets.map(preset => (
              <option
                key={preset.id}
                value={preset.id}
                title={preset.description ?? preset.id}
              >
                {preset.name ?? preset.id}
                {preset.isDefault === true ? ` (${t('new.agentPresetDefaultTag')})` : ''}
              </option>
            ))}
          </select>
          </span>
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.workspace')}</span>
          <span className={css.selectWrap}>
            <select
            className={css.input}
            value={draft.workspaceId}
            onChange={event => { onChange({ ...draft, workspaceId: event.target.value }) }}
          >
            <option value="">{t('new.workspaceDefault')}</option>
            {workspaceRows.map(row => (
              <option key={row.id} value={row.id}>{row.title}</option>
            ))}
          </select>
          </span>
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.model')}</span>
          <span className={css.selectWrap}>
            <select
            className={css.input}
            value={draft.provider !== '' && draft.model !== '' ? `${draft.provider}${MODEL_SEP}${draft.model}` : ''}
            onChange={event => { setModel(event.target.value) }}
          >
            <option value="">{t('new.modelDefault')}</option>
            {groups.map(group => (
              <optgroup key={group.provider} label={group.provider}>
                {group.models.map(model => (
                  <option key={`${group.provider}${MODEL_SEP}${model.id}`} value={`${group.provider}${MODEL_SEP}${model.id}`}>
                    {model.name ?? model.id}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          </span>
        </label>

        {effortOptions.length > 0 && (
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('new.effort')}</span>
            <span className={css.selectWrap}>
            <select
            className={css.input}
              value={draft.reasoningEffort}
              onChange={event => { onChange({ ...draft, reasoningEffort: event.target.value }) }}
            >
              <option value="">{t('new.effortDefault')}</option>
              {effortOptions.map(option => (
                <option key={option.id} value={option.id}>{option.name ?? option.id}</option>
              ))}
            </select>
          </span>
          </label>
        )}

        {/* The permission selector renders only when the deployment's native
            permission service advertises presets; the options are its
            dynamic table, never a hard-coded list. */}
        {permissionRows !== undefined && (
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('new.permission')}</span>
            <span className={css.selectWrap}>
            <select
            className={css.input}
              value={draft.permission}
              onChange={event => { onChange({ ...draft, permission: event.target.value }) }}
            >
              <option value="">{t('new.permissionDefault')}</option>
              {permissionRows.map(row => (
                <option
                  key={row.id}
                  value={row.id}
                  title={row.description ?? row.id}
                >
                  {permissionLabel(row.id, row.name)}
                </option>
              ))}
            </select>
          </span>
          </label>
        )}
      </div>

      {showPresetManager && (
        <RunPresetManager
          store={presetStore}
          doc={presetDoc}
          current={currentConfig}
          onChanged={setPresetDoc}
          onClose={() => { setShowPresetManager(false) }}
        />
      )}
    </>
  )
}
