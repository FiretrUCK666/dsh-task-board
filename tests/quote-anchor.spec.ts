/**
 * 引用按钮的落位（quote-anchor.ts）：纯几何判据。
 *
 * 这里钉的两件事在屏幕上极难发现，发现了也很难说清原因：**半个按钮跑到视口外**，以及
 * **按钮整个落在看不见的地方**（读者看到的是「按了没反应」）。所以断言不看「像不像对」，
 * 看的是结构性质：结果永远在可摆范围之内，且永远贴着选区那一侧。
 */
import { describe, expect, it } from 'vitest'
import { quoteAnchorOf } from '../src/client/board/quote-anchor.ts'

/** 一个正常的可摆范围：一块 600x400 的面板。 */
const BOUNDS = { top: 100, left: 200, width: 600, height: 400 }
/** 按钮尺寸（量到的真实值由调用方传进来）。 */
const ACTION = { width: 88, height: 28 }

/** 结果是否整个落在可摆范围之内。 */
function inside(spot: { top: number; left: number }, bounds = BOUNDS, action = ACTION): boolean {
  return spot.top >= bounds.top
    && spot.left >= bounds.left
    && spot.top + action.height <= bounds.top + bounds.height
    && spot.left + action.width <= bounds.left + bounds.width
}

describe('quoteAnchorOf', () => {
  it('centres on the selection horizontally and sits above it', () => {
    const selection = { top: 300, left: 400, width: 100, height: 20 }
    const spot = quoteAnchorOf(selection, BOUNDS, ACTION)
    expect(spot.placement).toBe('above')
    /* 居中是「按钮的心 = 选区的心」，不是「左边对齐」。 */
    expect(spot.left + ACTION.width / 2).toBeCloseTo(selection.left + selection.width / 2)
    expect(spot.top).toBe(selection.top - 6 - ACTION.height)
    expect(inside(spot)).toBe(true)
  })

  it('never leaves the bounds when the selection hugs the left edge', () => {
    const spot = quoteAnchorOf({ top: 300, left: BOUNDS.left, width: 40, height: 20 }, BOUNDS, ACTION)
    expect(inside(spot)).toBe(true)
    expect(spot.left).toBeGreaterThanOrEqual(BOUNDS.left)
  })

  it('never leaves the bounds when the selection hugs the right edge', () => {
    const selection = { top: 300, left: BOUNDS.left + BOUNDS.width - 40, width: 40, height: 20 }
    const spot = quoteAnchorOf(selection, BOUNDS, ACTION)
    expect(inside(spot)).toBe(true)
  })

  it('flips below when there is no room above', () => {
    /* 选区贴着面板上沿：上方放不下 28px 的按钮，必须翻到下方——否则它整个落在看不见的
       地方，而读者看到的是「按了没反应」。 */
    const spot = quoteAnchorOf({ top: BOUNDS.top, left: 400, width: 100, height: 20 }, BOUNDS, ACTION)
    expect(spot.placement).toBe('below')
    expect(spot.top).toBe(BOUNDS.top + 20 + 6)
    expect(inside(spot)).toBe(true)
  })

  it('stays inside the bounds when neither side has room to spare', () => {
    /* 一个刚好装得下按钮的范围（28px 的按钮 + 上下 8px 留白 = 44px）：两边都没有富余，
       此时唯一诚实的答案是「贴着留白」，而不是跑到范围外面去。 */
    const tight = { top: 100, left: 200, width: 600, height: 44 }
    const spot = quoteAnchorOf({ top: 100, left: 400, width: 100, height: 44 }, tight, ACTION)
    expect(inside(spot, tight)).toBe(true)
  })

  it('pins to the top margin when the bounds cannot contain the button at all', () => {
    /* 范围比按钮本身还矮（30px < 28px + 上下留白）：完整容纳在数学上不可能。此时的选择
       是「贴着上沿、露出大部分」而不是「垂直到范围之外」——可读的那个答案优先。 */
    const tooShort = { top: 100, left: 200, width: 600, height: 30 }
    const spot = quoteAnchorOf({ top: 100, left: 400, width: 100, height: 30 }, tooShort, ACTION)
    expect(spot.top).toBe(tooShort.top + 8)
  })

  it('clamps to the left margin when the bounds are narrower than the button', () => {
    /* 按钮比可摆范围还宽时上下界会倒挂：夹反了会把 `left` 顶到负数外面去，而那不是
       「有点偏」，是半个按钮不见了。 */
    const narrow = { top: 0, left: 0, width: 40, height: 200 }
    const spot = quoteAnchorOf({ top: 100, left: 0, width: 40, height: 20 }, narrow, ACTION)
    expect(spot.left).toBe(8)
  })
})
