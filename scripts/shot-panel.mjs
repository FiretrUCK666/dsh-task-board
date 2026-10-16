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
 *        [--color-scheme dark|light] [--full] [--eval "<js>"] [--eval-file <path>] [--label text]
 *        [--css-for "<selector>" [--property padding]]
 *        [--both] [--scrollbars] [--touch] [--audit] [--font "<css family stack>"]
 *
 *   DSH_SHOT_URL=<the whole URL, token included>   used in place of --url
 *   DSH_SHOT_BROWSER=<path to a Chromium>          used in place of discovery
 *
 * `--touch` IS A DIFFERENT DEVICE, NOT A DIFFERENT WIDTH. A narrow `--width`
 * alone does not turn on the touch tier: measured, at `--width 412` the media
 * query `(hover: none) and (pointer: coarse)` still reads FALSE, because
 * `Emulation.setDeviceMetricsOverride`'s `mobile` flag changes the viewport and
 * nothing else. So every rule inside a `@media (hover: none) and (pointer:
 * coarse)` block — the whole touch-ergonomics tier of both sheets — had never
 * been rendered by this tool at all. `--touch` adds the two calls that make a
 * phone: `Emulation.setTouchEmulationEnabled` plus `hover`/`pointer` in
 * `Emulation.setEmulatedMedia`. Chromium reports the phone's answer afterwards
 * (`both: true`), which is how the tier is proven rather than assumed.
 *
 * `--audit` RUNS THE PANEL AUDIT AND WRITES ITS READINGS. It evaluates
 * `scripts/probes/probe-item-capsules.js` (unless `--eval`/`--eval-file` says
 * otherwise) and writes the returned object to `<out>` with a `.audit.json`
 * suffix. One run = one reading; the matrix (widths x device scale factors x
 * both pointer capabilities) and the pass/fail judgement belong to
 * `scripts/audit-panels.mjs`, which drives this tool — a screenshot tool that
 * grew an assertion language would be a second test framework.
 *
 * `--font` IS THE OTHER HALF OF "IT LOOKS FINE HERE". Every number this tool
 * reads about vertical centring is a distance between a box and the ink inside
 * it, and **the ink's shape is the font's**. The phone that reported the
 * defect runs a font this machine does not have, so a reading taken with one
 * font is a reading of that font. `--font` forces every element onto the given
 * family stack (`*{font-family:… !important}`, applied before the audit probe
 * runs and before the capture) so the same page can be measured twice with two
 * metric sets — which is how a font-dependent residual is told apart from a
 * layout defect.
 *
 * `--both` captures TWO shots with one browser launch: the claimed --width and
 * the narrow 412, both derived from the SAME --out prefix (`shot.png` writes
 * `shot-wide.png` and `shot-narrow.png`). Hybrid hard rule 11 makes every UI
 * change answer at both widths, so the loop needs a one-flag way to do that
 * instead of two runs whose only difference is a typo waiting to happen.
 *
 * `--eval` runs once in the page after load, before the capture, and its
 * console output is printed — which is how the caller clicks into a panel
 * without this script needing to know anything about the panel. `--eval-file`
 * takes the same script from a path instead of from the command line, so the
 * code never travels through a shell (see the note at the call site).
 *
 * WHICH URL TO PASS. `--url` takes the WHOLE URL `dsh web` prints, launch token
 * and all, and so does `DSH_SHOT_URL` — the better door for a token, because a
 * command line reaches the shell history and every transcript that echoes it.
 * Such a URL works as it stands: the pre-flight replays the exchange that URL
 * starts (a 303 carrying `Set-Cookie`, the cookie then opening the app) with its
 * own cookie jar, since `fetch` has none, and the browser afterwards opens the
 * same URL the way any browser would.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where this file's neighbours are. The audit probe is addressed relative to
 * this script rather than to the caller's working directory: a tool that only
 * works when run from one particular cwd is a tool that fails from everywhere
 * else, and that failure would read as "the audit found nothing".
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const AUDIT_PROBE = join(HERE, 'probes', 'probe-item-capsules.js')

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
    evalFile: '',
    label: '',
    cssFor: '',
    property: 'padding',
    both: false,
    scrollbars: false,
    touch: false,
    audit: false,
    font: '',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const spelled = flag.replace(/^--/, '')
    // Flags are spelled KEBAB-case everywhere they are written down — the usage
    // block above, and AGENTS.md. Both spellings are accepted, because a tool
    // whose error message contradicts its own parser is worse than one that is
    // merely strict.
    //
    // The comparison drops hyphens on BOTH sides: lowercasing alone is not
    // enough, because `colorScheme` lowercases to `colorscheme` and
    // `color-scheme` to `color-scheme`, which are different strings.
    const wanted = spelled.toLowerCase().replaceAll('-', '')
    const key = Object.keys(out).find(name => name.toLowerCase().replaceAll('-', '') === wanted)
    if (key === 'full') { out.full = true; continue }
    if (key === 'both') { out.both = true; continue }
    if (key === 'scrollbars') { out.scrollbars = true; continue }
    if (key === 'touch') { out.touch = true; continue }
    if (key === 'audit') { out.audit = true; continue }
    if (key === undefined) {
      console.error(`shot-panel: unknown flag ${flag}`)
      console.error('known flags: --out --url --width --height --scale --wait --color-scheme --full --eval --label --css-for --property --both --scrollbars --touch --audit --font')
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
 * Cookies the pre-flight collected from the server's own `Set-Cookie` headers.
 *
 * They exist because `fetch` has no cookie jar and a browser does. A `dsh web`
 * launch URL opens with an exchange — `GET /?token=...` answers 303 plus a
 * `Set-Cookie`, and only that cookie opens the app — so `redirect: 'follow'`
 * lands on `/` carrying nothing, reads the auth wall, and reports a VALID token
 * as a refused one. Replaying the exchange by hand is what the browser does for
 * itself; the probe does it because it has to answer before the browser starts.
 */
const launchCookies = new Map()

/**
 * Whether this URL is the harness's own auth wall rather than the app.
 *
 * Probed BEFORE the browser is launched, on purpose. The other order looks
 * harmless and is not: it burns a browser launch to discover the answer, writes
 * a 9KB text page that reads like a broken render, and only then throws it
 * away — so the failure arrives looking exactly like a layout bug.
 *
 * The redirects are followed HERE rather than by `fetch`, one hop at a time, so
 * the cookie each hop sets can be sent with the next request. Following them is
 * the whole point: the wall is what the LAST response says, and the last
 * response of a launch URL is the app's own.
 */
async function wasAuthWall(url) {
  // Only an http(s) URL can be behind a login. A `file://` render is a local
  // artifact with no server in front of it, and probing it would fail for a
  // reason that has nothing to do with authentication.
  if (!/^https?:\/\//i.test(url)) return false
  try {
    /* One hop is what this handshake takes; the cap is here so a server that
       redirects in a circle cannot spin this loop forever. A chain that never
       lands is not this wall — the browser gets to say what that URL is. */
    const MAX_HOPS = 5
    let target = url
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const cookie = [...launchCookies].map(([name, value]) => `${name}=${value}`).join('; ')
      const response = await fetch(target, {
        redirect: 'manual',
        ...(cookie === '' ? {} : { headers: { cookie } }),
      })
      for (const header of response.headers.getSetCookie()) {
        // Only the pair before the first `;`: the attributes belong to the
        // browser's own rules, which are not this loop's business.
        const pair = header.split(';')[0] ?? ''
        const at = pair.indexOf('=')
        if (at > 0) launchCookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim())
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (location === null) return false
        target = new URL(location, target).href
        continue
      }
      if (response.status === 401) return true
      const body = await response.text()
      return body.includes('dsh web authentication required')
    }
    return false
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
  /* LEAVE BY DRAINING, NOT BY `process.exit`.
   *
   * The probe's own connection is still being torn down at this instant, and
   * leaving the process during that teardown aborts on a platform assertion
   * (Windows: `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, and a
   * crash code where the 6 belongs) — the same class of hazard `shutdown()`
   * below exists to avoid. Setting the code and leaving the module pending hands
   * the ending to Node: with nothing else on the loop, the process ends by
   * itself and the code above is what the caller sees. */
  process.exitCode = 6
  await new Promise(() => {})
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
  /* Scrollbars are hidden by default: a scroll region's bar is a platform
   * overlay whose width would pollute every geometry this tool measures (and in
   * a `--full` page shot it is pure noise). `--scrollbars` keeps them, because a
   * styled bar is a thing a reader SEES: the shared grammar's track inset, the
   * theme's thumb colour and the arrow-button suppression are only visible with
   * the platform's own bars turned back on. */
  ...(args.scrollbars ? [] : ['--hide-scrollbars']),
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

  /* THE WIDTHS THIS RUN photographs. `--both` claims the loop's own pair — the
   * asked band and the narrow 412 — and derives both names from the SAME --out
   * prefix, so one run covers hybrid rule 11's two-band promise. A name that
   * does not end in .png is left alone (the extension rule below still applies
   * per file). */
  const shots = args.both
    ? [
        { width: Number(args.width), out: args.out.replace(/\.png$/i, '-wide.png') },
        { width: 412, out: args.out.replace(/\.png$/i, '-narrow.png') },
      ]
    : [{ width: Number(args.width), out: args.out }]

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

  for (const shot of shots) {
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
  /* THE POINTER CAPABILITY IS WHAT MAKES A PHONE, AND `--width` CANNOT SET IT.
   * `mobile: true` only tells the engine "this viewport is a phone's" (it turns
   * on meta-viewport handling); `(hover: none) and (pointer: coarse)` answers
   * from the INPUT DEVICE, which stays a mouse until touch emulation is on.
   * Measured at `--width 412` before this flag existed: `both: false`,
   * `maxTouchPoints: 0`, `canHover: true`. */
  const touch = args.touch
  const mobileViewport = touch || shot.width < 600
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: shot.width,
    height: Number(args.height),
    deviceScaleFactor: Number(args.scale),
    mobile: mobileViewport,
    ...(mobileViewport ? { screenWidth: shot.width, screenHeight: Number(args.height) } : {}),
  }, sessionId)
  if (touch) {
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId)
  }
  await browser.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: args.colorScheme },
      ...(touch ? [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }] : []),
    ],
  }, sessionId)

  const loaded = new Promise(done => browser.on('Page.loadEventFired', done))
  await browser.send('Page.navigate', { url: args.url }, sessionId)
  await Promise.race([loaded, new Promise(done => setTimeout(done, 30000))])
  await new Promise(done => setTimeout(done, Number(args.wait)))

  if (args.font !== '') {
    /* 字体必须在**量之前**换好，而且要在字体真的加载完之后再量（`document.fonts.ready`），
     * 否则量到的是一次回退字体的读数——那比不换还糟。 */
    await browser.send('Runtime.evaluate', {
      expression: `(() => {
        const s = document.createElement('style')
        s.setAttribute('data-dsh-tb-font', '')
        s.textContent = ${JSON.stringify(`*{font-family:${args.font} !important}`)}
        document.head.appendChild(s)
        return document.fonts.ready.then(() => getComputedStyle(document.body).fontFamily)
      })()`,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId)
    await new Promise(done => setTimeout(done, 300))
  }

  /* `--eval-file` READS THE SCRIPT FROM A FILE, and it exists because the other
   * spelling of the same thing is a trap: 一段要量的 JS 从 shell 传进来，先要过引号与
   * 转义，而 PowerShell 上更要过 `Out-File` 的编码——那会**静默**加上 BOM 并把行尾
   * 改成 CRLF（硬性规范 10 点名的头两种），于是 `pnpm verify` 的编码审计读到几个
   * 探针文件，而报的是「文件编码坏了」而不是「你在用 shell 传代码」。
   *
   * 所以内容一律走文件：文件由文件工具写（LF、无 BOM），脚本只收路径。 */
  const evalSource = args.evalFile !== ''
    ? readFileSync(args.evalFile, 'utf8').replace(/^\uFEFF/, '')
    : args.eval !== ''
      ? args.eval
      : args.audit
        ? readFileSync(AUDIT_PROBE, 'utf8').replace(/^\uFEFF/, '')
        : ''
  if (evalSource !== '') {
    const result = await browser.send('Runtime.evaluate', {
      expression: evalSource,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId)
    if (result.exceptionDetails !== undefined) {
      /* 「Uncaught」不是一条错误信息，它是一句「出事了」。探针抛出来的那句话与栈在
       * `exception.description` 里——不打印它，量的人就只能靠猜（这一条是真栽过的）。 */
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'unknown'
      console.error(`shot-panel: --eval threw: ${detail.split('\n').slice(0, 4).join(' | ')}`)
      /* AN AUDIT THAT COULD NOT RUN MUST NOT LOOK LIKE A PASS. A zero exit and
       * a missing file are different facts, and only one of them means "clean". */
      if (args.audit) await finish(8)
    } else if (result.result?.value !== undefined) {
      const value = result.result.value
      if (args.audit) {
        const auditOut = `${shot.out.replace(/\.png$/i, '')}.audit.json`
        writeFileSync(auditOut, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
        console.error(`shot-panel: audit -> ${auditOut}`)
        console.error(`shot-panel: audit pass = ${JSON.stringify(value?.pass ?? null)}`)
      } else {
        console.error(`shot-panel: --eval -> ${JSON.stringify(value)}`)
      }
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

  const shotData = await browser.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: args.full,
  }, sessionId)
  writeFileSync(shot.out, Buffer.from(shotData.data, 'base64'))
  console.error(`shot-panel: wrote ${shot.out} (${shot.width}x${Number(args.height)} @${Number(args.scale)}x, ${args.colorScheme})`)
  }

  await finish(0)
} catch (error) {
  console.error(`shot-panel: ${error instanceof Error ? error.message : String(error)}`)
  await finish(5)
}
