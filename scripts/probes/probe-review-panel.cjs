// 造页器：把**真的**会话面板装进一张真页，供两档截图与「取消一条评论」的手势。
//
// ── 为什么这一页必须用真组件 ──────────────────────────────────────────────────
//
// 这一改动了三处会让屏上「少一点东西」的地方，而它们全都不报错：
//
//   1. `SessionRail` 不再收 `onCancelComment`（取消改由 rail 自己持有 controller）——
//      接错的话，取消按钮会变成一个按不动的装饰；
//   2. `CommentsThread` 的 memo 现在真的会命中——命中错了会让列表停在旧内容上；
//   3. `TurnList` / `TurnItem` 改收「稳定函数」——接错的话折叠点不开。
//
// 三者都只在**真组件 + 真 React** 里才看得见，所以这一页 import 的就是 `src/` 那几份，
// 一行都不抄。controller 是一个只答这几个成员的 stub（`SessionRail` 读的每一个都在这里
// 点名，少一个就会在挂载时抛出它自己的名字——那正是我要的失败方式）。
//
// 用法：
//   node scripts/probes/probe-review-panel.cjs
//   然后按它打印的两条命令交给 Chromium（宽档 + 触屏档）。

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'review-panel')

/** The comments the page shows — enough of them that the box really scrolls. */
const COMMENTS = 26

const ENTRY = `
/* THE SHARED CHROME SHEET IS IMPORTED FIRST, DELIBERATELY, AND BEFORE ANYTHING THAT
 * PULLS THE BOARD SHEET IN.
 *
 * SessionFrame renders the shared modal class plus the review class, and BOTH rules
 * set a width at equal specificity — so the LAST sheet wins. In the shipped bundle
 * components.module.css lands before board.module.css (measured: byte 22040 vs
 * 756888), so the review rule's 880px allowance applies. A library-mode build
 * traversed the graph the other way round, and the panel came out 522px wide — the
 * generic dialog width — which is a picture of a geometry the product does not have.
 *
 * Module evaluation order is import-statement order, so putting this line first pins
 * the cascade this page needs. The probe also reports the measured panel box, so the
 * picture and the number can be checked against each other instead of trusted. */
import '../../src/client/design/components.module.css'
import { Fragment, createElement, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SessionFrame } from '../../src/client/board/SessionFrame.tsx'
import { SessionRail } from '../../src/client/board/session-panel.tsx'
import { TailFrame, useFollowScroll } from '../../src/client/board/use-transcript.tsx'
import { CommentsThread } from '../../src/client/board/CommentsThread.tsx'
import { newCommentRound, createTask, startExecution } from '../../src/core/tasks.ts'
import css from '../../src/client/board.module.css'
/* THE SCROLLBAR GRAMMAR IS PART OF WHAT THE READER REPORTED — 「移动条跳帧」 is about
 * the thumb — so the page must render the real bar, not the UA default. That grammar
 * lives in design/base.module.css and is anchored on the view attribute this page
 * carries. Leaving it out photographs a bar the product never shows. */
import '../../src/client/design/base.module.css'
import tokens from '../../src/client/design/tokens.module.css?inline'

const tokensStyle = document.createElement('style')
tokensStyle.textContent = tokens
document.head.appendChild(tokensStyle)

const AT = 1_700_000_000_000
const open = startExecution(
  createTask({ title: '把评论区的滚动修好', description: '', prompt: '慢慢做', status: 'todo' }, AT, 'task-1'),
  AT + 1_000,
  'run-1',
)
/* Every round carries a comment, because that is what the thread lists. */
const rounds = Array.from({ length: ${COMMENTS} }, (_unused, index) => newCommentRound({
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

/* The comment views the thread renders: the same shape \`sessionCommentsOf\` returns. */
const thread = rounds.map(round => ({ round, state: 'saved' }))

/* ONE controller stub, and every member the rail reads is named here. A missing
   one throws during mount with its own name — the failure mode I want rather than
   a quietly incomplete picture. */
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
/* How many times the surface holding the pin has drawn. The probe reads the
   difference before and after a scroll: a scroll that re-renders this component
   is exactly the defect that used to make the bar stutter. */
const draws = { rail: 0 }
window.__draws = () => draws.rail

function Rail() {
  draws.rail += 1
  /* The comments region is the surface under test: the REAL scroller class, the
     REAL TailFrame/pin, the REAL CommentsThread — and it sits inside the REAL
     folds block, because the rail's HEIGHT contract (the folds block absorbs the
     height, the composer is flex-none below) is what makes the box the reader
     scrolls the right size. A picture without that wrapper photographs a geometry
     the product never has. */
  const scrollRef = useRef(null)
  const [open] = useState(true)
  const pin = useFollowScroll(scrollRef, thread.map(view => view.round.id).join('|'), open)
  return createElement(Fragment, null,
    createElement('div', { className: css.sessionRailFolds },
      createElement('div', { className: css.sessionRailHead },
        createElement('p', { style: { margin: 0, font: 'inherit', color: 'inherit' } }, '评论区')),
      createElement('div', { className: css.sessionRailComments, 'data-open': 'true' },
        createElement(TailFrame, { pin },
          createElement('div', { className: css.commentsScroll, ref: scrollRef, id: 'comments' },
            createElement(CommentsThread, { task, views: thread, onCancel: (id) => controller.cancelComment(id) }),
          ),
        ),
      ),
    ),
    /* The pinned composer, in its real slot: flex-none under the folds. */
    createElement('div', { className: css.reviewComposer },
      createElement('p', { style: { margin: 0, font: 'inherit', color: 'inherit' } }, '写一句，回车发出去')),
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

/** 宿主的令牌表：本插件每个 `--dsh-tb-*` 都从 `--dsw-*` 派生，缺了它颜色全是空的。
 *  读法只有一份，住在 `host-theme.cjs`。 */
const { hostThemeCss } = require('./host-theme.cjs')

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
    console.error('probe-review-panel: SKIP — 解析不到 vite（它是 vitest 自带的构建器）。这一页没有造出来，所以什么都没看到。')
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
        name: 'ReviewPanelProbe',
        fileName: () => 'bundle.js',
      },
    },
  })

  const cssFiles = fs.readdirSync(OUT).filter(name => name.endsWith('.css'))
  if (cssFiles.length === 0) {
    console.error('probe-review-panel: 打包没有产出样式表，这一页没有本插件的样式，不拍了。')
    process.exit(2)
  }
  const css = [hostThemeCss(), ...cssFiles.map(name => fs.readFileSync(path.join(OUT, name), 'utf8'))].join('\n')
  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'review-panel.html')
  fs.writeFileSync(page, HTML(css, bundle), 'utf8')

  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')}`)
  console.log('now (both bands):')
  console.log(`  node scripts/shot-panel.mjs --url ${url} --eval-file scripts/probes/probe-review-panel.js --width 1440 --height 900 --out tmp/review-panel-wide.png`)
  console.log(`  node scripts/shot-panel.mjs --url ${url} --eval-file scripts/probes/probe-review-panel.js --width 390 --height 844 --touch --out tmp/review-panel-touch.png`)
}

main().catch((error) => {
  console.error(`probe-review-panel: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
