const fs = require('fs')
const path = require('path')
const { decodePng } = require('./ink-measure.cjs')

/**
 * 在**用户的截图**里量「墨的上下沿相对盒心」。
 *
 * 两种墨心判据：
 *   - `extent`：墨的最上一行与最下一行的中点（**含抗锯齿淡边**）；
 *   - `core`：密度达到峰值一半的那一段的中点（丢掉两端的淡边）。
 *
 * 两条都量，是为了看出**用户看到的是哪一个**——用户说「待审核对齐、待规划偏上」，
 * 那么哪一种判据能把这两枚分开，哪一种就是用户眼睛用的那把尺子。
 *
 * 盒子的定位：**从上下两端往里找第一条「几乎占满整行」的行**——那是描边；
 * 中间那段是字，不参与定位。（从中间找会把字当成描边。）
 *
 * 用法：node measure-chip-extent.cjs <png> <x0> <x1> <y0> <y1> [名称]
 */

const [, , pngPath, x0s, x1s, y0s, y1s, name] = process.argv
const img = decodePng(pngPath)
const x0 = Number(x0s), x1 = Number(x1s), y0 = Number(y0s), y1 = Number(y1s)
const band = x1 - x0 + 1

const rows = []
for (let y = y0; y <= y1; y++) {
  let dark = 0
  let faint = 0
  let min = 255
  for (let x = x0; x <= x1; x++) {
    const [r, g, b] = img.rgb(x, y)
    /* 排除用户画的红色标注圈。 */
    if (r > g + 30 && r > b + 30) continue
    const l = 0.299 * r + 0.587 * g + 0.114 * b
    if (l < min) min = l
    if (l < 240) faint++
    if (l < 210) dark++
  }
  rows.push({ y, dark, faint, min })
}

const full = (one) => one.faint > band * 0.7
const topBorder = rows.find(full)
const bottomBorder = [...rows].reverse().find(full)
if (topBorder === undefined || bottomBorder === undefined) {
  console.log(`${name}: 找不到描边`)
  process.exit(0)
}
const boxTop = topBorder.y
const boxBottom = bottomBorder.y

const ink = rows.filter((one) => one.y > boxTop && one.y < boxBottom && one.min < 210)
if (ink.length === 0) {
  console.log(`${name}: 没有墨`)
  process.exit(0)
}
const extentTop = ink[0].y
const extentBottom = ink[ink.length - 1].y
const peak = Math.max(...ink.map((one) => one.dark))
const core = ink.filter((one) => one.dark >= peak * 0.5)
const coreTop = core[0].y
const coreBottom = core[core.length - 1].y

const boxMid = (boxTop + boxBottom) / 2
console.log(
  `${(name ?? '').padEnd(16)} 盒 ${boxTop}..${boxBottom} 心 ${boxMid.toFixed(1)}`
  + `  墨沿 ${extentTop}..${extentBottom} 偏 ${(((extentTop + extentBottom) / 2) - boxMid).toFixed(1)}`
  + `  核心 ${coreTop}..${coreBottom} 偏 ${(((coreTop + coreBottom) / 2) - boxMid).toFixed(1)}`,
)
