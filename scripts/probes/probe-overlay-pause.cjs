// 造页器：写出「覆盖层暂停背景动画」那条判据要测的工件页。
//
// 判据与它测的那张页必须在一起，否则一边改了另一边忘了——所以页面的 DOM 形状和
// 被测的那条 CSS 规则都写在这个文件里，与 `probe-overlay-pause.js` 成对使用。
//
// 页面刻意复刻真实的层级：`data-dsh-taskboard-view` > `.board` > （卡片 ＋ 遮罩）。
// 遮罩是**后代**而不是直接子元素——第一版规则写成 `>` 就是在这里错的。
//
// 用法：node scripts/probes/probe-overlay-pause.cjs
// 然后按它打印的那条命令交给 Chromium。

const fs = require('node:fs')
const path = require('node:path')

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  @keyframes breath { 0%,100% { opacity: .3 } 50% { opacity: 1 } }
  .card, .column, .sessionRow { animation: breath 2.6s infinite; }
  /* THE RULE UNDER TEST — kept verbatim in step with board.module.css. */
  [data-dsh-taskboard-view]:has([class*='modalBackdrop']) :is(.card, .column, .sessionRow),
  [data-dsh-taskboard-view]:has([class*='modalBackdrop']) :is(.card, .column, .sessionRow)::after {
    animation-play-state: paused;
  }
  body { margin: 0; font: 13px system-ui; padding: 12px; }
  .board { position: relative; }
  .abc123modalBackdrop { position: absolute; inset: 0; background: rgba(0,0,0,.2); }
</style></head><body>
<div data-dsh-taskboard-view id="seat">
  <div class="board">
    <div class="column"><div class="card">card</div></div>
    <div class="sessionRow">row</div>
    <div class="abc123modalBackdrop" id="backdrop"></div>
  </div>
</div>
</body></html>`

const out = path.join('tmp', 'probe-overlay-pause.html')
fs.mkdirSync('tmp', { recursive: true })
fs.writeFileSync(out, PAGE, 'utf8')

const url = 'file://' + path.resolve(out).replace(/\\/g, '/')
console.log(`wrote ${out}`)
console.log('now:')
console.log(`  node scripts/shot-panel.mjs --url ${url} --eval-file scripts/probes/probe-overlay-pause.js --audit`)
