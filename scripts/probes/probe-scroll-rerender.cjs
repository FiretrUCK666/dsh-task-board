// 造页器：量「滚动时把整块内容重画一遍」到底要多少毫秒。
//
// ── 它回答的那一个问题 ────────────────────────────────────────────────────────
//
// 读者说「在底部往上一滑，画面会瞬间卡一下」。查下来的根因是：**「在不在底部」
// 被写成了面板的 React 状态**，所以离开底部的那一帧要把整块内容重画一遍。会话越长，
// 这一下越重。
//
// 这条探针不假装量整个产品——它量的是**被删掉的那一项成本**：同一段滚动，在
// 「每帧把整块内容重画一遍」与「什么都不重画」两种情形下各要多少毫秒。两次跑在同一张页、
// 同一段手势、同一台机器上，所以差出来的那部分就是重画本身的价钱。
//
// ── 造页为什么在 `.cjs` 里 ────────────────────────────────────────────────────
//
// 写文件要 node 的 `fs`，而量页那段要跑在浏览器里。两半分工，沿用本目录其它探针的
// 形状：造页在 `.cjs`，量在 `.js`。
//
// 页面复用**真样式表**（tokens / base / components / board）与真类名，所以量到的
// 排版成本是这条内容的真实成本，不是一条自造的玩具列表。
//
// ── 内容规模 ──────────────────────────────────────────────────────────────────
//
// 40 轮对话（每轮：一句提问 + 一个过程折 + 三段回答），加 40 条评论。这是**中等偏长**
// 的一次会话；`DESIGN.md` 记下的最长一条内容实测 41,308px 高、2,369 个节点——那一条
// 会让两种情形都变慢，差别反而不容易读，所以这里取中等规模，成本已经可测。
//
// 用法：
//   node scripts/probes/probe-scroll-rerender.cjs
//   然后按它打印的那条命令交给 Chromium。

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 宿主主题表：本插件每个 --dsh-tb-* 都从 --dsw-* 派生，缺了它颜色全是空的。 */
function hostThemeCss() {
  const candidates = [
    path.join(process.env.APPDATA ?? '', 'npm', 'node_modules'),
    path.join(process.env.HOME ?? '', '.npm', 'node_modules'),
  ]
  const bundle = candidates
    .map((root) => path.join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js'))
    .find((one) => fs.existsSync(one))
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

const hostCss = hostThemeCss()
if (hostCss === '') {
  console.error('probe-scroll-rerender: 找不到已安装的 DSH 主题表，颜色会是空的，这条没量。')
  process.exit(2)
}
const scoped = hostCss.replace(
  /(^|[}\n])(body)(\[data-ds-dark-theme\])?\{/g,
  (_whole, lead, _body, dark) => `${lead}html${dark ?? ''},body${dark ?? ''}{`,
)

const TURNS = 40
const COMMENTS = 40

const paragraph = '这一轮的回答有两三行：先说结论，再说依据，最后说下一步。文字长度刻意接近真实回答，让每一条都换到几行。'
const turn = (index) => `
<li class="reviewTurn">
  <div class="reviewMessage" data-role="user"><div class="reviewMessageText"><p class="mdParagraph">第 ${index + 1} 轮的问题：把东墙那盏灯换掉，顺便看一下色温。</p></div></div>
  <section class="detailSection reviewWorkSteps">
    <button type="button" class="detailDisclosure" aria-expanded="false"><svg class="detailChevron foldMark" viewBox="0 0 16 16" width="16" height="16"><path d="M3 6 8 11 13 6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span class="detailDisclosureTitle">3 次工具调用 · 2 段思考</span></button>
  </section>
  <div class="reviewMessage" data-role="assistant"><div class="reviewMessageText">
    <p class="mdParagraph">${paragraph}</p>
    <p class="mdParagraph">${paragraph}</p>
    <ul class="mdList"><li>第一条依据</li><li>第二条依据</li><li>第三条依据</li></ul>
  </div></div>
</li>`

const comment = (index) => `
<li class="reviewComment">
  <span class="reviewCommentText"><p class="mdParagraph">第 ${index + 1} 条评论：这一行故意写得长一点，让每一条都换到两三行，接近真实评论在窄栏里的高度。</p></span>
  <span class="reviewCommentMeta"><span class="reviewCommentChip">成功</span><span class="reviewCommentTime">2026-11-05 17:26:11</span></span>
</li>`

const transcript = Array.from({ length: TURNS }, (_unused, index) => turn(index)).join('')
const comments = Array.from({ length: COMMENTS }, (_unused, index) => comment(index)).join('')

const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${scoped}</style>
<style>${read('src/client/design/tokens.module.css')}</style>
<style>${read('src/client/design/base.module.css')}</style>
<style>${read('src/client/design/components.module.css')}</style>
<style>${read('src/client/board.module.css')}</style>
<style>
  body { margin: 0; background: var(--dsh-tb-bg-canvas, #f6f6f6); }
  /* 真几何：宽档右栏 344px；对话区与评论区各占一屏可见高度。
     宽度自适应是为了让**同一个工件**也能按窄档截一张——两条档位都由真样式表里
     那些容器查询决定，这里只提供盒子。 */
  #stage { display: flex; flex-wrap: wrap; gap: 12px; padding: 12px; max-width: 1360px; }
  #transcript { flex: 1 1 640px; height: 640px; }
  #rail { flex: 0 1 344px; width: min(344px, 46cqw); }
  #rail .sessionScrollFrame { height: 640px; }
  /* 窄档：真实面板里评论块在对话下方、自成一屏，所以这里也只留评论那一块——
     两档截的是**同一件东西**（那枚胶囊在滚动区右下角的样子），不是两张不同的构图。 */
  @media (max-width: 600px) {
    #transcript { display: none; }
    #rail { flex: 1 1 auto; width: auto; }
    #rail .sessionScrollFrame { height: 420px; }
  }
</style></head><body>
<div data-dsh-taskboard-view="" data-dsh-taskboard-panel="">
  <div id="stage">
    <div class="reviewTranscriptScroll" id="transcript">
      <ul class="reviewTranscript" id="transcriptList">${transcript}</ul>
    </div>
    <aside class="reviewRail" id="rail">
      <div class="sessionScrollFrame">
        <div class="commentsScroll" id="comments">
          <ul class="reviewComments" id="commentsList">${comments}</ul>
        </div>
        <button type="button" class="reviewJumpLatest" data-hidden="true" id="commentsPill" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 6.5 8 11.5 13 6.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
        </button>
      </div>
    </aside>
  </div>
</div>
<script>
  /* 重画用的那两份标记：**原样**的列表内容，量的时候塞回去就等于把整块重建一遍。 */
  window.__markup = { transcript: ${JSON.stringify(transcript)}, comments: ${JSON.stringify(comments)} }
</script>
</body></html>`

const out = path.join('tmp', 'probe-scroll-rerender.html')
fs.mkdirSync('tmp', { recursive: true })
fs.writeFileSync(out, page, 'utf8')

const url = 'file://' + path.resolve(out).replace(/\\/g, '/')
console.log(`wrote ${out}`)
console.log('now:')
console.log(`  node scripts/shot-panel.mjs --url ${url} --eval-file scripts/probes/probe-scroll-rerender.js --width 1400 --height 900`)
