/**
 * 量总览四格：静止态与悬停态的 `box-shadow` 各是什么。
 *
 * 「悬停上半部分变糊、暗色下左右和下面的灰边消失」这两种描述指向同一件事：
 * 悬停时那一笔 `box-shadow` 被**整条重写**了，而不是只换其中一笔。
 * 这里用真样式表 + 真 class，并在真浏览器里真的把鼠标移上去，读两次计算值。
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
if (browserPath === undefined) { console.error('no chromium'); process.exit(2) }
const hostCss = hostThemeCss()
if (hostCss === '') { console.error('no host theme'); process.exit(2) }
const scoped = hostCss.replace(/(^|[}\n])(body)(\[data-ds-dark-theme\])?\{/g, (_w, lead, _b, dark) => `${lead}html${dark ?? ''},body${dark ?? ''}{`)
const read = path => readFileSync(join(ROOT, path), 'utf8')

/* class 名带哈希，所以从构建出来的表里没法规避：这里用**同一张表的真 class**
   ——先把表读进来，找出 `.tile` 那条规则的哈希前后缀。 */
const homeSheet = read('src/client/home/home.module.css')
const tileMatch = /\[data-dsh-taskboard-view\] \.tile\b/.exec(homeSheet)
if (tileMatch === null) { console.error('probe: 找不到 .tile 规则'); process.exit(2) }

const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>${scoped}</style>
<style>${read('src/client/design/tokens.module.css')}</style>
<style>${read('src/client/design/base.module.css')}</style>
<style>${read('src/client/design/components.module.css')}</style>
<style>${read('src/client/home/home.module.css')}</style>
<style>body { margin: 0; padding: 20px; background: var(--dsh-tb-bg-canvas, #fafafa); }</style>
</head><body>
<div data-dsh-taskboard-view="" data-dsh-taskboard-panel="">
  <div id="tiles" class="tiles">
    <button type="button" id="t1" class="tile paperSheet paperLift">
      <span class="tileFigures"><span class="tileValue">0</span><span class="tileLabel">等你处理</span></span>
      <span class="tileHint">有会话停下来等你回答</span>
    </button>
    <button type="button" id="t2" class="tile paperSheet paperLift">
      <span class="tileFigures"><span class="tileValue">0</span><span class="tileLabel">跑完没看</span></span>
      <span class="tileHint">跑完的活还没人看过</span>
    </button>
  </div>
</div>
<script>
window.__read = () => {
  const el = document.getElementById('t2')
  const s = getComputedStyle(el)
  return JSON.stringify({
    boxShadow: s.boxShadow,
    transform: s.transform,
    background: s.backgroundColor,
    borderTopWidth: s.borderTopWidth,
    radius: s.borderTopLeftRadius,
  }, null, 2)
}
</script>
</body></html>`

const work = mkdtempSync(join(tmpdir(), 'tb-tile-'))
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
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 400, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: `file:///${html.replace(/\\/g, '/')}` })
await new Promise(d => setTimeout(d, 900))

for (const theme of ['light', 'dark']) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] })
  await send('Runtime.evaluate', {
    expression: `document.documentElement.toggleAttribute('data-ds-dark-theme', ${theme === 'dark'})`,
    returnByValue: true,
  })
  await new Promise(d => setTimeout(d, 250))

  /* 先把鼠标挪开，读静止态。 */
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none', buttons: 0 })
  await new Promise(d => setTimeout(d, 250))
  const rest = JSON.parse((await send('Runtime.evaluate', { expression: 'window.__read()', returnByValue: true })).result.value)

  /* 真的移到第二格上，读悬停态。 */
  const box = JSON.parse((await send('Runtime.evaluate', {
    expression: `(() => { const r = document.getElementById('t2').getBoundingClientRect(); return JSON.stringify({x: r.left + r.width / 2, y: r.top + r.height / 2}) })()`,
    returnByValue: true,
  })).result.value)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none', buttons: 0 })
  await new Promise(d => setTimeout(d, 400))
  const hover = JSON.parse((await send('Runtime.evaluate', { expression: 'window.__read()', returnByValue: true })).result.value)

  console.log(`\n===== ${theme} =====`)
  console.log(`静止 box-shadow: ${rest.boxShadow}`)
  console.log(`悬停 box-shadow: ${hover.boxShadow}`)
  console.log(`静止 transform:  ${rest.transform}`)
  console.log(`悬停 transform:  ${hover.transform}`)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(tmpdir(), `tb-tile-${theme}.png`), Buffer.from(shot.data, 'base64'))
}

console.log(`\nshots: ${join(tmpdir(), 'tb-tile-light.png')} ${join(tmpdir(), 'tb-tile-dark.png')}`)
send('Target.closeTarget', { targetId }).catch(() => {})
browser.close(); child.kill()
setTimeout(() => process.exit(0), 200)
