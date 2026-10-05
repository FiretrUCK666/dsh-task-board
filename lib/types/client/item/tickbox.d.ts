/**
 * The tick box, and nothing else.
 *
 * ── WHY THIS IS A COMPONENT AND NOT A `<input type="checkbox">` ─────────────
 *
 * A native checkbox is drawn by the platform, and the platform draws it at the
 * platform's idea of a size, in the platform's ink, at the platform's strike
 * height. Two places on this surface want one — the step board and the archive's
 * multi-select — and both asked for the same thing: a 16px rounded square whose
 * tick is drawn by *us*.
 *
 * The tick is a rotated border, not a glyph, and that is the whole point. A tick
 * made of a character sits wherever that font puts it, which is why 「这个勾偏左」
 * is a symptom that returns the first time the font stack or the font size
 * changes: nothing about a glyph-based tick is a promise about geometry. A border
 * rotated 42 degrees has four numbers, and the four numbers can be asserted.
 *
 * ── WHY THE INPUT IS STILL THERE ────────────────────────────────────────────
 *
 * It is `appearance: none` and it lies on top of the drawing, so the control is
 * a real checkbox for the keyboard, the form and assistive technology while every
 * pixel a reader sees comes from one rule. Dropping the element would have made
 * the surface quieter and the surface unoperable.
 */
import type { ReactElement } from 'react';
export interface TickboxProps {
    readonly checked: boolean;
    /** What this box is about, in words — never the word 「选中」. */
    readonly label: string;
    readonly onToggle: () => void;
    /** Set for the archive's multi-select, left off for a step's done state. */
    readonly pressed?: boolean;
}
/**
 * ONE CHECKBOX, drawn here rather than by the platform.
 * @param props - its state, its name, and the press.
 * @returns the element.
 */
export declare function Tickbox(props: TickboxProps): ReactElement;
