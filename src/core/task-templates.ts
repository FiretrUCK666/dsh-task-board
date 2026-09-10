/**
 * Task templates: named, reusable task blueprints. A template is the task's
 * CONTENT + its inert shape (title/description/prompt + images + run
 * configuration + due date + priority + labels + accent color — the same
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
import type { NewTaskInput, TaskFile, TaskImage, TaskRecord } from './tasks.ts'
import { normalizeLabels, normalizePriority, normalizePromptFiles, normalizePromptImages } from './tasks.ts'

/** The localStorage key for the user's template library (never renamed). */
export const TEMPLATE_STORAGE_KEY = 'dsh.taskBoard.templates.v1'

/** One named template: everything needed to stamp out a fresh card. */
export interface TaskTemplate {
  /** Stable template id (uuid). */
  id: string
  /** Human label shown in the picker. */
  name: string
  title: string
  description: string
  prompt: string
  promptImages?: TaskImage[]
  /** File refs (the twin lane of images — templates carry both or neither). */
  promptFiles?: TaskFile[]
  workspaceId?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  agentPreset?: string
  permission?: string
  /** Inert shape (absent on legacy templates): priority, labels, accent
   *  color — carried, never armed. */
  priority?: 1 | 2 | 3
  labels?: string[]
  color?: string
}

/** Persistence seam for the template library. */
export interface TemplateStore {
  load(): TaskTemplate[]
  save(templates: readonly TaskTemplate[]): void
}

/**
 * Snapshot a task as a template: content + run configuration + the inert
 * shape (priority/labels/color) come along, instance state never does.
 * Images ride along (the user attached them to the prompt deliberately —
 * dropping them silently would violate the no-silent-drop law);
 * schedule/rules stay behind (a template must never surprise-fire — arming
 * is an explicit act on the stamped card).
 */
export function templateFromTask(task: TaskRecord, id: string, name: string): TaskTemplate {
  const trimmed = name.trim()
  return {
    id,
    name: trimmed === '' ? task.title.trim() === '' ? 'Untitled template' : task.title : trimmed,
    title: task.title,
    description: task.description,
    prompt: task.prompt,
    ...task.promptImages !== undefined && task.promptImages.length > 0
      ? { promptImages: task.promptImages.map(image => ({ ...image })) }
      : {},
    ...task.promptFiles !== undefined && task.promptFiles.length > 0
      ? { promptFiles: task.promptFiles.map(file => ({ ...file })) }
      : {},
    ...task.workspaceId !== undefined ? { workspaceId: task.workspaceId } : {},
    ...task.provider !== undefined ? { provider: task.provider } : {},
    ...task.model !== undefined ? { model: task.model } : {},
    ...task.reasoningEffort !== undefined ? { reasoningEffort: task.reasoningEffort } : {},
    ...task.agentPreset !== undefined ? { agentPreset: task.agentPreset } : {},
    ...task.permission !== undefined ? { permission: task.permission } : {},
    ...task.priority !== undefined ? { priority: task.priority } : {},
    ...task.labels !== undefined ? { labels: [...task.labels] } : {},
    ...task.color !== undefined ? { color: task.color } : {},
  }
}

/** Stamp a fresh backlog input from a template (the card lands in 待规划). */
export function templateToNewInput(template: TaskTemplate): NewTaskInput {
  const priority = normalizePriority(template.priority)
  const labels = normalizeLabels(template.labels)
  return {
    title: template.title,
    description: template.description,
    prompt: template.prompt,
    status: 'backlog',
    ...template.promptImages !== undefined && template.promptImages.length > 0
      ? { promptImages: template.promptImages.map(image => ({ ...image })) }
      : {},
    ...template.promptFiles !== undefined && template.promptFiles.length > 0
      ? { promptFiles: template.promptFiles.map(file => ({ ...file })) }
      : {},
    ...template.workspaceId !== undefined ? { workspaceId: template.workspaceId } : {},
    ...template.provider !== undefined ? { provider: template.provider } : {},
    ...template.model !== undefined ? { model: template.model } : {},
    ...template.reasoningEffort !== undefined ? { reasoningEffort: template.reasoningEffort } : {},
    ...template.agentPreset !== undefined ? { agentPreset: template.agentPreset } : {},
    ...template.permission !== undefined ? { permission: template.permission } : {},
    ...priority !== undefined ? { priority } : {},
    ...labels !== undefined ? { labels } : {},
    ...template.color !== undefined ? { color: template.color } : {},
  }
}

/** Structural check: non-empty id/name strings (content may be blank). */
export function isTemplateRow(row: unknown): row is TaskTemplate {
  if (typeof row !== 'object' || row === null) return false
  const candidate = row as Record<string, unknown>
  return typeof candidate.id === 'string' && candidate.id !== ''
    && typeof candidate.name === 'string' && candidate.name !== ''
}

/** Normalize a raw stored list: valid rows only, duplicates dropped. */
export function normalizeTemplates(raw: unknown): TaskTemplate[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: TaskTemplate[] = []
  for (const row of raw) {
    if (!isTemplateRow(row) || seen.has(row.id)) continue
    seen.add(row.id)
    const priority = normalizePriority(row.priority)
    const labels = normalizeLabels(row.labels)
    const promptImages = normalizePromptImages(row.promptImages)
    const promptFiles = normalizePromptFiles(row.promptFiles)
    out.push({
      id: row.id,
      name: row.name,
      title: typeof row.title === 'string' ? row.title : '',
      description: typeof row.description === 'string' ? row.description : '',
      prompt: typeof row.prompt === 'string' ? row.prompt : '',
      ...promptImages !== undefined ? { promptImages } : {},
      ...promptFiles !== undefined ? { promptFiles } : {},
      ...typeof row.workspaceId === 'string' ? { workspaceId: row.workspaceId } : {},
      ...typeof row.provider === 'string' ? { provider: row.provider } : {},
      ...typeof row.model === 'string' ? { model: row.model } : {},
      ...typeof row.reasoningEffort === 'string' ? { reasoningEffort: row.reasoningEffort } : {},
      ...typeof row.agentPreset === 'string' ? { agentPreset: row.agentPreset } : {},
      ...typeof row.permission === 'string' ? { permission: row.permission } : {},
      ...priority !== undefined ? { priority } : {},
      ...labels !== undefined ? { labels } : {},
      ...typeof row.color === 'string' && row.color !== '' ? { color: row.color } : {},
    })
  }
  return out
}

/** localStorage-backed template library (device-local, like drafts). */
export class LocalStorageTemplateStore implements TemplateStore {
  load(): TaskTemplate[] {
    try {
      const raw = globalThis.localStorage?.getItem(TEMPLATE_STORAGE_KEY)
      if (raw === undefined || raw === null) return []
      return normalizeTemplates(JSON.parse(raw) as unknown)
    } catch {
      return []
    }
  }

  save(templates: readonly TaskTemplate[]): void {
    try {
      globalThis.localStorage?.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify([...templates]))
    } catch {
      // Quota or privacy mode: the library degrades to this session (the
      // in-memory copy the caller already holds) instead of throwing.
    }
  }
}
