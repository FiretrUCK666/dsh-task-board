/**
 * New-task modal: title + description + the prompt that execution will send,
 * plus optional run configuration (agent preset / workspace / model /
 * reasoning effort). Creates through the controller (which persists
 * immediately).
 */
import { useEffect, useMemo, useState } from 'react'
import type { AgentPresetRow, BoardController } from '../../core/controller.ts'
import type { ModelGroupRow } from '../../core/controller.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'

/** Model-select value encoding: provider + model, joined by a NUL separator. */
const MODEL_SEP = '\u0000'

/** New-task form overlay. */
export function NewTaskModal({ controller, onClose }: { controller: BoardController; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [agentPreset, setAgentPreset] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [modelKey, setModelKey] = useState('')
  const [effort, setEffort] = useState('')
  const [presets, setPresets] = useState<readonly AgentPresetRow[]>([])
  const [groups, setGroups] = useState<readonly ModelGroupRow[]>([])
  const [error, setError] = useState<string | undefined>(undefined)

  const catalog = controller.runCatalog()

  // Workspace rows are synchronous; presets and model groups load once.
  const workspaceRows = useMemo(() => catalog?.listWorkspaces() ?? [], [catalog])
  useEffect(() => {
    let alive = true
    void (async () => {
      if (catalog === undefined) return
      const [loadedPresets, loadedGroups] = await Promise.all([
        catalog.listAgentPresets(),
        catalog.listModelGroups(),
      ])
      if (alive) {
        setPresets(loadedPresets)
        setGroups(loadedGroups)
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
    const sepIndex = modelKey.indexOf(MODEL_SEP)
    if (sepIndex < 0) return []
    const provider = modelKey.slice(0, sepIndex)
    const modelId = modelKey.slice(sepIndex + 1)
    const group = groups.find(candidate => candidate.provider === provider)
    const model = group?.models.find(candidate => candidate.id === modelId)
    return model?.efforts ?? []
  }, [modelKey, groups])

  const submit = (): void => {
    const sepIndex = modelKey.indexOf(MODEL_SEP)
    const provider = sepIndex >= 0 ? modelKey.slice(0, sepIndex) : undefined
    const model = sepIndex >= 0 ? modelKey.slice(sepIndex + 1) : undefined
    const task = controller.createTask({
      title,
      description,
      prompt,
      ...agentPreset !== '' ? { agentPreset } : {},
      ...workspaceId !== '' ? { workspaceId } : {},
      ...provider !== undefined && model !== undefined ? { provider, model } : {},
      ...effort !== '' ? { reasoningEffort: effort } : {},
    })
    if (task === undefined) {
      setError(t('new.required'))
      return
    }
    onClose()
  }

  return (
    <div className={css.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <form
        className={css.modal}
        role="dialog"
        aria-label={t('board.new')}
        onSubmit={event => { event.preventDefault(); submit() }}
      >
        <h2 className={css.modalTitle}>{t('board.new')}</h2>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.title')}</span>
          <input
            className={css.input}
            value={title}
            autoFocus
            placeholder={t('new.titlePlaceholder')}
            onChange={event => { setTitle(event.target.value); setError(undefined) }}
          />
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.description')}</span>
          <textarea
            className={css.input}
            rows={3}
            value={description}
            placeholder={t('new.descriptionPlaceholder')}
            onChange={event => { setDescription(event.target.value) }}
          />
        </label>

        <label className={css.field}>
          <span className={css.fieldLabel}>{t('new.prompt')}</span>
          <textarea
            className={css.input}
            rows={4}
            value={prompt}
            placeholder={t('new.promptPlaceholder')}
            onChange={event => { setPrompt(event.target.value) }}
          />
        </label>

        <div className={css.field}>
          <span className={css.fieldLabel}>{t('new.runConfig')}</span>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('new.agentPreset')}</span>
            <select
              className={css.input}
              value={agentPreset}
              onChange={event => { setAgentPreset(event.target.value) }}
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
              value={workspaceId}
              onChange={event => { setWorkspaceId(event.target.value) }}
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
              value={modelKey}
              onChange={event => {
                setModelKey(event.target.value)
                setEffort('')
              }}
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
                value={effort}
                onChange={event => { setEffort(event.target.value) }}
              >
                <option value="">{t('new.effortDefault')}</option>
                {effortOptions.map(option => (
                  <option key={option.id} value={option.id}>{option.name ?? option.id}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {error !== undefined && <p className={css.formError}>{error}</p>}

        <footer className={css.modalFooter}>
          <button type="button" className={css.ghostButton} onClick={onClose}>
            {t('new.cancel')}
          </button>
          <button type="submit" className={css.primaryButton}>
            {t('new.submit')}
          </button>
        </footer>
      </form>
    </div>
  )
}
