export interface RowMenuAction {
    readonly key: string;
    readonly label: string;
    readonly onPick: () => void;
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
