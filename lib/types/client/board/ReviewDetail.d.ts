import type { BoardController } from '../../core/controller.ts';
import { type ExecutionRecord, type TaskRecord } from '../../core/tasks.ts';
/** The review page (see module doc). */
export declare function ReviewDetail({ controller, task, execution, onClose }: {
    controller: BoardController;
    /** The task owning the execution (re-read from the controller snapshot on updates). */
    task: TaskRecord;
    /** The execution row that was clicked (its session is reviewed and continued). */
    execution: ExecutionRecord;
    onClose: () => void;
}): import("react").JSX.Element;
