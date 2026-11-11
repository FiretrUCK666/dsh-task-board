// 会话面板在「新内容不断到达」时的一段手势：掉几帧、有没有长任务。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   P1 面板真的画出了对话与评论两块，而且对话区真的能滚
//   P2 整段手势里，超过两帧预算的帧数（读者的「跳帧」）
//   P3 每个超过 32ms 的帧，当时是不是正好有一次内容到达
//
// 第三条是这一页的重点：它把「卡」和「轮询」这两件事**对到一起**。手势期间每
// ARRIVAL_MS 手动触发一次内容到达（与产品里 3 秒一次的轮询同一个形状），并记下每次到达
// 的时刻；凡是落在某次到达之后 200ms 内的坏帧，都算在那一次到达头上。
//
// 于是同一个读数在两种配置下可直接对比（`?poll=0` 与 `?poll=1`）：差出来的就是
// 「正在跑」这件事的价钱，而不是「内容有多少」的价钱。
;;(() => (async () => {
  const transcript = document.getElementById('transcript')
  const comments = Array.from(document.querySelectorAll('[class*="commentsScroll"]'))[0]
  if (transcript === null) return { error: 'the page did not render its transcript — did the bundle load?' }
  if (comments === undefined) return { error: 'the page did not render a comments scroller' }

  const frame = () => new Promise(done => requestAnimationFrame(() => { done() }))
  const longTasks = []
  let observing = false
  try {
    const observer = new PerformanceObserver((list) => {
      if (!observing) return
      for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration))
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch { /* unsupported */ }

  await frame()
  await frame()
  await frame()

  const polling = window.__polling === true
  const pollOnce = window.__pollOnce
  if (polling && pollOnce === undefined) return { error: 'the page said it polls but exposed no arrival door' }

  /* Scroll the CONVERSATION while content keeps arriving. The conversation is the
     box whose content changes under the reader; the comments box is measured too
     because the reader reported it, but the gesture targets one box at a time. */
  const box = transcript
  const scrollable = box.scrollHeight - box.clientHeight
  if (scrollable <= 0) return { error: 'the conversation does not scroll' }

  const ARRIVAL_MS = 500
  const DURATION_MS = 6000
  const arrivals = []
  const frameGaps = []
  box.scrollTop = scrollable
  await frame()
  const startTop = box.scrollTop
  let lowest = startTop

  observing = true
  const started = performance.now()
  let nextArrival = started + ARRIVAL_MS
  let previous = started
  let ended = false
  while (!ended) {
    const now = performance.now()
    if (now - started >= DURATION_MS) ended = true
    /* Pull away from the end, slowly, the way a reader going back over the
       conversation does — while new rounds keep landing below. */
    box.scrollTop = Math.max(0, box.scrollTop - 40)
    lowest = Math.min(lowest, box.scrollTop)
    if (polling && performance.now() >= nextArrival) {
      nextArrival += ARRIVAL_MS
      arrivals.push(Math.round(performance.now() - started))
      pollOnce()
    }
    await frame()
    const after = performance.now()
    frameGaps.push({ at: Math.round(after - started), ms: Math.round((after - previous) * 100) / 100 })
    previous = after
  }
  observing = false

  const gaps = frameGaps.slice(1)
  const BUDGET_MS = 32
  const dropped = gaps.filter(gap => gap.ms > BUDGET_MS)
  const sorted = gaps.map(gap => gap.ms).sort((a, b) => a - b)
  /* Attribute each bad frame to the arrival it follows (within 200ms). */
  const blamedOnArrival = dropped.filter(gap => arrivals.some(at => gap.at >= at && gap.at - at <= 200)).length

  return {
    polling,
    frames: gaps.length,
    arrivals: arrivals.length,
    scrollable,
    startTop,
    lowestTop: lowest,
    medianFrameMs: sorted[Math.floor(sorted.length / 2)],
    worstFrameMs: sorted[sorted.length - 1],
    droppedFrames: dropped.length,
    blamedOnArrival,
    worstGaps: [...dropped].map(gap => ({ at: gap.at, ms: gap.ms })).sort((a, b) => b.ms - a.ms).slice(0, 6),
    longTasks,
    commentsScrollable: comments.scrollHeight - comments.clientHeight,
    errors: window.__errors ?? [],
    pass: lowest < startTop && dropped.length <= 2,
  }
})())()
