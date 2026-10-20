/**
 * 两个半区不许互相伸手。
 *
 * ── 这一道门禁为什么存在 ───────────────────────────────────────────────────────
 *
 * host 半区在 DSH 主进程里，client 半区在浏览器里，**两者不共享运行时**。
 * client 伸手去 host，浏览器就要加载一段 Node 代码；host 伸手去 client，
 * 主进程就要加载一段带 DOM 的代码。两种都在很晚的地方才炸。
 *
 * 而更常见的形状是**抄**：host 侧有一份类型，client 侧抄一份——那不报错，
 * 于是两边各有一份「更新结果」，模型改一处、界面不改。
 * **抄**由「一个家」那道门禁管（`verify-one-implementation.mjs`），
 * 本条管**依赖方向**。
 *
 * ── 判据读结构，不读字样 ───────────────────────────────────────────────────────
 *
 * 扫描先剥注释再匹配；判的是**解析后的路径落在哪一半**，
 * 不是 import 语句长什么样。`src/core/` 是两边共用的纯逻辑层，两边都 import 它
 * 是**对的**（那正是它存在的理由）。
 *
 * ── 自证 ────────────────────────────────────────────────────────────────────
 *
 * 喂一份假面证明它会咬：client 伸手去 host 必须被抓；import core 必须放行。
 */

import { describe, expect, it } from 'vitest'
import {
  boundaryViolations,
  halfOf,
  importsOf,
} from '../scripts/verify-client-host-boundary.mjs'

describe('两个半区不许互相伸手', () => {
  it('半区由路径决定', () => {
    expect(halfOf('src/client/panel.ts')).toBe('client')
    expect(halfOf('src/host/route.ts')).toBe('host')
    expect(halfOf('src/core/thing.ts')).toBe('core')
    expect(halfOf('src/index.ts')).toBe('other')
  })

  it('剥注释之后再认 import——说明里提到 import 不算一次 import', () => {
    const imports = importsOf([
      "// import { x } from '../host/thing'",
      '/* import { y } from "../host/other" */',
      "import { z } from '../core/thing'",
    ].join('\n'))
    expect(imports.map((i) => i.spec)).toEqual(['../core/thing'])
  })

  it('client 伸手去 host——必须被抓住', () => {
    const found = boundaryViolations([
      { file: 'src/client/panel.ts', text: "import { x } from '../host/thing'\n" },
    ])
    expect(found).toHaveLength(1)
    expect(found[0].from).toBe('client')
    expect(found[0].to).toBe('host')
  })

  it('host 伸手去 client——必须被抓住', () => {
    const found = boundaryViolations([
      { file: 'src/host/route.ts', text: "import { x } from '../client/thing'\n" },
    ])
    expect(found).toHaveLength(1)
    expect(found[0].from).toBe('host')
  })

  it('两边都 import core——放行', () => {
    const found = boundaryViolations([
      { file: 'src/client/panel.ts', text: "import { x } from '../core/thing'\n" },
      { file: 'src/host/route.ts', text: "import { y } from '../core/thing'\n" },
    ])
    expect(found).toHaveLength(0)
  })

  it('各半区在自己内部 import——放行', () => {
    const found = boundaryViolations([
      { file: 'src/client/a.ts', text: "import { x } from './b'\n" },
      { file: 'src/host/c.ts', text: "import { y } from './d'\n" },
    ])
    expect(found).toHaveLength(0)
  })
})
