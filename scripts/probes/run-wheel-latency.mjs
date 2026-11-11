// 决定性的一问：**跟手**与不跟手，差多少毫秒？
//
// ── 前面已经证明的 ────────────────────────────────────────────────────────────
//
// 1. 真实评论面板的滚动体**没有在合成线程上滚**：90 个真滚轮事件，90 次都要回主线程
//    去问「该滚谁」（`WidgetInputHandlerManager::FindScrollTargetOnMainThread`）。
// 2. 原因是**祖先上的圆角裁切**：只去掉圆角、或只去掉 `overflow: hidden`，都立刻恢复
//    合成线程滚动；两者同时存在才出问题。
// 3. 把 `overflow` 换成 `clip`、加 `clip-path`、给滚动体加 `contain: paint` —— 全部无效。
//
// ── 还差的一步 ────────────────────────────────────────────────────────────────
//
// 「回主线程」本身不是卡，它是**卡的条件**：主线程上有活时，每个滚轮事件都要排队。
// 所以这一支量的是**用户能感觉到的那件事**——从手指/滚轮发出，到画面真的动了，隔多久。
//
// 两档，同一份内容、同一份主线程负载（模拟 3 秒轮询那一类活），只改祖先的裁切。
//
// 用法：
//   node scripts/probes/run-wheel-latency.mjs

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const OUT = join(ROOT, 'tmp', 'wheel-latency')

const ENTRY = `
import { createElement, memo } from 'react'
import { createRoot } from 'react-dom/client'
import css from '../../src/client/board.module.css'
import '../../src/client/design/base.module.css'
import tokens from '../../src/client/design/tokens.module.css?inline'

const tokensStyle = document.createElement('style')
tokensStyle.textContent = tokens
document.head.appendChild(tokensStyle)

const PARAMS = new URLSearchParams(location.search)
const CLIP = PARAMS.get('clip') !== '0'
const LOAD_MS = Number(PARAMS.get('load') ?? '8')

const Row = memo(function Row({ index }) {
  return createElement('li', { className: css.reviewComment },
    createElement('span', { className: css.reviewCommentText },
      createElement('p', { className: css.mdParagraph },
        '第 ' + String(index + 1) + ' 条评论：这一条故意写得长一点，好让它在窄栏里换到三行；读者报告的手感问题就发生在这个盒子里。')),
    createElement('span', { className: css.reviewCommentMeta },
      createElement('span', { className: css.reviewCommentChip }, '已保存 · 开启自动巡航后注入'),
      createElement('span', { className: css.reviewCommentTime }, '2026-11-10 17:26:11')))
})

createRoot(document.getElementById('root')).render(
  createElement('div', { className: 'stage' },
    createElement('div', { className: 'modal', 'data-clip': CLIP ? '1' : '0' },
      createElement('div', { className: 'head' }, '把评论区的滚动修好'),
      createElement('div', { className: 'body' },
        createElement('div', { className: 'scroller', id: 'comments' },
          createElement('ul', { className: css.reviewComments },
            Array.from({ length: 200 }, (_u, index) => createElement(Row, { key: index, index }))))))))

/* The load: one busy block per frame, the shape of a poll's render landing under the
   reader's thumb. Burned on rAF so it competes with a wheel that has to wait for the
   main thread. */
function burn(ms) {
  if (ms <= 0) return
  const start = performance.now()
  while (performance.now() - start < ms) { /* spin */ }
}
let running = false
const tick = () => { if (running) burn(LOAD_MS); requestAnimationFrame(tick) }
requestAnimationFrame(tick)
window.__startLoad = () => { running = true }
window.__stopLoad = () => { running = false }
window.__mounted = true
window.__scrollTop = () => document.getElementById('comments').scrollTop
`

const HTML = (cssText, bundle) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>${cssText}</style>
<style>
  html, body { margin: 0; block-size: 100%; }
  body { background: #e8e9ec; overflow: hidden; }
  #root { block-size: 100%; min-block-size: 0; }
  .stage { block-size: 100%; display: flex; }
  .modal {
    margin: auto; inline-size: 640px; block-size: 88%;
    display: flex; flex-direction: column;
    background: #fff; box-shadow: 0 24px 60px rgba(0,0,0,.22);
  }
  /* ── THE ONE VARIABLE ──────────────────────────────────────────────────────
     Today: the panel rounds its own corners AND clips its children. That pair is what
     pushes the descendant scroller onto the main thread.
     Without: no radius, no clip — the inside is squared off. */
  .modal[data-clip='1'] { border-radius: 28px; overflow: hidden; }
  .modal[data-clip='0'] { border-radius: 0; overflow: visible; }

  .head { padding: 16px 20px; font-weight: 600; background: #fff; border-block-end: 1px solid #eceef1; }
  .body { flex: 1; min-block-size: 0; display: flex; }
  .scroller { flex: 1; overflow-y: auto; min-block-size: 0; padding: 12px 16px; }
</style></head><body>
<div id="root"></div>
<script>${bundle}</script>
</body></html>`

function findBrowser() {
  const candidates = [
    join(process.env.PROGRAMFILES ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.PROGRAMFILES ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]
  return candidates.find(one => existsSync(one))
}

function connect(url) {
  return new Promise((done, fail) => {
    const ws = new WebSocket(url)
    const pending = new Map()
    let nextId = 1
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : '')
      if (message.id === undefined) return
      const waiter = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) waiter?.reject(new Error(message.error.message))
      else waiter?.resolve(message.result ?? {})
    })
    ws.addEventListener('error', () => fail(new Error('the DevTools socket failed')))
    ws.addEventListener('open', () => done({
      send(method, params = {}, sessionId) {
        const id = nextId++
        const payload = { id, method, params }
        if (sessionId !== undefined) payload.sessionId = sessionId
        return new Promise((ok, no) => {
          pending.set(id, { resolve: ok, reject: no })
          ws.send(JSON.stringify(payload))
        })
      },
      close() { ws.close() },
    }))
  })
}

const sleep = (ms) => new Promise(one => setTimeout(one, ms))

async function buildPage() {
  const require_ = createRequire(createRequire(import.meta.url).resolve('vitest'))
  const vite = require_('vite')
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'entry.tsx'), ENTRY, 'utf8')
  await vite.build({
    root: ROOT,
    configFile: false,
    mode: 'production',
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.env': '{}' },
    build: {
      outDir: OUT,
      emptyOutDir: false,
      minify: false,
      target: 'chrome120',
      lib: { entry: join(OUT, 'entry.tsx'), formats: ['iife'], name: 'LatencyProbe', fileName: () => 'bundle.js' },
    },
  })
  const files = readdirSync(OUT)
  const cssText = files.filter(name => name.endsWith('.css'))
    .map(name => readFileSync(join(OUT, name), 'utf8')).join('\n')
  const bundle = readFileSync(join(OUT, 'bundle.js'), 'utf8')
  const page = join(ROOT, 'tmp', 'wheel-latency.html')
  writeFileSync(page, HTML(cssText, bundle), 'utf8')
  return page
}

/* ── the measurement ─────────────────────────────────────────────────────────
 * For each wheel event: note the time, then watch `scrollTop` on every animation
 * frame (and a microtask) until it changes. The gap is the latency the hand feels.
 * Only the first change after each dispatch counts — later ones belong to the next
 * event. */
const LATENCY_SCRIPT = `(() => {
  const box = document.getElementById('comments')
  if (box === null) return { error: 'no scroller' }
  const probe = window.__probe = { pending: [], latencies: [] }
  let watching = false
  const watch = () => {
    if (probe.pending.length === 0) { watching = false; return }
    const now = performance.now()
    const top = box.scrollTop
    for (let index = probe.pending.length - 1; index >= 0; index -= 1) {
      const one = probe.pending[index]
      if (top !== one.from) {
        probe.latencies.push(Math.round((now - one.at) * 100) / 100)
        probe.pending.splice(index, 1)
      }
    }
    requestAnimationFrame(watch)
  }
  window.__mark = () => {
    probe.pending.push({ at: performance.now(), from: box.scrollTop })
    if (!watching) { watching = true; requestAnimationFrame(watch) }
  }
  return { room: box.scrollHeight - box.clientHeight }
})()`

async function run(browser, url, label) {
  const created = await browser.send('Target.createTarget', { url: 'about:blank' })
  const attached = await browser.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const sessionId = attached.sessionId
  await browser.send('Page.enable', {}, sessionId)
  await browser.send('Runtime.enable', {}, sessionId)
  await browser.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 820, deviceScaleFactor: 1, mobile: false }, sessionId)
  await browser.send('Page.navigate', { url }, sessionId)
  await sleep(2200)

  const evaluate = async (expression) => {
    const result = await browser.send('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true }, sessionId)
    if (result.exceptionDetails !== undefined) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    }
    return result.result?.value
  }

  const ok = await evaluate('window.__mounted === true')
  if (ok !== true) {
    await browser.send('Target.closeTarget', { targetId: created.targetId })
    return { label, error: 'page never mounted' }
  }
  const setup = await evaluate(LATENCY_SCRIPT)
  if (setup.error !== undefined || setup.room <= 0) {
    await browser.send('Target.closeTarget', { targetId: created.targetId })
    return { label, error: setup.error ?? 'scroller has no room' }
  }
  const box = await evaluate(`(() => {
    const rect = document.getElementById('comments').getBoundingClientRect()
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  })()`)

  await evaluate('window.__startLoad()')

  for (let step = 0; step < 45; step += 1) {
    await evaluate('window.__mark()')
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 100, pointerType: 'mouse',
    }, sessionId)
    await sleep(24)
  }
  await sleep(500)
  await evaluate('window.__stopLoad()')

  const reading = await evaluate(`(() => {
    const list = window.__probe.latencies.slice()
    list.sort((a, b) => a - b)
    const at = (q) => list.length === 0 ? null : list[Math.floor(list.length * q)]
    return {
      samples: list.length,
      median: at(0.5),
      p90: at(0.9),
      worst: list.length === 0 ? null : list[list.length - 1],
      best: list.length === 0 ? null : list[0],
      over100: list.filter(one => one > 100).length,
    }
  })()`)

  await browser.send('Target.closeTarget', { targetId: created.targetId })
  return { label, ...reading }
}

async function main() {
  const page = await buildPage()
  const browserPath = findBrowser()
  if (browserPath === undefined) {
    console.error('run-wheel-latency: SKIP — 找不到 Chromium（Chrome / Edge）。')
    process.exit(2)
  }
  const profile = join(tmpdir(), `dsh-lat-${process.pid}`)
  rmSync(profile, { recursive: true, force: true })
  mkdirSync(profile, { recursive: true })
  const child = spawn(browserPath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb',
  ], { stdio: 'ignore' })

  const portFile = join(profile, 'DevToolsActivePort')
  let port
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(portFile)) {
      const first = readFileSync(portFile, 'utf8').split('\n')[0]?.trim()
      if (first !== undefined && first !== '' && Number.isFinite(Number(first))) { port = Number(first); break }
    }
    await sleep(100)
  }
  if (port === undefined) { child.kill(); console.error('浏览器没有报出调试端口'); process.exit(4) }

  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const browser = await connect(version.webSocketDebuggerUrl)
  const base = 'file://' + page.replace(/\\/g, '/')

  /* ── A LOAD SWEEP, NOT A SINGLE POINT ─────────────────────────────────────
   * One load level cannot separate the two paths: with a quiet main thread, a wheel
   * that waits for it still gets served in time. The difference only appears when
   * the main thread has real work — so the same gesture is repeated at rising load.
   * If the clipped column degrades and the unclipped one stays flat, the mechanism
   * is proven to be the user-visible cause. */
  const rows = []
  for (const load of [0, 8, 20, 40]) {
    for (const mode of ['1', '0']) {
      rows.push({
        load,
        ...await run(browser, `${base}?clip=${mode}&load=${load}`,
          mode === '1' ? '圆角裁切（今天）' : '不裁切'),
      })
    }
  }

  browser.close()
  child.kill()

  console.log('')
  console.log('滚轮到手感：从事件发出，到画面真的动了（毫秒）')
  console.log('  主线程每帧负载 0 / 8 / 20 / 40ms，四档各两列')
  console.log('')
  console.log('  负载   中位    p90    最差  超过100ms   这一档')
  for (const row of rows) {
    if (row.error !== undefined) { console.log(`  ---  ${row.error}  ${row.label}`); continue }
    console.log(`  ${String(row.load).padStart(4)}  ${String(row.median).padStart(5)}  ${String(row.p90).padStart(5)}  ${String(row.worst).padStart(6)}  ${String(row.over100).padStart(9)}   ${row.label}`)
  }
  console.log('')
}

main().catch((error) => {
  console.error(`run-wheel-latency: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
