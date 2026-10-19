// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest'
import {
  applyInkShifts,
  installInkMetrics,
  OPTICAL_SHIFT_PROPERTY,
  OPTICAL_TARGET_PROPERTY,
} from '../src/client/design/ink-metrics.ts'

/**
 * 墨位校正：**每一枚盒子自己算出自己该差多少**。
 *
 * 这一节钉的是那条被反复推翻的路：**一个全局常数对不齐一组不同的需求**。
 * 试过四次（`0.04em`、`0.5px`、`1px`、`1.4px`），每次都只对一部分、把另一部分推歪，
 * 屏上表现为「有的偏上、有的偏下」——而每一次都有人以为是「还差一点」，于是再调一个数。
 *
 * 真正缺的不是更好的常数，是**逐元素**这件事：需要的量同时取决于字体度量、
 * 行盒比元素盒高多少、以及字号；而渲染时基线被吸附到整像素，于是「差多少」是
 * **一格一格**的，每格的门槛由那一枚自己的几何决定（量过的三个族：12px 的芯片要
 * 1.1px、13px 的页签要 2.0px、组头要 1.25px）。
 *
 * jsdom 没有布局，所以这里钉的不是「像素对不对」（那要真 Chromium，见
 * `scripts/probes/ink-sweep.mjs`），而是四条机制事实：
 *
 *   1. **只碰带标记的盒子**——宿主自己的界面一个都不碰；
 *   2. **每一枚写的是它自己的值**，不是共享的一个；
 *   3. **写的是一个变量**，不动几何（不动 `transform`、不改 `position`）；
 *   4. 重复运行不重复写；`installInkMetrics` 返回 disposer。
 */

/** 给元素造一个可测的盒子与一行字。 */
function textBox(text: string, height = 20, top = 100): HTMLElement {
  const element = document.createElement('div')
  element.textContent = text
  document.body.append(element)
  /* jsdom 不做布局，`getBoundingClientRect` 全 0；量法的第一步就是「盒高为 0 就返回
     undefined」，所以这里必须伪造一个盒子——伪造的只是**布局**，判据仍然按真实接口读。 */
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 60, height, top, bottom: top + height,
      left: 0, right: 60, x: 0, y: top, toJSON: () => ({}),
    }) as DOMRect,
  })
  return element
}

/** 让 `Range.getClientRects()` 返回一行。 */
function stubRangeTop(top: number, height: number): () => void {
  const original = Range.prototype.getClientRects
  Range.prototype.getClientRects = function (): DOMRectList {
    const list = [{
      width: 50, height, top, bottom: top + height,
      left: 0, right: 50, x: 0, y: top, toJSON: () => ({}),
    }]
    return Object.assign(list, { item: (index: number) => list[index] }) as unknown as DOMRectList
  } as never
  return () => { Range.prototype.getClientRects = original }
}

/** canvas 量出的四个数；jsdom 没有 2d 上下文。 */
function stubCanvas(fontAscent: number, fontDescent: number, inkAscent: number, inkDescent: number): void {
  /* 画布是按**设备像素比**开的（运行时那样做），所以墨带也要按那个比例铺。 */
  const context = {
    font: '',
    canvas: { width: 256, height: 128 },
    measureText: () => ({
      fontBoundingBoxAscent: fontAscent,
      fontBoundingBoxDescent: fontDescent,
      actualBoundingBoxAscent: inkAscent,
      actualBoundingBoxDescent: inkDescent,
    }),
    scale: () => {},
    clearRect: () => {},
    fillRect: () => {},
    fillText: () => {},
    getImageData: (_x: number, _y: number, width: number, height: number) => {
      /* 假装画了一行字：基线在中间，墨在基线上方 11 个 CSS 像素。 */
      const data = new Uint8ClampedArray(width * height * 4)
      const ratio = width / 256
      const baseline = 64 * ratio
      const top = Math.round(baseline - 11 * ratio)
      for (let y = top; y < baseline; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4
          data[i] = 0
          data[i + 3] = 255
        }
      }
      return { data }
    },
  }
  HTMLCanvasElement.prototype.getContext = (() => context) as never
}

/** 让 `getComputedStyle` 报出**这一档**的行高与字号。 */
function stubTypography(lineHeight: number, fontSize = 12): () => void {
  const original = window.getComputedStyle
  window.getComputedStyle = ((element: Element) => {
    const style = original.call(window, element)
    return new Proxy(style, {
      get(target, property, receiver) {
        if (property === 'lineHeight') return `${lineHeight}px`
        if (property === 'fontSize') return `${fontSize}px`
        if (property === 'fontFamily') return 'sans-serif'
        return Reflect.get(target, property, receiver)
      },
    })
  }) as typeof window.getComputedStyle
  return () => { window.getComputedStyle = original }
}

/** 声明「这一枚要校正」。 */
function mark(element: HTMLElement): void {
  element.style.setProperty(OPTICAL_TARGET_PROPERTY, '1')
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the shift is measured per element, and only where it was asked for', () => {
  it('leaves an unmarked box completely alone', () => {
    /* **这一条是整个文件的重点。** 上一版把整个 document 的每一行字都改了，于是整个
       DSH 页面（宿主自己的界面）都在被抬起、跳页时还会「弹一下」。宿主不是我们的，
       所以没有标记的盒子一个都不碰。 */
    stubCanvas(15, 4, 11, 0)
    const restoreType = stubTypography(12)
    const element = textBox('字', 20, 100)
    const restore = stubRangeTop(100, 12)
    applyInkShifts()
    restore()
    restoreType()
    expect(element.style.getPropertyValue(OPTICAL_SHIFT_PROPERTY), 'an unmarked box is left alone').toBe('')
  })

  it('writes a variable on a marked box, and does not move the box', () => {
    /* 写的是**一个变量**：不动几何，所以不会裁切、不会重排、不会让旁边的图标跟着动。
       （「用 transform 挪」不行：「非替换的行内元素不接受 transform」，而这一份界面里
       大量文字是行内的——写了不执行，而屏上什么都不会说。） */
    stubCanvas(15, 4, 11, 0)
    const restoreType = stubTypography(12)
    const element = textBox('待办', 20, 100)
    mark(element)
    const restore = stubRangeTop(100, 12)
    applyInkShifts()
    restore()
    restoreType()
    expect(element.style.getPropertyValue(OPTICAL_SHIFT_PROPERTY), 'the shift is written as a variable').not.toBe('')
    expect(element.style.transform, 'and it must not move the box by a transform').toBe('')
    expect(element.style.position, 'nor by a relative position').toBe('')
    expect(element.style.paddingBottom, 'nor by touching the padding itself').toBe('')
  })

  it('gives two boxes with different line boxes DIFFERENT shifts', () => {
    /* 同一款字体、同样的盒高，只有行盒位置不同——全局常数会给出同一个数（因为只看
       字体），因此必然有一个是歪的。逐元素各算各的，才对得上。 */
    stubCanvas(15, 4, 11, 0)
    const restoreType = stubTypography(12)
    const first = textBox('短', 20, 100)
    mark(first)
    const restore = stubRangeTop(100, 12)
    applyInkShifts()
    const high = first.style.getPropertyValue(OPTICAL_SHIFT_PROPERTY)
    restore()

    const second = textBox('低', 20, 100)
    mark(second)
    const restore2 = stubRangeTop(103, 12)
    applyInkShifts()
    const low = second.style.getPropertyValue(OPTICAL_SHIFT_PROPERTY)
    restore2()
    restoreType()

    expect(high, 'a line box that sits high still reads a number').not.toBe('')
    expect(low, 'a line box that sits low reads a different number').not.toBe('')
    expect(low, 'the reading follows the element, not a global constant').not.toBe(high)
  })

  it('does not rewrite an unchanged reading', () => {
    /* 观察者会连续触发；每一次都重写行内样式会让整页样式失效重算。
       幂等的判据是「第二次调用写 0 次」。 */
    stubCanvas(15, 4, 11, 0)
    const restoreType = stubTypography(12)
    const element = textBox('字', 20, 100)
    mark(element)
    const restore = stubRangeTop(100, 12)
    applyInkShifts()
    const second = applyInkShifts()
    restore()
    restoreType()
    expect(second, 'an unchanged pass must not touch the DOM').toBe(0)
  })

  it('returns a disposer so no observer outlives the mount', () => {
    /* 硬性规范 6：观察者必须能被回收。返回的不是 disposer 的话，反复挂载会留下
       一串还在跑的观察者，而屏上没有任何一处会说出来。 */
    stubCanvas(15, 4, 11, 0)
    const restoreType = stubTypography(12)
    const dispose = installInkMetrics(document.body)
    restoreType()
    expect(typeof dispose, 'install must hand back a disposer').toBe('function')
    expect(() => { dispose() }, 'disposing must not throw').not.toThrow()
  })
})
