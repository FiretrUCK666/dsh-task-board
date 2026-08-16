/**
 * Shared task form: content fields (title / description / prompt) plus the
 * run-configuration selectors (agent / workspace / model / effort /
 * permission). Used by the new-task modal and the detail edit mode so both
 * surfaces stay identical. Fully controlled: the parent owns the draft.
 */
import { useEffect, useMemo, useState } from 'react'
import type { AgentPresetRow, BoardController, ModelGroupRow, PermissionRow } from '../../core/controller.ts'
import { permissionLabel } from '../permission-label.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import type { TaskDraft } from './task-draft.ts'

/** Model-select value encoding: provider + model, joined by a NUL separator. */
const MODEL_SEP = '\u0000'

/** The shared new/edit task form. */
export function TaskForm({ draft, onChange, controller }: {
  draft: TaskDraft
  onChange: (next: TaskDraft) => void
  controller: BoardController
}) {
  const [presets, setPresets] = useState<readonly AgentPresetRow[]>([])
  const [groups, setGroups] = useState<readonly ModelGroupRow[]>([])
  // undefined while loading or when the deployment exposes no permission
  // service — the selector is hidden then, mirroring the native capability.
  const [permissionRows, setPermissionRows] = useState<readonly PermissionRow[] | undefined>(undefined)

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

  /** Flat "provider / model" options across the catalog. */
  const modelOptions = useMemo(() => groups.flatMap(group => group.models.map(model => {
    const key = `${group.provider}${MODEL_SEP}${model.id}`
    const label = model.name !== undefined && model.name !== model.id
      ? `${group.provider} · ${model.name}`
      : `${group.provider} / ${model.id}`
    return { key, label }
  })), [groups])

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
        <textarea
          className={css.input}
          rows={4}
          value={draft.prompt}
          placeholder={t('new.promptPlaceholder')}
          onChange={event => { onChange({ ...draft, prompt: event.target.value }) }}
        />
      </label>

      <div className={css.field}>
        <span className={css.fieldLabel}>{t('new.runConfig')}</span>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.agentPreset')}</span>
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
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.workspace')}</span>
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
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.model')}</span>
          <select
            className={css.input}
            value={draft.provider !== '' && draft.model !== '' ? `${draft.provider}${MODEL_SEP}${draft.model}` : ''}
            onChange={event => { setModel(event.target.value) }}
          >
            <option value="">{t('new.modelDefault')}</option>
            {modelOptions.map(option => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
        </label>

        {effortOptions.length > 0 && (
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('new.effort')}</span>
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
          </label>
        )}

        {/* The permission selector renders only when the deployment's native
            permission service advertises presets; the options are its
            dynamic table, never a hard-coded list. */}
        {permissionRows !== undefined && (
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('new.permission')}</span>
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
          </label>
        )}
      </div>
    </>
  )
}
