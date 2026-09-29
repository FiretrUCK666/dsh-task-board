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
import { agentPresetNameOf } from '../../core/session-agents.ts'
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
  /**
   * THREE STATES PER CATALOG, not one empty list.
   *
   * `presets` and `groups` started as `[]` and stayed `[]` whether the catalog was
   * still loading, had failed, or genuinely held nothing — so the form drew the
   * model select with a single 「默认」 and the reader had no way to tell 「there is
   * one model and it is the default」 from 「I could not read the catalog」. On the
   * surface where a task is committed to a model, a workspace and a permission,
   * that is the wrong thing to be unable to distinguish.
   *
   * A REJECTION WAS SWALLOWED, which is worse: the `Promise.all` result was
   * `void`ed with no `catch` and no log, so a failure left the form in the same
   * "empty" state as success — permanently, and silently.
   *
   * So: `pending` while in flight, `failed` when the read settles badly, and only
   * then is an empty list an answer about the deployment.
   */
  const [catalogState, setCatalogState] = useState<'pending' | 'ready' | 'failed'>('pending')
  const catalog = controller.runCatalog()
  const workspaceRows = useMemo(() => catalog?.listWorkspaces() ?? [], [catalog])
  useEffect(() => {
    let alive = true
    if (catalog === undefined) {
      // The service is ABSENT, which is a fact about the deployment and not a
      // failure to read one — the native capability is genuinely not there.
      if (alive) setCatalogState('ready')
      return () => { alive = false }
    }
    setCatalogState('pending')
    void (async () => {
      try {
        const [loadedPresets, loadedGroups, loadedPermissions] = await Promise.all([
          catalog.listAgentPresets(),
          catalog.listModelGroups(),
          catalog.listPermissions(),
        ])
        if (!alive) return
        setPresets(loadedPresets)
        setGroups(loadedGroups)
        setPermissionRows(loadedPermissions)
        setCatalogState('ready')
      } catch {
        // Said, not swallowed: 「读不到」 and 「没有」 are different answers, and
        // the difference is the whole point of the row existing.
        if (alive) setCatalogState('failed')
      }
    })()
    return () => { alive = false }
  }, [catalog])
  const catalogUnreadable = catalogState === 'failed'

  /**
   * A STORED VALUE THE CATALOG DOES NOT LIST, rendered as itself.
   *
   * A `<select>` whose `value` matches no `<option>` displays the FIRST option
   * while holding the stored one. So a task whose model, workspace, preset or
   * permission this deployment no longer advertises opened a form that said
   * 「默认」 about a setting that was not the default — and the reader's next save
   * wrote that lie back. Every one of the five selectors here had it.
   *
   * The project's own rule already covers this shape and names the forbidden
   * behaviour: a current value the catalogue does not have is shown AS IT IS and
   * never quietly rewritten to the first row. So the orphan is prepended here, and
   * one helper does it for all five rather than five chances to forget.
   *
   * @param options - the values the catalog advertised.
   * @param current - what is actually stored on the task.
   * @returns the same list, plus the stored value when it is not in it.
   */
  const withCurrent = <T extends { readonly id: string }>(
    options: readonly T[],
    current: string | undefined,
    label: (id: string) => string,
  ): readonly T[] => (
    current !== undefined && current !== '' && !options.some(option => option.id === current)
      // The orphan is a real option carrying a real name, so the select has
      // something to SHOW rather than falling back to its first row. `label` is
      // passed in because each select spells its own row text (a preset's
      // description, a workspace's title, a permission's i18n name) and the
      // orphan has none of those — it is an id the catalog stopped offering.
      ? [{ id: current, ...({ label: label(current) } as object) } as T, ...options]
      : options
  )
  const stored = (id: string): string => t('new.valueNotOffered', { id })

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
      {catalogUnreadable && (
        <p className={css.formError} role="status">{t('new.catalogUnreadable')}</p>
      )}
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('new.agentPreset')}</span>
        <span className={css.selectWrap}>
          <select
            className={css.input}
            value={value.agentPreset ?? ''}
            onChange={event => { set({ agentPreset: event.target.value === '' ? undefined : event.target.value }) }}
          >
            <option value="">{t('new.agentPresetDefault')}</option>
            {withCurrent(presets, value.agentPreset, stored).map(preset => (
              <option
                key={preset.id}
                value={preset.id}
                title={preset.description ?? preset.id}
              >
                {agentPresetNameOf(preset)}
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
            {withCurrent(workspaceRows, value.workspaceId, stored).map(row => (
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
              {withCurrent(effortOptions, value.reasoningEffort, stored).map(option => (
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
              {withCurrent(permissionRows, value.permission, stored).map(row => (
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
