// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { INK_SHIFT_TOKEN, applyInkShift, inkShiftRef, measureInkShiftEm } from '../src/client/ink-shift.ts'

/* 墨心修正：**量在读者自己的浏览器里，写在面板根上，读在两个样式表的胶囊族里。**
 *
 * 真的偏移量不出在 jsdom（没有布局），那由 `pnpm audit` 在真 Chromium 上逐颗胶囊量
 * （`scripts/probe-item-capsules.js`）。这一份钉的是**接线与三态**：没有布局时量不出来、
 * 量不出来时不写、写出去的东西永远是一个 em 数、令牌名进命名矩阵，以及**两个样式表都在读它**
 * ——最后一条才是「模块还在而消费端被删掉」不会静默的那一半。 */

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

// jsdom 环境里 `import.meta.url` 是 http 的（vitest 给 jsdom 一个 http 基址），所以两份样式表
// 按**仓库相对路径**读——cwd 就是仓库根，与 `scripts/*.mjs` 读它们的方式一致。
const boardSheet = stripComments(readFileSync('src/client/board.module.css', 'utf8'))
const itemSheet = stripComments(readFileSync('src/client/item/item.module.css', 'utf8'))

describe('墨心修正：一个令牌，两端都有人', () => {
  it('没有布局就分到「没量到」那一档，而且不抛', () => {
    // jsdom 没有布局：行盒与基线都不存在，量出来的任何数都是假的。这一档必须是 null，
    // 而不是一个 0——写 0 会把「没量」画成「不用动」。
    expect(measureInkShiftEm('sans-serif')).toBeNull()
    const root = document.createElement('div')
    expect(() => applyInkShift(root)).not.toThrow()
    expect(root.style.getPropertyValue(INK_SHIFT_TOKEN)).toBe('')
  })

  it('写出去的永远是一个 em 数', () => {
    // 一个 NaN 或一个 px 值会让整族胶囊跟着偏，而屏上不会有人说一句话。
    const root = document.createElement('div')
    root.style.setProperty(INK_SHIFT_TOKEN, '-0.09em')
    expect(() => applyInkShift(root)).not.toThrow()
    const written = root.style.getPropertyValue(INK_SHIFT_TOKEN)
    expect(written === '' || /^-?\d+(\.\d+)?em$/.test(written)).toBe(true)
  })

  it('ref 回调拿到 null 时不动任何东西', () => {
    expect(() => inkShiftRef(null)).not.toThrow()
  })

  it('令牌名进命名矩阵：本层前缀 + 语义名', () => {
    expect(INK_SHIFT_TOKEN).toBe('--dsh-tb-ink-shift')
  })

  it('两个样式表都在读它，而且只在修正自己那几处读', () => {
    // 令牌只有三类合法读法：胶囊族的两条块向内衬（字落到盒心）、那一列珠子挂靠的行盒位置
    // （珠子跟着墨走）、以及记号把那一格还回去的那条 `translate`（记号本来就在盒心上）。
    // 多出来的第四类位置意味着有人在别处又读了一次——那正是「同一个数散成好几处」的开头。
    const allowed = /^(padding-block-(start|end):|--item-bead-top:|translate:)/
    for (const [name, sheet] of [['board', boardSheet], ['item', itemSheet]] as const) {
      const uses = sheet.split('\n').filter((line) => line.includes(INK_SHIFT_TOKEN))
      expect(uses.length, `${name} 表读令牌的次数`).toBeGreaterThan(1)
      expect(uses.every((line) => allowed.test(line.trim())), `${name} 表只在修正自己那几处读`).toBe(true)
    }
  })

  it('三个日期那一列：珠子、线头、线尾读同一个数，标题自己声明行盒', () => {
    // 珠子是**盒子的几何**（不认字体），标题的墨跟着基线走（认字体）。两边要对齐，几何那一侧
    // 就必须有一个不认字体的参照：标题声明行盒，珠子由「半个行盒减半个珠子」推出。
    expect(itemSheet).toMatch(/--item-bead-top: calc\(3\.5px - var\(--dsh-tb-ink-shift, 0em\)\)/)
    expect(itemSheet).toMatch(/\.itemDateAxis li > i \{[^}]*inset-block-start: var\(--item-bead-top\)/)
    expect(itemSheet).toMatch(/\.itemDateAxis li > b \{[^}]*line-height: 16px/)
  })

  it('声明了内衬就必须配一条「内容盒装得下」的地板', () => {
    // 内衬会吃掉内容盒：这条修正按 em 加块向内衬，而胶囊各自有定高，所以「装得下」只能由
    // 审计逐颗量（`contentBox >= lineBox`）。这里钉的是判据还在——删掉它，修正就会静默地
    // 把一行字挤出它的盒子。
    const probe = readFileSync('scripts/probe-item-capsules.js', 'utf8')
    expect(probe).toContain('contentBox')
    expect(probe).toMatch(/contentBox < floor - FLOOR_SLACK/)
  })
})
