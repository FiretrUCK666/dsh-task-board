#!/usr/bin/env node
/**
 * **localStorage 的键不得改名。** 它们是用户已经存下的数据。
 *
 * ── 为什么这条必须单独一条门禁 ──────────────────────────────────────────────
 *
 * `AGENTS.md` 的硬性规范 5 写得很重：「`dsh.taskBoard.v1` 不得改名。同步模式下
 * 这些键是离线镜像 / 草稿 / preSync 备份，回退模式下它们就是真相——两种模式下
 * 用户数据都不因升级丢失。」
 *
 * 而这条规矩**此前没有任何门禁守着**。`scripts/` 里搜 `dsh.taskBoard` 零命中；
 * 测试里只有两处按**字面量**用到它：
 *
 *   - `tests/store.spec.ts` 把 `'dsh.taskBoard.v1'` 当参数**传进去**；
 *   - `tests/board-transport.spec.ts` 断言镜像键**不等于**它。
 *
 * 两处都拦不住改名：把源码里的常量改成新名字，测试里的字面量不会跟着变，于是
 * 测试仍然绿、用户数据却错位——而屏上不会有任何声音。这正是那种「改了不报错」
 * 的形状，也是这条门禁存在的全部理由。
 *
 * ── 判据 ────────────────────────────────────────────────────────────────────
 *
 * 下面那张 `KEYS` 表是**声明**，不是从代码里爬出来的：一份自动派生的清单不可能
 * 发现「某个键被改名了」——派生出来的永远是当前的样子，改名在它看来只是变成了
 * 另一个合法的名字。
 *
 * 所以判两个方向：
 *
 *   1. **清单里的每个键，`src/` 里必须还有人在用**——改名或删除会掉出这一半；
 *   2. **`src/` 里出现的每个 `dsh.taskBoard*` 键，清单里必须有**——新加一个键
 *      必须回来登记，否则它将来改名时没人守。
 *
 * 两个方向都读字节：键名在源码里以字符串字面量出现（`'dsh.taskBoard.xxx'`）。
 *
 * ── 改名时怎么办 ────────────────────────────────────────────────────────────
 *
 * 键**可以**改，但必须连带做迁移（读旧键、写新键、删旧键），并在同一张表里留下
 * 旧名到新名的记录（`RENAMED`）。只改字符串而不迁移，就是这条门禁要挡的那件事。
 *
 * 用法：`node scripts/verify-storage-keys.mjs [根目录]`
 * 自测：`--probe-missing`（清单里有、代码里没有 → 必须红）
 *       `--probe-unlisted`（代码里有、清单里没有 → 必须红）
 *       `--probe-clean`（两边一致 → 必须放行）
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeOf } from './probe-args.mjs'
import { stripSourceComments } from './source-core.mjs'

/**
 * 全部 localStorage 键。**这份表是声明，不是从代码派生的**（见头注释）。
 *
 * 键名与用途一一对应：加一个键就在这儿加一行；改名要连带迁移并写进 `RENAMED`。
 */
export const KEYS = {
  'dsh.taskBoard.v1': '看板台账的离线镜像 / 回退模式下的真相',
  'dsh.taskBoard.items.v1': '任务清单的离线镜像（与台账各一份，只备一份等于丢一份）',
  'dsh.taskBoard.preSync.v1': '首次连上 host 时本地副本的一次性备份',
  'dsh.taskBoard.cruise.v1': '自动巡航的开关与时段',
  'dsh.taskBoard.presets.v1': '定时预设',
  'dsh.taskBoard.runPresets.v1': '运行配置预设',
  'dsh.taskBoard.templates.v1': '任务模板',
  'dsh.taskBoard.drafts.v1': '草稿槽',
  'dsh.taskBoard.itemView.v1': '清单面板的视图偏好',
  'dsh.taskBoard.sessionAgents.v1': '会话与 Agent 的对照',
  'dsh.taskBoard.bundleReload.v1': '陈旧 bundle 的一次性重载守卫',
}

/**
 * 改过名的键：旧 → 新。
 *
 * **只允许往里加，不许删。** 一条记录消失，就分不清「这个键从来没改过名」和
 * 「它改过名、而记录被抹掉了」——而后者正是迁移代码必须留着的东西。
 */
export const RENAMED = {}

/** 一个键的字面量在源码里的写法。 */
const KEY_LITERAL = /['"`](dsh\.taskBoard[.\w]*)['"`]/g

/**
 * `src/` 下所有 .ts/.tsx 的源码文本，**注释已剥掉**。
 *
 * 剥注释是承重的（硬性规范 14）：这个仓库的注释里到处引用着这些键名来解释
 * 「镜像的键是清单自己那一个」之类的事。按原文匹配会把**说明**读成**使用**——
 * 实测过：把 `items.v1` 改名之后，`src/core/host-sync.ts` 里那行注释仍然让
 * 「清单里有、代码里没有」这一路报不出来，于是改名只被抓到一半。
 *
 * @param root - 仓库根。
 * @returns `{ rel, text }`，text 是去注释后的代码。
 */
function sourceTexts(root) {
  const out = []
  const walk = dir => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      out.push({
        rel: full.slice(root.length + 1).split('\\').join('/'),
        text: stripSourceComments(readFileSync(full, 'utf8')),
      })
    }
  }
  walk(join(root, 'src'))
  return out
}

/**
 * 跑一遍判据。
 * @param root - 仓库根。
 * @param keys - 声明的键表（自测时可注入）。
 * @returns 两个方向的违规。
 */
export function findings(root, keys = KEYS) {
  const declared = new Set(Object.keys(keys))
  const seen = new Map()
  for (const file of sourceTexts(root)) {
    for (const match of file.text.matchAll(KEY_LITERAL)) {
      const key = match[1]
      if (!seen.has(key)) seen.set(key, [])
      seen.get(key).push(file.rel)
    }
  }

  /* 方向一：声明了，但代码里一个字节都没有——它被改名或删掉了。
     这正是用户数据会错位的那个方向：旧键还躺在用户的 localStorage 里，
     而代码已经在读写另一个名字。 */
  const wantButMissing = [...declared].filter(key => !seen.has(key))

  /* 方向二：代码里用了，却没在清单里登记——新键逃过了这条守护，
     将来它改名时没有任何东西会红。旧名（RENAMED 的键）不算：那是迁移代码
     在读它，而「还读旧名」正是迁移该做的事。 */
  const usedButUndeclared = [...seen.keys()].filter(key =>
    !declared.has(key) && !Object.hasOwn(RENAMED, key))

  return { wantButMissing, usedButUndeclared, seenCount: seen.size }
}

function main() {
  const root = resolve(process.argv[2] ?? '.')
  const probe = probeOf(['--probe-missing', '--probe-unlisted', '--probe-clean'])

  if (probe !== undefined) {
    /* 自测喂的是**内存里的键表**，不是磁盘上的常量：改真实文件再改回来证的是
       「改动生效」，不是「门禁会红」（硬性规范 16）。 */
    const cases = {
      '--probe-missing': {
        keys: { ...KEYS, 'dsh.taskBoard.renamedByAccident.v1': '一个只写在清单里、代码里已经没有的键' },
        want: 'wantButMissing',
        why: '清单里有、代码里没有 → 说明它被改名或删掉了，而用户数据还在旧名下',
      },
      '--probe-unlisted': {
        keys: Object.fromEntries(Object.entries(KEYS).filter(([name]) => name !== 'dsh.taskBoard.v1')),
        want: 'usedButUndeclared',
        why: '代码里有、清单里没有 → 新键逃过了这条守护',
      },
      '--probe-clean': {
        keys: KEYS,
        want: 'none',
        why: '两边一致 → 放行',
      },
    }[probe]

    const result = findings(root, cases.keys)
    const hit = cases.want === 'none'
      ? result.wantButMissing.length === 0 && result.usedButUndeclared.length === 0
      : result[cases.want].length > 0
    if (!hit) {
      console.error(`verify-storage-keys self-test FAILED（${probe}）：${cases.want} 这一路没有报出来`)
      console.error(`  ${cases.why}`)
      process.exit(1)
    }
    console.log(`OK 自测（${probe}）：${cases.want} 这一路读对了（门禁是活的）。`)
    return
  }

  const { wantButMissing, usedButUndeclared, seenCount } = findings(root)
  if (seenCount === 0) {
    console.error('FAIL 一个 localStorage 键都没读到——判据没读任何东西，不能报 OK。')
    process.exit(1)
  }
  if (wantButMissing.length === 0 && usedButUndeclared.length === 0) {
    console.log(`verify-storage-keys OK: ${String(Object.keys(KEYS).length)} 个键与源码一致`
      + `（${String(seenCount)} 个键在代码里被用着）；改名会在这条门禁上红。`)
    return
  }
  if (wantButMissing.length > 0) {
    console.error(`FAIL 这些键在清单里、源码里却找不到（${String(wantButMissing.length)} 个）——它们被改名或删掉了，而用户数据还在旧名下：`)
    for (const key of wantButMissing) console.error(`  - ${key}（${KEYS[key]}）`)
    console.error('  改法：把键改回去；确实要改就在 scripts/verify-storage-keys.mjs 的 RENAMED 里登记旧名→新名，并写迁移（读旧键、写新键、删旧键）。')
  }
  if (usedButUndeclared.length > 0) {
    console.error(`FAIL 这些键在源码里被用、却没登记（${String(usedButUndeclared.length)} 个）——它们将来改名时没人守：`)
    for (const key of usedButUndeclared) console.error(`  - ${key}`)
    console.error('  改法：加进 scripts/verify-storage-keys.mjs 的 KEYS 并写清它存什么。')
  }
  process.exit(1)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
