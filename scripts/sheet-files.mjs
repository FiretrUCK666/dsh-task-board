#!/usr/bin/env node
/**
 * 客户端样式表的**唯一发现处**：走目录，不列名字。
 *
 * ── 为什么不能写名单 ────────────────────────────────────────────────────────
 *
 * 三张门禁（悬浮、装饰、滚动地板）曾经各自写着一份 5 项的名单。仓库现在有 7 张
 * `*.module.css`——也就是说这三条门禁**各自漏了 2 张表**，而漏掉的那两张里就有
 * `gallery.module.css`（预览页自己的表，里面有 hover 规则、有 box-shadow、有
 * overflow）。新加一张表更是从诞生那一刻起就没被任何人检查过。
 *
 * 名单只会在写它的那一天是对的。**目录会一直对。** 这与 `verify-design-docs.mjs`
 * 的做法是同一条（它早就走目录了），此处只是把那件对的事挪到一处共用，而不是让三
 * 个脚本各抄一遍——抄一份的代价不是那几行，是**加一张表时要记得改三处**。
 *
 * ── 只收客户端 ──────────────────────────────────────────────────────────────
 *
 * 走 `src/client`，跳过 `node_modules` / `lib` / `dist` 与点开头的目录。宿主契约、
 * 构建脚本这些不在这条判据的范围里。
 */

import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * 客户端半区的全部 `*.module.css`，按路径排序（顺序稳定，输出可比对）。
 * @param root - 仓库根目录。
 * @returns 绝对路径数组；目录不存在时返回空数组。
 */
export function clientSheets(root) {
  const seen = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist' || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (entry.name.endsWith('.module.css')) seen.push(full)
    }
  }
  walk(join(root, 'src', 'client'))
  return seen.sort()
}

/**
 * 与 {@link clientSheets} 同，但每一项带上是「相对仓库根、正斜杠」的路径——
 * 门禁输出里要能直接点到文件。
 * @param root - 仓库根目录。
 * @returns `{ path, rel }` 数组。
 */
export function clientSheetFiles(root) {
  return clientSheets(root).map((path) => ({ path, rel: relative(root, path).replace(/\\/g, '/') }))
}
