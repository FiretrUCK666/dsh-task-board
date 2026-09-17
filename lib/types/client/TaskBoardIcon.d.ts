/**
 * The board's entry in the shell's global-panel list.
 *
 * Registered into `sidebar.panellist` — the official list slot for global
 * centre-stage panels, the same one the shipped Plugins panel uses. The shell
 * owns the whole row (button, geometry, hover/active fill, the selected
 * highlight via `aria-current="page"`, the label in the wide column and the
 * icon-only form in the collapsed rail), and it calls
 * `ctx.layout.selectPanel(<id>)` itself; this component contributes ONLY the
 * glyph. That split is why nothing here can drift from the native rows, and why
 * there is no second "is the board open" subscription to keep in step.
 *
 * The `id` this entry registers under MUST equal the `main` slot key the board
 * panel registers — the shell resolves a panel row to its stage by that id.
 */
/** Props the shell binds for a panel-list entry. */
export interface TaskBoardIconProps {
    /** Requested square edge in pixels (the shell sizes wide vs rail). */
    size: number;
    /** Whether this panel is selected in the main column (unused: the shell draws
     *  the highlight; accepted so the contract is explicit). */
    active: boolean;
}
/**
 * Render the board glyph.
 * @param props - the shell's icon share.
 * @returns the icon element.
 */
export declare function TaskBoardIcon({ size }: TaskBoardIconProps): import("react").JSX.Element;
