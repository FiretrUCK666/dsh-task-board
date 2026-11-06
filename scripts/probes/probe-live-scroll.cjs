// 真组件、真 React、真样式表：把 `useFollowScroll` 与「滑到最新」装进一张真页里，然后
// 用一段真的滚动手势问三个问题。
//
// ── 它比 `tests/scroll-follow.spec.ts` 多的那一点 ─────────────────────────────
//
// 那条 spec 跑在 jsdom 里：没有排版，几何是桩出来的。它证明的是**组件不再因滚动而
// 重画**（那是对的、也是最快的判据），但它证明不了「在真浏览器里，读者拉那一下时胶囊
// 真的会露出来、真的一帧都不重画内容」。
//
// 这一支把 `src/` 里**同一份** `useFollowScroll` / `TailPill` 打进真页，量三件事：
//
//   L1 一段从末尾往上拉的手势里，持有 pin 的那个组件重画 **0 次**
//   L2 那同一段手势里胶囊从隐藏变显示（不是靠「不更新」换来的安静）
//   L3 拉回末尾时胶囊再藏起来，那个组件仍然重画 **0 次**
//
// ── 为什么用 vite，而不是手搓 ────────────────────────────────────────────────
//
// 页面里必须是**真实现**：把 hook 抄一份进页面就等于量一个已经不存在的东西。所以要
// 一个真的打包器，它能处理 `.tsx` 与 `.module.css`（类名要由打包器统一发，组件拿到的
// 名字才与样式表里的名字一致）。`vite` 是本仓库直接依赖 `vitest` 自带的构建器，
// 版本随安装走、不引入新依赖；读不到就明说 SKIP，不假装量过。
//
// 用法：
//   node scripts/probes/probe-live-scroll.cjs
//   然后按它打印的那条命令交给 Chromium。

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'live-scroll')

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

/* 入口：一个「面板」（它持有 pin，并把自己画了几次记在 window 上）+ 那枚胶囊，
   配上 60 行评论给它当内容。

   类名**从样式表模块里取**，不手写：本项目的类名按表名哈希过，写死一个
   `commentsScroll` 只会得到一个没有样式的普通盒子——于是滚动区根本不滚，量到的
   「读者拉得动吗」全是假的（第一版就是这么错的：滚了 20 格，距离一点没变）。 */
const ENTRY = `
import { createElement, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TailFrame, useFollowScroll } from '../../src/client/board/use-transcript.tsx'
import css from '../../src/client/board.module.css'
/* THE TOKEN SHEET IS INJECTED BY HAND, because a lib-mode build only emits CSS that
   something still references — a pure variable sheet named by a CSS module import is
   not among them, and the page then renders with every plugin token unresolved. That
   failure is silent in the worst way: the layout is right, the colours and radii are
   simply gone, and a screenshot of it looks like a page that has no styles rather than
   a page whose style source was dropped. The inline query hands back the text so it
   can be installed explicitly. */
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

window.__draws = { panel: 0, names: { scroll: css.commentsScroll, list: css.reviewComments } }

function Panel() {
  window.__draws.panel += 1
  const scrollRef = useRef(null)
  // 内容键：本页量的是「滚动不许重画」，内容保持不变正是那条判据需要的。
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
  /* 真几何：宽档右栏 344px；窄档铺满。同一个工件两档都能看。 */
  #root > div { width: min(344px, 46cqw); height: 520px; }
  @media (max-width: 600px) { #root > div { width: auto; height: 420px; } }
</style></head><body>
<div data-dsh-taskboard-view data-dsh-taskboard-panel><div id="root"></div></div>
<script>
  /* 打包产物若在挂载时抛，页面会是**一片空白**——而空白与「没有内容」在截图上长得
     一模一样。所以先架一张网，把第一句错误留在页面上，供量器取走。 */
  window.__errors = []
  window.addEventListener('error', (event) => {
    window.__errors.push(String(event.message || event.error || 'error'))
  })
</script>
<script>${bundle}</script>
</body></html>`

/** `vite` 是直接依赖 `vitest` 自带的构建器：从它那里解析，不引入新依赖。 */
function resolveVite() {
  try {
    const require_ = require('node:module').createRequire(require.resolve('vitest'))
    return require_( 'vite')
  } catch {
    return undefined
  }
}

async function main() {
  const vite = resolveVite()
  if (vite === undefined) {
    console.error('probe-live-scroll: SKIP — 解析不到 vite（它是 vitest 自带的构建器）。这一页没有造出来，所以什么都没量到。')
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
       在挂载那一句就抛，截出来是一片空白，而空白在图上与「没有内容」长得一样。 */
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
        name: 'LiveScrollProbe',
        fileName: () => 'bundle.js',
      },
    },
  })

  /* 打包产物的样式文件名由 vite 按入口命名（`dsh-task-board.css`），不叫 `style.css`。
     名字读错不会报错——页面只是**没有本插件的样式**，于是滚动区不滚，量到的
     「读者拉得动吗」全是假的。所以这里按扩展名找，不猜名字。 */
  const cssFiles = fs.readdirSync(OUT).filter(name => name.endsWith('.css'))
  if (cssFiles.length === 0) {
    console.error('probe-live-scroll: 打包没有产出样式表，这一页没有本插件的样式，不量了。')
    process.exit(2)
  }
  const css = [
    hostThemeCss(),
    ...cssFiles.map(name => fs.readFileSync(path.join(OUT, name), 'utf8')),
  ].join('\n')
  /* 打包产物**内联**进页面：`file://` 下的外链脚本会被当成跨源，异常于是只剩
     「Script error.」——一句看不出任何东西的话。内联之后页与脚本同源，错误才是
     真错误。 */
  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'live-scroll.html')
  fs.writeFileSync(page, HTML(css, bundle), 'utf8')

  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')}`)
  console.log('now:')
  console.log(`  node scripts/shot-panel.mjs --url ${url} --eval-file scripts/probes/probe-live-scroll.js --width 1200 --height 700`)
}

main().catch((error) => {
  console.error(`probe-live-scroll: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
})
