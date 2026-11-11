// 一条真实事件长什么样：把形状打出来，而不是照我记忆里的字段去读。
//
// 上一个探针（`inspect-real-session.mjs`）已经把量级说清楚了：**一个真实回合可以有
// 490 条 `assistant/message`、545 次工具调用**。但它的「回答有多长」那一栏读成了 0，
// 说明我按记忆里的字段名去读是错的——而**猜字段名正是这个项目里反复出现的那类错误**。
//
// 所以这一条只做一件事：把指定类型的头几条事件原样打出来（键名与值的形状），照着真的读。
//
// 用法：
//   node scripts/probes/inspect-event-shape.mjs --type assistant/message --count 2
//   node scripts/probes/inspect-event-shape.mjs --type tool/call --count 3

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const LOG_NAME = 'session.v4.jsonl.zstd'

function everyLog(root) {
  const found = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path, depth + 1)
        continue
      }
      if (!entry.name.startsWith(LOG_NAME)) continue
      try {
        found.push({ path, size: statSync(path).size, mtimeMs: statSync(path).mtimeMs })
      } catch { /* skip */ }
    }
  }
  walk(root, 0)
  return found
}

function readEvents(path) {
  const raw = readFileSync(path)
  const looksZstd = raw[0] === 0x28 && raw[1] === 0xb5 && raw[2] === 0x2f && raw[3] === 0xfd
  const text = (looksZstd ? zstdDecompressSync(raw) : raw).toString('utf8')
  const events = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      events.push(JSON.parse(trimmed))
    } catch { /* torn tail */ }
  }
  return events
}

/** 「某个字段有没有、是什么形状」——递归看键，不打印值（值可能是几十万字符）。 */
function shapeOf(value, depth = 0, key = '') {
  if (depth > 4) return '…'
  if (Array.isArray(value)) {
    const inner = value.length === 0 ? '' : `${shapeOf(value[0], depth + 1)} x${value.length}`
    return `[${inner}]`
  }
  if (value === null) return 'null'
  if (typeof value === 'string') return `${key === '' ? '' : ''}string(${value.length})`
  if (typeof value === 'number' || typeof value === 'boolean') return `${typeof value}`
  if (typeof value === 'object') {
    const parts = Object.entries(value).map(([k, v]) => `${k}: ${shapeOf(v, depth + 1, k)}`)
    return `{ ${parts.join(', ')} }`
  }
  return typeof value
}

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const wanted = argOf('--type', 'assistant/message')
const count = Number(argOf('--count', '2'))

const candidates = everyLog(join(homedir(), '.dsh', 'sessions')).filter(one => one.size > 200_000)
candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
const path = argOf('--file', candidates[0]?.path)
if (path === undefined) {
  console.error('inspect-event-shape: 找不到可读的会话日志')
  process.exit(1)
}

const events = readEvents(path)
const typeOf = entry => {
  const payload = entry?.data ?? entry?.event ?? entry
  return typeof payload?.type === 'string' ? payload.type : entry?.type
}

let shown = 0
for (const entry of events) {
  if (typeOf(entry) !== wanted) continue
  console.log(`--- ${wanted} #${shown + 1} ---`)
  console.log(`envelope keys: ${Object.keys(entry).join(', ')}`)
  const payload = entry?.data ?? entry?.event ?? entry
  console.log(`payload:       ${shapeOf(payload)}`)
  console.log('')
  shown += 1
  if (shown >= count) break
}
if (shown === 0) console.log(`(this log has no ${wanted} event)`)
