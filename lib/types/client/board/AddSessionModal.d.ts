import type { BoardController } from '../../core/controller.ts';
import type { TaskRecord } from '../../core/tasks.ts';
export declare function AddSessionModal({ controller, task, onClose }: {
    controller: BoardController;
    task: TaskRecord;
    onClose: () => void;
}): import("react").JSX.Element;
