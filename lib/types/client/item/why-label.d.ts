/**
 * What to print, and what to keep for a developer.
 *
 * @param why - the code the host or the transport sent.
 * @returns the reader-facing sentence, and the raw code for the tooltip.
 */
export declare function whyLabelOf(why: string): {
    readonly words: string;
    readonly raw: string;
};
