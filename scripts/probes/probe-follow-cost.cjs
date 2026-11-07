// 真页 + 真源码：数一圈「跟随滚动」到底每帧花了多少次布局读取、开了几个观察者。
//
// ── 它回答的那一个问题 ────────────────────────────────────────────────────────
//
// 「同一个职责有几个执行者」这件事，读源码是数不准的：`resolveScroller` 在源码里
// 只写了一次，但它住在每帧的回调里，于是**每帧执行一次**；两个 `ResizeObserver`
// 在源码里长得不一样，实际却可能在观察同一个节点。
//
// 所以这支探针在页面上**先装计数器**（`getComputedStyle` 的包装、`ResizeObserver`
// 的包装），再让真组件跑一段真手势，最后把次数读出来。
//
// ── 它复用哪一份代码 ──────────────────────────────────────────────────────────
//
// `src/` 里**同一份** `useFollowScroll` / `TailFrame`，用 vite 打包（`.module.css`
// 的类名由打包器统一发，所以组件拿到的名字与样式表里的一致）。手抄一份就等于量一个
// 已经不存在的东西。
//
// 用法：
//   node scripts/probes/probe-follow-cost.cjs
//   然后按它打印的那条命令交给 Chromium。

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'follow-cost')

/** 宿主的令牌表：本插件每个 --dsh-tb-* 都从 --dsw-* 派生，缺了它颜色全是空的。 */
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

const ENTRY = `
import { createElement, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TailFrame, useFollowScroll } from '../../src/client/board/use-transcript.tsx'
import css from '../../src/client/board.module.css'
import tokens from '../../src/client/design/tokens.module.css?inline'

const tokensStyle = document.createElement('style')
tokensStyle.textContent = tokens
document.head.appendChild(tokensStyle)

const ROWS = 60
const rows = Array.from({ length: ROWS }, (_unused, index) =>
  createElement('li', { key: index, className: css.reviewComment },
    createElement('p', { className: css.mdParagraph },
      '第 ' + (index + 1) + ' 条评论：这一行故意写得长一点，让每一条都换到两三行，接近真实评论在窄栏里的高度。')),
)

function Panel() {
  const scrollRef = useRef(null)
  const [key] = useState('window-1')
  const pin = useFollowScroll(scrollRef, key)
  return createElement(TailFrame, { pin },
    createElement('div', { className: css.commentsScroll, ref: scrollRef, id: 'comments' },
      createElement('ul', { className: css.reviewComments }, rows),
    ),
  )
}

createRoot(document.getElementById('root')).render(createElement(Panel))
window.__mounted = true
`

const HTML = (css, bundle) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<style>
  body { margin: 0; background: var(--dsh-tb-bg-canvas, #f6f6f6); }
  #root { padding: 12px; }
  #root > div { width: min(344px, 46cqw); height: 520px; }
  @media (max-width: 600px) { #root > div { width: auto; height: 420px; } }
</style></head><body>
<!-- 计数器必须在组件挂载**之前**装好：它数的是这一整段（含挂载）。 -->
<script>
  window.__errors = []
  window.addEventListener('error', (event) => { window.__errors.push(String(event.message || event.error || 'error')) })
  window.__counted = { getComputedStyle: 0, observers: 0, observedNodes: 0 }
  const realGCS = window.getComputedStyle.bind(window)
  window.getComputedStyle = function countedGetComputedStyle(...args) {
    window.__counted.getComputedStyle += 1
    return realGCS(...args)
  }
  const RealRO = window.ResizeObserver
  if (RealRO !== undefined) {
    window.ResizeObserver = class CountedResizeObserver extends RealRO {
      constructor(callback) {
        window.__counted.observers += 1
        super(callback)
      }
      observe(...args) {
        window.__counted.observedNodes += 1
        return super.observe(...args)
      }
    }
  }
</script>
<div data-dsh-taskboard-view data-dsh-taskboard-panel><div id="root"></div></div>
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
    console.error('probe-follow-cost: SKIP — 解析不到 vite（它是 vitest 自带的构建器）。这一页没有造出来。')
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
        name: 'FollowCostProbe',
        fileName: () => 'bundle.js',
      },
    },
  })

  const cssFiles = fs.readdirSync(OUT).filter(name => name.endsWith('.css'))
  if (cssFiles.length === 0) {
    console.error('probe-follow-cost: 打包没有产出样式表，这一页没有本插件的样式，不量了。')
    process.exit(2)
  }
  const css = [hostThemeCss(), ...cssFiles.map(name => fs.readFileSync(path.join(OUT, name), 'utf8'))].join('\n')
  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'follow-cost.html')
  fs.writeFileSync(page, HTML(css, bundle), 'utf8')

  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')}`)
  console.log('now:')
  console.log(`  node scripts/shot-panel.mjs --url ${url} --eval-file scripts/probes/probe-follow-cost.js --width 1200 --height 700`)
}

main().catch((error) => {
  console.error(`probe-follow-cost: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
})
