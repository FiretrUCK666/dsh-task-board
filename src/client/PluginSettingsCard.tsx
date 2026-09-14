/**
 * Shared chrome for the plugin settings card: a disclosure header naming the
 * plugin and what its settings govern, the controls inside, and the save that
 * writes them. Renders always — an unavailable namespace shows a hint in place
 * of the controls rather than disappearing. Mirrors the official ui-plugin-config
 * PluginCard in a self-contained slice (this package must not depend on a
 * sibling UI package).
 */

import { useId, useState, type ReactNode } from 'react'
import type { CardShell } from './settings-form.ts'
import type { SettingsCardKey } from './locales.ts'
import css from './settings-card.module.css'

/** Card chrome shared by every plugin settings card. */
interface PluginSettingsCardProps {
  /** Locale reader for this card's copy. */
  t: (key: SettingsCardKey) => string
  /** Locale key of the plugin's name. */
  titleKey: SettingsCardKey
  /** Locale key of the line describing what this plugin's settings govern. */
  descriptionKey: SettingsCardKey
  /** The card's form state: availability, writability, and what a save would do. */
  state: CardShell
  /** Write every staged edit. */
  onSave: () => void
  /** Drop every staged edit. */
  onDiscard: () => void
  /** The plugin's controls. */
  children: ReactNode
}

/**
 * Render one plugin settings card.
 * @param props - the plugin's copy keys, its form state, and its controls.
 * @returns the card; an unavailable namespace renders a hint instead of controls.
 */
export function PluginSettingsCard(props: PluginSettingsCardProps) {
  const [open, setOpen] = useState(false)
  const { state } = props
  const title = props.t(props.titleKey)
  // Identity for the body this header discloses. Declared before the early
  // return so it is called on every render (hooks cannot sit after a branch),
  // and shared by both branches because only one of them ever renders.
  const bodyId = useId()
  if (!state.available) {
    // The namespace is not served; render the header and an unavailable hint
    // so the card never silently vanishes from the settings surface.
    return (
      <li className={css.card}>
        <button
          type="button"
          className={css.header}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${props.t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
          onClick={() => { setOpen(!open) }}
        >
          <span className={css.headText}>
            <span className={css.name}>{title}</span>
            <span className={css.description}>{props.t(props.descriptionKey)}</span>
          </span>
          <span className={open ? css.chevronOpen : css.chevron}>▾</span>
        </button>
        {open
          ? (
            <div className={css.body} id={bodyId}>
              <p className={css.readOnly} role="status">{props.t('settings.unavailable')}</p>
            </div>
          )
          : null}
      </li>
    )
  }
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <li className={css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={`${props.t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{title}</span>
          <span className={css.description}>{props.t(props.descriptionKey)}</span>
        </span>
        {state.dirty ? <span className={css.pending}>{props.t('settings.unsaved')}</span> : null}
        <span className={open ? css.chevronOpen : css.chevron}>▾</span>
      </button>
      {open
        ? (
          <div className={css.body} id={bodyId}>
            {!state.writable ? <p className={css.readOnly} role="status">{props.t('settings.readOnly')}</p> : null}
            {props.children}
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
          </div>
        )
        : null}
    </li>
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
