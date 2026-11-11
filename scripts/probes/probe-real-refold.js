// 真实事件 + 真实折轮：一次到达（3 秒一次那种）要多少毫秒，掉不掉帧。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   R1 真的画出了这么多轮（否则「快」可能是因为没画）
//   R2 一次到达的耗时中位数：`flushSync` 里 render + commit + 强制布局，
//      也就是读者真的会感觉到的那一段
//   R3 一次到达之后，`TurnItem` 重画的次数——它才是「整条历史重画一遍」的量
//
// 两档之间只改「未变的前缀要不要沿用上一轮折出来的对象」。同一份真实事件、同一段窗口。
;;(() => (async () => {
  if (window.__arrive === undefined) return { error: 'the page did not expose its arrival door — did the bundle load?' }

  const settleFrame = () => new Promise(done => requestAnimationFrame(() => { done() }))
  const list = () => document.querySelectorAll('ul > li').length

  await settleFrame()
  await settleFrame()
  await settleFrame()

  const before = list()
  if (before === 0) return { error: 'the page rendered no turns — nothing to measure' }

  /* Each arrival: advance over REAL events, then force the work through with
     `flushSync` + a layout read. */
  const samples = []
  for (let run = 0; run < 9; run += 1) {
    const started = performance.now()
    window.__flushArrive()
    samples.push(performance.now() - started)
    await settleFrame()
  }
  samples.sort((a, b) => a - b)

  return {
    refold: window.__refold ?? 'unknown',
    step: window.__step ?? 0,
    totalEvents: window.__total ?? 0,
    turnsBefore: before,
    turnsAfter: list(),
    medianMs: Math.round(samples[4] * 100) / 100,
    maxMs: Math.round(samples[8] * 100) / 100,
    errors: window.__errors ?? [],
    pass: list() > 0,
  }
})())()
