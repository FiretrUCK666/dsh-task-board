/**
 * Task templates: named, reusable task blueprints. A template is the task's
 * CONTENT (title/description/prompt + images + run configuration — the same
 * inert set controller copyTask carries) with everything instance-specific
 * stripped (bindings, executions, hidden state, sessions order, viewed
 * baselines) and everything ARMED stripped (schedule enable-state, session
 * rules — a template must never surprise-fire). Instantiating a template
 * creates a fresh backlog card — the same outcome as "复制为模板"
 * (controller copyTask), but addressable by name and reusable any number
 * of times.
 *
 * Templates live in a device-local localStorage key (like drafts): they are
 * personal starters, not board truth — the shared document is untouched, so
 * no migration and no multi-device merge grammar is needed. Pure functions +
 * a storage seam, so everything unit-tests in isolation.
 */
import type { NewTaskInput, TaskFile, TaskImage, TaskRecord } from './tasks.ts';
/** The localStorage key for the user's template library (never renamed). */
export declare const TEMPLATE_STORAGE_KEY = "dsh.taskBoard.templates.v1";
/** One named template: everything needed to stamp out a fresh card. */
export interface TaskTemplate {
    /** Stable template id (uuid). */
    id: string;
    /** Human label shown in the picker. */
    name: string;
    title: string;
    description: string;
    prompt: string;
    promptImages?: TaskImage[];
    /** File refs (the twin lane of images — templates carry both or neither). */
    promptFiles?: TaskFile[];
    workspaceId?: string;
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    agentPreset?: string;
    permission?: string;
    /** Inert shape (absent on legacy templates): accent color — carried,
     *  never armed. */
    color?: string;
}
/** Persistence seam for the template library. */
export interface TemplateStore {
    load(): TaskTemplate[];
    save(templates: readonly TaskTemplate[]): void;
}
/**
 * Snapshot a task as a template: content + run configuration come along,
 * instance state never does.
 * Images ride along (the user attached them to the prompt deliberately —
 * dropping them silently would violate the no-silent-drop law);
 * schedule/rules stay behind (a template must never surprise-fire — arming
 * is an explicit act on the stamped card).
 */
export declare function templateFromTask(task: TaskRecord, id: string, name: string): TaskTemplate;
/** Stamp a fresh backlog input from a template (the card lands in 待规划). */
export declare function templateToNewInput(template: TaskTemplate): NewTaskInput;
/** Structural check: non-empty id/name strings (content may be blank). */
export declare function isTemplateRow(row: unknown): row is TaskTemplate;
/** Normalize a raw stored list: valid rows only, duplicates dropped. */
export declare function normalizeTemplates(raw: unknown): TaskTemplate[];
/** localStorage-backed template library (device-local, like drafts). */
export declare class LocalStorageTemplateStore implements TemplateStore {
    load(): TaskTemplate[];
    save(templates: readonly TaskTemplate[]): void;
}
