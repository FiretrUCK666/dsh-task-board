/** What a reader's writing box needs from its surface. */
interface ProseFieldProps {
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly placeholder: string;
    readonly ariaLabel: string;
    /** Take the caret when the box appears. */
    readonly takeCaret?: boolean;
}
/**
 * One writing box.
 * @param props - the text, the words it wears, and whether it takes the caret.
 * @returns the box, its whole-bottom-edge grip, and nothing else.
 */
export declare function ProseField(props: ProseFieldProps): import("react").JSX.Element;
export {};
