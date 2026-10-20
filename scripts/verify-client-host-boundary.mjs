#!/usr/bin/env node
/**
 * **两个半区不许互相伸手。**
 *
 * ── 为什么要有这条 ──────────────────────────────────────────────────────────
 *
 * 这个插件跑在两个地方：host 半区在 DSH 主进程里，client 半区在浏览器里。
 * 两者**不共享运行时**——client 那份 bundle 打进浏览器，host 那份打进 Node。
 * 所以：
 *
 *   · **client import host** ⇒ 浏览器要加载一段 Node 代码（`node:fs` 之类的）——
 *     要么打包炸掉，要么运行时报错；
 *   · **host import client** ⇒ 主进程要加载一段带 DOM 的代码——
 *     同样炸，而且更晚才炸。
 *
 * 更要紧的是**概念上的倒置**：host 侧的一份类型被 client 抄了一份（不是 import，
 * 是抄），于是两边各有一份「更新结果」——模型改一处，界面不改。
 * 那种是两个家，**由「一个家」那道门禁守**（`verify-one-implementation.mjs`）。
 * 本条守的是**依赖方向**。
 *
 * ── 唯一的例外 ──────────────────────────────────────────────────────────────
 *
 * `src/core/` 是两边共用的纯逻辑层，**两边都可以 import 它**——
 * 那正是它存在的理由。
 *
 * ── 判据读结构，不读字样 ────────────────────────────────────────────────────
 *
 * 扫描**先剥注释再匹配**（一段说明里提到 `import` 不算一次 import）。
 * 判的是**解析后的路径落在哪一半**，不是 import 语句长什么样。
 *
 * @module dsh-task-board/scripts/verify-client-host-boundary
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { probeOf } from './probe-args.mjs'
import { stripSourceComments } from './source-core.mjs'

/**
 * 半区判定：文件路径落在哪一半。
 * @param {string} rel - 相对仓库根的路径。
 * @returns {'client' | 'host' | 'core' | 'other'}
 */
export function halfOf(rel) {
  const p = rel.split(sep).join('/')
  if (p.startsWith('src/client/')) return 'client'
  if (p.startsWith('src/host/')) return 'host'
  if (p.startsWith('src/core/')) return 'core'
  return 'other'
}

/**
 * 取一个文件里的 import 目标（只取相对路径的那种——包名 import 不归本条管）。
 *
 * @param {string} text - 文件原文。
 * @returns {{spec: string, line: number}[]}
 */
export function importsOf(text) {
  const code = stripSourceComments(text)
  const out = []
  const lines = code.split('\n')
  for (const [index, line] of lines.entries()) {
    const m = /(?:^|\s)(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/.exec(line)
    if (m) out.push({ spec: m[1], line: index + 1 })
  }
  return out
}

/**
 * 找出「越了半区」的 import。
 *
 * @param {{file: string, text: string}[]} files - 待查的文件。
 * @returns {{file: string, line: number, spec: string, from: string, to: string}[]}
 */
export function boundaryViolations(files) {
  const out = []
  for (const file of files) {
    const from = halfOf(file.file)
    if (from !== 'client' && from !== 'host') continue
    for (const imp of importsOf(file.text)) {
      if (!imp.spec.startsWith('.')) continue
      const abs = resolve(dirname(join(process.cwd(), file.file)), imp.spec)
      const rel = relative(process.cwd(), abs).split(sep).join('/')
      const to = halfOf(rel)
      if (to !== 'client' && to !== 'host') continue
      if (to === from) continue
      out.push({ file: file.file, line: imp.line, spec: imp.spec, from, to })
    }
  }
  return out
}

/**
 * 递归列目录下的 .ts / .tsx。
 * @param {string} dir
 * @returns {string[]}
 */
export function tsFilesOf(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsFilesOf(p))
    else if (/\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

function main() {
  const probe = probeOf(['--probe-cross', '--probe-core'])
  const root = resolve(process.argv[2] ?? '.')

  if (probe === '--probe-cross') {
    // 自测：client 伸手去 host —— 必须被抓住。
    const fake = [{ file: 'src/client/panel.ts', text: "import { x } from '../host/thing'\n" }]
    if (boundaryViolations(fake).length !== 1) {
      console.error('FAIL 自测：client 伸手去 host 没被抓住')
      process.exit(1)
    }
    console.log('OK 自测：client 伸手去 host 被抓住。')
    return
  }
  if (probe === '--probe-core') {
    // 自测：两边都 import core —— 必须放行。
    const fake = [{ file: 'src/client/panel.ts', text: "import { x } from '../../core/thing'\n" }]
    if (boundaryViolations(fake).length !== 0) {
      console.error('FAIL 自测：import core 被误伤')
      process.exit(1)
    }
    console.log('OK 自测：import core 放行。')
    return
  }

  const files = tsFilesOf(join(root, 'src')).map((p) => ({
    file: relative(root, p).split(sep).join('/'),
    text: readFileSync(p, 'utf8'),
  }))
  const violations = boundaryViolations(files)
  if (violations.length === 0) {
    console.log(`verify-client-host-boundary OK: ${String(files.length)} 个文件，0 处越界。`)
    return
  }
  console.error(`FAIL ${String(violations.length)} 处越了半区：`)
  for (const v of violations) {
    console.error(`  ${v.file}:${String(v.line)}  ${v.from} → ${v.to}：${v.spec}`)
  }
  console.error('')
  console.error('  两个半区不共享运行时：client 打进浏览器，host 打进 Node。')
  console.error('  两边都要用的东西，放进 src/core/——那正是它存在的理由。')
  console.error('  只有一边的，就留在那一半，不要跨过去抄一份。')
  process.exit(1)
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  main()
}
