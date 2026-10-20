#!/usr/bin/env node
/**
 * 造工件：把**被审的那几页**写出来，供人截图或量。
 *
 * ── 它解决的是什么 ──────────────────────────────────────────────────────────
 *
 * `audit-panels.mjs` 自己不会生成工件：它量你给它的那几页 HTML。那几页由台架写
 * （`DSH_PANEL_HTML=<路径> vitest run …`），所以直接跑审计最常见的两种结果是
 * 「量了一张四小时前的旧页」和「目录里没有 tb-*.html，exit 2」。两种都不会说一句
 * 「我其实没量到现在这份代码」。
 *
 * 于是「对齐有没有坏」这件事**从来没有进入过闭环**：它是唯一真正量墨心与盒心距离的
 * 东西（静态门禁只能读写法，读不出结果），却要人记得先造工件、再造对工件、再跑。
 *
 * ── 两件它保证的事 ──────────────────────────────────────────────────────────
 *
 *   1. **被审的是哪几页，由 `audit-pages.mjs` 一处定义**（那里是唯一的名单），这里只
 *      引用它。每一页由**它自己的 spec** 写出来（`DSH_PANEL_HTML` 指到工件目录），
 *      造完检查文件存在且非空——一份 4 字节的 HTML 是「spec 跑了但没写页」，不是绿。
 *   2. **目录先清空。** 上一轮留下的页**不许**留在目录里：量到旧页等于量到一个已经
 *      不存在的实现，而报告看上去与量到的一样（这个项目已经栽过一次）。
 *
 * 写完之后这一批页**留在原地**并把路径打出来——它们是给人看的（截图）与给量器用的
 * （`node scripts/audit-panels.mjs --dir tmp/audit-pages`）。
 *
 * ── 它不要浏览器 ────────────────────────────────────────────────────────────
 *
 * 这一步只写文件。量那一步在 `audit-panels.mjs` 里，而那一步才需要一台真 Chromium
 * （没有时它**明说 SKIP**，不假装量过）。
 */

import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateAuditPages } from './audit-pages.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const argv = process.argv.slice(2)
const outAt = argv.indexOf('--out')
const dir = outAt >= 0 && argv[outAt + 1] !== undefined ? resolve(argv[outAt + 1]) : join(ROOT, 'tmp/audit-pages')

/* **先清空**：旧的那一批不许留下来。 */
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

let pages = []
try {
  pages = generateAuditPages(dir)
} catch (error) {
  console.error(`${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

console.log(`audit: ${pages.length} page(s) written to ${dir}`)
for (const one of pages) console.log(`  ${one}`)
