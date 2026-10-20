#!/usr/bin/env node
/**
 * 被审页集的**唯一定义**，以及它们怎么被造出来。
 *
 * ── 为什么它住在自己的一份文件里，而不是某一份脚本的顶上 ──────────────────────
 *
 * 被审的那几页要**两处**用得上：`audit-render.mjs` 造它们，`audit-panels.mjs` 量它们。
 * 两处各写一份名单，代价不是那几行，是**改一处不报错**——名单加了一页，量器还在量
 * 旧的那几页，而报告里每页都打着大小与修改时间，看上去一切正常（硬性规范 17：
 * 一个概念只有一套词汇，别的地方导入，不抄）。
 *
 * 所以名单在这里，两处都导入它。**这一份是定义处；别处只准引用。**
 *
 * ── 一条 spec 可以写出好几页 ──────────────────────────────────────────────────
 *
 * 看板那一条 spec 写两张：一张失败态、一张「应用托管」那一档；更新弹层那条写三张。
 * 它们是**同一条 spec 的产物**，所以它们的归属由**写它们的那条 spec**决定，而不是由
 * 谁长得像谁来：一张页属于「`tb-dialog` 这一族」，而这一族由那一条 spec 写出来。
 * 命名约定是 `<stem>.html` 与它的变体 `<stem>.<variant>.html`——**从磁盘上读出来**
 * 的，不是抄在本子里的（抄在本子里的那份迟早与 spec 脱节，而脱节的方向永远是
 * 「spec 多写了一页、审计没看见」）。
 *
 * ── 造工件的那一步在哪儿 ──────────────────────────────────────────────────────
 *
 * 每一页由**它自己的 spec** 写出来（`DSH_PANEL_HTML=<路径>`），造完检查文件存在且
 * 非空：一份几字节的 HTML 是「spec 跑了但没写页」，不是绿。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/**
 * 被审的每一页：**文件名词干** + **写它的 spec**（+ 可选的用例名过滤）。
 *
 * `grep` 是必要的，不是可选的：看板那一条 spec 里还有别的用例也会写页（弹层那一档），
 * 不加过滤，造出来的那张页会被后来的用例覆盖成另一个现场——**量到的就不是这一页了**。
 */
export const AUDIT_PAGES = [
  { stem: 'tb-items', spec: 'tests/item-workbench.spec.ts' },
  { stem: 'tb-home', spec: 'tests/home-panel.spec.ts' },
  { stem: 'tb-board', spec: 'tests/board-panel.spec.ts', grep: 'writes the board page when DSH_PANEL_HTML names a path' },
  /* 设计系统展页：它把系统里有什么一次摆出来，于是**每一件**标本都是真的组件——
   * 那一页量到的错位与别处一样是真错位。 */
  { stem: 'tb-gallery', spec: 'tests/gallery.spec.ts' },
  /* 更新弹层：一条 spec 写三张（失败态 / 应用托管 / 什么都没变），它们是一族。 */
  { stem: 'tb-dialog', spec: 'tests/board-panel.spec.ts', grep: 'writes the dialog page when DSH_PANEL_HTML names a path' },
]

/**
 * 一族页在磁盘上的所有文件：`<stem>.html` 与它的变体 `<stem>.<variant>.html`。
 *
 * 变体是**找出来的**，不是写下来的：spec 多写一张页，这一份就多认一张；
 * spec 少写一张，这一份就少认一张——两边的差在报告里看得见（`缺页`）。
 * @param {string} dir - 那一族页所在的目录。
 * @param {string} stem - 词干。
 * @returns {string[]} 文件名数组（按字典序）。
 */
export function auditPageFiles(dir, stem) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name === `${stem}.html` || (name.startsWith(`${stem}.`) && name.endsWith('.html')))
    .sort()
}

/**
 * 把被审的那几页造出来。
 *
 * 每一页由它自己的 spec 写；**造完检查它真的写出来了**（存在、且不是几字节）。
 * @param {string} dir - 工件页的目录（不存在会被造出来）。
 * @returns {string[]} 造出来的每一页的绝对路径。
 * @throws {Error} 哪一页没造出来时抛出——**造不出来就不许量**（量一张旧页等于量一个
 *   已经不存在的实现，而报告看上去与量到的一样）。
 */
export function generateAuditPages(dir) {
  const pages = []
  for (const page of AUDIT_PAGES) {
    const target = join(dir, `${page.stem}.html`)
    const argv = ['run', page.spec]
    if (page.grep !== undefined) argv.push('-t', page.grep)
    /* **直接用 node 执行 vitest 的入口**，绕开 shell 与 Windows 上的 `.cmd` 垫片：
     * 垫片不经过 shell 就根本启动不了，`status` 会是 null，而 null 会被读成
     * 「spec 失败了」——一次工具调用方式的问题被误报成代码问题。 */
    const entry = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
    const result = spawnSync(process.execPath, [entry, ...argv], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DSH_PANEL_HTML: target },
      stdio: 'pipe',
    })
    if ((result.status ?? 1) !== 0) {
      const tail = `${result.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n')
      throw new Error(`FAIL ${page.spec} 没能写出工件页（exit ${result.status}）：这一页不会被量。\n${tail}`)
    }
    /* **一份几字节的 HTML 不是一页。** spec 可以「跑过」而什么都没写（过滤没命中、
     * 或者环境变量没传下去），那时审计会去量一个空文档并报一堆 no-reading——那看起来
     * 像排版坏了，其实是工件没造出来。 */
    if (!existsSync(target) || statSync(target).size < 50_000) {
      throw new Error(`FAIL ${page.stem}.html 没有写出可用的页（${existsSync(target) ? `${statSync(target).size} bytes` : '缺文件'}）`)
    }
    const family = auditPageFiles(dir, page.stem)
    for (const name of family) pages.push(join(dir, name))
  }
  return pages
}
