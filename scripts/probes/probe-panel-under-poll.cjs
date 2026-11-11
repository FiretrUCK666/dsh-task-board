// 造页器：**整块会话面板**，加上「每 3 秒来一次新内容」这一味。
//
// ── 它回答的那一个问题 ────────────────────────────────────────────────────────
//
// 前面几个探针各自量了一块：评论列表、对话列表、一次重画。三块都是零丢帧、零长任务。
// 但它们量的时候**没有轮询**——而读者报的是「某些 session 卡」，那几个 session 的共同点
// 恰恰是**还在跑**，也就是每 3 秒都有一次新内容到达。
//
// 所以这一页把缺的那一味补上：真页、真 `SessionFrame`、真 `SessionTranscript`、真
// `SessionRail`（含真 `CommentsThread`），每 3 秒往对话尾和评论尾各追加一条，然后量
// 一段跨越好几次轮询的手势。
//
// ── 两档，只改一个变量 ───────────────────────────────────────────────────────
//
//   ?poll=1  轮询开着（读者的处境）
//   ?poll=0  轮询关着（对照组）
//
// 两档的差就是「新内容正在到达」这件事本身的价钱。
//
// 用法：
//   node scripts/probes/probe-panel-under-poll.cjs

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'panel-under-poll')

const ENTRY = `
import { createElement, useCallback, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SessionFrame } from '../../src/client/board/SessionFrame.tsx'
import { SessionTranscript, SessionRail } from '../../src/client/board/session-panel.tsx'
import { DEFAULT_WORK_STEPS } from '../../src/client/board/work-steps.ts'
import { newCommentRound, createTask, startExecution } from '../../src/core/tasks.ts'
import css from '../../src/client/board.module.css'
import '../../src/client/design/base.module.css'
import tokens from '../../src/client/design/tokens.module.css?inline'

const tokensStyle = document.createElement('style')
tokensStyle.textContent = tokens
document.head.appendChild(tokensStyle)

const AT = 1_700_000_000_000
const PARAMS = new URLSearchParams(location.search)
const POLL = PARAMS.get('poll') !== '0'
const TURNS = Number(PARAMS.get('turns') ?? '40')
const COMMENTS = Number(PARAMS.get('comments') ?? '40')

/* 一段像模型真会写的回答：列表 + 段落 + 一句结论。 */
const ANSWER = [
  '先说结论：这一处卡顿的根源不在条数，而在一条回答本身有多长。',
  '',
  '依据有三条：',
  '',
  '1. 折轮是纯函数，成本随事件数线性增长，这是可以接受的；',
  '2. 真正贵的是把每一条回答的 markdown 解析成节点；',
  '3. 所以窗口越长、回答越长，那一下就越重。',
].join(String.fromCharCode(10))

function turnOf(index) {
  return {
    turn: index + 1,
    trigger: { id: 'u' + index, text: '第 ' + String(index + 1) + ' 轮：把东墙那盏灯换掉。', at: AT + index * 1000 },
    interjections: [],
    steps: [
      { kind: 'tool', id: 'c' + index + '-1', name: 'read', state: 'settled', step: 1, order: 1 },
      { kind: 'reasoning', id: 'r' + index, chars: 512, preview: '先看现场', step: 1, order: 2 },
    ],
    replies: [
      { id: 'a' + index + '-1', text: ANSWER, at: AT + index * 1000 + 1, step: 1, order: 3 },
      { id: 'a' + index + '-2', text: ANSWER, at: AT + index * 1000 + 2, step: 2, order: 5 },
    ],
    endedAt: AT + index * 1000 + 3,
    endReason: 'completed',
  }
}

function roundOf(index) {
  return newCommentRound({
    id: 'comment-' + String(index + 1),
    now: AT + 2_000 + index * 1_000,
    text: '第 ' + String(index + 1) + ' 条评论：这一条写得长一点，好让它在窄栏里换到三行。',
    sessionId: 'sess-1',
    parentExecutionId: 'run-1',
  })
}

const opened = startExecution(
  createTask({ title: '把评论区的滚动修好', description: '', prompt: '慢慢做', status: 'todo' }, AT, 'task-1'),
  AT + 1_000,
  'run-1',
)
const baseTask = { ...opened.task, executions: [...opened.task.executions.map(round => ({ ...round, sessionId: 'sess-1' }))] }

const controller = {
  cancelComment: () => true,
  attachmentsAvailable: () => false,
  admitAttachment: async () => ({ ok: false }),
  sessionConfig: () => undefined,
  runCatalog: () => undefined,
  sessionInfo: () => undefined,
  markTaskSessionViewed: () => undefined,
  markExecutionViewed: () => undefined,
}

const draws = { panel: 0 }
window.__draws = () => draws.panel

function App() {
  draws.panel += 1
  /* THE TWO POLLS, as plain state: one appends a turn, one appends a comment — the
     exact shape the real 3s polls take (a new events array, a new context object). */
  const [turnCount, setTurnCount] = useState(TURNS)
  const [comments, setComments] = useState(() => Array.from({ length: COMMENTS }, (_u, i) => roundOf(i)))

  const turns = useMemo(
    () => Array.from({ length: turnCount }, (_u, i) => turnOf(i)),
    [turnCount],
  )
  const task = useMemo(() => ({ ...baseTask, executions: [...baseTask.executions, ...comments] }), [comments])
  const thread = useMemo(() => comments.map(round => ({ round, state: 'saved' })), [comments])

  const onChanged = useCallback(() => undefined, [])

  if (POLL) {
    window.__pollOnce = () => {
      setTurnCount(count => count + 1)
      setComments(current => [...current, roundOf(current.length)])
    }
  }

  return createElement(SessionFrame, {
    title: '把评论区的滚动修好',
    ariaLabel: '把评论区的滚动修好',
    actions: null,
    main: createElement('div', { className: css.reviewTranscriptScroll, id: 'transcript' },
      createElement(SessionTranscript, {
        turns,
        error: false,
        sessionId: 'sess-1',
        controller,
        prefs: DEFAULT_WORK_STEPS,
      })),
    rail: createElement(SessionRail, {
      sessionId: 'sess-1',
      controller,
      projections: undefined,
      turns,
      onChanged,
      task,
      thread,
      interaction: undefined,
      composer: createElement('div', { style: { padding: '8px 0' } }, '输入框'),
    }),
    onClose: () => { window.__closed = true },
  })
}

createRoot(document.getElementById('root')).render(createElement(App))
window.__polling = POLL
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
    console.error('probe-panel-under-poll: SKIP — 解析不到 vite（它是 vitest 自带的构建器）。这一页没有造出来，所以什么都没量到。')
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
        name: 'PanelUnderPollProbe',
        fileName: () => 'bundle.js',
      },
    },
  })

  const cssFiles = fs.readdirSync(OUT).filter(name => name.endsWith('.css'))
  if (cssFiles.length === 0) {
    console.error('probe-panel-under-poll: 打包没有产出样式表，这一页没有本插件的样式，不拍了。')
    process.exit(2)
  }
  const css = [hostThemeCss(), ...cssFiles.map(name => fs.readFileSync(path.join(OUT, name), 'utf8'))].join('\n')
  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'panel-under-poll.html')
  fs.writeFileSync(page, HTML(css, bundle), 'utf8')

  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')}`)
  console.log('now (same page, one variable — the 3s poll):')
  console.log(`  node scripts/shot-panel.mjs --url "${url}?poll=0" --eval-file scripts/probes/probe-panel-under-poll.js --width 1440 --height 900 --scrollbars --out tmp/poll-off.png`)
  console.log(`  node scripts/shot-panel.mjs --url "${url}?poll=1" --eval-file scripts/probes/probe-panel-under-poll.js --width 1440 --height 900 --scrollbars --out tmp/poll-on.png`)
}

main().catch((error) => {
  console.error(`probe-panel-under-poll: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
