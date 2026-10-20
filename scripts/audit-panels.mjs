// 两块面板的胶囊与滚动体审计：把 `shot-panel.mjs` 按一张矩阵跑一遍，然后判真假。
//
// usage:
//   node scripts/audit-panels.mjs                      # 先造后量：造一批被审页，量那一批
//   node scripts/audit-panels.mjs --dir <where the artifact pages live>
//   node scripts/audit-panels.mjs --pages a.html,b.html [--json <report path>]
//
// ── 为什么是这张矩阵 ─────────────────────────────────────────────────────────
//
//   1440@1   半像素取整最狠的那一档（设备像素最少，0.5px 无处可去）
//   1440@2   项目原本唯一的量法
//   1440@2   深色档（**主题不是宽度**，见下）
//   412@2    桌面档的窄端，与下面同一宽度的触屏档**配对**
//   412@2    触屏档（配对的一半）
//   390@3    真手机的视口与像素密度
//   390@3    触屏档（配对的一半）
//   390@3    触屏档 + 换一套字体度量（配对的另一半不适用：字变了，版面本来就变）
//
// **配对是这条审计的主力**：同一页、同一宽度、同一像素密度，只切指针能力——两档之间
// 冒出来的任何一条滚动轴，都是触屏那一段 CSS 改出来的几何，不是内容变多了。
//
// **深色那一档本来不在矩阵里，而这件事值得写下来。** 「深色下这些数还成立吗」从来没有被量过，
// 而深色不是「同一页换个颜色」：令牌层的深色块挂在 `body[data-ds-dark-theme]` 上（宿主打的
// 属性，**不是 `prefers-color-scheme`**），而宿主浅色把三档表面解成同一个白、深色才给出
// `#151517 → #353638` 的台阶。换句话说，**「这张卡浮在页面上」这件事在深色下才真的有颜色
// 可用**，浅色全靠影撑着。只加一对非触屏档：主题与指针能力正交，把两者相乘会让矩阵翻倍，而
// 它们的交叉不是这条审计要问的问题。
//
// **假主题比不测更坏**：`--color-scheme` 只设媒体查询，而一块只读 `:root` 的静态工件在深色下
// 与浅色逐像素相同——于是报告里会写「深色已审」，那是这一整套仪器最坏的一种谎。所以那一档
// 必须真的把属性打到 `body` 上（`probes/probe-dark-theme.js` 做这件事），截图才不是浅色的。
//
// **换字体的那一档是「我看不见你的手机」的解药**：竖向居中的每一个数都是「盒子与盒子里那团
// 墨」的距离，而墨的形状是字体的。报告缺陷的那台手机装的字体这台机器没有，所以只量一档就等于
// 只量一种字体。这一档把整页压到另一套字体度量上再量一遍，于是「随字体浮动的残差」与
// 「结构性错位」被分开：残差在报告里看得见，结构性错位在两档里都红。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
// 探针（`probes/probe-item-capsules.js`）自己带六条判据，这一层只做三件事：把矩阵跑完、把每一档的
// 读数打出来、把**它自己承认量不出来**的那些（`no-reading`/`blind`）当成红的。
//
// ── 第二条判据：框架空气（`probes/probe-item-frame.js`） ──────────────────────
//
// 胶囊那一套量的是「一件东西自己画得正不正」；**行卡到面板两沿的距离**是另一件事，而且
// 它是**容器宽度**的函数，不是视口的：主矩阵按视口宽度跑，于是它自己一档（`frame-ladder`），
// 探针把页面宽度从 1600 逐档扫到 390（阶梯与容差写在探针里）。判据是「行卡的左间隙等于右
// 间隙、且两个都在」——这条曾经是 0（面板 720–880 时贴住侧板），而按视口宽度的矩阵在任何
// 一档上都看不见它。量不到清单框架的页面由探针自己说 `not-here`，这一层**不按文件名猜**。
//
// ── 第三条判据：高度预算（`probes/probe-item-strip.js`） ──────────────────────
//
// 前两条问的是「行卡到两沿多远」；这一条问**这一块的高度怎么分**：导航带（那幅可以展开的
// 月历住在这里）最多拿走一半，剩下的永远是列表的；而装不下的东西一定滚得到。曾经横带用
// `flex-wrap` 收下展开的月历，于是十九枚芯片各落一行、带子长到 541px，一个 560px 高的
// 面板里列表只剩 **19px**、两条轴都不滚——读者按不开任何按钮。宽度决定档位、高度决定预算，
// 所以这一档的阶梯是 `(宽, 高)` 一对一对的，写在探针里。
//
// ── 工件从哪来 ───────────────────────────────────────────────────────────────
//
// **被审的是哪几页，由 `audit-pages.mjs` 一处定义**，本脚本只引用它。
//
// 裸跑（不给 `--pages`、不给 `--dir`）时它**先造后量**：造一批新的工件，量那同一批。
// 理由是这一条审计唯一量得到的东西是「现在这份代码画出来是什么样」，而一份放在
// `%TEMP%` 里的旧页量的是几小时前的实现——上一位同事就因此报过一条已经不存在的
// 缺陷（那条规则当天早上就修好了，而那张页是凌晨生成的）。
//
// **旧页的问题由生成器解决，不由过滤器掩盖**：这里换掉的是「量哪几页」的**来源**
// （现造现量），不是「把旧页藏起来」——`--pages` 与 `--dir` 仍然量你给的那几页，
// 而报告里每一页都打出**大小与修改时间**，所以「量了一张没重新生成的旧页」仍然看得见。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { AUDIT_PAGES, auditPageFiles, generateAuditPages } from './audit-pages.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SHOT_PANEL = join(HERE, 'shot-panel.mjs')
/** 框架空气那一支探针（见头注释的第二条判据）。 */
const FRAME_PROBE = join(HERE, 'probes', 'probe-item-frame.js')
/** 高度预算那一支探针（见头注释的第三条判据）。 */
const STRIP_PROBE = join(HERE, 'probes', 'probe-item-strip.js')

/**
 * 深色那一档的探针。
 *
 * 它与别的探针不是一类东西：别的量「这一页排得正不正」，这一支量「这一档是不是真的深色」。
 * 理由写在 BANDS 的注释里——`--color-scheme` 只设媒体查询，而令牌层的深色块挂在
 * `body[data-ds-dark-theme]` 上，所以一块只读 `:root` 的静态工件在深色下与浅色逐像素
 * 相同。假主题比不测更坏：报告会写「深色已审」。
 */
const DARK_PROBE = join(HERE, 'probes', 'probe-dark-theme.js')

/** 只用主题探针的那几档（它们不做胶囊审计，只回答「深色是不是真的」）。 */
const THEME_ONLY_BANDS = new Set(['w1440x2-dark'])

/** 一条矩阵带：窗口、像素密度、指针能力、（可选）换掉的字体栈。 */
const BANDS = [
  { id: 'w1440x1', width: 1440, height: 900, scale: 1, touch: false },
  { id: 'w1440x2', width: 1440, height: 900, scale: 2, touch: false },
  /* 深色那一档。**主题不是宽度**，也不是 `prefers-color-scheme`：令牌层的深色块挂在
     `body[data-ds-dark-theme]` 上（宿主打的属性），而宿主浅色把三档表面解成同一个白、
     深色才给出 #151517 -> #353638 的台阶。换句话说「这张卡浮在页面上」在深色下才真的
     有颜色可用，浅色全靠影撑着。这一档由 `probe-dark-theme.js` 量，走的是另一条路
     （它不量胶囊，只回答「深色是不是真的」）——见 THEME_ONLY_BANDS。 */
  { id: 'w1440x2-dark', width: 1440, height: 900, scale: 2, touch: false, theme: 'dark' },
  { id: 'w412x2', width: 412, height: 900, scale: 2, touch: false },
  { id: 'w412x2-touch', width: 412, height: 900, scale: 2, touch: true, pair: 'w412x2' },
  { id: 'w390x3', width: 390, height: 844, scale: 3, touch: false },
  { id: 'w390x3-touch', width: 390, height: 844, scale: 3, touch: true, pair: 'w390x3' },
  /* 故意选一枚**不在**项目字体栈里的 CJK 字体：另一套度量，才有另一套读数。
   *
   * **这一档是诊断档，不是判据档。** 它的用途写在头注释里：把「字体自身的残差」与「结构性
   * 错位」分开——同一页在两种字体度量下都红，才是结构问题。所以这一档的**墨心判据**先进 notes
   * （读数看得见），只有越过结构错位的量级（1.25px：本项目量到过的最小的结构缺陷是 1.18px）
   * 才判红。把 0.75px 那条结构容差套到另一种字体上，等于拿一把对 A 字体调好的尺子去判 B 字体
   * ——那条红量出来的是 SimSun 的字形位置，不是这一页的排版（硬性规范 14：先怀疑检查的读法）。 */
  { id: 'w390x3-touch-altfont', width: 390, height: 844, scale: 3, touch: true, font: '"SimSun", serif', diagnostic: true },
]

/** 这三条在诊断档里只报数、不判红。
 *
 *  **它们读的是版面**（行盒与记号盒子各自被放在哪儿），而诊断档换的是**整套字体度量**
 *  ——那一档的用处是分开两件事：版面的错位与字形的残差。版面那一份在每一档都判；
 *  字形那一份（`inkV=` / `inkVsMark=`）只报数，它落在诊断档里看得见。 */
const FONT_DEPENDENT = new Set(['capsulesCentredV', 'capsulesCentredH', 'textVsMarkAligned'])

/** 框架空气那一档：**不是**一条设备档，是一次容器宽度的阶梯（阶梯在探针里）。 */
const FRAME_BAND = { id: 'frame-ladder', width: 1600, height: 900, scale: 1, touch: false }

/** 探针的判据名 ↔ 它自己的 `offenders` 键。两处都说同一件事，所以写在一张表上。 */
const FRAME_CRITERIA = [
  ['airConstant', null],
  ['airSymmetric', 'symmetric'],
  ['airPresent', 'present'],
  ['linesAgree', 'lines'],
  ['railOnLine', 'rail'],
  ['scrollbarFits', 'scrollbar'],
  ['barGapsEven', 'barGaps'],
  ['loneActionFills', 'loneAction'],
]

/** 高度预算那一档：同样是**自己一条阶梯**（`(宽, 高)` 写在探针里）。 */
const STRIP_BAND = { id: 'rail-band', width: 1600, height: 900, scale: 1, touch: false }

const STRIP_CRITERIA = [
  ['listFloor', 'floor'],
  ['listUsable', 'usable'],
  ['stripReachable', 'reachable'],
  ['chipsOneRow', 'oneRow'],
]

function parseArgs(argv) {
  const out = { dir: '', pages: '', json: '', keep: false, only: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i].replace(/^--/, '')
    const key = Object.keys(out).find((name) => name === flag)
    if (key === undefined) {
      console.error(`audit-panels: unknown flag ${argv[i]}`)
      console.error('known flags: --dir --pages --json --keep --only')
      process.exit(2)
    }
    if (key === 'keep') { out.keep = true; continue }
    out[key] = argv[i + 1] ?? ''
    i += 1
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
/** **每一轮一个自己的目录。**
 *
 * 这个目录原来是**固定**的 `%TEMP%/tb-audit`，于是**同一台机器上并行的两轮审计互相踩**：
 * 一轮收尾时的清理把另一轮正在写的读数删掉，那一轮于是报 `NO READING`——
 * **一条与那一页毫无关系的假失败**（实测：`ENOENT … tb-audit/…audit.json`）。
 * 每一轮一个唯一目录，就踩不到别人。 */
const outDir = mkdtempSync(join(tmpdir(), 'tb-audit-'))

/** 这一轮造出来的那一批工件（裸跑时才有）：收尾时清掉。 */
let generated = null

/** 要量的那几页。 */
function pages() {
  if (args.pages !== '') {
    return args.pages.split(',').map((one) => resolve(one.trim())).filter((one) => existsSync(one))
  }
  if (args.dir !== '') {
    /* **给了目录就量那个目录里的被审页**——仍然是「被审的那几张」，不是目录里
     * 所有 `tb-*.html`：多出来的那几页不是这一轮要审的东西。 */
    return AUDIT_PAGES
      .flatMap((page) => auditPageFiles(args.dir, page.stem).map((name) => join(args.dir, name)))
      .sort()
  }
  /* **裸跑：先造后量，同一批。** 造出来的那一批就是这一轮量的那一批——不是
   * 「造一批新的、量目录里旧的」。 */
  generated = mkdtempSync(join(tmpdir(), 'tb-audit-pages-'))
  return generateAuditPages(generated)
}

const found = pages()
if (found.length === 0) {
  if (args.dir !== '') {
    console.error(`audit-panels: 被审的那几页不在 ${args.dir} 里。`)
    console.error('  它们是：' + AUDIT_PAGES.map((page) => page.stem).join(' / '))
  } else {
    console.error('audit-panels: no artifact pages found')
  }
  console.error('  造工件：node scripts/audit-render.mjs   （或者直接裸跑本脚本，它自己造）')
  process.exit(2)
}

/* ── 有没有浏览器 ────────────────────────────────────────────────────────────
 *
 * **缺一台浏览器是关于这台机器的事实，不是这次改动的失败。** 所以这里打印 SKIP 并
 * 退出 0——但它**绝不假装量过**：输出里明写「未测量」，于是「绿」与「没跑」在报告里
 * 长得不一样（硬性规范 15）。这与 `shot-panel.mjs` 的立场一致。 */
const probe = spawnSync(process.execPath, [
  SHOT_PANEL,
  '--out', join(outDir, 'probe.png'),
  '--url', pathToFileURL(found[0]).href,
  '--width', '400',
  '--wait', '200',
], { cwd: ROOT, encoding: 'utf8' })
const probeOut = `${probe.stdout ?? ''}${probe.stderr ?? ''}`
if ((probe.status ?? 1) !== 0 || /no browser|找不到|not found/i.test(probeOut)) {
  console.log('audit SKIP: 这台机器上找不到可驱动的 Chromium——**未测量**，不是通过。')
  console.log('  装上 Chromium（或设 DSH_SHOT_BROWSER=<路径>）之后重跑 `pnpm run audit`。')
  console.log('  静态门禁仍然守住了写法（`verify-capsule-centring` 等），但「墨心是否落在盒心」只有这里能量。')
  if (generated !== null) rmSync(generated, { recursive: true, force: true })
  rmSync(outDir, { recursive: true, force: true })
  process.exit(0)
}

/** 一个 band 的一页量一次；返回它的审计读数。 */
function measure(page, band, probe = '') {
  const stem = `${page.split(/[\\/]/).pop().replace(/\.html$/, '')}--${band.id}`
  const shot = join(outDir, `${stem}.png`)
  const cli = [
    SHOT_PANEL,
    '--out', shot,
    '--url', pathToFileURL(page).href,
    '--width', String(band.width),
    '--height', String(band.height),
    '--scale', String(band.scale),
    '--wait', '1200',
    '--audit',
    ...(probe === '' ? [] : ['--eval-file', probe]),
    ...(band.touch ? ['--touch'] : []),
    ...(band.font === undefined ? [] : ['--font', band.font]),
  ]
  const run = spawnSync(process.execPath, cli, { encoding: 'utf8' })
  const auditPath = `${shot.replace(/\.png$/, '')}.audit.json`
  if (!existsSync(auditPath)) {
    return { error: `no reading (exit ${run.status})`, stderr: (run.stderr ?? '').trim().split('\n').slice(-4).join(' | ') }
  }
  return JSON.parse(readFileSync(auditPath, 'utf8'))
}

const findings = []
/* 报出来、但不判红的那一类：一个被裁掉的轴上内容更长，条不出现、滚动也不变。 */
const notes = []
const report = { bands: BANDS.map((band) => band.id), pages: [], findings, notes }

for (const page of found) {
  const stamp = statSync(page)
  const entry = { page, bytes: stamp.size, mtime: stamp.mtime.toISOString(), runs: {} }
  report.pages.push(entry)
  console.log(`\n== ${page.split(/[\\/]/).pop()}  (${stamp.size} bytes, ${entry.mtime})`)

  for (const band of BANDS) {
    if (args.only !== '' && band.id !== args.only) continue
    /* 主题档不量胶囊，它量「这一档是不是真的深色」。两条判据问的不是同一件事，
       混在一个读数里会让「深色已审」与「胶囊排得正」互相冒充。 */
    if (THEME_ONLY_BANDS.has(band.id)) {
      const themed = measure(page, band, DARK_PROBE)
      entry.runs[band.id] = themed
      if (themed.error !== undefined) {
        console.log('   ' + band.id.padEnd(20) + ' NO READING  ' + themed.error + ' ' + (themed.stderr ?? ''))
        findings.push({ page, band: band.id, kind: 'no-reading', detail: themed.error })
        continue
      }
      if (themed.theme === undefined) {
        findings.push({ page, band: band.id, kind: 'no-reading', detail: '主题探针没有返回读数' })
        continue
      }
      const theme = themed.theme
      const ok = themed.ok
      console.log('   ' + band.id.padEnd(20) + ' theme=' + (theme.changed ? 'dark' : 'UNCHANGED')
        + ' canvas=' + theme.canvasAfter + ' papers=' + (themed.papers ?? []).length
        + ' D1=' + ok.d1ThemeChanged + ' D2=' + ok.d2CanvasIsDark + ' D3=' + ok.d3PaperSeparatedFromCanvas
        + ' D4=' + ok.d4PaperOpaque + ' D5=' + ok.d5EveryPaperRounded)
      /* 主题没变 = 这一档什么也没证明。它是整条审计最坏的一种谎：报告里会写
         「深色已审」，而截图与浅色逐像素相同。 */
      if (!ok.d1ThemeChanged) {
        findings.push({ page, band: band.id, kind: 'theme-not-applied', detail: 'canvas ' + theme.canvasBefore + ' -> ' + theme.canvasAfter })
      }
      if (!ok.d2CanvasIsDark) {
        findings.push({ page, band: band.id, kind: 'theme-not-dark', detail: 'canvas luminance ' + theme.canvasLuminance })
      }
      if (!ok.d3PaperSeparatedFromCanvas) {
        findings.push({ page, band: band.id, kind: 'paper-flush-with-canvas', detail: '纸面与画布同色：深色下台阶没了，读者看不到一张纸' })
      }
      if (!ok.d4PaperOpaque) {
        findings.push({ page, band: band.id, kind: 'paper-translucent', detail: '纸面半透明：深色下背景会透上来，而那上面是要读的字' })
      }
      if (!ok.d5EveryPaperRounded) {
        const flat = (themed.papers ?? []).filter(function (one) { return one.radius === '0px' || one.radius === '' })
        findings.push({ page, band: band.id, kind: 'paper-is-square', detail: '直角的纸：' + flat.map(function (one) { return one.cls }).join(' | ') })
      }
      continue
    }
    const reading = measure(page, band)
    entry.runs[band.id] = reading
    if (reading.error !== undefined) {
      console.log(`   ${band.id.padEnd(14)} NO READING  ${reading.error} ${reading.stderr ?? ''}`)
      findings.push({ page, band: band.id, kind: 'no-reading', detail: reading.error })
      continue
    }
    const { pass, counts, worst } = reading
    console.log(`   ${band.id.padEnd(20)} tier=${pass.tier.padEnd(7)} capsules=${counts.capsules} labels=${counts.labels} start=${counts.startAligned} slot=${counts.withTextSlot} ` +
      `worstV=${worst.offY} worstH=${worst.offX} vsMark=${worst.textVsMark} cut=${counts.cut} squeezed=${counts.squeezed} rings=${counts.rings}/${counts.clippedRings} scrollers=${counts.scrollers} ` +
      `V=${pass.capsulesCentredV} H=${pass.capsulesCentredH} mark=${pass.textVsMarkAligned} cutP=${pass.inkNotCut} squeezeP=${pass.capsulesNotSqueezed} ring=${pass.ringsInsideClip} self=${pass.selfTest} ` +
      `inkV=${worst.inkOffY} inkVsMark=${worst.inkVsMark}`)

    // A TIER THAT DID NOT TURN ON PROVES NOTHING. `--touch` exists because a
    // narrow width alone leaves `(pointer: coarse)` false; if the emulation ever
    // stops working, the run must say so instead of reporting a clean desktop
    // as a clean phone.
    const wanted = band.touch ? 'touch' : 'desktop'
    if (pass.tier !== wanted) {
      findings.push({ page, band: band.id, kind: 'tier-mismatch', detail: `asked ${wanted}, engine answered ${pass.tier}` })
    }
    /* **量具瞎了 = 整轮红。** 探针里那一步会先种一颗已知的坏胶囊再量；它报不出来，就说明这一轮
     * 的「绿」不是量出来的。这条判据的存在理由就是上一轮那次「全绿而屏幕是坏的」。 */
    if (pass.selfTest !== 'caught') {
      findings.push({ page, band: band.id, kind: 'probe-blind', detail: `the instrument did not catch its own planted defect: ${String(pass.selfTest)}` })
    }
    /* **记号簇那一支尺子也必须自证。** 它量的东西与胶囊那一支不同（两条竖线之间的距离，
     * 且「可见左沿」分墨与底两种取法），所以它自己种一颗已知的错位簇，报不出来就是
     * 「这一轮的绿不是量出来的」。 */
    if (pass.marksSelfTest !== undefined && pass.marksSelfTest !== 'caught') {
      findings.push({ page, band: band.id, kind: 'probe-blind', detail: `the marks-alignment instrument did not catch its own planted defect: ${String(pass.marksSelfTest)}` })
    }
    for (const [name, verdict] of [
      ['capsulesCentredV', pass.capsulesCentredV],
      ['capsulesCentredH', pass.capsulesCentredH],
      ['textVsMarkAligned', pass.textVsMarkAligned],
      ['inkNotCut', pass.inkNotCut],
      ['capsulesNotSqueezed', pass.capsulesNotSqueezed],
      ['ringsInsideClip', pass.ringsInsideClip],
      ['marksLinesAligned', pass.marksLinesAligned],
    ]) {
      if (verdict !== 'fail') continue
      /* **每一条判据只带自己那一段证据。** 把整个 `offenders` 塞进去，读者看到的第一段
         永远是别人的（量过：环形那一条报出来的是胶囊的表），于是真正红的那个找不着。 */
      const detail = {
        capsulesCentredV: () => JSON.stringify(reading.offenders.offY),
        capsulesCentredH: () => JSON.stringify(reading.offenders.offX),
        textVsMarkAligned: () => JSON.stringify(reading.capsules.filter((c) => c.textVsMark !== null && Math.abs(c.textVsMark) > 0.5).map((c) => ({ key: c.key, textVsMark: c.textVsMark }))),
        inkNotCut: () => JSON.stringify(reading.offenders.cut),
        capsulesNotSqueezed: () => JSON.stringify(reading.offenders.squeezed),
        ringsInsideClip: () => JSON.stringify(reading.offenders.rings),
        marksLinesAligned: () => JSON.stringify(reading.offenders.marks),
      }[name]()
      /* **诊断档只报数，不判墨心。** 那一档的用途是**分开**两件事：同一页在项目自己的字体栈
         下绿、在另一套度量下出现零点几到一像素的偏移，那偏移是字形的而不是排版的。所以这一档
         里「墨心 / 字与记号」那三条一律进 notes（读数照打），判红留给**其它档**——同一处结构
         错位在别的档里一样红，那才是「换成什么字体都错」的意思（头注释里写着这条判据）。
         结构性的三条（字被切、胶囊被压扁、热区环越界）在诊断档里照判：它们与字体无关。 */
      if (band.diagnostic === true && FONT_DEPENDENT.has(name)) {
        notes.push({ page, band: band.id, kind: 'font-residual', detail: `${name} under ${band.font}: ${detail.slice(0, 300)}` })
        continue
      }
      findings.push({ page, band: band.id, kind: name, detail: detail.slice(0, 500) })
    }
    /* **没有记号的胶囊只报数、不判红。** 记号（`data-dsh-tb-pilltext`）现在是**纯标记**：
     * 它不参与排版，所以「谁没有它」不是几何缺陷——它是审计自己的词表清单。 */
    if (counts.missingSlot !== undefined && counts.missingSlot.length > 0) {
      notes.push({ page, band: band.id, kind: 'no-marker', detail: `${counts.missingSlot.length} kind(s) without the text marker: ${counts.missingSlot.slice(0, 10).join(', ')}` })
    }
  }

  /* ── 框架空气：行卡到两沿的距离，在容器宽度的整条阶梯上 ──────────────────────
   *
   * 这一档量的是**面板自己的宽度**（探针把页面宽度逐档设过去），所以它不可能由上面那些
   * 设备档代替：0 间隙那一段落在 720–880 的面板宽度上，而任何一个视口档都可能落在别处。
   * 「这页没有清单框架」由探针说（`not-here`），这里不按文件名猜。 */
  if (args.only === '' || args.only === FRAME_BAND.id) {
    const frame = measure(page, FRAME_BAND, FRAME_PROBE)
    entry.frame = frame
    if (frame.error !== undefined) {
      console.log(`   ${FRAME_BAND.id.padEnd(14)} NO READING  ${frame.error} ${frame.stderr ?? ''}`)
      findings.push({ page, band: FRAME_BAND.id, kind: 'no-reading', detail: frame.error })
    } else if (frame.pass?.listFrame === 'not-here') {
      console.log(`   ${FRAME_BAND.id.padEnd(14)} not a list panel — skipped`)
    } else {
      const ladder = (frame.ladder ?? []).map((one) => (one.missing === true ? `${one.width}:?` : `${one.width}:${one.left}/${one.right}`)).join(' ')
      console.log(`   ${FRAME_BAND.id.padEnd(14)} air=${frame.counts.air} cardL/cardR by width -> ${ladder}`)
      console.log(`   ${''.padEnd(14)} constant=${frame.pass.airConstant} symmetric=${frame.pass.airSymmetric} present=${frame.pass.airPresent} ` +
        `lines=${frame.pass.linesAgree} rail=${frame.pass.railOnLine} scrollbar=${frame.pass.scrollbarFits} gaps=${frame.pass.barGapsEven} action=${frame.pass.loneActionFills} self=${frame.pass.selfTest}`)
      /* 量具瞎了 = 整轮红：种下去的那颗不对称没被报出来，「绿」就不是量出来的。 */
      if (frame.pass.selfTest !== 'caught') {
        findings.push({ page, band: FRAME_BAND.id, kind: 'probe-blind', detail: `the frame probe did not catch its own planted asymmetry: ${String(frame.pass.selfTest)}` })
      }
      for (const [name, offenders] of FRAME_CRITERIA) {
        if (frame.pass[name] !== 'fail') continue
        const detail = offenders === null ? frame.counts.air : JSON.stringify((frame.offenders ?? {})[offenders] ?? [])
        findings.push({ page, band: FRAME_BAND.id, kind: name, detail: detail.slice(0, 500) })
      }
    }
  }

  /* ── 高度预算：导航带与列表怎么分这一块的高度 ───────────────────────────────
   *
   * 与框架那一档同一条理由，只是另一条轴：**宽度决定档位，高度决定预算**，所以这一档的
   * 阶梯是 `(宽, 高)` 一对一对的，写在探针里。它管的是「带子长到把列表挤没、而两条轴
   * 都不滚」那一类缺陷——读者报的正是它。 */
  if (args.only === '' || args.only === STRIP_BAND.id) {
    const strip = measure(page, STRIP_BAND, STRIP_PROBE)
    entry.strip = strip
    if (strip.error !== undefined) {
      console.log(`   ${STRIP_BAND.id.padEnd(14)} NO READING  ${strip.error} ${strip.stderr ?? ''}`)
      findings.push({ page, band: STRIP_BAND.id, kind: 'no-reading', detail: strip.error })
    } else if (strip.pass?.listFrame === 'not-here') {
      console.log(`   ${STRIP_BAND.id.padEnd(14)} not a list panel — skipped`)
    } else {
      console.log(`   ${STRIP_BAND.id.padEnd(14)} ${(strip.ladder ?? []).join(' | ')}`)
      console.log(`   ${''.padEnd(14)} floor=${strip.pass.listFloor} usable=${strip.pass.listUsable} ` +
        `reachable=${strip.pass.stripReachable} oneRow=${strip.pass.chipsOneRow} self=${strip.pass.selfTest}`)
      if (strip.pass.selfTest !== 'caught') {
        findings.push({ page, band: STRIP_BAND.id, kind: 'probe-blind', detail: `the rail-band probe did not catch its own planted clip: ${String(strip.pass.selfTest)}` })
      }
      for (const [name, offenders] of STRIP_CRITERIA) {
        if (strip.pass[name] !== 'fail') continue
        findings.push({ page, band: STRIP_BAND.id, kind: name, detail: JSON.stringify((strip.offenders ?? {})[offenders] ?? []).slice(0, 500) })
      }
    }
  }
}

/* ── 配对：触屏档不许有桌面档没有的滚动轴 ─────────────────────────────────────
 *
 * 同一页、同一宽度、同一像素密度，只切指针能力。所以两档之间**任何**滚动轴的使用值或
 * 溢出量发生变化，都只可能来自 `@media (hover: none) and (pointer: coarse)` 那一段。
 * 溢出量变大 = 多出来的滚动距离；从 0 变成有 = 凭空多一条滚动轴（读者看到的就是一根条）。 */
for (const entry of report.pages) {
  for (const band of BANDS) {
    if (band.pair === undefined) continue
    const touch = entry.runs[band.id]
    const desk = entry.runs[band.pair]
    if (touch?.error !== undefined || desk?.error !== undefined || touch === undefined || desk === undefined) continue
    const before = new Map(desk.scrollers.map((one) => [one.at, one]))
    for (const after of touch.scrollers) {
      const before_ = before.get(after.at)
      if (before_ === undefined) {
        findings.push({ page: entry.page, band: band.id, kind: 'touch-only-scroller', detail: `${after.key} (${after.overflow}) client ${after.client}` })
        continue
      }
      /* **判红的是「多出一条用户真的能滚的轴」，不是「滚动量变了」。** 一个 `hidden`/`clip` 的
         轴上也能量到内容更长（`scrollHeight` 与 overflow 无关），但那里既不出现条也不发生滚动
         ——量到的那个数只是内容的本体。把那种情况判红，门禁就会被自己的几何噪声淹掉。
         所以：先看这条轴在两档里是不是 `auto`/`scroll`，再看这一轴上的数有没有变。 */
      const [ox, oy] = after.overflow.split('/')
      const scrollX = ox === 'auto' || ox === 'scroll'
      const scrollY = oy === 'auto' || oy === 'scroll'
      const axisDelta = (scrollX && before_.dw !== after.dw) || (scrollY && before_.dh !== after.dh)
      if (before_.overflow !== after.overflow || axisDelta) {
        findings.push({
          page: entry.page,
          band: band.id,
          kind: 'touch-scroll-delta',
          detail: `${after.key}: overflow ${before_.overflow}->${after.overflow}, dh ${before_.dh}->${after.dh}, dw ${before_.dw}->${after.dw}`,
        })
      } else if (before_.dh !== after.dh || before_.dw !== after.dw) {
        notes.push({ page: entry.page, band: band.id, kind: 'clipped-extent', detail: `${after.key} (${after.overflow}): dh ${before_.dh}->${after.dh}, dw ${before_.dw}->${after.dw}` })
      }
    }
  }
}

if (args.json !== '') {
  const target = resolve(args.json)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`\naudit-panels: report -> ${target}`)
}

if (!args.keep) rmSync(outDir, { recursive: true, force: true })
else console.log(`audit-panels: shots kept in ${outDir}`)
/* 这一轮自己造的那批工件也一并清掉（`--keep` 时留着：那一批是这一轮量的对象，
   留着才能对着它复看）。 */
if (generated !== null) {
  if (args.keep) console.log(`audit-panels: pages kept in ${generated}`)
  else rmSync(generated, { recursive: true, force: true })
}

console.log(`\naudit-panels: ${found.length} page(s), ${findings.length} finding(s), ${notes.length} note(s)`)
for (const one of notes.slice(0, 12)) {
  console.log(`  note [${one.kind}] ${one.page.split(/[\\/]/).pop()} ${one.band}\n      ${one.detail}`)
}
if (notes.length > 12) console.log(`  ... and ${notes.length - 12} more note(s)`)
for (const one of findings.slice(0, 40)) {
  console.log(`  [${one.kind}] ${one.page.split(/[\\/]/).pop()} ${one.band}\n      ${one.detail}`)
}
if (findings.length > 40) console.log(`  ... and ${findings.length - 40} more`)
process.exit(findings.length === 0 ? 0 : 1)
