/**
 * The task board's settings section: the "设置" page's own entry for this
 * plugin, registered into the shell's `settings.section` slot as one page of the
 * settings panel (the same seat the shipped Theme/Remote sections use).
 *
 * WHY A SECTION AND NOT A PLUGIN-LIST CARD: the card used to register into
 * `settings.plugin.item`, a slot the built-in plugin-configuration tab declared.
 * That tab's slot is declared by nobody today — `slots.inject` silently no-ops
 * for an undeclared slot, so such a form vanishes with no error at all. A
 * settings section is declared and rendered by the settings domain itself, so
 * it cannot be removed without the settings panel going with it.
 *
 * It edits this plugin's own profile entry through the settings surface's
 * per-entry form (`ctx.configForms`), so the section carries a working form
 * even on a deployment that serves no other settings page for this plugin.
 */

import type { InjectFace, PropsLocale, SnapshotSelector } from './platform.ts'
import type { SnapshotStore } from './platform.ts'
import { PluginSettingsCard, BooleanField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, type CardActions, type CardShell, type FieldState as CardFieldState, type SettingsScopeLike } from './settings-form.ts'

/** The task-board fields this card edits (the namespace's full schema). */
export interface TaskBoardSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Whether the board announces itself in every agent's system prompt. */
  announceToAgent?: boolean
}

/** What the task-board card renders. */
interface TaskBoardSettingsCardState extends CardShell {
  /** Master switch. */
  enabled: CardFieldState
  /** System-prompt announcement flag. */
  announceToAgent: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
interface TaskBoardSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useTaskBoardSettingsCard. */
    taskBoardSettingsCard: SnapshotStore<TaskBoardSettingsCardState>
  }
}

/** Bridges the `dsh-task-board` scope onto the card's staged form. */
export class TaskBoardSettingsCardController {
  private readonly form: CardForm<TaskBoardSettings>
  private readonly store: SnapshotStore<TaskBoardSettingsCardState>

  /** @param scope - the bound settings scope for the `dsh-task-board` namespace. */
  constructor(scope: SettingsScopeLike<TaskBoardSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      booleanField('announceToAgent'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): TaskBoardSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      announceToAgent: this.form.field('announceToAgent'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): TaskBoardSettingsCardFace {
    return { hooks: { taskBoardSettingsCard: this.store }, ...this.form.actions() }
  }

  /** Drop the form's subscription to the settings scope (fiber teardown). */
  dispose(): void {
    this.form.dispose()
  }
}

/** Props the renderer binds for the task-board settings section. */
type TaskBoardSettingsSectionProps =
  { useTaskBoardSettingsCard: SnapshotSelector<TaskBoardSettingsCardState> }
  & PropsLocale
  & InjectFace<TaskBoardSettingsCardFace>
  // The settings shell's owner share for every `settings.section` entry: the one
  // affordance a section receives, for flows that leave settings altogether.
  // This section never navigates away, so it is accepted and unused.
  & { close?: () => void }

/**
 * Render the task-board settings section.
 * @param props - locale copy, the form snapshot, and its actions.
 * @returns the section's form.
 */
export function TaskBoardSettingsSection(props: TaskBoardSettingsSectionProps) {
  const { t } = props
  const state = props.useTaskBoardSettingsCard(snapshot => snapshot)
  const disabled = !state.writable
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled,
  }
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-task-board-enabled"
        label={t('settings.enabled')}
        hint={t('settings.enabledHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.enabled}
        onEdit={(text) => { props.edit('enabled', text) }}
        onReset={() => { props.resetField('enabled') }}
      />
      <BooleanField
        id="settings-task-board-announce"
        label={t('settings.announceToAgent')}
        hint={t('settings.announceToAgentHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.announceToAgent}
        onEdit={(text) => { props.edit('announceToAgent', text) }}
        onReset={() => { props.resetField('announceToAgent') }}
      />
    </PluginSettingsCard>
  )
}
