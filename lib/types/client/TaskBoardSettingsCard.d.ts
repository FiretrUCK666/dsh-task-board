/**
 * The task-board settings card: whether the board announces itself in every
 * agent's system prompt. Registers into the `settings.plugin.item` slot the
 * plugin-configuration section renders, bound to the `dsh-task-board` settings
 * namespace.
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
}
/** Props the renderer binds for the task-board card. */
type TaskBoardSettingsCardProps = {
    useTaskBoardSettingsCard: SnapshotSelector<TaskBoardSettingsCardState>;
} & PropsLocale & InjectFace<TaskBoardSettingsCardFace>;
/**
 * Render the task-board card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export declare function TaskBoardSettingsCard(props: TaskBoardSettingsCardProps): import("react").JSX.Element;
export {};
