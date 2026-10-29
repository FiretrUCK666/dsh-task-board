/**
 * 光标的**状态契约**：行是按钮所以是手，展开区里的空白是箭头。
 *
 * 为什么这条要单独一个 spec：读者报的是「点击展开之后，那些白色空白区域上鼠标一直
 * 是手掌」。根因是 `.itemRow` 写了 `cursor: pointer`，而展开区（`.itemDetail`）
 * 长在行**里面**，于是继承了那只手——但展开区自己吃掉点击冒泡（`row-line.tsx`），
 * 空白处按下去只会把整行收起来。**手形光标是一句「这里能按」的承诺**，空白处不该
 * 作这个承诺。
 *
 * 这种缺陷任何截图都读不出来（光标不进截图），只有计算值能。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ITEM = readFileSync(join(process.cwd(), 'src/client/item/item.module.css'), 'utf8')

/** 一张表里某条规则（按选择器前置匹配）的规则体，剥掉注释。 */
function ruleOf(css: string, selector: string): string | undefined {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const block of bare.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
    if (block[1].includes(selector)) return block[2]
  }
  return undefined
}

describe('任务的展开区：空白处不该是手', () => {
  it('行本身声明手（它确实是「按一下开关」的按钮）', () => {
    const row = ruleOf(ITEM, '.itemRow {') ?? ruleOf(ITEM, '.itemRow')
    expect(row, '`.itemRow` 那条规则没读到').toBeDefined()
    expect(row, '行本身不是手了——它明明是按一下开合的按钮').toContain('cursor: pointer')
  })

  it('展开区把光标改回箭头', () => {
    const detail = ruleOf(ITEM, '.itemRow > .itemDetail')
    expect(detail, '`.itemRow > .itemDetail` 那条规则没读到').toBeDefined()
    expect(
      detail,
      '展开区没有重置光标——空白处会继承行的手，读者以为那里能按（按下去只是把整行收起来）',
    ).toMatch(/cursor:\s*(default|auto)/)
  })

  it('展开区里真正可点的件仍然声明手（重置只改默认值）', () => {
    /* 这一条守的是「不要把重置做成全局的」：可点的件各自写 `cursor: pointer`，
       所以把 `.itemDetail` 改成箭头之后它们仍然是手。这里只要求**至少有一处**
       可点件自己声明了手，证明这条链路没被一刀切掉。 */
    const pointerDeclarations = [...ITEM.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/cursor:\s*pointer/g)].length
    expect(pointerDeclarations, '整张表里一处 pointer 都没有——重置被写成了一刀切').toBeGreaterThan(3)
  })
})
