const fs = require('fs')
const zlib = require('zlib')

function decodePng(file) {
  const buf = fs.readFileSync(file)
  let width = 0, height = 0, colorType = 0
  const idat = []
  let offset = 8
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9] }
    else if (type === 'IDAT') idat.push(data)
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
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c) }
      line[x] = v & 255
    }
    line.copy(out, y * st); prev = line
  }
  return { width, height, lum(x, y) { const i = (y * width + x) * ch; return 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2] } }
}

const [, , pngPath, x0s, x1s] = process.argv
const x0 = Number(x0s)
const x1 = Number(x1s)
const img = decodePng(pngPath)

/* 空白行 = 行与行之间的白；非空白行组成一条带 = 一枚按钮 */
const nonWhite = []
for (let y = 0; y < img.height; y++) {
  let n = 0
  for (let x = x0; x <= x1; x++) if (img.lum(x, y) < 250) n++
  nonWhite.push(n)
}

const bands = []
let s = -1
for (let y = 0; y < img.height; y++) {
  const on = nonWhite[y] > 2
  if (on && s < 0) s = y
  else if (!on && s >= 0) { bands.push([s, y - 1]); s = -1 }
}
if (s >= 0) bands.push([s, img.height - 1])

console.log(`${pngPath.split(/[\\/]/).pop()}  x=${x0}..${x1}  bands ${bands.length}`)
for (const [top, bottom] of bands) {
  if (bottom - top < 20) continue
  let iTop = -1, iBot = -1
  for (let y = top; y <= bottom; y++) {
    let ink = 0
    for (let x = x0; x <= x1; x++) if (img.lum(x, y) < 140) ink++
    if (ink >= 2) { if (iTop < 0) iTop = y; iBot = y }
  }
  if (iTop < 0) continue
  const bMid = (top + bottom + 1) / 2
  const iMid = (iTop + iBot + 1) / 2
  console.log(`  box ${top}..${bottom} mid ${bMid.toFixed(1)}  ink ${iTop}..${iBot} mid ${iMid.toFixed(1)}  delta ${(iMid - bMid).toFixed(1)}`)
}
