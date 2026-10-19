#!/usr/bin/env node
/**
 * **内衬 → 渲染出来的墨，搬了多少**：一次扫完。
 *
 * 这是整套机制的地基那一条关系。以前它是用一个「探针」量的，而那个探针量的是
 * 胶囊的**描边**（描边不动，于是读数不动），所以量出来的「1px 等于没校正」是假的。
 * 这一次量的是**字**：把同一枚字在不同的内衬下各截一张图，量**墨的上下沿**。
 *
 * 量出来的东西回答三件事：
 *   1. 内衬与墨的位移是不是线性的；
 *   2. 是不是隔一段才有反应（基线被吸附到像素栅格）；
 *   3. **哪一个内衬让墨正落在盒心**——那就是要发布的那个值。
 *
 * 用法：node ink-sweep.mjs <html> <选择器> [内衬...]
 */

import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { decodePng } from './ink-measure.cjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')

const [, , html, pick, ...moves] = process.argv
if (html === undefined || pick === undefined) {
  console.error('usage: node ink-sweep.mjs <html> <选择器> [内衬...]')
  process.exit(2)
}
const pads = moves.length > 0 ? moves : ['0', '0.25', '0.5', '0.75', '1', '1.25', '1.5', '2', '3', '4']

const PROBE = `
(() => {
  const params = new URLSearchParams(location.search)
  const token = params.get('token')
  if (token !== null) {
    document.documentElement.style.setProperty('--dsh-tb-optical-drop', token)
    void document.body.offsetHeight
  }
  const rows = []
  for (const element of document.querySelectorAll(${JSON.stringify(pick)})) {
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
    })
    if (rows.length >= 3) break
  }
  return JSON.stringify({ rows })
})()
`

/** 墨的上下沿（像素），在给定的横向区间里。 */
function inkExtent(img, row, dpr) {
  const x0 = Math.round(row.textLeft * dpr)
  const x1 = Math.round(row.textRight * dpr)
  const y0 = Math.round(row.boxTop * dpr) - 3
  const y1 = Math.round(row.boxBottom * dpr) + 3
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
    if (dark >= (x1 - x0) * 0.95) continue
    if (dark === 0) continue
    if (top < 0) top = y
    bottom = y
  }
  if (top < 0) return null
  return { top, bottom, mid: (top + bottom + 1) / 2 / dpr }
}

mkdirSync(join(ROOT, '.design'), { recursive: true })
const probePath = join(ROOT, '.design/ink-sweep-probe.js')
writeFileSync(probePath, PROBE, 'utf8')

const dpr = 2
const png = join(ROOT, '.design/ink-sweep.png')

console.log(`${pick}   内衬 → 墨心（相对边框盒心，正 = 偏下）`)
console.log('内衬(px)'.padEnd(11), '文字'.padEnd(11), '墨上沿'.padEnd(9), '墨心偏移'.padEnd(10), '相对上一档')
console.log('-'.repeat(62))
let previous = null
for (const pad of pads) {
  const url = `${pathToFileURL(resolve(html)).href}?token=${encodeURIComponent(`${pad}px`)}`
  const shot = spawnSync(process.execPath, [
    join(ROOT, 'scripts/shot-panel.mjs'),
    '--out', png, '--url', url,
    '--width', '1440', '--height', '900', '--scale', String(dpr),
    '--wait', '800', '--eval-file', probePath,
  ], { encoding: 'utf8' })
  const line = `${shot.stdout ?? ''}\n${shot.stderr ?? ''}`.split('\n')
    .find((one) => one.includes('--eval ->'))
  if (line === undefined) {
    console.error(`pad ${pad}: 探针没有输出`)
    continue
  }
  const payload = JSON.parse(line.slice(line.indexOf('--eval ->') + 9).trim())
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload
  const img = decodePng(png)
  for (const row of data.rows) {
    const ink = inkExtent(img, row, dpr)
    if (ink === null) continue
    const boxMid = (row.boxTop + row.boxBottom) / 2
    const offset = ink.mid - boxMid
    const delta = previous === null ? '—' : (offset - previous).toFixed(2)
    console.log(
      pad.padEnd(11),
      row.text.padEnd(11),
      String(ink.top).padEnd(9),
      offset.toFixed(2).padEnd(10),
      delta,
    )
    previous = offset
  }
}
