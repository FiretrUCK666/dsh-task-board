/**
 * The breakpoint table: ONE set of numbers, read by both sides.
 *
 * WHY THIS FILE EXISTS. Every panel sizes itself from its OWN box, never from
 * the viewport — a collapsed sidebar, a split screen and a phone all change the
 * panel's width without changing the window's, so `@media (max-width)` answers
 * a question nobody asked. That leaves two mechanisms that have to agree:
 * `useSurfaceNarrow` measures the box in JS, and `@container` measures it in
 * CSS. They cannot share a value (CSS cannot read a TS module), so the numbers
 * lived in six places and only discipline kept them in step. The measured cost
 * of that is written down: the item panel's JS band reads `width <= 1080` as
 * narrow while its CSS asks `min-width: 1081px` — the pair is correct today,
 * and the one pixel between them is a seam that nothing was checking.
 *
 * WHAT MAKES IT A CONTRACT AND NOT A COMMENT. `tests/bands.spec.ts` reads every
 * `@container` query in every client stylesheet and holds it to this table: a
 * step that moves here and not in the sheet (or the other way round) is red.
 * The numbers below are therefore the definition of record — a sheet that wants
 * a new step adds it here first.
 *
 * THE INCLUSIVE/EXCLUSIVE CONVENTION, which is where a seam comes from. JS
 * `narrow` means `width <= narrowMax`; the matching CSS query is
 * `max-width: <narrowMax>px`, and the "wide" side is `min-width:
 * <narrowMax + 1>px`. Written as one number per boundary, so there is no second
 * place for the plus-one to be forgotten.
 */
/** One boundary: a container, what it separates, and the width it turns at. */
export interface Band {
    /** The `container-name` the CSS queries measure. */
    readonly container: string;
    /** The widest box still on the narrow side. The CSS `min-width` side is this + 1. */
    readonly narrowMax: number;
    /** What changes here — the reason the step exists, in one line. */
    readonly what: string;
}
/**
 * Every boundary in the client half.
 *
 * Grouped by container because that is what the queries measure; the ORDER
 * inside a group is widest-first, which is how a reader looks for the band they
 * are standing in.
 */
export declare const BANDS: {
    /** The board's own box (`TaskBoard.tsx` declares `container-name: dsh-tb`). */
    readonly board: readonly [{
        readonly container: "dsh-tb";
        readonly narrowMax: 680;
        readonly what: "五列变横滑轨道、板头换两行、出现拇指栏";
    }, {
        readonly container: "dsh-tb";
        readonly narrowMax: 648;
        readonly what: "复核页的内衬减半（板 648 正好对应会话面板的 600）";
    }];
    /** The session panel inside the board (`container-name: dsh-tb-panel`). */
    readonly sessionPanel: readonly [{
        readonly container: "dsh-tb-panel";
        readonly narrowMax: 600;
        readonly what: "会话轨折起来、正文占满";
    }];
    /** The task list's box (`ItemListPanel` declares `container-name: dsh-tb-item`). */
    readonly item: readonly [{
        readonly container: "dsh-tb-item";
        readonly narrowMax: 1080;
        readonly what: "左栏的日历默认折起来——JS 的「窄」就是这一档";
    }, {
        readonly container: "dsh-tb-item";
        readonly narrowMax: 880;
        readonly what: "工作台并成一列、顶栏折行、字段落成两行";
    }, {
        readonly container: "dsh-tb-item";
        readonly narrowMax: 719;
        readonly what: "新建那张纸的两栏并成一栏；内容线那一档（行内衬 12 / 宽 16）";
    }, {
        readonly container: "dsh-tb-item-list";
        readonly narrowMax: 559;
        readonly what: "行形状：四列变两行（标签落到句子下面那一行）";
    }];
    /**
     * The design-system gallery's measured box (`DesignGallery` declares
     * `container-name: dsh-tb-gallery`).
     *
     * The gallery carries a band of its own because it is where the mechanism is
     * DEMONSTRATED: the page's head has a switch that sets this box's inline
     * size, so the query below fires on a real resize rather than being described
     * in prose. It is also the page that would notice if the mechanism broke.
     */
    readonly gallery: readonly [{
        readonly container: "dsh-tb-gallery";
        readonly narrowMax: 720;
        readonly what: "标本网格并成一列、内衬收一档";
    }];
};
/**
 * The boundary the JS side asks about, by name.
 *
 * A panel calls `useSurfaceNarrow(SEAT, bandNarrowMax('item', 1080))` rather
 * than spelling the number, so the JS side cannot drift from the CSS side
 * without the spec below going red.
 * @param group - which container's list to search.
 * @param narrowMax - the boundary's width, as declared above.
 * @returns the width, or throws when no such boundary exists.
 */
export declare function bandNarrowMax(group: keyof typeof BANDS, narrowMax: number): number;
/**
 * Every boundary, flattened — the shape a gate wants.
 * @returns one entry per declared boundary, in declaration order.
 */
export declare function allBands(): readonly Band[];
