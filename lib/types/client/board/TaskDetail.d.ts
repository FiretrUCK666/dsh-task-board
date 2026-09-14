import type { BoardController } from '../../core/controller.ts';
import { type TaskRecord } from '../../core/tasks.ts';
/** Task detail overlay. */
export declare function TaskDetail({ controller, task, workspaceTitleOf, dragSourceRef, requestSessionId, requestSurface, onRequestSessionConsumed }: {
    controller: BoardController;
    task: TaskRecord;
    /** Resolve a workspace id to its display title (raw id when unknown). */
    workspaceTitleOf: (workspaceId: string) => string;
    /** The board's card-drag latch (set synchronously at card dragstart), so the
     *  session-area drop zone can tell a sidebar drag from the board's own card
     *  drags (both advertise `text/plain`). */
    dragSourceRef: {
        readonly current: boolean;
    };
    /** One-shot deep link: open this session's panel (its comment thread) once
     *  it becomes defined. The parent clears it via `onRequestSessionConsumed`,
     *  so it fires exactly once per request and never reopens on later renders
     *  or task switches. Absent = open no panel (existing behavior). */
    requestSessionId?: string;
    /** Which surface the deep link lands on: `refine` = the task's refinement
     *  section (a refine session has no linked-session panel); `session` (or
     *  absent) = the linked-session panel. Decided once by the caller from
     *  `task.refineSessionId` — never re-derived here. */
    requestSurface?: 'session' | 'refine';
    /** Fired after a session request has been consumed (parent resets it). */
    onRequestSessionConsumed?: () => void;
}): import("react").JSX.Element;
