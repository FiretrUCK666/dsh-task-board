export interface ItemKeyHelpProps {
    readonly open: boolean;
    readonly onClose: () => void;
}
/**
 * The key help sheet.
 *
 * The focus lands on the sheet when it opens, because a dialog the reader cannot
 * reach with `Tab` is not one they are inside — and because `Esc` has to work
 * from wherever they land, which is the same thing said about the keyboard.
 * @param props - whether it is open, and how it is dismissed.
 * @returns the overlay, or nothing.
 */
export declare function ItemKeyHelp(props: ItemKeyHelpProps): import("react").JSX.Element | null;
