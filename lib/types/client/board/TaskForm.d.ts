/**
 * Shared task form: content fields (title / description / prompt) plus the
 * run-configuration selector row — the config FIELDS themselves are the ONE
 * RunConfigFields block (preset picker + RunConfigEditor) shared with the
 * new-session dialog, so a task and a session configure the same things in
 * the same order. Used by the new-task modal and the detail edit mode so
 * both surfaces stay identical. Fully controlled: the parent owns the draft.
 *
 * The execution prompt carries an attachment ledger (the shared composer
 * hook, controlled by the draft): images persist as bytes; files persist as
 * name + bytes and are RE-STAGED per run session at send time (receipts are
 * per-Agent, never persisted). Pick / drop / paste anywhere on the prompt
 * field, capped in count — and every run path (manual / cron / cruise /
 * chain) sends the same attachments with the text.
 */
import type { BoardController } from '../../core/controller.ts';
import type { TaskDraft } from './task-draft.ts';
/** The shared new/edit task form. */
export declare function TaskForm({ draft, onChange, controller, withStatus, sessionId }: {
    draft: TaskDraft;
    onChange: (next: TaskDraft) => void;
    controller: BoardController;
    /** Show the landing-column selector (new-task modal only). */
    withStatus?: boolean;
    /** The session scoping the run prompt's official '@' reference menu — the
     *  task's own session when editing; a resolved current/first session (or
     *  undefined = '@' closed) when creating. */
    sessionId?: string;
}): import("react").JSX.Element;
