/**
 * The run-configuration FIELDS block as one shared component: the
 * 配置预设 picker (instant-apply + manager) and the ONE RunConfigEditor.
 * Extracted verbatim from TaskForm so every surface that configures a
 * session's run (the task form, the detail's 新建会话) renders the exact
 * same fields in the exact same order — zero drift by construction.
 * Fully controlled: the parent owns the value object.
 */
import { useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import {
  defaultRunPresetOf, findRunPreset, LocalStorageRunPresetStore, mergedRunPresets,
  normalizeRunPresetDocument, type RunConfigPresetConfig, type RunPresetsDocument,
} from '../../core/run-presets.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { RunConfigEditor } from './RunConfigEditor.tsx'
import { RunPresetManager } from './RunPresetManager.tsx'

export function RunConfigFields({ value, onChange, controller }: {
  value: RunConfigPresetConfig
  onChange: (next: RunConfigPresetConfig) => void
  controller: BoardController
}) {
  // The run-config preset state (the SAME store the task form and the
  // new-session dialog share — one grammar, one source; both surfaces
  // instant-switch).
  const [presetStore] = useState(() => new LocalStorageRunPresetStore())
  const [presetDoc, setPresetDoc] = useState<RunPresetsDocument>(() =>
    normalizeRunPresetDocument(presetStore.load()))
  const [showPresetManager, setShowPresetManager] = useState(false)

  /** Pick a preset: INSTANTLY rewrites the fields. */
  const applyRunPreset = (id: string): void => {
    const preset = findRunPreset(presetDoc, id)
    if (preset === undefined) return
    onChange(preset.config)
  }

  return (
    <div className={css.field}>
      <span className={css.fieldLabel}>{t('new.runConfig')}</span>

      {/* 配置预设 row: ONE picker for every surface. Choosing a preset
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

      <RunConfigEditor value={value} onChange={onChange} controller={controller} />

      {showPresetManager && (
        <RunPresetManager
          store={presetStore}
          doc={presetDoc}
          current={value}
          controller={controller}
          onChanged={setPresetDoc}
          onClose={() => { setShowPresetManager(false) }}
        />
      )}
    </div>
  )
}
