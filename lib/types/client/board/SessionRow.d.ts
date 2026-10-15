import { type ReactNode } from 'react';
import type { SessionChipShape, SessionRowState } from './session-chip.ts';
/** The unified session row (one grammar for every session of a task). */
export declare function SessionRow({ state, chip, leading, meta, footer, handle, sessionId, onActivate, onOpenSession, onHide, hideTitle, draggable, onDragStart, onDragEnd, onRename, renameTitle, unviewed }: {
    /** Live session state (execution kind): rendered as data-state/data-waiting. */
    state?: SessionRowState;
    /** Status chip on the top line (undefined = no chip). */
    chip: SessionChipShape | undefined;
    /** Top-line identity slot (session title + run note / workspace label). */
    leading: ReactNode;
    /** Meta line below the top line (times / last-updated). */
    meta: ReactNode;
    /** Execution-only slots below the meta line (comments, dynamics, error). */
    footer?: ReactNode;
    /** Waiting-state amber "处理" label; replaces the ghost "查看会话" button. */
    handle?: string;
    /** The native session id; undefined suppresses the session affordances. */
    sessionId: string | undefined;
    /** Row activation (review page for a run row, session panel otherwise). */
    onActivate: () => void;
    /** Open the native session page (the ghost button / amber handle). */
    onOpenSession: () => void;
    /** Hide the row from display only (non-destructive; numbering stays stable). */
    onHide: () => void;
    /** Tooltip of the quiet hide affordance. */
    hideTitle: string;
    /** Make the row draggable (the detail's manual 会话 reorder). */
    draggable?: boolean;
    onDragStart?: (event: React.DragEvent) => void;
    onDragEnd?: () => void;
    /** Rename affordance (the quiet pencil in the action group): submits the
     *  new title; a rejection throws so the row can surface it inline. */
    onRename?: (title: string) => Promise<void>;
    /** Tooltip of the rename affordance. */
    renameTitle?: string;
    /**
     * This session has content the user has not acknowledged yet (the
     * per-session read clock — every surface passes `sessionUnviewedOf`).
     * The row then wears the amber `unread` breath, so "which session just
     * finished" is answerable inside the list, not only from the card's edge.
     * Absent = no read state — quiet, honestly.
     */
    unviewed?: boolean;
}): import("react").JSX.Element;
