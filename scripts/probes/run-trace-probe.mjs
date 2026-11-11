// 一段真手势的 trace，按**事件名**汇总耗时。
//
// ── 为什么必须走到这一步 ──────────────────────────────────────────────────────
//
// 读者给的那份 trace 里最大的一项是「未归因 2,446ms」，而它旁边还写着三样东西：
// 渲染 910ms、绘制 567ms、执行脚本 828ms，以及 6,589 个节点、1,526 个监听器。
//
// 未归因不是 bug，它是**没有被 JS 采样覆盖的主线程时间**——样式重算、排版、绘制、
// 以及浏览器自己的记账。也就是说：**钱花在引擎处理这棵 DOM 上，不是花在 React 推导上**。
//
// 我前面每一支探针量的都是 React 那一层（重算、memo、订阅），全部读到 0。因为它们
// 量的是不贵的那一层。
//
// 这一支不猜：打开 Chromium 的 tracing，做一段真滚轮手势，然后把 trace 里每个事件
// 按总耗时排序。名字会直接说是谁。
//
// 用法：
//   node scripts/probes/run-trace-probe.mjs --page tmp/review-panel.html
//   node scripts/probes/run-trace-probe.mjs --page tmp/panel-under-poll.html

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

/** A DevTools connection with request/response AND named-event subscription. */
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

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}

/** Sum every complete event by name, and report the heaviest. */
function summarise(events) {
  const totals = new Map()
  const counts = new Map()
  for (const event of events) {
    if (event.ph !== 'X' || typeof event.dur !== 'number') continue
    const name = event.name
    totals.set(name, (totals.get(name) ?? 0) + event.dur / 1000)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const rows = [...totals.entries()]
    .map(([name, ms]) => ({ name, ms: Math.round(ms), count: counts.get(name) ?? 0 }))
    .sort((a, b) => b.ms - a.ms)
  return { rows, events: events.length }
}

async function main() {
  const pageArg = argOf('--page', '')
  if (pageArg === '') {
    console.error('run-trace-probe: 需要 --page <本地 html>')
    process.exit(2)
  }
  const page = resolve(ROOT, pageArg)
  if (!existsSync(page)) {
    console.error(`run-trace-probe: 找不到 ${page}`)
    process.exit(2)
  }
  const browserPath = findBrowser()
  if (browserPath === undefined) {
    console.error('run-trace-probe: SKIP — 找不到 Chromium（Chrome / Edge）。')
    process.exit(2)
  }

  const profile = join(tmpdir(), `dsh-trace-${process.pid}`)
  rmSync(profile, { recursive: true, force: true })
  mkdirSync(profile, { recursive: true })
  const child = spawn(browserPath, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
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
    child.kill()
    console.error('run-trace-probe: 浏览器没有报出调试端口')
    process.exit(4)
  }

  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const browser = await connect(version.webSocketDebuggerUrl)
  const created = await browser.send('Target.createTarget', { url: 'about:blank' })
  const attached = await browser.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const sessionId = attached.sessionId

  await browser.send('Page.enable', {}, sessionId)
  await browser.send('Runtime.enable', {}, sessionId)
  await browser.send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 800, deviceScaleFactor: 2, mobile: false }, sessionId)
  const url = 'file://' + page.replace(/\\/g, '/') + (argOf('--query', '') !== '' ? `?${argOf('--query', '')}` : '')
  await browser.send('Page.navigate', { url }, sessionId)
  await sleep(2600)

  /* --css injects a stylesheet BEFORE measuring: this is how a candidate fix is
     tried on the REAL page instead of on a mock-up that only resembles it. */
  const injectCss = argOf('--css', '')
  if (injectCss !== '') {
    await browser.send('Runtime.evaluate', {
      expression: '(() => {' + String.fromCharCode(10) +
        '  const s = document.createElement(String.fromCharCode(115,116,121,108,101));' + String.fromCharCode(10) +
        '  s.textContent = ' + JSON.stringify(injectCss) + String.fromCharCode(10) +
        '  document.head.appendChild(s)' + String.fromCharCode(10) +
        '  return true' + String.fromCharCode(10) +
        '})()',
      returnByValue: true,
    }, sessionId)
    await sleep(400)
  }

  const evaluate = async (expression) => {
    const result = await browser.send('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true }, sessionId)
    if (result.exceptionDetails !== undefined) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    }
    return result.result?.value
  }

  /* ── every scrollable box, not just the tallest one ─────────────────────────
   *
   * The report this probe exists for was 「各种 session 里的评论区都容易卡」 — a CLASS
   * of boxes. A probe that wheels one box answers about one box, and the one it picked
   * was whichever had the most room to scroll, which is not the same thing as the one
   * that was slow. So it enumerates all of them and wheels each in turn; the summary
   * then reports per box, and a box that stayed on the main thread can never hide
   * behind its tall neighbour.
   *
   * A box counts as scrollable when it has more than 200px of room — below that a wheel
   * gesture is over before it latches, and the reading would be about the harness. */
  const boxes = await evaluate(`(() => {
    const pick = [];
    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el)
      if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue
      const room = el.scrollHeight - el.clientHeight
      if (room <= 200) continue
      const rect = el.getBoundingClientRect()
      if (rect.width < 40 || rect.height < 40) continue
      const id = el.id !== '' ? '#' + el.id : ''
      const cls = (el.className !== '' && typeof el.className === 'string')
        ? '.' + el.className.trim().split(/\\s+/).map(one => one.replace(/_[a-z0-9]+$/i, '')).join('.')
        : ''
      pick.push({
        room,
        label: (el.tagName.toLowerCase() + id + cls).slice(0, 60),
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + Math.min(rect.height / 2, 300)),
      })
    }
    pick.sort((a, b) => b.room - a.room)
    return pick
  })()`)
  if (boxes === null || boxes.length === 0) {
    browser.close()
    child.kill()
    console.error('run-trace-probe: 这一页没有可滚动的盒子')
    process.exit(5)
  }

  /* How many wheel events per box. The first pass used 90 on one box; split across
   * several boxes it stays at 90 each, because the number that matters is whether the
   * scroller ever took the compositor path — one event that went to the main thread is
   * already a defect, and a smaller sample only risks missing it. */
  const WHEELS = 90

  /* ── the recording ─────────────────────────────────────────────────────────
   * `devtools.timeline` gives the renderer's own event names (UpdateLayoutTree,
   * Layout, Paint, Commit…). `cc` and `input` cover the compositor and the wheel
   * path — where a non-composited scroller shows up as main-thread input work. */
  const collected = []
  let finished = false
  const perBox = []
  browser.on('Tracing.dataCollected', (params) => { collected.push(...(params.value ?? [])) })

  /* One recording per box. The categories stay the same; only the wheel target moves,
   * so the numbers are comparable across boxes. */
  for (const box of boxes) {
    finished = false
    collected.length = 0
    const boxEvents = []
    browser.on('Tracing.tracingComplete', () => { finished = true })
    await browser.send('Tracing.start', {
      categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc,input,benchmark,toplevel',
      transferMode: 'ReportEvents',
    }, sessionId)

    for (let step = 0; step < WHEELS; step += 1) {
      await browser.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 110, pointerType: 'mouse',
      }, sessionId)
      await sleep(16)
    }
    await sleep(500)

    await browser.send('Tracing.end', {}, sessionId)
    for (let attempt = 0; attempt < 120 && !finished; attempt += 1) await sleep(100)
    boxEvents.push(...collected)
    perBox.push({ box, events: boxEvents.slice() })
  }
  finished = true

  /* ── DID THE INJECTION LAND? ───────────────────────────────────────────────
   * A run that says 「改了也没用」 has two readings with opposite conclusions: the
   * change never landed, or it landed and did nothing. Reporting the computed
   * values that were supposedly changed is what tells the two apart — without it
   * every later reading is a guess.
   *
   * This MUST happen before the browser is closed: a query against a dead session
   * rejects, and an unhandled rejection at the top level ends the script with a
   * clean exit code and no output at all — the reading then looks like 「没有差别」. */
  let landed = null
  if (injectCss !== '') {
    try {
      landed = await evaluate(`(() => {
        const out = []
        for (const selector of ['#comments', '#transcript']) {
          const el = document.querySelector(selector)
          if (el === null) { out.push({ selector, found: false }); continue }
          const style = getComputedStyle(el)
          out.push({ selector, found: true, willChange: style.willChange, transform: style.transform,
            contain: style.contain, overflowAnchor: style.overflowAnchor })
        }
        const modal = document.querySelector('[class*="modal_"]')
        out.push(modal === null
          ? { selector: '[class*=modal_]', found: false }
          : { selector: '[class*=modal_]', found: true, overflowY: getComputedStyle(modal).overflowY,
              radius: getComputedStyle(modal).borderTopLeftRadius })
        return out
      })()`)
    } catch (error) {
      landed = [{ error: error instanceof Error ? error.message : String(error) }]
    }
  }

  browser.close()
  child.kill()

  /* ── 主线程滚动的判据 ───────────────────────────────────────────────────────
   * Chromium 把「这个滚动体能不能在合成线程上滚」写成一组理由位，名字里带
   * `main_thread_scrolling_reasons`。它不是性能数字，是**机制**：只要有理由，每一个
   * 滚轮事件都必须回到主线程处理，主线程上任何一段活都会变成一次卡顿。
   *
   * 自定义画法的滚动条正是其中一个理由（`kCustomScrollbarScrolling`）。所以这一节
   * 直接回答「我们这个滚动体到底在哪条线程上滚」——不靠猜，也不靠帧时推断。
   *
   * 判据只在**那一个盒子自己的那段录制**里数：把三个盒子混在一起数，一条坏消息会被
   * 两条好消息平均掉，而那正是这个 bug 藏了两轮的方式。 */
  const readBox = (events) => {
    const reasons = new Map()
    for (const event of events) {
      if (typeof event.name !== 'string' || !/scroll/i.test(event.name)) continue
      const text = JSON.stringify(event.args ?? {})
      const match = /"main_thread_scrolling_reasons?"\s*:\s*(\d+)/.exec(text)
      const flag = match === null ? 'absent' : match[1]
      const key = `${event.name} :: ${flag}`
      reasons.set(key, (reasons.get(key) ?? 0) + 1)
    }
    const mainThread = events.filter(one => typeof one.name === 'string'
      && /FindScrollTargetOnMainThread/.test(one.name)).length
    return { reasons, mainThread, report: summarise(events) }
  }
  const readings = perBox.map(one => ({ box: one.box, ...readBox(one.events) }))

  console.log('')
  console.log('每个滚动体各自一段录制（这才是「都容易卡」能被回答的方式）：')
  console.log('')
  for (const reading of readings) {
    const verdict = reading.mainThread === 0 ? 'OK 合成线程' : `BAD 主线程 ${reading.mainThread}/${WHEELS}`
    console.log(`  ${verdict.padEnd(18)} 可滚 ${String(reading.box.room).padStart(5)}px  ${reading.box.label}`)
  }
  const bad = readings.filter(one => one.mainThread > 0)
  console.log('')
  console.log(bad.length === 0
    ? `  结论：${readings.length} 个滚动体，0 次回主线程找滚动目标。`
    : `  结论：${bad.length}/${readings.length} 个滚动体仍在主线程上滚。`)
  console.log('')

  /* The heaviest each box gets its own top list; merging them would answer 「整页谁贵」
     for a question that is about one box at a time. */
  for (const reading of readings) {
    console.log('')
    console.log(`按总耗时排前 12（${reading.box.label}）：`)
    console.log('')
    console.log('  毫秒    次数  事件')
    for (const row of reading.report.rows.slice(0, 12)) {
      console.log(`  ${String(row.ms).padStart(6)}  ${String(row.count).padStart(5)}  ${row.name}`)
    }
  }

  /* The top list is dominated by task-runner wrappers that NEST each other, so it
     answers 「谁在调度」 rather than 「谁在干活」. The pipeline names below are the
     ones that actually describe DOM cost, so they get their own section — a missing
     name here is itself a finding (0 means the renderer never did that work). */
  const PIPELINE = [
    'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'RasterTask',
    'Commit', 'CompositeLayers', 'UpdateLayer', 'HitTest', 'ParseHTML', 'RecalcStyle',
  ]
  const merged = summarise(perBox.flatMap(one => one.events))
  console.log('')
  console.log('渲染管线（这些名字才描述 DOM 的代价）：')
  console.log('')
  for (const name of PIPELINE) {
    const row = merged.rows.find(one => one.name === name)
    console.log(`  ${String(row === undefined ? 0 : row.ms).padStart(6)}ms  ${String(row === undefined ? 0 : row.count).padStart(5)} 次  ${name}`)
  }

  for (const reading of readings) {
    console.log('')
    console.log(`滚动事件：名字 + main_thread_scrolling_reasons（${reading.box.label}）`)
    console.log('')
    const ranked = [...reading.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    for (const [key, count] of ranked) console.log(`  ${String(count).padStart(5)}  ${key}`)
    if (ranked.length === 0) console.log('  （trace 里没有名字带 scroll 的事件——这一项没测到）')
  }

  if (landed !== null) {
    console.log('')
    console.log('注入后的计算值（证明改动落地）：')
    for (const one of landed) console.log(`  ${JSON.stringify(one)}`)
  }
  console.log('')
}

main().catch((error) => {
  console.error(`run-trace-probe: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
