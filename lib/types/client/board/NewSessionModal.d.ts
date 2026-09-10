import type { BoardController } from '../../core/controller.ts';
import type { TaskRecord } from '../../core/tasks.ts';
/** The "create a configured session for this task" dialog (see module doc). */
export declare function NewSessionModal({ controller, task, onClose, onCreated }: {
    controller: BoardController;
    task: TaskRecord;
    onClose: () => void;
    /** The session joined the task (the section flashes its bind feedback). */
    onCreated: (sessionId: string) => void;
}): import("react").JSX.Element;
