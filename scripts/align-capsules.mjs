#!/usr/bin/env node
/**
 * 给每一个胶囊补上墨位校正，**并且把这件事变成一条可检查的通则**。
 *
 * ── 为什么需要这个脚本 ──────────────────────────────────────────────────────
 *
 * 校正本身很简单：一个下内衬，源自运行时量出的 `--dsh-tb-optical-drop`。
 * 麻烦的是**它要落在每一个胶囊上**，而「每一个」是个移动目标——新写一个按钮、
 * 新加一个芯片，都该自动带上它。靠人记的结果已经看到了：
 *
 *   清单页 29 处都加了（所以它对）
 *   看板页  0 处加了（所以它全歪）
 *
 * 同一个界面两页表现不同，不是谁写错了，是**这条约定没有机制**。所以这里做两件事：
 *
 *   1. `--fix` 把缺的补上（幂等，跑两遍不会有两份）；
 *   2. 不带参数时**只检查**：任何一个 `border-radius: var(--dsh-tb-pill)` 的规则
 *      都要读那枚令牌，否则退出码非零。`pnpm verify` 跑的就是这一档。
 *
 * ── 判据是结构，不是名单 ────────────────────────────────────────────────────
 *
 * 「胶囊」= 一条规则声明了 pill 圆角。这比列举类名可靠：新写的胶囊只要用了那枚
 * 圆角令牌就自动进网，谁也不需要记得来这里登记。
 *
 * 用法：
 *   node scripts/align-capsules.mjs .           # 检查（verify 用这一档）
 *   node scripts/align-capsules.mjs . --fix     # 补齐
 *   node scripts/align-capsules.mjs . --probe   # 自测：种一个缺校正的胶囊，必须报红
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** 补上去的那一对声明：两侧都写，令牌的符号决定用哪一侧。 */
const CORRECTION = 'padding-block: max(0px, calc(-1 * var(--dsh-tb-optical-drop))) max(0px, var(--dsh-tb-optical-drop));'

/**
 * 插进去的注释，一句话。
 *
 * 同一个说明在 18 处重复一遍就是噪声，所以只留**这一行**：它说清「为什么不加会偏」，
 * 完整算术在 `base.module.css` 的墨位那一节与 `DESIGN.md`——**一份成文，多处指路**。
 */
const NOTE = '/* 墨位校正：胶囊里的字要比盒心高半档（见 base.module.css 的墨位一节）。 */'

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

/** 一条规则是不是胶囊：声明了 pill 圆角。 */
function isCapsule(body) {
  return /border-radius:\s*var\(--dsh-tb-pill\)/.test(body)
}

/** 一条胶囊规则是否已经带校正。 */
function hasCorrection(body) {
  return /var\(--dsh-tb-optical-drop\)/.test(body)
}

/** 扫描：返回每个缺校正的胶囊。 */
export function audit(root) {
  const findings = []
  for (const file of sheets(root)) {
    const raw = readFileSync(file, 'utf8')
    /* 注释先抹成空白（保长度），否则注释里出现的词会被当成一次使用。 */
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    for (const rule of rulesOf(css)) {
      if (!isCapsule(rule.body)) continue
      if (hasCorrection(rule.body)) continue
      findings.push({ file, selector: rule.selector, bodyStart: rule.bodyStart })
    }
  }
  return findings
}

/** 补齐：在每个缺校正的胶囊规则末尾插入那一对声明。 */
export function fix(root) {
  const findings = audit(root)
  /* 从后往前插，前面规则的字节位置就不会被后面的插入挤动。 */
  const byFile = new Map()
  for (const finding of findings) {
    if (!byFile.has(finding.file)) byFile.set(finding.file, [])
    byFile.get(finding.file).push(finding)
  }
  for (const [file, list] of byFile) {
    let raw = readFileSync(file, 'utf8')
    list.sort((a, b) => b.bodyStart - a.bodyStart)
    for (const item of list) {
      /* 插在规则体末尾，缩进跟这一行已有的写法走。 */
      const before = raw.slice(0, item.bodyStart)
      const lineStart = before.lastIndexOf('\n') + 1
      const indent = /^\s*/.exec(raw.slice(lineStart, item.bodyStart))?.[0] ?? '  '
      raw = raw.slice(0, item.bodyStart)
        + `\n${indent}${NOTE}`
        + `\n${indent}${CORRECTION}`
        + raw.slice(item.bodyStart)
    }
    writeFileSync(file, raw)
  }
  return findings.length
}

function main() {
  const root = process.argv[2] ?? '.'
  const doFix = process.argv.includes('--fix')
  const probe = process.argv.includes('--probe')

  if (probe) {
    const findings = audit(join(root, 'tests/fixtures/capsule-align'))
    if (findings.length === 0) {
      console.error('FAIL 自测：一个声明了 pill 圆角却没有校正的胶囊必须被报出来，但一条都没有。')
      process.exit(1)
    }
    console.log(`OK 自测：缺校正的胶囊被认出 ${findings.length} 条（门禁是活的）。`)
    return
  }

  if (doFix) {
    const count = fix(root)
    console.log(count === 0
      ? 'align-capsules: 每个胶囊都已经有校正。'
      : `align-capsules: 补齐了 ${count} 个胶囊。`)
    return
  }

  const findings = audit(root)
  if (findings.length === 0) {
    console.log('verify-capsules-aligned OK: 每个胶囊都读了墨位校正。')
    return
  }
  console.error(`FAIL ${findings.length} 个胶囊没有墨位校正——它里面的字会偏，而屏幕上只有它一个偏：`)
  for (const f of findings) {
    console.error(`  ${relative(root, f.file).replace(/\\/g, '/')}  ${f.selector}`)
  }
  console.error('  改法：跑 node scripts/align-capsules.mjs . --fix')
  process.exit(1)
}

main()
