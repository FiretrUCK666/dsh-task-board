/**
 * 完全没人用的东西不许留在那儿。
 *
 * ── 这一道门禁为什么存在 ───────────────────────────────────────────────────────
 *
 * 一个没人用的导出**不会报任何错**——它既不碍编译，也不碍运行。
 * 但它的代价是**骗人**：读的人以为「这个东西有定义」，去查它，查到一份**没人维护**的拷贝；
 * 于是下一个要改它的人，改的是那份没人读的。
 *
 * 这正是「删一个词是那次改名的一部分」那条规矩的机械后半截。
 *
 * ── 判据读结构，不读字样 ───────────────────────────────────────────────────────
 *
 * 扫描先剥注释再匹配——一段说明里提到那个名字不算一次引用。
 * 数的是**全部文件**里的出现次数，**扣掉它自己那处声明**。
 *
 * ── 一条必须豁免的：棘轮 ──────────────────────────────────────────────────────
 *
 * 紧挨着 `@ts-expect-error` 的声明**不是**死代码：它是**故意写错**的载荷
 * （`item-transitions.ts` 的 `REFUSED_BY_THE_RULING_TABLE`），
 * 它的作用是让「模型允许写某个字段」这件事**变成构建失败**。
 * 把它当死代码删掉，棘轮就哑了——退化从此静悄悄地漏下去。
 * 这条豁免是**结构**的（读 TypeScript 的指令），不是散文里的字样。
 *
 * ── 自证 ────────────────────────────────────────────────────────────────────
 *
 * 喂一份假面证明它会咬：没人用的导出必须被抓；有人用的必须放行；
 * 棘轮必须放行。
 */

import { describe, expect, it } from 'vitest'
import {
  deadExports,
  ENTRY_FILES,
  exportsOf,
  isRatchet,
  mentionsOf,
} from '../scripts/verify-dead-export.mjs'

describe('没人用的导出是死代码', () => {
  it('数出现次数——剥注释之后才算', () => {
    const code = '// const ghost = 1\nconst real = 2\n'
    expect(mentionsOf(code, 'ghost')).toBe(0)
    expect(mentionsOf(code, 'real')).toBe(1)
  })

  it('没人用的导出——被抓', () => {
    const dead = deadExports([
      { file: 'src/a.ts', text: 'export function nobody() {\n  return 1\n}\n' },
      { file: 'src/b.ts', text: 'export function somebody() {\n  return 2\n}\n' },
      { file: 'src/c.ts', text: 'import { somebody } from "./b"\nsomebody()\n' },
    ])
    expect(dead).toHaveLength(1)
    expect(dead[0].name).toBe('nobody')
  })

  it('只在本文件里用的导出——不是死代码（它只是不必要地导出了）', () => {
    const dead = deadExports([
      {
        file: 'src/a.ts',
        text: 'export function local() {\n  return 1\n}\nconst value = local\nvoid value\n',
      },
    ])
    expect(dead).toHaveLength(0)
  })

  it('入口文件的导出不算——它就是包对外的界面', () => {
    expect(ENTRY_FILES.has('src/index.ts')).toBe(true)
    const dead = deadExports([
      { file: 'src/index.ts', text: 'export function publicApi() {\n  return 1\n}\n' },
    ])
    expect(dead).toHaveLength(0)
  })

  it('棘轮（紧挨着 @ts-expect-error）——不是死代码', () => {
    const source = [
      '// @ts-expect-error `ref` is ruled `derived`',
      'export const REFUSED_BY_THE_RULING_TABLE: ItemPatch = { ref: 3 }',
    ].join('\n')
    expect(isRatchet(source.split('\n'), 1)).toBe(true)
    expect(exportsOf(source).map((e) => e.name)).toEqual([])
    const dead = deadExports([{ file: 'src/core/item-transitions.ts', text: source }])
    expect(dead).toHaveLength(0)
  })

  it('没有 @ts-expect-error 的那一行不算棘轮', () => {
    const source = ['export const plain = 1'].join('\n')
    expect(isRatchet(source.split('\n'), 0)).toBe(false)
    expect(exportsOf(source).map((e) => e.name)).toEqual(['plain'])
  })
})
