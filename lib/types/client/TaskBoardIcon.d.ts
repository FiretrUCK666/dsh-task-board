/**
 * The board's entry in the shell's global-panel list.
 *
 * Registered into `sidebar.panellist` — the official list slot for global
 * centre-stage panels, the same one the shipped Plugins panel uses. The shell
 * owns the whole row (button, geometry, hover/active fill, the selected
 * highlight via `aria-current="page"`, the label in the wide column and the
 * icon-only form in the collapsed rail), and it calls
 * `ctx.layout.selectPanel(<id>)` itself; this component contributes the
 * glyph plus ONE behavior the shell does not have: its `selectPanel` only
 * ever OPENS a panel, so clicking the board's own row while the board is
 * open must turn into `selectPanel(null)` — click the entry, click it again,
 * leave. That toggle rides a listener on the shell-owned button that
 * CONTAINS this glyph (the slot contract guarantees that containment), reads
 * no shell class or attribute, and quietly goes absent if the shell ever
 * stops rendering it that way — the row still opens the board through the
 * shell's own handler either way.
 *
 * The `id` this entry registers under MUST equal the `main` slot key the board
 * panel registers — the shell resolves a panel row to its stage by that id.
 */
/** Props the shell binds for a panel-list entry. */
export interface TaskBoardIconProps {
    /** Requested square edge in pixels (the shell sizes wide vs rail). */
    size: number;
    /** Whether this panel is selected in the main column (the shell draws the
     *  highlight; this component reads it only to decide whether a row click
     *  means exit — never to re-derive selection itself). */
    active: boolean;
    /**
     * Leave the board (select the Conversation). Injected by the registrant,
     * which owns the single way out — the same `selectPanel(null)` funnel the
     * 返回对话 control uses, so exit can never mean two different things.
     * Absent = pure glyph: no listener, no toggle, the row still opens.
     */
    onExit?: () => void;
}
/**
 * Render the board glyph, wired for row-toggle exit while the board is open.
 * @param props - the shell's icon share plus the injected exit.
 * @returns the icon element.
 */
export declare function TaskBoardIcon({ size, active, onExit }: TaskBoardIconProps): import("react").JSX.Element;
