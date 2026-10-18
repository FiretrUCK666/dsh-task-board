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

/** 用来量的参考字号：14px 足够大，读到的比例稳定；具体值不影响结果（比例）。 */
const REFERENCE_SIZE = 14

/** 一档字重与字族，与「一行字」那一族控件实际用的那档一致。 */
const REFERENCE_FAMILY = ['inherit']

/** 结果：像素，正 = 墨偏下，需要把内容盒上移。 */
export interface InkMetrics {
  /** 算出来的偏移（px，正 = 墨偏下）。 */
  readonly nudge: number
  /** 量到的那四个数，写进日志便于对账。 */
  readonly fontAscent: number
  readonly fontDescent: number
  readonly inkAscent: number
  readonly inkDescent: number
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
export function measureInkMetrics(family?: string, weight = '500'): InkMetrics | undefined {
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas').getContext('2d')
  if (canvas === null) return undefined

  /* 量一小段中文而不是单个字：`actualBoundingBox` 是一整段文字的墨范围，一段字比
     一个字更能代表「一行字」的墨高（单字的墨可能缺笔）。 */
  const sample = '任务清单'
  const resolvedFamily = family ?? (typeof getComputedStyle === 'function'
    ? getComputedStyle(document.body).fontFamily
    : REFERENCE_FAMILY.join(','))
  canvas.font = `${weight} ${REFERENCE_SIZE}px ${resolvedFamily}`
  const metrics = canvas.measureText(sample)

  const fontAscent = metrics.fontBoundingBoxAscent
  const fontDescent = metrics.fontBoundingBoxDescent
  const inkAscent = metrics.actualBoundingBoxAscent
  const inkDescent = metrics.actualBoundingBoxDescent
  if (![fontAscent, fontDescent, inkAscent, inkDescent].every(Number.isFinite)) return undefined

  /* ── 符号与系数，两件都必须对 ───────────────────────────────────────────────
   *
   * `raw` 是「墨心相对盒心」的偏移：正 = 墨偏下，负 = 墨偏上。
   *
   * 一个块向内衬**只能把内容盒往回推**：加 `padding-block-end` 让内容盒上移，
   * 加 `padding-block-start` 让它下移。所以：
   *
   *   raw > 0（墨偏下）→ 用下内衬把它抬起来 → nudge 为正
   *   raw < 0（墨偏上）→ 用上内衬把它压下去 → nudge 为负
   *
   * 而内衬对墨心的位移是**一半**（内衬只把内容盒挤薄一侧，中心移动量 = 内衬 / 2），
   * 所以系数是 2：`nudge = 2 × raw`。量到过：raw = −0.5 时 `padding-top: 1px`
   * 正好把墨心压到 0（0 / 0.25 / 0.5 / 1 → −0.5 / −0.375 / −0.25 / 0）。
   *
   * 早先那版只写 `raw`（漏了系数 2）、并且只会用下内衬（漏了负值这一半），
   * 于是「电脑端偏下」这一侧永远修不好——而它正是读者报的那一侧。 */
  const nudge = 2 * (((fontAscent - fontDescent) - (inkAscent - inkDescent)) / 2)
  return { nudge, fontAscent, fontDescent, inkAscent, inkDescent }
}

/** The custom property the capsule family reads. One name, one place. */
export const INK_NUDGE_PROPERTY = '--dsh-tb-line-nudge'

/**
 * Publish the measurement to the document root so every capsule can read it.
 *
 * Only writes when the value actually changed: a write per probe would invalidate
 * style for the whole page for nothing, and `document.fonts.ready` resolves after
 * every page load.
 *
 * @returns the metrics it applied, or `undefined` when it could not measure.
 */
export function publishInkMetrics(): InkMetrics | undefined {
  const metrics = measureInkMetrics()
  if (metrics === undefined) return undefined
  /* ── 发布的是 **`em`**，不是 `px` ────────────────────────────────────────
   *
   * 一枚令牌要喂给 12px、13px、15px 三种字号。字体上下沿的不对称是**比例**（随字号
   * 缩放），不是固定长度——所以用 `px` 发布，只有参考字号那一档是对的：
   *
   *   量出来的偏移是 `raw`（在 14px 上量的）。
   *   12px 的那一档需要 `raw × 12/14`，15px 的需要 `raw × 15/14`。
   *   发布成 `1px` 就是「三档都当 14px 用」，其余两档各差一截。
   *
   * 发布成 `em` 之后，`calc()` 里的 `1em` 按**每一段自己的字号**解析，三档各自成立，
   * 而且加一个新的字号不用动这里一行。这就是「一处修好全部」的实现方式。
   *
   * 分母是参考字号：`raw / REFERENCE_SIZE` 得到「每个像素字号对应多少 em」。 */
  const perEm = metrics.nudge / REFERENCE_SIZE
  const next = `${Math.round(perEm * 10000) / 10000}em`
  const root = document.documentElement
  if (root.style.getPropertyValue(INK_NUDGE_PROPERTY) !== next) {
    root.style.setProperty(INK_NUDGE_PROPERTY, next)
  }
  return metrics
}

/**
 * Measure now, then again once the fonts are actually loaded.
 *
 * The second pass is not belt-and-braces: a page whose Chinese font arrives after
 * first paint measures the FALLBACK font, and the fallback's metrics are exactly
 * what this correction exists to compensate for. Without the second pass the
 * first paint would publish a number belonging to a font nobody is looking at.
 */
export function installInkMetrics(): void {
  publishInkMetrics()
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
  if (fonts === undefined) return
  void fonts.ready.then(() => { publishInkMetrics() }).catch(() => {
    /* A failed font load is not a reason to fail the page: the first measurement
       already covers the font that IS rendering. */
  })
}
