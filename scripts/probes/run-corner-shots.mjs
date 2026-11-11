// 只拍一个角，放大八倍——两个版本并排。
//
// 为什么需要它：整页截图里「多了 298 个像素不一样」读不出是缺陷还是抗锯齿。把那个角
// 放大到肉眼能看见每一格，才能回答「这个改法有没有把圆角弄坏」。
//
// 用法：
//   node scripts/probes/run-corner-shots.mjs --page tmp/review-panel.html \
//     --a "" --b tmp/inject-corners.js --corner br

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const argOf = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

/** Capture one corner of `selector`, magnified. */
async function grab(browser, url, evalPath, selector, corner, outPath) {
  const created = await browser.send('Target.createTarget', { url: 'about:blank' })
  const attached = await browser.send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  const sessionId = attached.sessionId
  await browser.send('Page.enable', {}, sessionId)
  await browser.send('Runtime.enable', {}, sessionId)
  await browser.send('Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, sessionId)
  await browser.send('Page.navigate', { url }, sessionId)
  await sleep(2400)

  if (evalPath !== '') {
    const source = readFileSync(resolve(ROOT, evalPath), 'utf8')
    const injected = await browser.send('Runtime.evaluate', {
      expression: source, returnByValue: true,
    }, sessionId)
    if (injected.exceptionDetails !== undefined) {
      throw new Error(injected.exceptionDetails.exception?.description ?? injected.exceptionDetails.text)
    }
    await sleep(500)
  }

  const box = await browser.send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (el === null) return null
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    })()`,
    returnByValue: true,
  }, sessionId)
  const rect = box.result?.value
  if (rect === null || rect === undefined) {
    await browser.send('Target.closeTarget', { targetId: created.targetId })
    return null
  }

  /* A 96x96 CSS-pixel window on the requested corner, clipped from the device pixels. */
  const WINDOW = 96
  const scale = 2
  const clip = {
    x: corner.includes('r') ? rect.x + rect.w - WINDOW : rect.x,
    y: corner.includes('b') ? rect.y + rect.h - WINDOW : rect.y,
    width: WINDOW,
    height: WINDOW,
    scale: scale * 8,
  }

  const shot = await browser.send('Page.captureScreenshot', {
    format: 'png', clip, captureBeyondViewport: false,
  }, sessionId)
  writeFileSync(outPath, Buffer.from(shot.data, 'base64'))
  await browser.send('Target.closeTarget', { targetId: created.targetId })
  return { rect, clip }
}

async function main() {
  const pageArg = argOf('--page', 'tmp/review-panel.html')
  const selector = argOf('--selector', '[class*="modal_"]')
  const a = argOf('--a', '')
  const b = argOf('--b', '')
  const corner = argOf('--corner', 'br')
  const browserPath = findBrowser()
  if (browserPath === undefined) { console.error('SKIP — 找不到 Chromium'); process.exit(2) }

  const profile = join(tmpdir(), `dsh-corner-${process.pid}`)
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
  const query = argOf('--query', '')
  const url = 'file://' + resolve(ROOT, pageArg).replace(/\\/g, '/') + (query === '' ? '' : `?${query}`)

  mkdirSync(join(ROOT, 'tmp', 'corners'), { recursive: true })
  const left = await grab(browser, url, a, selector, corner, join(ROOT, 'tmp', 'corners', `a-${corner}.png`))
  const right = await grab(browser, url, b, selector, corner, join(ROOT, 'tmp', 'corners', `b-${corner}.png`))
  browser.close()
  child.kill()

  console.log(`panel rect A: ${JSON.stringify(left?.rect ?? null)}`)
  console.log(`panel rect B: ${JSON.stringify(right?.rect ?? null)}`)
  console.log('wrote tmp/corners/a-*.png and tmp/corners/b-*.png')
}

main().catch((error) => {
  console.error(`run-corner-shots: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
