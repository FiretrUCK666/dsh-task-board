// 造页器：上下文窗口「往上滑第一下被拽回底部」这条判据要测的工件页。
//
// 与 `probe-follow-first-scroll.js` 成对使用。页面复刻真实的可滚区域：一个固定高
// 的盒子、远超它高度的内容、以及一个可以被外部改高度的内层（模拟 ResizeObserver
// 看到的那类尺寸变化：图片加载、Markdown 重排）。
//
// 用法：node scripts/probes/probe-follow-first-scroll.cjs

const fs = require('node:fs')
const path = require('node:path')

const rows = Array.from({ length: 80 }, (_, i) => `<div class="row">消息 ${i + 1}</div>`).join('')

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 13px/1.5 system-ui; padding: 12px; }
  #scroller { height: 300px; overflow-y: auto; background: #fff; border-radius: 12px; }
  .row { padding: 6px 10px; border-bottom: 1px solid #eee; }
</style></head><body>
<div id="scroller"><div id="content">${rows}</div></div>
</body></html>`

const out = path.join('tmp', 'probe-follow-first-scroll.html')
fs.mkdirSync('tmp', { recursive: true })
fs.writeFileSync(out, PAGE, 'utf8')

const url = 'file://' + path.resolve(out).replace(/\\/g, '/')
console.log(`wrote ${out}`)
console.log('now:')
console.log(`  node scripts/shot-panel.mjs --url ${url} --eval-file scripts/probes/probe-follow-first-scroll.js --audit`)
