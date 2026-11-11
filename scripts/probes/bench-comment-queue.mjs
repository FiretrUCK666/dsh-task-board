// 评论行的排队位次：逐行各算一遍（今天）对一次算一张表（改法），同一份数据。
//
// ── 为什么必须重做这一条 ──────────────────────────────────────────────────────
//
// 上一版拿浏览器量这件事，量出来 0.2ms，而纯函数在 jsdom 里是 16ms。差别不在机器：
// 那一版每次都把**同样的条数**重新渲染一遍，`CommentsThread` 的 memo 按值比对，判定
// 「没变」就整条跳过了——**它量到的是「什么都没做」**。
//
// 所以这一支改成量**渲染函数自己**：同一条 thread、同一张 task，直接循环调用
// 每行都要调的那个函数，量 n 次的总价。这是渲染里真正付的钱，与 React 无关。
//
// 用法：
//   node scripts/probes/bench-comment-queue.mjs

const { queuePositionOf } = await import('../../src/client/board/comment-thread.ts')
const { newCommentRound, createTask, startExecution } = await import('../../src/core/tasks.ts')

const AT = 1_700_000_000_000

/** 一张卡：一次执行 + n 条评论回合（其中前四分之一已经结算）。 */
function taskWith(n) {
  const opened = startExecution(
    createTask({ title: 't', description: '', prompt: 'p', status: 'todo' }, AT, 'task-1'),
    AT + 1,
    'run-1',
  )
  const rounds = []
  for (let index = 0; index < n; index += 1) {
    const round = newCommentRound({
      id: `comment-${index}`,
      now: AT + 2 + index,
      text: 'x',
      sessionId: 'sess-1',
      parentExecutionId: 'run-1',
    })
    /* A quarter of them have settled, which is what a live session looks like. */
    rounds.push(index % 4 === 0 ? { ...round, endedAt: AT + 3 + index } : round)
  }
  return { ...opened.task, executions: [...opened.task.executions, ...rounds] }
}

/** 今天：每一行自己算一次（`CommentsThread` 的渲染体里就是这么调的）。 */
function rowByRow(task, ids) {
  let sink = 0
  for (const id of ids) sink += queuePositionOf(task, id)
  return sink
}

/** 改法：一张 lane 一张表，一次算完，逐行只查。 */
function oneTable(task, ids) {
  const lanes = new Map()
  for (const round of task.executions) {
    if (round.comment === undefined) continue
    if (round.endedAt !== undefined || round.injectedAt !== undefined || round.external === true) continue
    const lane = round.sessionId ?? round.sessionAnchor
    const bucket = lanes.get(lane) ?? []
    bucket.push(round)
    lanes.set(lane, bucket)
  }
  const positions = new Map()
  for (const bucket of lanes.values()) {
    bucket.sort((a, b) => a.startedAt - b.startedAt)
    for (let index = 0; index < bucket.length; index += 1) positions.set(bucket[index].id, index + 1)
  }
  let sink = 0
  for (const id of ids) sink += positions.get(id) ?? 0
  return sink
}

const median = samples => {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

console.log('comments  executions  rowByRow(ms)  oneTable(ms)  ratio')
for (const n of [50, 100, 200, 400, 800]) {
  const task = taskWith(n)
  const ids = task.executions.filter(round => round.comment !== undefined).map(round => round.id)
  /* Warm both, then take the median of 7 runs. */
  rowByRow(task, ids)
  oneTable(task, ids)
  const rows = []
  const tables = []
  for (let run = 0; run < 7; run += 1) {
    let started = performance.now()
    rowByRow(task, ids)
    rows.push(performance.now() - started)
    started = performance.now()
    oneTable(task, ids)
    tables.push(performance.now() - started)
  }
  const row = median(rows)
  const table = median(tables)
  console.log(
    `${String(n).padStart(8)}  ${String(task.executions.length).padStart(10)}  `
    + `${row.toFixed(2).padStart(13)}  ${table.toFixed(2).padStart(12)}  ${(row / Math.max(table, 0.001)).toFixed(1)}x`,
  )
}
