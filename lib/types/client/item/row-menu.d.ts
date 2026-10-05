export interface RowMenuAction {
    readonly key: string;
    readonly label: string;
    readonly onPick: () => void;
    /**
     * SHOWN BUT NOT TAKEN, and the reason beside it.
     *
     * A menu entry used to be a sentence. It became a button — which is the right
     * control — and that change opened the question of what an unavailable one
     * looks like, and the answer is NOT to leave it out: a list whose length changes
     * with a fact the reader cannot see is a list nobody can learn. So the entry
     * stays, it is `aria-disabled` rather than absent, and the hint names the fact
     * that is missing. **The reader is never left to work out whether the entry
     * is broken or their row is.**
     */
    readonly disabled?: boolean;
    readonly hint?: string;
}
export interface ItemRowMenuProps {
    /** The row's uuid, for the element identity and the capture layer's sibling. */
    readonly rowId: string;
    /** The `⋯` control, measured for its own placement. */
    readonly trigger: HTMLElement | null;
    /** This panel's root, the box the menu may not leave. */
    readonly panel: HTMLElement | null;
    readonly actions: readonly RowMenuAction[];
    readonly onClose: () => void;
}
export declare function ItemRowMenu(props: ItemRowMenuProps): import("react").JSX.Element;
