export interface ItemQueryChipsProps {
    /** The whole query, exactly as it stands. The ONLY state. */
    readonly text: string;
    /** The document's tags, so a tag chip can show the reader's own spelling. */
    readonly tags: readonly (readonly string[])[];
    /** Hand back the new text. Never a parsed object, never a re-serialised one. */
    readonly onSearch: (next: string) => void;
    /** Clear every qualifier and leave the reader's words. */
    readonly onClearQualifiers: () => void;
}
export declare function ItemQueryChips(props: ItemQueryChipsProps): import("react").JSX.Element | null;
