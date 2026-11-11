// 造页器：**滚动条是自定义画的，还是引擎画的** —— 只改这一个变量。
//
// ── 它回答的那一个问题 ────────────────────────────────────────────────────────
//
// 读者圈出来的是**那根移动条**跳帧，不是内容停住。这两件事在浏览器里可以分开：
//
//   · 内容在**合成线程**上滚，主线程忙不忙都跟得上；
//   · 滚动条如果用 `::-webkit-scrollbar` 自定义画，它就变成一张**画出来的位图**，
//     由主线程栅格化（Chromium 自己的文档与 issue 都这么说）。
//
// 于是主线程每次有点活（这里每 3 秒一次的轮询就是），那根条的位图就要重栅一次，而内容
// 照旧丝滑——读者看到的正是「滑动条一抽一抽」。
//
// 这一页只改一件事：
//
//   ?bar=custom   本插件今天的样子（`::-webkit-scrollbar` 全套）
//   ?bar=native   交给引擎画（不碰任何滚动条伪元素）
//
// 两档的内容、尺寸、手势、主线程负载都一模一样。
//
// 用法：
//   node scripts/probes/probe-scrollbar-paint.cjs

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'scrollbar-paint')

const ENTRY = `
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

const PARAMS = new URLSearchParams(location.search)
const BAR = PARAMS.get('bar') === 'native' ? 'native' : 'custom'
/* Main-thread load per frame, in ms. The real panel has a 3s poll plus React work;
   this stands in for it so the two variants see the same thing. */
const LOAD_MS = Number(PARAMS.get('load') ?? '6')

function burn(ms) {
  if (ms <= 0) return
  const start = performance.now()
  while (performance.now() - start < ms) { /* spin */ }
}

function Row({ index }) {
  return createElement('div', { className: 'row' },
    createElement('strong', null, '第 ' + String(index + 1) + ' 行'),
    createElement('p', null, '这一页只是为了让滚动条有得滚；内容本身没有意义，只有高度有意义。'))
}

createRoot(document.getElementById('root')).render(
  createElement('div', { id: 'scroller', 'data-bar': BAR },
    Array.from({ length: 240 }, (_u, index) => createElement(Row, { key: index, index }))),
)

/* The load rides the frame loop, like an expensive render does. */
const tick = () => { burn(LOAD_MS); requestAnimationFrame(tick) }
requestAnimationFrame(tick)

window.__bar = BAR
window.__loadMs = LOAD_MS
window.__mounted = true
`

const HTML = (bundle) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; block-size: 100%; }
  body { display: flex; flex-direction: column; font: 14px/1.7 system-ui, sans-serif; background: #fbfbfc; color: #1b1d21; }
  #root { block-size: 100%; min-block-size: 0; }
  #scroller { block-size: 100%; overflow-y: auto; padding: 12px 20px; }
  .row { padding: 10px 0; border-block-end: 1px solid #e6e8eb; }
  .row p { margin: 4px 0 0; }

  /* THE ONLY DIFFERENCE BETWEEN THE TWO VARIANTS: whether the bar is drawn by us.
     The declarations below are the project's own scrollbar recipe, copied so the
     look is identical; the native variant simply never matches them. */
  #scroller[data-bar='custom']::-webkit-scrollbar { width: 10px; height: 10px; }
  #scroller[data-bar='custom']::-webkit-scrollbar-thumb {
    background-color: rgba(27, 29, 33, 0.28);
    border-radius: 999px;
    min-block-size: 2rem;
  }
  #scroller[data-bar='custom']::-webkit-scrollbar-track { background: transparent; }
  #scroller[data-bar='custom']::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
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
    console.error('probe-scrollbar-paint: SKIP — 解析不到 vite。这一页没有造出来，所以什么都没量到。')
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
        name: 'ScrollbarPaintProbe',
        fileName: () => 'bundle.js',
      },
    },
  })

  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'scrollbar-paint.html')
  fs.writeFileSync(page, HTML(bundle), 'utf8')

  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')}`)
  console.log('now (same content, same gesture, same main-thread load):')
  console.log(`  node scripts/shot-panel.mjs --url "${url}?bar=custom" --eval-file scripts/probes/probe-scrollbar-paint.js --width 900 --height 700 --scrollbars --out tmp/bar-custom.png`)
  console.log(`  node scripts/shot-panel.mjs --url "${url}?bar=native" --eval-file scripts/probes/probe-scrollbar-paint.js --width 900 --height 700 --scrollbars --out tmp/bar-native.png`)
}

main().catch((error) => {
  console.error(`probe-scrollbar-paint: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
