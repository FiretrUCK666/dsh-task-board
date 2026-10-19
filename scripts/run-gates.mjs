#!/usr/bin/env node
/**
 * **把一道门禁跑成「正式一次 + 它的每个自测一次」。**
 *
 * ── 为什么需要这个运行器 ────────────────────────────────────────────────────
 *
 * 每道门禁都声称「自测通过 = 门禁是活的」，于是 `pnpm verify` 要为每个脚本写
 * 1 + N 行（N 是这个脚本的探针数）。当前 15 个脚本、39 个探针 = **52 行手写**。
 *
 * 手写的代价不是长，是**两处声明同一件事**：
 *
 *   - 探针的名字写在脚本自己的 `probeOf([...])` 里；
 *   - 它又要被抄进 `package.json` 的 `verify`。
 *
 * 加一个探针时忘了第二处，那道自测就**永远不跑**——而它不报错。`probe-args.mjs`
 * 的头注释正是在讲这件事（「加一个探针时调用方顺手把它写进名单，忘不了」），
 * 而它当时只能靠人记得。
 *
 * 这个运行器把第二处**去掉**：探针名从脚本源码里读（`probeOf(['--probe-a', …])`
 * 是唯一声明处），然后逐个跑。`package.json` 里只剩一行。
 *
 * ── 为什么从源码读而不是让每个脚本导出它 ────────────────────────────────────
 *
 * 因为那要改 15 个脚本的导出面，而**它们现在这一行已经是权威**：`probeOf` 不认识
 * 的名字会报错退出，所以那一行必须准确，否则脚本自己就跑不了。读它不会引入第二
 * 个真相，只是把已有的那个真相取出来用。
 *
 * **读不到探针不等于没有探针。** 一个脚本若把 `probeOf` 包在别的写法里（比如变量
 * 拼接），这里会读出 0 个，于是它的自测静默不跑——所以有一道自检：**脚本里出现
 * `probeOf(` 却读出 0 个名字，即失败**。
 *
 * 用法：`node scripts/run-gates.mjs [根目录]`
 *      `node scripts/run-gates.mjs [根目录] --list`  只列计划，不执行
 * 自测：`--probe-parse`（解析器对三种写法都读得对）
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { probeOf } from './probe-args.mjs'

/** 哪些脚本由这个运行器跑。顺序无关——它们互相不依赖。 */
const SCRIPTS_DIR = 'scripts'

/**
 * 从一个门禁脚本的源码里读出它认识的自测开关。
 *
 * 两种读法，**都必须有**：
 *
 *   · `probeOf(['--probe-a', '--probe-b'])` —— 共享解析器的调用形态。绝大多数门禁
 *     走这条，它也是推荐形态（拼错的开关会被 `probe-args.mjs` 拒绝）。
 *   · 直接写在源码里的 `'--probe-…'` 字面量 —— 少数脚本自己解析参数（`verify-design-sync`
 *     有 5 个、`verify-scroll-floor` 与 `verify-decoration-property` 各 1 个）。
 *
 * **只认第一种是一个真实发生过的缺陷。** 这个运行器第一版只读 `probeOf([...])`，
 * 于是上面那 7 个自测**静默地不再被 `verify` 调用**——旧的逐行清单里有它们，新的一行
 * 里没有，而没有任何东西报错。讽刺的是 `verify-design-sync` 正是那条守「每个门禁都要
 * 被接线」的法则，它自己的 5 个自测反倒先掉了。
 *
 * 所以判据放宽到「源码里出现过这个开关名字」：它仍然是**同一处真相**（脚本自己知道
 * 自己认识什么），只是不再假设那真相必须长成某一种写法。
 * @param text - 那个脚本的全文。
 * @returns `{ probes }`。
 */
export function probesIn(text) {
  const probes = []
  for (const m of text.matchAll(/['"](--probe[\w-]*)['"]/g)) {
    const name = m[1]
    /* `'--probe-'` 是前缀本身，不是开关名。 */
    if (name === undefined || name === '--probe-') continue
    if (!probes.includes(name)) probes.push(name)
  }
  return { probes, declaresProbeOf: /probeOf\(/.test(text) }
}

/**
 * 列出全部「正式跑 + 自测跑」的计划。
 * @param root - 仓库根。
 * @returns `{ script, args, kind }[]`。
 */
export function planOf(root) {
  const dir = join(root, SCRIPTS_DIR)
  const out = []
  const names = readdirSync(dir).filter((one) => one.startsWith('verify-') && one.endsWith('.mjs')).sort()
  for (const name of names) {
    const text = readFileSync(join(dir, name), 'utf8')
    const { probes, declaresProbeOf } = probesIn(text)
    if (declaresProbeOf && probes.length === 0) {
      /* 调了 `probeOf(` 却一个开关名字都读不到：那说明开关名是拼出来的（变量、模板
         字符串），这个运行器看不见，它的自测会静默不跑。这是一次真失败，不是
         「没有探针」——所以报红而不是跳过。 */
      out.push({ script: name, args: [], kind: 'unreadable-probes' })
      continue
    }
    out.push({ script: name, args: [], kind: 'gate' })
    for (const probe of probes) out.push({ script: name, args: ['.', probe], kind: 'probe' })
  }
  return out
}

/**
 * 跑一条计划。正式跑用调用方给的根目录，自测固定用 `.`（与既有约定一致）。
 * @param root - 仓库根。
 * @param step - 一条计划。
 * @returns 退出码。
 */
function runOne(root, step) {
  const args = [join(SCRIPTS_DIR, step.script), ...(step.args.length === 0 ? ['.'] : step.args)]
  const label = `${step.script}${step.args.length === 0 ? '' : ` ${step.args.join(' ')}`}`
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`\nrun-gates FAILED at: ${label}`)
    return result.status ?? 1
  }
  return 0
}

function main() {
  const argv = process.argv.slice(2)
  const probe = probeOf(['--probe-parse'], process.argv)
  if (probe === '--probe-parse') {
    /* **两种写法都必须读到**，因为只读到第一种会让第二种的自测静默消失——那正是
       这个运行器第一版的缺陷（7 个自测掉了，没有任何东西报错）。 */
    const cases = [
      { text: "probeOf(['--probe-a', '--probe-b'])", want: 2, why: '共享解析器，单行' },
      { text: "probeOf([\n  '--probe-x',\n  '--probe-y',\n  '--probe-z',\n])", want: 3, why: '共享解析器，多行' },
      { text: 'probeOf([])', want: 0, why: '没有探针' },
      /* 自己解析参数的脚本：开关名只是一个源码里的字面量，与 `probeOf` 无关。 */
      { text: "if (arg === '--probe-deco') { run() }", want: 1, why: '自解析、单引号字面量' },
      { text: "const known = ['--probe-a', '--probe-b', '--probe-c']", want: 3, why: '自解析、数组字面量' },
      /* 双引号也算：那是合法的 JS，一个只认单引号的读法会漏掉它。 */
      { text: 'if (a === "--probe-dq") go()', want: 1, why: '双引号字面量' },
      /* 前缀本身不是开关名。 */
      { text: "const P = '--probe-'", want: 0, why: '只有前缀，没有名字' },
    ]
    const wrong = []
    for (const one of cases) {
      const got = probesIn(one.text).probes.length
      if (got !== one.want) wrong.push(`${one.why}：读出 ${String(got)}，应为 ${String(one.want)}`)
    }
    if (wrong.length > 0) {
      for (const line of wrong) console.error(`  - ${line}`)
      console.error('run-gates self-test FAILED: 探针解析读得不对')
      process.exit(1)
    }
    console.log('OK 自测：两种写法（共享解析器 / 源码字面量）都读得对，双引号与空数组也对（门禁是活的）。')
    return
  }

  const root = argv.find((one) => !one.startsWith('--')) ?? '.'
  const plan = planOf(root)
  const bad = plan.filter((one) => one.kind === 'unreadable-probes')
  if (bad.length > 0) {
    for (const one of bad) {
      console.error(`FAIL ${one.script} 里出现了 probeOf(，但读不出任何 --probe 名字。`)
      console.error('  它的自测会静默不跑。请把探针名写成字符串字面量（probeOf([\'--probe-x\'])）。')
    }
    process.exit(1)
  }

  if (argv.includes('--list')) {
    for (const step of plan) {
      console.log(`${step.kind.padEnd(6)} ${step.script}${step.args.length === 0 ? '' : ` ${step.args.join(' ')}`}`)
    }
    console.log(`\n共 ${String(plan.length)} 步（${String(plan.filter((one) => one.kind === 'gate').length)} 个门禁 + ${String(plan.filter((one) => one.kind === 'probe').length)} 个自测）。`)
    return
  }

  for (const step of plan) {
    const code = runOne(root, step)
    if (code !== 0) process.exit(code)
  }
  console.log(`\nrun-gates OK: ${String(plan.length)} 步全绿（每个门禁都跑过它自己的自测）。`)
}

main()
