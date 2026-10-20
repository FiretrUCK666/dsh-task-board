/**
 * The workbench's warning strip: one line BELOW the bar, only while there is
 * something to say.
 *
 * WHY IT IS NOT PART OF THE READOUT. A live count and a one-off warning must not
 * read as one sentence: 「正在跑 1 · 服务端仍在跑旧版本（页面 1.3.1 / 服务端
 * 1.3.0）· 刷新无用，需重启 dsh web」. They are not the same kind of thing:
 *
 *   - `正在跑 1` is a READOUT: always relevant, always changing, needs nothing;
 *   - the version mismatch is a WARNING: true only right after a version bump,
 *     and it names exactly one action (restart `dsh web`).
 *
 * A reader scanning the bar for 「还有多少活」 should never have to read a
 * restart instruction to find it. So warnings get their own row, with their own
 * ground, and the row disappears whole when there is nothing wrong (no empty
 * slot to keep the layout stable — the bar above it does not move either way,
 * because this strip is a sibling BELOW it, not a member of it).
 *
 * WHY IT IS A BUTTON WHEN IT CAN BE. Touch has no hover: a warning that only
 * explains itself in a `title` has no explanation on a phone (hard rule 11③).
 * When there IS something to do, the whole strip is the control; when the
 * warning is informational only, it renders as a `role="status"` line and does
 * not pretend to be pressable.
 */
import type { ReactNode } from 'react';
/** One warning the strip can carry. */
export interface WorkbenchNoticeItem {
    /** Stable key (a warning may be replaced in place). */
    readonly id: string;
    /** The sentence. Already localised; may name what the reader must do. */
    readonly text: string;
    /**
     * What pressing it does. Absent means the warning is informational — the
     * strip then renders as a live region instead of a button, because a control
     * that does nothing is worse than a sentence that does.
     */
    readonly onPress?: () => void;
    /** The tooltip, when the sentence is shortened for the row. */
    readonly title?: string;
}
export interface WorkbenchNoticeProps {
    /** What to say. An empty list renders nothing at all. */
    readonly items: readonly WorkbenchNoticeItem[];
    /** Trailing element (a dismiss button, when the strip is dismissible). */
    readonly children?: ReactNode;
}
/**
 * Render the warning strip.
 * @param props - the warnings, in reading order; empty renders nothing.
 * @returns the strip, or null when there is nothing wrong.
 */
export declare function WorkbenchNotice({ items, children }: WorkbenchNoticeProps): import("react").JSX.Element | null;
