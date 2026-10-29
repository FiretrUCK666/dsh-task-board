/**
 * 量胶囊（状态 chip）在三档底下的实际外貌：普通白底、深色、以及**半透明皮肤底**
 * （第三方皮肤把画布做成半透明时就是这样）。
 *
 * 要回答的是「为什么加载皮肤后每个胶囊像套了两层」：读它的 background 与 box-shadow，
 * 看填充色相对它所在的那张纸到底差多少。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function findBrowser() {
  const override = process.env.DSH_SHOT_BROWSER
  if (override !== undefined && override !== '' && existsSync(override)) return override
  for (const root of [join(process.env.LOCALAPPDATA ?? '', 'ms-playwright'), join(process.env.HOME ?? '', '.cache', 'ms-playwright')]) {
    if (!existsSync(root)) continue
    for (const name of readdirSync(root)) {
      if (!name.startsWith('chromium')) continue
      for (const rel of ['chrome-win/chrome.exe', 'chrome-win64/chrome.exe', 'chrome-linux/chrome']) {
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
    ws.addEventListener('error', () => reject(new Error('socket failed')))
    ws.addEventListener('open', () => resolveConnect({
      send(method, params = {}, sessionId) {
        const id = nextId++
        const payload = { id, method, params }
        if (sessionId !== undefined) payload.sessionId = sessionId
        return new Promise((ok, fail) => { pending.set(id, { resolve: ok, reject: fail }); ws.send(JSON.stringify(payload)) })
      },
      close: () => ws.close(),
    }))
  })
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
const hostCss = hostThemeCss()
if (browserPath === undefined || hostCss === '') { console.error('probe: 缺浏览器或主题表'); process.exit(2) }
const scoped = hostCss.replace(/(^|[}\n])(body)(\[data-ds-dark-theme\])?\{/g, (_w, lead, _b, dark) => `${lead}html${dark ?? ''},body${dark ?? ''}{`)
const read = path => readFileSync(join(ROOT, path), 'utf8')

/* 这个探针把**源样式表原样内联**进来，所以 class 名就是源里的裸名——构建产物里的
   `QeuTqq_chip` 那种哈希在这里反而不匹配任何规则（那样量到的会是「无背景、无阴影」，
   而那个假结果看起来正好像「皮肤把胶囊弄坏了」）。 */
const classOf = name => name

/* 一列胶囊，放在一张纸面上——与读者截图同形（列表里每一行一颗状态胶囊）。 */
const chips = ['进行中', '已完成', '已完成', '已完成'].map((label, index) => {
  const kind = index === 0 ? 'warn' : 'success'
  return `<div class="row"><span class="${classOf('chip')} ${classOf('chipFill')}" data-kind="${kind}"><span class="${classOf('chipLead')}" aria-hidden="true"><span class="dot" data-kind="${kind}"></span></span><span class="${classOf('chipBody')} ${classOf('truncate')}">${label}</span></span></div>`
}).join('\n')

const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>${scoped}</style>
<style>${read('src/client/design/tokens.module.css')}</style>
<style>${read('src/client/design/base.module.css')}</style>
<style>${read('src/client/design/components.module.css')}</style>
<style>
  body { margin: 0; padding: 24px; background: var(--dsh-tb-bg); }
  .sheet { padding: 16px; border-radius: var(--dsh-tb-radius-lg); background: var(--dsh-tb-paper); }
  .row { padding: 6px 0; }
  .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
  .dot[data-kind='warn'] { background: var(--dsh-tb-status-running); }
  .dot[data-kind='success'] { background: var(--dsh-tb-status-done); }
</style>
</head><body>
<div data-dsh-taskboard-view="" data-dsh-taskboard-panel="">
  <div class="sheet">${chips}</div>
</div>
<script>
window.__read = () => {
  const el = document.querySelector('.${classOf('chip')}')
  const s = getComputedStyle(el)
  const sheet = getComputedStyle(document.querySelector('.sheet'))
  /* 令牌声明在**座位**上（属性 data-dsh-taskboard-view），不在根元素上——
     从 documentElement 读会全部读空，而空值看起来像「没背景、没阴影」。 */
  const seat = getComputedStyle(document.querySelector('[data-dsh-taskboard-view]'))
  return JSON.stringify({
    chipBackground: s.backgroundColor,
    chipShadow: s.boxShadow,
    chipRadius: s.borderTopLeftRadius,
    chipColor: s.color,
    sheetBackground: sheet.backgroundColor,
    seatBg: seat.getPropertyValue('--dsh-tb-bg').trim(),
    paper: seat.getPropertyValue('--dsh-tb-paper').trim(),
    inlay: seat.getPropertyValue('--dsh-tb-plane-inlay').trim(),
    chipFillToken: seat.getPropertyValue('--dsh-tb-chip-fill').trim(),
  }, null, 2)
}
</script>
</body></html>`

const work = mkdtempSync(join(tmpdir(), 'tb-chips-'))
const html = join(work, 'page.html')
writeFileSync(html, page, 'utf8')

const child = spawn(browserPath, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${join(work, 'p')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
const endpoint = await new Promise((res, rej) => {
  let buffer = ''
  const timer = setTimeout(() => rej(new Error('no endpoint')), 20000)
  child.stderr.on('data', chunk => {
    buffer += String(chunk)
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffer)
    if (m !== null) { clearTimeout(timer); res(m[1]) }
  })
})
const browser = await connect(endpoint)
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
const send = (method, params) => browser.send(method, params ?? {}, sessionId)
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 340, height: 420, deviceScaleFactor: 3, mobile: false })
await send('Page.navigate', { url: `file:///${html.replace(/\\/g, '/')}` })
await new Promise(d => setTimeout(d, 900))

/* 三档：普通浅色 / 深色 / 半透明皮肤（画布是 rgba，模拟第三方玻璃皮肤）。 */
const cases = [
  { name: 'plain', dark: false, skin: '' },
  { name: 'dark', dark: true, skin: '' },
  { name: 'skin', dark: false, skin: 'rgba(233,238,244,0.55)' },
]
for (const one of cases) {
  await send('Runtime.evaluate', {
    expression: `
      document.documentElement.toggleAttribute('data-ds-dark-theme', ${one.dark});
      ${one.skin === '' ? "document.documentElement.style.removeProperty('--dsw-alias-bg-base')" : `document.documentElement.style.setProperty('--dsw-alias-bg-base', '${one.skin}')`}
    `,
    returnByValue: true,
  })
  await new Promise(d => setTimeout(d, 300))
  const data = JSON.parse((await send('Runtime.evaluate', { expression: 'window.__read()', returnByValue: true })).result.value)
  console.log(`\n===== ${one.name} =====`)
  console.log(`canvas(--dsh-tb-bg)  : ${data.canvasBg}`)
  console.log(`paper                : ${data.paper}`)
  console.log(`paper 实际           : ${data.sheetBackground}`)
  console.log(`chip 实际            : ${data.chipBackground}`)
  console.log(`chip shadow          : ${data.chipShadow}`)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(tmpdir(), `tb-chips-${one.name}.png`), Buffer.from(shot.data, 'base64'))
}

console.log(`\nshots in ${tmpdir()}: tb-chips-{plain,dark,skin}.png`)
send('Target.closeTarget', { targetId }).catch(() => {})
browser.close(); child.kill()
setTimeout(() => process.exit(0), 200)
