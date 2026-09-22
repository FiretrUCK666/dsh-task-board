#!/usr/bin/env node
/**
 * sync-toc.mjs —— 让 Markdown 的目录与标题保持同步
 *
 * 目录是**派生内容**：它完全由文件里的标题决定。手工维护的派生内容一定会漂移——
 * 加了一节忘了加目录项、改了标题忘了改锚点。而锚点写错的表现是「点了没反应」，
 * 不报错、不显眼，作者通常不会去点自己的目录。
 *
 * 所以这里不写「记得同步」这种规则，而是把它变成一条命令：**从标题生成目录，
 * 插在标记之间，改完重跑即同步**。与 `compose-agents.mjs` 处理内核是同一个思路——
 * 能机械派生的东西，就交给工具派生，不靠人记。
 *
 * 用法：
 *   node scripts/sync-toc.mjs <文件.md> [更多文件...]     生成 / 刷新
 *   node scripts/sync-toc.mjs <文件.md> --check           只校验，不同步时退出码 1
 *   node scripts/sync-toc.mjs <文件.md> --max-level 2     只收二级标题（默认 2）
 *   node scripts/sync-toc.mjs <文件.md> --min-sections 5  少于这么多节就不加目录（默认 5）
 *
 * 识别三种现状，都不报错：
 *   - 已有标记对 → 就地刷新标记之间的内容（人写的其余部分一字不动）；
 *   - 有手写的目录节、没有标记 → 把那一节纳入标记管理后刷新（**不新增第二个目录**）；
 *   - 完全没有目录 → 节数够时才加；不够就明确说「不需要目录」并跳过。
 *
 * 结构识别一律走**同一份带围栏状态的扫描**（见 scanLines）：标题、目录节定位、
 * 插入点、损坏检查四处判据同源。分开写就会出现「生成时跳过代码块、定位时不跳过」
 * 这种自相矛盾——实测后果是目录被塞进代码块内部，并且把围栏闭合行一并删掉，
 * 而 `--check` 还说没问题。损坏（标记落在围栏内）时**拒绝写入**并说清怎么修，
 * 与 compose-agents 处理受损标记同一种做法：宁可不写，也不写坏。
 *
 * 退出码：0 = 已同步 / 无需同步；1 = --check 发现不同步；2 = 用法或文件错误。
 */

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { relative } from 'node:path'

const START = '<!-- toc:start -->'
const END = '<!-- toc:end -->'

/** 目录节的标题写法：中英文常见几种，都认。 */
const TOC_HEADING_RE = /^##\s+(目录|目錄|Table of contents|Contents|TOC)\s*$/i

/**
 * 生成 GitHub 用的锚点。
 *
 * 规则以权威实现（`github-slugger@2`，GitHub 页面用的就是那一套）为准，逐条对拍过：
 *   `功能特性`                        → `功能特性`（中日韩字符原样保留）
 *   `1. 局域网访问`                    → `1-局域网访问`（标点去掉，空格变连字符）
 *   `A   B`                          → `a---b`（**每个空格各换一个连字符**，不折叠）
 *   `一　二`（全角空格）                → `一二`（非 ASCII 空白被**删除**，不换连字符）
 *   `说明①`（带圈数字）                → `说明`（`\p{No}` 这类序号形状会删掉）
 *   `snake_case 与 README_CN.md`      → `snake_case-与-readme_cnmd`（词内下划线**保留**）
 *   `_强调_`                          → `强调`（只有作强调定界符的下划线才去掉）
 *   `<图标> 功能特性`                  → `-功能特性`（标签与 emoji 去掉，前面的空格留下一个连字符）
 *
 * `selftest.mjs` 的「锚点以权威实现为准」一组，存的就是拿真实 `github-slugger@2`
 * 跑同一批标题得到的期望值（六处历史偏差——连续空格、全角空格、带圈数字、词内
 * 下划线被误删、重复标题同锚点、U+9FFD-9FFF——都已对齐）。
 * 剩下的差异只有两类，都不是错：
 *   - 标签、链接、强调、行内代码按**渲染后**的文字取。库直接吃原始 Markdown，
 *     于是 `<b>x</b>` 在它那里得到 `bxb`；GitHub 页面对的是渲染结果，故取本实现。
 *   - 库的数据表比 Unicode 落后，把后来分配的一批字母（如 U+9FFD-9FFF）也删掉。
 *     本实现按 Unicode 分类保留它们——那是它的表过期，不是规则。
 */
const SLUG_DROP = /[^\p{L}\p{N}\p{M}_ -]|\p{No}/u
/** 例外：这些形状按分类是标点或符号，但权威实现**保留**它们（逐码点实测得出）。 */
const SLUG_KEEP_EXCEPTIONS = /[\u{203F}-\u{2040}\u{2054}\u{24B6}-\u{24E9}\u{FE33}-\u{FE34}\u{FE4D}-\u{FE4F}\u{FF3F}]/u

/** 去掉行内标记，只留渲染后会出现在页面上的文字。 */
function stripInline(text) {
  return text
    .replace(/<((?:https?|mailto):[^>\s]*)>/gi, '$1') // 自动链接：渲染出来就是那个地址
    .replace(/<[^>]*>/g, '')                          // 其余 HTML 标签
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')        // 行内链接与图片：只留文字
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')         // 引用式链接：同上
}

/**
 * 下划线只在**作强调定界符**时去掉；词内下划线保留（`snake_case`、`README_CN.md`）。
 * 判据是「这一串下划线两侧是否都是文字或数字」——CommonMark 也不把词内下划线当强调，
 * 而 GitHub 的锚点取自渲染后的文字，词内那串于是原样留下。
 */
function stripUnderscoreDelimiters(text) {
  return text.replace(/_+/gu, (run, offset) => {
    const before = offset > 0 ? text[offset - 1] : ''
    const after = offset + run.length < text.length ? text[offset + run.length] : ''
    const wordish = (c) => c !== '' && /[\p{L}\p{N}]/u.test(c)
    return wordish(before) && wordish(after) ? run : ''
  })
}

function slug(text) {
  const lowered = stripUnderscoreDelimiters(stripInline(String(text)).trim().toLowerCase())
  let out = ''
  for (const ch of lowered) {
    if (SLUG_KEEP_EXCEPTIONS.test(ch)) { out += ch; continue }
    if (SLUG_DROP.test(ch)) continue
    out += ch
  }
  return out.replace(/ /g, '-')
}

/**
 * 逐行扫描，同时给出围栏状态与标题。**所有结构判据都从这里取**。
 *
 * 围栏按 CommonMark 的常见形态：起始围栏可带语言标记，闭合围栏须同类字符且不短于
 * 起始长度（` ``` ` 与 ` ~~~~ ` 不互相闭合）。
 */
function scanLines(text) {
  const out = []
  let fence = null // { marker: '`' | '~', len: n }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const info = { line, inFence: fence !== null, heading: null }
    const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (m !== null && (fence === null || m[1][0] === fence.marker)) {
      if (fence === null) fence = { marker: m[1][0], len: m[1].length }
      else if (m[1].length >= fence.len && m[2].trim() === '') fence = null
      info.inFence = true
      out.push(info)
      continue
    }
    if (!info.inFence) {
      const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
      if (h !== null) info.heading = { level: h[1].length, title: h[2] }
    }
    out.push(info)
  }
  return out
}

/** 抽出标题。**必须跳过围栏代码块**——代码块里以 `#` 开头的行不是标题。 */
function headings(text, maxLevel) {
  const out = []
  const seen = new Map()
  for (const info of scanLines(text)) {
    if (info.inFence || info.heading === null) continue
    const { level, title } = info.heading
    if (level < 2 || level > maxLevel) continue
    if (TOC_HEADING_RE.test(`## ${title}`)) continue // 目录自己不进目录
    // 同名标题：权威实现给第二个加 -1、第三个加 -2，并且**继续找第一个空位**。
    // 只加后缀不检查占用会造出两个同锚点——实测过，目录第二条会跳到第一条去。
    const original = slug(title)
    let id = original
    while (seen.has(id)) {
      seen.set(original, (seen.get(original) ?? 0) + 1)
      id = `${original}-${seen.get(original)}`
    }
    seen.set(id, 0)
    out.push({ level, title, id })
  }
  return out
}

/** 按标题生成目录正文。 */
function renderToc(items, eol) {
  const lines = []
  for (const it of items) {
    const indent = '  '.repeat(it.level - 2)
    lines.push(`${indent}- [${it.title}](#${it.id})`)
  }
  return lines.join(eol)
}

/** 按原文件的主导行尾决定新内容的行尾；判不出来用 LF。 */
function detectEol(text) {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length
  return crlf > lf ? '\r\n' : '\n'
}

/** 把正文插进标记之间（标记已存在）。 */
function replaceBetween(text, body, eol) {
  const s = text.indexOf(START)
  const e = text.indexOf(END)
  if (s < 0 || e < 0 || e < s) throw new Error('目录标记不成对')
  return `${text.slice(0, s + START.length)}${eol}${eol}${body}${eol}${eol}${text.slice(e)}`
}

/**
 * 标记是否落在代码围栏里——文件已被写坏的判据。
 *
 * 旧版本会把目录插进代码块内部（并吃掉围栏闭合行），那种文件的标记就在围栏里。
 * 检出后**不写**，避免越修越坏；`--check` 同样报错（不能读成「已是当前状态」）。
 */
function markersInsideFence(text) {
  const s = text.indexOf(START)
  const e = text.indexOf(END)
  if (s < 0 || e < 0) return false
  const flags = { start: false, end: false }
  let offset = 0
  let fence = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const at = offset
    const next = offset + raw.length + 1
    if (at <= s && s < next) flags.start = fence !== null
    if (at <= e && e < next) flags.end = fence !== null
    const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (m !== null && (fence === null || m[1][0] === fence.marker)) {
      if (fence === null) fence = { marker: m[1][0], len: m[1].length }
      else if (m[1].length >= fence.len && m[2].trim() === '') fence = null
    }
    offset = next
  }
  return flags.start || flags.end
}

/** 把行数组按原文行尾接回去（scanLines 去掉了行尾的 \r，这里按主导行尾还原）。 */
function joinLines(lines, eol) {
  return lines.map((l) => l.line).join(eol)
}

async function main() {
  const args = process.argv.slice(2)
  const files = []
  let check = false
  let maxLevel = 2
  let minSections = 5

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--check') { check = true; continue }
    if (a === '--max-level') { maxLevel = Number(args[++i]); continue }
    if (a === '--min-sections') { minSections = Number(args[++i]); continue }
    if (a === '--help' || a === '-h') {
      process.stdout.write('用法：node scripts/sync-toc.mjs <文件.md...> [--check] [--max-level N] [--min-sections N]\n')
      return 0
    }
    if (a.startsWith('--')) { process.stderr.write(`错误：无法识别的参数 ${a}\n`); return 2 }
    files.push(a)
  }
  if (files.length === 0) { process.stderr.write('用法：node scripts/sync-toc.mjs <文件.md...> [--check]\n'); return 2 }
  if (files.some((f) => !existsSync(f))) {
    process.stderr.write(`错误：文件不存在 ${files.find((f) => !existsSync(f))}\n`)
    return 2
  }

  let drifted = 0
  for (const f of files) {
    const text = readFileSync(f, 'utf8').replace(/^\uFEFF/, '')
    const items = headings(text, maxLevel)
    const hasMarkers = text.includes(START) && text.includes(END)
    const eol = detectEol(text)
    const body = renderToc(items, eol)

    if (hasMarkers && markersInsideFence(text)) {
      process.stderr.write(
        `${f}：目录标记落在代码围栏内部——文件已被写坏（目录被插进了代码块）。\n`
        + '  **本脚本没有改动它。** 请手工删掉围栏内的这一对标记：\n'
        + `    ${START}\n    ${END}\n`
        + '  删掉后重跑本脚本，它会在正确位置重建目录。\n',
      )
      return 2
    }

    if (!hasMarkers && items.length < minSections) {
      process.stdout.write(`${f}：${items.length} 节，少于阈值 ${minSections}，**不需要目录**\n`)
      continue
    }

    if (hasMarkers) {
      const next = replaceBetween(text, body, eol)
      if (next === text) {
        process.stdout.write(`${f}：目录已是当前状态（${items.length} 项）\n`)
      } else if (check) {
        drifted += 1
        process.stdout.write(`${f}：**目录与标题不同步**（应为 ${items.length} 项）\n`)
      } else {
        writeAtomic(f, next)
        process.stdout.write(`${f}：已刷新目录（${items.length} 项）\n`)
      }
      continue
    }

    // 没有标记。分两种情况：已有手写目录节，或完全没有。
    // 判据取**围栏外**的行；接管手写目录时只吃「目录标题 + 紧随其后的连续列表项」，
    // 不用「标题到下一个标题」那种区间——那会把区间里的说明文字、乃至围栏闭合行
    // 一并吃掉（实测过）。
    const lines = scanLines(text)
    const tocAt = lines.findIndex(
      (l) => !l.inFence && l.heading !== null && l.heading.level === 2
        && TOC_HEADING_RE.test(`## ${l.heading.title}`),
    )
    if (tocAt >= 0) {
      // 只吃掉「目录标题之后的空行与列表项」，到**最后一个列表项**为止：
      // 之后的说明文字、引用块、围栏都留在原地。空行不算内容，但也不许越过它去
      // 吃后面的东西——那正是旧版本「标题到下一个标题」的区间式接管的病根。
      let lastItem = tocAt
      for (let i = tocAt + 1; i < lines.length; i += 1) {
        const l = lines[i]
        if (l.inFence || l.heading !== null) break
        const blank = l.line.trim() === ''
        const item = /^\s*(?:[-*+]|\d+[.)])\s+/.test(l.line)
        if (!blank && !item) break
        if (item) lastItem = i
      }
      const endLine = lastItem + 1
      const head = joinLines(lines.slice(0, tocAt + 1), eol)
      const tail = joinLines(lines.slice(endLine), eol)
      const managed = `${head}${eol}${eol}${START}${eol}${eol}${body}${eol}${eol}${END}`
      const next = tail === '' ? `${managed}${eol}` : `${managed}${eol}${eol}${tail}`
      if (check) {
        drifted += 1
        process.stdout.write(`${f}：目录是手写的、还没纳入自动同步（${items.length} 项应生成）\n`)
      } else {
        writeAtomic(f, next)
        process.stdout.write(`${f}：已把手写目录纳入自动同步（${items.length} 项）\n`)
      }
      continue
    }

    // 完全没有目录：插在**围栏外的第一个二级标题**之前；没有二级标题就追加到文件末尾。
    // 前后各留一个空行：拼装时先去掉头部末尾的空行，再补两处，避免叠出三四行空白。
    const firstH2 = lines.findIndex((l) => !l.inFence && l.heading !== null && l.heading.level === 2)
    const atLine = firstH2 >= 0 ? firstH2 : lines.length
    const headLines = lines.slice(0, atLine).map((l) => l.line)
    while (headLines.length > 0 && headLines[headLines.length - 1].trim() === '') headLines.pop()
    const head = headLines.join(eol)
    const tail = joinLines(lines.slice(atLine), eol)
    const section = `## 目录${eol}${eol}${START}${eol}${eol}${body}${eol}${eol}${END}`
    const tailPart = tail === '' ? `${eol}` : `${eol}${eol}${tail}`
    const next = head === '' ? `${section}${tailPart}` : `${head}${eol}${eol}${section}${tailPart}`
    if (check) {
      drifted += 1
      process.stdout.write(`${f}：**缺少目录**（${items.length} 节，建议加）\n`)
    } else {
      writeAtomic(f, next)
      process.stdout.write(`${f}：已添加目录（${items.length} 项）\n`)
    }
  }

  if (check && drifted > 0) {
    // 含空格或中文的路径必须加引号，否则给出的「修正命令」照抄就失败（实测过）。
    const quoted = files.map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(' ')
    // 提示里给脚本自己的路径：写死 scripts/ 时，脚本被放到别处（例如仓库的 tools/）后
    // 这条"照抄即修复"的命令会直接失败，而它恰恰是给人复制的。
    const selfRel = relative(process.cwd(), process.argv[1] ?? '') || 'sync-toc.mjs'
    process.stderr.write(`\n${drifted} 个文件的目录需要同步。修正：node ${selfRel} ${quoted}\n`)
    return 1
  }
  return 0
}

/** 先写临时文件再改名：中途失败不会留下半截文件。 */
function writeAtomic(path, content) {
  const tmp = `${path}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, content, { encoding: 'utf8' })
    renameSync(tmp, path)
  } catch (error) {
    try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* 清不掉就算了 */ }
    throw error
  }
}

process.exitCode = await main()
