// 造页器：写出「被盖住的那块板每条通知花多少」要测的工件页。
//
// 判据与它测的那张页必须在一起，否则一边改了另一边忘了——所以页面的形状与规模都写在
// 这个文件里，与 `probe-covered-render.js` 成对使用。
//
// ── 规模从哪来 ───────────────────────────────────────────────────────────────
//
// 五列 × 每列 8 张卡 = 40 张，与会话面板那一档的实测规模同一量级（`DESIGN.md` 里
// 「40 轮对话 + 40 条评论，928 个节点」那一行）。**页面的规模就是结论的一部分**：卡数
// 一改，探针量到的毫秒数就不再是文档里那个数，所以两个数一起写进文档。
//
// ── 形状为什么是这些 ─────────────────────────────────────────────────────────
//
//   - 每张卡都带 `data-task-id`：FLIP 的几何测量按它找元素；
//   - 列带 `data-status`、外层带 `data-dsh-tb-columns`：与真实看板同一族标记，
//     探针量的选择器就是产品里那个；
//   - 里面还有一串带文字的块：重算的代价一半在节点数上，空 DIV 会低估它。
//
// 用法：node scripts/probes/probe-covered-render.cjs
// 然后按它打印的那条命令交给 Chromium。

const fs = require('node:fs')
const path = require('node:path')

const STATUSES = ['backlog', 'todo', 'running', 'review', 'done']
const PER_COLUMN = 8

/** 一张卡：三条线 + 两颗芯片，与真实卡片一样是多节点的一块。 */
const cardOf = (status, index) => `      <article class="card" data-task-id="${status}-${index}" data-status="${status}">
        <header class="cardHead">
          <span class="cardTitle">第 ${index + 1} 张卡：一个会换行的标题，长度接近真实</span>
          <span class="chip">待处理</span>
        </header>
        <p class="cardNext">下一句话：等它把这条跑完，再看要不要接着跑</p>
        <footer class="cardFoot">
          <span class="chip">2 个会话</span>
          <span class="cardTime">3 分钟前</span>
        </footer>
      </article>`

const columnOf = (status) => `    <section class="column" data-status="${status}">
      <header class="columnHead"><span class="columnName">${status}</span><span class="columnCount">${PER_COLUMN}</span></header>
      <div class="cards" id="cards-${status}">
${Array.from({ length: PER_COLUMN }, (_, index) => cardOf(status, index)).join('\n')}
      </div>
    </section>`

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  @keyframes breath { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
  body { margin: 0; font: 13px system-ui; background: #fafafa; }
  [data-dsh-taskboard-view] { position: relative; }
  [data-dsh-tb-columns] { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; padding: 12px; }
  .column { display: flex; flex-direction: column; gap: 8px; background: #f0f0f0; border-radius: 8px; padding: 8px; }
  .cards { display: flex; flex-direction: column; gap: 8px; }
  .card { display: flex; flex-direction: column; gap: 6px; padding: 10px; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; animation: breath 2.6s infinite; }
  .card[data-status='running'] { border-color: #d9a441; }
  .cardHead { display: flex; gap: 6px; align-items: center; justify-content: space-between; }
  .cardTitle { font-weight: 600; }
  .chip { padding: 1px 6px; border-radius: 999px; background: #eee; font-size: 11px; }
  .cardNext { margin: 0; color: #555; }
  .cardFoot { display: flex; gap: 6px; justify-content: space-between; color: #777; font-size: 11px; }
</style></head><body>
<div data-dsh-taskboard-view id="seat">
  <div data-dsh-tb-columns>
${STATUSES.map(columnOf).join('\n')}
  </div>
</div>
</body></html>`

const out = path.join('tmp', 'probe-covered-render.html')
fs.mkdirSync('tmp', { recursive: true })
fs.writeFileSync(out, PAGE, 'utf8')

const url = 'file://' + path.resolve(out).replace(/\\/g, '/')
console.log(`wrote ${out} (${STATUSES.length} columns x ${PER_COLUMN} cards)`)
console.log('now:')
console.log(`  node scripts/shot-panel.mjs --url ${url} --eval-file scripts/probes/probe-covered-render.js --audit --out tmp/probe-covered-render.png`)
