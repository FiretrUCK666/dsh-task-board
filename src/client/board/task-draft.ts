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
import type { TaskRecord } from '../../core/tasks.ts'
import type { NewTaskInput } from '../../core/tasks.ts'
import type { TaskTemplate } from '../../core/task-templates.ts'
import type { TaskUpdatePatch } from '../../core/controller.ts'
import type { DraftAttachment } from './composer-attachments.ts'
import type { EncodedImage } from './attach.ts'

/** One v1 leftover: a file the old draft kept as a per-Agent receipt. The bytes
 *  are not recoverable, so the form names it and asks for a re-add. */
export interface LostDraftFile {
  name: string
  bytes: number
}

/** The editable slice of a task as the form sees it ('' = default/clear). */
export interface TaskDraft {
  title: string
  description: string
  prompt: string
  /** What the execution prompt carries (durable refs; the `id` is the strip's
   *  local chip key and is dropped when the task is written). */
  attachments: DraftAttachment[]
  /** v1 leftovers: images the old draft kept as bytes — re-admitted on restore. */
  legacyImages: EncodedImage[]
  /** v1 leftovers: files whose bytes are gone (the form says so). */
  legacyFiles: LostDraftFile[]
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
  /** Accent color (hex string); '' = none. Edited through the form's swatch
   *  row (the one shared grammar) — what the draft carries is always
   *  visible, template stamps included. */
  color: string
}

/** One attachment row's chip key (regenerated on every restore — it is local). */
function chipKey(source: string, index: number, key: string): string {
  return `${source}-${index}-${key.slice(0, 8)}`
}

/**
 * Normalize a parsed draft (a stored draft may predate a field — e.g.
 * `attachments` — so every consumer gets a complete, safe shape). Attachment
 * rows wash element-wise (never a throwing passthrough — a dirty stored draft
 * must degrade to fewer chips, not a crash).
 */
export function normalizeDraft(parsed: Partial<TaskDraft> | null | undefined): TaskDraft | undefined {
  if (parsed === null || parsed === undefined) return undefined
  if (typeof parsed.title !== 'string' || typeof parsed.prompt !== 'string') return undefined
  const row = parsed as unknown as Record<string, unknown>
  const attachments: DraftAttachment[] = []
  if (Array.isArray(row.attachments)) {
    row.attachments.forEach((entry, index) => {
      if (typeof entry !== 'object' || entry === null) return
      const candidate = entry as Record<string, unknown>
      if (typeof candidate.attachmentId !== 'string' || candidate.attachmentId === '') return
      if (typeof candidate.name !== 'string') return
      if (typeof candidate.bytes !== 'number' || !Number.isFinite(candidate.bytes)) return
      attachments.push({
        id: typeof candidate.id === 'string' && candidate.id !== ''
          ? candidate.id
          : chipKey('draft', index, candidate.attachmentId),
        attachmentId: candidate.attachmentId,
        name: candidate.name,
        bytes: candidate.bytes,
        ...typeof candidate.mediaType === 'string' ? { mediaType: candidate.mediaType } : {},
      })
    })
  }
  const legacyImages: EncodedImage[] = []
  if (Array.isArray(row.promptImages)) {
    for (const entry of row.promptImages) {
      if (typeof entry !== 'object' || entry === null) continue
      const candidate = entry as Record<string, unknown>
      if (typeof candidate.data !== 'string' || candidate.data === '') continue
      const mediaType = candidate.mediaType
      legacyImages.push({
        name: typeof candidate.name === 'string' ? candidate.name : '',
        data: candidate.data,
        mediaType: mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp' || mediaType === 'image/gif'
          ? mediaType
          : 'image/jpeg',
      })
    }
  }
  const legacyFiles: LostDraftFile[] = []
  if (Array.isArray(row.promptFiles)) {
    for (const entry of row.promptFiles) {
      if (typeof entry !== 'object' || entry === null) continue
      const candidate = entry as Record<string, unknown>
      if (typeof candidate.name !== 'string' || candidate.name === '') continue
      legacyFiles.push({ name: candidate.name, bytes: typeof candidate.bytes === 'number' ? candidate.bytes : 0 })
    }
  }
  return {
    title: parsed.title,
    description: parsed.description ?? '',
    prompt: parsed.prompt,
    attachments,
    legacyImages,
    legacyFiles,
    status: parsed.status === 'todo' ? 'todo' : 'backlog',
    agentPreset: parsed.agentPreset ?? '',
    workspaceId: parsed.workspaceId ?? '',
    provider: parsed.provider ?? '',
    model: parsed.model ?? '',
    reasoningEffort: parsed.reasoningEffort ?? '',
    permission: parsed.permission ?? '',
    color: typeof parsed.color === 'string' ? parsed.color : '',
  }
}

/** Build a draft from a task record. */
export function draftFromTask(task: TaskRecord): TaskDraft {
  return {
    title: task.title,
    description: task.description,
    prompt: task.prompt,
    // The record's own attachments round-trip (the strip's id is regenerated on
    // load — it is only a local chip key).
    attachments: (task.attachments ?? []).map((ref, index) => ({
      ...ref,
      id: chipKey('loaded', index, ref.attachmentId),
    })),
    // A task born before refs existed carries its pictures as bytes: they are
    // re-admitted into the store the moment this form opens, so an edit turns
    // them into refs without the reader doing anything.
    legacyImages: (task.promptImages ?? []).map(image => ({
      data: image.data,
      mediaType: image.mediaType as EncodedImage['mediaType'],
      name: image.name ?? '',
    })),
    legacyFiles: (task.promptFiles ?? []).map(file => ({ name: file.name, bytes: file.bytes })),
    status: task.status === 'backlog' ? 'backlog' : 'todo',
    agentPreset: task.agentPreset ?? '',
    workspaceId: task.workspaceId ?? '',
    provider: task.provider ?? '',
    model: task.model ?? '',
    reasoningEffort: task.reasoningEffort ?? '',
    permission: task.permission ?? '',
    color: task.color ?? '',
  }
}

/** Build a draft from a saved template (stamp-out fills the new-task form). */
export function draftFromTemplate(template: TaskTemplate): TaskDraft {
  return {
    title: template.title,
    description: template.description,
    prompt: template.prompt,
    // Same round-trip as a persisted task's attachments (strip ids regenerate).
    attachments: (template.attachments ?? []).map((ref, index) => ({
      ...ref,
      id: chipKey('template', index, ref.attachmentId),
    })),
    legacyImages: (template.promptImages ?? []).map(image => ({
      data: image.data,
      mediaType: image.mediaType as EncodedImage['mediaType'],
      name: image.name ?? '',
    })),
    legacyFiles: (template.promptFiles ?? []).map(file => ({ name: file.name, bytes: file.bytes })),
    status: 'backlog',
    agentPreset: template.agentPreset ?? '',
    workspaceId: template.workspaceId ?? '',
    provider: template.provider ?? '',
    model: template.model ?? '',
    reasoningEffort: template.reasoningEffort ?? '',
    permission: template.permission ?? '',
    color: template.color ?? '',
  }
}

/** The stored refs of a draft's ledger (the local chip key is not persisted). */
function storedRefsOf(attachments: readonly DraftAttachment[]): Array<Omit<DraftAttachment, 'id'>> {
  return attachments.map(({ id: _id, ...ref }) => ref)
}

/** Draft → create input; empty fields are omitted (fall back to defaults). */
export function draftToNewInput(draft: TaskDraft): NewTaskInput {
  const attachments = storedRefsOf(draft.attachments)
  const promptImages = draft.legacyImages.map(image => ({ mediaType: image.mediaType, data: image.data, name: image.name }))
  return {
    title: draft.title,
    description: draft.description,
    prompt: draft.prompt,
    ...attachments.length > 0 ? { attachments } : {},
    // A legacy picture is carried into the new task as the shape it is, so the
    // first save does not lose it (the record's own migration turns it into a
    // ref on the next edit).
    ...promptImages.length > 0 ? { promptImages } : {},
    status: draft.status,
    ...draft.agentPreset !== '' ? { agentPreset: draft.agentPreset } : {},
    ...draft.workspaceId !== '' ? { workspaceId: draft.workspaceId } : {},
    // Provider/model ride independently (same law as the update patch — a
    // half route is the caller's explicit state, never silently dropped;
    // the run layer falls back to defaults when the pair is incomplete).
    ...draft.provider !== '' ? { provider: draft.provider } : {},
    ...draft.model !== '' ? { model: draft.model } : {},
    ...draft.reasoningEffort !== '' ? { reasoningEffort: draft.reasoningEffort } : {},
    ...draft.permission !== '' ? { permission: draft.permission } : {},
    ...draft.color !== '' ? { color: draft.color } : {},
  }
}

/** Draft → update patch; empty fields are set to undefined to clear them. */
export function draftToUpdatePatch(draft: TaskDraft): TaskUpdatePatch {
  return {
    title: draft.title,
    description: draft.description,
    prompt: draft.prompt,
    // The whole set is rewritten on every save (present key semantics), and the
    // legacy keys are CLEARED in the same write: the bytes just became refs, so
    // keeping the old fields would leave two answers about one attachment.
    attachments: storedRefsOf(draft.attachments),
    promptImages: [],
    promptFiles: [],
    agentPreset: draft.agentPreset !== '' ? draft.agentPreset : undefined,
    workspaceId: draft.workspaceId !== '' ? draft.workspaceId : undefined,
    provider: draft.provider !== '' ? draft.provider : undefined,
    model: draft.model !== '' ? draft.model : undefined,
    reasoningEffort: draft.reasoningEffort !== '' ? draft.reasoningEffort : undefined,
    permission: draft.permission !== '' ? draft.permission : undefined,
    color: draft.color !== '' ? draft.color : undefined,
  }
}

/** Whether a draft field counts as user-filled (a template must not cover
 *  it): non-empty text, a non-default status, a non-empty attachment set. */
function filledText(value: string): boolean {
  return value !== ''
}

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
export function stampTemplate(draft: TaskDraft, stamped: TaskDraft): TaskDraft {
  const userRouteComplete = filledText(draft.provider) && filledText(draft.model)
  return {
    title: filledText(draft.title) ? draft.title : stamped.title,
    description: filledText(draft.description) ? draft.description : stamped.description,
    prompt: filledText(draft.prompt) ? draft.prompt : stamped.prompt,
    attachments: draft.attachments.length > 0 ? draft.attachments : stamped.attachments,
    legacyImages: draft.legacyImages.length > 0 ? draft.legacyImages : stamped.legacyImages,
    legacyFiles: draft.legacyFiles.length > 0 ? draft.legacyFiles : stamped.legacyFiles,
    status: draft.status !== 'backlog' ? draft.status : stamped.status,
    agentPreset: filledText(draft.agentPreset) ? draft.agentPreset : stamped.agentPreset,
    workspaceId: filledText(draft.workspaceId) ? draft.workspaceId : stamped.workspaceId,
    provider: userRouteComplete ? draft.provider : stamped.provider,
    model: userRouteComplete ? draft.model : stamped.model,
    reasoningEffort: userRouteComplete ? draft.reasoningEffort : stamped.reasoningEffort,
    permission: filledText(draft.permission) ? draft.permission : stamped.permission,
    color: filledText(draft.color) ? draft.color : stamped.color,
  }
}
