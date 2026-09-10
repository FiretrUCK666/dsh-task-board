#!/usr/bin/env node
'use strict'

/**
 * dsh-task-board — one-command mount/unmount for the task-board GUI plugin.
 *
 * The plugin ships in the official profile-bundle shape: the local
 * package.json declares `dsh.bundle.patch` (this repo's cordis.patch.yml)
 * and `dsh.client`; mounting registers it in the web profile manifest
 * ($DSH_HOME/profiles/web/package.json, dependencies + dsh.profile.bundles)
 * and runs pnpm install in the profile directory. Restarting the dsh web
 * GUI makes the bundle layer load; a page refresh then shows the sidebar
 * entry.
 *
 * mount   : add the profile-manifest dependency + bundle row, pnpm install.
 * unmount : remove both rows, pnpm install — the GUI fully reverts; task
 *           data stays in the host storage unit and the browser.
 * status  : report the current mount state.
 *
 * Two identities are in play and they are not interchangeable. PACKAGE_NAME
 * is what pnpm installed and what the profile manifest keys on (dependencies
 * and dsh.profile.bundles both hold package names, and cordis.patch.yml's row
 * `name:` must match it). PLUGIN_ID names the loader row, the served browser
 * asset, the settings namespace, the HTTP routes, the storage unit and the
 * settings-card slot — a scoped package name never moves it.
 *
 * Only the profile manifest rows owned by this plugin are touched; other
 * profile rows are left alone. The legacy unscoped key is cleaned up too, so
 * a checkout that predates the scoped rename migrates instead of leaving a
 * dependency pointing at a package that no longer exists.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Resolve the DSH home root. DSH_HOME is authoritative and already points at
// the ~/.dsh directory itself (it may sit somewhere other than the user's
// home, and HOME is unset on Windows); fall back to ~/.dsh under os.homedir()
// for POSIX shells where only HOME is populated.
const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const PROFILE_DIR = path.join(DSH_HOME, 'profiles', 'web')
const PROFILE_MANIFEST = path.join(PROFILE_DIR, 'package.json')
const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

// Both identities are read from the plugin's own manifest rather than repeated
// here, so a rename needs no edit in this helper: the package name is what goes
// into the profile manifest, and the plugin id is the row identity the loader
// uses (it defaults to the folder name, matching the loader's own rule).
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
const PACKAGE_NAME = PACKAGE_JSON.name
const PLUGIN_ID = PACKAGE_JSON.name.split('/').pop()
/** Rows written by versions before the scoped rename; removed on mount. */
const LEGACY_PACKAGE_NAMES = PLUGIN_ID === 'dsh-task-board' ? ['dsh-task-board'] : []

function readManifest() {
  return JSON.parse(fs.readFileSync(PROFILE_MANIFEST, 'utf8'))
}

function writeManifest(manifest) {
  fs.writeFileSync(PROFILE_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
}

function checkBuilt() {
  const client = path.join(REPO, 'lib', 'client.js')
  if (!fs.existsSync(client)) {
    console.warn(`[!] ${client} 不存在——请先在仓库里运行 npm run build（构建出 lib/client.js）再挂载。`)
    return false
  }
  return true
}

function ensureProfile() {
  if (!fs.existsSync(PROFILE_MANIFEST)) {
    throw new Error(`web profile manifest 不存在：${PROFILE_MANIFEST}（先运行 dsh web 或 dsh plugin --profile web 初始化）`)
  }
}

function installProfile() {
  execSync('pnpm install', { cwd: PROFILE_DIR, stdio: 'inherit' })
}

function mount() {
  if (!fs.existsSync(path.join(REPO, 'package.json'))) {
    throw new Error(`仓库缺少 package.json：${REPO}`)
  }
  checkBuilt()
  ensureProfile()

  const manifest = readManifest()
  const deps = manifest.dependencies ?? (manifest.dependencies = {})
  const bundles = manifest.dsh?.profile?.bundles ?? (manifest.dsh = { profile: { bundles: [] } }).profile.bundles
  const spec = `link:${REPO}`

  for (const legacy of LEGACY_PACKAGE_NAMES) {
    if (legacy !== PACKAGE_NAME && deps[legacy] !== undefined) {
      delete deps[legacy]
      console.log(`[ok] dependencies -= ${legacy}（旧的无作用域键，迁移到 ${PACKAGE_NAME}）`)
    }
    const legacyIdx = bundles.indexOf(legacy)
    if (legacy !== PACKAGE_NAME && legacyIdx !== -1) {
      bundles.splice(legacyIdx, 1)
      console.log(`[ok] dsh.profile.bundles -= ${legacy}（旧的无作用域键）`)
    }
  }

  if (deps[PACKAGE_NAME] !== undefined) {
    console.log(`[ok] ${PACKAGE_NAME} 已在 dependencies（跳过）`)
  } else {
    deps[PACKAGE_NAME] = spec
    console.log(`[ok] dependencies += ${PACKAGE_NAME}: ${spec}`)
  }
  if (bundles.includes(PACKAGE_NAME)) {
    console.log(`[ok] ${PACKAGE_NAME} 已在 dsh.profile.bundles（跳过）`)
  } else {
    bundles.push(PACKAGE_NAME)
    console.log(`[ok] dsh.profile.bundles += ${PACKAGE_NAME}`)
  }
  writeManifest(manifest)
  installProfile()

  console.log('\n完成。重启 dsh web GUI（profile 层变更需要重启加载），刷新页面即可看到侧边栏「任务看板」入口。')
}

function unmount() {
  ensureProfile()
  const manifest = readManifest()
  const deps = manifest.dependencies ?? {}
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const names = [PACKAGE_NAME, ...LEGACY_PACKAGE_NAMES.filter((n) => n !== PACKAGE_NAME)]
  let changed = false

  for (const name of names) {
    if (deps[name] !== undefined) {
      delete deps[name]
      console.log(`[ok] dependencies -= ${name}`)
      changed = true
    } else {
      console.log(`· dependencies 无 ${name}（跳过）`)
    }
    const idx = bundles.indexOf(name)
    if (idx !== -1) {
      bundles.splice(idx, 1)
      console.log(`[ok] dsh.profile.bundles -= ${name}`)
      changed = true
    } else {
      console.log(`· dsh.profile.bundles 无 ${name}（跳过）`)
    }
  }

  if (changed) {
    writeManifest(manifest)
    installProfile()
  }

  console.log('\n完成。重启 dsh web GUI 后恢复原状；任务数据保留在 host 存储单元与浏览器（如需清除浏览器镜像：控制台执行 localStorage.removeItem("dsh.taskBoard.v1")）。')
}

function status() {
  ensureProfile()
  const manifest = readManifest()
  const deps = manifest.dependencies ?? {}
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const installed = fs.existsSync(path.join(PROFILE_DIR, 'node_modules', ...PACKAGE_NAME.split('/')))
  const legacyDeps = LEGACY_PACKAGE_NAMES.filter((n) => n !== PACKAGE_NAME && deps[n] !== undefined)
  console.log(`插件 id      : ${PLUGIN_ID}`)
  console.log(`包名         : ${PACKAGE_NAME}`)
  console.log(`仓库         : ${REPO}`)
  console.log(`dependencies : ${deps[PACKAGE_NAME] !== undefined ? `已声明 (${deps[PACKAGE_NAME]})` : '未声明'}`)
  console.log(`bundles      : ${bundles.includes(PACKAGE_NAME) ? '已列入 dsh.profile.bundles' : '未列入'}`)
  console.log(`node_modules : ${installed ? '已安装' : '未安装'} (${path.join(PROFILE_DIR, 'node_modules', ...PACKAGE_NAME.split('/'))})`)
  console.log(`lib/client.js: ${fs.existsSync(path.join(REPO, 'lib', 'client.js')) ? '已构建' : '未构建'}`)
  if (legacyDeps.length > 0) console.log(`提示         : 仍有旧的无作用域键 ${legacyDeps.join(', ')}，执行 mount 会自动迁移`)
}

const command = process.argv[2]
if (command === 'mount') mount()
else if (command === 'unmount') unmount()
else if (command === 'status') status()
else {
  console.error('用法: node scripts/dsh-task-board.js <mount|unmount|status>')
  process.exit(1)
}
