/**
 * Shared UI primitives for the board: Button, Section, Notice,
 * Icon. One source for button variants, section titles, the waiting notice
 * and the icon set — every surface consumes these instead of
 * hand-rolled markup, so the whole board speaks one design language and
 * follows the native --dsw-* tokens (light/dark + any skin plugin) without
 * any per-surface styling drift.
 */
import { type ReactNode } from 'react';
/** One button variant; shared rhythm everywhere. `dangerGhost` is the
 *  row-level destructive affordance (outline + danger text) — the filled
 *  `danger` stays reserved for the primary destroyer (confirm dialogs,
 *  the detail footer's delete). */
export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'dangerGhost';
/** The board's one button (see module doc). The click handler receives the
 *  native event so callers inside clickable rows can stopPropagation; plain
 *  zero-arg handlers stay assignable (fewer parameters are always valid).
 *  `size="sm"` is the quiet row/header variant (view-session, refresh, row
 *  actions): one compact size for every secondary in-list affordance, so the
 *  board never mixes a full-size button into a row. */
export declare function Button({ variant, size, type, className, disabled, pressed, onClick, title, children }: {
    variant?: ButtonVariant;
    size?: 'sm';
    type?: 'button' | 'submit';
    className?: string;
    disabled?: boolean;
    /** Toggle-state styling (aria-pressed): an active mode reads through a
     *  gentle press, never through the primary/danger fill. */
    pressed?: boolean;
    onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
    title?: string;
    children: ReactNode;
}): import("react").JSX.Element;
/**
 * An iOS-style toggle switch (pure CSS): a hidden checkbox driving a track +
 * knob. "On" fills the track with the success tone and slides the knob right;
 * keyboard focus draws a soft ring around the track. Every on/off control on
 * the board (cruise, schedule enable) renders through this component.
 */
export declare function Switch({ checked, onChange, label, title, disabled, describedBy }: {
    checked: boolean;
    onChange: (next: boolean) => void;
    label: string;
    title?: string;
    disabled?: boolean;
    /** Id of the node that states WHY the switch is unusable — the reason has to
     *  be reachable on touch (there is no hover) and announced to assistive
     *  technology, so it is a real reference rather than a tooltip. */
    describedBy?: string;
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
export declare function Disclosure({ title, summary, open, onToggle, children }: {
    title: string;
    /** One-line live summary shown on the header row (collapsed or not). */
    summary?: string;
    open: boolean;
    onToggle: () => void;
    children?: ReactNode;
}): import("react").JSX.Element;
/** The waiting notice: one neutral framed row + warn chip for every surface. */
export declare function Notice({ chip, children }: {
    chip: ReactNode;
    children: ReactNode;
}): import("react").JSX.Element;
/**
 * Minimal inline-icon set (SVG glyphs live here once, sized explicitly so no
 * glyph can ever balloon to the SVG default 300x150 box). Every board icon
 * route goes through this component.
 */
export type IconName = 'arrowDown' | 'arrowUp' | 'chevronDown' | 'close' | 'arrowRight' | 'arrowLeft' | 'link' | 'play' | 'pause' | 'bell' | 'calendar' | 'copy' | 'check' | 'checklist' | 'eyeOff' | 'pencil';
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
export declare function Segmented({ options, value, onChange, ariaLabel }: {
    options: readonly {
        value: string;
        label: string;
        title?: string;
    }[];
    value: string;
    onChange: (next: string) => void;
    ariaLabel: string;
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
