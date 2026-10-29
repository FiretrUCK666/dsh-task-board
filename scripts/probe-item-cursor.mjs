/**
 * 量一件事：任务清单展开之后，展开区里那些**空白处**的光标是不是箭头。
 *
 * 读者的原话是「点击展开之后，不是有很多白色的空白区域嘛，这个时候我的鼠标一直
 * 不是箭头那种正常状态，而是变成了一个手掌」。手形光标是一句「这里能按」的承诺，
 * 而空白处按下去只会把整行收起来。
 *
 * 判据读**计算值** `cursor`，逐点检查：正文空白、步骤之间、两栏之间的空气、
 * 以及区域里真正可点的件（那些应当仍然是 pointer）。
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

/* 与真面板同形的行卡 + 展开区。用的就是真 class 名（源样式表原样内联，所以裸名匹配）。 */
const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>${scoped}</style>
<style>${read('src/client/design/tokens.module.css')}</style>
<style>${read('src/client/design/base.module.css')}</style>
<style>${read('src/client/design/components.module.css')}</style>
<style>${read('src/client/item/item.module.css')}</style>
<style>body { margin: 0; padding: 20px; background: var(--dsh-tb-bg); }</style>
</head><body>
<div class="itemRoot" data-dsh-taskboard-view="" data-dsh-taskboard-panel="">
  <div class="itemRow paperSheet" data-open="">
    <span class="itemRowLead"></span>
    <div class="itemRowCell"><h3 class="itemRowTitle">正文 1111</h3></div>
    <div class="itemDetail" id="detail">
      <div class="itemOpenMain">
        <p id="blank" style="min-height:120px">正文里的空白在这里</p>
        <button type="button" id="action" class="itemRowCardChip">加一步</button>
        <p id="between" style="min-height:80px">步骤与备注之间的空气</p>
      </div>
    </div>
  </div>
</div>
<script>
window.__read = () => {
  const cursorOf = id => getComputedStyle(document.getElementById(id)).cursor
  const detail = document.getElementById('detail')
  return JSON.stringify({
    row: getComputedStyle(document.querySelector('.itemRow')).cursor,
    detail: getComputedStyle(detail).cursor,
    blank: cursorOf('blank'),
    between: cursorOf('between'),
    action: cursorOf('action'),
    title: getComputedStyle(document.querySelector('.itemRowTitle')).cursor,
  }, null, 2)
}
</script>
</body></html>`

const work = mkdtempSync(join(tmpdir(), 'tb-cursor-'))
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
await send('Emulation.setDeviceMetricsOverride', { width: 700, height: 500, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: `file:///${html.replace(/\\/g, '/')}` })
await new Promise(d => setTimeout(d, 900))

const data = JSON.parse((await send('Runtime.evaluate', { expression: 'window.__read()', returnByValue: true })).result.value)
console.log(JSON.stringify(data, null, 2))

const verdict = {
  '行本身仍是手（它确实是按钮）': data.row === 'pointer',
  '展开区是箭头': data.detail === 'default' || data.detail === 'auto',
  '正文空白是箭头': data.blank === 'default' || data.blank === 'auto',
  '步骤与备注之间是箭头': data.between === 'default' || data.between === 'auto',
}
let failed = 0
for (const [label, ok] of Object.entries(verdict)) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`)
  if (!ok) failed += 1
}
send('Target.closeTarget', { targetId }).catch(() => {})
browser.close(); child.kill()
setTimeout(() => process.exit(failed === 0 ? 0 : 1), 200)
