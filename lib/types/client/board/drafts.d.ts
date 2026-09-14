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
import type { QuestionDraft } from '../../core/question-rpc.ts';
/** Storage key for the draft document. */
export declare const DRAFT_STORAGE_KEY = "dsh.taskBoard.drafts.v1";
/** Shared comment-composer draft key for one native session of one task. */
export declare function commentDraftKey(taskId: string, sessionId: string): string;
/** Task edit-form draft key (the whole TaskDraft, JSON-encoded). */
export declare function editDraftKey(taskId: string): string;
/** Refinement answer-box draft key. */
export declare function refineDraftKey(taskId: string): string;
/** New-task modal draft key (one global slot — no task id exists yet). */
export declare const NEW_TASK_DRAFT_KEY = "new";
/** New-session modal draft key for one task (title + run config, JSON). The
 *  half-typed name and the picked model/permission must survive closing the
 *  dialog — the same promise every other input surface keeps. */
export declare function newSessionDraftKey(taskId: string): string;
/** Session-rule form draft key (the instruction text) for one task + rule. */
export declare function ruleDraftKey(taskId: string, ruleId: string): string;
/** Answer-form draft key for one open question carrier.
 *
 *  Keyed by `rpcId` alone, and that is the point: the host mints one rpcId per
 *  open `ask()` and REPLAYS it with every requested frame, so the key survives
 *  a re-render, a remount and a page reload — which is exactly the window in
 *  which a half-completed answer used to be destroyed. A genuinely new request
 *  mints a new rpcId and therefore starts clean, so the isolation the component
 *  already got from `key={rpcId}` is preserved.
 */
export declare function questionDraftKey(rpcId: string): string;
/** Persistence seam for drafts (framework-free, testable). */
export interface DraftStore {
    /** Read a draft slot (undefined when never written or already cleared). */
    get(key: string): string | undefined;
    /** Write a draft slot; an empty string is treated as a clear. */
    set(key: string, text: string): void;
    /** Forget a draft slot. */
    clear(key: string): void;
}
/** localStorage-backed drafts (the browser backend). Failures degrade to
 *  memory-only safety: a write that errors (private mode, quota) never throws
 *  and simply leaves the previous persisted state; in-memory state stays
 *  live for the session. */
export declare class LocalStorageDraftStore implements DraftStore {
    private readonly key;
    private readonly storage;
    constructor(key?: string, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined);
    private read;
    private write;
    get(key: string): string | undefined;
    set(key: string, text: string): void;
    clear(key: string): void;
}
/** In-memory backend (tests; also the reference semantics). */
export declare class InMemoryDraftStore implements DraftStore {
    private readonly map;
    get(key: string): string | undefined;
    set(key: string, text: string): void;
    clear(key: string): void;
}
/** The default browser-backed singleton the surfaces use. */
export declare const draftStore: DraftStore;
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
export declare function saveQuestionDrafts(store: DraftStore, rpcId: string, drafts: readonly unknown[]): void;
/**
 * Read a saved answer batch back. Returns undefined when nothing usable is
 * stored — the caller then falls back to its own fresh drafts, so this can
 * never hand back a partial or malformed batch.
 */
export declare function restoreQuestionDrafts(store: DraftStore, rpcId: string): QuestionDraft[] | undefined;
