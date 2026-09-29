/**
 * Dialog: the shared modal skeleton — backdrop, centered panel, optional
 * header with a close button. Every overlay (new-task, preset manager,
 * confirmations) rides the same backdrop and panel styling, so the board's
 * dialogs share one look and one motion and can never drift apart. The
 * review page keeps its custom header (badge + session jump) but uses the
 * same backdrop/panel rules via its own classes.
 *
 * PORTAL IS THE DEFAULT: every board dialog anchors to the board box
 * (`[data-dsh-taskboard-view]`) — the one layer whose geometry is the honest
 * board-box reference. A dialog left in its DOM position instead anchors its
 * backdrop to the nearest positioned ancestor (a board header, an open panel)
 * and is clipped by its `overflow:hidden` — the "new-task run-config is dead /
 * size-limited / cut off" regression. A caller opts OUT only with an explicit
 * `portal={false}` when it is already a top-level board overlay (none today);
 * forgetting `portal` can no longer reintroduce the bug.
 *
 * ESC closes the dialog — through the SHARED Escape stack (escape-stack.ts),
 * so a nested overlay (a confirm over a manager) closes ONE layer per press,
 * never the whole stack at once. TaskDetail and SessionFrame register through
 * the same hook; the whole family shares one grammar.
 *
 * FOCUS is a closed loop here too: opening moves focus to the first control
 * (or the panel itself when there is none), Tab cycles inside the panel
 * (never leaks to the board behind), and closing returns focus to whatever
 * held it — the trigger the user came from. Every caller inherits this; no
 * dialog manages focus on its own.
 */
import { type ReactNode } from 'react';
/** The board box: the anchor every board dialog's backdrop covers. Exported
 *  for overlay shells that portal directly (SessionFrame). */
export declare function boardBox(): Element;
/** One centered modal panel (see module doc). */
export declare function Dialog({ title, label, onClose, className, children, portal, focusKey }: {
    /** Optional header title; when absent the header (and its close button) are omitted. */
    title?: string;
    /** aria-label for the dialog role. */
    label: string;
    onClose: () => void;
    /** Extra panel class (width overrides, e.g. the preset modal). */
    className?: string;
    /** Render into the board box (the default; see module doc). */
    portal?: boolean;
    /**
     * Change this to RE-AIM focus inside a dialog that stays open and swaps its
     * own contents.
     *
     * A dialog that opens a form usually does it by REPLACING the button that opened
     * it, so that button unmounts and focus falls to `document.body`. The trap in
     * `dialog-focus` is a keydown handler ON THE PANEL, and `document.body` is not
     * the panel — so the trap never fires again and Tab walks straight out of the
     * overlay into the board behind it. The form is right there and the keyboard
     * has left the room.
     *
     * So the caller passes whatever identifies the new contents (a form key), and
     * the hook moves focus to the first thing inside it. `TaskDetail` has always
     * done this by calling the hook itself with an `editing` flag; this is the same
     * mechanism for the two dialogs that could not reach it.
     */
    focusKey?: unknown;
    children: ReactNode;
}): import("react").JSX.Element;
