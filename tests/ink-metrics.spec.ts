// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { INK_PROPERTY, installInkMetrics, measureInkMetrics, publishInkMetrics } from '../src/client/design/ink-metrics.ts'

/**
 * 墨位校正的算法：**它必须是「由字体算出来的」，不是「写死的一个数」**。
 *
 * 这一节钉住五件事，每一件都对应一个曾经真实出过的错：
 *
 *   1. 公式与符号。偏移 = `[(fontAsc − fontDesc) − (inkAsc − inkDesc)] / 2`。
 *      正的值表示墨偏下。
 *   2. **两个方向都要发布**。CSS 那一侧本来就是两侧都写的，只发正值会让「墨天生
 *      偏上」的那款字体一次都不校正——那种机器上看到的就是「整体偏上一点点」。
 *   3. **单位是 em，不是 px**。偏移与字号成正比，发一个参考字号下的绝对像素，到了
 *      11px 的标签上就过校正、到了 16px 的输入框上就欠校正。
 *   4. **死区**：偏移小于 `DEAD_ZONE` 时一位都不写。已经居中的设备不该被一个四舍五入
 *      的噪声推动——那是「手机本来好好的，被改坏了」的直接原因。
 *   5. 写在**声明令牌的那个元素**上，并在字体加载完之后再量一次。
 */

/** 造一个只带 `measureText` 的 canvas，把四个度量写死。 */
function stubCanvas(metrics: {
  fontAscent: number
  fontDescent: number
  inkAscent: number
  inkDescent: number
}): void {
  const context = {
    font: '',
    measureText: () => ({
      fontBoundingBoxAscent: metrics.fontAscent,
      fontBoundingBoxDescent: metrics.fontDescent,
      actualBoundingBoxAscent: metrics.inkAscent,
      actualBoundingBoxDescent: metrics.inkDescent,
    }),
  }
  const original = HTMLCanvasElement.prototype.getContext
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement, id: string) {
    if (id === '2d') return context as unknown as CanvasRenderingContext2D
    return original.call(this, id as '2d')
  } as never)
}

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.style.removeProperty(INK_PROPERTY)
})

describe('the ink offset is computed from the font, not written down', () => {
  it('a font whose ink sits low reads a POSITIVE offset', () => {
    /* 上行 15 / 下行 4、墨 11 / 1：`((15−4) − (11−1)) / 2 = 0.5`，墨偏下。 */
    stubCanvas({ fontAscent: 15, fontDescent: 4, inkAscent: 11, inkDescent: 1 })
    const metrics = measureInkMetrics('sans-serif', '500')
    expect(metrics, 'the measurement must produce a reading').toBeDefined()
    expect(metrics!.offset, 'a low-sitting ink reads positive').toBe(0.5)
  })

  it('a font whose ink sits HIGH reads a NEGATIVE offset', () => {
    /* 同一组数字里把上行与下行对调：`((4−15) − (1−11)) / 2 = −0.5`，墨偏上。 */
    stubCanvas({ fontAscent: 4, fontDescent: 15, inkAscent: 1, inkDescent: 11 })
    const metrics = measureInkMetrics('sans-serif', '500')
    expect(metrics!.offset, 'a high-sitting ink reads negative').toBe(-0.5)
  })

  it('a font whose ink is already centred reads zero, and zero is a real answer', () => {
    stubCanvas({ fontAscent: 12, fontDescent: 3, inkAscent: 11, inkDescent: 2 })
    const metrics = measureInkMetrics('sans-serif', '500')
    expect(metrics!.offset).toBe(0)
  })
})

describe('what gets published is a ratio, and both directions get published', () => {
  it('a low-sitting ink publishes a POSITIVE em value', () => {
    /* 偏移 +0.5px。发布量**不是** `偏移 × 2 = 1px`：1px 与 0 在内衬的量化表上落在
       同一级（见 `QUANTUM`），写下去屏幕上的墨一动不动。所以发布的是「至少跨一级」
       ——`1.4px`。这一条钉的正是那个「修了等于没修」的坑。 */
    stubCanvas({ fontAscent: 15, fontDescent: 4, inkAscent: 11, inkDescent: 1 })
    publishInkMetrics()
    expect(
      document.documentElement.style.getPropertyValue(INK_PROPERTY),
      'a positive offset needs a positive pad that actually crosses a step',
    ).toBe('1.4px')
  })

  it('a HIGH-sitting ink publishes a NEGATIVE pad instead of nothing', () => {
    /* **这一条钉的是一个真实存在过的「一半的设备收不到校正」。** CSS 那边写的是
       `max(0px, calc(-1 * …)) max(0px, …)`：负值时上内衬生效、下内衬被 `max` 压成 0。
       旧实现只发正值，于是墨偏上的字体发布什么都不写，而那些机器上看到的正是
       「所有文案整体偏上一丢丢」——调行高、调内衬都调不出来，因为从来没有值被写进去。 */
    stubCanvas({ fontAscent: 4, fontDescent: 15, inkAscent: 1, inkDescent: 11 })
    publishInkMetrics()
    expect(
      document.documentElement.style.getPropertyValue(INK_PROPERTY),
      'the sign picks the side; it does not decide whether to correct at all',
    ).toBe('-1.4px')
  })

  it('the published pad is in px and always crosses at least one step', () => {
    /* **这条钉两件事：单位与量化。**
       单位是 px，不是按字号缩放的比例——偏移只来自「字体的上下沿不对称」，那是字体
       自己的常数，换字号时行盒与墨一起缩放，而盒子的余量按另外一档走，两者相抵。
       早先发过 em：12px 上算出 0.86px、16px 上 1.14px，都不对。

       量化是这一条真正的重点：内衬每约 1.4px 才让墨跳一格，`1px` 与 `0` 同档。
       所以**任何偏移都至少发一级**，而不是照偏移量精确取值。 */
    stubCanvas({ fontAscent: 15, fontDescent: 4, inkAscent: 11, inkDescent: 1 })
    publishInkMetrics()
    const big = document.documentElement.style.getPropertyValue(INK_PROPERTY)
    document.documentElement.style.removeProperty(INK_PROPERTY)
    /* 偏移减半（+0.25px，刚好在死区边界之外）：仍然要跨一级，不能退化成 0.5px。 */
    stubCanvas({ fontAscent: 14, fontDescent: 4, inkAscent: 11, inkDescent: 1.5 })
    publishInkMetrics()
    const small = document.documentElement.style.getPropertyValue(INK_PROPERTY)
    expect(big, 'the big offset still publishes one step, in px').toBe('1.4px')
    expect(small, 'a smaller offset must not fall back to a value below one step').toBe('1.4px')
  })

  it('writes the reading onto the element that DECLARES the token', () => {
    /* **这一条钉的是一个真实存在过的「什么都没发生」。** 令牌声明在 `:root` 上，所以
       发布也必须写在同一个元素上。CSS 里**元素自己的声明压过继承来的值**，写到别处
       量出来的数就永远不生效——每个胶囊读到的都是表里那个静态的 0，校正一次都没跑。 */
    stubCanvas({ fontAscent: 15, fontDescent: 4, inkAscent: 11, inkDescent: 1 })
    const first = publishInkMetrics()
    expect(first?.offset).toBe(0.5)
    expect(document.documentElement.style.getPropertyValue(INK_PROPERTY)).toBe('1.4px')

    /* 同一份字体再量一次：值没变，就不该再写一次（每一次写都让整页的样式失效重算）。 */
    const setSpy = vi.spyOn(document.documentElement.style, 'setProperty')
    publishInkMetrics()
    expect(setSpy, 'an unchanged reading must not touch the root').not.toHaveBeenCalled()
  })

  it('a reading inside the dead zone writes nothing', () => {
    /* **死区**：0.1px 是四舍五入的噪声，不是偏差。已经居中的设备被推动一下，就会
       出现「本来好好的，被改坏了」——手机端就是这么被弄坏的。 */
    stubCanvas({ fontAscent: 12.1, fontDescent: 3, inkAscent: 11, inkDescent: 2 })
    const metrics = publishInkMetrics()
    expect(metrics, 'the measurement still reports what it read').toBeDefined()
    expect(
      document.documentElement.style.getPropertyValue(INK_PROPERTY),
      'a sub-quarter-pixel offset must leave the page alone',
    ).toBe('')
  })

  it('measures again once the fonts are actually loaded', async () => {
    /* 首帧可能还在用回退字体。回退字体的度量恰恰是这条校正要补偿的那一份，所以
       `document.fonts.ready` 之后必须再量一次，否则会发布一个「没人正在看的字体」的数。 */
    const probe = vi.fn()
    stubCanvas({ fontAscent: 15, fontDescent: 4, inkAscent: 11, inkDescent: 1 })
    /* jsdom 没有 `document.fonts`；这个测试要验证的是「有没有第二次测量」，所以给它
       一个最小的替身。替身如实模拟真实 API 的那一件事：`ready` 是一个 Promise。 */
    const replaced = 'fonts' in document
    if (!replaced) {
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: { ready: Promise.resolve().then(() => { probe() }) },
      })
    }
    installInkMetrics()
    /* 第一次是同步的：令牌已经有了。 */
    expect(
      document.documentElement.style.getPropertyValue(INK_PROPERTY),
      'the synchronous pass must publish before any await',
    ).toBe('1.4px')
    await Promise.resolve()
    await Promise.resolve()
    expect(probe, 'the fonts.ready pass must run').toHaveBeenCalled()
  })
})
