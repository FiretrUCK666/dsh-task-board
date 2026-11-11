// 真实会话日志长什么样：先把一条真的读进来，再决定还要量什么。
//
// ── 为什么要读真的 ────────────────────────────────────────────────────────────
//
// 前面几个探针全是**我造的内容**：每轮两条回复、每条六行、工具两次。它们全部零丢帧。
// 这只能说明「我造的这些东西不贵」，说明不了「读者的那些不贵」——而读者报的是「某些
// session 卡」，也就是**内容不一样**。
//
// 所以先不猜：读一条真的会话日志（宿主落盘的 jsonl，zstd 压缩），看它真实的形状——
// 一轮里到底有多少条事件、多少工具调用、多长的回答、有没有图。
//
// 用法：
//   node scripts/probes/inspect-real-session.mjs [--file <路径>]

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const LOG_NAME = 'session.v4.jsonl.zstd'
const MIN_BYTES = 200_000

/** 每一个会话日志：目录是两级（工作区 → 会话），所以走的是递归找。 */
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
        const stat = statSync(path)
        found.push({ path, size: stat.size, mtimeMs: stat.mtimeMs })
      } catch { /* skip */ }
    }
  }
  walk(root, 0)
  return found
}

/** The log is zstd or plain jsonl depending on how the host wrote it. */
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
    } catch { /* a torn tail line is normal */ }
  }
  return events
}

const args = process.argv.slice(2)
const fileArg = args.indexOf('--file')
const candidates = everyLog(join(homedir(), '.dsh', 'sessions')).filter(one => one.size >= MIN_BYTES)
candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
const path = fileArg >= 0 ? args[fileArg + 1] : candidates[0]?.path
if (path === undefined) {
  console.error('inspect-real-session: 找不到可读的会话日志')
  process.exit(1)
}

const events = readEvents(path)
const counts = new Map()
for (const entry of events) {
  const payload = entry?.data ?? entry?.event ?? entry
  const type = typeof payload?.type === 'string' ? payload.type : typeof entry?.type === 'string' ? entry.type : '(no type)'
  counts.set(type, (counts.get(type) ?? 0) + 1)
}

/** Per-turn shape: how many events of each kind land inside ONE turn. */
const perTurn = new Map()
let currentTurn
for (const entry of events) {
  const payload = entry?.data ?? entry?.event ?? entry
  const type = typeof payload?.type === 'string' ? payload.type : entry?.type
  if (type === 'turn/start' && payload?.turn !== undefined) currentTurn = payload.turn
  if (currentTurn === undefined) continue
  const bucket = perTurn.get(currentTurn) ?? new Map()
  const name = typeof type === 'string' ? type : '(none)'
  bucket.set(name, (bucket.get(name) ?? 0) + 1)
  perTurn.set(currentTurn, bucket)
}

/** How long is one assistant text block? That is what markdown parsing eats. */
const textLengths = []
for (const entry of events) {
  const payload = entry?.data ?? entry?.event ?? entry
  if (payload?.type !== 'assistant/message') continue
  const content = payload.message?.content
  if (!Array.isArray(content)) continue
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') textLengths.push(block.text.length)
  }
}
textLengths.sort((a, b) => b - a)

const ranked = [...perTurn.entries()]
  .map(([turn, bucket]) => ({ turn, total: [...bucket.values()].reduce((a, b) => a + b, 0), bucket }))
  .sort((a, b) => b.total - a.total)

console.log(`file      ${path}`)
console.log(`events    ${events.length}`)
console.log(`types     ${[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}=${v}`).join('  ')}`)
console.log(`turns     ${perTurn.size}`)
console.log('')
console.log('per-turn event counts (the heaviest five):')
for (const row of ranked.slice(0, 5)) {
  const detail = [...row.bucket.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ')
  console.log(`  turn ${row.turn}: ${row.total} events — ${detail}`)
}
console.log('')
console.log(`assistant text blocks ${textLengths.length}; longest ${textLengths[0] ?? 0} chars, median ${textLengths[Math.floor(textLengths.length / 2)] ?? 0}, total ${textLengths.reduce((a, b) => a + b, 0)}`)
