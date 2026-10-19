// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { INK_PROPERTY, installInkMetrics, measureInkMetrics, publishInkMetrics } from '../src/client/design/ink-metrics.ts'

/**
 * 墨位校正的算法：**它必须是「由字体算出来的」，不是「写死的一个数」**。
 *
 * 这一节钉住四件事，每一件都对应一个曾经真实出过的错：
 *
 *   1. 公式与符号。偏移 = `[(fontAsc − fontDesc) − (inkAsc − inkDesc)] / 2`。
 *      正的值表示墨偏下，要用下内衬把它抬起来。
 *   2. **死区**：偏移小于 `DEAD_ZONE` 时一位都不写。已经居中的设备不该被一个四舍五入
 *      的噪声推动——那是「手机本来好好的，被改坏了」的直接原因。
 *   3. **方向**：墨偏上（offset < 0）时不写。内衬不能为负，写了会让 `calc()` 变负，
 *      浏览器把整条 `padding` 声明丢掉，比不校正更糟。
 *   4. 写在**声明令牌的那个元素**上，并在字体加载完之后再量一次。
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

  it('writes the reading onto the element that DECLARES the token', () => {
    /* **这一条钉的是一个真实存在过的「什么都没发生」。** 令牌声明在 `:root` 上，所以
       发布也必须写在同一个元素上。CSS 里**元素自己的声明压过继承来的值**，写到别处
       量出来的数就永远不生效——每个胶囊读到的都是表里那个静态的 0，校正一次都没跑。 */
    stubCanvas({ fontAscent: 15, fontDescent: 4, inkAscent: 11, inkDescent: 1 })
    const first = publishInkMetrics()
    expect(first?.offset).toBe(0.5)
    expect(document.documentElement.style.getPropertyValue(INK_PROPERTY), 'the token is declared on :root, so the write belongs there too').toBe('1px')

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
    expect(document.documentElement.style.getPropertyValue(INK_PROPERTY), 'a sub-quarter-pixel offset must leave the page alone').toBe('')
  })

  it('an ink that sits high writes nothing, because a negative pad is not a pad', () => {
    stubCanvas({ fontAscent: 4, fontDescent: 15, inkAscent: 1, inkDescent: 11 })
    publishInkMetrics()
    expect(document.documentElement.style.getPropertyValue(INK_PROPERTY), 'padding cannot go negative — writing one drops the whole declaration').toBe('')
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
    expect(document.documentElement.style.getPropertyValue(INK_PROPERTY), 'the synchronous pass must publish before any await').toBe('1px')
    await Promise.resolve()
    await Promise.resolve()
    expect(probe, 'the fonts.ready pass must run').toHaveBeenCalled()
  })
})
