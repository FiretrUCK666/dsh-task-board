/**
 * 「localStorage 的键不得改名」——**这道门禁自己必须会红**。
 *
 * ── 为什么这条自证必须存在 ──────────────────────────────────────────────────
 *
 * `AGENTS.md` 的硬性规范 5 说这些键不得改名，因为两种模式下用户数据都挂在它们
 * 名下。而在此之前，`scripts/` 里搜 `dsh.taskBoard` 是零命中——这条规矩只写在
 * 文档里，没有任何东西守着它。测试里那两处按字面量用到它的地方也拦不住改名：
 * 源码里的常量换了个名字，测试里的字面量不会跟着变，于是测试仍然绿。
 *
 * 所以「这条门禁真的会红」必须有可复跑的证明，而证明要落在**两个方向**上：
 *
 *   1. 声明的键从源码里消失（改名/删除）→ 红：用户数据还在旧名下；
 *   2. 源码里冒出没登记的键 → 红：它将来改名时没人守。
 *
 * 这里喂的是**注入的键表**，不是磁盘上的常量：改真实文件再改回来证的是「改动
 * 生效」，而这条判据是纯函数，传一张表就能证（硬性规范 16）。
 */
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { findings, KEYS } from '../scripts/verify-storage-keys.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

describe('the storage-key gate reads both directions', () => {
  it('the real repository agrees with the declaration', () => {
    const { wantButMissing, usedButUndeclared, seenCount } = findings(ROOT)
    expect(seenCount, 'no storage key was read at all — the scan is broken, not the keys').toBeGreaterThan(5)
    expect(wantButMissing, 'a declared key vanished from the source — user data still lives under the old name')
      .toEqual([])
    expect(usedButUndeclared, 'a key the source uses is not declared — nothing will guard it when it is renamed')
      .toEqual([])
  })

  it('a declared key that no longer appears is reported', () => {
    // 方向一。多声明一个代码里没有的键，等价于「某个键被改名了」。
    const injected = { ...KEYS, 'dsh.taskBoard.vanishedByRename.v1': 'a key that only exists in the declaration' }
    const { wantButMissing } = findings(ROOT, injected)
    expect(wantButMissing, 'the declaration lists a key the source never touches — that is what a rename looks like from here')
      .toEqual(['dsh.taskBoard.vanishedByRename.v1'])
  })

  it('a key the source uses but the declaration omits is reported', () => {
    // 方向二。从声明里拿掉一个真实存在的键，等价于「代码里冒出一个没登记的键」。
    const injected = Object.fromEntries(
      Object.entries(KEYS).filter(([name]) => name !== 'dsh.taskBoard.v1'),
    )
    const { usedButUndeclared } = findings(ROOT, injected)
    expect(usedButUndeclared, 'the source mentions a key the declaration dropped — a new key would slip through the same hole')
      .toContain('dsh.taskBoard.v1')
  })

  it('the ledger key and the checklist key are both declared — they are two documents', () => {
    // 这两份各存一半真相，只备一份等于丢一份；所以两个名字都必须在这张表上。
    expect(Object.keys(KEYS)).toContain('dsh.taskBoard.v1')
    expect(Object.keys(KEYS)).toContain('dsh.taskBoard.items.v1')
  })

  it('comments are not uses (the explanation must not count as the code)', () => {
    // 实测过：`src/core/host-sync.ts` 的注释里提到镜像键，按原文匹配会让
    // 「键消失了」这一路报不出来——改名只被抓到一半。硬性规范 14。
    const { wantButMissing } = findings(ROOT)
    expect(wantButMissing, 'a key mentioned only in prose must not count as a live key').toEqual([])
  })
})
