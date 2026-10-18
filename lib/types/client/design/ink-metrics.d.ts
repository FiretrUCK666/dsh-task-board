/**
 * 一行字在胶囊里的墨位：**运行时量字体，算出一个校正量**。
 *
 * ── 问题为什么不能靠一个固定值解决 ──────────────────────────────────────────
 *
 * `align-items: center` 居中的是**行盒**。行盒里基线的位置由字体的
 * `fontBoundingBox` 决定，而字的墨（读者真正看见的那一块）在基线两侧分布不均：
 *
 *   墨心偏移 = [(fontAsc − fontDesc) − (inkAsc − inkDesc)] / 2
 *
 * 三条事实，都是量出来的：
 *
 *   1. **式子里没有行高。** 把 `line-height` 设成 1、1em、墨高或任何别的值，基线
 *      与盒心一起移动，偏移不变。所以「调行高」这条路从一开始就不可能成功——它被
 *      试过两轮，都不成功。
 *   2. **式子里全是字体度量。** 换一款字体，四个数全变，偏移的方向和大小也变。
 *      这正是「电脑端偏下、手机端正好」的来源：两台机器上根本不是同一款字体。
 *   3. **它可以是正的也可以是负的。** 等于 0 是巧合，不是常态。
 *
 * 所以任何写死的补偿（`0.04em`、`0.5px`、`1px`）都只能修一台机器、弄坏另一台。
 * 这也解释了为什么这个缺陷被反复「修好」又反复出现。
 *
 * ── 怎么办：量一次，写成一个令牌 ─────────────────────────────────────────────
 *
 * 这一模块在挂载时用一个离屏 canvas 量出当前字体的四个数，算出偏移，把它写成
 * 根上的 `--dsh-tb-line-nudge`。那一族胶囊读它：
 *
 *   padding-block-end: calc(2 * var(--dsh-tb-line-nudge));
 *
 * `2 × d` 的下内衬让内容盒上移 `d`——居中机制不动，只把内容盒挪到墨真正居中的位置。
 * **它仍然是一个数**，但这个数每次由真实字体算出来，不是猜的，所以换字体、换设备、
 * 换字号都跟着走。
 *
 * ── 什么时候重新量 ──────────────────────────────────────────────────────────
 *
 * 字体是异步的：首帧可能还没加载完真正的中文字体。所以挂载时量一次，并在
 * `document.fonts.ready` 之后**再量一次**；两者都只在数值真的变化时才写令牌，
 * 避免触发无意义的重排。
 */
/** 结果：像素，正 = 墨偏下，需要把内容盒上移。 */
export interface InkMetrics {
    /** 算出来的偏移（px，正 = 墨偏下）。 */
    readonly nudge: number;
    /** 量到的那四个数，写进日志便于对账。 */
    readonly fontAscent: number;
    readonly fontDescent: number;
    readonly inkAscent: number;
    readonly inkDescent: number;
}
/**
 * Measure one line box's ink offset for the font the page is actually using.
 *
 * @param family - the family stack to measure; defaults to the body's own, which
 *   is what the controls inherit. Measuring a made-up stack would answer a
 *   question nobody asked.
 * @param weight - the weight the capsule family renders at.
 * @returns the offset, and the four readings it came from.
 */
export declare function measureInkMetrics(family?: string, weight?: string): InkMetrics | undefined;
/** The custom property the capsule family reads. One name, one place. */
export declare const INK_NUDGE_PROPERTY = "--dsh-tb-line-nudge";
/**
 * Publish the measurement to the document root so every capsule can read it.
 *
 * Only writes when the value actually changed: a write per probe would invalidate
 * style for the whole page for nothing, and `document.fonts.ready` resolves after
 * every page load.
 *
 * @returns the metrics it applied, or `undefined` when it could not measure.
 */
export declare function publishInkMetrics(): InkMetrics | undefined;
/**
 * Measure now, then again once the fonts are actually loaded.
 *
 * The second pass is not belt-and-braces: a page whose Chinese font arrives after
 * first paint measures the FALLBACK font, and the fallback's metrics are exactly
 * what this correction exists to compensate for. Without the second pass the
 * first paint would publish a number belonging to a font nobody is looking at.
 */
export declare function installInkMetrics(): void;
