// 造页器：把**一段真的滚动**装进一张真页，然后数掉了几帧、主线程被谁占住了。
//
// ── 它回答的那一个问题 ────────────────────────────────────────────────────────
//
// 读者报的是「某些 session 的评论区上下滑动很卡、移动条跳帧」，并且明确说「不是因为
// 里面加载的东西太多」。所以这一页不是去猜，是**量**：
//
//   · 一帧一帧量帧间隔，数出超过一帧预算的那些帧；
//   · `PerformanceObserver('longtask')` 把主线程上超过 50ms 的活记下来；
//   · 长内容与短内容各跑一遍，看成本到底**随什么**增长。
//
// ── 为什么内容分两档 ─────────────────────────────────────────────────────────
//
// 「卡的那几个 session 有什么共同点」是这次唯一真正的线索。两档之间只改**一个**变量：
// 评论条数（每条一样长）。如果长任务只在高档出现，成本就跟条数有关；两档一样就是无关。
//
// 用法：
//   node scripts/probes/probe-scroll-frames.cjs
//   然后按它打印的两条命令交给 Chromium。

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'scroll-frames')

const ENTRY = `
import { Fragment, createElement, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SessionFrame } from '../../src/client/board/SessionFrame.tsx'
import { SessionRail } from '../../src/client/board/session-panel.tsx'
import { TailFrame, useFollowScroll } from '../../src/client/board/use-transcript.tsx'
import { newCommentRound, createTask, startExecution } from '../../src/core/tasks.ts'
import css from '../../src/client/board.module.css'
import '../../src/client/design/components.module.css'
import '../../src/client/design/base.module.css'
import tokens from '../../src/client/design/tokens.module.css?inline'

const tokensStyle = document.createElement('style')
tokensStyle.textContent = tokens
document.head.appendChild(tokensStyle)

const AT = 1_700_000_000_000
/* 内容的规模由地址参数给：同一个工件、只改一个变量。 */
const COUNT = Number(new URLSearchParams(location.search).get('comments') ?? '26')

const open = startExecution(
  createTask({ title: '把评论区的滚动修好', description: '', prompt: '慢慢做', status: 'todo' }, AT, 'task-1'),
  AT + 1_000,
  'run-1',
)
const rounds = Array.from({ length: COUNT }, (_unused, index) => newCommentRound({
  id: 'comment-' + String(index + 1),
  now: AT + 2_000 + index * 1_000,
  text: '第 ' + String(index + 1) + ' 条评论：这一条故意写得长一点，好让它在窄栏里换到三行；读者报告的手感问题就发生在这个盒子里。',
  sessionId: 'sess-1',
  parentExecutionId: 'run-1',
}))
const task = {
  ...open.task,
  executions: [...open.task.executions.map(round => ({ ...round, sessionId: 'sess-1' })), ...rounds],
}
const thread = rounds.map(round => ({ round, state: 'saved' }))

const controller = {
  cancelComment: (roundId) => { window.__cancelled.push(roundId); return true },
  attachmentsAvailable: () => false,
  admitAttachment: async () => ({ ok: false }),
  sessionConfig: () => undefined,
  runCatalog: () => undefined,
  sessionInfo: () => undefined,
  markTaskSessionViewed: () => undefined,
  markExecutionViewed: () => undefined,
}
window.__cancelled = []
const draws = { rail: 0 }
window.__draws = () => draws.rail

function Rail() {
  draws.rail += 1
  const scrollRef = useRef(null)
  const [open] = useState(true)
  const pin = useFollowScroll(scrollRef, thread.map(view => view.round.id).join('|'), open)
  return createElement(Fragment, null,
    createElement('div', { className: css.sessionRailFolds },
      createElement('div', { className: css.sessionRailComments, 'data-open': 'true' },
        createElement(TailFrame, { pin },
          createElement('div', { className: css.commentsScroll, ref: scrollRef, id: 'comments' },
            createElement('ul', { className: css.reviewComments, id: 'commentsList' },
              thread.map(view => createElement('li', { key: view.round.id, className: css.reviewComment },
                createElement('span', { className: css.reviewCommentText },
                  createElement('p', { className: css.mdParagraph }, view.round.comment)),
                createElement('span', { className: css.reviewCommentMeta },
                  createElement('span', { className: css.reviewCommentChip }, '已保存'),
                  createElement('span', { className: css.reviewCommentTime }, '2026-11-10 17:26:11')))))),
        ),
      ),
    ),
  )
}

function App() {
  return createElement(SessionFrame, {
    title: '把评论区的滚动修好',
    ariaLabel: '把评论区的滚动修好',
    actions: null,
    main: createElement('div', { className: css.reviewTranscriptScroll, id: 'transcript' },
      Array.from({ length: 30 }, (_unused, index) => createElement('p', { key: index, className: css.mdParagraph },
        '对话第 ' + String(index + 1) + ' 行：这一段只是把对话区撑满，好让两块滚动体同时在场。'))),
    rail: createElement(Rail),
    onClose: () => { window.__closed = true },
  })
}

createRoot(document.getElementById('root')).render(createElement(App))
window.__mounted = true
`

const HTML = (css, bundle) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<style>
  html, body { margin: 0; block-size: 100%; }
  body { display: flex; flex-direction: column; overflow: hidden; background: var(--dsh-tb-bg); }
  [data-dsh-taskboard-view] { position: relative; flex: 1; min-block-size: 0; }
</style></head><body>
<div data-dsh-taskboard-view><div id="root"></div></div>
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
      if (source[end] === '\\\\') { end += 2; continue }
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
    console.error('probe-scroll-frames: SKIP — 解析不到 vite（它是 vitest 自带的构建器）。这一页没有造出来，所以什么都没量到。')
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
        name: 'ScrollFramesProbe',
        fileName: () => 'bundle.js',
      },
    },
  })

  const cssFiles = fs.readdirSync(OUT).filter(name => name.endsWith('.css'))
  if (cssFiles.length === 0) {
    console.error('probe-scroll-frames: 打包没有产出样式表，这一页没有本插件的样式，不拍了。')
    process.exit(2)
  }
  const css = [hostThemeCss(), ...cssFiles.map(name => fs.readFileSync(path.join(OUT, name), 'utf8'))].join('\n')
  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'scroll-frames.html')
  fs.writeFileSync(page, HTML(css, bundle), 'utf8')

  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')}`)
  console.log('now (same artifact, one variable):')
  console.log(`  node scripts/shot-panel.mjs --url "${url}?comments=26" --eval-file scripts/probes/probe-scroll-frames.js --width 1440 --height 900 --scrollbars --out tmp/scroll-frames-short.png`)
  console.log(`  node scripts/shot-panel.mjs --url "${url}?comments=120" --eval-file scripts/probes/probe-scroll-frames.js --width 1440 --height 900 --scrollbars --out tmp/scroll-frames-long.png`)
}

main().catch((error) => {
  console.error(`probe-scroll-frames: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
