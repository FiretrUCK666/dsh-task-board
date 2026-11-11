// 仪器自检：故意变慢的一页上，同样的量法必须报出坏帧。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   S1 手势真的滚开了（否则后面两个数没有意义）
//   S2 `burn=0` 时坏帧为 0
//   S3 `burn=60` 时坏帧**必须**大于 0
//
// S3 是这一页存在的唯一理由。它红了，说明前面六个探针报的 0 不是仪器的盲区。
;;(() => (async () => {
  const box = document.getElementById('scroller')
  if (box === null) return { error: 'the page did not render its scroller' }
  const burnMs = window.__burnMs ?? 0
  const burn = window.__burn

  const frame = () => new Promise(done => requestAnimationFrame(() => {
    /* The burn lives INSIDE the rAF callback, which is where a real expensive
       render sits: it delays the frame the reader is waiting for. */
    burn(burnMs)
    done()
  }))

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

  const scrollable = box.scrollHeight - box.clientHeight
  if (scrollable <= 0) return { error: 'the page does not scroll' }

  const gaps = []
  box.scrollTop = 0
  await frame()
  const startTop = box.scrollTop
  let highest = startTop
  observing = true
  let previous = performance.now()
  for (let step = 0; step < 60; step += 1) {
    box.scrollTop = Math.min(scrollable, box.scrollTop + 40)
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

  return {
    burnMs,
    frames: trimmed.length,
    scrollable,
    highestTop: highest,
    medianFrameMs: sorted[Math.floor(sorted.length / 2)],
    worstFrameMs: sorted[sorted.length - 1],
    droppedFrames: dropped.length,
    longTasks,
    errors: window.__errors ?? [],
    pass: highest > startTop && (burnMs === 0 ? dropped.length === 0 : dropped.length > 0),
  }
})())()
