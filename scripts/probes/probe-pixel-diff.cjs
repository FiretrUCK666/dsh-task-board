// 两张截图差在哪——逐像素，不靠眼睛。
//
// 判据只有一条：**改前与改后在看得见的地方不同，就必须指得出那是哪个像素**。
// 这一页把两张图叠起来算差，并报出差得最多的那些行/列，以及四个角各自的差异数量。
//
// 用法：node scripts/probes/probe-pixel-diff.cjs
//   （由 probe 自己启动浏览器，因为要读 canvas 的像素）

const { spawn } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')

function findBrowser() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
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
      else waiter?.resolve(message.result || {})
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

async function main() {
  const before = argOf('--before', 'tmp/with-clip.png')
  const after = argOf('--after', 'tmp/C-corners.png')
  const box = JSON.parse(argOf('--box', '{"x":558,"y":46,"w":1764,"h":1708}'))
  const out = argOf('--out', 'tmp/pixel-diff.png')

  const toUrl = (relative) => {
    const absolute = path.resolve(ROOT, relative)
    if (!existsSync(absolute)) return undefined
    const bytes = readFileSync(absolute)
    return `data:image/png;base64,${bytes.toString('base64')}`
  }
  const beforeUrl = toUrl(before)
  const afterUrl = toUrl(after)
  if (beforeUrl === undefined || afterUrl === undefined) {
    console.error('probe-pixel-diff: 缺一张图')
    process.exit(2)
  }

  const browserPath = findBrowser()
  if (browserPath === undefined) {
    console.error('probe-pixel-diff: SKIP — 找不到 Chromium')
    process.exit(2)
  }
  const profile = path.join(tmpdir(), `dsh-diff-${process.pid}`)
  rmSync(profile, { recursive: true, force: true })
  mkdirSync(profile, { recursive: true })
  const child = spawn(browserPath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
  ], { stdio: 'ignore' })

  const portFile = path.join(profile, 'DevToolsActivePort')
  let port
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(portFile)) {
      const first = readFileSync(portFile, 'utf8').split('\n')[0].trim()
      if (first !== '' && Number.isFinite(Number(first))) { port = Number(first); break }
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

  /* A page whose ONLY job is to decode two images and compare them. `file://` cannot
     read sibling images into a canvas (tainted), so both arrive as data URLs. */
  const html = `<!doctype html><meta charset="utf-8"><body><script>
    window.__diff = async () => {
      const load = (src) => new Promise((ok, no) => {
        const image = new Image()
        image.onload = () => ok(image)
        image.onerror = () => no(new Error('decode failed'))
        image.src = src
      })
      const a = await load(${JSON.stringify(beforeUrl)})
      const b = await load(${JSON.stringify(afterUrl)})
      if (a.width !== b.width || a.height !== b.height) {
        return { error: 'different sizes', a: [a.width, a.height], b: [b.width, b.height] }
      }
      const paint = (image) => {
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, image.width, image.height)
      }
      const left = paint(a)
      const right = paint(b)
      const box = ${JSON.stringify(box)}
      let total = 0
      const perRegion = { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0, body: 0 }
      const rows = new Map()
      for (let y = box.y; y < box.y + box.h; y += 1) {
        for (let x = box.x; x < box.x + box.w; x += 1) {
          const at = (y * left.width + x) * 4
          const dr = Math.abs(left.data[at] - right.data[at])
          const dg = Math.abs(left.data[at + 1] - right.data[at + 1])
          const db = Math.abs(left.data[at + 2] - right.data[at + 2])
          if (dr + dg + db <= 8) continue
          total += 1
          rows.set(y, (rows.get(y) || 0) + 1)
          const corner = 64
          const nearTop = y < box.y + corner
          const nearBottom = y > box.y + box.h - corner
          const nearLeft = x < box.x + corner
          const nearRight = x > box.x + box.w - corner
          if (nearTop && nearLeft) perRegion.topLeft += 1
          else if (nearTop && nearRight) perRegion.topRight += 1
          else if (nearBottom && nearLeft) perRegion.bottomLeft += 1
          else if (nearBottom && nearRight) perRegion.bottomRight += 1
          else perRegion.body += 1
        }
      }
      const worst = [...rows.entries()].sort((one, two) => two[1] - one[1]).slice(0, 6)
      /* Where exactly: a compact list of the differing points inside each corner, so
         「46 个像素」 can be read as 「arc antialiasing」 or 「a real notch」 rather than
         guessed from a count. */
      const points = { topLeft: [], topRight: [], bottomLeft: [], bottomRight: [] }
      for (let y = box.y; y < box.y + box.h; y += 1) {
        for (let x = box.x; x < box.x + box.w; x += 1) {
          const at = (y * left.width + x) * 4
          const dr = Math.abs(left.data[at] - right.data[at])
          const dg = Math.abs(left.data[at + 1] - right.data[at + 1])
          const db = Math.abs(left.data[at + 2] - right.data[at + 2])
          if (dr + dg + db <= 8) continue
          const corner = 64
          const nearTop = y < box.y + corner
          const nearBottom = y > box.y + box.h - corner
          const nearLeft = x < box.x + corner
          const nearRight = x > box.x + box.w - corner
          const point = [x - box.x, y - box.y, dr + dg + db]
          if (nearTop && nearLeft) points.topLeft.push(point)
          else if (nearTop && nearRight) points.topRight.push(point)
          else if (nearBottom && nearLeft) points.bottomLeft.push(point)
          else if (nearBottom && nearRight) points.bottomRight.push(point)
        }
      }
      return { total, perRegion, worstRows: worst, points, size: [left.width, left.height], box }
    }
  <\/script></body>`
  const page = path.join(ROOT, 'tmp', 'pixel-diff.html')
  require('node:fs').writeFileSync(page, html, 'utf8')
  await browser.send('Page.navigate', { url: 'file://' + page.replace(/\\/g, '/') }, sessionId)
  await sleep(900)

  const result = await browser.send('Runtime.evaluate', {
    expression: 'window.__diff()', awaitPromise: true, returnByValue: true,
  }, sessionId)
  browser.close()
  child.kill()

  if (result.exceptionDetails !== undefined) {
    console.error(`probe-pixel-diff: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    process.exit(1)
  }
  const value = result.result.value
  console.log(JSON.stringify(value, null, 2))
  console.log('')
  console.log(`${before}  vs  ${after}`)
  console.log(`面板区域内不同的像素：${value.total}`)
  for (const [region, count] of Object.entries(value.perRegion)) console.log(`  ${region.padEnd(12)} ${count}`)
  void out
}

main().catch((error) => {
  console.error(`probe-pixel-diff: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
