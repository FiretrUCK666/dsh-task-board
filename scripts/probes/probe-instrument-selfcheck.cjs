// 造页器：**仪器自检** —— 这一页是故意慢的。
//
// ── 它回答的那一个问题 ────────────────────────────────────────────────────────
//
// 前面六个探针全都报「零丢帧、零长任务」。这有两种可能：
//
//   1. 那些表面真的不卡；
//   2. **我的仪器量不出卡**。
//
// 第二种可能必须先被排除，否则前面每一个 0 都只是「没量到」，而报告里它们长得和
// 「量到了，是 0」一模一样。
//
// 所以这一页故意烧主线程：`?burn=0` 什么都不做，`?burn=12` 每次 rAF 回调里空转 12ms，
// `?burn=60` 空转 60ms（一定超过一帧预算）。判据只有一条：**烧得越多，仪器报的坏帧
// 就必须越多**。它报不出来，前面所有读数就作废。
//
// 用法：
//   node scripts/probes/probe-instrument-selfcheck.cjs
//   然后按它打印的三条命令交给 Chromium。

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'instrument-selfcheck')

const ENTRY = `
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

const PARAMS = new URLSearchParams(location.search)
const BURN_MS = Number(PARAMS.get('burn') ?? '0')

/* A real busy loop, not a timer: this is what the main thread looks like when a
   render is expensive. Only the clock can prove it spun. */
function burn(ms) {
  if (ms <= 0) return
  const start = performance.now()
  while (performance.now() - start < ms) { /* spin */ }
}
window.__burnMs = BURN_MS
window.__burn = burn

function Row({ index }) {
  return createElement('div', { style: { padding: '8px 12px', borderBlockEnd: '1px solid #eee' } },
    '第 ' + String(index + 1) + ' 行：这一页只是为了让滚动条出现，内容本身没有意义。')
}

createRoot(document.getElementById('root')).render(
  createElement('div', { id: 'scroller' },
    Array.from({ length: 400 }, (_u, index) => createElement(Row, { key: index, index }))),
)
window.__mounted = true
`

const HTML = (bundle) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; block-size: 100%; }
  body { display: flex; flex-direction: column; font: 14px/1.6 system-ui, sans-serif; }
  #root { block-size: 100%; min-block-size: 0; }
  #scroller { block-size: 100%; overflow-y: auto; }
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
    console.error('probe-instrument-selfcheck: SKIP — 解析不到 vite。这一页没有造出来，所以什么都没量到。')
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
        name: 'InstrumentSelfcheck',
        fileName: () => 'bundle.js',
      },
    },
  })

  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'instrument-selfcheck.html')
  fs.writeFileSync(page, HTML(bundle), 'utf8')

  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')}`)
  console.log('now (the instrument must go red as the burn grows):')
  console.log(`  node scripts/shot-panel.mjs --url "${url}?burn=0" --eval-file scripts/probes/probe-instrument-selfcheck.js --width 900 --height 700 --scrollbars --out tmp/selfcheck-0.png`)
  console.log(`  node scripts/shot-panel.mjs --url "${url}?burn=12" --eval-file scripts/probes/probe-instrument-selfcheck.js --width 900 --height 700 --scrollbars --out tmp/selfcheck-12.png`)
  console.log(`  node scripts/shot-panel.mjs --url "${url}?burn=60" --eval-file scripts/probes/probe-instrument-selfcheck.js --width 900 --height 700 --scrollbars --out tmp/selfcheck-60.png`)
}

main().catch((error) => {
  console.error(`probe-instrument-selfcheck: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
