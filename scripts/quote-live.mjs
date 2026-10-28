#!/usr/bin/env node
/**
 * quote-live.mjs — 在真 Chrome 里跑一遍引用手势。
 *
 * ── 为什么需要它，以及它证明了什么、没证明什么 ───────────────────────────────
 *
 * `pnpm test` 里那几条 spec 跑在 jsdom 上，而 jsdom **没有布局**：`Range` 的矩形是
 * 我给它的，`getBoundingClientRect()` 的矩形也是我给它的。也就是说那些测试证明的是
 * 「一旦有了矩形，判据会怎么走」，而不是「浏览器真的会给这个矩形」。
 *
 * 这条脚本补的正是那一格：真 Chromium、真排版、真选区、真指针按下。它回答三个只能由
 * 浏览器回答的问题：
 *
 *   1. `window.getSelection()` 在一段渲染过的文字上**真的给出非零矩形**吗？
 *   2. 那枚按钮**真的会浮出来、且整个落在面板之内**吗？
 *   3. 按下它之后，引用**真的进了输入框**、并且按钮自己收起吗？
 *
 * 它**不**证明视觉品味（那是人看图的事），也不替代 `pnpm test` 里的判据。
 *
 * ── 产物一律写到系统临时目录 ─────────────────────────────────────────────────
 *
 * 这个脚本要落三样东西：一个浏览器 profile 目录（Chrome 会往里写缓存与扩展）、一个
 * 待打开的 HTML、几张截图。**它们一样都不许落进仓库**——`verify-standalone.mjs` 会
 * 扫仓库里的每一个文本文件，而 profile 里的缓存带着 CRLF，于是整条门禁变红，红的理由
 * 与本次改动毫无关系。所以它们全部去 `os.tmpdir()` 下的一个临时目录，跑完即删。
 *
 * 用法：node scripts/quote-live.mjs
 * 环境：DSH_SHOT_BROWSER 指向 Chromium/Chrome（默认自动找）；
 *       QUOTE_LIVE_KEEP=1 保留临时目录并把路径打出来（想看截图时用）
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 所有产物落在这里（系统临时目录下的一个临时目录）。
 *
 * **这不是洁癖，是门禁的硬约束**：`verify-standalone.mjs` 会扫仓库里每一个文本文件，
 * 而 Chrome 的 profile 缓存带 CRLF——留在仓库里就会让一条与本次改动毫无关系的门禁变红。
 * 跑完即删；要留住截图看就设 `QUOTE_LIVE_KEEP=1`。
 */
const WORK = mkdtempSync(join(tmpdir(), 'dsh-quote-live-'))
const KEEP = process.env.QUOTE_LIVE_KEEP === '1'

/** 找一台浏览器；找不到就说清楚并退出（不假装跑过）。 */
function browserPath() {
  if (process.env.DSH_SHOT_BROWSER) return process.env.DSH_SHOT_BROWSER
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ]
  return candidates.find(existsSync)
}

/**
 * 宿主那张主题样式表（含 `--dsw-*` 的全部取值），或空串。
 *
 * 与 `tests/panel-harness.ts` 的 `dshHome()` 同一个发现方式：宿主是**按需安装**的，
 * 不是本包的依赖（`dependencies` 为空），所以只能现场找。找不到时返回空串、由调用方
 * 说清楚并退出——**不拍一张缺了主题的图**，那种图会让人以为按钮本来就是一块裸字。
 */
function hostThemeCss() {
  const candidates = [
    join(process.env.APPDATA ?? '', 'npm', 'node_modules'),
    join(process.env.HOME ?? '', '.npm', 'node_modules'),
  ]
  const bundle = candidates
    .map(root => join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'client.js'))
    .find(existsSync)
  if (bundle === undefined) return ''
  const source = readFileSync(bundle, 'utf8')
  const sheets = []
  for (const match of source.matchAll(/(\w+)_css_default\s*=\s*"/g)) {
    /* 截取要带上首尾两个引号：`JSON.parse` 只吃带引号的字面量，而解析失败在这里是
       **静默的**——它会读成「宿主一个令牌都没有」，而不是「这一行有 bug」。 */
    const open = match.index + match[0].length - 1
    let end = open + 1
    while (end < source.length) {
      if (source[end] === '\\') { end += 2; continue }
      if (source[end] === '"') break
      end += 1
    }
    try {
      sheets.push(JSON.parse(source.slice(open, end + 1)))
    } catch {
      /* 一条解析不了的字面量是那个 bundle 的事实，不能因此把整张表判成空。 */
    }
  }
  return sheets.join('\n')
}

/**
 * 这一页把**真实构建产物**里的样式与研究中的三段纯逻辑装进来，只自己搭「面板 + 一段
 * 正文 + 一个 textarea」这三样环境。
 *
 * 之所以不能直接挂 React 组件：`lib/client.js` 是给宿主 `__ModuleLoader__` 用的闭包
 * 工厂，脱离宿主起不来。所以这里复刻的是**同一份判据**（从 `src` 读源码、注入执行），
 * 而不是另写一遍——文法的唯一实现仍然是 `quote-text.ts` / `quote-anchor.ts`。
 */
async function pageHtml() {
  const boardCss = readFileSync(join(ROOT, 'src/client/board.module.css'), 'utf8')
  const designCss = readFileSync(join(ROOT, 'src/client/design/tokens.module.css'), 'utf8')
  const baseCss = readFileSync(join(ROOT, 'src/client/design/base.module.css'), 'utf8')
  const componentsCss = readFileSync(join(ROOT, 'src/client/design/components.module.css'), 'utf8')
  /* 宿主的真实主题令牌。**这一条决定了截图能不能用来判断颜色**：本插件所有
     `--dsh-tb-*` 都是从宿主的 `--dsw-*` 派生的，没有那一层，全部解析为空——按钮会变成
     一块没有底、没有边、没有影的裸字，而那不是组件的缺陷，是这一页缺了它所在的世界。
     所以这里读**已安装的宿主**那张主题表，不手抄一份快照：快照在宿主换肤的第一天就过期，
     而过期的快照比没有更糟（渲染出一个颜色像样、却属于另一个宿主的页面）。 */
  const hostCss = hostThemeCss()
  if (hostCss === '') {
    console.error('quote-live: 找不到已安装的 DSH 主题表，这一页无法正确显示颜色，直接退出而不是拍一张误导的图。')
    process.exit(2)
  }
  /* 宿主的令牌表挂在 `body` 上，而一个独立页面的 ROOT 因此没有令牌、也没有底色。
     把 `body{` 扩成 `html,body{` 才让这张页面与真实 GUI 同构（同一个坑 `panel-harness`
     的 `writeStandalonePage` 记录过：宿主 CSS 是压缩过的，`body{` 会紧跟在 `}` 后面）。 */
  const scopedHostCss = hostCss.replace(
    /(^|[}\n])(body)(\[data-ds-dark-theme\])?\{/g,
    (_whole, lead, _body, dark) => `${lead}html${dark ?? ''},body${dark ?? ''}{`,
  )
  /* 纯逻辑：用项目已在 devDependencies 里的 TypeScript 把类型标注剥掉，剩下的就是能在
     浏览器里跑的 ES 模块。**不引入新依赖**——`esbuild` 不是本包的直接依赖，而为一个
     探针加一条依赖不划算（硬性规范 8）。 */
  const ts = (await import('typescript')).default
  const moduleSource = file => ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  const logic = [
    moduleSource(join(ROOT, 'src/client/board/quote-text.ts')),
    moduleSource(join(ROOT, 'src/client/board/quote-anchor.ts')),
  ]
    /* `transpileModule` 保留 `export`，而这一页要的是普通脚本作用域里的两个名字。
       把 `export function X` / `export const X` 的 `export ` 前缀去掉即可——这是这一份
       探针唯一做的源码改写，且只作用于前缀（不改函数体，判据仍是原文件那一份）。 */
    .map(source => source.replace(/^export (function|const)/gm, '$1'))
    .join('\n')
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>quote live probe</title>
<style>${scopedHostCss}</style>
<style>${designCss}</style>
<style>${baseCss}</style>
<style>${componentsCss}</style>
<style>${boardCss}</style>
<style>
  html, body { margin: 0; height: 100%; background: #fff; }
  #board { position: relative; height: 100%; }
  /* 面板宽度**跟着视口走**，不写死 560px。写死的话窄屏那一档里面板会横向溢出屏幕，
     选区矩形与桌面一模一样——两档跑出来的数字相同，看起来「两档都验过了」，其实只验了
     一档，而窄屏那档正是按钮最容易被逼到墙角的地方。 */
  #panel { position: relative; margin: 20px; padding: 20px; box-sizing: border-box;
           width: min(560px, calc(100vw - 40px));
           border: 1px solid #ddd; border-radius: 12px; overflow: hidden; }
  #text { margin: 0 0 16px; font: 13px/20px sans-serif; }
  #box { width: 100%; box-sizing: border-box; font: 13px/20px sans-serif; height: 72px; }
</style>
</head>
<body>
<div id="board" data-dsh-taskboard-view="">
  <div id="panel" data-dsh-taskboard-panel="">
    <p id="text">第一句话在这里。第二句话用来验证跨行选中的情况。第三句话收尾。</p>
    <textarea id="box"></textarea>
  </div>
</div>
<script>
${logic}/* 这一页只做接线，判据全部来自上面那两个模块。 */
const board = document.getElementById('board');
const panel = document.getElementById('panel');
const box = document.getElementById('box');
let layer = null;

/** 与 QuoteSelection.tsx 同一份判据。 */
function snapshotOf(host) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return undefined;
  const quote = quoteTextOf(selection.toString());
  if (quote === '') return undefined;
  const range = selection.getRangeAt(0);
  const anchor = range.commonAncestorContainer;
  const element = anchor.nodeType === 1 ? anchor : anchor.parentElement;
  if (!element || !host.contains(element)) return undefined;
  if (element.closest('textarea, input, [contenteditable="true"], button, select, [role="menu"], [role="dialog"]')) return undefined;
  const boxRect = range.getBoundingClientRect();
  if (boxRect.width === 0 || boxRect.height === 0) return undefined;
  return { quote, rect: { top: boxRect.top, left: boxRect.left, width: boxRect.width, height: boxRect.height } };
}

document.addEventListener('selectionchange', () => {
  const pending = snapshotOf(panel);
  if (!pending) { if (layer) { layer.remove(); layer = null; } return; }
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'quoteLayer';
    /* 与真实组件同一个记号（copy 图标 + 文字）。图标与文字同行的排布是这一行唯一要看的
       排版，少画一个图标就等于没验这一行；path 与 viewBox 照 design/ui.tsx 的 copy。 */
    layer.innerHTML = '<button type="button" class="quoteAction" id="qa">'
      + '<svg class="icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor"'
      + ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M7 4h5a2 2 0 0 1 2 2v5M5 6h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"></path>'
      + '</svg>'
      + '<span>引用文本</span>'
      + '</button>';
    board.appendChild(layer);
    layer.querySelector('#qa').addEventListener('pointerdown', event => event.preventDefault());
    layer.querySelector('#qa').addEventListener('click', () => {
      const caret = box.selectionStart;
      const result = insertQuote(box.value, caret, pending.quote);
      box.value = result.text;
      box.focus();
      box.setSelectionRange(result.caret, result.caret);
      window.__result = { text: result.text, caret: result.caret, quote: pending.quote };
      layer.remove(); layer = null;
      window.getSelection().removeAllRanges();
    });
  }
  const bounds = panel.getBoundingClientRect();
  const origin = board.getBoundingClientRect();
  const action = layer.querySelector('#qa').getBoundingClientRect();
  const spot = quoteAnchorOf(
    { top: pending.rect.top - origin.top, left: pending.rect.left - origin.left, width: pending.rect.width, height: pending.rect.height },
    { top: bounds.top - origin.top, left: bounds.left - origin.left, width: bounds.width, height: bounds.height },
    { width: action.width || 88, height: action.height || 28 },
  );
  layer.style.top = spot.top + 'px';
  layer.style.left = spot.left + 'px';
  window.__spot = spot;
  window.__bounds = { top: bounds.top - origin.top, left: bounds.left - origin.left, width: bounds.width, height: bounds.height };
});

window.__ready = true;
</script>
</body></html>`
}

/** 一个最小的 CDP 客户端：开浏览器、打开一页、跑几个调用。 */
async function withBrowser(fn) {
  const exe = browserPath()
  if (exe === undefined) {
    console.error('quote-live: 这台机器上没有找到 Chrome/Edge。装一个，或用 DSH_SHOT_BROWSER 指过去。')
    process.exit(2)
  }
  const profile = join(WORK, 'profile')
  const child = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--window-size=1280,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  const wsUrl = await new Promise((resolveUrl, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('浏览器 10 秒内没有报出调试端口')), 10_000)
    child.stderr.on('data', chunk => {
      buffer += chunk.toString()
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer)
      if (match) { clearTimeout(timer); resolveUrl(match[1]) }
    })
  })
  try {
    return await fn(wsUrl, child)
  } finally {
    /* **等进程真的退出**，不是发个信号就走。Chrome 还在往 profile 目录里写东西时删它，
       Windows 上直接 EPERM——而那一抛会把上面所有通过的读数一起吞掉，看起来像「探针
       失败了」。等退出再删，清理失败也只是清理失败。 */
    child.kill()
    await new Promise(ok => {
      if (child.exitCode !== null) { ok(); return }
      child.once('exit', ok)
      /* 一个不肯退的浏览器不该让整条探针挂住：5 秒后照样往下走。 */
      setTimeout(ok, 5000)
    })
  }
}

const html = await pageHtml()
const pageFile = join(WORK, 'page.html')
writeFileSync(pageFile, html, 'utf8')

await withBrowser(async wsUrl => {
  const { WebSocket } = await import('node:worker_threads').then(() => ({ WebSocket: globalThis.WebSocket }))
  if (WebSocket === undefined) {
    console.error('quote-live: 这个 Node 没有内置 WebSocket（需要 22+）。')
    process.exit(2)
  }
  const socket = new WebSocket(wsUrl)
  await new Promise((ok, no) => { socket.onopen = ok; socket.onerror = no })
  let nextId = 1
  const waiting = new Map()
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) waiting.get(message.id)?.(message)
  }
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
    const id = nextId++
    waiting.set(id, message => { waiting.delete(id); message.error ? no(new Error(`${method}: ${message.error.message}`)) : ok(message.result) })
    socket.send(JSON.stringify({ id, method, params, ...sessionId === undefined ? {} : { sessionId } }))
  })
  const targets = await send('Target.getTargets')
  const page = targets.targetInfos.find(info => info.type === 'page')
  const attached = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
  const sessionId = attached.sessionId
  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)
  await send('Page.navigate', { url: `file:///${pageFile.replace(/\\/g, '/')}` }, sessionId)
  await new Promise(ok => setTimeout(ok, 1200))

  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
    if (result.exceptionDetails !== undefined) throw new Error(`页面里抛了：${result.exceptionDetails.text} ${JSON.stringify(result.exceptionDetails.exception?.description ?? '')}`)
    return result.result.value
  }
  const waitReady = async () => {
    for (let i = 0; i < 60; i++) {
      if (await evaluate('window.__ready === true')) return
      await new Promise(ok => setTimeout(ok, 100))
    }
    throw new Error('页面没有就绪（__ready 一直是 false）')
  }
  await waitReady()

  /**
   * 在一个视口档里跑完整条手势，返回读数。
   *
   * **两档都要跑**（硬性规范 11：只在一种宽度上验证过的改动视为未完成）。桌面与窄屏
   * 的差别不是「小一点」：窄屏下面板只有几百像素宽，而按钮本身约 76px——「按钮夹进
   * 面板之内」这件事正是窄屏才会真的被逼到墙角。
   *
   * @param viewport - 这一档的宽高与是否触屏。
   * @param shotStem - 截图文件名的词干（两档各一套，互不覆盖）。
   */
  const runTier = async (viewport, shotStem) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.touch === true,
    }, sessionId)
    if (viewport.touch === true) {
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId)
    }
    await evaluate('window.__result = undefined')
    await send('Page.navigate', { url: `file:///${pageFile.replace(/\\/g, '/')}` }, sessionId)
    await new Promise(ok => setTimeout(ok, 800))
    await waitReady()

    const findings = []
    const check = (ok, message) => { findings.push({ ok, message }) }

    /* 1. 真选区真的有矩形。 */
    const rectProbe = await evaluate(`(() => {
      const text = document.getElementById('text');
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const r = range.getBoundingClientRect();
      const quote = quoteTextOf(selection.toString());
      return { width: r.width, height: r.height, quote };
    })()`)
    check(rectProbe.width > 0 && rectProbe.height > 0, `真选区给出非零矩形（${Math.round(rectProbe.width)}x${Math.round(rectProbe.height)}）`)
    check(typeof rectProbe.quote === 'string' && rectProbe.quote.startsWith('> '), `选中文字被编码成引用行：${JSON.stringify(rectProbe.quote)}`)

    /* 2. 按钮浮出来，且整个落在面板之内。 */
    await evaluate(`document.dispatchEvent(new Event('selectionchange'))`)
    await new Promise(ok => setTimeout(ok, 250))
    const floated = await evaluate(`(() => {
      const button = document.getElementById('qa');
      if (!button) return { exists: false };
      const b = button.getBoundingClientRect();
      const panel = document.getElementById('panel').getBoundingClientRect();
      return { exists: true, w: b.width, h: b.height,
        inside: b.left >= panel.left - 1 && b.right <= panel.right + 1 && b.top >= panel.top - 1 && b.bottom <= panel.bottom + 1 };
    })()`)
    check(floated.exists === true, '按钮在选中之后浮出来了')
    check(floated.w > 0 && floated.h > 0, `按钮量到真实尺寸（${Math.round(floated.w)}x${Math.round(floated.h)}）`)
    check(floated.inside === true, '按钮整个落在面板之内（没有被裁掉一半）')

    /* 3. 按钮**不许盖住正在被引用的那几个字**。
     *
     * 这是浮层最容易犯、也最难自查的错：它正确地浮出来了、也在面板之内，却正好压在读者刚
     * 选中、正准备引用的那行字上。屏上看起来像「选中高亮被一块白贴纸盖住了」，而所有
     * 「是否存在 / 是否在范围内」的判据都会通过。所以这里判的是**两个矩形不相交**。 */
    const overlap = await evaluate(`(() => {
      const button = document.getElementById('qa');
      if (!button) return { exists: false };
      const b = button.getBoundingClientRect();
      const text = document.getElementById('text');
      const range = document.createRange();
      range.selectNodeContents(text);
      const s = range.getBoundingClientRect();
      const intersects = !(b.right <= s.left || b.left >= s.right || b.bottom <= s.top || b.top >= s.bottom);
      return { exists: true, intersects, button: { top: Math.round(b.top), left: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) }, selection: { top: Math.round(s.top), left: Math.round(s.left), w: Math.round(s.width), h: Math.round(s.height) } };
    })()`)
    check(overlap.exists === true && overlap.intersects === false, `按钮没有盖住被引用的文字（按钮 ${JSON.stringify(overlap.button)} / 选区 ${JSON.stringify(overlap.selection)}）`)

    /* 4. 按钮浮出这一刻的截图。**在点击之前拍**——点击之后输入框已经有内容，那一张拍到的是
       结果，不是手势本身的样子。 */
    const floatedShot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    writeFileSync(join(WORK, `${shotStem}-action.png`), Buffer.from(floatedShot.data, 'base64'))

    /* 5. 按下之后引用进了输入框，按钮自己收起。 */
    const clicked = await evaluate(`(() => {
      const button = document.getElementById('qa');
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      button.click();
      return { result: window.__result, stillThere: document.getElementById('qa') !== null };
    })()`)
    check(clicked.result !== undefined && clicked.result !== null, '按下之后拿到了插入结果')
    check(clicked.result?.text?.startsWith('> '), `输入框里是一段引用：${JSON.stringify(clicked.result?.text)}`)
    check(clicked.result?.caret === clicked.result?.text?.length, '光标落在引用之后')
    check(clicked.stillThere === false, '按钮按下后自己收起')

    /* 6. 插入之后的截图。 */
    await new Promise(ok => setTimeout(ok, 200))
    const afterShot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    writeFileSync(join(WORK, `${shotStem}-after.png`), Buffer.from(afterShot.data, 'base64'))
    return findings
  }

  /* 两档：桌面（鼠标）与窄屏（触屏）。窄屏那档的宽度取真实手机宽度，并**真的打开触屏
     模拟**——只改宽度不会打开 `(pointer: coarse)` 那一层。 */
  const tiers = [
    { name: '桌面', viewport: { width: 1280, height: 900, touch: false }, stem: 'desktop' },
    { name: '窄屏触屏', viewport: { width: 390, height: 844, touch: true }, stem: 'narrow' },
  ]
  const all = []
  for (const tier of tiers) {
    const findings = await runTier(tier.viewport, tier.stem)
    console.log(`\n── ${tier.name}（${tier.viewport.width}x${tier.viewport.height}${tier.viewport.touch ? ' · 触屏' : ''}）`)
    for (const finding of findings) console.log(`${finding.ok ? 'OK  ' : 'FAIL'}  ${finding.message}`)
    all.push(...findings.map(finding => ({ ...finding, tier: tier.name })))
  }

  const failed = all.filter(finding => !finding.ok)
  if (failed.length > 0) {
    console.error(`\nquote-live: ${failed.length} 项没通过（${failed.map(finding => finding.tier).join(', ')}）`)
    process.exitCode = 1
  } else {
    console.log(`\nquote-live OK: 两档共 ${all.length} 项在真浏览器里通过`)
  }
  /* 截图去哪了：**默认不看**它，说清楚就行；要看就保留并打路径。
     留在仓库里是不行的（见 `WORK` 那段注释），所以默认删掉。 */
  if (KEEP) {
    console.log(`截图与页面在：${WORK}`)
  } else {
    /* 删不掉也只是「临时目录里多留了一点垃圾」——它是系统临时目录，不是仓库。不能让它
       把上面已经通过的读数变成一条崩溃。 */
    try {
      rmSync(WORK, { recursive: true, force: true })
      console.log('想留住截图看：QUOTE_LIVE_KEEP=1 node scripts/quote-live.mjs')
    } catch {
      console.log(`临时目录没删掉（不影响结论）：${WORK}`)
    }
  }
})
