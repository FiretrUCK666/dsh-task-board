/**
 * How a token group is SHOWN.
 *
 * A colour is a dot; a radius is a corner you can see the roundness of; a
 * shadow is a lifted box; a distance is a bar of that length. Anything else is
 * text. Showing every token as a colour dot — which is what the first version
 * of this page did — puts a meaningless white square beside `--dsh-tb-radius-md`
 * and beside `--dsh-tb-space-4`, and a catalogue whose specimens do not match
 * their subjects teaches the reader to stop looking at the specimens.
 */
export type TokenKind = 'color' | 'radius' | 'shadow' | 'space' | 'plain' | 'surface' | 'rim';
/**
 * The design variables this page displays, GROUPED BY WHAT THEY ARE FOR.
 *
 * A curated catalogue rather than a dump: a reader wants 「表面有哪几级」, not
 * eighty names in declaration order. It is also the one list here that cannot
 * be derived — CSS cannot enumerate its own custom properties — so
 * `tests/gallery.spec.ts` reads every name below out of the design sheets and
 * fails when one is renamed or removed.
 */
export declare const GALLERY_TOKEN_GROUPS: readonly {
    readonly title: string;
    readonly why: string;
    readonly kind: TokenKind;
    readonly names: readonly string[];
}[];
/**
 * The interface type ladder, DERIVED from the tokens.
 *
 * The sizes are token names rather than numbers, and the page reads each one off
 * a live element (`getComputedStyle`), so this table cannot drift from the
 * stylesheets: a re-mapped ladder moves the page with it, and a renamed token is
 * a compile error rather than a stale row. That is the same arrangement the
 * enumerations above use — the definition is the array, not a copy of it.
 *
 * **The ladder is six steps.** `title` / `emphasis` / `body` / `meta` / `eyebrow`
 * are the reading ladder the sheets apply to text; `kpi` is the one display step
 * (a dashboard's big number) and is listed last because it is not part of the
 * prose hierarchy. Each row names where the step appears, which is what the
 * names alone cannot say.
 *
 * A size that is NOT on this ladder is not automatically wrong — the content pass
 * (Markdown prose) and the platform floor (16px on coarse pointers, which stops
 * mobile browsers zooming a focused field) are both deliberately off-scale. The
 * scale gate names those two exemptions by sheet location rather than by size, so
 * "off-scale" stays a decision instead of becoming a hole.
 */
export declare const GALLERY_TYPE_LADDER: readonly {
    readonly label: string;
    readonly token: string;
    readonly weight: number;
    readonly where: string;
}[];
/**
 * Render the design-system gallery.
 * @returns the catalogue page.
 */
export declare function DesignGallery(): import("react").JSX.Element;
