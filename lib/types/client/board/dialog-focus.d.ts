/**
 * Dialog focus loop (THE one implementation — Dialog, TaskDetail and
 * SessionFrame all read this; no overlay manages focus on its own):
 * opening moves focus to the first control (or the panel itself when there
 * is none), Tab cycles inside the panel (never leaks to the board behind),
 * and closing returns focus to whatever held it. Escape stays out of here —
 * the shared Escape stack (escape-stack.ts) owns keys, this owns focus.
 */
import { type KeyboardEvent, type RefObject } from 'react';
/** Tabbable AND visible controls inside a root (keyboard order = DOM order).
 *  Hidden inputs (`type=hidden`), aria-hidden subtrees and display:none
 *  members never join the loop — focusing an invisible step reads as a
 *  lost focus. One predicate, three surfaces (never per-surface filters). */
export declare function focusablesOf(root: Element): HTMLElement[];
/** Own the focus loop for one panel: mount-focus + unmount-return + Tab trap.
 *  The caller spreads the returned `onKeyDown` onto the panel element. The
 *  mount target is the first `[data-autofocus]` descendant when one exists
 *  (the caller's declared intent — e.g. a filter box over a master switch),
 *  else the first tabbable control, else the panel itself. Native `autoFocus`
 *  is banned for MOUNT-time focus inside Dialog subtrees (it races this
 *  effect — declare intent with `data-autofocus` instead); late-mounted
 *  inline editors (row rename, goal edit) keep native `autoFocus`, which fires
 *  after this effect ran and therefore never competes with it.
 *
 *  `focusKey` re-aims focus WITHOUT touching the return chain: pass a value
 *  that flips when the panel's first control changes identity (e.g. the
 *  detail's edit mode swapping the Edit button for a form). The return chain
 *  stays mount-scoped — only the mount effect captures `previous`.
 *
 *  Return falls back down a chain: the opener when alive, else the first
 *  tabbable control of the board box (a deleted trigger must not strand
 *  keyboard users on body). */
export declare function useDialogFocus(ref: RefObject<HTMLElement | null>, focusKey?: unknown): {
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
};
