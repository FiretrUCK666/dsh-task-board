// 用**真实的会话事件**量折轮：一条真日志的一个窗口，折一次要多少毫秒、折出多少节点。
//
// ── 为什么必须用真的 ──────────────────────────────────────────────────────────
//
// 我造的内容是「每轮 2 条回复、3 次工具」。真实日志里**一个回合可以有 490 条
// `assistant/message`、545 次工具调用**。这两者的形状差一个数量级，所以用造的内容量出来的
// 0 不能推出真的也快。
//
// 这个脚本不猜、不造：它把一条真实会话日志的**尾部窗口**读出来，交给产品里同一份
// `foldTurns`，量三件事：
//
//   events   窗口里有多少条事件
//   ms       折一次要多少毫秒（这是 3 秒一次的轮询到达时付的钱）
//   turns    折出几轮
//   nodes    这些轮渲染出来大约多少个节点（`build` 出来的一棵树的元素数）
//
// 用法：
//   node scripts/probes/bench-real-window.mjs [--file <路径>] [--messages 30]

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
        const stat = statSync(path)
        found.push({ path, size: stat.size, mtimeMs: stat.mtimeMs })
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

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const messages = Number(argOf('--messages', '30'))

const { foldTurns } = await import('../../src/client/board/review-transcript.ts')

const candidates = everyLog(join(homedir(), '.dsh', 'sessions')).filter(one => one.size > 200_000)
candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
const limit = Number(argOf('--logs', '4'))

for (const candidate of candidates.slice(0, limit)) {
  const raw = readEvents(candidate.path)
  /* The host's own window rule: `maxMessages: 30` — count MESSAGES, not events. */
  const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])
  const typeOf = entry => {
    const payload = entry?.data ?? entry?.event ?? entry
    return typeof payload?.type === 'string' ? payload.type : entry?.type
  }
  let seen = 0
  let start = raw.length
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    if (MESSAGE_TYPES.has(typeOf(raw[index]))) {
      seen += 1
      if (seen >= messages) { start = index; break }
    }
    start = index
  }
  /* The transcript shape the client folds: `type` and `seq` ride the event, the
     payload sits under `data`. Stripping to `data` alone leaves `event.type`
     undefined and the fold produces nothing — which reads as a very fast fold. */
  const window = raw.slice(start).map(entry => ({
    type: entry.type,
    seq: entry.seq,
    time: entry.time,
    data: entry.data,
  }))

  /* Warm, then take the median of 7 — one sample would be noise. */
  let turns = foldTurns(window)
  const samples = []
  for (let run = 0; run < 7; run += 1) {
    const started = performance.now()
    turns = foldTurns(window)
    samples.push(performance.now() - started)
  }
  samples.sort((a, b) => a - b)

  /* What those turns cost to DRAW, measured without a browser: how much text and how
     many discrete items the renderer will walk. */
  let replies = 0
  let chars = 0
  let steps = 0
  for (const turn of turns) {
    for (const reply of turn.replies) { replies += 1; chars += reply.text.length }
    steps += turn.steps.length + turn.interjections.length
  }

  console.log(`${join(...candidate.path.split(/[\\/]/).slice(-2))}`)
  console.log(`  events ${window.length}  turns ${turns.length}  replies ${replies}  processItems ${steps}  chars ${chars}`)
  console.log(`  foldTurns median ${samples[3].toFixed(2)} ms  max ${samples[6].toFixed(2)} ms`)
  console.log('')
}
