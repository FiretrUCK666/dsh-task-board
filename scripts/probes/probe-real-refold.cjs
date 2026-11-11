// 造页器：**真实事件 + 真实折轮 + 真实 3 秒到达**，只改一件事：每轮到达时怎么复算。
//
// ── 我在前几个探针里漏掉的那一步 ──────────────────────────────────────────────
//
// 前面用造的内容量「轮询到达」，结果全绿。但那一版里，我让**只有末尾那一轮**是新的
// 对象（`useMemo(..., [turnCount])`），前面那些轮的对象身份一直没变——于是
// `TurnItem` 的 memo 全部命中，React 几乎什么都没做。
//
// 真页不是那样。`use-transcript.tsx` 里是：
//
//     const turns = useMemo(() => foldTurns(events), [events])
//
// 每次轮询回来 `events` 都是一个**新数组**，`foldTurns` 就把**整个窗口**重新折一
// 遍，产出**每一轮都是新对象**的列表。`TurnItem` 的 memo 按对象身份比，于是
// **整条历史每 3 秒重画一次**——而读者正在这条历史里面上下滑动。
//
// 所以这一页用一条**真实会话日志**的**真实事件**，两档只改这一步：
//
//   ?refold=all    每轮到达重折整个窗口（今天的行为）
//   ?refold=keep   未变的前缀沿用上一轮折出来的对象（候选改法）
//
// 用法：
//   node scripts/probes/probe-real-refold.cjs

const fs = require('node:fs')
const path = require('node:path')
const { homedir } = require('node:os')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'real-refold')
const LOG_NAME = 'session.v4.jsonl.zstd'

/** 一条真实会话日志：最近改动、够大的那一条。 */
function pickLog() {
  const root = path.join(homedir(), '.dsh', 'sessions')
  const found = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!entry.name.startsWith(LOG_NAME)) continue
      try {
        const stat = fs.statSync(full)
        if (stat.size > 200_000) found.push({ path: full, mtimeMs: stat.mtimeMs })
      } catch { /* skip */ }
    }
  }
  walk(root, 0)
  found.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return found[0]?.path
}

/** zstd 或纯 jsonl 都可能；读成宿主交给客户端的那种事件形状。 */
function readEvents(file) {
  const raw = fs.readFileSync(file)
  const looksZstd = raw[0] === 0x28 && raw[1] === 0xb5 && raw[2] === 0x2f && raw[3] === 0xfd
  const zlib = require('node:zlib')
  const text = (looksZstd ? zlib.zstdDecompressSync(raw) : raw).toString('utf8')
  const events = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const entry = JSON.parse(trimmed)
      events.push({ type: entry.type, seq: entry.seq, time: entry.time, data: entry.data })
    } catch { /* torn tail */ }
  }
  return events
}

const ENTRY = `
import { createElement, useCallback, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { SessionTranscript } from '../../src/client/board/session-panel.tsx'
import { foldTurns } from '../../src/client/board/review-transcript.ts'
import { DEFAULT_WORK_STEPS } from '../../src/client/board/work-steps.ts'
import css from '../../src/client/board.module.css'
import '../../src/client/design/base.module.css'
import tokens from '../../src/client/design/tokens.module.css?inline'
const EVENTS = window.__EVENTS ?? []

const tokensStyle = document.createElement('style')
tokensStyle.textContent = tokens
document.head.appendChild(tokensStyle)

const PARAMS = new URLSearchParams(location.search)
const REFOLD = PARAMS.get('refold') === 'keep' ? 'keep' : 'all'
/* How many real events one arrival brings. The host's poll returns everything new
   since the last read; two to five is what that looks like in a live session. */
const STEP = Number(PARAMS.get('step') ?? '3')
const START = Number(PARAMS.get('start') ?? '140')

const controller = {
  loadImage: async () => undefined,
  attachmentsAvailable: () => false,
  markTaskSessionViewed: () => undefined,
}

/** The candidate: keep the fold for the prefix that did not change.
 *
 *  A turn is identified by its own turn number plus how many events it saw. If the
 *  window only GREW at the end, every earlier turn's inputs are identical, so its
 *  object is still correct — and keeping the object is what lets the memo hit. */
function foldKeeping(previous, events) {
  const next = foldTurns(events)
  if (previous === undefined) return next
  const byTurn = new Map(previous.map(turn => [turn.turn, turn]))
  return next.map((turn, index) => {
    const old = byTurn.get(turn.turn)
    if (old === undefined) return turn
    /* Only the LAST turn can have grown; anything earlier with the same item count
       and the same end marker is the same content. */
    const sameCount = old.replies.length === turn.replies.length
      && old.steps.length === turn.steps.length
      && old.interjections.length === turn.interjections.length
    const sameEnd = old.endedAt === turn.endedAt && old.endReason === turn.endReason
    if (sameCount && sameEnd && index < next.length - 1) return old
    return turn
  })
}

const draws = { list: 0 }
window.__draws = () => draws.list

function Surface() {
  draws.list += 1
  const [count, setCount] = useState(START)
  const previousRef = useRef(undefined)

  const turns = useMemo(() => {
    const window = EVENTS.slice(0, count)
    if (REFOLD === 'all') return foldTurns(window)
    const next = foldKeeping(previousRef.current, window)
    previousRef.current = next
    return next
  }, [count])

  /* One arrival = advance the window over REAL events, which is exactly what the
     3s poll does to the events array. */
  window.__arrive = useCallback(() => {
    setCount(current => Math.min(EVENTS.length, current + STEP))
  }, [])

  return createElement('div', { className: css.reviewTranscriptScroll, id: 'transcript' },
    createElement(SessionTranscript, {
      turns,
      error: false,
      sessionId: 'sess-1',
      controller,
      prefs: DEFAULT_WORK_STEPS,
    }))
}

createRoot(document.getElementById('root')).render(createElement(Surface))
/* The measurement door: render + commit NOW, so timing it measures the work rather
   than the scheduler. Exposed here because the analysis script cannot import react. */
window.__flushArrive = () => { flushSync(() => { window.__arrive() }); void document.getElementById('transcript').scrollHeight }
window.__refold = REFOLD
window.__step = STEP
window.__total = EVENTS.length
window.__mounted = true
`

const HTML = (css, bundle, payload) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<style>
  html, body { margin: 0; block-size: 100%; }
  body { display: flex; flex-direction: column; overflow: hidden; background: var(--dsh-tb-bg); }
  #root { block-size: 100%; min-block-size: 0; }
  /* OWN the scroll box: the module's class names are hashed, so styling
     .reviewTranscriptScroll from this sheet silently matches nothing. */
  .reviewTranscriptScroll { block-size: 100%; }
</style></head><body>
<div data-dsh-taskboard-view style="position:relative;flex:1;min-block-size:0"><div id="root"></div></div>
<script>
  window.__errors = []
  window.addEventListener('error', (event) => {
    window.__errors.push(String(event.message || event.error || 'error'))
  })
</script>
<script>window.__EVENTS = ${payload};</script>
<script>${bundle}</script>
</body></html>`

/** 宿主的令牌表：本插件每个 `--dsh-tb-*` 都从 `--dsw-*` 派生，缺了它颜色全是空的。 */
function hostThemeCss() {
  const candidates = [
    path.join(process.env.APPDATA ?? '', 'npm', 'node_modules'),
    path.join(process.env.HOME ?? '', '.npm', 'node_modules'),
  ]
  const bundle = candidates
    .map(root => path.join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js'))
    .find(one => fs.existsSync(one))
  if (bundle === undefined) return ''
  const source = fs.readFileSync(bundle, 'utf8')
  const sheets = []
  for (const match of source.matchAll(/(\w+)_css_default\s*=\s*"/g)) {
    const open = match.index + match[0].length - 1
    let end = open + 1
    while (end < source.length) {
      if (source[end] === '\\') { end += 2; continue }
      if (source[end] === '"') break
      end += 1
    }
    try { sheets.push(JSON.parse(source.slice(open, end + 1))) } catch { /* skip */ }
  }
  return sheets.join('\n')
}

function resolveVite() {
  try {
    const require_ = require('node:module').createRequire(require.resolve('vitest'))
    return require_('vite')
  } catch {
    return undefined
  }
}

async function main() {
  const vite = resolveVite()
  if (vite === undefined) {
    console.error('probe-real-refold: SKIP — 解析不到 vite。这一页没有造出来，所以什么都没量到。')
    process.exit(2)
  }
  const log = pickLog()
  if (log === undefined) {
    console.error('probe-real-refold: SKIP — 这台机器上没有可读的会话日志，所以没有真实事件可用。')
    process.exit(2)
  }
  const events = readEvents(log)
  if (events.length < 300) {
    console.error(`probe-real-refold: SKIP — 挑到的日志只有 ${events.length} 条事件，不够一个窗口。`)
    process.exit(2)
  }

  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'entry.tsx'), ENTRY, 'utf8')

  await vite.build({
    root: ROOT,
    configFile: false,
    mode: 'production',
    logLevel: 'warn',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env': '{}',
    },
    build: {
      outDir: OUT,
      emptyOutDir: false,
      minify: false,
      target: 'chrome120',
      lib: {
        entry: path.join(OUT, 'entry.tsx'),
        formats: ['iife'],
        name: 'RealRefoldProbe',
        fileName: () => 'bundle.js',
      },
    },
  })

  const cssFiles = fs.readdirSync(OUT).filter(name => name.endsWith('.css'))
  if (cssFiles.length === 0) {
    console.error('probe-real-refold: 打包没有产出样式表，这一页没有本插件的样式，不拍了。')
    process.exit(2)
  }
  const css = [hostThemeCss(), ...cssFiles.map(name => fs.readFileSync(path.join(OUT, name), 'utf8'))].join('\n')
  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'real-refold.html')
  /* Real events carry markup — including tag-openers — in tool output and in the
     assistant's own text. Embedding that verbatim ends the script element early and
     the page dies with a syntax error, which reads as "the bundle did not load".
     Escaping the angle bracket as a JSON unicode escape keeps it inert while still
     parsing back to the same string. */
  const payload = JSON.stringify(events).replaceAll('<', '\\u003c')
  fs.writeFileSync(page, HTML(css, bundle, payload), 'utf8')

  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')} (${events.length} real events)`)
  console.log('now (same real events, one variable — how an arrival recomputes):')
  console.log(`  node scripts/shot-panel.mjs --url "${url}?refold=all" --eval-file scripts/probes/probe-real-refold.js --width 1440 --height 900 --scrollbars --out tmp/refold-all.png`)
  console.log(`  node scripts/shot-panel.mjs --url "${url}?refold=keep" --eval-file scripts/probes/probe-real-refold.js --width 1440 --height 900 --scrollbars --out tmp/refold-keep.png`)
}

main().catch((error) => {
  console.error(`probe-real-refold: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
