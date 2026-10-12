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
