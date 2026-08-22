/**
 * Schedule preset manager: a small modal for editing the quick-pick preset
 * list — rename/replace/delete any preset, add custom ones (with live cron
 * validation and description), and restore the built-in defaults.
 * Persistence rides the local preset store; the built-ins are code
 * constants and are never persisted.
 */
import { useState } from 'react'
import { isValidCron } from '../../core/schedule.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import {
  DEFAULT_PRESETS, mergePresets, type LocalStoragePresetStore, type SchedulePreset,
} from '../../core/presets.ts'
import { cronHumanLabel } from './cron-label.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { Dialog } from './Dialog.tsx'
import { Button } from './ui.tsx'

/** The merged list shown in the preset dropdown (defaults + custom). */
export function mergedPresets(store: LocalStoragePresetStore): SchedulePreset[] {
  return mergePresets(DEFAULT_PRESETS, store.load())
}

/** Whether a preset id belongs to the built-in defaults. */
export function presetIsDefault(preset: SchedulePreset): boolean {
  return DEFAULT_PRESETS.some(candidate => candidate.id === preset.id)
}

/** Human cron hint for the manager rows ('' when invalid — the raw expression
 *  is noise there; the row already shows it in its own input). */
function presetCronHint(cron: string): string {
  return cronHumanLabel(cron, '')
}

/** One editable row: name + cron + save/delete. */
function PresetRow({ preset, onSave, onDelete }: {
  preset: SchedulePreset
  onSave: (next: SchedulePreset) => void
  onDelete: () => void
}) {
  const [label, setLabel] = useState(preset.label)
  const [cron, setCron] = useState(preset.cron)
  const dirty = label.trim() !== preset.label || cron.trim() !== preset.cron
  const valid = isValidCron(cron)
  const hint = presetCronHint(cron)
  return (
    <li className={css.presetRow}>
      <input
        className={`${css.input} ${css.presetName}`}
        value={label}
        aria-label={t('detail.schedule.presets.name')}
        onChange={event => { setLabel(event.target.value) }}
      />
      <span className={css.presetCronWrap}>
        <input
          className={`${css.input} ${css.presetCron}${!valid ? ` ${css.inputInvalid}` : ''}`}
          value={cron}
          spellCheck={false}
          aria-label={t('detail.schedule.cron')}
          onChange={event => { setCron(event.target.value) }}
        />
      </span>
      <Button
        disabled={!dirty || !valid}
        onClick={() => { onSave({ ...preset, label: label.trim(), cron: cron.trim() }) }}
      >
        {t('detail.schedule.presets.save')}
      </Button>
      <Button onClick={onDelete}>
        {t('detail.schedule.presets.delete')}
      </Button>
      {hint !== '' && <span className={css.presetHint}>{hint}</span>}
    </li>
  )
}

/** The preset manager overlay. */
export function PresetManager({ store, onClose }: {
  store: LocalStoragePresetStore
  onClose: () => void
}) {
  const [custom, setCustom] = useState<readonly SchedulePreset[]>(() => store.load())
  const [newLabel, setNewLabel] = useState('')
  const [newCron, setNewCron] = useState('')
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [newError, setNewError] = useState<string | undefined>(undefined)

  const persist = (next: readonly SchedulePreset[]): void => {
    setCustom(next)
    store.save(next)
  }

  /** Clear custom overrides and fall back to the built-in defaults. */
  const restoreDefaults = (): void => {
    store.clear()
    setCustom([])
    setConfirmRestore(false)
  }

  const add = (): void => {
    const cron = newCron.trim()
    const label = newLabel.trim()
    if (label === '' || cron === '' || !isValidCron(cron)) {
      setNewError(t('detail.schedule.invalid'))
      return
    }
    persist([...custom, { id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, label, cron }])
    setNewLabel('')
    setNewCron('')
    setNewError(undefined)
  }

  const newHint = presetCronHint(newCron)

  return (
    <Dialog
      label={t('detail.schedule.presets.title')}
      onClose={onClose}
      title={t('detail.schedule.presets.title')}
      className={css.presetModal}
    >
      {/* The ONE scroll region of the dialog: the preset list scrolls, the
          footer stays pinned (see .modal / .modalScroll). */}
      <div className={css.modalScroll}>
        <div className={css.presetToolbar}>
          <Button onClick={() => { setConfirmRestore(true) }}>
            {t('detail.schedule.presets.restore')}
          </Button>
        </div>

        <ul className={css.presetList}>
          {custom.length === 0 && <li className={css.presetEmpty}>{t('detail.schedule.presets.empty')}</li>}
          {custom.map(preset => (
            <PresetRow
              key={preset.id}
              preset={preset}
              onSave={next => { persist(custom.map(candidate => candidate.id === next.id ? next : candidate)) }}
              onDelete={() => { persist(custom.filter(candidate => candidate.id !== preset.id)) }}
            />
          ))}
        </ul>

        <div className={css.presetNew}>
          <input
            className={`${css.input} ${css.presetName}`}
            value={newLabel}
            placeholder={t('detail.schedule.presets.newName')}
            aria-label={t('detail.schedule.presets.name')}
            onChange={event => { setNewLabel(event.target.value); setNewError(undefined) }}
          />
          <input
            className={`${css.input} ${css.presetCron}${newCron.trim() !== '' && !isValidCron(newCron) ? ` ${css.inputInvalid}` : ''}`}
            value={newCron}
            placeholder={t('detail.schedule.presets.newCron')}
            spellCheck={false}
            aria-label={t('detail.schedule.cron')}
            onChange={event => { setNewCron(event.target.value); setNewError(undefined) }}
            onKeyDown={event => { if (event.key === 'Enter') add() }}
          />
          <Button variant="primary" onClick={add}>
            {t('detail.schedule.presets.add')}
          </Button>
        </div>
        {newError !== undefined && <p className={css.formError}>{newError}</p>}
        {newHint !== '' && <p className={css.scheduleMeta}>{newHint}</p>}
      </div>

      <footer className={css.modalFooter}>
        <Button onClick={onClose}>
          {t('detail.cancel')}
        </Button>
      </footer>

      {confirmRestore && (
        <ConfirmDialog
          title={t('detail.schedule.presets.restore')}
          message={t('detail.schedule.presets.restoreConfirm')}
          confirmLabel={t('detail.schedule.presets.restore')}
          danger
          onCancel={() => { setConfirmRestore(false) }}
          onConfirm={restoreDefaults}
        />
      )}
    </Dialog>
  )
}
