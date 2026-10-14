/**
 * 一行里的墨偏了多少：**在读者自己的浏览器里量一次**，写成一个令牌。
 *
 * ── 为什么必须有这个模块 ─────────────────────────────────────────────────────
 *
 * CSS 能居中的只有**行盒**，而行盒的高度是**字体的度量**（ascent / descent）。汉字的墨并不落在
 * 行盒的几何中心上，于是「把行盒居中」之后，读者看到的墨还差一点：
 *
 *     bias = [ (ascent − 墨上高) − (descent − 墨下高) ] / 2
 *
 * 两条性质决定了它的治法：
 *
 *   1. **它与字号、行高、盒高都无关。** 半行距在行盒上下对称地加减——`line-height` 一变，
 *      基线与行盒中心的距离按同一个公式跟着变。所以改行高、改内衬、改定高都修不好它，
 *      而**同一个字体下每一处差的都是同一个 em 值**。
 *   2. **它是每种字体自己的，符号还会翻。** 同一份样式、同一档：本机默认字体量到
 *      **+0.09em（字偏下）**，把字体栈换成 SimSun 量到 **约 0**。报告的读者是第三种字体
 *      （他的手机：字偏上）。所以它**不能写成一个数**——写死一个数就是在一种字体上对、
 *      在另一种字体上错，而屏上没有任何一处说得出这句话。
 *
 * 屏上真正的病根是**两种几何混在一行里**：珠子、图标、分隔线是**盒子的几何**（不认字体），
 * 而字的墨跟着**基线**走（认字体）。于是「珠子与标题对齐」这件事在开发者的字体上成立、
 * 在读者的字体上不成立——本文件把那个差额量出来，让**两半一起动**。
 *
 * ── 量法（与审计同一套，见 `scripts/probe-item-capsules.js`）──────────────────
 *
 *   基线   在**同一个行盒**里插一个零尺寸的空 `inline-block`——空的行内块没有行盒，于是它的
 *          基线就是自己的下边缘——读它的 `bottom`。**不**用「行盒顶 + 半行距 + 字体上高」
 *          那条算式：那一条对任何被改过盒子的元素都会错约 1px。
 *   墨     `TextMetrics.actualBoundingBoxAscent/Descent`（canvas 用同一个字体串）。
 *   行盒   `Range.getClientRects()`。
 *   精度   探针字号放大到 `PROBE_SIZE`（200px）再折算：度量整数化带来的误差被摊薄十几倍。
 *          canvas 的 `actualBoundingBox*` 是整数，12px 的中文上高量成 11、下高量成 1，
 *          而真值是 10.56 与 1.44——不放大就会把一个真实的 1.08px 报成 0.5px。
 *
 * ── 它不做什么 ───────────────────────────────────────────────────────────────
 *
 * 不改版面（消费端写的是内衬与位移，不是裁切）、不裁任何东西。它只回答一个问题：
 * **这一份字体，字要往下走多少才落在盒心上。**
 */

/** 消费端读的那个令牌。名字进命名矩阵：`--dsh-tb-*` 是这一层自己的前缀。 */
export const INK_SHIFT_TOKEN = '--dsh-tb-ink-shift'

/** 探针字号。放大是为了精度，不是显示——探针离屏、不可见、量完即删。 */
const PROBE_SIZE = 200

/** 量哪个字：一个汉字就够——汉字的墨跨基线两侧，是这一族里最宽的那块墨。 */
const SAMPLE = '国'

const PROBE_ATTR = 'data-dsh-tb-ink-probe'

/** 一串字排在哪几个行盒里（与审计同一个读法）。 */
function lineBoxOf(node: Node): DOMRect | null {
  const range = document.createRange()
  range.selectNodeContents(node)
  const rects = [...range.getClientRects()].filter((one) => one.width > 0 && one.height > 0)
  return rects[0] ?? null
}

/**
 * 这一份字体里，字要往下走多少才落在盒心上——**em**，正数往下。
 *
 * 量不到（没有布局、没有 `document`、拿不到 2d 上下文、行盒读不出来）就返回 `null`：三态里的
 * 「没量到」好过一个煞有介事的数——写一个 0 会把「没量」画成「不用动」。
 *
 * @param fontFamily - 要量的字体栈（通常是面板根上的 `font-family`）。
 * @returns 偏移量（em）或 `null`。
 */
export function measureInkShiftEm(fontFamily: string): number | null {
  if (typeof document === 'undefined' || document.body === null) return null
  /* **没有布局就没有读数。** 量尺读的是行盒与基线，而它们只在真的有版面时存在：没有布局的
   * 环境（jsdom）里 `Range.getClientRects()` 给空表、canvas 的 `getContext` 干脆不是一件实现，
   * 量出来的任何数都是假的，所以在这里就分到「没量到」那一档。这个函数跑在渲染期（根上的
   * ref），量不出来**不许把界面带走**。 */
  if (document.documentElement === null || document.documentElement.clientWidth === 0) return null
  if (fontFamily.trim() === '') return null
  try {
    return measureUnsafe(fontFamily)
  } catch {
    return null
  }
}

function measureUnsafe(fontFamily: string): number | null {
  const host = document.createElement('span')
  host.setAttribute(PROBE_ATTR, '')
  host.setAttribute('aria-hidden', 'true')
  /* 离屏 + 不可见：它绝不参与版面，也绝不被看到；`white-space: pre` 保证锚与字在同一行。 */
  host.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font-family:${fontFamily};font-size:${PROBE_SIZE}px;line-height:normal`
  host.textContent = SAMPLE
  const anchor = document.createElement('span')
  anchor.style.cssText = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;overflow:visible'
  host.appendChild(anchor)
  document.body.appendChild(host)
  try {
    const line = lineBoxOf(host.firstChild ?? host)
    if (line === null) return null
    const baseline = anchor.getBoundingClientRect().bottom
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx === null || ctx === undefined || typeof ctx.measureText !== 'function') return null
    ctx.font = `${PROBE_SIZE}px ${fontFamily}`
    const metrics = ctx.measureText(SAMPLE)
    if (!Number.isFinite(metrics.actualBoundingBoxAscent) || !Number.isFinite(metrics.actualBoundingBoxDescent)) return null
    const inkCentre = (baseline - metrics.actualBoundingBoxAscent + baseline + metrics.actualBoundingBoxDescent) / 2
    return ((line.top + line.bottom) / 2 - inkCentre) / PROBE_SIZE
  } finally {
    host.remove()
  }
}

/**
 * 把量到的偏移写到这个根上（幂等：值没变就不碰样式，免得每次渲染都触发一次样式重算）。
 *
 * @param root - 面板自己的根（`[data-dsh-taskboard-view]`），令牌只落在**自己的子树**上。
 */
export function applyInkShift(root: HTMLElement): void {
  try {
    const em = measureInkShiftEm(getComputedStyle(root).fontFamily)
    if (em === null) return
    const next = `${Math.round(em * 10000) / 10000}em`
    if (root.style.getPropertyValue(INK_SHIFT_TOKEN) !== next) root.style.setProperty(INK_SHIFT_TOKEN, next)
    watchFonts()
  } catch {
    /* 同上：令牌写不上就不写，界面照常。 */
  }
}

/** 一个给 `ref` 用的回调：`<div ref={inkShiftRef} …>`。 */
export const inkShiftRef = (el: HTMLElement | null): void => {
  if (el !== null) applyInkShift(el)
}

let watching = false

/** 字体是**迟到**的：系统字体也可能在首帧之后才定下来。所以字体一加载完就重量一遍
 * （只重量插件自己的根，别碰宿主的任何东西）。只装一次。 */
function watchFonts(): void {
  if (watching || typeof document === 'undefined' || document.fonts === undefined) return
  watching = true
  document.fonts.addEventListener('loadingdone', () => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-dsh-taskboard-view]')) applyInkShift(el)
  })
}
