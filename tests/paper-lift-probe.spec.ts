/**
 * 种在 `tests/` 里：证明 `paper-lift.spec.ts` 的判据会红。
 *
 * 硬性规范 16：证明门禁会红只能在 `tests/` 里种——在真实文件里改一下再改回来，
 * 证的是「改动生效」而不是「门禁会红」。这里把缺陷形状**喂给同一套读法**：
 * 一个替换掉整条影子的悬停规则，必须被认出来。
 */
import { describe, expect, it } from 'vitest'

/** 与 `paper-lift.spec.ts` 同一套读法（复制判据，喂假输入）。 */
function judgementOf(css: string): { castMissing: string[]; orderWrong: string[] } {
  const ruleOf = (selector: string): string | undefined => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const block of bare.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
      if (block[1].includes(selector)) return block[2]
    }
    return undefined
  }
  const castMissing: string[] = []
  const orderWrong: string[] = []
  for (const selector of ['.paperSheet', '.paperLift:hover', '.paperLift:active']) {
    const body = ruleOf(selector) ?? ''
    const at = body.indexOf('box-shadow')
    if (at < 0) { castMissing.push(selector); continue }
    const shadow = body.slice(at)
    const cast = shadow.indexOf('--dsh-tb-paper-cast')
    const lift = shadow.search(/--dsh-tb-cast-\d/)
    if (cast < 0 || lift < 0) { castMissing.push(selector); continue }
    if (cast > lift) orderWrong.push(selector)
  }
  return { castMissing, orderWrong }
}

describe('paper-lift 判据本身会咬人', () => {
  it('把悬停那一条改回「替换整条影子」，判据必须报出来', () => {
    const planted = `
      .paperSheet { box-shadow: var(--dsh-tb-paper-cast, var(--dsh-tb-rim)), var(--dsh-tb-paper-lift, var(--dsh-tb-cast-1)); }
      /* 缺陷：整条替换，消费者那圈边消失 */
      .paperLift:hover { box-shadow: var(--dsh-tb-rim), var(--dsh-tb-cast-2); transform: translateY(-1px); }
      .paperLift:active { box-shadow: var(--dsh-tb-paper-cast, var(--dsh-tb-rim)), var(--dsh-tb-cast-1); }
    `
    expect(judgementOf(planted).castMissing, '缺陷没被认出来——这条门禁是空转的').toEqual(['.paperLift:hover'])
  })

  it('边与影的先后调反了，判据也必须报出来', () => {
    const planted = `
      .paperSheet { box-shadow: var(--dsh-tb-paper-cast, var(--dsh-tb-rim)), var(--dsh-tb-cast-1); }
      .paperLift:hover { box-shadow: var(--dsh-tb-cast-2), var(--dsh-tb-paper-cast, var(--dsh-tb-rim)); }
      .paperLift:active { box-shadow: var(--dsh-tb-paper-cast, var(--dsh-tb-rim)), var(--dsh-tb-cast-1); }
    `
    expect(judgementOf(planted).orderWrong).toEqual(['.paperLift:hover'])
  })

  it('正确的那一版必须放行（判据不能把对的也报出来）', () => {
    const clean = `
      .paperSheet { box-shadow: var(--dsh-tb-paper-cast, var(--dsh-tb-rim)), var(--dsh-tb-paper-lift, var(--dsh-tb-cast-1)); }
      .paperLift:hover { box-shadow: var(--dsh-tb-paper-cast, var(--dsh-tb-rim)), var(--dsh-tb-cast-2); }
      .paperLift:active { box-shadow: var(--dsh-tb-paper-cast, var(--dsh-tb-rim)), var(--dsh-tb-cast-1); }
    `
    const verdict = judgementOf(clean)
    expect(verdict.castMissing).toEqual([])
    expect(verdict.orderWrong).toEqual([])
  })
})
