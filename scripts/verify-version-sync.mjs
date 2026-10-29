#!/usr/bin/env node
/**
 * verify-version-sync.mjs — 版本号在仓库里只有一份权威（判定在 `src/host/version-sync.ts`）。
 *
 * 这个文件只做三件事：读那几份文件、把内容交给判定、把结果说给人听。**判定本身不在这里**
 * ——它住在 `src/`，因为那里才是项目放「可被测试的纯逻辑」的地方（`scripts/` 只是 CLI 壳）。
 *
 * 用法：`node scripts/verify-version-sync.mjs [根目录]`
 * 自测：`--probe-floor`（把门槛抬到构建版本之上，必须报红）
 *       `--probe-whitelist`（白名单漏一个包，必须报红）
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { probeOf } from './probe-args.mjs'

/** 读一份文件；不存在就返回 `undefined`（缺文件本身不是错，只是少了那一类判据）。 */
function readIfPresent(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/**
 * 找出**实际正在运行的那台 DSH** 的安装目录。
 *
 * 不写死路径：全局 npm 的安装位置因平台与包管理器而异，所以把常见位置都试一遍。
 * 找不到就返回 `undefined`——那时这条判据**静默不生效**，而不是报一个假红。
 *
 * @returns {string | undefined} DSH 的 package.json 路径。
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

/**
 * 跑一次检查。
 *
 * @param {string} root - 仓库根目录。
 * @returns {Promise<string[]>} 问题清单。
 */
async function collect(root) {
  /* 动态 import：这个脚本要能在「包还没构建」时也跑得起来（`lib/` 里那份是产物，
     而不是判定来源）。所以从 `src/` 直接取——Node 24 能跑 `.ts`。 */
  const { versionSyncProblems } = await import(pathToFileURL(join(root, 'src/host/version-sync.ts')).href)
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  /* 实际运行的那台 DSH 的版本：读得到就交上去（那条判据才生效），读不到就留空。 */
  const dshManifestPath = runningDshManifest()
  const runningDsh = dshManifestPath === undefined
    ? undefined
    : JSON.parse(readFileSync(dshManifestPath, 'utf8')).version
  const input = {
    manifest,
    workspace: readIfPresent(join(root, 'pnpm-workspace.yaml')),
    lock: readIfPresent(join(root, 'pnpm-lock.yaml')),
    bundle: readIfPresent(join(root, 'lib/client.js')),
    runningDsh,
  }
  return versionSyncProblems(input)
}

function main() {
  const probe = probeOf(['--probe-floor', '--probe-whitelist'])
  const root = resolve(process.argv[2] ?? process.cwd())

  if (probe === '--probe-floor' || probe === '--probe-whitelist') {
    /* 自测：拿一份**必然违规**的假输入，证明判据会咬。 */
    const fake = {
      manifest: {
        name: 'fixture',
        version: '1.0.0',
        engines: { dsh: '>=9.9.9' },
        devDependencies: { '@deepseek-ai/dsh-tools': '0.2.2-alpha.2' },
        peerDependencies: {},
      },
      ...(probe === '--probe-whitelist'
        ? {
            workspace: "minimumReleaseAgeExclude:\n  - '@deepseek-ai/dsh-tools@0.2.2-alpha.2'\n",
            lock: "'@deepseek-ai/dsh-tools@0.2.2-alpha.2':\n'@deepseek-ai/dsh-agent@0.2.2-alpha.2':\n",
          }
        : {}),
    }
    import(pathToFileURL(join(root, 'src/host/version-sync.ts')).href).then(module => {
      const found = module.versionSyncProblems(fake)
      const caught = found.length > 0
      console.log(`version-sync self-test（${probe}）: ${caught ? 'OK 被抓住' : 'FAIL 漏了'}`)
      process.exitCode = caught ? 0 : 1
    })
    return
  }

  collect(root).then(problems => {
    if (problems.length === 0) {
      console.log('verify-version-sync OK: 版本号一处权威，门槛、冷静期白名单与产物全都跟着它')
      return
    }
    console.error(`verify-version-sync FAILED (${String(problems.length)})`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
  })
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  main()
}
