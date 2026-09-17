/**
 * The task board's settings section: the "设置" page's own entry for this
 * plugin, registered into the shell's `settings.section` slot as one page of the
 * settings panel (the same seat the shipped Theme/Remote sections use).
 *
 * WHY A SECTION AND NOT A PLUGIN-LIST CARD: the card used to register into
 * `settings.plugin.item`, a slot the built-in plugin-configuration tab declared.
 * The host removed that tab's slot in 0.1.6-alpha.2 — it remains declared by
 * nobody, and `slots.inject` silently no-ops for an undeclared slot, so the form
 * vanished with no error at all. A settings section is declared and rendered by
 * the settings domain itself, so it cannot be removed without the settings panel
 * going with it.
 *
 * It edits the `dsh-task-board` settings namespace through the plugin's own host
 * route (RouteSettingsScope), so the section needs no sibling settings package.
 */
import type { InjectFace, PropsLocale, SnapshotSelector } from './platform.ts';
import type { SnapshotStore } from './platform.ts';
import { type CardActions, type CardShell, type FieldState as CardFieldState, type SettingsScopeLike } from './settings-form.ts';
/** The task-board fields this card edits (the namespace's full schema). */
export interface TaskBoardSettings {
    /** Master switch for the plugin. */
    enabled?: boolean;
    /** Whether the board announces itself in every agent's system prompt. */
    announceToAgent?: boolean;
}
/** What the task-board card renders. */
interface TaskBoardSettingsCardState extends CardShell {
    /** Master switch. */
    enabled: CardFieldState;
    /** System-prompt announcement flag. */
    announceToAgent: CardFieldState;
}
/** The registration-side face the card's slot entry injects. */
interface TaskBoardSettingsCardFace extends CardActions {
    hooks: {
        /** Card snapshot bound by the renderer as useTaskBoardSettingsCard. */
        taskBoardSettingsCard: SnapshotStore<TaskBoardSettingsCardState>;
    };
}
/** Bridges the `dsh-task-board` scope onto the card's staged form. */
export declare class TaskBoardSettingsCardController {
    private readonly form;
    private readonly store;
    /** @param scope - the bound settings scope for the `dsh-task-board` namespace. */
    constructor(scope: SettingsScopeLike<TaskBoardSettings>);
    private projection;
    /**
     * Build the face the card's slot registration injects.
     * @returns the card's snapshot and its form actions.
     */
    inject(): TaskBoardSettingsCardFace;
    /** Drop the form's subscription to the settings scope (fiber teardown). */
    dispose(): void;
}
/** Props the renderer binds for the task-board settings section. */
type TaskBoardSettingsSectionProps = {
    useTaskBoardSettingsCard: SnapshotSelector<TaskBoardSettingsCardState>;
} & PropsLocale & InjectFace<TaskBoardSettingsCardFace> & {
    close?: () => void;
};
/**
 * Render the task-board settings section.
 * @param props - locale copy, the form snapshot, and its actions.
 * @returns the section's form.
 */
export declare function TaskBoardSettingsSection(props: TaskBoardSettingsSectionProps): import("react").JSX.Element;
export {};
