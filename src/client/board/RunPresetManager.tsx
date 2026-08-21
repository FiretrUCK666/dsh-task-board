/**
 * Run-config preset manager: the list (部署默认 + custom presets) with
 * set-default / edit / delete, and the add/edit form — which snapshots the
 * FORM's current run-config (the values the user just tuned), so "save as
 * preset" is one click from any state. Deleting whatever preset was the
 * default falls back to 部署默认 (the built-in, never deletable): the
 * fallback chain lives in run-presets.ts (defaultRunPresetOf).
 */
import { useState } from 'react'
import type {
  RunConfigPreset, RunConfigPresetConfig, RunPresetStore, RunPresetsDocument,
} from '../../core/run-presets.ts'
import { DEPLOY_DEFAULT_PRESET_ID, findRunPreset } from '../../core/run-presets.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Button } from './ui.tsx'
import { Dialog } from './Dialog.tsx'

function presetId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** The "N 项已配置" summary of a preset's set fields. */
function configCount(config: RunConfigPresetConfig): number {
  return Object.values(config).filter(value => typeof value === 'string' && value !== '').length
}

/** The run-config preset manager (see module doc). */
export function RunPresetManager({ store, doc, current, onChanged, onClose }: {
  store: RunPresetStore
  doc: RunPresetsDocument
  /** The form's current run-config (the snapshot add/edit captures). */
  current: RunConfigPresetConfig
  onChanged: (next: RunPresetsDocument) => void
  onClose: () => void
}) {
  // undefined = form closed; 'new' = add; a preset id = edit (rename + refresh
  // the config from the current form state).
  const [formKey, setFormKey] = useState<string | undefined>(undefined)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>(undefined)

  const persist = (next: RunPresetsDocument): void => {
    store.save(next)
    onChanged(next)
  }
  const setDefault = (id: string): void => {
    if (id === doc.defaultId) return
    persist({ ...doc, defaultId: id })
  }
  const remove = (preset: RunConfigPreset): void => {
    // The built-in preset is never deletable (it is the fallback default).
    if (preset.id === DEPLOY_DEFAULT_PRESET_ID) return
    const next: RunPresetsDocument = {
      presets: doc.presets.filter(candidate => candidate.id !== preset.id),
      // Deleting the current default resolves to 部署默认 (no dangling id).
      ...doc.defaultId === preset.id ? {} : { defaultId: doc.defaultId },
    }
    persist(next)
  }

  const save = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') {
      setError(t('runPreset.nameRequired'))
      return
    }
    if (formKey === 'new') {
      persist({ ...doc, presets: [...doc.presets, { id: presetId(), name: trimmed, config: current }] })
    } else if (formKey !== undefined) {
      const existing = doc.presets.find(candidate => candidate.id === formKey)
      if (existing !== undefined) {
        persist({
          ...doc,
          presets: doc.presets.map(candidate => candidate.id === formKey
            ? { ...candidate, name: trimmed, config: current }
            : candidate),
        })
      }
    }
    setFormKey(undefined)
    setName('')
    setError(undefined)
  }

  const startForm = (key: string): void => {
    const existing = key !== 'new' ? findRunPreset(doc, key) : undefined
    setFormKey(key)
    setName(existing !== undefined && existing.id !== DEPLOY_DEFAULT_PRESET_ID ? existing.name : '')
    setError(undefined)
  }

  return (
    <Dialog
      label={t('runPreset.manageTitle')}
      onClose={onClose}
      title={t('runPreset.manageTitle')}
      className={css.autoModal}
    >
      <div className={css.presetList}>
        <div className={css.runPresetRow}>
          <span className={css.runPresetName} title={t('runPreset.deployDefaultHint')}>
            {t('runPreset.deployDefault')}
            {doc.defaultId === undefined && <span className={css.runPresetDefaultBadge}>{t('runPreset.defaultBadge')}</span>}
          </span>
          <span className={css.detailHint}>{t('runPreset.deployDefaultNote')}</span>
          {doc.defaultId !== undefined && (
            <Button size="sm" onClick={() => { setDefault(DEPLOY_DEFAULT_PRESET_ID) }}>
              {t('runPreset.setDefault')}
            </Button>
          )}
        </div>
        {doc.presets.map(preset => (
          <div key={preset.id} className={css.runPresetRow}>
            <span className={css.runPresetName} title={preset.name}>
              {preset.name}
              {doc.defaultId === preset.id && <span className={css.runPresetDefaultBadge}>{t('runPreset.defaultBadge')}</span>}
            </span>
            <span className={css.detailHint}>{t('runPreset.configCount', { n: String(configCount(preset.config)) })}</span>
            <span className={css.autoRuleActions}>
              {doc.defaultId !== preset.id && (
                <Button size="sm" onClick={() => { setDefault(preset.id) }}>
                  {t('runPreset.setDefault')}
                </Button>
              )}
              <Button size="sm" title={t('runPreset.editTitle')} onClick={() => { startForm(preset.id) }}>
                {t('runPreset.edit')}
              </Button>
              <Button size="sm" variant="dangerGhost" title={t('runPreset.deleteTitle')} onClick={() => { remove(preset) }}>
                {t('runPreset.delete')}
              </Button>
            </span>
          </div>
        ))}
      </div>

      {formKey === undefined ? (
        <span className={css.autoAddAction}>
          <Button size="sm" onClick={() => { startForm('new') }}>
            {t('runPreset.add')}
          </Button>
        </span>
      ) : (
        <div className={css.autoForm}>
          <label className={css.autoField}>
            <span className={css.autoFieldLabel}>{t('runPreset.name')}</span>
            <input
              className={`${css.input} ${css.scheduleMaxInput}`}
              value={name}
              autoFocus
              placeholder={t('runPreset.namePlaceholder')}
              spellCheck={false}
              onChange={event => { setName(event.target.value); setError(undefined) }}
              onKeyDown={event => { if (event.key === 'Enter') save() }}
            />
          </label>
          <p className={css.detailHint}>{t('runPreset.formHint')}</p>
          {error !== undefined && <p className={css.formError}>{error}</p>}
          <span className={css.autoFormActions}>
            <Button size="sm" variant="primary" onClick={save}>
              {t('runPreset.save')}
            </Button>
            <Button size="sm" onClick={() => { setFormKey(undefined); setName(''); setError(undefined) }}>
              {t('detail.cancel')}
            </Button>
          </span>
        </div>
      )}

      <div className={css.presetToolbar}>
        <span className={css.detailHint}>{t('runPreset.hint')}</span>
      </div>
    </Dialog>
  )
}
