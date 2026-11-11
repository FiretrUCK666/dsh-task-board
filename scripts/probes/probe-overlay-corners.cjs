// 三种浮层的四角：把每一个都渲染成真页面，逐角拍下来，与改前对照。
//
// 面板停止裁切之后，每个「铺到边上的带」都要自己声明那个角。这一页把三处都摆出来，
// 因为漏掉任何一处，屏上都是一个方角——而方角在缩略图里看不出来，只有放大才看得见。
//
// 用法：
//   node scripts/probes/probe-overlay-corners.cjs

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'tmp', 'overlay-corners')

const ENTRY = `
import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import css from '../../src/client/board.module.css'
import components from '../../src/client/design/components.module.css'
import '../../src/client/design/base.module.css'
import tokens from '../../src/client/design/tokens.module.css?inline'

const tokensStyle = document.createElement('style')
tokensStyle.textContent = tokens
document.head.appendChild(tokensStyle)

const PARAMS = new URLSearchParams(location.search)
const WHICH = PARAMS.get('which') ?? 'detail'

/* A review panel: header band on top, body in the middle, rail with a composer at the
   bottom right, transcript on the left. */
function Review() {
  return createElement('div', { className: components.modalBackdrop },
    createElement('div', { className: components.modal + ' ' + css.review, 'data-overlay': 'review' },
      createElement('header', { className: css.reviewHeader },
        createElement('h2', { className: css.reviewTitle }, '把评论区的滚动修好')),
      createElement('div', { className: css.reviewBody },
        createElement('div', { className: css.reviewMain },
          createElement('div', { style: { padding: '14px 0 20px 20px' } },
            Array.from({ length: 12 }, (_u, index) => createElement('p', { key: index, style: { margin: '0 0 14px' } },
              '对话第 ' + String(index + 1) + ' 行：这一段只是把对话区撑满。')))),
        createElement('aside', { className: css.reviewRail },
          createElement('div', { className: css.sessionRailFolds },
            createElement('div', { style: { padding: '12px 14px' } }, '评论区的内容')),
          createElement('div', { className: css.reviewComposer },
            createElement('div', { className: css.reviewComposerRow }, '写一句，回车发出去'))))))
}

/* A task detail: header band, scrolling body, footer band. */
function Detail() {
  return createElement('div', { className: components.modalBackdrop },
    createElement('div', { className: components.modal + ' ' + css.detail, 'data-overlay': 'detail' },
      createElement('header', { className: css.detailHeader },
        createElement('h2', { className: css.detailTitle }, '任务详情')),
      createElement('div', { className: css.detailBody },
        createElement('div', { style: { padding: '14px 18px' } },
          Array.from({ length: 40 }, (_u, index) => createElement('p', { key: index, style: { margin: '0 0 14px' } },
            '正文第 ' + String(index + 1) + ' 行：这一段只是把详情撑满，好让页脚落在面板的底边上。')))),
      createElement('footer', { className: css.detailFooter },
        createElement('span', {}, '已选 0 个'),
        createElement('button', { type: 'button' }, '取消'),
        createElement('button', { type: 'button' }, '保存'))))
}

createRoot(document.getElementById('root')).render(
  WHICH === 'detail' ? createElement(Detail) : createElement(Review))

window.__mounted = true
`

const HTML = (cssText, bundle) => `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>${cssText}</style>
<style>
  html, body { margin: 0; block-size: 100%; background: #e8e9ec; overflow: hidden; }
  /* The token sheet is scoped to this attribute — it is the marker the plugin puts on
     its own subtree. Without it every --dsh-tb-* resolves to nothing and the page has
     no colours, which is what a corner measured here would be measuring. */
  [data-dsh-taskboard-view] { block-size: 100%; min-block-size: 0; }
</style></head><body>
<div data-dsh-taskboard-view><div id="root"></div></div>
<script>${bundle}</script>
</body></html>`

/** The host's token sheet: every `--dsh-tb-*` here is derived from a `--dsw-*` the host
 *  provides, so without it this page has no colours at all — and a corner measured on a
 *  colourless page says nothing about the real one. The reader lives in `host-theme.cjs`. */
const { hostThemeCss } = require('./host-theme.cjs')

async function main() {
  let vite
  try {
    const require_ = require('node:module').createRequire(require.resolve('vitest'))
    vite = require_('vite')
  } catch {
    console.error('probe-overlay-corners: SKIP — 解析不到 vite。这一页没有造出来，所以什么都没量到。')
    process.exit(2)
  }
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'entry.tsx'), ENTRY, 'utf8')
  await vite.build({
    root: ROOT,
    configFile: false,
    mode: 'production',
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.env': '{}' },
    build: {
      outDir: OUT,
      emptyOutDir: false,
      minify: false,
      target: 'chrome120',
      lib: { entry: path.join(OUT, 'entry.tsx'), formats: ['iife'], name: 'OverlayCorners', fileName: () => 'bundle.js' },
    },
  })
  const cssFiles = fs.readdirSync(OUT).filter(name => name.endsWith('.css'))
  const cssText = [hostThemeCss(), ...cssFiles.map(name => fs.readFileSync(path.join(OUT, name), 'utf8'))].join('\n')
  const bundle = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8')
  const page = path.join(ROOT, 'tmp', 'overlay-corners.html')
  fs.writeFileSync(page, HTML(cssText, bundle), 'utf8')
  const url = 'file://' + page.replace(/\\/g, '/')
  console.log(`wrote ${path.relative(ROOT, page).replace(/\\/g, '/')}`)
  for (const which of ['detail', 'review']) {
    console.log(`  node scripts/probes/run-corner-shots.mjs --page tmp/overlay-corners.html --query "which=${which}" --selector "[data-overlay]" --corner br`)
  }
}

main().catch((error) => {
  console.error(`probe-overlay-corners: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
