#!/usr/bin/env node
'use strict'

/**
 * dsh-task-board — one-command mount/unmount for the task-board GUI plugin.
 *
 * The plugin ships in the official profile-bundle shape: the local
 * package.json declares `dsh.bundle.patch` (this repo's cordis.patch.yml)
 * and `dsh.client`; mounting registers it in the web profile manifest
 * ($DSH_HOME/.dsh/profiles/web/package.json, dependencies + dsh.profile.bundles)
 * and runs pnpm install in the profile directory. Restarting the dsh web
 * GUI makes the bundle layer load; a page refresh then shows the sidebar
 * entry.
 *
 * mount   : add the profile-manifest dependency + bundle row, pnpm install.
 * unmount : remove both rows, pnpm install — the GUI fully reverts; task
 *           data stays in the browser (localStorage).
 * status  : report the current mount state.
 *
 * Only the profile manifest rows owned by this plugin are touched; other
 * other profile rows are left alone.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

// Resolve the DSH home root. DSH_HOME is authoritative and already points at
// the ~/.dsh directory itself (it may sit somewhere other than the user's
// home, and HOME is unset on Windows); fall back to ~/.dsh under os.homedir()
// for POSIX shells where only HOME is populated.
const DSH_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const PROFILE_DIR = path.join(DSH_HOME, 'profiles', 'web')
const PROFILE_MANIFEST = path.join(PROFILE_DIR, 'package.json')
const PLUGIN_ID = 'dsh-task-board'
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

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

  if (deps[PLUGIN_ID] !== undefined) {
    console.log(`[ok] ${PLUGIN_ID} 已在 dependencies（跳过）`)
  } else {
    deps[PLUGIN_ID] = spec
    console.log(`[ok] dependencies += ${PLUGIN_ID}: ${spec}`)
  }
  if (bundles.includes(PLUGIN_ID)) {
    console.log(`[ok] ${PLUGIN_ID} 已在 dsh.profile.bundles（跳过）`)
  } else {
    bundles.push(PLUGIN_ID)
    console.log(`[ok] dsh.profile.bundles += ${PLUGIN_ID}`)
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
  const changed = deps[PLUGIN_ID] !== undefined || bundles.includes(PLUGIN_ID)

  if (deps[PLUGIN_ID] !== undefined) {
    delete deps[PLUGIN_ID]
    console.log(`[ok] dependencies -= ${PLUGIN_ID}`)
  } else {
    console.log(`· dependencies 无 ${PLUGIN_ID}（跳过）`)
  }
  const idx = bundles.indexOf(PLUGIN_ID)
  if (idx !== -1) {
    bundles.splice(idx, 1)
    console.log(`[ok] dsh.profile.bundles -= ${PLUGIN_ID}`)
  } else {
    console.log(`· dsh.profile.bundles 无 ${PLUGIN_ID}（跳过）`)
  }
  if (changed) {
    writeManifest(manifest)
    installProfile()
  }

  console.log('\n完成。重启 dsh web GUI 后恢复原状；任务数据保留在浏览器 localStorage（如需清除：浏览器控制台执行 localStorage.removeItem("dsh.taskBoard.v1")）。')
}

function status() {
  ensureProfile()
  const manifest = readManifest()
  const deps = manifest.dependencies ?? {}
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const installed = fs.existsSync(path.join(PROFILE_DIR, 'node_modules', PLUGIN_ID))
  console.log(`插件 id    : ${PLUGIN_ID}`)
  console.log(`仓库       : ${REPO}`)
  console.log(`dependencies: ${deps[PLUGIN_ID] !== undefined ? `已声明 (${deps[PLUGIN_ID]})` : '未声明'}`)
  console.log(`bundles     : ${bundles.includes(PLUGIN_ID) ? '已列入 dsh.profile.bundles' : '未列入'}`)
  console.log(`node_modules: ${installed ? '已安装' : '未安装'} (${path.join(PROFILE_DIR, 'node_modules', PLUGIN_ID)})`)
  console.log(`lib/client.js: ${fs.existsSync(path.join(REPO, 'lib', 'client.js')) ? '已构建' : '未构建'}`)
}

const command = process.argv[2]
if (command === 'mount') mount()
else if (command === 'unmount') unmount()
else if (command === 'status') status()
else {
  console.error('用法: node scripts/dsh-task-board.js <mount|unmount|status>')
  process.exit(1)
}
