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
 * The interface type ladder, as DESIGN.md states it.
 *
 * Literal sizes rather than tokens: the ladder is a RULE about which sizes the
 * interface may use, and the sheets apply it by writing those sizes. Declaring
 * tokens nothing consumes would be a third vocabulary for the same fact — see
 * `tests/gallery.spec.ts`, which checks each row against the sheets' own
 * declarations so this table cannot describe a ladder nobody uses.
 */
export declare const GALLERY_TYPE_LADDER: readonly {
    readonly label: string;
    readonly size: number;
    readonly weight: number;
    readonly where: string;
}[];
/**
 * Render the design-system gallery.
 * @returns the catalogue page.
 */
export declare function DesignGallery(): import("react").JSX.Element;
