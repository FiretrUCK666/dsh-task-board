/**
 * Task edit draft: the shared editable shape used by the new-task modal and
 * the detail edit mode. An empty string means "default / not set"; the
 * converters below translate a draft into a create input (empty keys
 * omitted) or an update patch (empty keys cleared explicitly).
 */
import type { TaskRecord } from '../../core/tasks.ts'
import { normalizeLabels, normalizePriority } from '../../core/tasks.ts'
import type { NewTaskInput } from '../../core/tasks.ts'
import type { TaskTemplate } from '../../core/task-templates.ts'
import type { TaskUpdatePatch } from '../../core/controller.ts'
import type { DraftFile, DraftImage } from './attach.ts'
import { toPromptFile } from './attach.ts'

/** The editable slice of a task as the form sees it ('' = default/clear). */
export interface TaskDraft {
  title: string
  description: string
  prompt: string
  /** Images attached to the execution prompt (browser form; the id is the
   *  strip's local identity and is dropped when the task is written). */
  promptImages: DraftImage[]
  /** File refs attached to the execution prompt (receipt shape; same strip
   *  identity discipline as images — shown removable, carried on write). */
  promptFiles: DraftFile[]
  /** Landing column for new tasks ('backlog' | 'todo'); edit mode keeps it unchanged. */
  status: 'backlog' | 'todo'
  /** Agent preset id; '' = deployment default. */
  agentPreset: string
  /** Workspace id; '' = most recently used workspace. */
  workspaceId: string
  /** Provider; '' = session default model. */
  provider: string
  /** Model id; '' = session default model. */
  model: string
  /** Reasoning effort; '' = model default. */
  reasoningEffort: string
  /** Permission preset key; '' = session default. */
  permission: string
  /** Due date as `YYYY-MM-DD` (the date-input shape); '' = no due. */
  dueDate: string
  /** Priority as '1' | '2' | '3'; '' = none (the default, zero visuals). */
  priority: string
  /** Labels as free text (comma-separated in the form); '' = none. The
   *  converters split/normalize — the draft keeps the user's raw typing. */
  labels: string
  /** Accent color (hex string); '' = none. Edited through the form's swatch
   *  row (the one shared grammar) — what the draft carries is always
   *  visible, template stamps included. */
  color: string
}

/** `YYYY-MM-DD` → local-midnight ms epoch; undefined when malformed
 *  (including impossible dates like month 13 — the Date constructor rolls
 *  those over instead of failing, so the components are verified back). */
export function parseDueDateInput(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (match === null) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined
  }
  date.setHours(0, 0, 0, 0)
  const time = date.getTime()
  return Number.isFinite(time) ? time : undefined
}

/** Split free-typed label text (half/full-width commas and semicolons,
 *  ideographic commas, whitespace runs — the IME default must just work). */
export function splitLabelText(value: string): string[] {
  return value.split(/[,，、；;|\s]+/).map(part => part.trim()).filter(part => part !== '')
}

/** ms epoch → `YYYY-MM-DD` local (the date-input shape). */
export function toDueDateInput(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Normalize a parsed draft (a stored draft may predate a field — e.g.
 *  promptImages — so every consumer gets a complete, safe shape). */
export function normalizeDraft(parsed: Partial<TaskDraft> | null | undefined): TaskDraft | undefined {
  if (parsed === null || parsed === undefined) return undefined
  if (typeof parsed.title !== 'string' || typeof parsed.prompt !== 'string') return undefined
  return {
    title: parsed.title,
    description: parsed.description ?? '',
    prompt: parsed.prompt,
    promptImages: Array.isArray(parsed.promptImages) ? parsed.promptImages : [],
    status: parsed.status === 'todo' ? 'todo' : 'backlog',
    agentPreset: parsed.agentPreset ?? '',
    workspaceId: parsed.workspaceId ?? '',
    provider: parsed.provider ?? '',
    model: parsed.model ?? '',
    reasoningEffort: parsed.reasoningEffort ?? '',
    permission: parsed.permission ?? '',
    dueDate: typeof parsed.dueDate === 'string' && parseDueDateInput(parsed.dueDate) !== undefined
      ? parsed.dueDate.trim()
      : '',
    priority: (() => {
      const priority = normalizePriority(Number(parsed.priority))
      return priority === undefined ? '' : String(priority)
    })(),
    labels: typeof parsed.labels === 'string' ? parsed.labels : '',
    color: typeof parsed.color === 'string' ? parsed.color : '',
    promptFiles: Array.isArray(parsed.promptFiles) ? parsed.promptFiles : [],
  }
}

/** Build a draft from a task record. */
export function draftFromTask(task: TaskRecord): TaskDraft {  return {
    title: task.title,
    description: task.description,
    prompt: task.prompt,
    // The persisted prompt images round-trip through the draft (the strip's
    // id is regenerated on load — it is only a local chip key).
    promptImages: (task.promptImages ?? []).map((image, index) => ({
      id: `loaded-${index}-${image.data.slice(0, 8)}`,
      data: image.data,
      mediaType: image.mediaType as DraftImage['mediaType'],
      name: image.name ?? '',
    })),
    // File refs round-trip the same way (receipt + name + bytes; the strip
    // shows them removable — nothing rides invisibly).
    promptFiles: (task.promptFiles ?? []).map((file, index) => ({
      id: `loaded-file-${index}-${file.receiptId.slice(0, 8)}`,
      receiptId: file.receiptId,
      name: file.name,
      bytes: file.bytes,
    })),
    status: task.status === 'backlog' ? 'backlog' : 'todo',
    agentPreset: task.agentPreset ?? '',
    workspaceId: task.workspaceId ?? '',
    provider: task.provider ?? '',
    model: task.model ?? '',
    reasoningEffort: task.reasoningEffort ?? '',
    permission: task.permission ?? '',
    dueDate: task.dueAt !== undefined ? toDueDateInput(task.dueAt) : '',
    priority: task.priority === undefined ? '' : String(task.priority),
    labels: task.labels === undefined ? '' : task.labels.join(', '),
    color: task.color ?? '',
  }
}

/** Build a draft from a saved template (stamp-out fills the new-task form). */
export function draftFromTemplate(template: TaskTemplate): TaskDraft {
  return {
    title: template.title,
    description: template.description,
    prompt: template.prompt,
    // Same round-trip as a persisted task's images (strip ids regenerate).
    promptImages: (template.promptImages ?? []).map((image, index) => ({
      id: `template-${index}-${image.data.slice(0, 8)}`,
      data: image.data,
      mediaType: image.mediaType as DraftImage['mediaType'],
      name: image.name ?? '',
    })),
    // File refs stamp the same way (receipts re-stage at send time).
    promptFiles: (template.promptFiles ?? []).map((file, index) => ({
      id: `template-file-${index}-${file.receiptId.slice(0, 8)}`,
      receiptId: file.receiptId,
      name: file.name,
      bytes: file.bytes,
    })),
    status: 'backlog',
    agentPreset: template.agentPreset ?? '',
    workspaceId: template.workspaceId ?? '',
    provider: template.provider ?? '',
    model: template.model ?? '',
    reasoningEffort: template.reasoningEffort ?? '',
    permission: template.permission ?? '',
    // Templates carry the inert shape (due/priority/labels ride along, like
    // copies — stamping a dated, ranked, labeled card keeps its shape).
    dueDate: template.dueAt !== undefined ? toDueDateInput(template.dueAt) : '',
    priority: template.priority === undefined ? '' : String(template.priority),
    labels: template.labels === undefined ? '' : template.labels.join(', '),
    color: template.color ?? '',
  }
}

/** Draft → create input; empty fields are omitted (fall back to defaults). */
export function draftToNewInput(draft: TaskDraft): NewTaskInput {
  const dueAt = parseDueDateInput(draft.dueDate)
  const priority = normalizePriority(Number(draft.priority))
  const labels = normalizeLabels(splitLabelText(draft.labels))
  return {
    title: draft.title,
    description: draft.description,
    prompt: draft.prompt,
    ...draft.promptImages.length > 0
      ? { promptImages: draft.promptImages.map(image => ({ mediaType: image.mediaType, data: image.data, name: image.name })) }
      : {},
    ...draft.promptFiles.length > 0
      ? { promptFiles: draft.promptFiles.map(file => toPromptFile(file)) }
      : {},
    status: draft.status,
    ...draft.agentPreset !== '' ? { agentPreset: draft.agentPreset } : {},
    ...draft.workspaceId !== '' ? { workspaceId: draft.workspaceId } : {},
    ...draft.provider !== '' && draft.model !== '' ? { provider: draft.provider, model: draft.model } : {},
    ...draft.reasoningEffort !== '' ? { reasoningEffort: draft.reasoningEffort } : {},
    ...draft.permission !== '' ? { permission: draft.permission } : {},
    ...dueAt !== undefined ? { dueAt } : {},
    ...priority !== undefined ? { priority } : {},
    ...labels !== undefined ? { labels } : {},
    ...draft.color !== '' ? { color: draft.color } : {},
  }
}

/** Draft → update patch; empty fields are set to undefined to clear them. */
export function draftToUpdatePatch(draft: TaskDraft): TaskUpdatePatch {
  return {
    title: draft.title,
    description: draft.description,
    prompt: draft.prompt,
    // The whole set is rewritten on every save (present key semantics).
    promptImages: draft.promptImages.map(image => ({ mediaType: image.mediaType, data: image.data, name: image.name })),
    // File refs ride the same whole-set semantics (the twin lane of images).
    promptFiles: draft.promptFiles.map(file => toPromptFile(file)),
    agentPreset: draft.agentPreset !== '' ? draft.agentPreset : undefined,
    workspaceId: draft.workspaceId !== '' ? draft.workspaceId : undefined,
    provider: draft.provider !== '' ? draft.provider : undefined,
    model: draft.model !== '' ? draft.model : undefined,
    reasoningEffort: draft.reasoningEffort !== '' ? draft.reasoningEffort : undefined,
    permission: draft.permission !== '' ? draft.permission : undefined,
    dueAt: parseDueDateInput(draft.dueDate),
    priority: normalizePriority(Number(draft.priority)),
    labels: normalizeLabels(splitLabelText(draft.labels)),
    color: draft.color !== '' ? draft.color : undefined,
  }
}

/** Whether a draft field counts as user-filled (a template must not cover
 *  it): non-empty text, a non-default status, a non-empty image set. */
function filledText(value: string): boolean {
  return value !== ''
}

/** Stamp a template onto a draft by filling BLANKS only: every field the user
 *  already touched keeps the user's value; the template supplies the rest.
 *  One merge law for all fields (title/description/prompt/images/status/run
 *  config/due/priority/labels/color) — never per-field preserve exceptions. */
export function stampTemplate(draft: TaskDraft, stamped: TaskDraft): TaskDraft {
  return {
    title: filledText(draft.title) ? draft.title : stamped.title,
    description: filledText(draft.description) ? draft.description : stamped.description,
    prompt: filledText(draft.prompt) ? draft.prompt : stamped.prompt,
    promptImages: draft.promptImages.length > 0 ? draft.promptImages : stamped.promptImages,
    promptFiles: draft.promptFiles.length > 0 ? draft.promptFiles : stamped.promptFiles,
    status: draft.status !== 'backlog' ? draft.status : stamped.status,
    agentPreset: filledText(draft.agentPreset) ? draft.agentPreset : stamped.agentPreset,
    workspaceId: filledText(draft.workspaceId) ? draft.workspaceId : stamped.workspaceId,
    provider: filledText(draft.provider) ? draft.provider : stamped.provider,
    model: filledText(draft.model) ? draft.model : stamped.model,
    reasoningEffort: filledText(draft.reasoningEffort) ? draft.reasoningEffort : stamped.reasoningEffort,
    permission: filledText(draft.permission) ? draft.permission : stamped.permission,
    dueDate: filledText(draft.dueDate) ? draft.dueDate : stamped.dueDate,
    priority: filledText(draft.priority) ? draft.priority : stamped.priority,
    labels: filledText(draft.labels) ? draft.labels : stamped.labels,
    color: filledText(draft.color) ? draft.color : stamped.color,
  }
}
