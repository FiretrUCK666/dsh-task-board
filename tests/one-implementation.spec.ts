/**
 * 一个名字只能有一个家。
 *
 * ── 这一道门禁为什么存在 ───────────────────────────────────────────────────────
 *
 * 这个项目里最贵的一种债不是「写错了」，是**「同一个东西有两个家」**：清单页把
 * 看板那一份**抄**进自己的样式表，抄的时候顺手改了一个数，于是按声明体判重的门禁
 * 没报，从此两份各改各的——**屏幕上没有任何一处会说明为什么**。
 *
 * 所以这道门禁判的是**归属**（这个名字有几个家），不是**长相**（两个家写得像不像）：
 * 同名同体（一定是拷贝）与同名异体（同一个名字两个家）都要报。
 *
 * ── 判据读结构，不读字样 ───────────────────────────────────────────────────────
 *
 * 扫描**先剥注释再匹配**：注释里出现一个名字不算一次定义（否则一段说明就能把
 * 门禁骗绿）。归一化只去空白，不去代码本身——所以「两份逐字相同」是结构事实。
 *
 * 豁免只有一份显式名单（cordis 定的插件入口名 `inject` / `apply`），
 * 那是**声明**，不是字样启发。
 *
 * ── 自证 ────────────────────────────────────────────────────────────────────
 *
 * 每一道判据都要**喂一份假面证明它会咬**（硬性规范 16）：造出两份一样的东西
 * 塞进去，门禁必须报；造出两份不同的东西，门禁必须放行。
 */

import { describe, expect, it } from 'vitest'
import {
  checkAdditionRecords,
  declarationsOf,
  duplicateHomes,
  EXEMPT_NAMES,
  spansHalves,
} from '../scripts/verify-one-implementation.mjs'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 造一份假仓库：给定「路径 → 内容」两张表，落在一个临时目录里。 */
function fakeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-one-impl-'))
  for (const [path, text] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, text, 'utf8')
  }
  return dir
}

describe('一个名字只能有一个家', () => {
  it('剥注释之后再认声明——注释里提到名字不算一次定义', () => {
    const decls = declarationsOf([
      '// export function hidden() {}',
      '/* export function alsoHidden() {} */',
      'export function real() { return 1 }',
    ].join('\n'))
    expect(decls.map((d) => d.name)).toEqual(['real'])
  })

  it('两份逐字相同——那是一份拷贝，必须报', () => {
    const found = duplicateHomes([
      { file: 'src/a.ts', text: 'export function same(x: number) {\n  return x + 1\n}\n' },
      { file: 'src/b.ts', text: 'export function same(x: number) {\n  return x + 1\n}\n' },
    ])
    expect(found).toHaveLength(1)
    expect(found[0].name).toBe('same')
    expect(found[0].same).toBe(true)
  })

  it('同名但写法不同——同一个名字两个家，也要报', () => {
    const found = duplicateHomes([
      { file: 'src/a.ts', text: 'export function twin(x: number) {\n  return x + 1\n}\n' },
      { file: 'src/b.ts', text: 'export function twin(x: number) {\n  return x + 2\n}\n' },
    ])
    expect(found).toHaveLength(1)
    expect(found[0].same).toBe(false)
  })

  it('两个不同的名字不算重复', () => {
    const found = duplicateHomes([
      { file: 'src/a.ts', text: 'export function one() {\n  return 1\n}\n' },
      { file: 'src/b.ts', text: 'export function two() {\n  return 2\n}\n' },
    ])
    expect(found).toHaveLength(0)
  })

  it('豁免表里的名字（框架定的插件入口）不报', () => {
    expect(EXEMPT_NAMES.has('inject')).toBe(true)
    expect(EXEMPT_NAMES.has('apply')).toBe(true)
    const found = duplicateHomes([
      { file: 'src/index.ts', text: "export const inject = ['webServer']\n" },
      { file: 'src/client/index.ts', text: "export const inject = ['slots']\n" },
    ])
    expect(found).toHaveLength(0)
  })

  it('跨半区的多个家要标出来——模型那份和界面那份必须说同一句话', () => {
    const homes = [
      { file: 'src/client/update-source.ts' },
      { file: 'src/host/update-route.ts' },
    ]
    expect(spansHalves(homes)).toBe(true)
    expect(spansHalves([{ file: 'src/core/a.ts' }, { file: 'src/core/b.ts' }])).toBe(false)
    expect(spansHalves([{ file: 'src/client/a.ts' }, { file: 'src/core/b.ts' }])).toBe(true)
  })
})

describe('新增登记的四个字段', () => {
  it('四个字段齐全、且「最接近的既有」与「单元」都真的存在——通过', () => {
    const dir = fakeRepo({
      'src/core/thing.ts': 'export const thing = 1\n',
      'src/client/design/thing.ts': 'export const Thing = 1\n',
      'src/client/design/addition-records.ts': [
        'export const ADDITION_RECORDS = [',
        '  {',
        "    unit: 'src/client/design/thing.ts —— 一个新东西',",
        "    nearest: 'src/core/thing.ts',",
        "    whyNot: '它住在 core 里，而这里要的是界面那一侧的形态。',",
        "    askedBy: '用户明确要求',",
        '  },',
        ']',
      ].join('\n'),
    })
    const result = checkAdditionRecords(dir)
    expect(result.problems).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('「为什么不能用」空着即红——说不出就是没查过', () => {
    const dir = fakeRepo({
      'src/core/thing.ts': 'export const thing = 1\n',
      'src/client/design/addition-records.ts': [
        'export const ADDITION_RECORDS = [',
        '  {',
        "    unit: 'src/client/design/thing.ts',",
        "    nearest: 'src/core/thing.ts',",
        "    whyNot: '',",
        "    askedBy: '用户明确要求',",
        '  },',
        ']',
      ].join('\n'),
    })
    const result = checkAdditionRecords(dir)
    expect(result.ok).toBe(false)
    expect(result.problems.join()).toContain('为什么不能用')
  })

  it('「最接近的既有」指着不存在的文件——即红', () => {
    const dir = fakeRepo({
      'src/client/design/addition-records.ts': [
        'export const ADDITION_RECORDS = [',
        '  {',
        "    unit: 'src/client/design/thing.ts',",
        "    nearest: 'src/core/never-existed.ts',",
        "    whyNot: '它不提供我要的那一半。',",
        "    askedBy: '用户明确要求',",
        '  },',
        ']',
      ].join('\n'),
    })
    const result = checkAdditionRecords(dir)
    expect(result.ok).toBe(false)
    expect(result.problems.join()).toContain('真实存在')
  })

  it('一张记录都没有——即红', () => {
    const dir = fakeRepo({
      'src/client/design/addition-records.ts': 'export const ADDITION_RECORDS = []\n',
    })
    const result = checkAdditionRecords(dir)
    expect(result.ok).toBe(false)
  })
})
