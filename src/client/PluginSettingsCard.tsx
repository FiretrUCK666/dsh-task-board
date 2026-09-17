/**
 * Shared chrome for the plugin's settings SECTION: a heading naming what these
 * settings govern, the controls, and the save that writes them.
 *
 * The controls are always visible. The previous shape was a collapsible card
 * inside the built-in plugin list — a disclosure because a list of many plugins
 * needed folding. A settings section is its own page with exactly one subject,
 * so a disclosure in front of it only adds a click between the user and the
 * settings they just navigated to. The unavailable/read-only/failed states are
 * all still rendered (an unavailable namespace explains itself instead of
 * showing an empty page).
 */

import { type ReactNode } from 'react'
import type { CardShell } from './settings-form.ts'
import type { SettingsCardKey } from './locales.ts'
import css from './settings-card.module.css'

/** Section chrome shared by the plugin's settings form. */
interface PluginSettingsCardProps {
  /** Locale reader for this section's copy. */
  t: (key: SettingsCardKey) => string
  /** Locale key of the plugin's name. */
  titleKey: SettingsCardKey
  /** Locale key of the line describing what this plugin's settings govern. */
  descriptionKey: SettingsCardKey
  /** The form state: availability, writability, and what a save would do. */
  state: CardShell
  /** Write every staged edit. */
  onSave: () => void
  /** Drop every staged edit. */
  onDiscard: () => void
  /** The plugin's controls. */
  children: ReactNode
}

/**
 * Render one plugin settings section.
 * @param props - the plugin's copy keys, its form state, and its controls.
 * @returns the section; an unavailable namespace renders an explanatory hint in place of the controls.
 */
export function PluginSettingsCard(props: PluginSettingsCardProps) {
  const { state } = props
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <section className={css.card}>
      <header className={css.header}>
        <h3 className={css.name}>{props.t(props.titleKey)}</h3>
        <p className={css.description}>{props.t(props.descriptionKey)}</p>
        {state.dirty ? <span className={css.pending}>{props.t('settings.unsaved')}</span> : null}
      </header>
      <div className={css.body}>
        {!state.available ? <p className={css.readOnly} role="status">{props.t('settings.unavailable')}</p> : null}
        {state.available && !state.writable
          ? <p className={css.readOnly} role="status">{props.t('settings.readOnly')}</p>
          : null}
        {state.available ? props.children : null}
        {state.available
          ? (
            <div className={css.footer}>
              {state.failed ? <p className={css.failed} role="status">{props.t('settings.saveFailed')}</p> : null}
              <button
                type="button"
                className={css.discard}
                disabled={!state.dirty || state.saving}
                onClick={props.onDiscard}
              >
                {props.t('settings.discard')}
              </button>
              <button
                type="button"
                className={css.save}
                disabled={blocked}
                onClick={props.onSave}
              >
                {props.t(!state.saving ? 'settings.save' : 'settings.saving')}
              </button>
            </div>
          )
          : null}
      </div>
    </section>
  )
}

/** Props every field control needs regardless of its value type. */
interface FieldProps {
  /** Stable id associating the label with its control. */
  id: string
  /** Visible label. */
  label: string
  /** One-line explanation rendered under the control. */
  hint: string
  /** Draft text this control renders. */
  text: string
  /** True when saving would leave a user-layer entry for this field. */
  overridden: boolean
  /** True when the draft is not a value this field accepts. */
  invalid: boolean
  /** Copy for the overridden badge. */
  overriddenLabel: string
  /** Copy for the reset control. */
  resetLabel: string
  /** Copy shown in place of the hint while the draft is invalid. */
  invalidLabel: string
  /** Disables every control (read-only document, or an unavailable namespace). */
  disabled: boolean
  /** Stage draft text. */
  onEdit: (text: string) => void
  /** Stage a clear so the field re-inherits the composition layer. */
  onReset: () => void
}

/** A staged boolean field: 继承 / 开 / 关. */
export function BooleanField(props: FieldProps & {
  /** Copy for the inherit option. */
  inheritLabel: string
  /** Copy for the on option. */
  onLabel: string
  /** Copy for the off option. */
  offLabel: string
}) {
  return (
    <div className={css.field}>
      <div className={css.head}>
        <label className={css.label} htmlFor={props.id}>{props.label}</label>
        {props.overridden
          ? (
            <span className={css.badges}>
              <span className={css.badge}>{props.overriddenLabel}</span>
              <button
                type="button"
                className={css.reset}
                disabled={props.disabled}
                onClick={props.onReset}
              >
                {props.resetLabel}
              </button>
            </span>
          )
          : null}
      </div>
      <select
        id={props.id}
        className={css.select}
        value={props.text}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      >
        <option value="">{props.inheritLabel}</option>
        <option value="true">{props.onLabel}</option>
        <option value="false">{props.offLabel}</option>
      </select>
      <p className={css.hint}>{props.hint}</p>
    </div>
  )
}
