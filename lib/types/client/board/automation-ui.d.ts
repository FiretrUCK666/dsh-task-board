import type { BoardController } from '../../core/controller.ts';
import { type SchedulePreset } from '../../core/presets.ts';
import { type TaskRecord } from '../../core/tasks.ts';
/**
 * The one cron grammar: text input + preset dropdown (+ optional preset
 * manager). The caller owns value/validation/commit time:
 * - onCommit fires on Enter/blur (the schedule editor persists that way);
 * - onPreset fires when a preset is picked (schedule editor = 即改即生效);
 *   without it the pick only sets the value (session form = save on 保存).
 */
export declare function CronField({ value, presets, onChange, onCommit, onPreset, onManagePresets, invalid, label }: {
    value: string;
    presets: readonly SchedulePreset[];
    onChange: (value: string) => void;
    /** Enter/blur commit (absent = the caller validates on save only). */
    onCommit?: (value: string) => void;
    /** Immediate persist on preset pick (absent = the pick sets the value). */
    onPreset?: (value: string) => void;
    onManagePresets?: () => void;
    /** Error state: the input's invalid border. */
    invalid?: boolean;
    label: string;
}): import("react").JSX.Element;
/** THE one schedule-summary text (off / blocked-cause / paused(reason) /
 *  chain runs / cron human label + next instant), read by the detail's
 *  disclosure header, the automation overview's row and the card's tooltip —
 *  one grammar, three surfaces, never three branch sets. The failure word and
 *  the blocked cause derive inside (single derivation): callers pass the task
 *  and nothing else, so the three surfaces can never disagree. */
export declare function scheduleSummary(task: TaskRecord): string;
/**
 * The session-rules module: one row per rule + the add/edit form in place —
 * an empty task shows only the 新增 affordance. Panel and detail render this
 * verbatim; editing a rule (the form with the full capability) can never
 * diverge between surfaces again.
 */
export declare function SessionRulesSection({ controller, task }: {
    controller: BoardController;
    task: TaskRecord;
}): import("react").JSX.Element;
/**
 * THE one task-automation editor — the task-level schedule (cron /
 * after-completion chain: switch + driving mode + fields + live meta +
 * skip/stop, 即改即生效) and then the session rules (SessionRulesSection,
 * the same shared module).
 *
 * The task detail's 自动化 disclosure and the board's 自动化 overview task
 * cards render THIS verbatim — the board therefore has the SAME full
 * capability as the detail (including 完成后接续), and no surface can ever
 * drift into a reduced second editor. The two side-effect confirms (arming /
 * stopping an unlimited chain) live here so both surfaces share the same
 * gate (chainUnlimited).
 */
export declare function AutomationEditor({ controller, task, embedded }: {
    controller: BoardController;
    task: TaskRecord; /** Rendered inside the detail automation disclosure — the disclosure IS "任务自动化"; the inner head would repeat it (the 「自动化/任务自动化 双标题」 noise). */
    embedded?: boolean;
}): import("react").JSX.Element;
