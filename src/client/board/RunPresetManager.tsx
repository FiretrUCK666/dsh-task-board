/**
 * Run-config preset manager: the list (部署默认 + custom presets) with
 * set-default / edit / delete, and the add/edit form — **名称 + the SAME
 * RunConfigEditor as the task form**, so the preset's content is visible and
 * editable in place (a new preset seeds from the form's current config, so
 * "save what I just tuned" stays one click). Deleting whatever preset was
 * the default falls back to 部署默认 (the built-in, never deletable): the
 * fallback chain lives in run-presets.ts (defaultRunPresetOf).
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import type {
  RunConfigPreset, RunConfigPresetConfig, RunPresetStore, RunPresetsDocument,
} from '../../core/run-presets.ts'
import { DEPLOY_DEFAULT_PRESET_ID, findRunPreset } from '../../core/run-presets.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Button } from './ui.tsx'
import { Dialog } from './Dialog.tsx'
import { RunConfigEditor } from './RunConfigEditor.tsx'

function presetId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** The "N 项已配置" summary of a preset's set fields. */
function configCount(config: RunConfigPresetConfig): number {
  return Object.values(config).filter(value => typeof value === 'string' && value !== '').length
}

/** The run-config preset manager (see module doc). */
export function RunPresetManager({ store, doc, current, controller, onChanged, onClose }: {
  store: RunPresetStore
  doc: RunPresetsDocument
  /** The form's current run-config (a NEW preset seeds from it). */
  current: RunConfigPresetConfig
  controller: BoardController
  onChanged: (next: RunPresetsDocument) => void
  onClose: () => void
}) {
  // undefined = form closed; 'new' = add; a preset id = edit (rename + edit
  // the preset's own config inline — title and fields, fully visible).
  const [formKey, setFormKey] = useState<string | undefined>(undefined)
  const [name, setName] = useState('')
  const [config, setConfig] = useState<RunConfigPresetConfig>({})
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
      persist({ ...doc, presets: [...doc.presets, { id: presetId(), name: trimmed, config }] })
    } else if (formKey !== undefined) {
      const existing = doc.presets.find(candidate => candidate.id === formKey)
      if (existing !== undefined) {
        persist({
          ...doc,
          presets: doc.presets.map(candidate => candidate.id === formKey
            ? { ...candidate, name: trimmed, config }
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
    // A new preset seeds from the form's current config; an edit edits its
    // own stored config — never an invisible snapshot.
    setConfig(existing !== undefined && existing.id !== DEPLOY_DEFAULT_PRESET_ID ? existing.config : current)
    setError(undefined)
  }

  return (
    <Dialog
      label={t('runPreset.manageTitle')}
      onClose={onClose}
      title={t('runPreset.manageTitle')}
      className={css.autoModal}
      portal
    >
      {/* The ONE scroll region: the preset list and the add/edit form scroll
          together; the hint footer stays pinned (see .modal / .modalScroll)
          — a tall form never clips or hides its actions. */}
      <div className={css.modalScroll}>
        <div className={css.presetList}>
          <div className={css.runPresetRow}>
            <span className={css.runPresetName} title={t('runPreset.deployDefaultHint')}>
              {t('runPreset.deployDefault')}
              {doc.defaultId === undefined && <span className={css.runPresetDefaultBadge}>{t('runPreset.defaultBadge')}</span>}
            </span>
            <span className={css.detailHint}>{t('runPreset.deployDefaultNote')}</span>
            {doc.defaultId !== undefined && (
              <span className={css.autoRuleActions}>
                <Button size="sm" onClick={() => { setDefault(DEPLOY_DEFAULT_PRESET_ID) }}>
                  {t('runPreset.setDefault')}
                </Button>
              </span>
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
                className={`${css.input} ${css.autoNameInput}`}
                value={name}
                data-autofocus
                placeholder={t('runPreset.namePlaceholder')}
                spellCheck={false}
                onChange={event => { setName(event.target.value); setError(undefined) }}
                onKeyDown={event => { if (event.key === 'Enter') save() }}
              />
            </label>
            <p className={css.detailHint}>{t('runPreset.formHint')}</p>
            {error !== undefined && <p className={css.formError}>{error}</p>}
            <RunConfigEditor value={config} onChange={setConfig} controller={controller} />
          </div>
        )}
        {/* The standing explanation belongs to the scroll body's tail; the
            pinned footer is reserved for ACTIONS (弹窗次级动作归底部动作行). */}
        <p className={css.detailHint}>{t('runPreset.hint')}</p>
      </div>

      {/* Save/cancel live in the pinned dialog footer while the form is open —
          a tall RunConfigEditor must never push them below the fold (the
          PresetManager grammar, applied here). */}
      {formKey !== undefined && (
        <footer className={css.modalFooter}>
          <Button size="sm" onClick={() => { setFormKey(undefined); setName(''); setError(undefined) }}>
            {t('detail.cancel')}
          </Button>
          <Button size="sm" variant="primary" onClick={save}>
            {t('runPreset.save')}
          </Button>
        </footer>
      )}
    </Dialog>
  )
}
