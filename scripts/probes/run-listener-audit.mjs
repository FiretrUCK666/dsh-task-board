// 监听器会不会随时间增长——用 DevTools 自己的计数法，不猜。
//
// ── 为什么是这一支 ────────────────────────────────────────────────────────────
//
// 读者那份 trace 的「内存」轨道上写着：13 秒里监听器 1,526 -> 1,682（**多了 156 个**），
// 而同一段时间里他只是在上下滚动，没有新建卡、没有提交评论。**滚动不该新增监听器。**
//
// 这一支用与 DevTools 同一个计数法（`getEventListeners`，经 `includeCommandLineAPI`
// 注入），每秒采一次，连续十秒，回答一个问题：**这个页面上的监听器是稳的，还是在长。**
//
// 它还分两栏：全部监听器，以及按元素归类的「谁挂着它们」——这样一旦真的在长，能直接
// 看到是哪一族元素在长。
//
// 用法：
//   node scripts/probes/run-listener-audit.mjs --page tmp/panel-under-poll.html
//   node scripts/probes/run-listener-audit.mjs --page tmp/review-panel.html --seconds 10

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

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}

/* THE COUNTER: the same one the Memory track uses. `getEventListeners` only exists in
   the console API, so it must be requested via `includeCommandLineAPI` — a page-context
   copy does not exist, and pretending otherwise is how a reading turns into a zero. */
const COUNT = `(() => {
  const families = new Map()
  let total = 0
  let carrying = 0
  for (const element of document.querySelectorAll('*')) {
    let own = 0
    const listeners = getEventListeners(element)
    for (const type of Object.keys(listeners)) own += listeners[type].length
    if (own === 0) continue
    total += own
    carrying += 1
    const tag = element.tagName.toLowerCase()
    const cls = typeof element.className === 'string'
      ? element.className.split(' ').filter(Boolean).slice(0, 2).join('.')
      : ''
    const key = cls === '' ? tag : tag + '.' + cls
    families.set(key, (families.get(key) ?? 0) + own)
  }
  /* Window- and document-level listeners live outside the element walk. */
  for (const scope of [window, document]) {
    const listeners = getEventListeners(scope)
    for (const type of Object.keys(listeners)) {
      total += listeners[type].length
      const key = scope === window ? '(window)' : '(document)'
      families.set(key, (families.get(key) ?? 0) + listeners[type].length)
    }
  }
  const top = [...families.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  return {
    total,
    carrying,
    nodes: document.getElementsByTagName('*').length,
    families: top.map(([name, count]) => ({ name, count })),
  }
})()`

async function main() {
  const pageArg = argOf('--page', '')
  if (pageArg === '') {
    console.error('run-listener-audit: 需要 --page <本地 html>')
    process.exit(2)
  }
  const page = resolve(ROOT, pageArg)
  if (!existsSync(page)) {
    console.error(`run-listener-audit: 找不到 ${page}`)
    process.exit(2)
  }
  const seconds = Number(argOf('--seconds', '10'))
  const query = argOf('--query', '')
  const scroll = argOf('--scroll', '1') !== '0'
  const browserPath = findBrowser()
  if (browserPath === undefined) {
    console.error('run-listener-audit: SKIP — 找不到 Chromium（Chrome / Edge）。')
    process.exit(2)
  }

  const profile = join(tmpdir(), `dsh-listeners-${process.pid}`)
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
    console.error('run-listener-audit: 浏览器没有报出调试端口')
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
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)
  const url = 'file://' + page.replace(/\\/g, '/') + (query !== '' ? `?${query}` : '')
  await browser.send('Page.navigate', { url }, sessionId)
  await sleep(2500)

  const evaluate = async (expression) => {
    const result = await browser.send('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true }, sessionId)
    if (result.exceptionDetails !== undefined) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    }
    return result.result?.value
  }

  const health = await evaluate('({ title: document.title, nodes: document.getElementsByTagName("*").length })')
  const opened = await evaluate(COUNT)
  if (opened === undefined || opened.total === 0) {
    browser.close()
    child.kill()
    console.error('run-listener-audit: 数不到监听器——这一支的仪器失效了，读数作废（不是「没有监听器」）')
    process.exit(6)
  }

  /* Scroll continuously for the whole window: that is the state the reader reported,
     and it is also the only state in which a scroll-driven leak can appear. */
  const box = scroll ? await evaluate(`(() => {
    const pick = []
    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el)
      if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue
      const room = el.scrollHeight - el.clientHeight
      if (room > 100) pick.push({ el, room })
    }
    if (pick.length === 0) return null
    pick.sort((a, b) => b.room - a.room)
    const rect = pick[0].el.getBoundingClientRect()
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), room: pick[0].room }
  })()`) : null

  const samples = [opened]
  for (let second = 1; second <= seconds; second += 1) {
    if (box !== null) {
      for (let step = 0; step < 30; step += 1) {
        await browser.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 120, pointerType: 'mouse',
        }, sessionId)
        await sleep(16)
      }
      await sleep(1000 - 30 * 16)
    } else {
      await sleep(1000)
    }
    samples.push(await evaluate(COUNT))
  }

  browser.close()
  child.kill()

  console.log('')
  console.log(`监听器审计 · ${pageArg}${query === '' ? '' : `?${query}`}${box === null ? '（不滚动）' : `（持续滚动 ${box.room}px 的盒子）`}`)
  console.log('')
  console.log('  秒   监听器   挂着的元素   节点数')
  for (let index = 0; index < samples.length; index += 1) {
    const one = samples[index]
    console.log(`  ${String(index).padStart(2)}  ${String(one.total).padStart(7)}  ${String(one.carrying).padStart(11)}  ${String(one.nodes).padStart(7)}`)
  }
  const first = samples[0]
  const last = samples[samples.length - 1]
  console.log('')
  console.log(`  ${seconds} 秒的变化：监听器 ${first.total} -> ${last.total}（${last.total - first.total >= 0 ? '+' : ''}${last.total - first.total}），节点 ${first.nodes} -> ${last.nodes}`)
  console.log('')
  console.log('  谁挂着它们（最后一秒，前 8）：')
  for (const family of last.families) console.log(`    ${String(family.count).padStart(5)}  ${family.name}`)
  console.log('')
}

main().catch((error) => {
  console.error(`run-listener-audit: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
