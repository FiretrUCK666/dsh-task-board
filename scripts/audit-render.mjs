#!/usr/bin/env node
/**
 * 渲染审计的可复现入口：**工件不对就重做，没有浏览器就明说 SKIP**。
 *
 * ── 它解决的是什么 ──────────────────────────────────────────────────────────
 *
 * `audit-panels.mjs` 自己不会生成工件：它量你给它的那几页 HTML。那三页由台架写
 * （`DSH_PANEL_HTML=<路径> vitest run …`），所以直接跑审计最常见的两种结果是
 * 「量了一张四小时前的旧页」和「目录里没有 tb-*.html，exit 2」。两种都不会说一句
 * 「我其实没量到现在这份代码」。
 *
 * 于是「对齐有没有坏」这件事**从来没有进入过闭环**：它是唯一真正量墨心与盒心距离的
 * 东西（静态门禁只能读写法，读不出结果），却要人记得先造工件、再造对工件、再跑。
 *
 * 这个包装做三件事，每件都是「让它在任何机器上跑一次就有意义」：
 *
 *   1. **按需造工件**：三页各由它自己的 spec 写出来（`DSH_PANEL_HTML` 指到临时目录）。
 *      造完检查文件存在且非空——一份 4 字节的 HTML 是「spec 跑了但没写页」，不是绿。
 *   2. **跑审计**，把它的退出码原样传出去。
 *   3. **没有浏览器时打印 SKIP 并 exit 0**：这与 `shot-panel.mjs` 的立场一致——缺一台
 *      浏览器是关于这台机器的事实，不是这次改动的失败。**但它绝不假装量过**：输出里
 *      明写「未测量」，所以「绿」与「没跑」在报告里长得不一样（硬性规范 15）。
 *
 * ── 为什么不直接塞进 pnpm verify ────────────────────────────────────────────
 *
 * 它要一台真 Chromium、要跑三个 spec（约二十秒）、还要写临时文件。把它放进每次
 * `pnpm verify` 会让那条门禁在 CI 上慢一个量级，而 CI 镜像里未必有浏览器。所以它
 * 是一个**独立的、可复现的一步**（`pnpm run audit:ci`），由人和 CI 各自按需调用。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/** 三张工件页：文件名词干 → 写它的 spec（以及可选的 `-t` 过滤）。 */
const PAGES = [
  { stem: 'tb-items', spec: 'tests/item-workbench.spec.ts' },
  { stem: 'tb-home', spec: 'tests/home-panel.spec.ts' },
  /* 看板那一页由一条专门的用例写；不加 `-t` 会跑到弹窗那条，把页覆盖成弹窗的现场。 */
  { stem: 'tb-board', spec: 'tests/board-panel.spec.ts', grep: 'writes the board page when DSH_PANEL_HTML names a path' },
]

const args = new Set(process.argv.slice(2))
const keep = args.has('--keep')
const dir = keep ? join(ROOT, 'tmp/audit-pages') : mkdtempSync(join(tmpdir(), 'tb-audit-pages-'))

/** 跑一条命令，透传输出，返回退出码。 */
function run(command, argv, env = {}) {
  const result = spawnSync(command, argv, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: 'pipe',
    /* Windows 上 `npx` / `pnpm` 是 `.cmd` 垫片：不经过 shell 就**根本启动不了**，
       `status` 会是 null，而 null 会被读成「spec 失败了」——一次工具调用方式的问题
       被误报成代码问题。所以这里显式开 shell，命令名也按平台换成可执行的形态。 */
    shell: process.platform === 'win32',
  })
  return { code: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

/** 跑 vitest：直接用 node 执行它的入口，绕开 shell 与 `.cmd` 垫片。 */
function runVitest(argv, env) {
  const entry = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
  return spawnSync(process.execPath, [entry, ...argv], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: 'pipe',
  })
}

if (!keep) process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* 清理失败不影响结论 */ } })
else console.log(`audit: pages kept in ${dir}`)

/* ── 一、造工件 ────────────────────────────────────────────────────────────── */
const pages = []
for (const page of PAGES) {
  const target = join(dir, `${page.stem}.html`)
  const argv = ['run', page.spec]
  if (page.grep !== undefined) argv.push('-t', page.grep)
  const result = runVitest(argv, { DSH_PANEL_HTML: target })
  if ((result.status ?? 1) !== 0) {
    console.error(`FAIL ${page.spec} 没能写出工件页（exit ${result.status}）：这一页不会被量。`)
    console.error(`${result.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n'))
    process.exit(1)
  }
  /* **一份几字节的 HTML 不是一页。** spec 可以「跑过」而什么都没写（过滤没命中、或者
     环境变量没传下去），那时审计会去量一个空文档并报一堆 no-reading——那看起来像排版
     坏了，其实是工件没造出来。 */
  if (!existsSync(target) || statSync(target).size < 50_000) {
    console.error(`FAIL ${page.stem}.html 没有写出可用的页（${existsSync(target) ? `${statSync(target).size} bytes` : '缺文件'}）`)
    process.exit(1)
  }
  pages.push(target)
}
console.log(`audit: ${pages.length} page(s) regenerated`)

/* ── 二、有没有浏览器 ──────────────────────────────────────────────────────── */
const probeShot = run('node', ['scripts/shot-panel.mjs', '--out', join(dir, 'probe.png'), '--url', `file://${pages[0].replace(/\\/g, '/')}`, '--width', '400', '--wait', '200'])
if (probeShot.code !== 0 || /no browser|找不到|not found/i.test(probeShot.out)) {
  console.log('audit SKIP: 这台机器上找不到可驱动的 Chromium——**未测量**，不是通过。')
  console.log('  装上 Chromium（或设 DSH_SHOT_BROWSER=<路径>）之后重跑 `pnpm run audit:ci`。')
  console.log('  静态门禁仍然守住了写法（`verify-capsule-centring` 等），但「墨心是否落在盒心」只有这里能量。')
  process.exit(0)
}

/* ── 三、量 ────────────────────────────────────────────────────────────────── */
const audit = run('node', ['scripts/audit-panels.mjs', '--pages', pages.join(',')])
process.stdout.write(audit.out)
process.exit(audit.code)
