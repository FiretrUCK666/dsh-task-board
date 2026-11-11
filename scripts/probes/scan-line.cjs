// 一条横线扫过去，把每一处的颜色打出来——用来读「分界处有没有一道台阶」。
//
// 用法：node scripts/probes/scan-line.cjs <png> --y 400 --x 700 1100 --step 8
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
const num = (flag, index, fallback) => {
  const at = args.indexOf(flag)
  return at >= 0 && args[at + index] !== undefined ? Number(args[at + index]) : fallback
}
const y = num('--y', 1, 0)
const x0 = num('--x', 1, 0)
const x1 = num('--x', 2, 0)
const step = num('--step', 1, 8)
const image = decodePng(fs.readFileSync(file))
let previous = null
for (let x = x0; x <= Math.min(x1, image.width - 1); x += step) {
  const index = (y * image.width + x) * image.channels
  const rgb = [image.pixels[index], image.pixels[index + 1], image.pixels[index + 2]]
  const delta = previous === null ? 0 : (rgb[0] + rgb[1] + rgb[2]) - (previous[0] + previous[1] + previous[2])
  console.log(`x=${String(x).padStart(5)}  rgb(${rgb.join(',')})${Math.abs(delta) >= 3 ? `   <- 台阶 ${delta > 0 ? '+' : ''}${delta}` : ''}`)
  previous = rgb
}
