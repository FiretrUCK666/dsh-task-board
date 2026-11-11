// 真滚轮驱动的滚动：这条路上「合成线程」与「主线程」是两条不同的路。
//
// ── 为什么必须另写一支 ────────────────────────────────────────────────────────
//
// 我前面每一支探针都是**程序改 `scrollTop`**：那跳过输入处理，只量「渲染器跟不跟得上」。
// 所以它们全部读到 0，而读者报的是「滑动条跳帧、不跟手」——那是**输入延迟**，不是渲染
// 速度。这两件事在浏览器里是两条路：
//
//   · 滚动体被提升到合成线程 → 滚轮由合成器直接处理，主线程忙不忙都跟得上；
//   · 没有提升 → 每一个滚轮事件都要**等主线程**，主线程上任何一段活都变成一次卡顿。
//
// 而 Chromium 有一条明写的判据：**自定义画法的滚动条会让滚动体落到主线程上**
// （`MainThreadScrollingReason::kCustomScrollbarScrolling`）。本项目两个滚动体都用
// `::-webkit-scrollbar` 画条，所以这一条必须被量。
//
// 这一支用 CDP 发**真的滚轮事件**，同时给主线程加一份负载（模拟 3 秒轮询那一类活），
// 然后问：滚动还跟得上吗？
//
// 用法：
//   node scripts/probes/run-wheel-probe.mjs
//   （它自己起浏览器、自己发事件、自己收读数）

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const OUT = join(ROOT, 'tmp', 'wheel')

/* ── the page under test ─────────────────────────────────────────────────────
 * ONE page, ONE variable: whether the scroller draws its own bar. Everything else
 * (content, size, main-thread load, wheel events) is identical. */
const ENTRY = `
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

const PARAMS = new URLSearchParams(location.search)
const BAR = PARAMS.get('bar') === 'native' ? 'native' : 'custom'
const LOAD_MS = Number(PARAMS.get('load') ?? '10')

/* Stand-in for what the real panel does every 3s. Burned inside the frame loop, so
   it competes with the wheel exactly the way a poll's render does. */
function burn(ms) {
  if (ms <= 0) return
  const start = performance.now()
  while (performance.now() - start < ms) { /* spin */ }
}

const Row = ({ index }) =>
  createElement('div', { className: 'row' },
    createElement('p', { className: 'rowText' },
      '第 ' + String(index + 1) + ' 条评论：这一条故意写得长一点，好让它在窄栏里换到三行；读者报告的手感问题就发生在这个盒子里。'),
    createElement('span', { className: 'rowMeta' }, '已保存 · 2026-11-10 17:26:11'))

createRoot(document.getElementById('root')).render(
  createElement('div', { className: 'panel' },
    createElement('div', { className: 'scroller', id: 'scroller', 'data-bar': BAR },
      Array.from({ length: 220 }, (_u, index) => createElement(Row, { key: index, index })))))

/* The load rides the frame loop: one long task per frame is exactly what the reader's
   trace shows (unattributed main-thread time), and it is what a wheel has to wait for
   when the scroller is NOT composited. */
let running = false
const tick = () => {
  if (running) burn(LOAD_MS)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

window.__startLoad = () => { running = true }
window.__stopLoad = () => { running = false }
window.__bar = BAR
window.__offset = () => document.getElementById('scroller').scrollTop
window.__mounted = true
`

const HTML = (bundle) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; block-size: 100%; font: 14px/1.7 system-ui, sans-serif; background: #fbfbfc; color: #1b1d21; }
  #root { block-size: 100%; min-block-size: 0; }
  body { overflow: hidden; }
  .panel { block-size: 100%; display: flex; flex-direction: column; }
  .scroller { flex: 1; overflow-y: auto; min-block-size: 0; padding: 12px 16px; }
  .row { padding: 9px 12px; margin-block-end: 9px; background: #f4f5f7; border: 1px solid #e3e5e8; border-radius: 10px; }
  .rowText { margin: 0; }
  .rowMeta { font-size: 12px; color: #666; }

  /* THE ONE VARIABLE. The product's recipe, applied or not. */
  #scroller[data-bar='custom']::-webkit-scrollbar { width: 6px; height: 6px; }
  #scroller[data-bar='custom']::-webkit-scrollbar-thumb {
    background-color: rgba(27, 29, 33, 0.28);
    border-radius: 999px;
    min-block-size: 2rem;
  }
  #scroller[data-bar='custom']::-webkit-scrollbar-track { background: transparent; }
  #scroller[data-bar='custom']::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
</style></head><body>
<div id="root"></div>
<script>
  window.__errors = []
  window.addEventListener('error', (event) => {
    window.__errors.push(String(event.message || event.error || 'error'))
  })
</script>
<script>${bundle}</script>
</body></html>`

/* ── plumbing ──────────────────────────────────────────────────────────────── */

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

async function resolveVite() {
  try {
    /* Resolve vite THROUGH vitest's own require, exactly as the .cjs probes do:
       this repo does not depend on vite directly, and importing it by name from an
       ESM file fails (vitest is ESM-only, so requiring it throws). */
    const require_ = createRequire(createRequire(import.meta.url).resolve('vitest'))
    return require_('vite')
  } catch {
    return undefined
  }
}

async function build() {
  const vite = await resolveVite()
  if (vite === undefined) return false
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
      lib: { entry: join(OUT, 'entry.tsx'), formats: ['iife'], name: 'WheelProbe', fileName: () => 'bundle.js' },
    },
  })
  const bundle = readFileSync(join(OUT, 'bundle.js'), 'utf8')
  const page = join(ROOT, 'tmp', 'wheel-probe.html')
  writeFileSync(page, HTML(bundle), 'utf8')
  return page
}

/** One run: load the page, warm up, then 60 real wheel events over ~1s. */
async function run(browser, url, label) {
  const targets = await browser.send('Target.getTargets', {})
  let target = targets.targetInfos?.find(one => one.type === 'page')
  if (target === undefined) {
    const created = await browser.send('Target.createTarget', { url: 'about:blank' })
    target = { targetId: created.targetId }
  }
  const attached = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
  const sessionId = attached.sessionId

  await browser.send('Page.enable', {}, sessionId)
  await browser.send('Runtime.enable', {}, sessionId)
  await browser.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 760, deviceScaleFactor: 2, mobile: false }, sessionId)
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

  const health = await evaluate(`({ mounted: window.__mounted === true, bar: window.__bar,
    errors: window.__errors ?? [], offset: window.__offset === undefined ? -1 : window.__offset() })`)
  if (health.mounted !== true) return { label, error: 'the page never mounted', health }

  /* Instrument the page: frame gaps + long tasks, collected only during the gesture. */
  await evaluate(`(() => {
    const box = document.getElementById('scroller')
    window.__probe = { gaps: [], long: [], observing: false }
    try {
      const observer = new PerformanceObserver((list) => {
        if (!window.__probe.observing) return
        for (const entry of list.getEntries()) window.__probe.long.push(Math.round(entry.duration))
      })
      observer.observe({ entryTypes: ['longtask'] })
    } catch { /* unsupported */ }
    let previous = performance.now()
    const frame = () => {
      const now = performance.now()
      if (window.__probe.observing) window.__probe.gaps.push(Math.round((now - previous) * 100) / 100)
      previous = now
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    return true
  })()`)

  await evaluate('window.__startLoad()')
  await evaluate('window.__probe.observing = true')
  const startedAt = await evaluate('window.__offset()')

  /* REAL WHEEL EVENTS over the scroller: this is the path a hand takes, and the one
     every previous probe skipped. */
  const box = await evaluate(`(() => {
    const rect = document.getElementById('scroller').getBoundingClientRect()
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
  })()`)
  for (let step = 0; step < 60; step += 1) {
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: box.x,
      y: box.y,
      deltaX: 0,
      deltaY: 90,
      pointerType: 'mouse',
    }, sessionId)
    await sleep(16)
  }
  await sleep(400)
  await evaluate('window.__probe.observing = false')
  await evaluate('window.__stopLoad()')

  const reading = await evaluate(`(() => {
    const p = window.__probe
    const gaps = p.gaps.slice(1)
    const sorted = [...gaps].sort((a, b) => a - b)
    return {
      frames: gaps.length,
      medianFrameMs: sorted[Math.floor(sorted.length / 2)],
      worstFrameMs: sorted[sorted.length - 1],
      droppedFrames: gaps.filter(gap => gap > 32).length,
      longTasks: p.long.length,
      offsetStart: ${JSON.stringify(startedAt)},
      offsetEnd: window.__offset(),
      errors: window.__errors ?? [],
    }
  })()`)

  return { label, bar: health.bar, ...reading }
}

async function main() {
  const page = await build()
  if (page === false) {
    console.error('run-wheel-probe: SKIP — 解析不到 vite。这一页没有造出来，所以什么都没量到。')
    process.exit(2)
  }
  const browserPath = findBrowser()
  if (browserPath === undefined) {
    console.error('run-wheel-probe: SKIP — 找不到 Chromium（Chrome / Edge）。')
    process.exit(2)
  }

  const profile = join(tmpdir(), `dsh-wheel-${process.pid}`)
  rmSync(profile, { recursive: true, force: true })
  mkdirSync(profile, { recursive: true })
  const child = spawn(browserPath, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--force-color-profile=srgb',
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
  if (port === undefined) {
    console.error('run-wheel-probe: 浏览器没有报出调试端口')
    child.kill()
    process.exit(4)
  }

  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const browser = await connect(version.webSocketDebuggerUrl)

  const url = 'file://' + page.replace(/\\/g, '/')
  const results = []
  for (const bar of ['custom', 'native']) {
    results.push(await run(browser, `${url}?bar=${bar}&load=10`, `${bar} (主线程每帧 10ms)`))
  }

  browser.close()
  child.kill()

  console.log('')
  console.log('真滚轮 · 同一份内容 · 同一份主线程负载 · 只改滚动条的画法')
  console.log('')
  for (const one of results) {
    if (one.error !== undefined) {
      console.log(`  ${one.label}: ${one.error}`)
      continue
    }
    console.log(`  ${one.label}`)
    console.log(`    滚动位移  ${one.offsetStart} -> ${one.offsetEnd}  (${one.offsetEnd - one.offsetStart}px)`)
    console.log(`    帧数      ${one.frames}，中位 ${one.medianFrameMs}ms，最差 ${one.worstFrameMs}ms`)
    console.log(`    坏帧      ${one.droppedFrames}`)
    console.log(`    长任务    ${one.longTasks} 条`)
    console.log('')
  }
}

main().catch((error) => {
  console.error(`run-wheel-probe: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
