// 一段真的手势：掉了几帧、主线程被占住了多久、持有 pin 的那一层重画几次。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   F1 评论区真的能滚，而且手势真的把它滚开了（记下期间到过的最小/最大偏移）
//   F2 整段手势里，**超过两帧预算**的那些帧有几帧（这是读者说的「跳帧」）
//   F3 主线程上超过 50ms 的长任务有几条（这是「卡」的定义）
//   F4 持有 pin 的那一层在这段手势里重画几次（滚动不许进 React）
//
// 两档（短 / 长）跑同一份代码，读数并列，所以「成本随什么增长」这个问题由数字回答。
;;(() => (async () => {
  const box = document.getElementById('comments')
  if (box === null) return { error: 'the page did not render its comments scroller — did the bundle load?' }
  const pill = document.querySelector('[class*="reviewJumpLatest"]')
  const draws = () => (window.__draws === undefined ? -1 : window.__draws())

  const frame = () => new Promise(done => requestAnimationFrame(() => { done() }))

  /* Long tasks: the browser's own definition of「主线程被占住了」. Collected for the
     duration of the gesture only — the mounting work is not part of what the reader
     feels while scrolling. */
  const longTasks = []
  let observing = false
  let observer
  try {
    observer = new PerformanceObserver((list) => {
      if (!observing) return
      for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration))
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch { /* not supported: the frame list below still answers the question */ }

  await frame()
  await frame()

  const scrollable = box.scrollHeight - box.clientHeight
  if (scrollable <= 0) {
    return { error: 'the comments box does not scroll — the page cannot show the state the reader reported' }
  }

  /* A gesture that looks like a hand: many small steps, one per frame, up and then
     back down. The box opens pinned at the end (that is the follow grammar), so the
     first half is the reader pulling AWAY from it — the reported gesture. */
  const frameGaps = []
  const startDraws = draws()
  const startTop = box.scrollTop
  let lowest = box.scrollTop
  observing = true
  let previous = performance.now()
  for (let step = 0; step < 90; step += 1) {
    const direction = step < 45 ? -1 : 1
    box.scrollTop = Math.max(0, Math.min(scrollable, box.scrollTop + direction * 40))
    lowest = Math.min(lowest, box.scrollTop)
    await frame()
    const now = performance.now()
    frameGaps.push(Math.round((now - previous) * 100) / 100)
    previous = now
  }
  observing = false
  observer?.disconnect()

  /* The first gap measures the wait before the loop's first frame, which includes
     the harness's own bookkeeping — drop it. */
  const gaps = frameGaps.slice(1)
  const BUDGET_MS = 32
  const dropped = gaps.filter(gap => gap > BUDGET_MS)
  const sorted = [...gaps].sort((a, b) => a - b)

  return {
    /* `li` only: the class prefix matches a row AND its three children. */
    commentRows: document.querySelectorAll('ul > li').length,
    scrollable,
    startTop,
    lowestTop: lowest,
    endTop: box.scrollTop,
    frames: gaps.length,
    medianFrameMs: sorted[Math.floor(sorted.length / 2)],
    worstFrameMs: sorted[sorted.length - 1],
    droppedFrames: dropped.length,
    worstGaps: [...dropped].sort((a, b) => b - a).slice(0, 5),
    longTasks,
    railRedraws: draws() - startDraws,
    pillVisible: pill === null ? 'missing' : pill.getAttribute('data-hidden') !== 'true',
    errors: window.__errors ?? [],
    pass: lowest < startTop && dropped.length <= 2 && (draws() - startDraws) === 0,
  }
})())()
