// 滚动到底在哪条线程上？——一次只加一个条件，看哪一个把滚动推回主线程。
//
// ── 为什么这一支是根因定位，不是又一个读数 ────────────────────────────────────
//
// trace 里有一对事件名，它们回答的是**机制**而非性能：
//
//   WidgetInputHandlerManager::FindScrollTargetOnMainThread
//   Unlatched scroll node provided
//
// 它们在 trace 里出现一次，就意味着有**一个滚轮事件必须回到主线程**才能决定滚谁。
// 90 个滚轮事件出现 90 次，就是 90 次都回了主线程——这个滚动体根本没有在合成线程上滚。
//
// 实测：一个裸的、用同一套 React 渲染的滚动列表，这两个名字**一次都不出现**（合成线程
// 直接处理）。而真实的评论面板，90 次出现 90 次。差别不在内容多少，在那些 CSS 条件。
//
// 这一支把条件一个个打开，问：**哪一个条件把它推回主线程的？**
//
// 用法：
//   node scripts/probes/run-compositing-bisect.mjs

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const OUT = join(ROOT, 'tmp', 'compositing')

/* ── 候选条件：每一条都是真实面板里存在的写法 ───────────────────────────────
 *
 * 名字出现在 `?v=` 里；CSS 在本文件的 `VARIANT_CSS` 中一处定义。全部叠加时与真实
 * 面板的写法一致，逐个关掉就能看出是谁。 */
const VARIANTS = {
  drawnBar: '滚动条由本页用 ::-webkit-scrollbar 画（共享层那条规则）',
  layoutContain: '滚动体上 contain: layout',
  backdropAnim: '外层遮罩带一条跑完的入场动画（transform）',
  roundedClip: '外层是一个圆角 + overflow:hidden 的盒子（卡片）',
  radiusOnly: '外层只加 border-radius，不加 overflow:hidden',
  clipOnly: '外层只加 overflow:hidden，不加圆角',
  fxScrollPos: '滚动体加 will-change: scroll-position',
  fxPromote: '滚动体加 transform: translateZ(0)',
  fxClipNotHidden: '外层用 overflow: clip 代替 hidden',
  fxPaintOnScroller: '滚动体加 contain: paint',
  fxRadiusOnScroller: '圆角挪到滚动体自己身上',
  fxNoBackdropRadius: '外层不裁切，圆角交给阴影',
  fxIsolate: '滚动体加 isolation: isolate',
  overscroll: 'overscroll-behavior: contain',
  hasSibling: '祖先上有一条 :has() 规则',
  scrollAnchorNone: 'overflow-anchor: none',
  mask: '滚动体上有 -webkit-mask-image 渐变',
}

const VARIANT_CSS = `
  /* 1. the shared rule draws every descendant scroller's bar */
  .drawnBar ::-webkit-scrollbar { width: 8px; height: 8px; }
  .drawnBar ::-webkit-scrollbar-thumb {
    background-color: rgba(27, 29, 33, .28);
    border-radius: 999px;
    min-block-size: 2rem;
  }
  .drawnBar ::-webkit-scrollbar-track { background: transparent; }
  .drawnBar ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }

  /* 2. the scroller's own containment */
  .layoutContain #scroller { contain: layout; }

  /* 3. an ancestor whose entrance animation just finished (fill: backwards) */
  .backdropAnim .backdrop { animation: boardIn 160ms backwards; }
  @keyframes boardIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }

  /* 4. the rounded, clipped card the panel lives in */
  .roundedClip .panel { overflow: hidden; border-radius: 16px; }
  .radiusOnly .panel { border-radius: 16px; }
  .clipOnly .panel { overflow: hidden; }

  /* 5. */
  .overscroll #scroller { overscroll-behavior: contain; }

  /* 6. an ancestor that ASKS a subtree question about its descendants */
  .hasSibling .stage:has(.backdrop) .columns { content-visibility: hidden; }

  /* 7. */
  .scrollAnchorNone #scroller { overflow-anchor: none; }

  .fxScrollPos #scroller { will-change: scroll-position; }
  .fxPromote #scroller { transform: translateZ(0); }
  .fxClipNotHidden .panel { overflow: clip; }
  .fxPaintOnScroller #scroller { contain: paint; }
  .fxRadiusOnScroller .panel { overflow: visible; border-radius: 0; }
  .fxRadiusOnScroller #scroller { border-radius: 16px; }
  .fxNoBackdropRadius .panel { overflow: visible; }
  .fxIsolate #scroller { isolation: isolate; }

  /* 8. a mask on the scroller — a compositor effect on the scrolling contents */
  .mask #scroller {
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);
  }
`

const ENTRY = `
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

const PARAMS = new URLSearchParams(location.search)
const ON = (PARAMS.get('v') ?? '').split(',').filter(Boolean)
for (const name of ON) document.body.classList.add(name)

const Row = ({ index }) =>
  createElement('div', { className: 'row' },
    createElement('p', { className: 'rowText' },
      '第 ' + String(index + 1) + ' 条评论：这一条故意写得长一点，好让它在窄栏里换到三行。'),
    createElement('span', { className: 'rowMeta' }, '已保存 · 2026-11-10 17:26:11'))

createRoot(document.getElementById('root')).render(
  createElement('div', { className: 'stage' },
    createElement('div', { className: 'columns' },
      Array.from({ length: 60 }, (_u, index) => createElement('div', { className: 'card', key: index }, '卡片 ' + String(index)))),
    createElement('div', { className: 'backdrop' },
      createElement('div', { className: 'panel' },
        createElement('div', { className: 'scroller', id: 'scroller' },
          Array.from({ length: 220 }, (_u, index) => createElement(Row, { key: index, index })))))))

window.__mounted = true
`

const HTML = (bundle) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>
  html, body { margin: 0; block-size: 100%; font: 14px/1.7 system-ui, sans-serif; }
  body { overflow: hidden; background: #fbfbfc; color: #1b1d21; }
  #root, .stage { block-size: 100%; min-block-size: 0; }
  .stage { position: relative; display: flex; }
  .columns { flex: 1; padding: 12px; overflow: hidden; }
  .card { padding: 10px; margin-block-end: 8px; background: #f1f2f4; border-radius: 10px; }
  .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.4); display: flex; }
  .panel { margin: auto; inline-size: 460px; block-size: 84%; background: #fff; display: flex; flex-direction: column; }
  .scroller { flex: 1; overflow-y: auto; min-block-size: 0; padding: 12px 16px; }
  .row { padding: 9px 12px; margin-block-end: 9px; background: #f4f5f7; border: 1px solid #e3e5e8; border-radius: 10px; }
  .rowText { margin: 0; } .rowMeta { font-size: 12px; color: #666; }
  ${VARIANT_CSS}
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
    const listeners = new Map()
    let nextId = 1
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : '')
      if (message.id === undefined) {
        for (const fn of listeners.get(message.method) ?? []) fn(message.params ?? {})
        return
      }
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
      on(method, fn) {
        const list = listeners.get(method) ?? []
        list.push(fn)
        listeners.set(method, list)
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
      lib: { entry: join(OUT, 'entry.tsx'), formats: ['iife'], name: 'CompositingProbe', fileName: () => 'bundle.js' },
    },
  })
  const bundle = readFileSync(join(OUT, 'bundle.js'), 'utf8')
  const page = join(ROOT, 'tmp', 'compositing-bisect.html')
  writeFileSync(page, HTML(bundle), 'utf8')
  return page
}

/** One recording: count how many wheel events had to find their target on the main thread. */
async function measure(browser, url) {
  const created = await browser.send('Target.createTarget', { url: 'about:blank' })
  const attached = await browser.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const sessionId = attached.sessionId

  await browser.send('Page.enable', {}, sessionId)
  await browser.send('Runtime.enable', {}, sessionId)
  await browser.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId)
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
    return { error: 'page never mounted' }
  }

  const box = await evaluate(`(() => {
    const el = document.getElementById('scroller')
    const rect = el.getBoundingClientRect()
    return {
      room: el.scrollHeight - el.clientHeight,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      layerThreaded: typeof el.checkVisibility === 'function',
    }
  })()`)
  if (box.room <= 0) {
    await browser.send('Target.closeTarget', { targetId: created.targetId })
    return { error: 'scroller has no room' }
  }

  const collected = []
  let finished = false
  const onData = (params) => { collected.push(...(params.value ?? [])) }
  const onComplete = () => { finished = true }
  browser.on('Tracing.dataCollected', onData)
  browser.on('Tracing.tracingComplete', onComplete)

  await browser.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc,input,benchmark,toplevel',
    transferMode: 'ReportEvents',
  }, sessionId)

  let sent = 0
  for (let step = 0; step < 40; step += 1) {
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 120, pointerType: 'mouse',
    }, sessionId)
    sent += 1
    await sleep(18)
  }
  await sleep(400)
  await browser.send('Tracing.end', {}, sessionId)
  for (let attempt = 0; attempt < 150 && !finished; attempt += 1) await sleep(100)

  await browser.send('Target.closeTarget', { targetId: created.targetId })

  const count = (name) => collected.filter(one => one.name === name).length
  return {
    wheelEvents: sent,
    mainThreadTarget: count('WidgetInputHandlerManager::FindScrollTargetOnMainThread'),
    unlatched: count('Unlatched scroll node provided'),
    latched: count('InputHandler::ScrollLatchedScroller'),
  }
}

async function main() {
  const page = await buildPage()
  const browserPath = findBrowser()
  if (browserPath === undefined) {
    console.error('run-compositing-bisect: SKIP — 找不到 Chromium（Chrome / Edge）。')
    process.exit(2)
  }

  const profile = join(tmpdir(), `dsh-comp-${process.pid}`)
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

  const ALL = Object.keys(VARIANTS)
  const runs = [
    { label: '裸滚动体（对照）', query: 'v=' },
    { label: '全部条件叠加（= 真实面板）', query: `v=${ALL.join(',')}` },
  ]
  for (const name of ALL) runs.push({ label: `只开 ${name}`, query: `v=${name}` })
  for (const name of ALL) runs.push({ label: `只关 ${name}`, query: `v=${ALL.filter(one => one !== name).join(',')}` })

  const rows = []
  for (const run of runs) rows.push({ ...run, ...(await measure(browser, `${base}?${run.query}`)) })

  browser.close()
  child.kill()

  console.log('')
  console.log('滚动线程的归因：每个滚轮事件是否必须回主线程拿滚动目标')
  console.log('')
  console.log('  主线程  未latch  已latch  次数  条件')
  for (const row of rows) {
    if (row.error !== undefined) {
      console.log(`  ---  ${row.error}  ${row.label}`)
      continue
    }
    const flag = row.mainThreadTarget > 0 ? '主线程' : '合成器'
    console.log(`  ${String(row.mainThreadTarget).padStart(6)}  ${String(row.unlatched).padStart(6)}  ${String(row.latched).padStart(7)}  ${String(row.wheelEvents).padStart(4)}  ${flag}  ${row.label}`)
  }
  console.log('')
  console.log('主线程 > 0 = 这个滚动体没有在合成线程上滚；合成器 = 它在合成线程上滚。')
  console.log('')
  console.log('条件说明：')
  for (const [name, text] of Object.entries(VARIANTS)) console.log(`  ${name}: ${text}`)
  console.log('')
}

main().catch((error) => {
  console.error(`run-compositing-bisect: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
