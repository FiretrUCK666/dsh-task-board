/**
 * Task edit draft: the shared editable shape used by the new-task modal and
 * the detail edit mode. An empty string means "default / not set"; the
 * converters below translate a draft into a create input (empty keys
 * omitted) or an update patch (empty keys cleared explicitly).
 */
import type { TaskRecord } from '../../core/tasks.ts'
import type { NewTaskInput } from '../../core/tasks.ts'
import type { TaskTemplate } from '../../core/task-templates.ts'
import type { TaskUpdatePatch } from '../../core/controller.ts'
import type { DraftImage } from './attach.ts'

/** The editable slice of a task as the form sees it ('' = default/clear). */
export interface TaskDraft {
  title: string
  description: string
  prompt: string
  /** Images attached to the execution prompt (browser form; the id is the
   *  strip's local identity and is dropped when the task is written). */
  promptImages: DraftImage[]
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
    status: task.status === 'backlog' ? 'backlog' : 'todo',
    agentPreset: task.agentPreset ?? '',
    workspaceId: task.workspaceId ?? '',
    provider: task.provider ?? '',
    model: task.model ?? '',
    reasoningEffort: task.reasoningEffort ?? '',
    permission: task.permission ?? '',
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
    status: 'backlog',
    agentPreset: template.agentPreset ?? '',
    workspaceId: template.workspaceId ?? '',
    provider: template.provider ?? '',
    model: template.model ?? '',
    reasoningEffort: template.reasoningEffort ?? '',
    permission: template.permission ?? '',
  }
}

/** Draft → create input; empty fields are omitted (fall back to defaults). */
export function draftToNewInput(draft: TaskDraft): NewTaskInput {
  return {
    title: draft.title,
    description: draft.description,
    prompt: draft.prompt,
    ...draft.promptImages.length > 0
      ? { promptImages: draft.promptImages.map(image => ({ mediaType: image.mediaType, data: image.data, name: image.name })) }
      : {},
    status: draft.status,
    ...draft.agentPreset !== '' ? { agentPreset: draft.agentPreset } : {},
    ...draft.workspaceId !== '' ? { workspaceId: draft.workspaceId } : {},
    ...draft.provider !== '' && draft.model !== '' ? { provider: draft.provider, model: draft.model } : {},
    ...draft.reasoningEffort !== '' ? { reasoningEffort: draft.reasoningEffort } : {},
    ...draft.permission !== '' ? { permission: draft.permission } : {},
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
    agentPreset: draft.agentPreset !== '' ? draft.agentPreset : undefined,
    workspaceId: draft.workspaceId !== '' ? draft.workspaceId : undefined,
    provider: draft.provider !== '' ? draft.provider : undefined,
    model: draft.model !== '' ? draft.model : undefined,
    reasoningEffort: draft.reasoningEffort !== '' ? draft.reasoningEffort : undefined,
    permission: draft.permission !== '' ? draft.permission : undefined,
  }
}
