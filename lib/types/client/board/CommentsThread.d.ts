import type { TaskRecord } from '../../core/tasks.ts';
import { type CommentView } from './comment-thread.ts';
/** Renders the task's comment views (oldest first) with cancel affordances. */
export declare function CommentsThread({ task, views, onCancel }: {
    task: TaskRecord;
    views: readonly CommentView[];
    /** Cancel a pending round (a saved/queued round is removed on true). */
    onCancel: (roundId: string) => boolean;
}): import("react").JSX.Element;
