// 造页器：把**关闭按钮那条路**装进一张真页，然后真的按下去。
//
// ── 它回答的那一个问题 ────────────────────────────────────────────────────────
//
// 「盖着就一个字的活都不干」写成 `if (held) return` 之后，屏上出现的是**另一个** bug：
// 点叉号、点空白处都关不掉卡片详情。原因不在 `TaskDetail` 的 JSX 里——关闭是
// `closeTask()` 写一个字段再发一次通知，而那条通知被那层订阅整个吞掉了。
//
// 所以这一页 import 的是 `src/` 里**同一份** `useBoardSnapshot` / `useCover` /
// `useCovered`，配一个只说这几种话的 controller stub。判据是「按下去，那一层真的没了」——
// 静态扫描永远看不见这件事，因为它需要一次真实的点击与一次真实的提交。
//
// ── 为什么还要能跑出红的 ──────────────────────────────────────────────────────
//
// 传 `--old` 时，页面用**旧实现**（`if (held) return`）替换那份 hook——一份抄在最上面的
// 旧函数。它必须让 C3/C4 变红，否则这条判据只是碰巧通过。反面证据作在探针里，不在 `src/`。
//
// 用法：
//   node scripts/probes/probe-close-path.cjs
//   然后按它打印的两条命令交给 Chromium（新实现 / 旧实现）。

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'close-path')

const ENTRY = `
import { useEffect, useRef, useState, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useBoardSnapshot } from '../../src/client/board/use-board-snapshot.ts'
import { useCover, useCovered } from '../../src/client/design/cover.ts'
import css from '../../src/client/board.module.css'
import components from '../../src/client/design/components.module.css'
import '../../src/client/design/base.module.css'
import tokens from '../../src/client/design/tokens.module.css?inline'

const tokensStyle = document.createElement('style')
tokensStyle.textContent = tokens
document.head.appendChild(tokensStyle)

/* ── ONE controller stub, and it speaks exactly the three sentences this path uses:
 * a cached getSnapshot, a subscribe handing back a disposer, and closeTask writing
 * the field + notifying. That is the whole mechanism the close button depends on. */
let state = {
  tasks: [{ id: 'card-1', title: '把评论区的滚动修好', status: 'todo', priority: 'p2', description: '', prompt: '', columnOrder: 0, createdAt: 0, updatedAt: 0, executions: [], sessions: [] }],
  boardOpen: true,
  selectedTaskId: undefined,
  cruise: { enabled: true, limit: 3, schedule: [] },
  stats: { running: 0, queued: 0 },
  skips: { overlap: 0, missed: 0 },
  heartbeat: { lastOkAt: undefined },
  engine: { held: false, synced: false, hostProto: 2, bootedAt: undefined },
}
let cached
const listeners = new Set()
const controller = {
  getSnapshot() { return (cached ??= state) },
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  /* THE REAL closeTask, reduced to what matters: write the field, drop the cache, notify. */
  closeTask() { state = { ...state, selectedTaskId: undefined }; cached = undefined; for (const one of [...listeners]) one() },
  openTask(id) { state = { ...state, selectedTaskId: id }; cached = undefined; for (const one of [...listeners]) one() },
}

/* ── THE OLD IMPLEMENTATION, kept here on purpose: it is the thing that must go red.
 * Copied verbatim from the version that shipped (a held subscription swallowed
 * EVERYTHING, including the notification that says 「the sheet above you closed」). */
function useBoardSnapshotOld(ctrl, held) {
  const [snapshot, setSnapshot] = useState(() => ctrl?.getSnapshot())
  const heldRef = useRef(held)
  heldRef.current = held
  useEffect(() => {
    if (ctrl === undefined) { setSnapshot(undefined); return undefined }
    setSnapshot(ctrl.getSnapshot())
    return ctrl.subscribe(() => {
      if (heldRef.current) return
      setSnapshot(ctrl.getSnapshot())
    })
  }, [ctrl])
  useEffect(() => {
    if (held || ctrl === undefined) return
    setSnapshot(() => ctrl.getSnapshot())
  }, [ctrl, held])
  return snapshot
}

const MODE = new URLSearchParams(location.search).get('mode') === 'old' ? 'old' : 'new'
const useSnapshot = MODE === 'old' ? useBoardSnapshotOld : useBoardSnapshot

/* The board: it is what gets covered, and it is what decides whether the sheet is
   mounted (the same derivation the product uses: selected id -> the row). */
function Board() {
  const covered = useCovered('board')
  const snapshot = useSnapshot(controller, covered)
  const selected = snapshot?.tasks.find(task => task.id === snapshot.selectedTaskId)
  return createElement('div', { id: 'board', 'data-covered': String(covered) },
    createElement('button', {
      type: 'button', id: 'open',
      onClick: () => { controller.openTask('card-1') },
    }, '打开那张卡'),
    selected === undefined ? null : createElement(Sheet, { key: selected.id, task: selected }))
}

/* The sheet: registers a cover (it covers the board) AND is covered itself by nothing
   right now — so its own subscription is NOT held. The close paths are the product's
   two: the × button and the backdrop. */
function Sheet({ task }) {
  useCover('detail')
  const panelRef = useRef(null)
  return createElement('div', {
    className: components.modalBackdrop,
    id: 'backdrop',
    /* The product's exact gesture: mousedown on the backdrop itself, not a bubbled one. */
    onMouseDown: (event) => { if (event.target === event.currentTarget) controller.closeTask() },
  }, createElement('div', {
    className: components.modal,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': task.title,
    ref: panelRef,
    tabIndex: -1,
    id: 'sheet',
  }, createElement('h2', null, task.title),
  createElement('button', { type: 'button', id: 'close', onClick: () => { controller.closeTask() } }, '关')))
}

function App() {
  return createElement('div', { 'data-dsh-taskboard-view': '' }, createElement(Board))
}

createRoot(document.getElementById('root')).render(createElement(App))
window.__mode = MODE
window.__mounted = true
`

const HTML = (css, bundle) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<style>
  html, body { margin: 0; block-size: 100%; }
  body { display: flex; flex-direction: column; background: var(--dsh-tb-bg); }
  [data-dsh-taskboard-view] { position: relative; flex: 1; min-block-size: 0; padding: 12px; }
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
    console.error('probe-close-path: SKIP — 解析不到 vite（它是 vitest 自带的构建器）。这一页没有造出来，所以什么都没按。')
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
        name: 'ClosePathProbe',
        fileName: () => 'bundle.js',
      },
    },
  })

  const cssFiles = fs.readdirSync(OUT).filter(name => name.endsWith('.css'))
  if (cssFiles.length === 0) {
    console.error('probe-close-path: 打包没有产出样式表，这一页没有本插件的样式，不拍了。')
    process.exit(2)
  }
  const css = [hostThemeCss(), ...cssFiles.map(name => fs.readFileSync(path.join(OUT, name), 'utf8'))].join('\n')
  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'close-path.html')
  fs.writeFileSync(page, HTML(css, bundle), 'utf8')

  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')}`)
  console.log('now (both implementations):')
  console.log(`  node scripts/shot-panel.mjs --url "${url}" --eval-file scripts/probes/probe-close-path.js --width 900 --height 700 --out tmp/close-path.png`)
  console.log(`  node scripts/shot-panel.mjs --url "${url}?mode=old" --eval-file scripts/probes/probe-close-path.js --width 900 --height 700 --out tmp/close-path-old.png`)
}

main().catch((error) => {
  console.error(`probe-close-path: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
