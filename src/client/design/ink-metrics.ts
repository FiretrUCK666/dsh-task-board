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
 * 每一个胶囊读它，写成一对对称的内衬（`base.module.css` 那条，以及每条规则自己那一行）。
 *
 * **写在哪个元素上，决定它有没有用。** 令牌声明在 `:root` 上，所以测量也必须写到
 * `documentElement`——写到别处会被「元素自己的声明压过继承值」静默丢掉。
 *
 * ── 发布什么：**符号两边都要，单位是比例而不是像素** ───────────────────────────
 *
 *  1. **两个方向都发布。** CSS 那一侧本来就是两侧都写的
 *     （`max(0px, calc(-1 * …)) max(0px, …)`）：值为正时下内衬把字抬起来，为负时
 *     上内衬把它压下去，另一边由 `max(0px, …)` 恒为 0。所以「只发正值」不是安全边界，
 *     是**一半的设备一次都不校正**——墨天生偏上的那款字体，读者看到的就是「整体偏上
 *     一点点」，而且无论怎么调都调不出来。
 *
 *  2. **发 `em`，不发 `px`。** 偏移与字号成正比，所以校正也必须是比例。发一个参考字号
 *     下的绝对像素，到了 11px 的标签上就过校正、到了 16px 的移动端输入框上就欠校正
 *     ——一个数只能对一档字号。`em` 在 `padding-block` 里按**元素自己的字号**解析，
 *     于是同一个令牌在每一档上都对，不需要第二遍。
 *
 *   推导：量到的是参考字号下的偏移 `offset`；某元素字号为 `S` 时偏移是
 *   `offset × S / REF`；内衬只把内容盒挤向一侧、盒心移动量是内衬的一半，所以内衬
 *   `= 2 × offset × S / REF`；换成 em 就除掉 `S`，得到 `2 × offset / REF`——**与 S 无关**，
 *   这正是能一个令牌通吃全部字号的原因。
 *
 * ── 一个安全边界 ────────────────────────────────────────────────────────────
 *
 *   - **死区**：偏移小于 `DEAD_ZONE`（0.25px）时**什么都不写**。已经居中的设备不该
 *     被一个四舍五入的噪声推动；`0` 是「这台设备本来就行」的合法答案。
 */

/** 量的时候用的字号：够大，读到的比例稳定；具体值不影响结论（都是比例）。 */
const REFERENCE_SIZE = 14

/** 小于这个偏移视为已经居中——不值得为一个四舍五入的噪声移动整页的字。 */
const DEAD_ZONE = 0.25

/** The custom property the capsule family reads. One name, one place. */
export const INK_PROPERTY = '--dsh-tb-optical-drop'

/** 量到的那四个数，写进日志便于对账。 */
export interface InkMetrics {
  /** 墨心相对盒心的偏移（px，正 = 墨偏下）。 */
  readonly offset: number
  readonly fontAscent: number
  readonly fontDescent: number
  readonly inkAscent: number
  readonly inkDescent: number
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
export function measureInkMetrics(family?: string, weight = '500'): InkMetrics | undefined {
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas').getContext('2d')
  if (canvas === null) return undefined

  /* 量一小段中文而不是单个字：`actualBoundingBox` 是一整段文字的墨范围，一段比一个
     字更能代表「一行字」的墨高（单字的墨可能缺笔）。 */
  const sample = '任务清单'
  const resolvedFamily = family ?? (typeof getComputedStyle === 'function'
    ? getComputedStyle(document.body).fontFamily
    : 'inherit')
  canvas.font = `${weight} ${REFERENCE_SIZE}px ${resolvedFamily}`
  const metrics = canvas.measureText(sample)

  const fontAscent = metrics.fontBoundingBoxAscent
  const fontDescent = metrics.fontBoundingBoxDescent
  const inkAscent = metrics.actualBoundingBoxAscent
  const inkDescent = metrics.actualBoundingBoxDescent
  if (![fontAscent, fontDescent, inkAscent, inkDescent].every(Number.isFinite)) return undefined

  /* 公式与系数：`(fontAsc − fontDesc)/2` 是行盒中线相对基线的高度，
     `(inkAsc − inkDesc)/2` 是墨的中线相对基线的高度，两者相减就是墨心离盒心的距离。
     正的 = 墨偏下。 */
  const offset = ((fontAscent - fontDescent) - (inkAscent - inkDescent)) / 2
  return { offset, fontAscent, fontDescent, inkAscent, inkDescent }
}

/**
 * Publish the measurement onto the element that declares the token (`:root`).
 *
 * Only writes when the value actually changed: a write per pass would invalidate
 * style for the whole page for nothing, and `document.fonts.ready` resolves after
 * every page load.
 *
 * @returns the metrics it read, or `undefined` when it could not measure.
 */
export function publishInkMetrics(): InkMetrics | undefined {
  const metrics = measureInkMetrics()
  if (metrics === undefined) return undefined

  /* 死区：|offset| 小到读不出来时不动。
     **方向不设限**：符号决定 CSS 用哪一侧的内衬，两个方向都是有效值。
     **乘 2**：内衬只挤内容盒，盒心移动量是内衬的一半。

     **单位是 px，不是 em。** 量过的数（`probe-decl-geometry.js`）：本项目所有胶囊
     ——28px 的按钮、26px 的页签、20px 的小件、20px 的芯片——需要的下内衬**都是
     1.00px**，与字号、盒高、行高无关。原因是墨心偏移只取决于「字体的上下沿不对称」，
     而那是字体自己的常数：换字号时行盒与墨一起缩放，但**盒子的余量**（盒高减行盒）
     按另外一档走，两者恰好相抵。
     em 会把校正按字号缩放（12px 上 0.86px、16px 上 1.14px），而实测需要的是同一个
     1.00px——所以 em 在这里既过校正小的、又欠校正大的。 */
  const wanted = Math.abs(metrics.offset) >= DEAD_ZONE ? Math.round(metrics.offset * 2 * 100) / 100 : 0
  const next = wanted === 0 ? '' : `${wanted}px`

  const seat: HTMLElement | null = document.documentElement
  const current = seat.style.getPropertyValue(INK_PROPERTY)
  if (current === next) return metrics
  if (next === '') seat.style.removeProperty(INK_PROPERTY)
  else seat.style.setProperty(INK_PROPERTY, next)
  return metrics
}

/**
 * Measure now, then again once the fonts are actually loaded.
 *
 * The second pass is not belt-and-braces: a page whose Chinese font arrives after
 * first paint measures the FALLBACK font, and the fallback's metrics are exactly
 * what this correction exists to compensate for. Without the second pass the first
 * paint would publish a number belonging to a font nobody is looking at.
 */
export function installInkMetrics(): void {
  publishInkMetrics()
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
  if (fonts === undefined) return
  void fonts.ready.then(() => { publishInkMetrics() }).catch(() => {
    /* 字体没加载成功不是让页面失败的理由：第一次测量已经覆盖了正在渲染的那一款。 */
  })
}
