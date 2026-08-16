/**
 * Task edit draft: the shared editable shape used by the new-task modal and
 * the detail edit mode. An empty string means "default / not set"; the
 * converters below translate a draft into a create input (empty keys
 * omitted) or an update patch (empty keys cleared explicitly).
 */
import type { TaskRecord } from '../../core/tasks.ts'
import type { NewTaskInput } from '../../core/tasks.ts'
import type { TaskUpdatePatch } from '../../core/controller.ts'

/** The editable slice of a task as the form sees it ('' = default/clear). */
export interface TaskDraft {
  title: string
  description: string
  prompt: string
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

/** Build a draft from a task record. */
export function draftFromTask(task: TaskRecord): TaskDraft {
  return {
    title: task.title,
    description: task.description,
    prompt: task.prompt,
    agentPreset: task.agentPreset ?? '',
    workspaceId: task.workspaceId ?? '',
    provider: task.provider ?? '',
    model: task.model ?? '',
    reasoningEffort: task.reasoningEffort ?? '',
    permission: task.permission ?? '',
  }
}

/** Draft → create input; empty fields are omitted (fall back to defaults). */
export function draftToNewInput(draft: TaskDraft): NewTaskInput {
  return {
    title: draft.title,
    description: draft.description,
    prompt: draft.prompt,
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
    agentPreset: draft.agentPreset !== '' ? draft.agentPreset : undefined,
    workspaceId: draft.workspaceId !== '' ? draft.workspaceId : undefined,
    provider: draft.provider !== '' ? draft.provider : undefined,
    model: draft.model !== '' ? draft.model : undefined,
    reasoningEffort: draft.reasoningEffort !== '' ? draft.reasoningEffort : undefined,
    permission: draft.permission !== '' ? draft.permission : undefined,
  }
}
