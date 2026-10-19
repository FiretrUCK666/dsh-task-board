#!/usr/bin/env node
/**
 * 给每一个胶囊补上墨位校正，**并且把这件事变成一条可检查的通则**。
 *
 * ── 为什么需要这个脚本 ──────────────────────────────────────────────────────
 *
 * 校正本身很简单：一对对称内衬，源自运行时量出的 `--dsh-tb-optical-drop`。
 * 麻烦的是**它要落在每一个胶囊上，而且真的生效**——「每一个」是个移动目标（新写一个
 * 按钮、新加一个芯片都该自动带上），「真的生效」是个更隐蔽的目标。两件事都出过错：
 *
 *   清单页 29 处都加了，看板页 0 处   → 同一个界面两页表现不同
 *   规则里写了，后面一条 `padding` 简写又把它整条盖掉 → 同一页里有的对、有的错
 *
 * 两种失效都不会报错：样式表合法、类名都在、测试全过，屏幕上就是偏了。所以这个脚本
 * 判两件事，缺一件都算没过：
 *
 *   1. **覆盖**：每一个胶囊都要带校正；
 *   2. **有效**：校正必须是这条规则里**最后一条**管块向内衬的声明。CSS 里同族属性
 *      后声明的赢，所以后面再来一条 `padding: 0 4px 0 6px`，前面那对 `padding-block`
 *      就整条作废——文件里看得见它，浏览器里一次都没跑。
 *
 * ── 判据是结构，不是名单 ────────────────────────────────────────────────────
 *
 * 「胶囊」= 一条规则把圆角**解析成**胶囊那一档。这里不认字面量：先把全项目的自定义
 * 属性建成一张图，把 `var()` 链解析到底再判。
 *
 * 这一条也是踩出来的：旧版只匹配字面量 `border-radius: var(--dsh-tb-pill)`，于是
 * `border-radius: var(--item-radius-pill)` 那 16 条**一条都没进网**——它有 10 条
 * 从来没被补过校正，而门禁是绿的。同一个圆角、两个名字，检查只认其中一个。
 *
 * 用法：
 *   node scripts/align-capsules.mjs .           # 检查（verify 用这一档）
 *   node scripts/align-capsules.mjs . --fix     # 补齐 / 排到最后
 *   node scripts/align-capsules.mjs . --probe   # 自测：种一个缺校正的胶囊，必须报红
 *   node scripts/align-capsules.mjs . --probe-clobbered  # 自测：种一个被简写盖掉的，必须报红
 *   node scripts/align-capsules.mjs . --probe-ordered    # 自测：种一个写对了的，必须放行
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 补上去的那一对声明：两侧都写，令牌的符号决定用哪一侧。 */
const CORRECTION = 'padding-block: max(0px, calc(-1 * var(--dsh-tb-optical-drop))) max(0px, var(--dsh-tb-optical-drop));'

/**
 * 插进去的注释，一句话。
 *
 * 同一个说明在几十处重复一遍就是噪声，所以只留**这一行**：它说清「为什么不加会偏」，
 * 完整算术在 `base.module.css` 的墨位那一节与 `DESIGN.md`——**一份成文，多处指路**。
 */
const NOTE = '/* 墨位校正：胶囊里的字要比盒心高半档（见 base.module.css 的墨位一节）。 */'

/** 管块向内衬的四条属性：它们互相覆盖，最后一条赢。 */
const BLOCK_PADDING = /(^|[;{\s])(padding|padding-block|padding-block-start|padding-block-end|padding-top|padding-bottom)\s*:/g

/** 客户端样式表。 */
function sheets(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'lib' || name === 'dist' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.css')) out.push(full)
    }
  }
  walk(join(root, 'src/client'))
  return out
}

/** 抹掉注释（保长度），否则注释里出现的词会被当成一次使用。 */
function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
}

/** 把一张表拆成规则（保留字节位置，方便原地改）。 */
function rulesOf(css) {
  const rules = []
  let i = 0
  while (true) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const selector = css.slice(i, open).trim()
    let depth = 1
    let j = open + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    rules.push({ selector, bodyStart: open + 1, bodyEnd: j - 1, body: css.slice(open + 1, j - 1) })
    i = j
  }
  return rules
}

/**
 * 全项目的自定义属性图：名字 → 值（第一条声明为准）。
 *
 * 只需要「能不能解析到胶囊档」这一个答案，所以同名只留一份即可——本项目的令牌都是
 * 在 `:root` / 座位选择器上各声明一次，值一致。真正需要区分作用域的那一天，这里得
 * 改成按出处的图，而不是靠取巧。
 */
function customProperties(root) {
  const map = new Map()
  const typed = new Set()
  for (const file of sheets(root)) {
    const css = blankComments(readFileSync(file, 'utf8'))
    for (const match of css.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;}]+)/g)) {
      if (!map.has(match[1])) map.set(match[1], match[2].trim())
    }
    /* 顺便收一张「哪些类名与排版声明同处一条规则」的表：`.chip` 与 `.chipFill` 是同一个
       元素的两个类，前者给字号、后者给皮与校正——那一次计算是对的，不该报出来。 */
    for (const rule of rulesOf(css)) {
      if (!/(^|[;{\s])(font-size|font-weight|line-height|font-family)\s*:/.test(rule.body)) continue
      for (const one of rule.selector.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) typed.add(one[1])
    }
  }
  map.set(TYPED_CLASSES, typed)
  return map
}

/** 那张「类名 → 与排版声明同处一条规则」的表在令牌图里的键（不是 CSS 变量）。 */
const TYPED_CLASSES = Symbol.for('dsh-task-board/typed-classes')

/** 沿 `var()` 链解析到底；解析不动就原样返回。 */
function resolveValue(value, properties, depth = 0) {
  const trimmed = value.trim()
  if (depth > 8) return trimmed
  const single = /^var\((--[A-Za-z0-9-]+)\)$/.exec(trimmed)
  if (single !== null && properties.has(single[1])) {
    return resolveValue(properties.get(single[1]), properties, depth + 1)
  }
  return trimmed
}

/**
 * 一条规则的圆角是不是胶囊那一档。
 *
 * 「胶囊」在这个项目里有一个定义处：`--dsh-tb-pill`。别名（`--dsh-tb-button-radius`、
 * `--item-radius-pill`）都指回它。所以判据是**解析之后与那枚令牌相等**，不是匹配某个
 * 写法——同一个圆角有三个名字，只认其中一个，另外两条就永远不在网里（这条正是踩出来的：
 * 旧版只认字面量 `var(--dsh-tb-pill)`，`--item-radius-pill` 那 16 条里 10 条从没被补过）。
 *
 * 为什么不按数值门槛判（「圆角 ≥ 20px 就算胶囊」）：那样 `--dsh-tb-radius-lg`（20px）
 * 与 `--dsh-tb-radius-xl`（28px）的卡片、抽屉全会落进来，而它们装的是段落不是一行字，
 * 给它们加块向内衬是会真的改变版面的。判「与 pill 同一个值」既收得住，又不写死 999。
 */
function isCapsule(body, properties) {
  const declared = /border-radius\s*:\s*([^;}]+)/.exec(body)
  if (declared === null) return false
  const pill = properties.get('--dsh-tb-pill')
  if (pill === undefined) return false
  const pillValue = resolveValue(pill, properties)
  /* 只看 `/` 之前的水平半径：`a / b` 那种椭圆写法在本项目里不存在，出现了也不该
     被当成胶囊。四个角只要有一个是胶囊圆角就够了（`border-radius: 999px 0 0 0`
     头是圆的，仍然是一个胶囊）。 */
  const horizontal = declared[1].split('/')[0].trim()
  return horizontal
    .split(/\s+/)
    .some((part) => resolveValue(part, properties) === pillValue)
}

/**
 * 这条规则自己会不会画出一行字。
 *
 * 墨位校正移动的是「字的墨」，所以只有当这条规则真的画出字的时候它才有意义。没有这一
 * 条的后果量得到：`.itemStepBar`（4px 高的进度槽）、`.itemProseGrip > span`（3px 的
 * 抓握条）这些圆形的纯色块都被判成胶囊，再被塞进一对上下内衬——在 `box-sizing:
 * border-box` 与固定 `block-size` 之下像素没错，但那对声明在描述一件这个盒子里根本
 * 不存在的事，下一个人只能靠猜它为什么在那儿。
 *
 * **判据不能是「声明了 font-size」。** 试过那一版，它漏掉了 `.cruisePill`：那条规则
 * 一个字号都没写（字号从父级继承）。两个结构信号缺一不可：
 *
 *   1. **自己声明了排版**（字号、字重、行高、字族任一）。本项目的胶囊绝大多数如此。
 *   2. **自己是一个控件**（`button` / `a` / `label` / `input` / `select` / `textarea`
 *      选择器，或 `[role=button]`）。控件的字就在自己身上，而它们常常不重复声明字号
 *      ——字号是全站给按钮的，而门禁读的是**这一条规则**，只能看到本地的。
 *
 * 两个信号都不是类名名单，所以新写一个按钮、新加一枚芯片都会自动落进来。
 *
 * **有一类东西两个信号都不满足，而且它们确实不需要校正：外壳。** `.cruisePill` 是
 * 一枚装着 `<Switch>` 的 `div`——真正装字的是那个组件里的 `.switchLabel`，它自己有
 * 字号、自己居中。给外壳加内衬只会把整个组件推偏，组件里那一行字纹丝不动。
 * 「自己是不是控件」正好把外壳挡在外面，这不是特例，是它本来的含义。
 */
function hasText(selector, body) {
  if (/(^|[;{\s])(font-size|font-weight|line-height|font-family)\s*:/.test(body)) return true
  return /(^|[\s,>])(button|a|label|input|select|textarea)(\.|\[|:|\s|,|$)/i.test(selector)
    || /\[role=['"]button['"]\]/.test(selector)
}

/** 一枚定高控件：块向尺寸不由内容决定。 */
function isFixedHeight(body) {
  return /(^|[;{\s])(block-size|height|min-block-size)\s*:\s*(?!auto)[^;}]+;/.test(body)
}

/**
 * 这条规则是不是**认领了校正**。
 *
 * 这是本脚本的判据分岔口，也是它唯一一次读「作者自己的意图」：一条规则写了校正，
 * 就是作者在说「这一枚装着一行需要校正的字」。于是**不需要门禁去猜它装的是不是字**：
 * 装了，就必须赢；没写，就交给渲染探针去问「这一枚到底该不该有」。
 *
 * 为什么必须这样分：静态分析**读不到 DOM**，所以「这个盒子有没有文本子节点」它答不了。
 * 早先试过用「声明了字号 / 是 button 选择器」去近似，结果 `.cardBadge` 漏网（它复用
 * `Chip` 的形状、字号在父级那一族），而 `.mixedRowDot`、`.pipeTrack` 这些纯色记号被
 * 误报——检查器逼着人改对的东西（硬性规范 14）。分岔之后两个方向都干净了。
 */
function claimsCorrection(body) {
  return /var\(--dsh-tb-optical-drop\)/.test(body)
}

/** 一条规则里管块向内衬的声明，按出现顺序。 */
function blockPaddingDeclarations(body) {
  return [...body.matchAll(BLOCK_PADDING)].map((match) => ({
    property: match[2],
    value: body.slice(match.index + match[0].length).split(/[;}]/)[0].trim(),
    at: match.index,
  }))
}

/**
 * 校正是否**真的生效**：管块向内衬的最后一条声明必须带令牌。
 *
 * 这是这个脚本里唯一一条能看见「文件里有、浏览器里没有」的判据。写成「体里出现
 * 过令牌」是不够的——那正是前两次失效的样子。
 *
 * 三种结论，因为补救动作不同：
 *   - `ok`        最后一条就是校正；
 *   - `clobbered` 有校正，但被后面一条声明盖掉了 → 把它挪到最后（原样搬）；
 *   - `missing`   根本没有校正 → 在末尾补一条（同族后者胜，所以它能赢）。
 */
function effectiveCorrection(body) {
  const declarations = blockPaddingDeclarations(body)
  const carries = declarations.some((one) => /var\(--dsh-tb-optical-drop\)/.test(one.value))
  if (!carries) return { ok: false, reason: 'missing' }
  const last = declarations[declarations.length - 1]
  if (!/var\(--dsh-tb-optical-drop\)/.test(last.value)) {
    return { ok: false, reason: 'clobbered', by: `${last.property}: ${last.value.replace(/\s+/g, ' ')}` }
  }
  return { ok: true }
}

/** 扫描：返回每个有问题的胶囊。 */
export function audit(root) {
  const properties = customProperties(root)
  const findings = []
  for (const file of sheets(root)) {
    const raw = readFileSync(file, 'utf8')
    const css = blankComments(raw)
    for (const rule of rulesOf(css)) {
      /* at-rule 的前导（`@container (…)`）不是一条规则，它体里装的是别的规则。 */
      if (rule.selector.startsWith('@')) continue
      /* **只看认领了校正的规则。** 没认领的不归这个脚本判：它装不装字是 DOM 的事实，
         静态分析读不到，硬猜只会误报或漏报（两种都发生过，见 `claimsCorrection`）。 */
      if (!claimsCorrection(rule.body)) continue
      if (!isCapsule(rule.body, properties)) continue
      const verdict = effectiveCorrection(rule.body)
      if (verdict.ok) continue
      findings.push({
        file,
        selector: rule.selector,
        bodyStart: rule.bodyStart,
        reason: verdict.reason,
        by: verdict.by,
      })
    }
  }
  return findings
}

/**
 * 补齐：让每一枚胶囊的校正排在**规则体最后**。
 *
 * 动作只有两个，都只碰与这件事有关的那几行：
 *
 *   1. **已经有校正、但被后面的简写盖掉了**：把那两行（声明 + 它的注释）
 *      **挪到规则体最后**。原样搬，一个字节都不改写——那条简写是谁写的、
 *      写的什么值，都轮不到这个脚本替他决定。
 *   2. **完全没有校正**：追加两行。若这条规则同时写着 `padding` 简写，那个简写
 *      会盖掉刚追加的行，所以要报出来让人处理——**不替作者拆简写**：拆开会把
 *      一行声明变成四行，还会丢掉注释与排版，而那不是这个脚本该做的事。
 *
 * 从后往前改，前面规则的字节位置就不会被后面的改动挤动。
 */
export function fix(root) {
  const findings = audit(root)
  const byFile = new Map()
  for (const finding of findings) {
    if (!byFile.has(finding.file)) byFile.set(finding.file, [])
    byFile.get(finding.file).push(finding)
  }
  let touched = 0
  const refused = []
  for (const [file, list] of byFile) {
    let raw = readFileSync(file, 'utf8')
    list.sort((a, b) => b.bodyStart - a.bodyStart)
    for (const item of list) {
      const rule = rulesOf(blankComments(raw)).find((one) => one.bodyStart === item.bodyStart)
      if (rule === undefined) continue
      let body = raw.slice(rule.bodyStart, rule.bodyEnd)
      const indent = indentOf(body)

      if (item.reason === 'clobbered') {
        /* 找出校正那一行（含它上面那行注释），整行搬走。
           **保留它原来的缩进**——早期那几处是机械插入的、顶格写的，原样搬过去
           就等于把那种痕迹散播到文件里；这里按这条规则的惯用缩进重写前导空白，
           声明与注释的内容一个字都不动。 */
        const lines = body.split('\n')
        const at = lines.findIndex((line) => /var\(--dsh-tb-optical-drop\)/.test(line))
        if (at < 0) continue
        const from = lines[at - 1]?.trim() === NOTE ? at - 1 : at
        const moved = lines.splice(from, at - from + 1).map((line) => (
          /var\(--dsh-tb-optical-drop\)/.test(line) || line.trim() === NOTE
            ? indent + line.trim()
            : line
        ))
        body = lines.join('\n')
        while (body.endsWith('\n\n')) body = body.slice(0, -1)
        if (!body.endsWith('\n')) body += '\n'
        body += moved.join('\n') + (moved[moved.length - 1].endsWith('\n') ? '' : '\n')
        if (!body.endsWith('\n')) body += '\n'
      } else {
        /* 缺校正。有两种情况，处理方式不同：
           - **这条规则没有管块向内衬的声明**：直接追加两行，它天然就是最后一条；
           - **有一条 `padding` 简写**：追加到末尾就赢了（同族属性后者胜），所以也追加。
             唯一不能追加的是「已经有一条块向内衬、又不是校正」——但那属于 clobbered
             分支之外的情形，追加会静默失效，于是报出来让人看。 */
        const declarations = blockPaddingDeclarations(body)
        const last = declarations[declarations.length - 1]
        const wins = last === undefined || last.property === 'padding'
        if (!wins) {
          refused.push(`${relative(root, file).replace(/\\/g, '/')}  ${rule.selector.replace(/\s+/g, ' ').slice(0, 60)}`)
          continue
        }
        if (!body.endsWith('\n')) body += '\n'
        body += `${indent}${NOTE}\n${indent}${CORRECTION}\n`
      }
      raw = raw.slice(0, rule.bodyStart) + body + raw.slice(rule.bodyEnd)
      touched += 1
    }
    writeFileSync(file, raw)
  }
  return { touched, refused }
}

/**
 * 规则体里声明行惯用的缩进。
 *
 * 从**这一条规则自己的声明**里取，不从文件或选择器去猜：本仓库两种缩进都真实存在
 * （页面表两格、`design/` 里的表两格，个别规则整体缩进四格），而一条规则内部的缩进
 * 是自洽的。取出现次数最多的那个前导空白——新插的两行于是与邻居对齐。
 *
 * **顶格的行不参与投票。** 一条规则的声明顶格写，只会是「某次机械插入漏了缩进」的
 * 痕迹，不是这一条的风格；让它投票会把下一行也插成顶格，于是痕迹越留越多。
 */
function indentOf(body) {
  const counts = new Map()
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue
    const lead = /^[ \t]*/.exec(line)[0]
    if (lead === '') continue
    counts.set(lead, (counts.get(lead) ?? 0) + 1)
  }
  let best = '  '
  let bestCount = -1
  for (const [lead, count] of counts) {
    if (count > bestCount) { best = lead; bestCount = count }
  }
  return best
}

function report(findings, root) {
  console.error(`FAIL ${findings.length} 个胶囊的墨位校正没有生效——它里面的字会偏，而屏幕上只有它一个偏：`)
  for (const f of findings) {
    const where = `${relative(root, f.file).replace(/\\/g, '/')}  ${f.selector.replace(/\s+/g, ' ').slice(0, 70)}`
    console.error(`  ${where}`)
    if (f.reason === 'silent') {
      console.error('      写了校正，却读不到自己的字号：这一枚的内衬是按继承来的字号算的')
      console.error('      改法：这条规则自己声明 font-size（它装着的那一段字的那一档）')
    } else if (f.reason === 'missing') {
      console.error('      缺校正')
    } else {
      console.error(`      被后面这条声明整条盖掉：${f.by}`)
    }
  }
  if (findings.some((f) => f.reason !== 'silent')) {
    console.error('  改法：跑 node scripts/align-capsules.mjs . --fix（它会把校正排到规则最后）')
  }
}

function main() {
  const root = process.argv[2] ?? '.'
  const doFix = process.argv.includes('--fix')
  const probes = {
    '--probe': 'tests/fixtures/capsule-align',
    '--probe-clobbered': 'tests/fixtures/capsule-clobbered',
    '--probe-ordered': 'tests/fixtures/capsule-ordered',
  }
  const probeFlag = Object.keys(probes).find((flag) => process.argv.includes(flag))

  if (probeFlag !== undefined) {
    /* 自测种在 tests/ 里，不碰真实样式表（硬性规范 16）。 */
    const findings = audit(join(root, probes[probeFlag]))
    if (probeFlag === '--probe-ordered') {
      if (findings.length !== 0) {
        console.error('FAIL 自测：一条把校正写在最后的胶囊必须放行，却报了：')
        for (const f of findings) console.error(`  ${f.selector}  (${f.reason}${f.by === undefined ? '' : `: ${f.by}`})`)
        process.exit(1)
      }
      console.log('OK 自测：写对了的胶囊放行（不误伤正确写法）。')
      return
    }
    if (findings.length === 0) {
      console.error(`FAIL 自测：${probes[probeFlag]} 里必须报出问题，但一条都没有。`)
      process.exit(1)
    }
    if (probeFlag === '--probe-clobbered' && findings.every((f) => f.reason !== 'clobbered')) {
      console.error('FAIL 自测：被 padding 简写盖掉的校正必须判成 clobbered，却只看到 missing。')
      process.exit(1)
    }
    console.log(`OK 自测：${probes[probeFlag]} 报出 ${findings.length} 条（门禁是活的）。`)
    return
  }

  if (doFix) {
    const { touched, refused } = fix(root)
    console.log(touched === 0
      ? 'align-capsules: 每个胶囊的校正都生效。'
      : `align-capsules: 收拾了 ${touched} 个胶囊（补上 / 挪到最后）。`)
    if (refused.length !== 0) {
      console.error(`还有 ${refused.length} 个胶囊只缺校正，但规则里有 padding 简写，追加也会被盖掉：`)
      for (const one of refused) console.error(`  ${one}`)
      console.error('  改法见 DESIGN.md 的墨位一节：把校正写成最后一条，或把那条简写改成 padding-inline。')
    }
    return
  }

  const findings = audit(root)
  if (findings.length === 0) {
    console.log('verify-capsules-aligned OK: 每个胶囊的墨位校正都真的生效。')
    return
  }
  report(findings, root)
  process.exit(1)
}

/* 只有直接跑这个文件时才执行 CLI：被 import 时（测试、别的脚本）不该顺手改仓库。 */
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) main()
