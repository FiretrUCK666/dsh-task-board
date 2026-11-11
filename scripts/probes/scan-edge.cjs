// 一条竖直的分界线，在每一行上的 x 到底一样吗？
//
// 「分界被弄坏了」这种报告最可能的样子是：那条线在某一行**跳了一下**——上下两段的 x
// 不同，于是读作「两条边」。肉眼在缩略图上看不出来，逐行扫一遍就一目了然。
//
// 用法：
//   node scripts/probes/scan-edge.cjs <png> --y 100 900 --x 700 1000 [--expect 866]
//
// 输出每一行那条边所在的 x（取该行在 x 窗口里横向色差最大的位置），以及全段的极差。
// 极差为 0 或 1（像素是整数）说明这条线是直的。
const fs = require('node:fs')
const zlib = require('node:zlib')

function decodePng(buffer) {
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const chunks = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
    } else if (type === 'IDAT') {
      chunks.push(data)
    }
    offset += 12 + length
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks))
  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  let position = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position]
    position += 1
    const line = raw.subarray(position, position + stride)
    position += stride
    const target = out.subarray(y * stride, (y + 1) * stride)
    const previous = y === 0 ? null : out.subarray((y - 1) * stride, y * stride)
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? target[x - channels] : 0
      const up = previous === null ? 0 : previous[x]
      const upLeft = previous !== null && x >= channels ? previous[x - channels] : 0
      let value = line[x]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += Math.floor((left + up) / 2)
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        value += (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft)
      }
      target[x] = value & 0xff
    }
  }
  return { width, height, channels, pixels: out }
}

const args = process.argv.slice(2)
const file = args[0]
const numberAfter = (flag, fallback) => {
  const index = args.indexOf(flag)
  return index >= 0 && args[index + 1] !== undefined ? Number(args[index + 1]) : fallback
}
if (file === undefined) {
  console.error('用法：node scripts/probes/scan-edge.cjs <png> --y 100 900 --x 700 1000')
  process.exit(2)
}
const y0 = numberAfter('--y', 0)
const y1Index = args.indexOf('--y')
const y1 = y1Index >= 0 ? Number(args[y1Index + 2]) : y0
const x0 = numberAfter('--x', 0)
const x1Index = args.indexOf('--x')
const x1 = x1Index >= 0 ? Number(args[x1Index + 2]) : x0

const image = decodePng(fs.readFileSync(file))
const threshold = numberAfter('--min', 6)
const rows = []
for (let y = y0; y <= Math.min(y1, image.height - 1); y += 1) {
  let bestX = -1
  let bestDelta = 0
  for (let x = Math.max(1, x0); x <= Math.min(x1, image.width - 2); x += 1) {
    const at = (px) => {
      const index = (y * image.width + px) * image.channels
      return image.pixels[index] + image.pixels[index + 1] + image.pixels[index + 2]
    }
    const delta = Math.abs(at(x + 1) - at(x - 1))
    if (delta > bestDelta) { bestDelta = delta; bestX = x }
  }
  rows.push({ y, x: bestX, delta: bestDelta })
}
const strong = rows.filter(one => one.delta >= threshold)
const xs = strong.map(one => one.x)
const min = Math.min(...xs)
const max = Math.max(...xs)
console.log(`${file}  x∈[${x0},${x1}]  y∈[${y0},${y1}]  阈值 ${threshold}`)
console.log(`  找到边界的行：${strong.length}/${rows.length}`)
console.log(`  x 范围：${min} … ${max}   极差 ${max - min}px`)
const buckets = new Map()
for (const one of strong) buckets.set(one.x, (buckets.get(one.x) ?? 0) + 1)
console.log('  每个 x 出现在多少行上（前 8）：')
for (const [x, count] of [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`    x=${x}  ${count} 行`)
}
