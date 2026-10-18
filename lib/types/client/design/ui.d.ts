/**
 * Shared UI primitives for the board: Button, Section, Notice,
 * Icon. One source for button variants, section titles, the waiting notice
 * and the icon set — every surface consumes these instead of
 * hand-rolled markup, so the whole board speaks one design language and
 * follows the native --dsw-* tokens (light/dark + any skin plugin) without
 * any per-surface styling drift.
 */
import { type InputHTMLAttributes, type ReactNode } from 'react';
/** One button variant; shared rhythm everywhere. `dangerGhost` is the
 *  row-level destructive affordance (outline + danger text) — the filled
 *  `danger` stays reserved for the primary destroyer (confirm dialogs,
 *  the detail footer's delete).
 *
 *  THE ARRAY IS THE DEFINITION and the type is derived from it, so the
 *  design-system gallery can render every variant by iterating it. A union
 *  written by hand beside a hand-written list is two statements of one fact,
 *  and the gallery — whose whole job is "show me everything the system has" —
 *  is exactly where the second one goes stale without anyone noticing. */
export declare const BUTTON_VARIANTS: readonly ["primary", "ghost", "danger", "dangerGhost"];
/** One button variant. */
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
/** The variants that can carry a TOGGLE state.
 *
 *  `.buttonPressed` is a ghost treatment — hover tone plus a stronger border, and
 *  deliberately no fill (see its rule in the design sheet). On a FILLED variant
 *  it replaces the fill with a nearly transparent wash while the text stays
 *  white: the label disappears. Measured on the gallery's own `pressed` specimen
 *  for `primary` — 1.11:1, effectively invisible.
 *
 *  So `pressed` is not a free-standing flag; it is a property of the ghost
 *  family. The list below is the definition, the type is derived from it, and the
 *  button's props are a union that makes `variant="primary" pressed` a COMPILE
 *  ERROR rather than a button nobody can read. A hand-written list beside a
 *  hand-written union would be two statements of one fact — and this one already
 *  went stale once. */
export declare const BUTTON_TOGGLE_VARIANTS: readonly ["ghost", "dangerGhost"];
/** A variant that can be a toggle. */
export type ButtonToggleVariant = (typeof BUTTON_TOGGLE_VARIANTS)[number];
/** The filled variants — `pressed` is not expressible on these. */
type ButtonFillVariant = Exclude<ButtonVariant, ButtonToggleVariant>;
/** Everything a button takes, whatever its variant. */
type ButtonCommon = {
    size?: 'sm';
    type?: 'button' | 'submit';
    className?: string;
    disabled?: boolean;
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
    title?: string;
    /** The button's ACCESSIBLE NAME, for a button whose face is a word that does
     *  not name what it does. `title` is not a substitute: hard rule 11 says a
     *  control that only explains itself on hover has no explanation on a phone,
     *  and a title is exactly that. */
    label?: string;
    children: ReactNode;
};
/** A button's props: the toggle state exists only where it can be styled. */
type ButtonProps = ButtonCommon & ({
    variant?: ButtonToggleVariant;
    /** Toggle-state styling (aria-pressed): an active mode reads through a
     *  gentle press, never through a fill. */
    pressed?: boolean;
} | {
    variant: ButtonFillVariant;
    pressed?: never;
});
/** The board's one button (see module doc). The click handler receives the
 *  native event so callers inside clickable rows can stopPropagation; plain
 *  zero-arg handlers stay assignable (fewer parameters are always valid).
 *  `size="sm"` is the quiet row/header variant (view-session, refresh, row
 *  actions): one compact size for every secondary in-list affordance, so the
 *  board never mixes a full-size button into a row. */
export declare function Button({ variant, size, type, className, disabled, pressed, onClick, title, label, children }: ButtonProps): import("react").JSX.Element;
/**
 * The board's one icon-only button.
 *
 * WHY IT EXISTS. Five surfaces were hand-writing
 * `<button className={css.iconButton}><Icon name="close" /></button>` — the
 * markup is four lines, so it got copied rather than reached for, and every copy
 * was a place where the accessible name could be forgotten and where a size
 * tweak had to be re-derived. The class existed; the component did not, and a
 * class is not something a page author looks for.
 *
 * `label` IS REQUIRED, and that is the point of the component rather than a
 * formality: an icon-only control has no text, so without it the button
 * announces nothing. Hard rule 11 forbids a control whose only explanation is a
 * `title` — hover does not exist on a phone — so the accessible name is a
 * parameter, not an option.
 *
 * `size` is the component's own ladder (see the size steps in the design sheet):
 * `lg` is the 30px toolbar default, `md` the full button height, `sm` the
 * compact one. A row picks ONE tier; it never mixes two heights side by side.
 */
export declare const ICON_BUTTON_SIZES: readonly ["lg", "md", "sm"];
/** One icon-button size step. */
export type IconButtonSize = (typeof ICON_BUTTON_SIZES)[number];
export declare function IconButton({ size, quiet, type, className, disabled, onClick, title, label, children }: {
    size?: IconButtonSize;
    /** Present but not asking for attention until hovered or focused. */
    quiet?: boolean;
    type?: 'button' | 'submit';
    /** The page's own class, for placing the control in ITS layout (a grid area,
     *  a justify-self). This is the supported way for a surface to say where the
     *  button goes — a descendant selector across the sheet boundary is not. */
    className?: string;
    disabled?: boolean;
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
    title?: string;
    /** The button's ACCESSIBLE NAME. Required — see the component doc. */
    label: string;
    /** The glyph. */
    children: ReactNode;
}): import("react").JSX.Element;
/**
 * An iOS-style toggle switch (pure CSS): a hidden checkbox driving a track +
 * knob. "On" fills the track with the success tone and slides the knob right;
 * keyboard focus draws a soft ring around the track. Every on/off control on
 * the board (cruise, schedule enable) renders through this component.
 */
export declare function Switch({ checked, onChange, label, title, disabled, describedBy, className }: {
    checked: boolean;
    onChange: (next: boolean) => void;
    label: string;
    title?: string;
    disabled?: boolean;
    /** Id of the node that states WHY the switch is unusable — the reason has to
     *  be reachable on touch (there is no hover) and announced to assistive
     *  technology, so it is a real reference rather than a tooltip. */
    describedBy?: string;
    /** The surface's own class, for placing the switch in ITS layout. A surface
     *  that needs the switch in a particular grid cell passes this and styles it
     *  in its own sheet — the supported direction, where `.row > .switch` from
     *  another sheet is a selector that matches nothing. */
    className?: string;
}): import("react").JSX.Element;
/** A titled detail section: one shared title style for every detail module.
 *  `action` is an optional right-aligned affordance on the title row (the
 *  section's own "+ 新建" style button) — the head is a flex row, the title
 *  never shrinks, the action hugs the right edge. An EMPTY title suppresses
 *  the head entirely (an embedding surface supplies its own header — the
 *  automation editor's embedded use, where the wrapping disclosure IS the
 *  section). */
export declare function Section({ title, action, children, className }: {
    title: string;
    /** Optional right-aligned affordance rendered on the title row. */
    action?: ReactNode;
    children: ReactNode;
    className?: string;
}): import("react").JSX.Element;
/** A compact collapsible block: a chevron + title + one-line live summary
 *  on the header row; the body renders only when expanded, and the summary
 *  always reflects the current state (single-source with the body). THE one
 *  disclosure grammar for every foldable module on the board (run config, the
 *  automation editor, the session rail head): collapsed it is quiet, one row,
 *  no buttons, and the chevron turns (collapsed = right, expanded = down) —
 *  never a second hand-rolled fold that forgets the turn. */
export declare function Disclosure({ title, summary, open, onToggle, children, className, headerClassName }: {
    title: string;
    /** One-line live summary shown on the header row (collapsed or not). */
    summary?: string;
    open: boolean;
    onToggle: () => void;
    children?: ReactNode;
    /** The surface's own class on the SECTION — how a surface gives the fold its
     *  place in a rail (a flex role, an inline inset). */
    className?: string;
    /** The surface's own class on the FOLD ROW itself. Two hooks because the fold
     *  is two elements and a surface legitimately places both: the section in its
     *  column, the row inside the section. Reaching either one with a descendant
     *  selector from another sheet is the failure this replaces. */
    headerClassName?: string;
}): import("react").JSX.Element;
/**
 * Minimal inline-icon set (SVG glyphs live here once, sized explicitly so no
 * glyph can ever balloon to the SVG default 300x150 box). Every board icon
 * route goes through this component.
 */
export type IconName = 'arrowDown' | 'arrowUp' | 'chevronDown' | 'close' | 'arrowRight' | 'arrowLeft' | 'link' | 'play' | 'pause' | 'bell' | 'calendar' | 'copy' | 'check' | 'checklist' | 'eyeOff' | 'pencil';
/**
 * Every glyph name, DERIVED from the path table.
 *
 * The gallery renders the whole icon set by iterating this, so a glyph added to
 * the table appears there with no second edit — and a name that somehow has no
 * path cannot appear at all, because the list IS the table's keys.
 */
export declare const ICON_NAMES: readonly IconName[];
/**
 * THE plus sign, drawn once.
 *
 * WHY IT IS NOT THE CHARACTER `+`. A full-width or even a half-width plus
 * carries side bearing the glyph itself does not fill, so in a perfectly centred
 * pill the two strokes sit visibly off the optical centre — 「上下居中了，左右偏
 * 右一点」 is a property of the CHARACTER, not of the layout. Drawing the two
 * strokes on a symmetric viewBox removes the question.
 *
 * WHY IT IS A COMPONENT. The board's primary button spelled it as the literal
 * `+ ` inside a template string while the list's drew an SVG — two primary
 * buttons for the same action, with two different plus signs, is the exact
 * 「这个跟那个不是同一套东西」 the reader reported. One glyph, both pages.
 *
 * `size` defaults to 11 and is an ODD number on purpose: the strokes are centred
 * on `5.5` in an 11-unit box, so at every odd size they land on a half-pixel
 * boundary rather than one side of a pixel.
 */
export declare function PlusIcon({ size, className }: {
    size?: number;
    className?: string;
}): import("react").JSX.Element;
export declare function Icon({ name, className }: {
    name: IconName;
    className?: string;
}): import("react").JSX.Element;
/**
 * THE one color-picker row of the whole board: preset palette dots + the
 * native custom-color dot + the trailing 「移除颜色」 dot. Effect colors are
 * DATA (applied inline from user choices), so the same row is safe wherever
 * a data color is chosen — the card hover bar and the board's organize bar
 * share exactly this grammar. Every entry is round and same-sized; the
 * selected ring appears only when `value` truly equals the entry — never a
 * guessed default, never a mixed shape.
 */
export declare function ColorSwatches({ value, onChange, none, custom }: {
    value: string | undefined;
    onChange: (color: string | undefined) => void;
    /** Show the trailing 「移除颜色」 dot. */
    none?: boolean;
    /** Show the native custom-color dot (trailing, before 「移除颜色」). */
    custom?: boolean;
}): import("react").JSX.Element;
/**
 * The ONE segmented-control grammar (radiogroup of labeled chips): driving
 * mode (按时间表/完成后接续), rule trigger (按时间表/任务完成后) and the
 * send mode all read/speak alike — one component, one style, zero drift.
 */
export declare function Segmented({ options, value, onChange, ariaLabel, disabled }: {
    options: readonly {
        value: string;
        label: string;
        title?: string;
    }[];
    value: string;
    onChange: (next: string) => void;
    ariaLabel: string;
    /** Stand down the whole group — the shape stays, nothing answers a press.
     *  A group that vanished instead would make the row jump under the reader. */
    disabled?: boolean;
}): import("react").JSX.Element;
/**
 * The composer's send-mode switch: 排队 (queue — the dispatcher injects the
 * message, default) vs 插话 (steer — deliver straight to the session now,
 * bypassing queue/budget/cruise). One switch at the send row, shared by the
 * review page and the session panel so both speak one grammar.
 */
export declare function SendModeToggle({ steer, onChange }: {
    steer: boolean;
    onChange: (steer: boolean) => void;
}): import("react").JSX.Element;
/**
 * The one search / filter field.
 *
 * WHY IT IS A COMPONENT AND NOT A CLASS. The board's toolbar and the list's
 * toolbar each had their own input rule — one filled with the shell's input
 * face, one with a surface token, both with the shell's 4% hairline — and the
 * two sat one above the other in the same workbench reading as two different
 * products: 「里面的按钮又变窄了、又看不清了」. A field's look is not a page
 * decision. It is the same question in both pages ("let me narrow this"),
 * so it gets one answer, and a page may only place it (width, flex, margins)
 * through its own `className`.
 *
 * WHY IT TAKES NATIVE PROPS. The list's field opens the command palette on
 * click and carries `aria-haspopup`; the board's field feeds a `<datalist>`.
 * Those are behaviours of the CALLER, not variations of the control, so the
 * component stays a thin, fully-props-compatible input instead of growing a
 * zoo of booleans. `type` is fixed to `search` because a field of this family
 * is always a search box.
 */
export declare function SearchField({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'className'> & {
    className?: string;
}): import("react").JSX.Element;
export {};
