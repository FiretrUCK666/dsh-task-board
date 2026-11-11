// 滚动条是自定义画的，还是引擎画的：同样负载、同样手势，两种画法各掉多少帧。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   B1 手势真的滚开了
//   B2 超过两帧预算的帧数（内容与跳动条的合成结果）
//   B3 帧间隔的标准差——「一抽一抽」是**抖动**，不是单纯的平均变慢，所以只看中位数
//      会把这一条完全漏掉
//   B4 `longtask` 条数
//
// 两档之间只改滚动条的画法（`data-bar`），内容、尺寸、每帧主线程负载都一样。
;;(() => (async () => {
  const box = document.getElementById('scroller')
  if (box === null) return { error: 'the page did not render its scroller' }

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
  if (scrollable <= 0) return { error: 'the scroller does not scroll' }
  /* What the engine decided to do with the bar: a custom bar is painted into the
     scroller's own picture, a native one gets its own compositor layer. */
  const gutters = getComputedStyle(box).scrollbarGutter

  const gaps = []
  box.scrollTop = 0
  await frame()
  const startTop = box.scrollTop
  let highest = startTop
  observing = true
  let previous = performance.now()
  for (let step = 0; step < 150; step += 1) {
    box.scrollTop = Math.min(scrollable, box.scrollTop + 36)
    highest = Math.max(highest, box.scrollTop)
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
  const mean = trimmed.reduce((sum, gap) => sum + gap, 0) / trimmed.length
  const variance = trimmed.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / trimmed.length

  return {
    bar: window.__bar ?? 'unknown',
    loadMs: window.__loadMs ?? 0,
    gutter: gutters,
    frames: trimmed.length,
    scrollable,
    highestTop: highest,
    medianFrameMs: sorted[Math.floor(sorted.length / 2)],
    worstFrameMs: sorted[sorted.length - 1],
    jitterMs: Math.round(Math.sqrt(variance) * 100) / 100,
    droppedFrames: dropped.length,
    longTasks,
    errors: window.__errors ?? [],
    pass: highest > startTop && dropped.length <= 2,
  }
})())()
