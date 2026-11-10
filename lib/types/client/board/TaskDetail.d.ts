import type { BoardController } from '../../core/controller.ts';
import { type TaskRecord } from '../../core/tasks.ts';
/** Task detail overlay. */
export declare function TaskDetail({ controller, task, workspaceTitleOf, dragSourceRef, requestSessionId, onRequestSessionConsumed, onLaunched }: {
    controller: BoardController;
    /** The card this sheet is open on, as the opener resolved it. The sheet re-reads
     *  the live record itself (see `current`) — this is the FLOOR for the frame where
     *  the ledger no longer carries the id (a delete in flight), not the value shown. */
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
    /** Fired after a session request has been consumed (parent resets it). */
    onRequestSessionConsumed?: () => void;
    /** Fired with the card's title when a launch is ACCEPTED. The parent owns the
     *  receipt line because this sheet unmounts on the same tick (it closes so the
     *  board stays visible while the task runs) — a receipt set here would be
     *  unmounted before it could be read. */
    onLaunched?: (title: string) => void;
}): import("react").JSX.Element;
