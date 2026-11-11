// `:has()` 出现在一棵大子树的祖先上，本身要多少钱？——只改这一件事。
//
// ── 它为什么值得单独量 ────────────────────────────────────────────────────────
//
// `board.module.css` 里有一条：
//
//     [data-dsh-taskboard-view]:has([class*='modalBackdrop']) [data-dsh-tb-columns] {
//       content-visibility: hidden;
//     }
//
// 它守的是「面板盖住看板时，看板列停止渲染」。但 `:has()` 的代价不在它匹配到谁，而在
// **谁的变化会让它重新求值**：任何一次落在 `[data-dsh-taskboard-view]` 子树里的样式
// 失效，引擎都要重新回答「这棵子树里现在有没有 `.modalBackdrop`」。
//
// 而会话面板**就渲染在那棵子树里面**（它 portal 到 `boardBox()`）。于是：打开任意一个
// session 的评论区 → 子树里出现 `.modalBackdrop` → 从那一刻起，面板里**每一次**样式
// 失效（滚动、hover、胶囊、时间戳）都带着这一条 `:has()` 一起重算。
//
// 这与读者报的话吻合：「各种 session 里的评论区上下滑动条都容易卡」——不是某些内容特殊，
// 是那个面板从此住在一个带 `:has()` 的祖先下面。
//
// 这一页只改一件事：
//
//   ?has=1   祖先上有那条 `:has()`（今天的形状）
//   ?has=0   同样的祖先、同样的子树，没有 `:has()`
//
// 用法：
//   node scripts/probes/probe-has-invalidation.cjs

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'has-invalidation')

const ENTRY = `
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'

const PARAMS = new URLSearchParams(location.search)
const USE_HAS = PARAMS.get('has') !== '0'
const ROWS = Number(PARAMS.get('rows') ?? '160')

/* The subtree: a board-like list of rows, which is what a real board view holds even
   when the whole thing is behind a panel. */
const Row = ({ index }) =>
  createElement('div', { className: 'row' },
    createElement('span', { className: 'rowTitle' }, '第 ' + String(index + 1) + ' 张卡的标题'),
    createElement('span', { className: 'rowMeta' }, 'todo · 2 条评论 · 3 次执行'),
    createElement('span', { className: 'rowChip' }, '进行中'))

function Board() {
  return createElement('div', { className: 'columns', 'data-dsh-tb-columns': '' },
    Array.from({ length: ROWS }, (_u, index) => createElement(Row, { key: index, index })))
}

/* THE PANEL: rendered INSIDE the board view, exactly as the product portals it there. */
function Panel() {
  return createElement('div', { className: 'backdrop', 'data-panel': '' },
    createElement('div', { className: 'panel' },
      createElement('h2', { className: 'panelTitle' }, '把评论区的滚动修好'),
      createElement('div', { className: 'scroller', id: 'scroller' },
        Array.from({ length: ROWS }, (_u, index) => createElement('div', { className: 'comment', key: index },
          createElement('p', { className: 'commentText' },
            '第 ' + String(index + 1) + ' 条评论：这一条故意写得长一点，好让它在窄栏里换到三行。'),
          createElement('span', { className: 'commentMeta' }, '已保存 · 2026-11-10 17:26:11'))))))
}

createRoot(document.getElementById('root')).render(
  createElement('div', { className: 'view', 'data-dsh-taskboard-view': '', 'data-has': USE_HAS ? '1' : '0' },
    createElement(Board),
    createElement(Panel)))

window.__rows = () => document.querySelectorAll('.comment').length
window.__useHas = USE_HAS
window.__mounted = true
`

const HTML = (bundle) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; block-size: 100%; font: 14px/1.6 system-ui, sans-serif; }
  #root { block-size: 100%; min-block-size: 0; }
  body { overflow: hidden; }

  [data-dsh-taskboard-view] { position: relative; block-size: 100%; display: flex; }

  /* ── THE ONE VARIABLE ──────────────────────────────────────────────────────
     The product's rule, minus the hashing. \`:has()\` on this ancestor means every
     style invalidation anywhere in its subtree must re-answer 「is there a
     .backdrop in here」. */
  [data-dsh-taskboard-view][data-has='1']:has([class*='backdrop']) [data-dsh-tb-columns] {
    content-visibility: hidden;
  }

  .columns { flex: 1; padding: 12px; overflow: hidden; }
  .row { display: flex; gap: 8px; align-items: baseline; padding: 8px 10px; border-bottom: 1px solid #eee; }
  .rowTitle { font-weight: 600; }
  .rowMeta { color: #666; font-size: 12px; }
  .rowChip { margin-left: auto; font-size: 12px; color: #2a6; }

  /* The panel sits ON TOP, inside the same view — as the product does. */
  .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.35); display: flex; }
  .panel { margin: auto; inline-size: 420px; block-size: 84%; background: #fff; border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .panelTitle { margin: 0; font-size: 16px; }
  .scroller { flex: 1; overflow-y: auto; min-block-size: 0; }
  .comment { padding: 8px 12px; margin-block-end: 10px; background: #f4f5f7; border: 1px solid #e3e5e8; border-radius: 10px; }
  .commentText { margin: 0; }
  .commentMeta { font-size: 12px; color: #666; }
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
    console.error('probe-has-invalidation: SKIP — 解析不到 vite。这一页没有造出来，所以什么都没量到。')
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
        name: 'HasInvalidationProbe',
        fileName: () => 'bundle.js',
      },
    },
  })

  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'has-invalidation.html')
  fs.writeFileSync(page, HTML(bundle), 'utf8')

  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')}`)
  console.log('now (same subtree, one variable — is the ancestor asking :has):')
  for (const has of ['1', '0']) {
    console.log(`  node scripts/shot-panel.mjs --url "${url}?has=${has}" --eval-file scripts/probes/probe-has-invalidation.js --width 900 --height 800 --scrollbars --out tmp/has-${has}.png`)
  }
}

main().catch((error) => {
  console.error(`probe-has-invalidation: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
