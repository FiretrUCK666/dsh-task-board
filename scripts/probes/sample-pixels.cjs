// 在给定的几个点上取像素颜色。
//
// 用来回答「这一格里透出了多少背景」这类问题：把背景改成一块扎眼的纯色，再看这一格
// 的实测颜色——透出来的比例直接读在数字里，不用靠肉眼比两张图。
//
// 用法：node scripts/probes/sample-pixels.cjs <png> x,y [x,y ...]
const fs = require('node:fs')
const zlib = require('node:zlib')

/** PNG 解码：只支持本项目截图产物会出现的 8bit RGB/RGBA、非隔行。 */
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

const [, , file, ...points] = process.argv
if (file === undefined || points.length === 0) {
  console.error('用法：node scripts/probes/sample-pixels.cjs <png> x,y [x,y ...]')
  process.exit(2)
}
const image = decodePng(fs.readFileSync(file))
for (const point of points) {
  const [x, y] = point.split(',').map(Number)
  if (!Number.isFinite(x) || !Number.isFinite(y)) continue
  const index = (y * image.width + x) * image.channels
  const rgb = [image.pixels[index], image.pixels[index + 1], image.pixels[index + 2]]
  console.log(`${point}  rgb(${rgb.join(', ')})`)
}
