/**
 * 种在 `tests/` 里：证明 `item-cursor.spec.ts` 的判据会红。
 *
 * 硬性规范 16：证明门禁会红只能在 `tests/` 里种——在真实文件里改一下再改回来，
 * 证的是「改动生效」而不是「门禁会红」。
 */
import { describe, expect, it } from 'vitest'

/** 与 `item-cursor.spec.ts` 同一套读法（复制判据，喂假输入）。 */
function verdictOf(css: string): { rowPointer: boolean; detailResets: boolean } {
  const ruleOf = (selector: string): string | undefined => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const block of bare.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
      if (block[1].includes(selector)) return block[2]
    }
    return undefined
  }
  const row = ruleOf('.itemRow') ?? ''
  const detail = ruleOf('.itemRow > .itemDetail') ?? ''
  return {
    rowPointer: /cursor:\s*pointer/.test(row),
    detailResets: /cursor:\s*(default|auto)/.test(detail),
  }
}

describe('item-cursor 判据本身会咬人', () => {
  it('展开区不重置光标（缺陷原样），判据必须报出来', () => {
    const planted = `
      .itemRow { cursor: pointer; }
      /* 缺陷：没写 cursor，于是继承行的手 */
      .itemRow > .itemDetail { display: block; }
    `
    expect(verdictOf(planted).detailResets, '缺陷没被认出来——这条门禁是空转的').toBe(false)
  })

  it('行不是手（另一个方向的缺陷），判据也要报出来', () => {
    const planted = `
      .itemRow { cursor: default; }
      .itemRow > .itemDetail { cursor: default; }
    `
    expect(verdictOf(planted).rowPointer).toBe(false)
  })

  it('正确的那一版必须放行', () => {
    const clean = `
      .itemRow { cursor: pointer; }
      .itemRow > .itemDetail { cursor: default; }
    `
    const verdict = verdictOf(clean)
    expect(verdict.rowPointer).toBe(true)
    expect(verdict.detailResets).toBe(true)
  })
})
