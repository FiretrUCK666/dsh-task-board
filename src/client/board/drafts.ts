/**
 * Draft persistence: unsent half-written text for every input surface that
 * unmounts when the user switches away (comment composers, the task edit
 * form, the new-task modal, the refine answer box). A small storage seam with
 * a localStorage backend, mirroring the task-ledger store: whatever the
 * user typed is restored when they come back, and cleared the moment the
 * text is actually sent / saved / discarded.
 *
 * Keys are namespaced by surface so two inputs that share identity share one
 * draft (a session's comment composers on the review page and the linked
 * panel are the same composer, so they share `comment:taskId:sessionId`);
 * unrelated inputs never collide. Only the new `dsh.taskBoard.drafts.v1`
 * key is used — the task ledger key `dsh.taskBoard.v1` is untouched.
 */

/** Storage key for the draft document. */
export const DRAFT_STORAGE_KEY = 'dsh.taskBoard.drafts.v1'

/** Shared comment-composer draft key for one native session of one task. */
export function commentDraftKey(taskId: string, sessionId: string): string {
  return `comment:${taskId}:${sessionId}`
}

/** Task edit-form draft key (the whole TaskDraft, JSON-encoded). */
export function editDraftKey(taskId: string): string {
  return `edit:${taskId}`
}

/** Refinement answer-box draft key. */
export function refineDraftKey(taskId: string): string {
  return `refine:${taskId}`
}

/** New-task modal draft key (one global slot — no task id exists yet). */
export const NEW_TASK_DRAFT_KEY = 'new'

/** New-session modal draft key for one task (title + run config, JSON). The
 *  half-typed name and the picked model/permission must survive closing the
 *  dialog — the same promise every other input surface keeps. */
export function newSessionDraftKey(taskId: string): string {
  return `newsession:${taskId}`
}

/** Session-rule form draft key (the instruction text) for one task + rule. */
export function ruleDraftKey(taskId: string, ruleId: string): string {
  return `rule:${taskId}:${ruleId}`
}

/** Persistence seam for drafts (framework-free, testable). */
export interface DraftStore {
  /** Read a draft slot (undefined when never written or already cleared). */
  get(key: string): string | undefined
  /** Write a draft slot; an empty string is treated as a clear. */
  set(key: string, text: string): void
  /** Forget a draft slot. */
  clear(key: string): void
}

/** localStorage-backed drafts (the browser backend). Failures degrade to
 *  memory-only safety: a write that errors (private mode, quota) never throws
 *  and simply leaves the previous persisted state; in-memory state stays
 *  live for the session. */
export class LocalStorageDraftStore implements DraftStore {
  constructor(
    private readonly key: string = DRAFT_STORAGE_KEY,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = globalThis.localStorage,
  ) {}

  private read(): Record<string, string> {
    if (this.storage === undefined) return {}
    try {
      const raw = this.storage.getItem(this.key)
      if (raw === null) return {}
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return {}
      const map: Record<string, string> = {}
      for (const [name, value] of Object.entries(parsed)) {
        if (typeof value === 'string') map[name] = value
      }
      return map
    } catch {
      return {}
    }
  }

  private write(map: Record<string, string>): void {
    if (this.storage === undefined) return
    try {
      this.storage.setItem(this.key, JSON.stringify(map))
    } catch {
      // Persistence skipped; the in-memory copy in `read` is not retained,
      // so this is best-effort by design (drafts are disposable).
    }
  }

  get(key: string): string | undefined {
    return this.read()[key]
  }

  set(key: string, text: string): void {
    const map = this.read()
    if (text === '') {
      delete map[key]
      this.write(map)
      return
    }
    map[key] = text
    this.write(map)
  }

  clear(key: string): void {
    const map = this.read()
    if (key in map) {
      delete map[key]
      this.write(map)
    }
  }
}

/** In-memory backend (tests; also the reference semantics). */
export class InMemoryDraftStore implements DraftStore {
  private readonly map = new Map<string, string>()

  get(key: string): string | undefined {
    return this.map.get(key)
  }

  set(key: string, text: string): void {
    if (text === '') this.map.delete(key)
    else this.map.set(key, text)
  }

  clear(key: string): void {
    this.map.delete(key)
  }
}

/** The default browser-backed singleton the surfaces use. */
export const draftStore: DraftStore = new LocalStorageDraftStore()
