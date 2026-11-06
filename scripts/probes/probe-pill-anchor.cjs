// 一个不依赖任何框架的最小页面：**绝对定位的胶囊住在滚动容器里**，它到底钉在容器的
// 可见角上，还是跟着内容一起滚走？
//
// 这个问题决定「滑到最新」该住在哪一层，而直觉在这里正好会错：CSS 的包含块是最近的一个
// 定位祖先，可**滚动偏移仍然会施加到它上面**。所以「relative 的滚动容器 + 里面一个
// absolute 的子元素」在滚动位置 0 处看着完全正确（内容顶端与容器顶端重合），一滚就飘走。
//
// 三种摆法各量一次，答案只有一个是对的：
//   A 里面的 relative 容器 + 里面 absolute 的胶囊  → 跟着内容走（错）
//   B 外面的 relative 框 + 里面 absolute 的胶囊      → 钉在框角（对）
//   C 里面的**不定位**容器 + 里面 absolute 的胶囊    → 见结果（包含块在外层时的行为）
//
// 用法：node scripts/probes/probe-pill-anchor.cjs
//   node scripts/shot-panel.mjs --url file:///<cwd>/tmp/pill-anchor.html \
//     --eval-file scripts/probes/probe-pill-anchor.js --width 400 --height 900

const fs = require('node:fs')
const path = require('node:path')

const rows = Array.from({ length: 30 }, (_u, i) => `<div class="row">第 ${i + 1} 行</div>`).join('')

const PAGE = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
  body { margin: 0; font: 14px system-ui; padding: 12px; }
  .scroll { width: 300px; height: 240px; overflow-y: auto; border: 1px solid #888; }
  .scroll.relative { position: relative; }
  .row { height: 40px; border-bottom: 1px solid #eee; display: flex; align-items: center; padding-left: 8px; }
  .pill { position: absolute; bottom: 12px; right: 20px; width: 26px; height: 26px; background: #333; border-radius: 13px; }
  .frame { position: relative; width: 300px; margin: 16px 0; }
  /* C 的外层框：胶囊的包含块在滚动容器之外。 */
  .outer { position: relative; width: 300px; margin: 16px 0; }
</style></head><body>
<!-- A：胶囊住在 relative 的滚动容器里（产品现在的写法）。 -->
<div class="scroll relative" id="aBox">${rows}<div class="pill" id="aPill"></div></div>
<!-- B：胶囊住在滚动容器外面的框上。 -->
<div class="frame" id="bFrame"><div class="scroll" id="bBox">${rows}</div><div class="pill" id="bPill"></div></div>
<!-- C：胶囊住在**不定位**的滚动容器里，外层是 relative。 -->
<div class="outer" id="cFrame"><div class="scroll" id="cBox">${rows}<div class="pill" id="cPill"></div></div></div>
</body></html>`

const out = path.join('tmp', 'pill-anchor.html')
fs.mkdirSync('tmp', { recursive: true })
fs.writeFileSync(out, PAGE, 'utf8')

const url = 'file://' + path.resolve(out).replace(/\\/g, '/')
console.log(`wrote ${out}`)
console.log('now:')
console.log(`  node scripts/shot-panel.mjs --url ${url} --eval-file scripts/probes/probe-pill-anchor.js --width 400 --height 900`)
