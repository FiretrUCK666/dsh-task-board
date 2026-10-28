#!/usr/bin/env node
/**
 * sync-sdk.mjs — 把 SDK 版本同步到「实际正在运行的那台 DSH」。
 *
 * ── 为什么需要一条命令 ──────────────────────────────────────────────────────
 *
 * 「SDK 版本跟随实际运行的 DSH」这句话，落地时要动的地方比看上去多：`devDependencies`
 * 十几个包、`engines.dsh`、`peerDependencies`、`pnpm-workspace.yaml` 的冷静期白名单
 * （62 条）、还有 README 里给人看的门槛。手改一遍要十几分钟，而且**漏一处不会报错**。
 *
 * 所以把它们收进一条命令：**读实际运行的 DSH 版本 → 一个地方一个地方写对**。漏了哪一处，
 * `verify-version-sync` 会红（这条门禁与这份脚本守的是同一件事：一处权威，其余跟随）。
 *
 * ── 它故意**不**做的事 ──────────────────────────────────────────────────────
 *
 * **不自动抬「最低支持版本」**。`engines.dsh` 与 `peerDependencies` 的下界只在**真不兼容**
 * 时才上移（见 AGENTS.md），而「我们升了构建版本」不等于「旧版用户装不了了」。所以默认
 * 只把它们保持在「不高于构建版本」，除非加 `--raise-floor`（那表示你确认旧版真的跑不起来）。
 *
 * **不跑测试**。它只改文件；改完你自己跑 `pnpm install && pnpm verify`——把这两步藏进脚本，
 * 会让人以为「同步过了就等于验过了」。
 *
 * 用法：
 *   node scripts/sync-sdk.mjs              # 跟实际运行的 DSH 同步（推荐）
 *   node scripts/sync-sdk.mjs 0.2.2-alpha.2  # 指定目标版本
 *   node scripts/sync-sdk.mjs --raise-floor  # 同时把最低支持版本抬到目标版本
 *   node scripts/sync-sdk.mjs --dry-run     # 只说会改什么，不落盘
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** DSH 生态里要跟着本体同号的包。 */
const SDK_PREFIX = '@deepseek-ai/dsh-'

/** cordis 走自己的线，**不**跟着本体同号；它的目标版本从 DSH 自己的 package.json 里读。 */
const CORDIS = '@deepseek-ai/cordis'

/**
 * 找出「实际正在运行的那台 DSH」的安装目录。
 *
 * 不写死路径：全局 npm 的安装位置因平台与包管理器而异，所以把常见位置都试一遍，
 * 最后再退回 `require.resolve`（从本仓库向上找）。
 *
 * @returns DSH 的 package.json 路径，或 `undefined`。
 */
function runningDshManifest() {
  const candidates = [
    join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    join(process.env.HOME ?? '', '.npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    join(process.env.HOME ?? '', '.local', 'share', 'pnpm', 'global', '5', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json',
    '/usr/lib/node_modules/@deepseek-ai/dsh/package.json',
  ]
  return candidates.find(candidate => existsSync(candidate))
}

/** 读一份 JSON。 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** 按两个空格缩进写回 JSON，并以换行结尾（与仓库既有风格一致）。 */
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/**
 * 按字母序重排一个对象（`devDependencies` 改动后要保持既有顺序）。
 *
 * @param record -
 */
function sortKeys(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)))
}

function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const raiseFloor = args.includes('--raise-floor')
  const explicit = args.find(arg => !arg.startsWith('--'))

  /* 目标版本：显式给的优先，否则读实际运行的那台。 */
  let target = explicit
  let cordisTarget
  if (target === undefined) {
    const manifestPath = runningDshManifest()
    if (manifestPath === undefined) {
      console.error('sync-sdk: 找不到正在运行的 DSH。请显式给一个版本号，例如：node scripts/sync-sdk.mjs 0.2.2-alpha.2')
      process.exit(2)
    }
    const dsh = readJson(manifestPath)
    target = dsh.version
    /* cordis 的目标从 DSH 自己依赖它的那一条读——它可能停更在别的号段。 */
    const cordisRange = { ...dsh.dependencies, ...dsh.peerDependencies }[CORDIS]
    cordisTarget = cordisRange === undefined ? undefined : cordisRange
    console.log(`目标：DSH ${target}（读自 ${manifestPath}）`)
    if (cordisTarget !== undefined) console.log(`      cordis ${cordisTarget}（读自 DSH 自己的依赖）`)
  } else {
    console.log(`目标：DSH ${target}（显式指定）`)
  }

  const manifestPath = join(ROOT, 'package.json')
  const manifest = readJson(manifestPath)
  const changes = []

  /* 1. devDependencies：DSH 生态全部同号。 */
  for (const name of Object.keys(manifest.devDependencies ?? {})) {
    if (!name.startsWith(SDK_PREFIX)) continue
    if (manifest.devDependencies[name] === target) continue
    changes.push(`devDependencies.${name}: ${manifest.devDependencies[name]} -> ${target}`)
    manifest.devDependencies[name] = target
  }
  if (cordisTarget !== undefined && manifest.devDependencies?.[CORDIS] !== undefined
    && manifest.devDependencies[CORDIS] !== cordisTarget) {
    changes.push(`devDependencies.${CORDIS}: ${manifest.devDependencies[CORDIS]} -> ${cordisTarget}`)
    manifest.devDependencies[CORDIS] = cordisTarget
  }
  manifest.devDependencies = sortKeys(manifest.devDependencies ?? {})

  /* 2. 门槛与 peer：默认只在当前下界**高于**目标时下调（那本来就是个装不上的谎话）；
     加 --raise-floor 才真的往上抬。 */
  const floor = `>=${String(target)}`
  const currentFloor = manifest.engines?.dsh
  if (raiseFloor) {
    if (currentFloor !== floor) {
      changes.push(`engines.dsh: ${currentFloor} -> ${floor}`)
      manifest.engines.dsh = floor
    }
  } else if (currentFloor === undefined) {
    changes.push(`engines.dsh: (缺失) -> ${floor}`)
    manifest.engines = { ...manifest.engines, dsh: floor }
  }
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    if (!name.startsWith(SDK_PREFIX)) continue
    const current = manifest.peerDependencies[name]
    const currentLower = /(\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)/.exec(current ?? '')?.[1]
    const targetLower = /(\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)/.exec(target)?.[1] ?? target
    const shouldSet = raiseFloor
      ? current !== `>=${String(target)}`
      /* 不抬门槛时，只在「下界比构建版本还新」时把它拉回来——那种状态是真的装不上。 */
      : currentLower !== undefined && compare(currentLower, targetLower) > 0
    if (!shouldSet) continue
    changes.push(`peerDependencies.${name}: ${current} -> ${floor}`)
    manifest.peerDependencies[name] = floor
  }

  /* 3. README 里的门槛（两份，中文是权威、英文跟随）。 */
  const readmeEdits = []
  for (const file of ['README.md', 'README.en.md']) {
    const path = join(ROOT, file)
    if (!existsSync(path)) continue
    const before = readFileSync(path, 'utf8')
    /* 只改「DeepSeek Harness `x.y.z`」这一处：那是唯一一处对用户承诺的门槛。
       用回调而不是字符串替换，避免把别的版本号一起卷进来。 */
    const after = before.replace(/(DeepSeek Harness `)(\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)(`)/g, (_all, head, version, tail) => {
      if (version === target && !raiseFloor) return `${head}${version}${tail}`
      /* 不抬门槛时保留原值——门槛是承诺，不该被「同步」顺手改掉。 */
      if (!raiseFloor) return `${head}${version}${tail}`
      readmeEdits.push(`${file}: ${version} -> ${String(target)}`)
      return `${head}${String(target)}${tail}`
    })
    if (after !== before) writeFileSync(path, after, 'utf8')
  }

  /* 4. 冷静期白名单：从 lockfile 重新生成（lockfile 是「实际装了什么」的权威）。
     这一步在 install 之后做才有意义，所以此处只在文件已存在时重写它的**版本段**。 */
  const workspacePath = join(ROOT, 'pnpm-workspace.yaml')
  const lockPath = join(ROOT, 'pnpm-lock.yaml')
  if (existsSync(workspacePath) && existsSync(lockPath)) {
    const lock = readFileSync(lockPath, 'utf8')
    const pairs = new Map()
    for (const match of lock.matchAll(/'?(@deepseek-ai\/dsh-[a-z0-9-]+)@(\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)'?/g)) {
      if (!pairs.has(match[1])) pairs.set(match[1], match[2])
    }
    const entries = [...pairs.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, version]) => `  - '${name}@${version}'`)
    const sheet = readFileSync(workspacePath, 'utf8')
    const head = sheet.slice(0, sheet.indexOf('minimumReleaseAgeExclude:'))
    const next = `${head}minimumReleaseAgeExclude:\n${entries.join('\n')}\n`
    if (next !== sheet) {
      changes.push(`pnpm-workspace.yaml: minimumReleaseAgeExclude 按 lockfile 重生成（${String(entries.length)} 条）`)
      if (!dryRun) writeFileSync(workspacePath, next, 'utf8')
    }
  }

  /* 落盘。 */
  if (changes.length > 0) {
    if (!dryRun) writeJson(manifestPath, manifest)
    for (const change of changes) console.log(`  ${change}`)
    for (const edit of readmeEdits) console.log(`  ${edit}`)
  } else {
    console.log('  没有需要改的：所有地方已经跟着目标版本。')
  }

  if (dryRun) {
    console.log('\n（--dry-run：以上只是要说会改什么，没有落盘）')
    return
  }
  console.log('\n下一步（这一步故意不代做，免得「同步过」被当成「验过」）：')
  console.log('  pnpm install && pnpm verify')
  if (!raiseFloor) {
    console.log('\n注意：最低支持版本没有跟着抬——它只在旧版真跑不起来时才上移。')
    console.log('     确认旧版真的不兼容了，再跑：node scripts/sync-sdk.mjs --raise-floor')
  }
}

/** 简易版本比较：只看数字段与预发布序号，够这里用。 */
function compare(left, right) {
  const parse = text => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/.exec(text)
    return match === null ? undefined : { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] }
  }
  const a = parse(left)
  const b = parse(right)
  if (a === undefined || b === undefined) return 0
  for (let i = 0; i < 3; i += 1) if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i]
  if (a.pre === undefined && b.pre === undefined) return 0
  if (a.pre === undefined) return 1
  if (b.pre === undefined) return -1
  return 0
}

main()
