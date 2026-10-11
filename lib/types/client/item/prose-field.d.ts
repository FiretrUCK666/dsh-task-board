/** What a reader's writing box needs from its surface. */
export interface ProseFieldProps {
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly placeholder: string;
    readonly ariaLabel: string;
    /**
     * The height this reader last dragged a box to, in px.
     *
     * `undefined` while nobody has ever dragged one, and that is the honest state
     * rather than a default: the stylesheet's own starting height is what a box
     * nobody sized is drawn at, and writing that number into storage would freeze
     * a layout decision into a reader's preference file.
     */
    readonly height?: number;
    /**
     * ONE SETTLED SIZE, ONCE PER GESTURE.
     *
     * A drag reports on release, a keystroke on the press. Reporting every
     * `pointermove` would write a preference sixty times a second for a number
     * nobody reads until the gesture is over.
     */
    readonly onHeight?: (px: number) => void;
    /** Take the caret when the box appears. */
    readonly takeCaret?: boolean;
}
/**
 * One writing box.
 * @param props - the text, the words it wears, and where its size goes.
 * @returns the box, its whole-bottom-edge grip, and nothing else.
 */
export declare function ProseField(props: ProseFieldProps): import("react").JSX.Element;
