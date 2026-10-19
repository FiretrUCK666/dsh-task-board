/**
 * 量墨的**唯一实现**。三个测量脚本共用它。
 *
 * 为什么要合并：先前有三个脚本，各自实现「找墨」，结果三处不一致——
 * 而「量法不一致」这件事本身比「量错了」更坏：结论会互相矛盾，于是每次都像在
 * 抽签。**量法只有一处，才谈得上「量出来的数可信」。**
 *
 * ── 「墨」到底是什么 ────────────────────────────────────────────────────────
 *
 * 读者看到的是**字形**，不是描边。胶囊有一圈发丝描边（`--dsh-tb-border`：文字色 14%，
 * 在白底上约 #dcdcdc），而胶囊底色约 #f3f3f3（亮度 243）——两者只差 23。
 * 早期版本用「比背景暗 28」当阈值，**描边正好落在阈值内侧**，于是量到的是一圈边框，
 * 不是字。表里「墨的上下沿 = 盒子的上下沿」就是这个错误暴露出来的痕迹。
 *
 * 所以判据是两条：
 *   1. **纵向缩进两行**，把上下那两条描边排除掉（它们横贯整条边，是唯一会污染
 *      上下沿的像素；左右两条描边只占一列，不影响上下沿）。
 *   2. **阈值取「背景 − 60」**：字形与底色的亮度差在 100 以上（深灰字约 40~110，
 *      底色 243），而发丝描边只差 20 出头。60 是把两者分开的宽裕余量。
 */

const fs = require('fs')
const zlib = require('zlib')

/** 解 PNG：只支持 8 位 RGB / RGBA（截图都是这两种）。 */
function decodePng(file) {
  const buf = fs.readFileSync(file)
  let width = 0, height = 0, colorType = 0
  const idat = []
  let offset = 8
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  const ch = colorType === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const st = width * ch
  const out = Buffer.alloc(width * height * ch)
  let pos = 0, prev = Buffer.alloc(st)
  for (let y = 0; y < height; y++) {
    const f = raw[pos++]
    const line = Buffer.from(raw.subarray(pos, pos + st)); pos += st
    for (let x = 0; x < st; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0
      let v = line[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      }
      line[x] = v & 255
    }
    line.copy(out, y * st); prev = line
  }
  return {
    width, height,
    lum(x, y) {
      const i = (y * width + x) * ch
      return 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]
    },
    /** 原始三通道：认「用户画的红色标注圈」这类**有色**的东西时要用。 */
    rgb(x, y) {
      const i = (y * width + x) * ch
      return [out[i], out[i + 1], out[i + 2]]
    },
  }
}

/** 描边与字形之间的亮度余量：60 把发丝描边（差约 20）挡在外面。 */
const INK_MARGIN = 60

/**
 * 上下各缩进几 CSS 像素，用来排除横贯整条边的描边。
 *
 * 数值不是拍脑袋来的。胶囊的描边是 1px，渲染成 **2 行设备像素**，外加一行抗锯齿残留
 * （实测：`.itemOpt` 的顶边在 css 346/346.5 是实边，347 是残留，亮度只比底色低 20 出头）。
 * 只缩进 1 CSS 像素会把残留留下——于是「墨的范围」等于「盒子的范围」，
 * 而**描边不动**，所以无论令牌怎么变，量出来都不动。
 *
 * 2 CSS 像素把实边与残留一起排掉。胶囊最矮 20px，缩进后还剩 16px，而 12px 的汉字
 * 墨高约 11px——仍然整段落在窗口里。
 */
const EDGE_INSET_CSS = 2

/**
 * 在一个矩形里找字形墨迹的上下沿。
 *
 * @param dpr - 设备像素比；缩进按 CSS 像素算，所以在不同倍率的屏上量法一致。
 * @returns `{top, bottom}`（设备像素），没有墨时 `null`。
 */
function inkSpan(img, x0, x1, y0, y1, dpr = 1) {
  if (x1 <= x0 || y1 <= y0) return null
  const lums = []
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) lums.push(img.lum(x, y))
  if (lums.length === 0) return null
  lums.sort((a, b) => a - b)
  const bg = lums[Math.floor(lums.length / 2)]
  const threshold = bg - INK_MARGIN

  const inset = Math.round(EDGE_INSET_CSS * dpr)
  /* 横向也要缩进：胶囊的**左右竖边**在每一行都有暗像素，只缩进纵向的话，
     每一行都会被判成「有墨」，量出来的范围就等于盒子本身——而描边不动，
     于是无论令牌怎么变，读数都不变（实测 `.itemOpt` 的墨范围恰好等于缩进窗口）。 */
  const fromX = x0 + inset
  const toX = x1 - inset
  const from = y0 + inset
  const to = y1 - inset
  if (to < from || toX < fromX) return null
  let top = -1, bottom = -1
  for (let y = from; y <= to; y++) {
    let dark = 0
    for (let x = fromX; x <= toX; x++) if (img.lum(x, y) < threshold) dark++
    if (dark >= 1) { if (top < 0) top = y; bottom = y }
  }
  return top < 0 ? null : { top, bottom, background: bg, threshold }
}

/**
 * 一枚盒子里的墨，相对**内容盒**中心偏了多少（CSS 像素，正 = 偏下）。
 *
 * 基准是内容盒中心而不是边框盒中心：标题类盒子有不对称的上下内衬
 * （pad 2/6），拿边框中心比会得到一个并不存在的偏移。
 */
function inkOffset(img, box, dpr) {
  const x0 = Math.max(0, Math.round(box.left * dpr))
  const x1 = Math.min(img.width - 1, Math.round((box.left + box.width) * dpr) - 1)
  const y0 = Math.max(0, Math.round(box.top * dpr))
  const y1 = Math.min(img.height - 1, Math.round((box.top + box.height) * dpr) - 1)
  const span = inkSpan(img, x0, x1, y0, y1, dpr)
  if (span === null) return null
  const padTop = parseFloat(box.padBlock.split('/')[0]) || 0
  const padBottom = parseFloat(box.padBlock.split('/')[1]) || 0
  const contentMid = (y0 + padTop * dpr + y1 - padBottom * dpr) / 2
  const inkMid = (span.top + span.bottom + 1) / 2
  return {
    offset: Math.round(((inkMid - contentMid) / dpr) * 100) / 100,
    inkTop: span.top / dpr,
    inkBottom: span.bottom / dpr,
    boxTop: y0 / dpr,
    boxBottom: y1 / dpr,
  }
}

module.exports = { decodePng, inkSpan, inkOffset, INK_MARGIN, EDGE_INSET_CSS }
