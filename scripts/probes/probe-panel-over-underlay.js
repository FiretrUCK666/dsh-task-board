// 会话面板压在别人身上滚动：掉几帧、长任务几条。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   U1 面板真的画出来了，对话区真的能滚，而且手势真的把它滚开了
//   U2 超过两帧预算的帧数（读者的「跳帧」）
//   U3 主线程上超过 50ms 的长任务条数（「卡」）
//
// 这一页的同一份代码在两档下跑（`?under=paint` 与 `?under=skip`），两档之间只改**下面
// 那一层**的绘制行为。所以 `U2`/`U3` 的差就是「压在别人身上滚动」的价钱，而不是
// 「内容有多少」的价钱——这正是读者说「不是因为里面加载的东西太多」时指向的那件事。
;;(() => (async () => {
  const under = document.getElementById('underlay')
  const box = document.getElementById('transcript')
  if (box === null) return { error: 'the page did not render its transcript — did the bundle load?' }
  if (under === null) return { error: 'the page did not render a layer beneath the panel' }

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

  const scrollable = box.scrollHeight - box.clientHeight
  if (scrollable <= 0) return { error: 'the conversation does not scroll' }

  /* What the layer beneath actually costs: its own node count, and whether the
     engine decided it can skip it. */
  const underNodes = under.getElementsByTagName('*').length
  const underVisibility = getComputedStyle(under).contentVisibility

  const gaps = []
  box.scrollTop = scrollable
  await frame()
  const startTop = box.scrollTop
  let lowest = startTop
  observing = true
  let previous = performance.now()
  for (let step = 0; step < 120; step += 1) {
    box.scrollTop = Math.max(0, box.scrollTop - 40)
    lowest = Math.min(lowest, box.scrollTop)
    await frame()
    const now = performance.now()
    gaps.push(Math.round((now - previous) * 100) / 100)
    previous = now
  }
  observing = false

  const trimmed = gaps.slice(1)
  const BUDGET_MS = 32
  const dropped = trimmed.filter(gap => gap > BUDGET_MS)
  const sorted = [...trimmed].sort((a, b) => a - b)

  return {
    under: window.__under ?? 'unknown',
    underNodes,
    underVisibility,
    frames: trimmed.length,
    scrollable,
    startTop,
    lowestTop: lowest,
    medianFrameMs: sorted[Math.floor(sorted.length / 2)],
    worstFrameMs: sorted[sorted.length - 1],
    droppedFrames: dropped.length,
    longTasks,
    errors: window.__errors ?? [],
    pass: lowest < startTop && dropped.length <= 2 && longTasks.length === 0,
  }
})())()
