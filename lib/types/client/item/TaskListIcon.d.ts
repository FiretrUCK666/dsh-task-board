/** Props the shell binds for a panel-list entry. */
export interface TaskListIconProps {
    /** Requested square edge in pixels (the shell sizes wide vs rail). */
    size: number;
    /** Whether this panel is selected in the main column. */
    active: boolean;
    /**
     * Leave the list (select the Conversation). Injected by the registrant, which
     * owns the single way out — the same `selectPanel(null)` funnel the board's
     * entry uses, so leaving can never mean two different things on two panels.
     * Absent = pure glyph: no listener, no toggle, the row still opens.
     */
    onExit?: () => void;
}
/**
 * Render the list glyph, wired for row-toggle exit while the list is open.
 * @param props - the shell's icon share plus the injected exit.
 * @returns the icon element.
 */
export declare function TaskListIcon({ size, active, onExit }: TaskListIconProps): import("react").JSX.Element;
