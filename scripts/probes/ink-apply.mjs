#!/usr/bin/env node
/**
 * **端到端验收**：真模块 → 真浏览器 → 真像素。
 *
 * 三段都是真的：
 *   1. **模块是真的**：`src/client/design/ink-metrics.ts` 用项目自己的 TypeScript
 *      转译成一段脚本，注入页面执行。探针**不重写**那套算法——它调的是真代码。
 *   2. **浏览器是真的**：真 Chromium（`shot-panel` 开的那一个）。
 *   3. **残差是像素量的**：截图之后逐行数暗像素，量墨的上下沿落在盒子的哪里。
 *      这一段**不含**任何来自模块的算术——它是对「墨到底在哪」的独立观测。
 *
 * 判据是「墨的上下沿的中点」相对**胶囊边框盒**中心的偏差：那个判据与**用户自己的
 * 截图**同源（`measure-chip-extent.cjs`）——用户说「待审核对齐、待规划偏上」时，
 * 正是这个判据复现了那句话。
 *
 * 用法：
 *   node scripts/probes/ink-apply.mjs <html> <选择器> [--dpr 2]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import { decodePng } from './ink-measure.cjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

/** 把 TypeScript 源码转成一段能直接在页面里跑的 IIFE，挂到 `window.__dshInk`。 */
function buildBrowserModule() {
  const source = readFileSync(resolve(ROOT, 'src/client/design/ink-metrics.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: 'ink-metrics.ts',
  }).outputText
  /* ESM 的 `export` 在页面里没有意义：去掉它，把要用的挂到 window 上。 */
  const body = compiled.replace(/^export\s+/gm, '')
  return `(() => {\n${body}\nwindow.__dshInk = { applyInkShifts, installInkMetrics }\n})()`
}

/** 注入页面的那一段：装上真模块，然后把每一枚的盒与字的位置记下来。 */
const PROBE_BODY = `
(() => {
  /* **先校正，再记**——记的是校正之后的样子（内衬改了内容盒，盒也跟着变）。 */
  const written = window.__dshInk.applyInkShifts(document.body)
  const rows = []
  for (const element of document.querySelectorAll('*')) {
    const style = getComputedStyle(element)
    if (style.getPropertyValue('--dsh-tb-optical-target').trim() !== '1') continue
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0) continue
    let holder = element
    const hasOwn = [...element.childNodes]
      .some((node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== '')
    if (!hasOwn) {
      holder = [...element.querySelectorAll('*')].find((one) =>
        [...one.childNodes].some((node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== ''))
      if (holder === undefined) continue
    }
    const text = (holder.textContent ?? '').trim()
    if (text === '') continue
    const range = document.createRange()
    range.selectNodeContents(holder)
    const lines = [...range.getClientRects()].filter((one) => one.height > 0)
    if (lines.length === 0) continue
    rows.push({
      text: text.slice(0, 10),
      boxTop: rect.top, boxBottom: rect.bottom,
      textLeft: lines[0].left, textRight: lines[0].right,
      shift: element.style.getPropertyValue('--dsh-tb-optical-shift'),
    })
    if (rows.length >= 40) break
  }
  return JSON.stringify({ rows, written })
})()
`

/** 墨的上下沿（像素，含抗锯齿淡边），在给定的横向区间里。 */
function inkExtent(img, row, dpr) {
  const x0 = Math.round(row.textLeft * dpr)
  const x1 = Math.round(row.textRight * dpr)
  const y0 = Math.round(row.boxTop * dpr) - 3
  const y1 = Math.round(row.boxBottom * dpr) + 3
  if (x1 - x0 < 2 || y1 - y0 < 2) return null
  const lums = []
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) lums.push(img.lum(x, y))
  if (lums.length === 0) return null
  lums.sort((a, b) => a - b)
  const bg = lums[Math.floor(lums.length / 2)]
  let top = -1
  let bottom = -1
  for (let y = y0; y < y1; y += 1) {
    let dark = 0
    for (let x = x0; x < x1; x += 1) if (img.lum(x, y) < bg - 25) dark += 1
    /* 描边行：整条带子都是暗的，剔掉。 */
    if (dark >= (x1 - x0) * 0.95) continue
    if (dark === 0) continue
    if (top < 0) top = y
    bottom = y
  }
  if (top < 0) return null
  return { top, bottom, mid: (top + bottom + 1) / 2 / dpr }
}

function main() {
  const args = process.argv.slice(2)
  const html = args[0]
  const dprIndex = args.indexOf('--dpr')
  const dpr = dprIndex >= 0 ? Number(args[dprIndex + 1]) : 2
  if (html === undefined) {
    console.error('usage: node ink-apply.mjs <html> [--dpr 2]')
    process.exit(2)
  }

  const evalPath = join(ROOT, '.design/ink-apply-probe.js')
  mkdirSync(join(ROOT, '.design'), { recursive: true })
  writeFileSync(evalPath, `${buildBrowserModule()}\n;\n${PROBE_BODY}\n`, 'utf8')

  const png = join(ROOT, '.design/ink-apply.png')
  const shot = spawnSync(process.execPath, [
    join(ROOT, 'scripts/shot-panel.mjs'),
    '--out', png,
    '--url', pathToFileURL(resolve(html)).href,
    '--width', '1440', '--height', '900',
    '--scale', String(dpr),
    '--wait', '1200',
    '--eval-file', evalPath,
  ], { encoding: 'utf8' })

  const all = `${shot.stdout ?? ''}\n${shot.stderr ?? ''}`
  const line = all.split('\n').find((one) => one.includes('--eval ->'))
  if (line === undefined) {
    console.error('ink-apply: 探针没有输出。')
    console.error(all.split('\n').slice(-10).join('\n'))
    process.exit(1)
  }
  const payload = JSON.parse(line.slice(line.indexOf('--eval ->') + 9).trim())
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload

  const img = decodePng(png)
  const rows = []
  for (const row of data.rows) {
    const ink = inkExtent(img, row, dpr)
    if (ink === null) continue
    const boxMid = (row.boxTop + row.boxBottom) / 2
    rows.push({
      text: row.text,
      shift: row.shift,
      offset: Number((ink.mid - boxMid).toFixed(2)),
    })
  }

  const offsets = rows.map((one) => Math.abs(one.offset))
  const worst = offsets.length === 0 ? null : Math.max(...offsets)
  const over = rows.filter((one) => Math.abs(one.offset) > 0.5)

  console.log(`量到 ${rows.length} 枚  写入了 ${data.written} 枚  最差残差 ${worst === null ? '-' : worst.toFixed(2)}px`)
  console.log(`超过 0.5px 的：${over.length} 枚`)
  for (const one of over.slice(0, 12)) {
    console.log(`  ${one.text.padEnd(12)} 残差 ${String(one.offset).padEnd(6)} shift ${one.shift}`)
  }
  writeFileSync(join(ROOT, '.design/ink-apply.json'),
    `${JSON.stringify({ rows, worst }, null, 2)}\n`, 'utf8')
}

main()
