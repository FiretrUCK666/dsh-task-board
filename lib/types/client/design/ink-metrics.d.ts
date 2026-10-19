/**
 * 字在胶囊里的墨位：**每次按当前字体量，不写死一个数**。
 *
 * ── 为什么这件事必须由运行时回答 ──────────────────────────────────────────────
 *
 * `align-items: center` 居中的是**行盒**，而读者看的是**字的墨**。两者不同心，差值是
 *
 *   墨心偏移 = [(fontAsc − fontDesc) − (inkAsc − inkDesc)] / 2
 *
 * 三条性质，都是量出来的：
 *
 *   1. **式子里没有行高。** 把 `line-height` 设成 1、1em、墨高或任何别的值，基线
 *      与盒心一起移动，偏移不变。所以「调行高」这条路从一开始就不可能成功。
 *   2. **式子里全是字体度量。** 换一款字体，四个数全变，偏移的方向与大小也变——
 *      这就是「同一个界面、一台机器偏下、另一台正好」的全部来源：两台机器上根本
 *      不是同一款字体。
 *   3. **它可以是正的、负的或零。** 等于 0 是那一款字体的巧合，不是常态。
 *
 * 所以任何写死的补偿（`0.5px`、`0.04em`、`1px`）都只能修一台机器、弄坏另一台。
 * 这不是「还没调对」，是**这条路本身不可能对**。
 *
 * ── 怎么做 ──────────────────────────────────────────────────────────────────
 *
 * 挂载时用离屏 canvas 量出当前字体的四个数，算出偏移，写进 `--dsh-tb-optical-drop`。
 * `tokens.module.css` 里那 20 处 `calc(2 * var(--dsh-tb-optical-drop))` 读它。
 *
 * **写在哪个元素上，决定它有没有用。** 令牌声明在 `[data-dsh-taskboard-view]`
 * （面板挂载的元素）上，所以测量也必须写到**那个元素**——写在 `<html>` 上会被
 * 「子元素自己的声明压过继承值」这条规则静默丢掉，校正一次都不会生效。
 *
 * ── 两个安全边界 ────────────────────────────────────────────────────────────
 *
 *   - **死区**：偏移小于 `DEAD_ZONE`（0.25px）时**什么都不写**。已经居中的设备不该
 *     被一个四舍五入的噪声推动。
 *   - **只处理正值**：内衬不能为负，所以墨偏上时不写（写了也是无效值）。那一侧本来
 *     就比偏下少见，而且把它推到 `< 0` 只会让浏览器丢掉整条声明。
 */
/** The custom property the capsule family reads. One name, one place. */
export declare const INK_PROPERTY = "--dsh-tb-optical-drop";
/** 量到的那四个数，写进日志便于对账。 */
export interface InkMetrics {
    /** 墨心相对盒心的偏移（px，正 = 墨偏下）。 */
    readonly offset: number;
    readonly fontAscent: number;
    readonly fontDescent: number;
    readonly inkAscent: number;
    readonly inkDescent: number;
}
/**
 * Measure the ink offset for the font the page is actually using.
 *
 * @param family - the family stack to measure; defaults to the body's own, which is
 *   what the controls inherit. Measuring a made-up stack answers nobody's question.
 * @param weight - the weight the capsule family renders at.
 * @returns the offset and the four readings it came from, or undefined when the
 *   platform cannot measure (no canvas, no document).
 */
export declare function measureInkMetrics(family?: string, weight?: string): InkMetrics | undefined;
/**
 * Publish the measurement onto the element that declares the token.
 *
 * Only writes when the value actually changed: a write per pass would invalidate
 * style for the whole page for nothing, and `document.fonts.ready` resolves after
 * every page load.
 *
 * @returns the metrics it read, or `undefined` when it could not measure.
 */
export declare function publishInkMetrics(): InkMetrics | undefined;
/**
 * Measure now, then again once the fonts are actually loaded.
 *
 * The second pass is not belt-and-braces: a page whose Chinese font arrives after
 * first paint measures the FALLBACK font, and the fallback's metrics are exactly
 * what this correction exists to compensate for. Without the second pass the first
 * paint would publish a number belonging to a font nobody is looking at.
 */
export declare function installInkMetrics(): void;
