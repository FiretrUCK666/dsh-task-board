// 造页器：**读者真实的那一摞**——面板盖在卡片详情上，卡片详情盖在看板列上。
//
// ── 它回答的那一个问题 ────────────────────────────────────────────────────────
//
// 前面几个探针都是「一块表面单独跑」，全部零丢帧。但真页不是那样：会话面板是**盖在**
// 卡片详情上打开的，而卡片详情又盖在看板列上。`content-visibility: hidden` 只让看板列
// 退出绘制，**卡片详情那一层没有人管**——它照样每一帧参与合成，而面板正压在它上面滚。
//
// 所以这一页把那一摞搭出来，用一个开关只改一件事：
//
//   ?under=paint  下面那一层照常绘制（今天的处境）
//   ?under=skip   下面那一层退出绘制（把同一个判据也给它）
//
// 两档的差就是「压在别人身上滚动」的价钱。
//
// 用法：
//   node scripts/probes/probe-panel-over-underlay.cjs

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'panel-over-underlay')

const ENTRY = `
import { createElement, useCallback, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SessionFrame } from '../../src/client/board/SessionFrame.tsx'
import { SessionTranscript, SessionRail } from '../../src/client/board/session-panel.tsx'
import { DEFAULT_WORK_STEPS } from '../../src/client/board/work-steps.ts'
import { newCommentRound, createTask, startExecution } from '../../src/core/tasks.ts'
import css from '../../src/client/board.module.css'
import components from '../../src/client/design/components.module.css'
import '../../src/client/design/base.module.css'
import tokens from '../../src/client/design/tokens.module.css?inline'

const tokensStyle = document.createElement('style')
tokensStyle.textContent = tokens
document.head.appendChild(tokensStyle)

const AT = 1_700_000_000_000
const PARAMS = new URLSearchParams(location.search)
/* HOW THE LAYER BENEATH BEHAVES — the one variable. */
const UNDER = PARAMS.get('under') === 'skip' ? 'skip' : 'paint'
const DENSITY = Number(PARAMS.get('density') ?? '60')

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
    steps: [{ kind: 'tool', id: 'c' + index, name: 'read', state: 'settled', step: 1, order: 1 }],
    replies: [{ id: 'a' + index, text: ANSWER, at: AT + index * 1000 + 1, step: 1, order: 3 }],
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
const task = { ...opened.task, executions: [...opened.task.executions.map(round => ({ ...round, sessionId: 'sess-1' }))] }
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

const TURNS = Array.from({ length: 30 }, (_u, i) => turnOf(i))
const COMMENTS = Array.from({ length: 30 }, (_u, i) => roundOf(i))
const THREAD = COMMENTS.map(round => ({ round, state: 'saved' }))

/* THE LAYER BENEATH: what the card detail sheet really draws — a stack of sections
   with borders, lifted surfaces and text. Density is the knob so the same page can
   say whether the cost scales with it. */
function Underlay() {
  const sections = Array.from({ length: DENSITY }, (_u, index) => createElement('section', {
    key: index,
    style: {
      background: 'var(--dsh-tb-plane-raised, #fff)',
      border: '1px solid var(--dsh-tb-border-soft, rgba(0,0,0,.1))',
      borderRadius: '12px',
      padding: '12px 14px',
      boxShadow: '0 1px 2px rgba(0,0,0,.05)',
      marginBlockEnd: '10px',
    },
  },
  createElement('h3', { style: { margin: '0 0 6px', fontSize: '14px' } }, '第 ' + String(index + 1) + ' 节：卡片详情里的这一块'),
  createElement('p', { style: { margin: 0, fontSize: '13px', lineHeight: '20px' } },
    '这一块是卡片详情里真实会有的那种内容：一段说明、一个状态、几行元数据。它现在压在会话面板下面，而会话面板正在它上面滚动。')))
  return createElement('div', { id: 'underlay', 'data-under': UNDER, style: { padding: '16px', blockSize: '100%', overflow: 'hidden' } }, sections)
}

function App() {
  const onChanged = useCallback(() => undefined, [])
  return createElement('div', { 'data-dsh-taskboard-view': '', style: { position: 'relative', blockSize: '100%' } },
    createElement(Underlay),
    createElement(SessionFrame, {
      title: '把评论区的滚动修好',
      ariaLabel: '把评论区的滚动修好',
      actions: null,
      main: createElement('div', { className: css.reviewTranscriptScroll, id: 'transcript' },
        createElement(SessionTranscript, { turns: TURNS, error: false, sessionId: 'sess-1', controller, prefs: DEFAULT_WORK_STEPS })),
      rail: createElement(SessionRail, {
        sessionId: 'sess-1', controller, projections: undefined, turns: TURNS, onChanged,
        task, thread: THREAD, interaction: undefined,
        composer: createElement('div', { style: { padding: '8px 0' } }, '输入框'),
      }),
      onClose: () => { window.__closed = true },
    }))
}

createRoot(document.getElementById('root')).render(createElement(App))
window.__under = UNDER
window.__mounted = true
`

const HTML = (css, bundle) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<style>
  html, body { margin: 0; block-size: 100%; }
  body { display: flex; flex-direction: column; overflow: hidden; background: var(--dsh-tb-bg); }
  #root { block-size: 100%; min-block-size: 0; }
  /* THE ONE VARIABLE. The skip branch is the same judgement the board columns already
     get: a layer nobody can see does not need to paint. */
  #underlay[data-under='skip'] { content-visibility: hidden; }
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
    console.error('probe-panel-over-underlay: SKIP — 解析不到 vite（它是 vitest 自带的构建器）。这一页没有造出来，所以什么都没量到。')
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
        name: 'PanelOverUnderlayProbe',
        fileName: () => 'bundle.js',
      },
    },
  })

  const cssFiles = fs.readdirSync(OUT).filter(name => name.endsWith('.css'))
  if (cssFiles.length === 0) {
    console.error('probe-panel-over-underlay: 打包没有产出样式表，这一页没有本插件的样式，不拍了。')
    process.exit(2)
  }
  const css = [hostThemeCss(), ...cssFiles.map(name => fs.readFileSync(path.join(OUT, name), 'utf8'))].join('\n')
  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'panel-over-underlay.html')
  fs.writeFileSync(page, HTML(css, bundle), 'utf8')

  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')}`)
  console.log('now (same page, one variable — how the layer beneath behaves):')
  console.log(`  node scripts/shot-panel.mjs --url "${url}?under=paint" --eval-file scripts/probes/probe-panel-under-poll.js --width 1440 --height 900 --scrollbars --out tmp/under-paint.png`)
  console.log(`  node scripts/shot-panel.mjs --url "${url}?under=skip" --eval-file scripts/probes/probe-panel-under-poll.js --width 1440 --height 900 --scrollbars --out tmp/under-skip.png`)
  console.log(`  node scripts/shot-panel.mjs --url "${url}?under=paint&density=200" --eval-file scripts/probes/probe-panel-under-poll.js --width 1440 --height 900 --scrollbars --out tmp/under-dense.png`)
}

main().catch((error) => {
  console.error(`probe-panel-over-underlay: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
