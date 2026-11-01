#!/usr/bin/env node
/**
 * **一张表按域分得开吗** —— 给「要不要拆表」提供可复算的数字。
 *
 * ── 它回答什么 ──────────────────────────────────────────────────────────────
 *
 * `DESIGN.md` 论证过 `board.module.css` 不该按域拆，理由是三条：能干净归域的规则是
 * 少数、大量组件同时读两个域、跨域组合选择器要求同类同表。那三条判断是对的，而
 * **支撑它们的三组数字会随表长大而变**——所以数字不写进文档，写在这里。
 *
 * 每个域算两个量：
 *
 *   - **(a) 跨域组合选择器**：一条选择器里同时出现两个以上域前缀的类。这类规则
 *     要求它们在同一张表里，所以是拆表的**硬障碍**。
 *   - **(b) 消费者交叉**：读这个域的组件集合，与读别的域的组件集合是否相交。相交
 *     意味着拆开之后那个组件要引两张表。
 *
 * **只有当 (a) = 0 且 (b) 无交叉时**，这个域才适合独立成表。两个数都是机械可算的，
 * 所以「拆不拆」不靠偏好。
 *
 * ── 它不判红 ────────────────────────────────────────────────────────────────
 *
 * 这是一个报告工具，不是门禁：它不规定表该多大。它的价值是让下一次讨论「要不要拆」
 * 时有一份当场可复算的数据，而不是回忆上一次量到什么。
 *
 * 用法：`node scripts/report-domains.mjs [根目录] [--sheet <文件名>]`
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** 注释剥掉：注释里提到一个类名不是一次使用（硬性规范 14）。 */
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '')

/** 客户端半区全部 `*.module.css`。 */
function sheets(root) {
  const found = []
  const walk = dir => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (entry.name.endsWith('.module.css')) found.push(full)
    }
  }
  walk(join(root, 'src', 'client'))
  return found.sort()
}

/** 客户端半区全部 .ts/.tsx，去注释后的文本（找消费者用）。 */
function sources(root) {
  const out = []
  const walk = dir => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry.name)) continue
      out.push({
        rel: relative(root, full).split('\\').join('/'),
        text: stripComments(readFileSync(full, 'utf8')),
      })
    }
  }
  walk(join(root, 'src', 'client'))
  return out
}

/**
 * 一张表的每条规则的「域」：第一个类名前缀的小写词干。
 * @param css - 去注释的样式表文本。
 * @returns `{ selector, domain, classes }` 数组。
 */
export function rulesByDomain(css) {
  const out = []
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    const selector = match[1].trim()
    if (selector === '' || selector.startsWith('@')) continue
    const classes = [...selector.matchAll(/\.([A-Za-z][\w-]*)/g)].map(one => one[1])
    if (classes.length === 0) continue
    const first = classes[0]
    const stem = /^([a-z]+)[A-Z]/.exec(first)
    out.push({ selector, domain: stem === null ? '(none)' : stem[1], classes })
  }
  return out
}

/**
 * 一条选择器里出现了几个不同的域。
 * @param classes - 这条选择器的类名数组。
 * @returns 不同的域前缀集合。
 */
export function domainsIn(classes) {
  const found = new Set()
  for (const name of classes) {
    const stem = /^([a-z]+)[A-Z]/.exec(name)
    if (stem !== null) found.add(stem[1])
  }
  return found
}

function main() {
  const root = resolve(process.argv[2] ?? '.')
  const wantSheet = process.argv.includes('--sheet') ? process.argv[process.argv.indexOf('--sheet') + 1] : 'board.module.css'
  const all = sheets(root)
  const target = all.find(one => one.endsWith(wantSheet))
  if (target === undefined) {
    console.error(`report-domains: 找不到 ${wantSheet}。有的是：`)
    for (const one of all) console.error(`  ${relative(root, one).split('\\').join('/')}`)
    process.exit(1)
  }

  const css = stripComments(readFileSync(target, 'utf8'))
  const rules = rulesByDomain(css)
  if (rules.length === 0) {
    console.error('report-domains: 一条规则都没读到——判据没读任何东西。')
    process.exit(1)
  }

  /* (a) 跨域组合选择器 */
  const crossDomain = rules.filter(rule => domainsIn(rule.classes).size >= 2)

  /* 每个域的规模 */
  const domains = new Map()
  for (const rule of rules) {
    domains.set(rule.domain, (domains.get(rule.domain) ?? 0) + 1)
  }
  const sorted = [...domains].sort((a, b) => b[1] - a[1])

  /* (b) 消费者交叉：每个域被哪些组件读 */
  const consumers = new Map()
  for (const file of sources(root)) {
    for (const [domain] of domains) {
      if (domain === '(none)') continue
      const re = new RegExp(`\\b${domain}[A-Z][A-Za-z0-9_]*`, 'g')
      if (re.test(file.text)) {
        if (!consumers.has(domain)) consumers.set(domain, new Set())
        consumers.get(domain).add(file.rel)
      }
    }
  }

  console.log(`\n=== ${relative(root, target).split('\\').join('/')} ===`)
  console.log(`规则 ${rules.length} 条，域 ${domains.size} 个，跨域组合选择器 ${crossDomain.length} 条\n`)

  console.log('域（规则数 / 消费者文件数 / 与别的域交叉的消费者数）')
  for (const [domain, count] of sorted.slice(0, 14)) {
    const readers = consumers.get(domain) ?? new Set()
    let shared = 0
    for (const one of readers) {
      for (const [other, otherReaders] of consumers) {
        if (other !== domain && otherReaders.has(one)) {
          shared += 1
          break
        }
      }
    }
    const verdict = shared === 0 && !crossDomain.some(rule => rule.domain === domain) ? '可独立成表' : '不适合独立'
    console.log(`  ${domain.padEnd(14)} ${String(count).padStart(4)} 条 · ${String(readers.size).padStart(3)} 个组件 · ${String(shared).padStart(3)} 个跨域 · ${verdict}`)
  }

  if (crossDomain.length > 0) {
    console.log(`\n跨域组合选择器（拆表的硬障碍，前 8 条）：`)
    for (const rule of crossDomain.slice(0, 8)) {
      console.log(`  [${[...domainsIn(rule.classes)].join('+')}] ${rule.selector.slice(0, 78)}`)
    }
  }
  console.log('\n（这是报告，不判红：它给「要不要拆」提供当场可复算的数字。）')
}

main()
