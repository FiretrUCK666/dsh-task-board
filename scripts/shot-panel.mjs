#!/usr/bin/env node
/**
 * shot-panel.mjs — screenshot a page of the running DSH Web GUI, with zero
 * dependencies.
 *
 * WHY THIS EXISTS AND WHY IT HAS NO DEPENDENCY. Looking at a layout is the
 * only way to know whether a layout is right: every rule in DESIGN.md about
 * width, density and containment was written by measuring a rendering, and
 * every one of them is a promise a static check cannot keep. So the loop needs
 * to be "render it, look at it, fix what it shows" — which needs a browser and
 * a way to drive it. Adding `playwright` for that would put a test-time
 * dependency on the package that `hard rule 8` (no new dependencies without
 * confirmation) exists to prevent, and would ship a 100MB browser download in
 * the contributor story. So this drives the browser that is already on the
 * machine, over the protocol it already speaks, with nothing installed.
 *
 * WHAT IT ACTUALLY DOES. It launches a headless Chromium with the debugging
 * port open, reads the port the process reports for itself, opens one page
 * over the DevTools WebSocket, and drives five calls: set the viewport, set
 * the colour scheme, navigate, wait, capture. That is the whole feature set,
 * and it is deliberately that small — a screenshot tool that grew a scripting
 * language would become a second test framework with none of the review that
 * goes with one.
 *
 * WHEN THE BROWSER IS NOT THERE, IT SAYS SO AND STOPS. A missing browser is a
 * fact about the machine, not a failure of the task. The message prints the
 * exact URL to open by hand so a human can finish the loop; it does not throw,
 * and it never writes a file.
 *
 * usage:
 *   node scripts/shot-panel.mjs --out shot.png [--url http://127.0.0.1:3080]
 *        [--width 1440] [--height 900] [--scale 2] [--wait 2500]
 *        [--color-scheme dark|light] [--full] [--eval "<js>"] [--label text]
 *        [--css-for "<selector>" [--property padding]]
 *
 * `--eval` runs once in the page after load, before the capture, and its
 * console output is printed — which is how the caller clicks into a panel
 * without this script needing to know anything about the panel.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Flag parsing, long form only. Unknown flags are a fact worth printing. */
function parseArgs(argv) {
  const out = {
    out: '',
    url: 'http://127.0.0.1:3080',
    width: 1440,
    height: 900,
    scale: 2,
    wait: 2500,
    colorScheme: 'light',
    full: false,
    eval: '',
    label: '',
    cssFor: '',
    property: 'padding',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const spelled = flag.replace(/^--/, '')
    // Flags are spelled KEBAB-case everywhere they are written down — the usage
    // block above, and AGENTS.md. The parser used to compare the raw spelling
    // against camelCase keys, so it rejected `--color-scheme` (the documented
    // form) and then printed `--color-scheme` in the list of flags it accepts.
    // A tool whose error message contradicts its own parser is worse than one
    // that is merely strict, so both spellings are accepted.
    //
    // The comparison drops hyphens on BOTH sides, because lowercasing alone is
    // not enough: `colorScheme` lowercases to `colorscheme` and `color-scheme`
    // to `color-scheme`, which are different strings — the first version of
    // this fix accepted neither spelling and looked like it worked.
    const wanted = spelled.toLowerCase().replaceAll('-', '')
    const key = Object.keys(out).find(name => name.toLowerCase().replaceAll('-', '') === wanted)
    if (key === 'full') { out.full = true; continue }
    if (key === undefined) {
      console.error(`shot-panel: unknown flag ${flag}`)
      console.error('known flags: --out --url --width --height --scale --wait --color-scheme --full --eval --label --css-for --property')
      process.exit(2)
    }
    out[key] = argv[i + 1] ?? ''
    i += 1
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
/**
 * The URL may also come from the environment, and that is the better door for
 * one: a URL from `dsh web` carries a launch token, and a token that reached a
 * command line would reach the shell history and every transcript that echoes
 * it. The environment keeps it in one place and this script never prints it.
 */
if (args.url === 'http://127.0.0.1:3080' && process.env.DSH_SHOT_URL !== undefined && process.env.DSH_SHOT_URL !== '') {
  args.url = process.env.DSH_SHOT_URL
}
if (args.out === '') {
  console.error('shot-panel: --out <file.png> is required')
  process.exit(2)
}
for (const [key, value] of [['--width', args.width], ['--height', args.height], ['--scale', args.scale]]) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
    console.error(`shot-panel: ${key} must be a positive number, got ${JSON.stringify(value)}`)
    process.exit(2)
  }
}

/** An explicit override wins, so a machine with an unusual layout still works. */
const BROWSER_OVERRIDE = process.env.DSH_SHOT_BROWSER

/**
 * Find a Chromium to drive. Local override first, then the Playwright browser
 * cache (the copy this machine already has), then the system installs.
 *
 * The candidates are read from disk rather than remembered because a browser
 * path is a fact about one machine, and a hard-coded one is wrong on the next.
 */
function findBrowser() {
  if (BROWSER_OVERRIDE !== undefined && BROWSER_OVERRIDE !== '' && existsSync(BROWSER_OVERRIDE)) return BROWSER_OVERRIDE
  const roots = [join(process.env.LOCALAPPDATA ?? '', 'ms-playwright'), join(process.env.HOME ?? '', '.cache', 'ms-playwright')]
  for (const root of roots) {
    if (!existsSync(root)) continue
    const dirs = readdirSync(root)
      .filter(name => name.startsWith('chromium'))
      .sort()
      .reverse()
    for (const dir of dirs) {
      for (const leaf of [
        ['chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
        ['chrome-win64', 'chrome.exe'],
        ['chrome-win', 'chrome.exe'],
        ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
      ]) {
        const candidate = join(root, dir, ...leaf)
        if (existsSync(candidate)) return candidate
      }
    }
  }
  for (const candidate of [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** Tell the human exactly how to finish the loop by hand, and stop. */
function giveUp() {
  console.error('shot-panel: no Chromium found on this machine.')
  console.error('  Open this URL in a browser and screenshot it by hand:')
  console.error(`    ${args.url}`)
  console.error('  Or point DSH_SHOT_BROWSER at a Chromium/Chrome executable.')
  process.exit(3)
}

const browserPath = findBrowser()
if (browserPath === undefined) giveUp()

/**
 * Whether this URL is the harness's own auth wall rather than the app.
 *
 * Probed BEFORE the browser is launched, on purpose. The other order looks
 * harmless and is not: it burns a browser launch to discover the answer, writes
 * a 9KB text page that reads like a broken render, and only then throws it
 * away — so the failure arrives looking exactly like a layout bug. And the
 * probe's own socket is the last async handle in the process, so deciding
 * while it is still open means leaving through `process.exit` with a handle
 * mid-teardown, which aborts on a platform assertion and turns an honest exit
 * code into a mystery crash code. Deciding first avoids both.
 */
async function wasAuthWall(url) {
  // Only an http(s) URL can be behind a login. A `file://` render is a local
  // artifact with no server in front of it, and probing it would fail for a
  // reason that has nothing to do with authentication.
  if (!/^https?:\/\//i.test(url)) return false
  try {
    const response = await fetch(url, { redirect: 'follow' })
    if (response.status === 401) return true
    const body = await response.text()
    return body.includes('dsh web authentication required')
  } catch {
    // A server that is not answering is a different fact; the browser launch
    // and the resulting error message are the honest report for that one.
    return false
  }
}

if (await wasAuthWall(args.url)) {
  // The token is never echoed — only the shape of what to do with it.
  console.error('shot-panel: the server refused this URL: "dsh web authentication required".')
  console.error('  dsh web mints a per-process launch token and prints it in the URL it shows at startup.')
  console.error('  Pass that whole URL, or put it in DSH_SHOT_URL so it stays out of shell history:')
  console.error('    $env:DSH_SHOT_URL = "http://127.0.0.1:3080/?token=..."')
  process.exit(6)
}

/** A private profile dir, removed on every exit path including failure. */
const profile = mkdtempSync(join(tmpdir(), 'dsh-shot-'))
let child

/**
 * Close everything this script opened, exactly once.
 *
 * `exited` is the latch that makes a second call (a signal handler, then the
 * exit hook) a no-op rather than a double kill. The socket is closed by
 * `finish()`, which WAITS for the close to land before the process leaves:
 * exiting with a socket still open leaves libuv tearing down a live handle,
 * and the runtime answers that with a platform assertion and a crash code that
 * says nothing about what went wrong.
 */
let exited = false
function shutdown() {
  if (exited) return
  exited = true
  try { child?.kill() } catch { /* already gone */ }
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* best effort */ }
}
process.on('exit', shutdown)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { shutdown(); process.exit(130) })

/** Poll the port file the browser writes for itself, rather than guessing. */
async function readDevToolsPort(timeoutMs = 20000) {
  const portFile = join(profile, 'DevToolsActivePort')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const first = readFileSync(portFile, 'utf8').split('\n')[0]?.trim()
      if (first !== undefined && first !== '' && Number.isFinite(Number(first))) return Number(first)
    }
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`the browser exited with code ${child.exitCode} before it opened its port`)
    }
    await new Promise(done => setTimeout(done, 100))
  }
  throw new Error('the browser never wrote DevToolsActivePort within 20s')
}

child = spawn(browserPath, [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-color-profile=srgb',
  '--disable-features=Translate,MediaRouter,OptimizationHints',
], { stdio: 'ignore' })

/** Poll the port the browser reports for itself, rather than guessing. */
let port
let browser
try {
  port = await readDevToolsPort()
} catch (error) {
  console.error(`shot-panel: ${error instanceof Error ? error.message : String(error)}`)
  shutdown()
  process.exit(4)
}

/** One DevTools connection, with a promise per request id. */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const pending = new Map()
    const listeners = new Map()
    let nextId = 1
    ws.addEventListener('message', event => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : '')
      if (message.id !== undefined) {
        const waiter = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) waiter?.reject(new Error(`${message.error.message} (${JSON.stringify(message.error.data ?? null)})`))
        else waiter?.resolve(message.result ?? {})
        return
      }
      for (const fn of listeners.get(message.method) ?? []) fn(message.params ?? {})
    })
    ws.addEventListener('error', () => reject(new Error('the DevTools socket failed')))
    ws.addEventListener('close', () => { for (const waiter of pending.values()) waiter.reject(new Error('the DevTools socket closed')); pending.clear() })
    ws.addEventListener('open', () => resolve({
      send(method, params = {}, sessionId) {
        const id = nextId++
        const payload = { id, method, params }
        if (sessionId !== undefined) payload.sessionId = sessionId
        return new Promise((ok, fail) => {
          pending.set(id, { resolve: ok, reject: fail })
          ws.send(JSON.stringify(payload))
        })
      },
      on(method, fn) {
        const list = listeners.get(method) ?? []
        list.push(fn)
        listeners.set(method, list)
      },
      /**
       * Close and WAIT for the close to land.
       *
       * The wait is the point. Calling `process.exit()` while this socket is
       * still open leaves libuv tearing down a live handle, which aborts the
       * process on a platform assertion and turns a clean run into a
       * mysterious crash code. Closing, letting the event loop deliver the
       * close, and only then exiting makes the exit code mean what it says.
       */
      close() {
        return new Promise(done => {
          if (ws.readyState === WebSocket.CLOSED) { done(); return }
          ws.addEventListener('close', () => done(), { once: true })
          ws.close()
        })
      },
    }))
  })
}

/**
 * The socket URL, as the browser reports it.
 *
 * It is NOT `ws://host:port/devtools/browser`: Chrome puts a per-launch UUID
 * in that path and refuses anything else, so the URL has to be read from
 * `/json/version` rather than assembled. Getting this wrong fails as a bare
 * socket error with nothing in it, which is why it is a named step.
 */
async function readBrowserSocketUrl() {
  const deadline = Date.now() + 20000
  let lastError = 'no answer'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      const info = await response.json()
      if (typeof info.webSocketDebuggerUrl === 'string' && info.webSocketDebuggerUrl !== '') return info.webSocketDebuggerUrl
      lastError = 'the answer carried no webSocketDebuggerUrl'
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise(done => setTimeout(done, 150))
  }
  throw new Error(`could not read the browser socket URL: ${lastError}`)
}

/** The one place a run ends: close the socket, then the browser, then leave. */
async function finish(code) {
  try { await browser?.close() } catch { /* already gone */ }
  shutdown()
  process.exit(code)
}

try {
  browser = await connect(await readBrowserSocketUrl())
  const version = await browser.send('Browser.getVersion')

  // Refuse to photograph an empty file. A generated page that was never
  // REGENERATED is an easy mistake — the render test no-ops when its output
  // path is unset, so the previous run's file sits there looking perfectly
  // plausible — and a browser will screenshot a 4-byte file without a murmur.
  // The result is a blank picture that reads as a catastrophic layout failure
  // and sends the next person hunting for a bug that is not there.
  if (args.url.startsWith('file:')) {
    let size = 0
    try { size = statSync(fileURLToPath(args.url)).size } catch { size = 0 }
    if (size > 0 && size < 512) {
      console.error(`shot-panel: refusing to capture ${args.url} — it is ${size} bytes, so it was never regenerated.`)
      console.error('  Re-run the render with DSH_PANEL_HTML set to that path, then capture again.')
      await finish(7)
    }
  }

  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
  console.error(`shot-panel: ${version.product} -> ${args.url}${args.label === '' ? '' : `  [${args.label}]`}`)

  await browser.send('Page.enable', {}, sessionId)
  await browser.send('Runtime.enable', {}, sessionId)
  // A mobile-emulated page with NO `<meta name="viewport">` falls back to
  // Chrome's default LAYOUT width — 980px — and is then scaled down into the
  // window. The capture looks like a 390px phone and is a 980px desktop, with
  // every container query landing in the wrong band. `screenWidth` is the
  // device, `width` is the layout viewport: setting both says "this IS a
  // 390px screen", and the page's own meta is then free to disagree (which is
  // what a real phone does). Any page without a meta still gets the old
  // behaviour, so the generated page declares one too.
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: Number(args.width),
    height: Number(args.height),
    deviceScaleFactor: Number(args.scale),
    mobile: Number(args.width) < 600,
    ...(Number(args.width) < 600 ? { screenWidth: Number(args.width), screenHeight: Number(args.height) } : {}),
  }, sessionId)
  await browser.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: args.colorScheme }],
  }, sessionId)

  const loaded = new Promise(done => browser.on('Page.loadEventFired', done))
  await browser.send('Page.navigate', { url: args.url }, sessionId)
  await Promise.race([loaded, new Promise(done => setTimeout(done, 30000))])
  await new Promise(done => setTimeout(done, Number(args.wait)))

  if (args.eval !== '') {
    const result = await browser.send('Runtime.evaluate', {
      expression: args.eval,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId)
    if (result.exceptionDetails !== undefined) {
      console.error(`shot-panel: --eval threw: ${result.exceptionDetails.text ?? 'unknown'}`)
    } else if (result.result?.value !== undefined) {
      console.error(`shot-panel: --eval -> ${JSON.stringify(result.result.value)}`)
    }
    // The click lands, the panel mounts, and the layout settles: give it the
    // same settle a human hand would, rather than capturing mid-paint.
    await new Promise(done => setTimeout(done, 1200))
  }

  if (args.cssFor !== '') {
    // ASK THE BROWSER, NOT THE PAGE. **Why this exists, in the shape it cost:**
    // reading `document.styleSheets` from inside the page and matching selectors by
    // hand produced FIVE different wrong answers in a row — a comma-separated
    // selector list read as one name, a modern browser's `CSSStyleRule.cssRules`
    // (an empty array) making every rule look like a nested container, a probe
    // element parked on `<body>` where the custom properties never reached it, and
    // an injected rule whose class name came from the very class being tested.
    // **A hand-written scanner is a second implementation of the cascade, and it
    // will be wrong in ways nobody can see.** Chrome already has the authoritative
    // answer, including the layer and the source line of every declaration.
    await browser.send('DOM.enable', {}, sessionId)
    await browser.send('CSS.enable', {}, sessionId)
    const { root } = await browser.send('DOM.getDocument', { depth: 0 }, sessionId)
    const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector: args.cssFor }, sessionId)
    if (nodeId === undefined || nodeId === 0) {
      console.error(`shot-panel: --css-for: ${args.cssFor} matched nothing`)
    } else {
      const matched = await browser.send('CSS.getMatchedStylesForNode', { nodeId }, sessionId)
      const want = args.property.toLowerCase()
      const lines = []
      for (const entry of matched.matchedCSSRules ?? []) {
        const rule = entry.rule
        const text = rule.style.cssText ?? ''
        const hits = text.split(';').filter(part => part.trim().toLowerCase().startsWith(`${want}:`) || part.trim().toLowerCase().startsWith(`${want}-`))
        if (hits.length === 0) continue
        const origin = rule.origin === 'regular' ? '' : ` [${rule.origin}]`
        const layer = rule.layers?.map(l => l.text).join('') ?? ''
        lines.push(`  ${rule.selectorList.text}${origin}${layer ? ` @layer ${layer}` : ''}\n      full: ${text.replace(/\s+/g, ' ').slice(0, 300)}`)
      }
      console.error(`shot-panel: --css-for ${args.cssFor} — rules touching \`${args.property}\` (${lines.length}):`)
      for (const line of lines) console.error(line)
    }
    await new Promise(done => setTimeout(done, 200))
  }

  const shot = await browser.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: args.full,
  }, sessionId)
  writeFileSync(args.out, Buffer.from(shot.data, 'base64'))
  console.error(`shot-panel: wrote ${args.out} (${Number(args.width)}x${Number(args.height)} @${Number(args.scale)}x, ${args.colorScheme})`)
  await finish(0)
} catch (error) {
  console.error(`shot-panel: ${error instanceof Error ? error.message : String(error)}`)
  await finish(5)
}
