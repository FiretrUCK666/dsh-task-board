/**
 * Task edit draft: the shared editable shape used by the new-task modal and
 * the detail edit mode. An empty string means "default / not set"; the
 * converters below translate a draft into a create input (empty keys
 * omitted) or an update patch (empty keys cleared explicitly).
 *
 * WHAT THE PROMPT CARRIES lives in ONE field (`attachments`) as durable refs —
 * the same shape the comment composers and the checklist rows use, so every
 * surface that can attach a file speaks one language and a draft survives a
 * reload with its attachments intact (a per-Agent receipt could not: it died
 * with its session, which is exactly the silent loss this replaced).
 */
import type { TaskRecord } from '../../core/tasks.ts';
import type { NewTaskInput } from '../../core/tasks.ts';
import type { TaskTemplate } from '../../core/task-templates.ts';
import type { TaskUpdatePatch } from '../../core/controller.ts';
import type { DraftAttachment } from './composer-attachments.ts';
import type { EncodedImage } from './attach.ts';
/** One v1 leftover: a file the old draft kept as a per-Agent receipt. The bytes
 *  are not recoverable, so the form names it and asks for a re-add. */
export interface LostDraftFile {
    name: string;
    bytes: number;
}
/** The editable slice of a task as the form sees it ('' = default/clear). */
export interface TaskDraft {
    title: string;
    description: string;
    prompt: string;
    /** What the execution prompt carries (durable refs; the `id` is the strip's
     *  local chip key and is dropped when the task is written). */
    attachments: DraftAttachment[];
    /** v1 leftovers: images the old draft kept as bytes — re-admitted on restore. */
    legacyImages: EncodedImage[];
    /** v1 leftovers: files whose bytes are gone (the form says so). */
    legacyFiles: LostDraftFile[];
    /** Landing column for new tasks ('backlog' | 'todo'); edit mode keeps it unchanged. */
    status: 'backlog' | 'todo';
    /** Agent preset id; '' = deployment default. */
    agentPreset: string;
    /** Workspace id; '' = most recently used workspace. */
    workspaceId: string;
    /** Provider; '' = session default model. */
    provider: string;
    /** Model id; '' = session default model. */
    model: string;
    /** Reasoning effort; '' = model default. */
    reasoningEffort: string;
    /** Permission preset key; '' = session default. */
    permission: string;
    /** Accent color (hex string); '' = none. Edited through the form's swatch
     *  row (the one shared grammar) — what the draft carries is always
     *  visible, template stamps included. */
    color: string;
}
/**
 * Normalize a parsed draft (a stored draft may predate a field — e.g.
 * `attachments` — so every consumer gets a complete, safe shape). Attachment
 * rows wash element-wise (never a throwing passthrough — a dirty stored draft
 * must degrade to fewer chips, not a crash).
 */
export declare function normalizeDraft(parsed: Partial<TaskDraft> | null | undefined): TaskDraft | undefined;
/** Build a draft from a task record. */
export declare function draftFromTask(task: TaskRecord): TaskDraft;
/** Build a draft from a saved template (stamp-out fills the new-task form). */
export declare function draftFromTemplate(template: TaskTemplate): TaskDraft;
/** Draft → create input; empty fields are omitted (fall back to defaults). */
export declare function draftToNewInput(draft: TaskDraft): NewTaskInput;
/** Draft → update patch; empty fields are set to undefined to clear them. */
export declare function draftToUpdatePatch(draft: TaskDraft): TaskUpdatePatch;
/**
 * Stamp a template onto a draft by filling BLANKS only: every field the user
 * already touched keeps the user's value; the template supplies the rest.
 * One merge law for all fields (title/description/prompt/attachments/status/run
 * config) — never per-field preserve exceptions.
 * The one atomic group is provider/model/reasoningEffort (a run route):
 * mixing the user's provider with the template's model breeds invalid
 * combos, so the user's triple wins only when the pair is complete —
 * otherwise the template's whole triple rides (effort is tuned per model).
 */
export declare function stampTemplate(draft: TaskDraft, stamped: TaskDraft): TaskDraft;
