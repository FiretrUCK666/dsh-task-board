/**
 * Draft persistence: unsent half-written text for every input surface that
 * unmounts when the user switches away (comment composers, the task edit
 * form, the new-task modal). A small storage seam with
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
import type { QuestionDraft } from '../../core/question-rpc.ts'

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

/** Answer-form draft key for one open question carrier.
 *
 *  Keyed by `rpcId` alone, and that is the point: the host mints one rpcId per
 *  open `ask()` and REPLAYS it with every requested frame, so the key survives
 *  a re-render, a remount and a page reload — which is exactly the window in
 *  which a half-completed answer used to be destroyed. A genuinely new request
 *  mints a new rpcId and therefore starts clean, so the isolation the component
 *  already got from `key={rpcId}` is preserved.
 */
export function questionDraftKey(rpcId: string): string {
  return `question:${rpcId}`
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

/**
 * Answer-form drafts are a LIST of objects, while `DraftStore` holds one string
 * per slot — so the two typed helpers below are the only place that knows the
 * encoding. Keeping them here (rather than in the component) means the round
 * trip is testable on its own, and the component only ever sees `QuestionDraft[]`.
 *
 * Validation is deliberately strict and total: a draft slot is user-writable
 * storage that can hold anything at all (an older build's shape, a hand-edited
 * value, a truncated write). Anything that does not parse into the exact shape
 * is dropped rather than trusted, so a corrupted slot degrades to "no draft"
 * instead of throwing inside render or restoring a malformed answer.
 */
export function saveQuestionDrafts(store: DraftStore, rpcId: string, drafts: readonly unknown[]): void {
  const key = questionDraftKey(rpcId)
  // An all-empty batch is not a draft: writing it would leave a slot behind for
  // every question the user merely looked at, and would make "is there anything
  // to restore" unanswerable.
  const hasContent = drafts.some(draft => {
    if (typeof draft !== 'object' || draft === null) return false
    const entry = draft as { selected?: unknown; custom?: unknown; skipped?: unknown }
    const selected = Array.isArray(entry.selected) ? entry.selected.length > 0 : false
    const custom = typeof entry.custom === 'string' && entry.custom !== ''
    return selected || custom || entry.skipped === true
  })
  if (!hasContent) {
    store.clear(key)
    return
  }
  store.set(key, JSON.stringify(drafts))
}

/**
 * Read a saved answer batch back. Returns undefined when nothing usable is
 * stored — the caller then falls back to its own fresh drafts, so this can
 * never hand back a partial or malformed batch.
 */
export function restoreQuestionDrafts(store: DraftStore, rpcId: string): QuestionDraft[] | undefined {
  const raw = store.get(questionDraftKey(rpcId))
  if (raw === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined
  const out: QuestionDraft[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const record = entry as { selected?: unknown; custom?: unknown; skipped?: unknown }
    if (!Array.isArray(record.selected)) return undefined
    const selected = record.selected.filter((value): value is string => typeof value === 'string')
    if (selected.length !== record.selected.length) return undefined
    if (record.custom !== undefined && typeof record.custom !== 'string') return undefined
    if (record.skipped !== undefined && typeof record.skipped !== 'boolean') return undefined
    out.push({
      selected,
      ...(record.custom !== undefined ? { custom: record.custom } : {}),
      ...(record.skipped !== undefined ? { skipped: record.skipped } : {}),
    })
  }
  return out
}
