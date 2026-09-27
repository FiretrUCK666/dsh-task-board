/**
 * The narrow face of the official sidebar this rule needs.
 *
 * `mounted` is the seat's liveness. `isExpanded` is NOT a subscription and the
 * package emits no event, so it is a one-time read BY DESIGN — which is why
 * `yieldToSidebar` is called at the moment the reader asks for us, and not
 * watched continuously: the read is only ever worth taking while the answer
 * can still act on it.
 */
export interface SidebarYieldFace {
    readonly mounted: {
        getSnapshot(): string | undefined;
        subscribe(fn: () => void): () => void;
    };
    isExpanded(): boolean;
    toggleExpanded(): void;
}
/**
 * Take the right edge, if the official sidebar is holding it.
 *
 * This is the half of "never coexist" that is actually available. Collapsing
 * it is guaranteed and asserted. Noticing when THEY open is not available at
 * all, so that half is a named gap rather than a rule — the reader resolves it
 * by collapsing us, and the README says so in as many words.
 * @returns true when the official column was collapsed for us.
 */
export declare function yieldToSidebar(): boolean;
/** Publish the sidebar face while this plugin is composed. */
export declare function bindSidebar(face: SidebarYieldFace | undefined): void;
/**
 * The list's glyph, in the SHELL's own pill.
 *
 * A hand-rolled `<button>` is why this used to look out of place and why no
 * third-party skin could reach it. `Pill` is on the platform module list, so it
 * takes the shell's own tokens and a skin follows it for free.
 *
 * The glyph is our own `icon.svg` redrawn inline rather than imported: an SVG
 * import would be a bundler contract this plugin has no precedent for, and
 * three bars in `currentColor` carry the same silhouette while following the
 * pill's colour instead of freezing the brand hex into the UI.
 * @returns the pill.
 */
export declare function ListOpenPill(): import("react").JSX.Element;
