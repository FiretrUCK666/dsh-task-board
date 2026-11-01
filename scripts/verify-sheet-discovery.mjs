#!/usr/bin/env node
/**
 * **样式表只许被「发现」，不许被「列名单」。**
 *
 * ── 它治的是什么 ────────────────────────────────────────────────────────────
 *
 * 同一个病在这个仓库里犯过三次，每次症状一样、每次都不报错：
 *
 *   1. 三条门禁（悬浮、装饰、滚动地板）各写一份 5 项的表名单，而仓库当时有 7 张
 *      `*.module.css` —— 每条门禁漏了 2 张（`scripts/sheet-files.mjs` 头注释）；
 *   2. `tests/css-shapes.spec.ts` 手写 4 张页面表，实际有 5 张
 *      （`workbench/update-dialog.module.css` 从诞生起没被这一族判据看过）；
 *   3. `tests/card-contract.spec.ts` 的字号判据只读 board 与 item，漏 3 张，
 *      其中 `home.module.css` 带着一个 24px 标题，没有任何断言见过它。
 *
 * 三次的共同点不是「谁忘了改」，而是**名单这个做法本身只在写它的那一天是对的**。
 * 加一张表的人不会知道还有第三处名单要改，而漏掉的那一刻屏上没有任何声音。
 *
 * ── 判据：只认「名单形状」，不认「按名引用」 ────────────────────────────────
 *
 * 「引用一张具体的表」是正常且必要的——`card-contract.spec.ts` 必须按名读
 * `tokens.module.css`（字阶的声明处），那是读唯一权威，不是名单。
 *
 * 所以要抓的是**数组字面量里同时出现两张及以上真实存在的表**：那才是一份「要检查
 * 哪些表」的名单。判定分三步，每一步都读结构：
 *
 *   1. **剥注释**（硬性规范 14）——注释里提到表名不是一次使用。这一条是真的：
 *      `sheet-files.mjs` 与 `css-shapes.spec.ts` 的说明文字里都提到过好几张表。
 *   2. **取方括号字面量**，用括号配平切出来（不是按行、不是按正则硬凑）——
 *      名单经常跨行写。
 *   3. **只数真实存在的表**：`a.module.css` / `b.module.css` 这类是门禁自测的
 *      虚构夹具（它们本来就不在磁盘上），不是名单。这个区分是结构性的——
 *      磁盘上有没有那个文件，不靠人判。
 *
 * 命中即红。**没有豁免表**：发现处（`scripts/sheet-files.mjs`）按后缀走目录，
 * 它里面一张表名都没有，所以不需要豁免；一处都不放宽，才有「新增名单必然红」。
 *
 * 用法：`node scripts/verify-sheet-discovery.mjs [根目录]`
 * 自测：`--probe-list`（真实表名的名单，必须红）
 *       `--probe-single`（只引一张表，必须放行）
 *       `--probe-fixture`（虚构表名的探针夹具，必须放行）
 *       `--probe-multiline`（跨行写的名单，必须红）
 *       `--probe-comment`（名单只出现在注释里，必须放行）
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripSourceComments } from './source-core.mjs'
import { probeOf } from './probe-args.mjs'

/** 参与扫描的地方。 */
const SCAN = [
  { dir: 'scripts', match: name => name.startsWith('verify-') && name.endsWith('.mjs') },
  { dir: 'tests', match: name => name.endsWith('.ts') },
]

/** 一张样式表的字面量。 */
const SHEET_LITERAL = /^['"`]([^'"`\n]+\.module\.css)['"`]$/

/**
 * 切出一个字符串里所有的方括号字面量（括号配平，跳过引号里的内容）。
 *
 * 按行切会把跨行的名单看成两个单元素数组，那样一份七项的名单一次都不会命中。
 * @param code - 已剥注释的源码。
 * @returns 每个数组字面量的内部文本与它在源码里的位置。
 */
export function arrayLiterals(code) {
  const out = []
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '[') continue
    let depth = 1
    let quote
    let j = i + 1
    for (; j < code.length && depth > 0; j++) {
      const c = code[j]
      if (quote !== undefined) {
        if (c === '\\') j++
        else if (c === quote) quote = undefined
        continue
      }
      if (c === "'" || c === '"' || c === '`') quote = c
      else if (c === '[') depth++
      else if (c === ']') depth--
    }
    out.push({ inner: code.slice(i + 1, j - 1), open: i, close: j - 1 })
    i = j - 1
  }
  return out
}

/**
 * 一个数组字面量的**直接元素**里，有几个是「纯表名」。
 *
 * ── 为什么必须按元素判，不能按整段文本判 ────────────────────────────────────
 *
 * 「名单」的形态是 `['a.module.css', 'b.module.css']`——元素**本身就是**一条
 * 路径。而门禁自测的夹具是 `[{ rel: 'a.module.css', css: '…' }]`——元素是一个
 * **对象**，路径只是它的一个字段。
 *
 * 两者在整段文本上看不出区别（都含表名），在**元素**上却是两种东西：前者是
 * 「要检查哪些表」的清单（加一张表时它会漏），后者是「我种了一个假现场」
 * （它本来就不该跟着真实文件变）。按文本判会把每一份夹具都报成违规，而一个
 * 什么都报的检查器和一个什么都不报的一样没用。
 *
 * 判据因此是结构性的：切出深度 1 的元素，只留**整体就是一个引号字符串、且以
 * `.module.css` 结尾**的那些。
 * @param inner - 数组字面量的内部文本。
 * @returns 纯表名字符串的数组。
 */
export function bareSheetElements(inner) {
  const out = []
  /* **先把行注释切掉再切元素。** 名单经常在成员之间夹一句 `// …`，而注释里如果
     带一个逗号或括号，按字符切就会把后面所有元素并进前一个——第一版正是这样：
     两条元素的数组只认出第一条，于是「跨行名单」那条自测一直红，而真实仓库里
     一份带注释的名单会漏掉一半成员。这是「读错地方」的又一个实例。 */
  const text = inner.replace(/\/\/[^\n]*/g, '')
  let depth = 0
  let quote
  let start = 0
  const pieces = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote !== undefined) {
      if (c === '\\') i++
      else if (c === quote) quote = undefined
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c
      continue
    }
    if (c === '[' || c === '(' || c === '{') depth++
    else if (c === ']' || c === ')' || c === '}') depth--
    else if (c === ',' && depth === 0) {
      pieces.push(text.slice(start, i))
      start = i + 1
    }
  }
  pieces.push(text.slice(start))
  for (const piece of pieces) {
    const trimmed = piece.trim()
    if (SHEET_LITERAL.test(trimmed)) out.push(trimmed.slice(1, -1))
  }
  return out
}

/**
 * 一段文本里被点名的**真实存在**的样式表。
 * @param names - 表名字符串数组。
 * @param root - 仓库根。
 * @returns 真实存在的表名集合。
 */
export function realSheetsOf(names, root) {
  const found = new Set()
  for (const name of names) {
    const bare = name.replace(/^\.\//, '')
    if (existsSync(join(root, bare)) || existsSync(join(root, 'src', 'client', bare))) {
      found.add(name)
      continue
    }
    const fileName = bare.split('/').pop()
    if (fileName === undefined) continue
    if (sheetsOnDisk(root).has(fileName)) found.add(name)
  }
  return found
}

/**
 * 这个数组字面量是不是**被遍历**过的（`for…of` / `.map` / `.filter` / `.forEach`）。
 *
 * ── 为什么「用途」才是判据，不是「形状」 ────────────────────────────────────
 *
 * 一份名单之所以危险，是因为它**被拿去逐个检查**：加一张表时没人回来补，于是
 * 那张表从诞生起就不被检查。而自证夹具之所以安全，是因为它**被喂给一个函数当
 * 输入**：它本来就不该跟着真实文件变。
 *
 * 两者在字面上都是「一串表名」，结构上却是两件事——区别在**它后面接什么**：
 *
 *   `for (const rel of SHEETS)`  → 名单（要检查的每一张）
 *   `fn([...])`                  → 夹具（喂给判据的一段输入）
 *
 * 按形状判会把每一份夹具都报成违规；按用途判才分得开。这与硬性规范 14 说的是
 * 同一条：判据读结构，不读字样。
 * @param code - 已剥注释的源码。
 * @param openAt - 这个 `[` 的下标。
 * @param closeAt - 配对的 `]` 的下标。
 * @returns 是否被遍历。
 */
export function isIterated(code, openAt, closeAt) {
  /* 数组被赋给一个名字，那个名字随后被遍历——这是最常见的一种。 */
  const before = code.slice(Math.max(0, openAt - 200), openAt)
  const assignment = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before)
  if (assignment !== null) {
    const name = assignment[1]
    const after = code.slice(closeAt)
    const escaped = name.replace(/[$]/g, '\\$')
    if (new RegExp(`(?:for\\s*\\([^)]*\\bof\\s+${escaped}\\b)`).test(after)) return true
    if (new RegExp(`\\b${escaped}\\s*\\.\\s*(?:map|forEach|filter|some|every|reduce|flatMap)\\s*\\(`).test(after)) return true
    if (new RegExp(`\\b${escaped}\\.length\\b`).test(after)) return true
  }
  /* 字面量直接接在 `.map`/`.forEach`/`for…of` 上，中间只隔空白与换行。 */
  const immediate = code.slice(closeAt + 1).trimStart()
  if (/^\.\s*(?:map|forEach|filter|some|every|reduce|flatMap)\s*\(/.test(immediate)) return true
  if (/^\)?\s*\.\s*(?:map|forEach|filter|some|every|reduce|flatMap)\s*\(/.test(immediate)) return true
  return false
}

/** 磁盘上所有样式表的文件名与相对路径（缓存一次）。 */
let sheetCache
function sheetsOnDisk(root) {
  if (sheetCache !== undefined) return sheetCache
  const byName = new Set()
  const walk = dir => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        walk(join(dir, entry.name))
        continue
      }
      if (entry.name.endsWith('.module.css')) byName.add(entry.name)
    }
  }
  walk(join(root, 'src'))
  sheetCache = byName
  return byName
}

/** 走目录，收集待扫文件。 */
function sourceFiles(root) {
  const out = []
  for (const { dir, match } of SCAN) {
    const walk = current => {
      let entries
      try {
        entries = readdirSync(current, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
          walk(join(current, entry.name))
          continue
        }
        if (!match(entry.name)) continue
        const full = join(current, entry.name)
        out.push({
          rel: full.slice(root.length + 1).split('\\').join('/'),
          text: readFileSync(full, 'utf8'),
        })
      }
    }
    walk(join(root, dir))
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

/**
 * 跑一遍判据。
 * @param root - 仓库根（绝对路径）。
 * @returns 违规清单。
 */
export function findings(root) {
  const out = []
  for (const file of sourceFiles(root)) {
    const code = stripSourceComments(file.text)
    for (const literal of arrayLiterals(code)) {
      /* 只看**被遍历**的数组：那是「要检查哪些表」，加一张表时它会漏。 */
      if (!isIterated(code, literal.open, literal.close)) continue
      const named = realSheetsOf(bareSheetElements(literal.inner), root)
      if (named.size >= 2) {
        out.push({ rel: file.rel, sheets: [...named].sort() })
      }
    }
  }
  return out
}

/**
 * **每一条门禁都必须有一个自测开关。**
 *
 * 硬性规范 16 要求「证明门禁会红」——一条没有探针的门禁，谁也不能证明它在真的
 * 判事；而一条永远绿的门禁比没有门禁更糟，因为它会被读成证据。
 *
 * ── 判据为什么不能要求「必须用 probeOf」 ────────────────────────────────────
 *
 * 用哪个读法是**实现细节**，有探针才是义务。`verify-design-sync.mjs` 就是反例：
 * 它有五个探针，但自己查表（未知开关报 `FAIL 未知自测项` 并退出 1，实测过），
 * 没走共享解析器。要求「必须 probeOf」会把一条**合格**的门禁判成不合格——那正是
 * 硬性规范 14 说的「让实现变得不如以前的检查」。
 *
 * 所以判两件都可以的事：脚本里要么出现 `probeOf(`，要么出现 `--probe-` 开关名。
 * 两条都没有 = 它没有任何自测。
 *
 * `run-gates.mjs` 已经在另一头守了另一半（调了 `probeOf(` 却读不出名字 → 红）。
 * 这里守的是「连一个开关名都没有」——两边合起来才完整。
 * @param root - 仓库根。
 * @returns 没有探针的门禁文件名。
 */
export function gatesWithoutProbe(root) {
  const out = []
  let names
  try {
    names = readdirSync(join(root, 'scripts'))
  } catch {
    return out
  }
  for (const name of names) {
    if (!name.startsWith('verify-') || !name.endsWith('.mjs')) continue
    const text = stripSourceComments(readFileSync(join(root, 'scripts', name), 'utf8'))
    const hasProbe = /\bprobeOf\s*\(/.test(text) || /['"]--probe-[\w-]+['"]/.test(text)
    if (!hasProbe) out.push(name)
  }
  return out.sort()
}

function main() {
  const root = resolve(process.argv[2] ?? '.')

  /* 自测先过参数闸（拼错的开关必须红，不能静默跑一次正常检查）。 */
  const probe = probeOf(['--probe-list', '--probe-single', '--probe-fixture', '--probe-multiline', '--probe-comment', '--probe-fed'])

  if (probe !== undefined) {
    /* 每个探针同时钉两件事：读到的表名数量，以及**它被判成名单还是夹具**。
       只钉数量不够——数量对而判定错，自测就是绿的，而门禁是废的。 */
    const cases = {
      '--probe-list': {
        text: [
          'const SHEETS = [',
          "  'src/client/board.module.css',",
          "  'src/client/item/item.module.css',",
          ']',
          'for (const one of SHEETS) check(one)',
        ].join('\n'),
        want: 2,
        wantList: true,
        why: '两条真实表名被遍历 → 名单，必须红',
      },
      '--probe-single': {
        text: [
          'const SHEETS = [',
          "  'src/client/design/tokens.module.css',",
          ']',
          'for (const one of SHEETS) check(one)',
        ].join('\n'),
        want: 1,
        wantList: false,
        why: '只读一张表是「读唯一权威」，不是名单',
      },
      '--probe-fixture': {
        text: [
          'const PLANTED = [',
          "  { rel: 'a.module.css', css: '.x{color:red}' },",
          "  { rel: 'b.module.css', css: '.y{color:blue}' },",
          ']',
          'for (const one of PLANTED) check(one)',
        ].join('\n'),
        want: 0,
        wantList: false,
        why: '虚构表名是自测夹具，磁盘上没有这两个文件',
      },
      '--probe-multiline': {
        text: [
          'const P = [',
          "  'src/client/board.module.css',",
          '  // 成员之间的注释不能截断数组',
          "  'src/client/home/home.module.css',",
          ']',
          'P.forEach(check)',
        ].join('\n'),
        want: 2,
        wantList: true,
        why: '跨行且夹注释的名单也必须读全（按行切会漏掉一半）',
      },
      '--probe-comment': {
        text: [
          "/* 原先写着 ['src/client/board.module.css', 'src/client/item/item.module.css'] */",
          'const T = 1',
        ].join('\n'),
        want: 0,
        wantList: false,
        why: '注释里的表名不是一次使用（硬性规范 14）',
      },
      '--probe-fed': {
        text: [
          'const got = judge([',
          "  'src/client/board.module.css',",
          "  'src/client/item/item.module.css',",
          '])',
        ].join('\n'),
        want: 2,
        wantList: false,
        why: '喂给函数的夹具不是名单——它的用途是当输入，不是「要检查哪些表」',
      },
    }[probe]

    const code = stripSourceComments(cases.text)
    let got = 0
    let asList = false
    for (const literal of arrayLiterals(code)) {
      const named = realSheetsOf(bareSheetElements(literal.inner), root)
      got += named.size
      if (named.size >= 2 && isIterated(code, literal.open, literal.close)) asList = true
    }
    if (got !== cases.want || asList !== cases.wantList) {
      console.error(`verify-sheet-discovery self-test FAILED（${probe}）：读到 ${String(got)} 张、判为${asList ? '名单' : '夹具'}，`
        + `应为 ${String(cases.want)} 张、判为${cases.wantList ? '名单' : '夹具'}`)
      console.error(`  ${cases.why}`)
      process.exit(1)
    }
    console.log(`OK 自测（${probe}）：读到 ${String(got)} 张，判为${asList ? '名单' : '夹具'}，与预期一致（门禁是活的）。`)
    return
  }

  const bad = findings(root)
  const noProbe = gatesWithoutProbe(root)
  if (bad.length === 0 && noProbe.length === 0) {
    console.log(`verify-sheet-discovery OK: ${String(sourceFiles(root).length)} 个脚本/测试没有手写样式表名单；`
      + '每条门禁都有自己的自测开关（覆盖从文件系统长出来）。')
    return
  }
  if (noProbe.length > 0) {
    console.error(`FAIL 这些门禁没有自测开关（${String(noProbe.length)} 条）——没人能证明它们会红：`)
    for (const one of noProbe) console.error(`  - scripts/${one}`)
    console.error('  改法：用 scripts/probe-args.mjs 的 probeOf([...]) 声明至少一个开关，种一份违规输入与一份合法输入。')
  }
  if (bad.length > 0) {
    console.error(`FAIL 手写的样式表名单（${String(bad.length)} 处）——加一张表时它不会跟着变，而屏上不会有声音：`)
    for (const one of bad) console.error(`  - ${one.rel} → ${one.sheets.join(', ')}`)
    console.error('  改法：脚本用 scripts/sheet-files.mjs 的 clientSheetFiles()；测试用 tests/panel-harness.ts 的 clientSheets()。')
  }
  process.exit(1)
}

/**
 * 只有**直接运行**时才跑。
 *
 * 上面导出的判据是纯函数，`tests/sheet-discovery.spec.ts` 要 import 它们来证
 * 「这道门禁真的会红」（硬性规范 16）。没有这个守卫，一次 import 就会立刻跑完
 * 整个扫描并 `process.exit(1)`——那让「拿它当判定函数用」不可能，而自证正是
 * 规范要的那件事。
 *
 * 所以职责分开：上面的函数只管「判」，这里只管「跑」。
 */
const invoked = process.argv[1]
if (invoked !== undefined && resolve(invoked) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
