import type { BoardController } from '../../core/controller.ts';
import { type TaskRecord } from '../../core/tasks.ts';
/** The linked-session panel (see module doc). */
export declare function SessionDetail({ controller, task, sessionId, onClose }: {
    controller: BoardController;
    /** The task owning the binding (re-read from the controller snapshot on updates). */
    task: TaskRecord;
    /** The linked row that was clicked. */
    sessionId: string;
    onClose: () => void;
}): import("react").JSX.Element;
