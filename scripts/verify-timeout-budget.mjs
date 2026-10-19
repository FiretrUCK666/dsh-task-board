#!/usr/bin/env node
/**
 * **host 的每一段预算都必须明显小于浏览器的预算。**
 *
 * ── 这条门禁守的是一个真实发生过的故障 ──────────────────────────────────────
 *
 * 读者报的现象：点「检查更新」，有时成功，有时跳出「检查失败，请重试」。
 *
 * 根因不是随机的。浏览器那一侧读这个接口的上限是 `fetchUpdateSource` 的 **15 秒**；
 * 而 host 那一侧读 git 远端用的是 `git ls-remote`，它的上限**也是 15 秒**。github.com
 * 可达时它 1.4 秒返回、一切正常；被墙时它走满 15 秒，**正好压死浏览器那一侧**——于是
 * 屏上出现一次失败，而 host 其实还在正常干活。
 *
 * 「忽好忽坏」不是随机，是**取决于那一刻 github 通不通**。而这类 bug 最难查，因为
 * 两边的数字各自都「合理」：15 秒对一个网络请求不算长。问题不是任何一个数字，是
 * **两个数字之间的关系**——而关系没有任何一个文件在说。
 *
 * 所以判据是关系，不是数值：
 *
 *   1. 从客户端源码里读那个预算（**推导，不写死**——写死的话改了客户端这里会静默
 *      放过，而那正是这条门禁存在的理由）。
 *   2. host 侧任何网络/子进程超时都必须小于它，并留出余量
 *      （`SAFETY_RATIO`：不是「小于就行」——0.99 倍也叫小于，但一次正常读走不满它，
 *      照样会在边界上翻车）。
 *
 * 用法：`node scripts/verify-timeout-budget.mjs [根目录]`
 * 自测：`--probe-overrun`（种一个与客户端等长的超时，必须报红）
 *       `--probe-within`（种一个明显更短的，必须放行）
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { probeOf } from './probe-args.mjs'

/** 客户端那一份：预算从它的默认参数里读。 */
const CLIENT_FILE = 'src/client/update-source.ts'
/** 该文件里这个函数的 `timeoutMs` 默认值就是浏览器给整次读取的预算。 */
const CLIENT_FN = 'fetchUpdateSource'

/**
 * host 侧的每一段至少要比客户端预算紧凑这么多。
 *
 * 不是「小于就行」：一个 14999ms 的超时确实小于 15000ms，但它一次正常读根本走不满，
 * 一旦走满就必然翻车。「留余量」是这条规则的一半——剩下的时间要给同一请求里其余的段
 * （几次本地子进程、一次 JSON 序列化、网络往返）走完。
 */
const SAFETY_RATIO = 0.75

/**
 * 哪些 host 文件受这条约束，以及里面的超时是怎么写的。
 *
 * 读两样：
 *
 *   - `const X_MS = 1234` 这种命名常量（本仓库的做法：每个预算都有名字与理由）；
 *   - `gitOut(dir, args, 15000)` 这种内联实参（老写法，容易被忘掉）。
 *
 * 后者才是真正危险的那个：它没有名字，所以搜不到、改不全。
 */
const HOST_FILES = ['src/host/update-route.ts']

/**
 * 从客户端源码读出预算。
 * @param text - `update-source.ts` 的全文。
 * @returns 毫秒数；读不到则 `undefined`（读不到要报错，不能当成「没问题」）。
 */
export function clientBudgetOf(text) {
  const fn = new RegExp(`export async function ${CLIENT_FN}\\([^)]*timeoutMs\\s*=\\s*([\\d_]+)`)
  const m = fn.exec(text)
  if (m === null) return undefined
  return Number((m[1] ?? '').replace(/_/g, ''))
}

/**
 * 从一个 host 文件里找出所有「网络/子进程超时」的名字常量与内联值。
 * @param text - 那个文件的全文。
 * @returns `{ name?, value, where }[]`。
 */
export function hostBudgetsOf(text) {
  const out = []
  /* 命名常量：`const X_MS = 8000` / `const X_TIMEOUT_MS = 6_000`。 */
  for (const m of text.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*([\d_]+)\s*$/gm)) {
    const name = m[1]
    if (!/_MS$/.test(name)) continue
    out.push({ name, value: Number((m[2] ?? '').replace(/_/g, '')), where: name })
  }
  return out
}

/**
 * 找内联的子进程超时实参：`gitOut(dir, [...], 15000)`。
 *
 * 这一支专门抓「没有名字」的那种——它才是最容易被忘掉的。
 * @param text - 那个文件的全文。
 * @returns 每个内联值的行号。
 */
export function inlineBudgetsOf(text) {
  const out = []
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    for (const m of line.matchAll(/gitOut\([^)]*,\s*([\d_]{3,})\s*\)/g)) {
      out.push({ value: Number((m[1] ?? '').replace(/_/g, '')), line: index + 1 })
    }
  })
  return out
}

/**
 * 判定。
 * @param root - 仓库根。
 * @param clientBudget - 客户端预算（可注入，供自测）。
 * @param hostFiles - host 文件与全文（可注入，供自测）。
 * @returns `{ budget, limit, findings }`。
 */
export function judge(root, clientBudget, hostFiles) {
  const limit = Math.floor(clientBudget * SAFETY_RATIO)
  const findings = []
  for (const { file, text } of hostFiles) {
    for (const one of hostBudgetsOf(text)) {
      if (one.value <= limit) continue
      findings.push({
        file,
        where: `${one.where} = ${String(one.value)}ms`,
        detail: `这一段的预算 ${String(one.value)}ms 不小于客户端的 ${String(clientBudget)}ms 的 `
          + `${String(SAFETY_RATIO * 100)}%（上限 ${String(limit)}ms）。`
          + '一次走满它就会让浏览器先放弃，把整次读取画成「检查失败」——而 host 其实还在正常干活。',
      })
    }
    /* **总额也要有一道闸，而且它得看数字，不能只看有没有这个名字。**
       逐段看每一段都合规，加起来照样能超支：registry 最坏 8.8 秒，答不上来才问仓库
       （最坏 8 秒），合计 16.8 秒 > 15 秒。没有任何一个数字是错的，错的是它们的和——
       而和不写在任何一个地方。
       第一版这里只判「有没有 `CHECK_TOTAL_BUDGET_MS`」这个**名字**，于是把它写成 1
       也照样通过——一条量不出差别的检查。现在读它的值。 */
    const totalMatch = /CHECK_TOTAL_BUDGET_MS\s*=\s*([\d_]+)/.exec(text)
    if (totalMatch === null) {
      findings.push({
        file,
        where: '缺一个总预算常量',
        detail: '这个文件里没有 `CHECK_TOTAL_BUDGET_MS`。逐段上限加起来可以超过客户端预算'
          + '（registry 8.8s + 仓库 8s = 16.8s > 15s），而每一段单独看都是合规的。'
          + '需要一个「整次读取」的总额，让读取带着已经拿到的部分收场。',
      })
    } else {
      const total = Number((totalMatch[1] ?? '').replace(/_/g, ''))
      /* 总预算必须**真的比客户端小**（用同一个 75% 余量档），而不是「有个数就算」。
         顺带也要求它不小于 1 秒：一个 1ms 的总额会让每次读取都立刻放弃，那是一种
         看起来门禁通过、实际功能已死的写法。 */
      if (total > limit) {
        findings.push({
          file,
          where: `CHECK_TOTAL_BUDGET_MS = ${String(total)}ms`,
          detail: `整次读取的总额 ${String(total)}ms 超了上限 ${String(limit)}ms。`
            + '这个数比任何一段都重要：它决定读者等多久，而各段之和不受它约束。',
        })
      }
      if (total < 1_000) {
        findings.push({
          file,
          where: `CHECK_TOTAL_BUDGET_MS = ${String(total)}ms`,
          detail: '总额小于 1 秒：每次读取都会立刻放弃，功能等于没有。',
        })
      }
    }
    for (const one of inlineBudgetsOf(text)) {
      if (one.value <= limit) continue
      findings.push({
        file,
        where: `第 ${String(one.line)} 行 内联超时 = ${String(one.value)}ms`,
        detail: `这一段的预算 ${String(one.value)}ms 超了上限 ${String(limit)}ms。`
          + '内联的数字没有名字，所以它既搜不到也改不全——请给它一个名字（`*_MS` 常量）并写清理由。',
      })
    }
  }
  return { budget: clientBudget, limit, findings }
}

function main() {
  const root = process.argv[2] ?? '.'
  const probe = probeOf(['--probe-overrun', '--probe-within', '--probe-huge-total', '--probe-tiny-total'])

  if (probe !== undefined) {
    const budget = 15_000
    const total = 'const CHECK_TOTAL_BUDGET_MS = 11000\n'
    /* 四个夹具，各考一条：
       · overrun —— 某一段与客户端等长（必须红）
       · within  —— 某一段明显更短（必须放行）
       · huge-total —— 总额本身超了上限（必须红）。这一条钉的是「门禁要读数字，
         不能只读名字」：第一版把它写成 1 也照样通过，那是量不出差别的检查。
       · tiny-total —— 总额小到每次都会立刻放弃（必须红：功能等于没有） */
    const cases = {
      '--probe-overrun': { text: `${total}const SLOW_MS = 15000\n`, red: true },
      '--probe-within': { text: `${total}const FAST_MS = 6000\n`, red: false },
      '--probe-huge-total': {
        text: 'const CHECK_TOTAL_BUDGET_MS = 20000\nconst FAST_MS = 6000\n', red: true,
      },
      '--probe-tiny-total': {
        text: 'const CHECK_TOTAL_BUDGET_MS = 1\nconst FAST_MS = 6000\n', red: true,
      },
    }
    const one = cases[probe]
    const bad = judge(root, budget, [{ file: 'fixture.ts', text: one.text }])
    const isRed = bad.findings.length > 0
    if (one.red === isRed) {
      console.log(`OK 自测（${probe}）：${one.red ? '该红的红了' : '该绿的绿了'}（门禁是活的）。`)
      return
    }
    console.error(`verify-timeout-budget self-test FAILED（${probe}）：应为 ${one.red ? '红' : '绿'}，实为 ${isRed ? '红' : '绿'}`)
    if (bad.findings.length > 0) for (const f of bad.findings) console.error(`  ${f.where} — ${f.detail}`)
    process.exit(1)
  }

  if (!existsSync(root)) {
    console.error('verify-timeout-budget: 根目录给错了？')
    process.exit(1)
  }

  const clientPath = join(root, CLIENT_FILE)
  if (!existsSync(clientPath)) {
    console.error(`verify-timeout-budget: 读不到 ${CLIENT_FILE}`)
    process.exit(1)
  }
  const budget = clientBudgetOf(readFileSync(clientPath, 'utf8'))
  if (budget === undefined) {
    /* **读不到不能当成「没问题」。** 一个找不到预算的门禁如果静默通过，它就成了
       「这里没有约束」的假证据。 */
    console.error(`verify-timeout-budget: 在 ${CLIENT_FILE} 里读不到 ${CLIENT_FN} 的 timeoutMs 默认值`)
    process.exit(1)
  }

  const hostFiles = []
  for (const rel of HOST_FILES) {
    const full = join(root, rel)
    if (!existsSync(full)) continue
    hostFiles.push({ file: rel, text: readFileSync(full, 'utf8') })
  }

  const verdict = judge(root, budget, hostFiles)
  if (verdict.findings.length === 0) {
    console.log(`verify-timeout-budget OK: host 每一段都小于客户端的 ${String(budget)}ms（上限 ${String(verdict.limit)}ms）。`)
    return
  }
  console.error(`FAIL ${String(verdict.findings.length)} 处预算超了客户端：`)
  for (const one of verdict.findings) {
    console.error(`  ${one.file} ${one.where}`)
    console.error(`    ${one.detail}`)
  }
  process.exit(1)
}

main()
