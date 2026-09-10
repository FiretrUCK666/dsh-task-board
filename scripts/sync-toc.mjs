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
 * 退出码：0 = 已同步 / 无需同步；1 = --check 发现不同步；2 = 用法或文件错误。
 */

import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'

const START = '<!-- toc:start -->'
const END = '<!-- toc:end -->'

/** 目录节的标题写法：中英文常见几种，都认。 */
const TOC_HEADING_RE = /^##\s+(目录|目錄|Table of contents|Contents|TOC)\s*$/im

/**
 * 生成 GitHub 用的锚点。
 *
 * 规则来自 GitHub 实际使用的那个库（`github-slugger`）——不是猜的，是跑出来的：
 *   `功能特性`                        → `功能特性`（中日韩字符原样保留）
 *   `1. 局域网访问`                    → `1-局域网访问`（标点去掉，空格变连字符）
 *   `3. 移动端交互与 PWA 独立全屏 App`    → `3-移动端交互与-pwa-独立全屏-app`
 *   `<图标> 功能特性`                  → `-功能特性`（**图标符号被去掉**，前面的空格留下一个连字符）
 *
 * 最后一条特别值得记：**emoji 不进锚点**。手工写的目录常在这里出错——照着标题抄一遍，
 * emoji 也抄进去，于是那个链接点了没反应。这也是「标题里不要用 emoji」的一条实际理由。
 */
function slug(text) {
  return text
    .replace(/<[^>]*>/g, '')            // 去掉 HTML 标签
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只留文字
    .replace(/[`*_~]/g, '')             // 去掉行内标记符号
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '') // 去掉标点与符号（含 emoji），保留字母、数字、空格、连字符、下划线
    .replace(/\s+/g, '-')
}

/** 抽出标题。**必须跳过围栏代码块**——代码块里以 `#` 开头的行不是标题。 */
function headings(text, maxLevel) {
  const out = []
  const seen = new Map()
  let fence = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line)
    if (fenceMatch !== null) {
      const marker = fenceMatch[1][0]
      if (fence === null) fence = marker
      else if (fence === marker) fence = null
      continue
    }
    if (fence !== null) continue
    const m = /^(#{2,6})\s+(.+?)\s*$/.exec(line)
    if (m === null) continue
    const level = m[1].length
    if (level > maxLevel) continue
    const title = m[2]
    if (TOC_HEADING_RE.test(`## ${title}`)) continue // 目录自己不进目录
    let id = slug(title)
    // 同名标题：GitHub 会给第二个加 -1、第三个加 -2
    if (seen.has(id)) {
      const n = seen.get(id) + 1
      seen.set(id, n)
      id = `${id}-${n}`
    } else {
      seen.set(id, 1)
    }
    out.push({ level, title, id })
  }
  return out
}

/** 按标题生成目录正文。 */
function renderToc(items) {
  const lines = []
  for (const it of items) {
    const indent = '  '.repeat(it.level - 2)
    lines.push(`${indent}- [${it.title}](#${it.id})`)
  }
  return lines.join('\n')
}

/** 把正文插进标记之间（标记已存在）。 */
function replaceBetween(text, body) {
  const s = text.indexOf(START)
  const e = text.indexOf(END)
  if (s < 0 || e < 0 || e < s) throw new Error('目录标记不成对')
  return `${text.slice(0, s + START.length)}\n\n${body}\n\n${text.slice(e)}`
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
    const body = renderToc(items)
    const hasMarkers = text.includes(START) && text.includes(END)

    if (!hasMarkers && items.length < minSections) {
      process.stdout.write(`${f}：${items.length} 节，少于阈值 ${minSections}，**不需要目录**\n`)
      continue
    }

    if (hasMarkers) {
      const next = replaceBetween(text, body)
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
    const tocHeading = TOC_HEADING_RE.exec(text)
    if (tocHeading !== null) {
      // 手写目录：把那一节整段纳入标记管理。**不新增第二个目录**——那正是手工维护
      // 与工具接管之间最容易出的错。
      const at = tocHeading.index
      const rest = text.slice(at)
      const nextHeading = /\n##\s+\S/.exec(rest.slice(tocHeading[0].length))
      const end = nextHeading === null ? text.length : at + tocHeading[0].length + nextHeading.index
      const managed = `${tocHeading[0]}\n\n${START}\n\n${body}\n\n${END}\n`
      const next = text.slice(0, at) + managed + text.slice(end)
      if (check) {
        drifted += 1
        process.stdout.write(`${f}：目录是手写的、还没纳入自动同步（${items.length} 项应生成）\n`)
      } else {
        writeAtomic(f, next)
        process.stdout.write(`${f}：已把手写目录纳入自动同步（${items.length} 项）\n`)
      }
      continue
    }

    // 完全没有目录：在第一个二级标题之前插入一节。
    const firstH2 = /\n##\s+\S/.exec(text)
    const at = firstH2 === null ? text.length : firstH2.index
    const section = `\n## 目录\n\n${START}\n\n${body}\n\n${END}\n`
    const next = text.slice(0, at) + section + text.slice(at)
    if (check) {
      drifted += 1
      process.stdout.write(`${f}：**缺少目录**（${items.length} 节，建议加）\n`)
    } else {
      writeAtomic(f, next)
      process.stdout.write(`${f}：已添加目录（${items.length} 项）\n`)
    }
  }

  if (check && drifted > 0) {
    process.stderr.write(`\n${drifted} 个文件的目录需要同步。修正：node scripts/sync-toc.mjs ${files.join(' ')}\n`)
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
