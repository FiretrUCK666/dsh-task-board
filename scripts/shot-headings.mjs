/**
 * 六级标题 + 两处正文并排，出图并读数：证明「有大有小」真的成立了。
 *
 * 用真样式表与 `Markdown` 组件的真标记（`<h1 class=mdHeading data-level=1>` 一族）。
 * 读三件事：每级算出来的字号、行高、字重，以及「标题 vs 它所在那一处的正文」的倍数。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback
}
const WIDTH = Number(flag('width', '860'))
const OUT = flag('out', join(tmpdir(), 'tb-headings.png'))

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

const HEADINGS = [1, 2, 3, 4, 5, 6].map(level => `<h${level} class="mdHeading" data-level="${level}">第 ${level} 级标题：换东墙那盏灯</h${level}>`).join('\n')

/* 两块：转写区（正文 16px）与评论区（正文 13px）——标题要在这两处都明显大于正文。 */
const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>${scoped}</style>
<style>${read('src/client/design/tokens.module.css')}</style>
<style>${read('src/client/design/base.module.css')}</style>
<style>${read('src/client/design/components.module.css')}</style>
<style>${read('src/client/board.module.css')}</style>
<style>body { margin: 0; padding: 24px; background: var(--dsh-tb-bg-canvas, #fafafa); }</style>
</head><body>
<div data-dsh-taskboard-view="" data-dsh-taskboard-panel="">
  <div class="reviewMessageText" id="transcript">
    <p class="mdParagraph" id="tBody">正文：这一行是尺子，标题必须明显比它大。</p>
    ${HEADINGS}
  </div>
  <div class="reviewCommentText" id="comment" style="margin-top:28px">
    <p class="mdParagraph" id="cBody">评论正文：这一行也是尺子。</p>
    ${HEADINGS}
  </div>
</div>
<script>
window.__read = () => {
  const px = el => getComputedStyle(el).fontSize
  const lh = el => getComputedStyle(el).lineHeight
  const fw = el => getComputedStyle(el).fontWeight
  const out = { transcript: { body: px(document.getElementById('tBody')) }, comment: { body: px(document.getElementById('cBody')) } }
  for (const where of ['transcript', 'comment']) {
    out[where].levels = {}
    for (let level = 1; level <= 6; level += 1) {
      const el = document.querySelector('#' + where + ' h' + level)
      out[where].levels[level] = { size: px(el), lineHeight: lh(el), weight: fw(el), tag: el.tagName }
    }
  }
  return JSON.stringify(out, null, 2)
}
</script>
</body></html>`

const work = mkdtempSync(join(tmpdir(), 'tb-headings-'))
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
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: `file:///${html.replace(/\\/g, '/')}` })
await new Promise(d => setTimeout(d, 900))
const answer = await send('Runtime.evaluate', { expression: 'window.__read()', returnByValue: true })
const data = JSON.parse(answer.result.value)

console.log(`transcript body = ${data.transcript.body}`)
for (const [level, one] of Object.entries(data.transcript.levels)) {
  const ratio = Number.parseFloat(one.size) / Number.parseFloat(data.transcript.body)
  console.log(`  h${level}: ${one.tag} ${one.size}/${one.lineHeight} w${one.weight}  (正文的 ${ratio.toFixed(2)}x)`)
}
console.log(`comment body = ${data.comment.body}`)
for (const [level, one] of Object.entries(data.comment.levels)) {
  const ratio = Number.parseFloat(one.size) / Number.parseFloat(data.comment.body)
  console.log(`  h${level}: ${one.tag} ${one.size}/${one.lineHeight} w${one.weight}  (正文的 ${ratio.toFixed(2)}x)`)
}

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
console.log(`\nshot: ${OUT}`)

send('Target.closeTarget', { targetId }).catch(() => {})
browser.close(); child.kill()
setTimeout(() => process.exit(0), 200)
