#!/usr/bin/env node
/**
 * 设计法则的**双向对账**：登记表与真实世界谁都不许单方面长出去。
 *
 * ── 三个方向，缺一个就会有一条法则在表外活着 ──────────────────────────────────
 *
 *   1. **表 → 门禁**：每条法则声明的 `gate` 文件必须存在，**并且真的被 `pnpm verify`
 *      调用**。一条写在表里、没人守的法则，与没写是一样的——它只会让人以为有人管。
 *   2. **表 → 预览页**：每条法则声明的 `specimen` 必须真的被 `gallery/` 渲染。
 *      预览页是「这条法则长什么样」的唯一现场；标本丢了，法则就只剩一句话。
 *   3. **反向：门禁 → 表**：`scripts/verify-*.mjs` 里守「视觉法则」的那些，必须在表里
 *      有对应条目。否则会出现「门禁在管一条没人知道为什么的规矩」——下一个改这一行的人
 *      只会看到一条红，然后想办法让它变绿。
 *
 * ── 为什么不靠人记 ────────────────────────────────────────────────────────────
 *
 * 这三条都由文件系统回答（文件在不在、字符串在不在），不依赖任何人的记忆。加一条法则
 * 就必须给它一个门禁与一个标本；想跳过，这一关会红，而不是等你下一次踩坑时才发现。
 *
 * 用法：`node scripts/verify-design-sync.mjs [根目录]`
 * 自测：`--probe-missing-gate` / `--probe-missing-specimen` / `--probe-unlisted`
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { stripSourceComments } from './source-core.mjs'

/** 从 `laws.ts` 里读出法则条目（不做完整的 TS 解析，只读它声明的四样东西）。 */
export function lawsFrom(root) {
  const file = join(root, 'src/client/design/laws.ts')
  if (!existsSync(file)) return []
  const source = stripSourceComments(readFileSync(file, 'utf8'))
  const laws = []
  /* 每条是一个对象字面量：抓 `id:` 到下一个 `}` 之间，再逐个字段取。 */
  const blocks = source.split(/\bid:\s*'/).slice(1)
  for (const block of blocks) {
    const id = block.slice(0, block.indexOf("'"))
    const gate = block.match(/\bgate:\s*'([^']+)'/)?.[1]
    const specimen = block.match(/\bspecimen:\s*'([^']+)'/)?.[1]
    if (id === '' || gate === undefined || specimen === undefined) continue
    laws.push({ id, gate, specimen })
  }
  return laws
}

/**
 * `pnpm verify` 到底调了哪些脚本。
 *
 * 有一条间接：`run-gates.mjs` 会把它发现的**每一个** `verify-*.mjs` 都跑一遍（并跑
 * 各自的每个自测）。所以 `verify` 里出现 `run-gates` 就等于**全部**门禁都被调用了
 * ——它是那个「门禁清单」的唯一来源，不在这里再抄一份名单。
 *
 * 为什么必须认这一条：`verify` 原先逐行列出每个脚本，于是每加一个门禁要手改
 * `package.json`；`run-gates` 把那一步去掉之后，这条检查若还只认逐行列举，就会把
 * 「已经全都在跑」误报成「一条都没接线」。接线方式换了，检查读的正是接线方式。
 * @param root - 仓库根。
 * @returns 被调用的脚本文件名集合。
 */
export function gatesCalledByVerify(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const verify = pkg.scripts?.verify ?? ''
  const called = new Set()
  for (const match of verify.matchAll(/scripts\/([\w.-]+\.mjs)/g)) called.add(match[1])
  if (called.has('run-gates.mjs')) {
    for (const one of readdirSync(join(root, 'scripts'))) {
      if (one.startsWith('verify-') && one.endsWith('.mjs')) called.add(one)
    }
  }
  return called
}

/** 预览页里出现了哪些 `data-dsh-taskboard-specimen`。 */
export function specimensInGallery(root) {
  const dir = join(root, 'src/client/gallery')
  if (!existsSync(dir)) return new Set()
  const found = new Set()
  for (const entry of readdirRecursive(dir)) {
    if (!/\.(tsx?|css)$/.test(entry)) continue
    const source = readFileSync(entry, 'utf8')
    for (const match of source.matchAll(/data-dsh-taskboard-specimen=["']([^"']+)["']/g)) {
      found.add(match[1])
    }
  }
  return found
}

function readdirRecursive(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...readdirRecursive(full))
    else out.push(full)
  }
  return out
}

/**
 * 「守视觉法则的门禁」= **自动发现，不是手写名单**。
 *
 * 判据只有一条：`pnpm verify` 调用了它，而且它的名字说明它守的是界面。名字那一半
 * 用前缀表达——`verify-*` 是本仓库「检查界面」的**唯一**前缀（`verify-palette`、
 * `verify-capsule-centring`、`verify-hover-contrast`……）。
 *
 * **为什么不能写死一张名单**：第一版就漏了自己——新加的一条门禁不在名单里，于是它
 * 在法则表外独自活着，而脚本一声不吭。这与清单页加 29 处校正、看板页一处没加是
 * **同一个错误**：一条约定如果有第二个地方要同步，就不该靠人记。
 *
 * **前缀只有一种写法。** 这里曾经还认一个 `align-` 前缀，那是一个已经删掉的脚本留下
 * 的；守着一条没有实现者的规则，等于给「换个名字就能绕过登记」开一个口子——一个叫
 * `check-palette.mjs` 的门禁会从发现里漏掉，而它照样在守界面。所以前缀只留一个，
 * 新的界面门禁一律 `verify-*`，并由 {@link orphanGates} 兜住「文件在但没接线」。
 */
const GATE_PREFIXES = ['verify-']

/**
 * `scripts/` 下每一个门禁文件——**从文件系统读，不从调用清单读**。
 *
 * 这是本脚本此前最大的盲区：反向检查遍历的是 `gatesCalledByVerify()`，也就是
 * **已经被调用**的那些。于是「一个门禁文件存在、但 `pnpm verify` 没调它」这件事
 * 谁也看不见——它不在集合里，所以循环永远碰不到它。这正是 `verify-hover-contrast`
 * 在红着、CI 全绿、而没有任何东西报出来的原因（它在 v1.3.4 被一次整行重写
 * `verify` 长字符串时漏掉，之后一直没人发现）。
 *
 * 判据因此必须**两个方向各读一个真相**：调用清单回答「谁在跑」，文件系统回答
 * 「谁存在」。两者的差集就是漏网的门禁。
 */
export function gateFilesOnDisk(root) {
  const dir = join(root, 'scripts')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.startsWith('verify-') && name.endsWith('.mjs'))
    .sort()
}

/**
 * 存在、名字像门禁、却**没有被 `pnpm verify` 调用**的脚本。
 *
 * 名字为 `verify-*` 就是一次表态：「我是门禁」。表态了却不在闭环里，比没有这个
 * 文件更糟——它会让读者以为有东西在守，而实际上那条线是断的。
 */
export function orphanGates(root) {
  const called = gatesCalledByVerify(root)
  return gateFilesOnDisk(root).filter((name) => !called.has(name))
}

/** 守界面的门禁：`verify` 真的调用了它们，且名字带前缀。 */
export function visualGates(root) {
  return [...gatesCalledByVerify(root)]
    .filter((name) => GATE_PREFIXES.some((prefix) => name.startsWith(prefix)))
    /* `verify-standalone` / `verify-host-contracts` / `verify-action-coverage` 守的是
       仓库、宿主契约与动作目录，不是画出来的东西——它们不进这张表。 */
    .filter((name) => !NON_VISUAL.has(name))
    .sort()
}

/**
 * 守的不是「画出来的东西」的门禁，明列在此。
 *
 * 这是**唯一**允许存在的手写名单，而它列的是**例外**：漏一项的后果是「那个脚本被
 * 要求登记进法则表」——一条红，不是在屏幕上出问题。方向是安全的。
 */
const NON_VISUAL = new Set([
  'verify-standalone.mjs',
  'verify-host-contracts.mjs',
  'verify-action-coverage.mjs',
  'verify-design-docs.mjs',
  'verify-one-implementation.mjs',
  'verify-client-host-boundary.mjs',
  'verify-dead-export.mjs',
  'verify-address-grammar.mjs',
  'verify-truncation-form.mjs',
  'verify-version-sync.mjs',
])

export function check(root) {
  const laws = lawsFrom(root)
  const called = gatesCalledByVerify(root)
  const specimens = specimensInGallery(root)
  const problems = []

  if (laws.length === 0) {
    problems.push({ kind: 'no-laws', detail: 'src/client/design/laws.ts 里一条法则都没有——这张表就没在起作用。' })
  }

  for (const law of laws) {
    const gatePath = join(root, 'scripts', law.gate)
    if (!existsSync(gatePath)) {
      problems.push({ kind: 'missing-gate', law: law.id, detail: `法则 ${law.id} 声明的门禁 scripts/${law.gate} 不存在。` })
    } else if (!called.has(law.gate)) {
      problems.push({ kind: 'unwired-gate', law: law.id, detail: `法则 ${law.id} 的门禁 scripts/${law.gate} 存在，但没有被 pnpm verify 调用——它不会在任何人提交时跑。` })
    }
    if (!specimens.has(law.specimen)) {
      problems.push({ kind: 'missing-specimen', law: law.id, detail: `法则 ${law.id} 的标本 "${law.specimen}" 没有被预览页渲染（找不到 data-dsh-taskboard-specimen="${law.specimen}"）。` })
    }
  }

  for (const gate of visualGates(root)) {
    if (!laws.some((law) => law.gate === gate)) {
      problems.push({ kind: 'unlisted', detail: `scripts/${gate} 在守界面，但 design/laws.ts 里没有它的条目——下一个人只会看到一条红，不知道为什么。` })
    }
  }

  /* 反向的第四条，也是此前唯一没人守的那一条：**文件在、调用清单里没有**。
     两个独立真相（磁盘 / package.json）的差集，不依赖任何人的记忆。 */
  for (const gate of orphanGates(root)) {
    problems.push({
      kind: 'orphan-gate',
      detail: `scripts/${gate} 名字是 verify-*，但 pnpm verify 从不调用它——它存在、有意见、可能正红着，而没有任何一次提交会知道。把它接进 package.json 的 verify（连同它的 --probe-* 自测），或者删掉它。`,
    })
  }

  return { laws, problems }
}

function main() {
  const root = process.argv[2] ?? '.'
  const probe = process.argv.find((arg) => arg.startsWith('--probe-'))

  if (probe !== undefined) {
    /* 自测：每种失效各造一份最小现场，都必须报出来（硬性规范 16：种在 tests/ 里）。 */
    const fixture = {
      '--probe-missing-gate': 'tests/fixtures/design-sync/missing-gate',
      '--probe-missing-specimen': 'tests/fixtures/design-sync/missing-specimen',
      '--probe-unlisted': 'tests/fixtures/design-sync/unlisted',
      '--probe-unwired-gate': 'tests/fixtures/design-sync/unwired-gate',
      '--probe-orphan-gate': 'tests/fixtures/design-sync/orphan-gate',
    }[probe]
    if (fixture === undefined) {
      console.error(`FAIL 未知自测项 ${probe}`)
      process.exit(1)
    }
    const { problems } = check(join(root, fixture))
    const wanted = {
      '--probe-missing-gate': 'missing-gate',
      '--probe-missing-specimen': 'missing-specimen',
      '--probe-unlisted': 'unlisted',
      '--probe-unwired-gate': 'unwired-gate',
      '--probe-orphan-gate': 'orphan-gate',
    }[probe]
    if (!problems.some((p) => p.kind === wanted)) {
      console.error(`FAIL 自测：${probe} 应当报出 ${wanted}，但什么都没报——门禁是死的。`)
      process.exit(1)
    }
    console.log(`OK 自测：${wanted} 被认出（门禁是活的）。`)
    return
  }

  const { laws, problems } = check(root)
  if (problems.length === 0) {
    console.log(`verify-design-sync OK: ${laws.length} 条法则都有门禁、都被 verify 调用、都有预览标本。`)
    return
  }
  console.error(`FAIL 设计法则表与现实对不上（${problems.length} 处）：`)
  for (const problem of problems) console.error(`  [${problem.kind}] ${problem.detail}`)
  process.exit(1)
}

main()
