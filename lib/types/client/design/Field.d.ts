/**
 * The form controls: one field wrapper and three thin control wrappers.
 *
 * WHY THIN WRAPPERS ARE WORTH IT. `.input` is not a decorative class — it carries
 * `box-sizing: border-box`, and the note on it in the design sheet records what
 * happens without it: two fields in the preset dialog measured 229px and 271px
 * against tracks of 205 and 247, each 24px fat — exactly twice its own
 * `padding: 0 12px` — and the 48px of overflow against 16px of gutter pushed the
 * 「添加」 button under the next control. A raw `<input>` that forgets the class
 * does not look slightly wrong; it breaks the row it is in.
 *
 * Forty-seven controls were writing `<input className={css.input}>` by hand, and
 * seven of those also had to remember `css.inputInvalid`. Remembering is the
 * failure mode: it fails silently, in a way that looks like a styling taste
 * rather than a bug. The wrapper makes the class non-optional.
 *
 * `invalid` is a prop rather than a class the caller passes because it is a
 * STATE of the control, not a look the surface invents — and because the pairing
 * (`border-color` now, and again on `:focus`, so the error does not vanish the
 * moment the user clicks into the field to fix it) is a decision the design
 * system should hold once.
 */
import type { ComponentPropsWithRef, ReactNode } from 'react';
/** A single-line text field. */
export declare function Input({ invalid, className, ...rest }: ComponentPropsWithRef<'input'> & {
    /** The field is holding a value the user must fix. */
    invalid?: boolean;
}): import("react").JSX.Element;
/** A multi-line text field. `textarea.input` raises the height and re-pads the
 *  box for wrapped text, so this is a real variant and not just a tag swap.
 *
 *  **`data-dsh-tb-scroll` IS WHAT MAKES A LONG ANSWER REACHABLE.** The height has a
 *  ceiling (twelve lines, declared in `components.module.css`), so a paragraph that
 *  outgrows it has to scroll INSIDE the box — and the shared scroll grammar (the
 *  8px bar whose track is inset at both ends) is keyed on that attribute, the same
 *  one the list panel's writing box mounts. Without it the box either clipped its
 *  own tail or drew the raw platform bar through its rounded corner. */
export declare function TextArea({ invalid, className, ...rest }: ComponentPropsWithRef<'textarea'> & {
    invalid?: boolean;
}): import("react").JSX.Element;
/** A select. */
export declare function Select({ invalid, className, children, ...rest }: ComponentPropsWithRef<'select'> & {
    invalid?: boolean;
    children: ReactNode;
}): import("react").JSX.Element;
/**
 * A labelled field: the wrapper, the caption, the control, and an optional hint.
 *
 * `wrap` IS THE PART WORTH CENTRALISING. A field is a `<label>` so that clicking
 * the caption lands the cursor in the control — but a field whose content holds
 * BUTTONS must be a `<div>`, because inside a `<label>` every click on those
 * buttons is routed to the input instead of doing its job. Both panels had
 * discovered this and written the reasoning out separately, which is the shape
 * of a rule that belongs in one place: `wrap="div"` is now the one way to say it,
 * and the default is the one that makes the caption clickable.
 */
export declare function Field({ label, hint, wrap, htmlFor, className, labelClassName, wrapperProps, children }: {
    /** The visible caption. */
    label: string;
    /** One line under the control. */
    hint?: string;
    wrap?: 'label' | 'div';
    /** Point the caption at a control that is NOT its next sibling — a select
     *  nested one level down inside a row, where a wrapping `<label>` could not
     *  say which control it names. Setting this renders the caption as a real
     *  `<label for>` and forces the `div` wrapper: a label cannot contain a label. */
    htmlFor?: string;
    /** The surface's own class on the wrapper, for its own layout. */
    className?: string;
    /** The surface's own class on the CAPTION — a surface whose captions sit on a
     *  different tier (the list panel's are a step quieter) says so here rather
     *  than reaching in with a descendant selector. */
    labelClassName?: string;
    /** Extra attributes for the wrapper itself (a drop target's drag handlers).
     *  One prop rather than a spread, so the wrapper's element type stays the
     *  component's decision. */
    wrapperProps?: ComponentPropsWithRef<'div'>;
    children: ReactNode;
}): import("react").JSX.Element;
