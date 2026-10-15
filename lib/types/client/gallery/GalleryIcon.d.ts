/** Props the shell binds for a panel-list entry. */
export interface GalleryIconProps {
    /** Requested square edge in pixels (the shell sizes wide vs rail). */
    size: number;
    /** Whether this panel is selected in the main column. */
    active: boolean;
    /** Leave the gallery; absent = pure glyph, the row still opens it. */
    onExit?: () => void;
}
/**
 * Render the gallery glyph, wired for row-toggle exit while it is open.
 * @param props - the shell's icon share plus the injected exit.
 * @returns the icon element.
 */
export declare function GalleryIcon({ size, active, onExit }: GalleryIconProps): import("react").JSX.Element;
