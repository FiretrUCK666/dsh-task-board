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
   判据（哪一轮该折）在 work-steps.ts 里，由 spec 钉住。 */
const TURNS = [
  {
    prompt: '把东墙那盏灯换掉',
    summary: '3 次工具调用 · 2 段思考 · 1 条上下文',
    steps: [
      ['read', '已完成'],
      ['思考', '412 字'],
      ['bash', '已完成'],
      ['思考', '88 字'],
      ['上下文注入', 'AGENTS.md'],
      ['write', '已完成'],
    ],
    answer: '换好了：东墙那盏换成了轨道灯，位置没动天花板。',
  },
  {
    prompt: '顺便看一下客厅的色温',
    summary: '1 次工具调用',
    steps: [['grep', '已完成']],
    answer: '客厅现在是 2700K 的暖白，与东墙那盏 3000K 差一档。要不要一起调？',
  },
]

const lines = []
for (const turn of TURNS) {
  lines.push('<li class="reviewTurn">')
  lines.push(`<div class="reviewMessage" data-role="user"><div class="reviewMessageText"><p>${turn.prompt}</p></div></div>`)
  if (MODE === 'verbose') {
    lines.push('<ul class="reviewStepList">')
    for (const [name, state] of turn.steps) {
      lines.push(`<li class="reviewStep"><span class="reviewStepName truncate">${name}</span><span class="reviewStepState">${state}</span></li>`)
    }
    lines.push('</ul>')
    lines.push(`<div class="reviewMessage" data-role="assistant"><div class="reviewMessageText"><p>${turn.answer}</p></div></div>`)
  } else {
    const open = MODE === 'expanded'
    lines.push(`<section class="detailSection reviewWorkSteps"><button type="button" class="detailDisclosure" aria-expanded="${open ? 'true' : 'false'}" aria-controls="w"><svg class="detailChevron foldMark" viewBox="0 0 16 16" width="16" height="16"><path d="M3 6 8 11 13 6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span class="detailDisclosureTitle">${turn.summary}</span></button>`)
    if (open) {
      lines.push('<div class="detailSectionBody"><ul class="reviewStepList">')
      for (const [name, state] of turn.steps) {
        lines.push(`<li class="reviewStep"><span class="reviewStepName truncate">${name}</span><span class="reviewStepState">${state}</span></li>`)
      }
      lines.push('</ul></div>')
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
