// 造页器：**带图片的会话**——两个变量，四个读数。
//
// ── 它回答的那一个问题 ────────────────────────────────────────────────────────
//
// 读者说「某些 session 卡」，而前面四个探针（评论列表、对话列表、轮询到达、压在别人
// 身上滚动）全部零丢帧。它们共同的缺口是**图片**：那一类会话与别类的区别不是轮数，而是
// 对话里贴着截图。
//
// 图片这条路在本项目里有一个很强的嫌疑：`MessageImage` 把读回来的字节拼成
// `data:image/png;base64,…` 塞进 `<img src>` **和** 外层 `<a href>`，而盒子只有 140px。
// 一张 1600×1000 的截图会**按原分辨率解码**，再在每一帧被缩到 140px 画出来；`loading="lazy"`
// 对已经内联在属性里的字节帮不上忙。
//
// 这一页就把这件事量出来，并且同时量一条候选改法（同一份字节换成 Blob 对象 URL）：
//
//   ?images=0                     基线（没有图片）
//   ?images=12&src=data           今天的处境
//   ?images=12&src=blob           候选改法
//
// 三次跑同一份代码、同一段手势，所以差出来的就是「图片怎么进 DOM」的价钱。
//
// 用法：
//   node scripts/probes/probe-transcript-images.cjs

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'transcript-images')

const ENTRY = `
import { createElement, memo, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import css from '../../src/client/board.module.css'
import '../../src/client/design/base.module.css'
import tokens from '../../src/client/design/tokens.module.css?inline'

const tokensStyle = document.createElement('style')
tokensStyle.textContent = tokens
document.head.appendChild(tokensStyle)

const PARAMS = new URLSearchParams(location.search)
const IMAGES = Number(PARAMS.get('images') ?? '12')
const SRC_MODE = PARAMS.get('src') === 'blob' ? 'blob' : 'data'
/* The long side of the real screenshots people paste: a full-window capture. */
const SHOT_W = 1600
const SHOT_H = 1000

/* ONE screenshot, built once, exactly the shape the reader brings: a full-window
   capture with text on it (so it does not compress into a flat colour). */
function shotBytes() {
  const canvas = document.createElement('canvas')
  canvas.width = SHOT_W
  canvas.height = SHOT_H
  const context = canvas.getContext('2d')
  context.fillStyle = '#1b1d21'
  context.fillRect(0, 0, SHOT_W, SHOT_H)
  for (let row = 0; row < 46; row += 1) {
    context.fillStyle = row % 3 === 0 ? '#8ab4f8' : '#c8ccd2'
    const width = 240 + ((row * 137) % 900)
    context.fillRect(60, 40 + row * 20, width, 9)
  }
  return canvas.toDataURL('image/png')
}

const DATA_URL = shotBytes()
const BYTES = Math.round((DATA_URL.length - DATA_URL.indexOf(',') - 1) * 3 / 4)
window.__bytes = BYTES

/* The candidate: same bytes, but going in as a Blob object URL instead of an inline
   data URL. Decoding is identical; what changes is that the DOM holds a short URL
   instead of megabytes of base64, and the engine can stream instead of inline. */
function blobUrlOf(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
}
const BLOB_URL = SRC_MODE === 'blob' ? blobUrlOf(DATA_URL) : DATA_URL

const ROW = memo(function Row({ index, withImage }) {
  return createElement('div', { className: css.reviewTurn },
    createElement('p', { className: css.mdParagraph }, '第 ' + String(index + 1) + ' 轮：把东墙那盏灯换掉，顺便看一下色温。'),
    createElement('div', { className: css.reviewMessage },
      createElement('div', { className: css.reviewMessageText },
        withImage && createElement('span', { className: css.reviewImageRow },
          createElement('a', { className: css.reviewImageBox, href: BLOB_URL },
            createElement('img', { className: css.reviewImage, src: BLOB_URL, alt: '截图', loading: 'lazy' }))),
        createElement('p', { className: css.mdParagraph }, '先说结论：这一处卡顿的根源不在条数，而在一条回答本身有多长。'),
        createElement('p', { className: css.mdParagraph }, '依据有三条：折轮是纯函数；真正贵的是把回答解析成节点；窗口越长越重。'))))
})

const TURNS = 30
const rows = Array.from({ length: TURNS }, (_u, index) => createElement(ROW, {
  key: index,
  index,
  withImage: index < IMAGES,
}))

createRoot(document.getElementById('root')).render(createElement('div', { id: 'transcript' }, rows))
window.__srcMode = SRC_MODE
window.__imageCount = document.querySelectorAll('img').length
window.__mounted = true
`

const HTML = (css, bundle) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css}</style>
<style>
  html, body { margin: 0; block-size: 100%; }
  body { display: flex; flex-direction: column; overflow: hidden; background: var(--dsh-tb-bg); }
  /* The root must carry the height too: the scroller is 100% of it, and without this
     the page renders at content height and nothing ever scrolls. */
  #root { block-size: 100%; min-block-size: 0; }
  #transcript { block-size: 100%; overflow-y: auto; padding: 16px; }
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
    console.error('probe-transcript-images: SKIP — 解析不到 vite（它是 vitest 自带的构建器）。这一页没有造出来，所以什么都没量到。')
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
        name: 'TranscriptImagesProbe',
        fileName: () => 'bundle.js',
      },
    },
  })

  const cssFiles = fs.readdirSync(OUT).filter(name => name.endsWith('.css'))
  if (cssFiles.length === 0) {
    console.error('probe-transcript-images: 打包没有产出样式表，这一页没有本插件的样式，不拍了。')
    process.exit(2)
  }
  const css = [hostThemeCss(), ...cssFiles.map(name => fs.readFileSync(path.join(OUT, name), 'utf8'))].join('\n')
  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'transcript-images.html')
  fs.writeFileSync(page, HTML(css, bundle), 'utf8')

  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')}`)
  console.log('now (same page, three configurations):')
  console.log(`  node scripts/shot-panel.mjs --url "${url}?images=0" --eval-file scripts/probes/probe-transcript-images.js --width 1440 --height 900 --scrollbars --out tmp/images-none.png`)
  console.log(`  node scripts/shot-panel.mjs --url "${url}?images=12&src=data" --eval-file scripts/probes/probe-transcript-images.js --width 1440 --height 900 --scrollbars --out tmp/images-data.png`)
  console.log(`  node scripts/shot-panel.mjs --url "${url}?images=12&src=blob" --eval-file scripts/probes/probe-transcript-images.js --width 1440 --height 900 --scrollbars --out tmp/images-blob.png`)
}

main().catch((error) => {
  console.error(`probe-transcript-images: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
