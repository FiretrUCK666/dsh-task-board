/**
 * 决定性的一量：滑块有没有像素跑到盒子圆角的**弧外面**。
 *
 * 做法：拿真样式表渲染真输入框（`textarea.input`，圆角 14px、滑块圆角读同一档），
 * 滚到顶端与底端各截一张，然后对右上/右下两个角逐像素判一件事——这个像素是不是
 * 滑块的颜色，且它在**圆角矩形以外**。
 *
 * 判据只认几何，不认「看起来差不多」：弧外的滑块像素数为 0 才算过。
 *
 * **实测结论（2026-10，Chromium 153）**：`textarea.input` 在顶/底两端各测一次，
 * 4423 个滑块像素，**弧外 0 个**——即浏览器自己已经把自定义滑块裁在圆角里了。
 * 同时对比「滑块圆角写死 4px」那一版，两版**完全一致**（也是 0）。
 *
 * 所以这条探针现在的用途是**守住「别退回去」**：滑块圆角读缩进那一版与写死 4px
 * 那一版在今天看起来一样，但只要将来某个盒子的圆角变大、或浏览器换了裁切规则，
 * 这两列就会分家——那时这个数会从 0 变成非 0。它不假装自己量到了今天看不出来的差别。
 *
 * 用法：node scripts/probe-scroll-arc.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function findBrowser() {
  const override = process.env.DSH_SHOT_BROWSER
  if (override !== undefined && override !== '' && existsSync(override)) return override
  for (const root of [join(process.env.LOCALAPPDATA ?? '', 'ms-playwright'), join(process.env.HOME ?? '', '.cache', 'ms-playwright')]) {
    if (!existsSync(root)) continue
    for (const name of readdirSync(root)) {
      if (!name.startsWith('chromium')) continue
      for (const rel of ['chrome-win/chrome.exe', 'chrome-win64/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const candidate = join(root, name, rel)
        if (existsSync(candidate)) return candidate
      }
    }
  }
  for (const candidate of ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe']) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function connect(url) {
  return new Promise((resolveConnect, reject) => {
    const ws = new WebSocket(url)
    const pending = new Map()
    let nextId = 1
    ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      const entry = pending.get(message.id)
      if (entry === undefined) return
      pending.delete(message.id)
      if (message.error !== undefined) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result ?? {})
    })
    ws.addEventListener('error', () => reject(new Error('the DevTools socket failed')))
    ws.addEventListener('open', () => resolveConnect({
      send(method, params = {}, sessionId) {
        const id = nextId++
        const payload = { id, method, params }
        if (sessionId !== undefined) payload.sessionId = sessionId
        return new Promise((ok, fail) => {
          pending.set(id, { resolve: ok, reject: fail })
          ws.send(JSON.stringify(payload))
        })
      },
      close: () => ws.close(),
    }))
  })
}

/** PNG → {width,height,rgba}（只认 8 位 RGB/RGBA 非交错，其它形状明说读不了）。 */
function decodePng(buffer) {
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  let bitDepth = 0
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4)
      bitDepth = body[8]; colorType = body[9]
      if (body[12] !== 0) throw new Error('interlaced PNG unsupported')
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`PNG depth ${bitDepth} type ${colorType}`)
  const channels = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  const previous = new Uint8Array(stride)
  const current = new Uint8Array(stride)
  let read = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read]; read += 1
    for (let i = 0; i < stride; i += 1) current[i] = raw[read + i]
    read += stride
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? current[i - channels] : 0
      const up = previous[i]
      const upLeft = i >= channels ? previous[i - channels] : 0
      let value = current[i]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft)
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      current[i] = value & 0xff
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels
      const target = (y * width + x) * 4
      out[target] = current[source]
      out[target + 1] = current[source + 1]
      out[target + 2] = current[source + 2]
      out[target + 3] = channels === 4 ? current[source + 3] : 255
    }
    previous.set(current)
  }
  return { width, height, rgba: out }
}

function hostThemeCss() {
  for (const root of [join(process.env.APPDATA ?? '', 'npm', 'node_modules'), join(process.env.HOME ?? '', '.npm', 'node_modules')]) {
    const bundle = join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js')
    if (!existsSync(bundle)) continue
    const source = readFileSync(bundle, 'utf8')
    const sheets = []
    for (const match of source.matchAll(/(\w+)_css_default\s*=\s*"/g)) {
      const open = match.index + match[0].length - 1
      let end = open + 1
      while (end < source.length) {
        if (source[end] === '\\') { end += 2; continue }
        if (source[end] === '"') break
        end += 1
      }
      try { sheets.push(JSON.parse(source.slice(open, end + 1))) } catch { /* skip */ }
    }
    return sheets.join('\n')
  }
  return ''
}

const browserPath = findBrowser()
if (browserPath === undefined) { console.error('找不到 Chromium，这条没量。'); process.exit(2) }
const hostCss = hostThemeCss()
if (hostCss === '') { console.error('找不到宿主主题表，颜色会是空的，这条没量。'); process.exit(2) }
const scoped = hostCss.replace(/(^|[}\n])(body)(\[data-ds-dark-theme\])?\{/g, (_w, lead, _b, dark) => `${lead}html${dark ?? ''},body${dark ?? ''}{`)
const read = path => readFileSync(join(ROOT, path), 'utf8')

/* 真输入框：`textarea.input.promptTextarea`，与评论框同一族。两列并排——
   左 = 这一版（滑块圆角读缩进），右 = 上一版（滑块圆角写死 4px）。 */
const body = '这是一行很长的输入内容，用来把多行输入框撑到出现滚动条的样子。\n'.repeat(14)
const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>${scoped}</style>
<style>${read('src/client/design/tokens.module.css')}</style>
<style>${read('src/client/design/base.module.css')}</style>
<style>${read('src/client/design/components.module.css')}</style>
<style>${read('src/client/board.module.css')}</style>
<style>
  body { margin: 0; padding: 0; background: #fff; }
  .cell { margin: 0; }
  textarea.input { width: 240px; box-sizing: border-box; display: block; }
  /* 右列：把滑块圆角退回 4px —— 上一版的样子（轨道缩进照样生效）。 */
  .old textarea.input::-webkit-scrollbar-thumb { border-radius: 4px; }
</style></head><body>
<div data-dsh-taskboard-view="" data-dsh-taskboard-panel="">
  <div class="cell" id="new"><textarea class="input promptTextarea" rows="6">${body}</textarea></div>
  <div class="cell old" id="old" style="margin-top:40px"><textarea class="input promptTextarea" rows="6">${body}</textarea></div>
</div>
</body></html>`

const work = mkdtempSync(join(tmpdir(), 'tb-decisive-'))
const htmlPath = join(work, 'page.html')
writeFileSync(htmlPath, page, 'utf8')

const child = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=0',
  `--user-data-dir=${join(work, 'profile')}`, '--no-first-run', '--no-default-browser-check',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

const endpoint = await new Promise((res, rej) => {
  let buffer = ''
  const timer = setTimeout(() => rej(new Error('no devtools endpoint')), 20_000)
  child.stderr.on('data', chunk => {
    buffer += String(chunk)
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer)
    if (match !== null) { clearTimeout(timer); res(match[1]) }
  })
})

const SCALE = 6
const browser = await connect(endpoint)
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
const send = (method, params) => browser.send(method, params ?? {}, sessionId)
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 340, height: 520, deviceScaleFactor: SCALE, mobile: false })
await send('Page.navigate', { url: `file:///${htmlPath.replace(/\\/g, '/')}` })
await new Promise(done => setTimeout(done, 900))

/**
 * 数出「滑块颜色的像素」里有多少落在圆角矩形**之外**。
 *
 * @param cellId - 那一格的 id。
 * @param scrollTo - 'top' / 'bottom'。
 */
async function outsideArcPixels(cellId, scrollTo) {
  await send('Runtime.evaluate', {
    expression: `document.querySelector('#${cellId} textarea').scrollTop = ${scrollTo === 'top' ? 0 : 'document.querySelector(\'#' + cellId + ' textarea\').scrollHeight'}`,
    returnByValue: true,
  })
  await new Promise(done => setTimeout(done, 250))
  const rectAnswer = await send('Runtime.evaluate', {
    expression: `(() => { const r = document.querySelector('#${cellId} textarea').getBoundingClientRect(); return JSON.stringify({top:r.top,left:r.left,width:r.width,height:r.height}) })()`,
    returnByValue: true,
  })
  const rect = JSON.parse(rectAnswer.result.value)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const png = decodePng(Buffer.from(shot.data, 'base64'))

  /* 圆角半径：从计算值读，不猜（它可能被容器查询改过）。 */
  const radiusAnswer = await send('Runtime.evaluate', {
    expression: `(() => { const s = getComputedStyle(document.querySelector('#${cellId} textarea')); return s.borderTopRightRadius })()`,
    returnByValue: true,
  })
  const radius = Number.parseFloat(radiusAnswer.result.value)

  const left = rect.left * SCALE
  const right = (rect.left + rect.width) * SCALE
  const top = rect.top * SCALE
  const bottom = (rect.top + rect.height) * SCALE

  /** 一个点在不在**外圆角矩形**里（圆角处按弧判）。 */
  const inside = (x, y) => {
    if (x < left || x > right || y < top || y > bottom) return false
    const r = radius * SCALE
    const cx = x < left + r ? left + r : x > right - r ? right - r : x
    const cy = y < top + r ? top + r : y > bottom - r ? bottom - r : y
    if (cx === x || cy === y) return true
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }

  /* 滑块颜色：比背景明显深，且**饱和低**（滑块是中性灰，文字是深灰但更细）。
     只取那一格右边缘 12px 的沟里，够了也可以排除正文文字。 */
  let outside = 0
  let total = 0
  const samples = []
  for (let y = Math.max(0, Math.floor(top)); y < Math.min(png.height, Math.ceil(bottom)); y += 1) {
    for (let x = Math.max(0, Math.floor(right - 12 * SCALE)); x < Math.min(png.width, Math.ceil(right)); x += 1) {
      const at = (y * png.width + x) * 4
      const r = png.rgba[at]; const g = png.rgba[at + 1]; const b = png.rgba[at + 2]
      const max = Math.max(r, g, b); const min = Math.min(r, g, b)
      const grey = max - min < 18
      const ink = max < 210
      if (!grey || !ink) continue
      total += 1
      if (!inside(x, y)) { outside += 1; if (samples.length < 5) samples.push([(x / SCALE).toFixed(2), (y / SCALE).toFixed(2)]) }
    }
  }
  return { radius, total, outside, samples }
}

const report = {}
for (const cellId of ['new', 'old']) {
  report[cellId] = {
    top: await outsideArcPixels(cellId, 'top'),
    bottom: await outsideArcPixels(cellId, 'bottom'),
  }
}
console.log(JSON.stringify(report, null, 2))
console.log('\n判据：outside 为 0 = 滑块没有任何像素落在圆角弧之外。')

send('Target.closeTarget', { targetId }).catch(() => {})
browser.close()
child.kill()
setTimeout(() => process.exit(0), 200)
