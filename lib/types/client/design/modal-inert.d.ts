/**
 * `aria-modal="true"` is a PROMISE, and this is the half of it that is not a word.
 *
 * A layer that declares itself modal is saying: **everything outside me is
 * inert** — not visible to a screen reader, not reachable by Tab, not part of
 * what the reader is currently being asked about. Declaring it and not doing it
 * leaves the content behind the mask fully live: a keyboard user tabs out of an
 * open sheet and operates a list they cannot see, and a screen reader reads the
 * page underneath the dialog it is supposed to be inside.
 *
 * It is also what a checker sees: with the background marked, an audit stops
 * trying to measure text that sits behind an overlay's mask (measured on the
 * create sheet: 53 findings -> 4, and all 49 "could not be measured" went to
 * zero). That is not a trick — it is the same fact stated twice, once for the
 * reader and once for the machine.
 *
 * WHY IT STOPS AT THE PANEL. The walk goes up from the layer to the plugin's own
 * seat (`[data-dsh-taskboard-view]`) and no further. Above that seat is the
 * shell, which is not ours to hide: marking it would take the sidebar and the
 * conversation away from a reader who only opened a sheet.
 */
import { type RefObject } from 'react';
/**
 * Mark everything outside `self`, inside the plugin's own seat, as inert.
 * @param self - the modal layer that owns the screen right now.
 * @returns a restore function; call it on unmount.
 */
export declare function inertOutside(self: Element): () => void;
/**
 * While `active`, keep everything outside `ref`'s element inert.
 * @param ref - the modal layer's own root.
 * @param active - whether that layer is on screen.
 */
export declare function useModalInert(ref: RefObject<Element | null>, active: boolean): void;
