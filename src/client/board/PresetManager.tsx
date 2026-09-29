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
  DEFAULT_PRESETS, mergePresets, type PresetStore, type SchedulePreset,
} from '../../core/presets.ts'
import { cronHumanLabel } from './cron-label.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { Dialog } from './Dialog.tsx'
import { Button } from './ui.tsx'

/** The merged list shown in the preset dropdown (defaults + custom). */
export function mergedPresets(store: PresetStore): SchedulePreset[] {
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
      {/* The action pair is ONE cluster (the compact CSS aligns this slot, and
          the buttons carry the same 34px bump as their input row siblings). */}
      <span className={css.presetActions}>
        <Button
          className={css.presetRowAction}
          disabled={!dirty || !valid}
          // WHY IT IS DISABLED, said where the button is. `presetCronHint` answers
          // '' for an unparseable cron, so an invalid row showed a RED BORDER and a
          // dead button and nothing else — while the add-row form sixty lines below
          // reports the identical fault properly through `setNewError`. One control,
          // two behaviours, for the same mistake.
          //
          // `dirty` needs no line: a save button that is off because you changed
          // nothing is self-explaining. An unparseable cron is not — it is a red
          // border with no sentence, which is the owner's 「按了没反应」 in a form
          // field rather than on a button. A `title` would not be enough: rule
          // 11③, touch has no hover.
          title={!valid ? t('detail.schedule.invalid') : undefined}
          onClick={() => { onSave({ ...preset, label: label.trim(), cron: cron.trim() }) }}
        >
          {t('detail.schedule.presets.save')}
        </Button>
        <Button className={css.presetRowAction} onClick={onDelete}>
          {t('detail.schedule.presets.delete')}
        </Button>
      </span>
      {!valid && <span className={css.presetHint}>{t('detail.schedule.invalid')}</span>}
      {valid && hint !== '' && <span className={css.presetHint}>{hint}</span>}
    </li>
  )
}

/** The preset manager overlay. */
export function PresetManager({ store, onClose }: {
  store: PresetStore
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

  /**
   * A custom preset is the reader's own writing, and `persist` OVERWRITES the
   * whole list — so deleting one is not 「hide a row」, it is the end of that text
   * and that cron, and there is no tombstone anywhere to bring it back. The
   * 恢复默认 button in this same dialog asks first (it destroys strictly more);
   * the per-row delete did not, which is the asymmetry that made this worth
   * changing: **the same irreversible act, two doors, one guarded.**
   */
  const [pendingDelete, setPendingDelete] = useState<SchedulePreset | undefined>(undefined)

  return (
    <Dialog
      label={t('detail.schedule.presets.title')}
      onClose={onClose}
      title={t('detail.schedule.presets.title')}
      className={css.presetModal}
      portal
    >
      {/* The ONE scroll region of the dialog: the preset list scrolls, the
          footer stays pinned (see .modal / .modalScroll). */}
      <div className={css.modalScroll}>
        <ul className={css.presetList}>
          {custom.length === 0 && <li className={css.presetEmpty}>{t('detail.schedule.presets.empty')}</li>}
          {custom.map(preset => (
            <PresetRow
              key={preset.id}
              preset={preset}
              onSave={next => { persist(custom.map(candidate => candidate.id === next.id ? next : candidate)) }}
              onDelete={() => { setPendingDelete(preset) }}
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
          <Button variant="primary" className={css.presetRowAction} onClick={add}>
            {t('detail.schedule.presets.add')}
          </Button>
        </div>
        {newError !== undefined && <p className={css.formError}>{newError}</p>}
        {newHint !== '' && <p className={css.scheduleMeta}>{newHint}</p>}
      </div>

      {/* Secondary actions live in the dialog's action row with 取消 — never a
          whole row of their own floating above an empty list (that is what
          made the phone dialog read as "a big blank top with one stray
          button"). */}
      <footer className={css.modalFooter}>
        <Button onClick={() => { setConfirmRestore(true) }}>
          {t('detail.schedule.presets.restore')}
        </Button>
        <Button onClick={onClose}>
          {t('detail.cancel')}
        </Button>
      </footer>

      {confirmRestore && (
        <ConfirmDialog
          title={t('detail.schedule.presets.restore')}
          // The count, because the doomed rows are on screen above this dialog and
          // a sentence that does not say how many of them are about to go is a
          // sentence about none of them.
          message={t('detail.schedule.presets.restoreConfirm', { n: String(custom.length) })}
          confirmLabel={t('detail.schedule.presets.restore')}
          danger
          onCancel={() => { setConfirmRestore(false) }}
          onConfirm={restoreDefaults}
        />
      )}
      {pendingDelete !== undefined && (
        <ConfirmDialog
          title={t('detail.schedule.presets.delete')}
          message={t('detail.schedule.presets.deleteConfirm', { name: pendingDelete.label })}
          confirmLabel={t('delete.ok')}
          danger
          onCancel={() => { setPendingDelete(undefined) }}
          onConfirm={() => {
            persist(custom.filter(candidate => candidate.id !== pendingDelete.id))
            setPendingDelete(undefined)
          }}
        />
      )}
    </Dialog>
  )
}
