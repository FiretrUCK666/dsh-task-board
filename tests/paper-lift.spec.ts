/**
 * 纸面抬起的**状态契约**：悬停 / 按下 / 焦点三态都必须保留静止态的那两笔材质。
 *
 * 为什么这条要单独一个 spec：这是一个**只在两个主题下不同地暴露**的缺陷。
 * `.paperLift:hover` 曾经写成 `box-shadow: var(--dsh-tb-rim), var(--dsh-tb-cast-2)`，
 * 把整条影子替换掉——于是消费者写进 `--dsh-tb-paper-cast` 的那圈边（浅色下是 14%
 * 的墨环）在悬停时消失。
 *
 * 读者看到的两种描述其实是同一件事：浅色下「卡片上半部分变糊、看不出分界」，
 * 暗色下「左右两边和下面的灰边不见了」。**同一个错误在两个主题下不同地暴露**，
 * 所以只按一个主题验会漏掉它——这也正是它上一次躲过检查的原因。
 *
 * 判据读结构：这三条规则的 `box-shadow` 里必须出现 `--dsh-tb-paper-cast`。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = readFileSync(join(process.cwd(), 'src/client/design/base.module.css'), 'utf8')

/** 一张表里某条规则（按选择器前置匹配）的规则体，剥掉注释。 */
function ruleOf(selector: string): string | undefined {
  const bare = BASE.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const block of bare.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
    if (block[1].includes(selector)) return block[2]
  }
  return undefined
}

describe('纸面抬起：三态都保留静止态的那两笔材质', () => {
  it('悬停 / 被选中 的那一档带着消费者写进来的那圈边', () => {
    const rule = ruleOf('.paperLift:hover')
    expect(rule, '`.paperLift:hover` 那条规则不见了').toBeDefined()
    expect(rule, '抬起时把整条影子替换掉了——消费者那圈边会在悬停时消失（浅色下变糊、暗色下三面灰边不见）')
      .toContain('var(--dsh-tb-paper-cast')
    /* 只换投影那一笔：更远那一档在，静止那一档不该同时留着。 */
    expect(rule, '抬起时没有换成更远的那一档投影').toContain('var(--dsh-tb-cast-2)')
  })

  it('按下回位也带着那圈边（否则「一按边界就没了」）', () => {
    const rule = ruleOf('.paperLift:active')
    expect(rule, '`.paperLift:active` 那条规则不见了').toBeDefined()
    expect(rule, '按下时那圈边消失了——按下去边界一闪').toContain('var(--dsh-tb-paper-cast')
  })

  it('静止态与抬起态的材质表达式逐字同构（同一个槽、同一个顺序）', () => {
    /* 两条规则读同一个槽、槽在前、投影在后。顺序反了不会报错，但在有多笔阴影时
       读者看到的层次是反的（边被画在影上面）。
       判据按**出现次序**读，不写一条会长歪的正则：`--dsh-tb-paper-cast` 必须在前，
       `--dsh-tb-cast-N` 必须在后，且两者都在同一条 `box-shadow` 里。 */
    const shadowOf = (selector: string): string => {
      const body = ruleOf(selector) ?? ''
      const at = body.indexOf('box-shadow')
      expect(at, `${selector} 没有 box-shadow`).toBeGreaterThanOrEqual(0)
      return body.slice(at)
    }
    for (const selector of ['.paperSheet', '.paperLift:hover', '.paperLift:active']) {
      const shadow = shadowOf(selector)
      const cast = shadow.indexOf('--dsh-tb-paper-cast')
      const lift = shadow.search(/--dsh-tb-cast-\d/)
      expect(cast, `${selector}: 没有 consumer 那圈边（--dsh-tb-paper-cast）`).toBeGreaterThanOrEqual(0)
      expect(lift, `${selector}: 没有投影（--dsh-tb-cast-N）`).toBeGreaterThanOrEqual(0)
      expect(cast, `${selector}: 边与投影的先后次序与静止态不一致`).toBeLessThan(lift)
    }
  })
})
