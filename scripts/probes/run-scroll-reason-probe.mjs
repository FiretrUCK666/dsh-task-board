// 问浏览器一句话：这个滚动体到底在**哪条线程**上滚。
//
// ── 为什么这是关键的一句 ──────────────────────────────────────────────────────
//
// Chromium 里滚动有两条路。滚动体被提升到合成线程时，滚轮由合成器直接处理，主线程忙
// 不忙都跟得上。**没有**被提升时，每一个滚轮事件都要回到主线程，于是主线程上任何一段活
// 都会变成一次卡顿——而主线程的时间正是读者 trace 里最大的一项（未归因 2,446ms）。
//
// 「为什么没被提升」有一套具名理由（`main_thread_scrolling_reasons`），其中一条正是
// **自定义画法的滚动条**（`kCustomScrollbarScrolling`）。本项目两个滚动体都用
// `::-webkit-scrollbar` 画条，所以这一条必须被点名确认。
//
// 这一支把 trace 里每个滚动事件的 `args` 原样打印出来——不解析、不猜名字，直接看引擎
// 自己写了什么。
//
// 用法：
//   node scripts/probes/run-scroll-reason-probe.mjs --page tmp/wheel-probe.html --query bar=custom
//   node scripts/probes/run-scroll-reason-probe.mjs --page tmp/wheel-probe.html --query bar=native

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')

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
const argOf = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

async function main() {
  const pageArg = argOf('--page', '')
  if (pageArg === '') { console.error('需要 --page <本地 html>'); process.exit(2) }
  const page = resolve(ROOT, pageArg)
  if (!existsSync(page)) { console.error(`找不到 ${page}`); process.exit(2) }
  const query = argOf('--query', '')
  const browserPath = findBrowser()
  if (browserPath === undefined) { console.error('SKIP — 找不到 Chromium'); process.exit(2) }

  const profile = join(tmpdir(), `dsh-reason-${process.pid}`)
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
  const created = await browser.send('Target.createTarget', { url: 'about:blank' })
  const attached = await browser.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const sessionId = attached.sessionId

  await browser.send('Page.enable', {}, sessionId)
  await browser.send('Runtime.enable', {}, sessionId)
  await browser.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 800, deviceScaleFactor: 2, mobile: false }, sessionId)
  const url = 'file://' + page.replace(/\\/g, '/') + (query === '' ? '' : `?${query}`)
  await browser.send('Page.navigate', { url }, sessionId)
  await sleep(2400)

  const evaluate = async (expression) => {
    const result = await browser.send('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true }, sessionId)
    if (result.exceptionDetails !== undefined) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    }
    return result.result?.value
  }

  const box = await evaluate(`(() => {
    const pick = []
    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el)
      if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue
      const room = el.scrollHeight - el.clientHeight
      if (room > 200) pick.push({ el, room })
    }
    if (pick.length === 0) return null
    pick.sort((a, b) => b.room - a.room)
    const rect = pick[0].el.getBoundingClientRect()
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), room: pick[0].room }
  })()`)
  if (box === null) { browser.close(); child.kill(); console.error('没有可滚动的盒子'); process.exit(5) }

  const collected = []
  let finished = false
  browser.on('Tracing.dataCollected', (params) => { collected.push(...(params.value ?? [])) })
  browser.on('Tracing.tracingComplete', () => { finished = true })

  await browser.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc,input,benchmark,toplevel',
    transferMode: 'ReportEvents',
  }, sessionId)

  for (let step = 0; step < 30; step += 1) {
    await browser.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 140, pointerType: 'mouse',
    }, sessionId)
    await sleep(20)
  }
  await sleep(400)
  await browser.send('Tracing.end', {}, sessionId)
  for (let attempt = 0; attempt < 120 && !finished; attempt += 1) await sleep(100)

  browser.close()
  child.kill()

  /* ── what the engine said ─────────────────────────────────────────────────
   * Every scroll-related event's `args`, verbatim. If a reason bit is set, its NAME
   * will be in here — Chromium writes it as a string array next to the bitmask. */
  const interesting = collected.filter(one => typeof one.name === 'string'
    && /scroll/i.test(one.name)
    && (one.ph === 'X' || one.ph === 'I'))

  const seen = new Map()
  for (const event of interesting) {
    const args = event.args ?? {}
    const key = event.name
    const previous = seen.get(key) ?? new Set()
    for (const [name, value] of Object.entries(args)) {
      if (name === 'data' && typeof value === 'object' && value !== null) {
        for (const [inner, innerValue] of Object.entries(value)) previous.add(`${inner}=${JSON.stringify(innerValue)}`)
        continue
      }
      previous.add(`${name}=${JSON.stringify(value)}`)
    }
    seen.set(key, previous)
  }

  console.log('')
  console.log(`滚动理由审计 · ${pageArg}${query === '' ? '' : `?${query}`} · 可滚 ${box.room}px · ${interesting.length} 条滚动事件`)
  console.log('')
  console.log('引擎自己写的 args（去重后）：')
  console.log('')
  const ranked = [...seen.entries()].sort((a, b) => b[1].size - a[1].size)
  for (const [name, values] of ranked.slice(0, 12)) {
    console.log(`  ${name}`)
    for (const value of [...values].slice(0, 8)) console.log(`      ${value}`)
  }
  console.log('')
}

main().catch((error) => {
  console.error(`${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
