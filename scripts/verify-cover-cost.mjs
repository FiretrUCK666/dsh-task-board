/**
 * 被一层浮层盖住的表面，**四层都不许花钱**——而四层读的是同一条事实。
 *
 * ── 这条门禁为什么存在 ──────────────────────────────────────────────────────
 *
 * 读者报的是「评论区上下滑动很卡、移动条跳帧」。根因不在滚动代码里：他正滚动的那个
 * 面板后面，一块没人看得见的板还在干活。「盖住」这件事一共管四层——
 *
 *     动画 · 绘制 · 布局 · React 的重算
 *
 * ——而历史上只有前两层有人管。后两层不是被忘了，是**没有任何选择器能表达它们**：
 * React 在 `setState` 之前不会去问一个选择器匹配了什么，而 FLIP 的几何读发生在提交
 * 之后。结果是一块被盖住的板照旧订阅、照旧重算、照旧在每次提交里同步读每张卡的框。
 *
 * 代价不出现在屏幕上，只出现在手感上，所以它反复被当成「浏览器的问题」。同族的第二个
 * 漏点在 React 那一侧的记忆化上：`CommentsThread` 的比较器先比函数身份，而两个调用点
 * 都传了现场箭头，于是那条 memo 从写下第一天起**从未命中过**——评论列表每 3 秒重建。
 *
 * ── 判据读什么 ──────────────────────────────────────────────────────────────
 *
 * 读结构（硬性规范 14），不读字样：哪条规则存在、它匹配什么、哪个壳登记了覆盖、
 * 哪一处把覆盖传给了订阅与 FLIP、哪一处几何读排在结构判定之后。注释先剥掉——解释
 * 「盖住就该停」的散文不是一次实现。
 *
 * ── 为什么每一段都带一条「不要求什么」 ──────────────────────────────────────
 *
 * 这个仓库里这两件事都被做错过一次，而且两次都是**判据逼出来的**：
 *
 *   - 逐个暂停那六个无限动画（每多一个动画就再加一条选择器）。读者当时的判断是对的：
 *     「感觉你在打补丁」。子树跳过一次覆盖全部，包括还没被写出来的动画——所以下面
 *     **要求子树跳过，并且禁止**逐个暂停的选择器回来。
 *   - 一个没有依赖数组的布局效应（每次提交都量一遍）。看着像「漏了依赖」，实际是
 *     FLIP 唯一能看到结构变化的方式；真正的病是**测量排在判定之前**。所以下面要求
 *     判定在前、且判定本身不许读几何，而不是要求补一个依赖数组。
 *
 * 判据守的是**声明**；「到底省了多少毫秒」由探针在真 Chromium 里量
 * （`scripts/probes/probe-covered-paint.{cjs,js}` 量绘制与可逆性，
 * `scripts/probes/probe-covered-render.{cjs,js}` 量重算成本），数字写进
 * `DESIGN.md` 第六条边界并写清量法。分开是因为静态扫描永远看不见主线程与合成器
 * 实际花了多少时间。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { probeOf } from './probe-args.mjs'

const root = process.argv[2] ?? '.'
const activeProbe = probeOf([
  '--probe-paint-ban',
  '--probe-pause-patch',
  '--probe-unregistered-cover',
  '--probe-unheld-board',
  '--probe-rect-outside',
  '--probe-inline-prop',
])

/** Comments stripped: a comment that NAMES a selector is not that selector. */
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const read = (rel) => {
  const path = join(root, rel)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

const findings = []
const SHEET = 'src/client/board.module.css'
const sheet = stripComments(read(SHEET))

/**
 * 声明了 `aria-modal`、但**盖住的不是看板**的那两个壳。
 *
 * 豁免的理由是结构性的，不是「还没做」：它们盖住的是清单页，而清单页里没有每 3 秒
 * 轮询一次的评论列表，也没有看板那层 FLIP 的几何读——把这两个也停掉只会让列表停止
 * 刷新，收益为零、代价是一次「刚创建的条目看不见」。判据读的是这份**理由表**，所以
 * 新加一个壳时不会因为「漏写一行」而被静默放过。
 */
const EXEMPT_COVER = new Set([
  'src/client/item/command-palette.tsx',
  'src/client/item/item-create-dialog.tsx',
])

// ── 第一、二层：动画与绘制 —— 被盖住的列退出渲染树 ─────────────────────────
const columnsRule = /\[data-dsh-taskboard-view\]:has\(\[class\*='modalBackdrop'\]\) \[data-dsh-tb-columns\] \{[^}]*content-visibility:\s*hidden;/.exec(sheet)?.[0] ?? ''
if (columnsRule === '') {
  findings.push(`${SHEET}: 被盖住的列没有 content-visibility: hidden——它还在绘制、还在跑里面那些无限动画，而读者看不见它`)
}
/* WHY THE PER-ANIMATION PAUSE IS BANNED RATHER THAN REQUIRED.
 *
 * Pausing `.card`, `.column` and `.sessionRow` one at a time took three selectors, and
 * the seventh animation would have needed a seventh. The reader named it correctly at
 * the time (「感觉你在打补丁而不是从根本解决」), and the subtree skip replaced it. A
 * checker that only asserts what it knows would force that patch back, so this one
 * asserts the shape of the replacement and forbids the shape it replaced. */
if (/\[data-dsh-taskboard-view\]:has\(\[class\*='modalBackdrop'\]\)[\s\S]{0,400}animation-play-state:\s*paused/.test(sheet)) {
  findings.push(`${SHEET}: 又出现了逐个暂停动画的选择器——子树跳过一次覆盖全部（包括还没被写出来的动画），一条一条列是一个动画加一条规则`)
}
if (/content-visibility:\s*hidden[\s\S]{0,120}\[class\$='_columns'\]/.test(sheet)) {
  findings.push(`${SHEET}: 用类名后缀定位列会命中面板内部元素——上一次就是这样把面板自己的背景抹掉的`)
}
if (/\[data-dsh-tb-columns\] \{[^}]*display:\s*none/.test(sheet)) {
  findings.push(`${SHEET}: display:none 会把列的盒子摘掉，面板关闭时整块板会跳一下——要的是 hidden 而不是 none`)
}
/* THE PAINT BAN. `contain: paint` was tried on the column track and removed: it makes
 * the track its own paint container, and on high-DPI displays the compositor then lags
 * the cards behind the scroll. The reason it looks attractive (it does stop paint) is
 * exactly why the ban has to be mechanical. */
if (/\.cards\s*\{[^}]*contain:\s*paint/.test(sheet)) {
  findings.push(`${SHEET}: .cards 又用上了 contain: paint——它会让合成器跟不上滚动（这条已经踩过一次）`)
}

// ── 第三、四层：布局与重算 —— 一条登记表，两个 JS 读取者 ────────────────────
/**
 * Layers 3 and 4 are discovered, not listed: every `.tsx` under `src/client` that
 * renders `aria-modal="true"` is a modal shell, and each one owes the covered layer a
 * cover registration. A hand-written list would go stale the day a sixth overlay is
 * added, and that failure is silent — the layer just keeps spending.
 */
function filesWith(dir, out = []) {
  for (const entry of readdirSync(join(root, dir))) {
    const rel = `${dir}/${entry}`
    const full = join(root, rel)
    if (statSync(full).isDirectory()) { filesWith(rel, out); continue }
    if (/\.tsx$/.test(entry)) out.push(rel)
  }
  return out
}

const modalShells = filesWith('src/client').filter((rel) => /aria-modal="true"/.test(stripComments(read(rel))))
if (modalShells.length === 0) {
  findings.push('src/client: 一个 aria-modal 的壳都没找到——判据读错了地方，它不会再守任何东西')
}
for (const rel of modalShells) {
  if (EXEMPT_COVER.has(rel)) continue
  if (!/useCover\(/.test(stripComments(read(rel)))) {
    findings.push(`${rel}: 这一层声明了 aria-modal 却没有 useCover(true)——它盖住的那一层会照旧重算、照旧同步读几何，而屏上没有任何证据`)
  }
}

/* The registry itself must be the ONE fact both JS layers read. Two copies is how the
 * subscription and the FLIP come to disagree about whether the board is covered.
 *
 * THE SHAPE IT CHECKS IS THE LAYERED ONE. The registry started as a `Set<symbol>`
 * (a boolean answer: 「is anything covering the board」) and that shape could not
 * express 「is anything covering ME」 — so the detail sheet under a session panel kept
 * working. It is now `Set<{ layer, token }>` plus a declared order; this gate names
 * that shape, because a copy that reverts to symbols would answer only for the
 * bottom layer again and every static check would still pass. */
const registry = stripComments(read('src/client/design/cover.ts'))
if (registry === '') {
  findings.push('src/client/design/cover.ts: 文件读不到——「盖住」这件事在 JS 侧没有事实来源了')
} else {
  if (!/const covers = new Set<\{ layer: Layer; token: symbol \}>\(\)/.test(registry)) {
    findings.push('src/client/design/cover.ts: 登记表不是「层 + 令牌」的模块级集合——两层会拿到两份答案，或者只答得了最底下那一层')
  }
  if (!/export const LAYERS = \[[^\]]*\] as const/.test(registry)) {
    findings.push('src/client/design/cover.ts: 层的次序没有一处声明——「我上面还有没有东西」就只能靠挂载先后去猜，而 effect 是子先父后跑的')
  }
  if (!/top > rankOf\(me\)/.test(registry)) {
    findings.push('src/client/design/cover.ts: 被盖住的判据不是「有更高的一层」——同一层的两个浮层会互相当成盖住自己的那一层')
  }
  if (/useState/.test(registry)) {
    findings.push('src/client/design/cover.ts: 用 state 存这个事实会让首帧读到错的答案，而那一帧正好是要省掉的那一帧')
  }
  if (!/useSyncExternalStore\(/.test(registry)) {
    findings.push('src/client/design/cover.ts: 读取者必须是同步的外部订阅（useSyncExternalStore），否则揭开时慢一帧')
  }
}

/* The board must hand the cover fact to the two JS layers it owns: the subscription
 * (render) and the FLIP (layout). Either one alone leaves half the cost in place. */
const board = stripComments(read('src/client/board/TaskBoard.tsx'))
if (!/useCovered\(\)/.test(board)) {
  findings.push('src/client/board/TaskBoard.tsx: 没有读 useCovered()——被盖住的看板不会知道自己被盖住了')
}
if (!/useRequiredBoardSnapshot\(controller,\s*covered\)/.test(board)) {
  findings.push('src/client/board/TaskBoard.tsx: 覆盖事实没有交给订阅——盖住期间照旧收快照，整块板照旧重算')
}
if (!/useFlipRegion\(boardRef,\s*dragId !== undefined,\s*covered\)/.test(board)) {
  findings.push('src/client/board/TaskBoard.tsx: 覆盖事实没有交给 FLIP——揭开时整块板会飞一遍，而读者刚关掉面板')
}

/* 布局这一层的第二半：几何读必须排在结构判定之后。
 *
 * 「盖住就停」管的是**别人**；这一条管的是它自己醒着的时候别每提交都量一遍。两者是
 * 同一个症状的两条来源，所以由同一条法则、同一道门禁守着。 */
const flip = stripComments(read('src/client/board/use-flip.ts'))
if (flip === '') {
  findings.push('src/client/board/use-flip.ts: 文件读不到——几何读的家没了')
} else {
  const decisionAt = flip.indexOf('const decision = flipDecisionOf(')
  const skipAt = flip.indexOf("if (decision.kind === 'skip') return")
  const measureAt = flip.indexOf('const region = measureRegion(container)')
  if (decisionAt === -1 || skipAt === -1 || measureAt === -1) {
    findings.push('src/client/board/use-flip.ts: 找不到「先判结构、再量几何」的三步——布局读可能又回到了每次提交的路径上')
  } else if (!(decisionAt < skipAt && skipAt < measureAt)) {
    findings.push('src/client/board/use-flip.ts: 几何测量排在了「结构没变就返回」之前——于是每次提交都强制排版一次，而那正是这次要治的病')
  }
  /* The cheap half must stay cheap: it runs after every commit, so it may not read a
   * box, resolve a style, or ask for a scroll size. */
  const signature = /export function structureSignatureOf[\s\S]*?\n\}/.exec(flip)?.[0] ?? ''
  if (signature === '') {
    findings.push('src/client/board/use-flip.ts: 没有 structureSignatureOf——判据找不到那个「便宜的一半」，它可能已经不便宜了')
  } else if (/getBoundingClientRect|offsetWidth|offsetHeight|clientHeight|scrollHeight|getComputedStyle/.test(signature)) {
    findings.push('src/client/board/use-flip.ts: 结构签名里读了几何——那会把整次排版冲回每次提交的路径上')
  }
}

// ── React 那一侧：memo 组件的调用点不许收到渲染期新建的闭包 ─────────────────
/**
 * The memoised components whose props decide whether a whole list rebuilds.
 *
 * The rule is not "all props must be stable" — it is that these are, because their
 * parent re-renders on a timer (the 3s transcript poll) and on every board
 * notification. A comparator that checks a function's identity first, handed an inline
 * arrow, misses on every render: the memo exists and does nothing.
 */
const MEMO_CALL_SITES = [
  { file: 'src/client/board/session-panel.tsx', name: 'CommentsThread' },
  { file: 'src/client/board/session-panel.tsx', name: 'TurnList' },
  { file: 'src/client/board/TurnItem.tsx', name: 'TurnItem' },
]

/** The JSX opening tag of `<name ...>` in a file, or undefined. */
function tagOf(source, name) {
  const start = source.indexOf(`<${name}`)
  if (start === -1) return undefined
  const end = source.indexOf('>', start)
  if (end === -1) return undefined
  return source.slice(start, end)
}

for (const site of MEMO_CALL_SITES) {
  const tag = tagOf(stripComments(read(site.file)), site.name)
  if (tag === undefined) {
    findings.push(`${site.file}: 找不到 <${site.name}> 的调用点——门禁要读的地方没了，它不会再守任何东西`)
    continue
  }
  /* `prop={someValue}` is a value; a **function literal** or an **object literal** is a
   * fresh identity on every render. Those two are what make a memo miss. */
  for (const match of tag.matchAll(/(\w+)=\{\s*(\([^)]*\)\s*=>|\(\)\s*=>|[A-Za-z_$][\w$.]*\s*=>|\{)/g)) {
    const what = match[2] === '{' ? '对象' : '函数'
    findings.push(`${site.file}: <${site.name} ${match[1]}=…> 收到一个渲染期新建的${what}——它的 memo 每次都会穿透，整条列表因此随父层重渲染重建。改成稳定引用（useCallback / useMemo），或改成收「键 + 稳定函数」`)
  }
}

/* And the cancel handler that made `CommentsThread`'s memo miss must stay owned by the
 * rail: the call site takes no handler at all, so there is nothing left to stabilise. */
const rail = stripComments(read('src/client/board/session-panel.tsx'))
if (/onCancelComment/.test(rail)) {
  findings.push('src/client/board/session-panel.tsx: 取消评论又变成了一个传进来的 prop——两个调用点会各自现场建一个箭头，memo 又会永远不命中')
}
if (!/const cancelComment = useCallback\(/.test(rail)) {
  findings.push('src/client/board/session-panel.tsx: 取消失去了稳定引用——评论列表会随父层每次重渲染重建')
}

// ── self-tests: each check must be able to fire (planted here, never in src/) ──
if (activeProbe !== undefined) {
  const plants = {
    '--probe-paint-ban': () => {
      const code = stripComments('.cards { contain: paint; }')
      if (!/\.cards\s*\{[^}]*contain:\s*paint/.test(code)) throw new Error('the paint ban cannot see a planted containment')
    },
    '--probe-pause-patch': () => {
      const code = stripComments("[data-dsh-taskboard-view]:has([class*='modalBackdrop']) :is(.card) { animation-play-state: paused; }")
      if (!/\[data-dsh-taskboard-view\]:has\(\[class\*='modalBackdrop'\]\)[\s\S]{0,400}animation-play-state:\s*paused/.test(code)) {
        throw new Error('the patch ban cannot see a planted per-selector pause')
      }
    },
    '--probe-unregistered-cover': () => {
      const code = stripComments('<div role="dialog" aria-modal="true" />')
      if (!/aria-modal="true"/.test(code) || /useCover\(/.test(code)) {
        throw new Error('the cover check cannot tell a shell without useCover apart')
      }
    },
    '--probe-unheld-board': () => {
      const code = stripComments('const snapshot = useRequiredBoardSnapshot(controller)')
      if (/useRequiredBoardSnapshot\(controller,\s*covered\)/.test(code)) {
        throw new Error('the held check thinks an unheld subscription is held')
      }
    },
    '--probe-rect-outside': () => {
      const code = stripComments('function other() { return node.getBoundingClientRect() }')
      const signature = /export function structureSignatureOf[\s\S]*?\n\}/.exec(code)?.[0]
      if (signature !== undefined) throw new Error('the rect-home check thinks a planted read is inside the signature')
    },
    '--probe-inline-prop': () => {
      const tag = '<CommentsThread task={task} views={thread} onCancel={id => controller.cancelComment(id)} />'
      const hit = [...tag.matchAll(/(\w+)=\{\s*(\([^)]*\)\s*=>|\(\)\s*=>|[A-Za-z_$][\w$.]*\s*=>|\{)/g)]
      if (hit.length === 0) throw new Error('the inline-prop check cannot see a planted arrow')
    },
  }
  try {
    plants[activeProbe]()
    console.log(`verify-cover-cost ${activeProbe.slice(2)} probe OK: the planted defect was seen`)
    process.exit(0)
  } catch (error) {
    console.error(`verify-cover-cost ${activeProbe.slice(2)} probe FAILED: ${error.message}`)
    process.exit(1)
  }
}

if (findings.length > 0) {
  console.error(`verify-cover-cost FAILED for ${root} (${findings.length})`)
  for (const one of findings) console.error(`  - ${one}`)
  process.exit(1)
}

console.log(`verify-cover-cost OK: 四层读同一条事实——被盖住的列由一条 :has() 规则退出渲染（动画与绘制），布局与重算由 ${modalShells.length - EXEMPT_COVER.size} 个浮层壳登记的同一份 cover 停下；几何读排在结构判定之后，${MEMO_CALL_SITES.length} 个 memo 调用点收到的是稳定引用`)
