// 造页器：写出「被盖住的那一层停了什么」那条判据要测的工件页。
//
// 判据与它测的那张页必须在一起，否则一边改了另一边忘了——所以页面的 DOM 形状和被测的
// 那条 CSS 规则都写在这个文件里，与 `probe-covered-paint.js` 成对使用。
//
// 页面刻意复刻真实的**层级与布局**：
//
//   data-dsh-taskboard-view
//     └ .board（列向 flex，撑满，内部有板头）
//         ├ .boardHeader（不动的工具带）
//         ├ [data-dsh-tb-columns]（grid，flex: 1 → 高度由 flex 给，不由内容给）
//         └ .modalBackdrop（**后代**，不是直接子元素）
//
// 两处都是被踩过的：
//
//   - 遮罩是后代而不是直接子元素——那条规则第一版写成 `>`，看起来对、实际匹配不上，
//     而源码里读起来毫无异样；
//   - 列网格的高度由 `flex: 1` 给，不由内容给——所以 `content-visibility: hidden`
//     跳过内容时**盒子的高度不变**，关掉面板时板不会跳。它的自动高度会塌成 0，
//     这一条正是本文件里那两行布局要复刻的事实。
//
// 另外刻意在**面板内部**放一个以 `_columns` 结尾的类名：那条规则曾经用类名后缀定位，
// 于是把面板自己的背景一起藏掉了，屏上表现为「点开之后后面什么都没有了」。
//
// 用法：node scripts/probes/probe-covered-paint.cjs
// 然后按它打印的那条命令交给 Chromium。

const fs = require('node:fs')
const path = require('node:path')

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  @keyframes breath { 0%,100% { opacity: .3 } 50% { opacity: 1 } }
  .card, .column, .sessionRow { animation: breath 2.6s infinite; }
  /* THE RULE UNDER TEST — kept verbatim in step with board.module.css. */
  [data-dsh-taskboard-view]:has([class*='modalBackdrop']) [data-dsh-tb-columns] {
    content-visibility: hidden;
  }
  body { margin: 0; font: 13px system-ui; }
  [data-dsh-taskboard-view] { position: relative; block-size: 420px; display: flex; }
  /* The board's own shape: a column flex that fills its view. */
  .abc123_board { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 12px; gap: 10px; }
  .abc123_boardHeader { flex: none; block-size: 44px; background: #eee; }
  /* The grid's height comes from the flex, NOT from its contents — which is why
     skipping the contents changes nothing a reader can see. */
  [data-dsh-tb-columns] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; flex: 1; min-height: 0; }
  .column { display: flex; flex-direction: column; gap: 8px; padding: 8px; }
  .abc123_cards { min-height: 0; overflow-y: auto; }
  .card { padding: 8px; border: 1px solid #ccc; margin-bottom: 8px; }
  .abc123_fakeColumns { padding: 8px; }
  .abc123modalBackdrop { position: absolute; inset: 0; background: rgba(0,0,0,.2); }
</style></head><body>
<div data-dsh-taskboard-view id="seat">
  <div class="abc123_board">
    <div class="abc123_boardHeader">board header</div>
    <div data-dsh-tb-columns>
      <div class="column" data-status="todo">
        <div class="abc123_cards">
          <div class="card" data-task-id="t-1">card</div>
          <div class="sessionRow">row</div>
        </div>
      </div>
      <div class="column" data-status="done">
        <div class="abc123_cards">
          <div class="card" data-task-id="t-2">card</div>
        </div>
      </div>
    </div>
  </div>
  <div class="abc123modalBackdrop" id="backdrop">
    <div class="abc123_fakeColumns">panel content</div>
  </div>
</div>
</body></html>`

const out = path.join('tmp', 'probe-covered-paint.html')
fs.mkdirSync('tmp', { recursive: true })
fs.writeFileSync(out, PAGE, 'utf8')

const url = 'file://' + path.resolve(out).replace(/\\/g, '/')
console.log(`wrote ${out}`)
console.log('now:')
console.log(`  node scripts/shot-panel.mjs --url ${url} --eval-file scripts/probes/probe-covered-paint.js --audit --out tmp/probe-covered-paint.png`)
