// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { INK_NUDGE_PROPERTY, installInkMetrics, measureInkMetrics, publishInkMetrics } from '../src/client/design/ink-metrics.ts'

/**
 * 墨位校正的算法：**它必须是「由字体算出来的」，不是「写死的一个数」**。
 *
 * 这一节钉住三件事，每一件都对应一个曾经真实出过的错：
 *
 *   1. 公式与符号。偏移 = `2 × (raw)`，其中 `raw = [(fontAsc − fontDesc) − (inkAsc −
 *      inkDesc)] / 2`。漏掉那个 2（内衬只移动内衬的一半）或漏掉负号那一侧（墨偏上
 *      要用上内衬），都会让「电脑端偏下」永远修不好——而那正是读者报的那一侧。
 *   2. 两侧都要能表达。CSS 里写成 `padding-block: max(0px, -nudge) max(0px, nudge)`，
 *      所以令牌的**符号**决定用哪一侧；算法必须允许负值。
 *   3. 只在数值真的变化时才写令牌，并在字体加载完之后再量一次。
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
  document.documentElement.style.removeProperty(INK_NUDGE_PROPERTY)
})

describe('the ink nudge is computed from the font, not written down', () => {
  it('a font whose ink sits low gets a POSITIVE nudge (pad the end, push the line up)', () => {
    /* 上行 15 / 下行 4、墨 11 / 1：`raw = ((15−4) − (11−1)) / 2 = 0.5`，墨偏下。
       下内衬把它抬起来，所以令牌为正，值是 `2 × 0.5 = 1`。 */
    stubCanvas({ fontAscent: 15, fontDescent: 4, inkAscent: 11, inkDescent: 1 })
    const metrics = measureInkMetrics('sans-serif', '500')
    expect(metrics, 'the measurement must produce a reading').toBeDefined()
    expect(metrics!.nudge, 'a low-sitting ink needs a positive nudge').toBe(1)
  })

  it('a font whose ink sits HIGH gets a NEGATIVE nudge (pad the start, push the line down)', () => {
    /* 同一组数字里把上行与下行对调：`raw = ((4−15) − (1−11)) / 2 = −0.5`，墨偏上。
       这一侧是上一版漏掉的那一半——只会加下内衬的实现在这里永远修不好。 */
    stubCanvas({ fontAscent: 4, fontDescent: 15, inkAscent: 1, inkDescent: 11 })
    const metrics = measureInkMetrics('sans-serif', '500')
    expect(metrics!.nudge, 'a high-sitting ink needs a negative nudge').toBe(-1)
  })

  it('a font whose ink is already centred gets zero, and zero is a real answer', () => {
    /* 上下沿与墨对称：任何字体下都可能出现，它必须读出 0 而不是被当成「没量到」。 */
    stubCanvas({ fontAscent: 12, fontDescent: 3, inkAscent: 11, inkDescent: 2 })
    const metrics = measureInkMetrics('sans-serif', '500')
    expect(metrics!.nudge).toBe(0)
  })

  it('publishes the reading to the root, and only rewrites when it changed', () => {
    stubCanvas({ fontAscent: 15, fontDescent: 4, inkAscent: 11, inkDescent: 1 })
    const first = publishInkMetrics()
    expect(first?.nudge).toBe(1)
    /* **发布的是 `em`，不是 `px`。** 一枚令牌要喂给 12/13/15 三种字号，而字体上下沿
       的不对称是**比例**（随字号缩放）：用 px 发布只有参考字号那一档是对的，其余两档
       各差一截。这一条断言的是那个**单位**，不是那个数——数是量出来的。 */
    expect(document.documentElement.style.getPropertyValue(INK_NUDGE_PROPERTY)).toBe('0.0714em')

    /* 同一份字体再量一次：值没变，就不该再写一次（每一次写都让整页的样式失效重算）。 */
    const setSpy = vi.spyOn(document.documentElement.style, 'setProperty')
    publishInkMetrics()
    expect(setSpy, 'an unchanged reading must not touch the root').not.toHaveBeenCalled()
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
    expect(document.documentElement.style.getPropertyValue(INK_NUDGE_PROPERTY)).toBe('0.0714em')
    await Promise.resolve()
    await Promise.resolve()
    expect(probe, 'the fonts.ready pass must run').toHaveBeenCalled()
    if (!replaced) Object.defineProperty(document, 'fonts', { configurable: true, value: undefined })
  })

  it('says nothing rather than guessing when the canvas cannot measure', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as never)
    expect(measureInkMetrics('sans-serif', '500')).toBeUndefined()
    expect(publishInkMetrics()).toBeUndefined()
  })
})
