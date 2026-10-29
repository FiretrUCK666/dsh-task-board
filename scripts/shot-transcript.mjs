/**
 * 评论区的会话区在真浏览器里长什么样：一轮一折。
 *
 * 这一页复用的是**真样式表**（tokens / base / components / board）与真组件几何，
 * 只自己搭一段假的数据喂给同一个渲染面——它证明的是「读者会看到什么」，不是
 * 「判据怎么走」（那是 `tests/review-page.spec.ts` 的事）。
 *
 * 用法：node scripts/shot-transcript.mjs [--out <png>] [--mode detailed|verbose|compact] [--width 1280]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`)
  return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback
}
const OUT = flag('out', join(tmpdir(), 'tb-transcript.png'))
const MODE = flag('mode', 'detailed')
const WIDTH = Number(flag('width', '1280'))

/** 宿主主题表（本插件所有 --dsh-tb-* 都从 --dsw-* 派生，缺了它颜色全空）。 */
function hostThemeCss() {
  const candidates = [
    join(process.env.APPDATA ?? '', 'npm', 'node_modules'),
    join(process.env.HOME ?? '', '.npm', 'node_modules'),
  ]
  const bundle = candidates
    .map((root) => join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js'))
    .find(existsSync)
  if (bundle === undefined) return ''
  const source = readFileSync(bundle, 'utf8')
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

const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const hostCss = hostThemeCss()
if (hostCss === '') {
  console.error('shot-transcript: 找不到已安装的 DSH 主题表，这一页无法正确显示颜色，直接退出。')
  process.exit(2)
}
const scoped = hostCss.replace(
  /(^|[}\n])(body)(\[data-ds-dark-theme\])?\{/g,
  (_whole, lead, _body, dark) => `${lead}html${dark ?? ''},body${dark ?? ''}{`,
)

/* 一轮的三种折法，写死成三份静态标记：这一页只回答「画出来长什么样」，
   判据（哪一轮该折）在 work-steps.ts 里，由 spec 钉住。

   **过程行的次序就是真实到达次序**：`flowOf` 按它排序，所以这里也照真实形状摆——
   思考、调工具、**说一句**、再调工具。中途那句话夹在过程**中间**，正是读者说
   「对不上哪一条在哪一条的顺序」时看的那种轮。 */
const TURNS = [
  {
    prompt: '把东墙那盏灯换掉',
    summary: '3 次工具调用 · 2 段思考 · 1 条上下文',
    flow: [
      { kind: 'step', name: 'read', state: '已完成' },
      { kind: 'step', name: '思考 · 先看现场那两盏的接线', state: '412 字' },
      { kind: 'step', name: 'bash', state: '已完成' },
      { kind: 'reply', text: '我看了一下现场，两盏是同一条回路，先断电再换。' },
      { kind: 'step', name: '思考 · 确认轨道灯的卡扣方向', state: '88 字' },
      { kind: 'step', name: '上下文注入', state: 'AGENTS.md' },
      { kind: 'step', name: 'write', state: '已完成' },
    ],
    answer: '换好了：东墙那盏换成了轨道灯，位置没动天花板。',
  },
  {
    prompt: '顺便看一下客厅的色温',
    summary: '1 次工具调用',
    /* 读者在这一轮里**插了一句话**，所以它永不折，整体摊着；插话按它打断的位置画。 */
    flow: [
      { kind: 'step', name: 'grep', state: '已完成' },
      { kind: 'reader', text: '别动客厅那盏，先只看读数' },
      { kind: 'step', name: '思考 · 客厅那盏是 2700K', state: '36 字' },
    ],
    answer: '客厅现在是 2700K 的暖白，与东墙那盏 3000K 差一档。要不要一起调？',
  },
]

/** 一条流单元的标记（过程行 / 中途回复 / 读者插话）。 */
function flowMarkup(item) {
  if (item.kind === 'reader') {
    return `<li class="reviewStepReply"><div class="reviewMessage" data-role="user"><div class="reviewMessageText"><p>${item.text}</p></div></div></li>`
  }
  if (item.kind === 'reply') {
    return `<li class="reviewStepReply"><div class="reviewMessageText"><p>${item.text}</p></div></li>`
  }
  return `<li class="reviewStep"><span class="reviewStepName truncate">${item.name}</span><span class="reviewStepState">${item.state}</span></li>`
}

/** 一段连续过程 = 轮里自己的一个小折（官方 `ProcessGroup` 那一级）。 */
let groupId = 0
function clusterMarkup(group, open) {
  groupId += 1
  const id = `g${groupId}`
  const body = group.map(item => flowMarkup(item)).join('')
  return `<section class="detailSection reviewStepGroup"><button type="button" class="detailDisclosure" aria-expanded="${open ? 'true' : 'false'}" aria-controls="${id}"><svg class="detailChevron foldMark" viewBox="0 0 16 16" width="16" height="16"><path d="M3 6 8 11 13 6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span class="detailDisclosureTitle">${group.length} 项</span></button>${open ? `<div class="detailSectionBody" id="${id}"><ul class="reviewStepList">${body}</ul></div>` : ''}</section>`
}

const lines = []
for (const turn of TURNS) {
  lines.push('<li class="reviewTurn">')
  lines.push(`<div class="reviewMessage" data-role="user"><div class="reviewMessageText"><p>${turn.prompt}</p></div></div>`)
  const flat = turn.flow.some(item => item.kind === 'reader') || MODE === 'verbose'
  if (flat) {
    /* 摊着的一支：过程与回复**按到达次序**交错，读者插的话夹在它打断的位置上。 */
    lines.push('<ul class="reviewStepList">')
    for (const item of turn.flow) lines.push(flowMarkup(item))
    lines.push('</ul>')
    lines.push(`<div class="reviewMessage" data-role="assistant"><div class="reviewMessageText"><p>${turn.answer}</p></div></div>`)
  } else {
    /* 两级折：整轮一个折，里面**每一段连续过程**各自一个小折（官方 `ProcessGroup`）。
       切分点只有「说了话」，**不是步与步的边界**；一轮里只有一段时不再套那一层。
       展开态下组默认收着（官方 `useDisclosure` 初值），这里画成收着的样子。 */
    const open = MODE === 'expanded'
    lines.push(`<section class="detailSection reviewWorkSteps"><button type="button" class="detailDisclosure" aria-expanded="${open ? 'true' : 'false'}" aria-controls="w"><svg class="detailChevron foldMark" viewBox="0 0 16 16" width="16" height="16"><path d="M3 6 8 11 13 6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span class="detailDisclosureTitle">${turn.summary}</span></button>`)
    if (open) {
      /* 按官方的 `blocksOf` 切：回复与读者插话把过程切成多段。 */
      const segments = []
      let segment = []
      for (const item of turn.flow) {
        if (item.kind === 'reply' || item.kind === 'reader') {
          if (segment.length > 0) segments.push({ kind: 'steps', items: segment })
          segment = []
          segments.push({ kind: item.kind, items: [item] })
          continue
        }
        segment.push(item)
      }
      if (segment.length > 0) segments.push({ kind: 'steps', items: segment })
      const stepSegments = segments.filter(one => one.kind === 'steps').length
      lines.push('<div class="detailSectionBody"><div class="reviewStepList">')
      for (const one of segments) {
        if (one.kind !== 'steps') { lines.push(flowMarkup(one.items[0])); continue }
        /* 只有一段过程就不套第二层（与渲染器同一条判据）。 */
        if (stepSegments <= 1) {
          lines.push('<ul class="reviewStepList">')
          for (const item of one.items) lines.push(flowMarkup(item))
          lines.push('</ul>')
          continue
        }
        lines.push(clusterMarkup(one.items, false))
      }
      lines.push('</div></div>')
    }
    lines.push('</section>')
    lines.push(`<div class="reviewMessage" data-role="assistant"><div class="reviewMessageText"><p>${turn.answer}</p></div></div>`)
  }
  lines.push('</li>')
}

const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>${scoped}</style>
<style>${read('src/client/design/tokens.module.css')}</style>
<style>${read('src/client/design/base.module.css')}</style>
<style>${read('src/client/design/components.module.css')}</style>
<style>${read('src/client/board.module.css')}</style>
<style>
  body { margin: 0; padding: 24px; background: var(--dsh-tb-bg-canvas, #f6f6f6); }
  .reviewTranscriptScroll { box-sizing: border-box; padding-right: 14px; }
</style></head><body>
<div data-dsh-taskboard-view="" data-dsh-taskboard-panel="">
  <div class="reviewTranscriptScroll" style="height:${flag('height', '560')}px">
    <ul class="reviewTranscript">
${lines.join('\n')}
    </ul>
  </div>
</div>
</body></html>`

const work = mkdtempSync(join(tmpdir(), 'tb-transcript-'))
const html = join(work, 'page.html')
writeFileSync(html, page, 'utf8')
const shot = spawnSync(process.execPath, [
  join(ROOT, 'scripts/shot-panel.mjs'),
  '--out', OUT,
  '--url', `file:///${html.replace(/\\/g, '/')}`,
  '--width', String(WIDTH), '--height', flag('height', '620'),
  '--scale', '2', '--wait', '400', '--scrollbars',
], { encoding: 'utf8' })
process.stdout.write(shot.stdout ?? '')
process.stderr.write(shot.stderr ?? '')
console.log(`mode=${MODE} width=${WIDTH} out=${OUT}`)
