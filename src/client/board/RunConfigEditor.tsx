/**
 * THE one run-configuration field editor (工作区 / Agent / 模型 / 思考程度 /
 * 权限): the task form's 运行配置 block and the preset manager's add/edit
 * form both render THIS — one set of fields, one catalog-loading path, zero
 * drift between what a task configures and what a preset stores.
 * Self-contained: loads its catalogs from the controller's runCatalog face
 * (workspaces sync; agent presets / model groups / permissions async) and
 * degrades each option list exactly like the form always did.
 */
import { useEffect, useMemo, useState } from 'react'
import type { AgentPresetRow, BoardController, ModelGroupRow, PermissionRow } from '../../core/controller.ts'
import type { RunConfigPresetConfig } from '../../core/run-presets.ts'
import { permissionLabel } from '../permission-label.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'

/** Model-select value encoding: provider + model, joined by a NUL separator. */
const MODEL_SEP = '\u0000'

/** The run configuration field editor (see module doc). */
export function RunConfigEditor({ value, onChange, controller }: {
  value: RunConfigPresetConfig
  onChange: (next: RunConfigPresetConfig) => void
  controller: BoardController
}) {
  const [presets, setPresets] = useState<readonly AgentPresetRow[]>([])
  const [groups, setGroups] = useState<readonly ModelGroupRow[]>([])
  // undefined while loading or when the deployment exposes no permission
  // service — the selector is hidden then, mirroring the native capability.
  const [permissionRows, setPermissionRows] = useState<readonly PermissionRow[] | undefined>(undefined)

  const catalog = controller.runCatalog()
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
    const provider = value.provider ?? ''
    const model = value.model ?? ''
    if (provider === '' || model === '') return []
    const group = groups.find(candidate => candidate.provider === provider)
    const row = group?.models.find(candidate => candidate.id === model)
    return row?.efforts ?? []
  }, [groups, value.provider, value.model])

  /** Select a provider/model pair; the effort resets with the model. */
  const setModel = (key: string): void => {
    const sepIndex = key.indexOf(MODEL_SEP)
    onChange({
      ...value,
      provider: sepIndex >= 0 ? key.slice(0, sepIndex) : undefined,
      model: sepIndex >= 0 ? key.slice(sepIndex + 1) : undefined,
      reasoningEffort: undefined,
    })
  }

  const set = (patch: Partial<RunConfigPresetConfig>): void => onChange({ ...value, ...patch })

  return (
    <>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('new.agentPreset')}</span>
        <span className={css.selectWrap}>
          <select
            className={css.input}
            value={value.agentPreset ?? ''}
            onChange={event => { set({ agentPreset: event.target.value === '' ? undefined : event.target.value }) }}
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
            value={value.workspaceId ?? ''}
            onChange={event => { set({ workspaceId: event.target.value === '' ? undefined : event.target.value }) }}
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
            value={value.provider !== undefined && value.model !== undefined ? `${value.provider}${MODEL_SEP}${value.model}` : ''}
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
              value={value.reasoningEffort ?? ''}
              onChange={event => { set({ reasoningEffort: event.target.value === '' ? undefined : event.target.value }) }}
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
          permission service advertises presets; the options are its dynamic
          table, never a hard-coded list. */}
      {permissionRows !== undefined && (
        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.permission')}</span>
          <span className={css.selectWrap}>
            <select
              className={css.input}
              value={value.permission ?? ''}
              onChange={event => { set({ permission: event.target.value === '' ? undefined : event.target.value }) }}
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
    </>
  )
}
