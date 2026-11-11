// 造页器：把**同一份** `useBoardSnapshot` / `useCovered` / `useCover` 打进真页。
//
// ── 它比 `tests/cover.spec.ts` 多的那一点 ────────────────────────────────────
//
// 那条 spec 证明契约（一个入口、同步读取、三个壳都登记），但它跑在 jsdom 里：没有第二
// 次真实提交、没有真实的 `useSyncExternalStore` 时序，所以「一条通知到底有没有穿过那层
// 订阅」它答不了。这一支把 `src/` 里同一份 hook 打进真 React 页，然后发真通知。
//
// ── 为什么用 vite ────────────────────────────────────────────────────────────
//
// 抄一份 hook 进页面就等于量一个已经不存在的东西。`vite` 是本仓库直接依赖 `vitest` 自带的
// 构建器，读不到就明说 SKIP（退出码 2），不假装量过。
//
// 用法：
//   node scripts/probes/probe-covered-board.cjs
//   然后按它打印的那条命令交给 Chromium。

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'covered-board')

/* 入口：一块最小的「看板」（它订阅快照并把自己画了几次记在 window 上）+ 一层浮层
   （它登记覆盖，正好是三个真壳做的事）。 */
const ENTRY = `
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { useBoardSnapshot } from '../../src/client/board/use-board-snapshot.ts'
import { useCover, useCovered } from '../../src/client/design/cover.ts'

/* ONE controller stub, and it is the real interface the seam uses: a cached
   getSnapshot plus a subscribe that hands back a disposer. Nothing here knows
   about React — the subscription discipline is the thing under test. */
let revision = 0
let cached = { revision: 0, tasks: [] }
const listeners = new Set()
const controller = {
  getSnapshot() {
    if (cached.revision !== revision) cached = { revision, tasks: [] }
    return cached
  },
  subscribe(listener) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
}

const draws = { board: 0 }
let showOverlay = false
let shownRevision = -1

function Board() {
  draws.board += 1
  const held = useCovered()
  const snapshot = useBoardSnapshot(controller, held)
  shownRevision = snapshot === undefined ? -1 : snapshot.revision
  return createElement('p', { id: 'board' }, 'board r' + String(shownRevision) + (held ? ' (held)' : ''))
}

/* The overlay: a shell that registers its cover while open, exactly as
   Dialog / TaskDetail / SessionFrame do. The layer name is what the registry
   keys on now — a boolean could only ever answer for the bottom layer. */
function Overlay() {
  useCover('panel')
  return createElement('p', { id: 'overlay' }, 'overlay')
}

function App() {
  const covered = useCovered()
  return createElement('div', null,
    createElement(Board),
    showOverlay ? createElement(Overlay) : null,
    createElement('span', { id: 'covered' }, String(covered)),
  )
}

const root = createRoot(document.getElementById('root'))
const paint = () => root.render(createElement(App))

window.__probe = {
  draws: () => draws.board,
  revision: () => revision,
  shownRevision: () => shownRevision,
  /* One controller notification: bump the revision, drop the cache, wake everyone. */
  notify: () => {
    revision += 1
    for (const listener of [...listeners]) listener()
  },
  openOverlay: () => { showOverlay = true; paint() },
  closeOverlay: () => { showOverlay = false; paint() },
  /* The LIVE answer at call time, not a snapshot taken when the page loaded:
     the probe asks this after opening and again after closing. */
  coveredNow: () => document.getElementById('covered').textContent === 'true',
}

paint()
window.__mounted = true
`

const HTML = (bundle) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; font: 13px system-ui; padding: 12px; }
  #root > div { display: flex; flex-direction: column; gap: 8px; }
</style></head><body>
<div id="root"></div>
<script>
  /* 打包产物若在挂载时抛，页面会是一片空白——而空白与「没有内容」在截图上长得一样。
     所以先架一张网，把第一句错误留在页面上，供量器取走。 */
  window.__errors = []
  window.addEventListener('error', (event) => {
    window.__errors.push(String(event.message || event.error || 'error'))
  })
</script>
<script>${bundle}</script>
</body></html>`

/** `vite` 是 `vitest` 自带的构建器：从它那里解析，不引入新依赖。 */
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
    console.error('probe-covered-board: SKIP — 解析不到 vite（它是 vitest 自带的构建器）。这一页没有造出来，所以什么都没量到。')
    process.exit(2)
  }
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'entry.tsx'), ENTRY, 'utf8')

  await vite.build({
    root: ROOT,
    configFile: false,
    mode: 'production',
    logLevel: 'warn',
    /* 浏览器里没有 `process`。插件的源码不读它，但打包进来的库会——不定义的话页面
       在挂载那一句就抛，截出来是一片空白。 */
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
        name: 'CoveredBoardProbe',
        fileName: () => 'bundle.js',
      },
    },
  })

  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'covered-board.html')
  fs.writeFileSync(page, HTML(bundle), 'utf8')

  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')}`)
  console.log('now:')
  console.log(`  node scripts/shot-panel.mjs --url ${url} --eval-file scripts/probes/probe-covered-board.js --width 900 --height 600 --audit --out tmp/covered-board.png`)
}

main().catch((error) => {
  console.error(`probe-covered-board: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
