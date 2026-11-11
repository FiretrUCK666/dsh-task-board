// 造页器：**300 条评论的一条长列表**，两个变量、四个读数。
//
// ── 它回答的那一个问题 ────────────────────────────────────────────────────────
//
// 读者给的 trace 里有三个数字：**未归因 2,446ms / 13.65 秒**、**6,589 个节点**、
// **148MB 堆**。未归因是主线程上「算完了但没归到哪个函数」的时间——强制布局与样式
// 重算就是那个样子。也就是说：钱花在**排版这棵 DOM 上**，不是花在 React 的推导上。
//
// 我前面所有探针量的都是「React 重算」，全部零丢帧——因为那一层真的不贵。这一页量的是
// 另一层：**一次布局要多少钱，以及它随行数怎么长**。
//
// 三档，同一份内容、同一段手势，只改一件事：
//
//   ?mode=plain   每一行都排版（今天的形状）
//   ?mode=cv      视口外的行不排版（`content-visibility: auto` + 估计高度）
//   ?mode=cvauto  同上，但估计高度用 `auto`（记住量过的那一版）
//
// 用法：
//   node scripts/probes/probe-long-list-layout.cjs

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'long-list-layout')

const ENTRY = `
import { createElement, memo } from 'react'
import { createRoot } from 'react-dom/client'
import css from '../../src/client/board.module.css'
import '../../src/client/design/base.module.css'
import tokens from '../../src/client/design/tokens.module.css?inline'

const tokensStyle = document.createElement('style')
tokensStyle.textContent = tokens
document.head.appendChild(tokensStyle)

const PARAMS = new URLSearchParams(location.search)
const MODE = PARAMS.get('mode') ?? 'plain'
const COUNT = Number(PARAMS.get('rows') ?? '300')

/* 一段真实的评论长度：两到三行中文 + 一条元数据。 */
const TEXT = '第 N 条评论：这一条故意写得长一点，好让它在窄栏里换到三行；读者报告的手感问题就发生在这个盒子里。'

const Row = memo(function Row({ index }) {
  return createElement('li', { className: css.reviewComment, 'data-mode': MODE },
    createElement('span', { className: css.reviewCommentText },
      createElement('p', { className: css.mdParagraph }, TEXT.replace('N', String(index + 1)))),
    createElement('span', { className: css.reviewCommentMeta },
      createElement('span', { className: css.reviewCommentChip }, '已保存 · 开启自动巡航后注入'),
      createElement('span', { className: css.reviewCommentTime }, '2026-11-10 17:26:11'),
      createElement('button', { type: 'button', className: css.reviewCommentCancel }, '取消')))
})

const rows = Array.from({ length: COUNT }, (_u, index) => createElement(Row, { key: index, index }))

createRoot(document.getElementById('root')).render(
  createElement('div', { id: 'scroller' },
    createElement('ul', { className: css.reviewComments, id: 'list', 'data-mode': MODE }, rows)))

window.__rows = () => document.querySelectorAll('ul > li').length
window.__mode = MODE
window.__mounted = true
`

const HTML = (css, bundle) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<style>
  html, body { margin: 0; block-size: 100%; }
  body { display: flex; flex-direction: column; overflow: hidden; background: var(--dsh-tb-bg); }
  #root { block-size: 100%; min-block-size: 0; }
  #scroller { block-size: 100%; overflow-y: auto; padding: 12px; }

  /* ── THE ONE VARIABLE ──────────────────────────────────────────────────────
   * \`content-visibility: auto\` 让视口外的行**跳过排版与绘制**，代价是浏览器必须
   * 知道它们大概多高——否则滚动条长度会跳。\`contain-intrinsic-size\` 就是那个估计，
   * 而 \`auto\` 关键字让浏览器**记住量过的那一版**：见过的行用真高，没见过的用估计。
   *
   * 两档都试：只用固定估计（cv）与带记忆的估计（cvauto）。后者才是能上线的形状，
   * 因为评论行长得好坏差两三倍，一个死数字会把滚动条拉歪。 */
  #list[data-mode='cv'] > li { content-visibility: auto; contain-intrinsic-size: 92px; }
  #list[data-mode='cvauto'] > li { content-visibility: auto; contain-intrinsic-size: auto 92px; }
</style></head><body>
<div data-dsh-taskboard-view style="position:relative;flex:1;min-block-size:0"><div id="root"></div></div>
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
    console.error('probe-long-list-layout: SKIP — 解析不到 vite。这一页没有造出来，所以什么都没量到。')
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
        name: 'LongListLayoutProbe',
        fileName: () => 'bundle.js',
      },
    },
  })

  const cssFiles = fs.readdirSync(OUT).filter(name => name.endsWith('.css'))
  if (cssFiles.length === 0) {
    console.error('probe-long-list-layout: 打包没有产出样式表，这一页没有本插件的样式，不拍了。')
    process.exit(2)
  }
  const css = [hostThemeCss(), ...cssFiles.map(name => fs.readFileSync(path.join(OUT, name), 'utf8'))].join('\n')
  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'long-list-layout.html')
  fs.writeFileSync(page, HTML(css, bundle), 'utf8')

  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')}`)
  console.log('now (same rows, one variable — do off-screen rows get laid out):')
  for (const mode of ['plain', 'cv', 'cvauto']) {
    console.log(`  node scripts/shot-panel.mjs --url "${url}?mode=${mode}" --eval-file scripts/probes/probe-long-list-layout.js --width 900 --height 800 --scrollbars --out tmp/list-${mode}.png`)
  }
}

main().catch((error) => {
  console.error(`probe-long-list-layout: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
