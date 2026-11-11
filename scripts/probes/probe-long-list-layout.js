// 一条长列表的一段手势：掉几帧、一次布局多少钱、多少行真的被排版了。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   L1 列表真的能滚，手势真的滚开了
//   L2 超过两帧预算的帧数（读者的「掉帧」）
//   L3 一段手势之后强制读一次布局要多少毫秒（这是「未归因主线程耗时」的形状）
//   L4 有多少行真的被排版了——用 `content-visibility: auto` 的行会读作不在渲染树里
//
// 三档同一份内容、同一段手势，只改「视口外的行要不要排版」。
;;(() => (async () => {
  const box = document.getElementById('scroller')
  const list = document.getElementById('list')
  if (box === null || list === null) return { error: 'the page did not render its list — did the bundle load?' }

  const frame = () => new Promise(done => requestAnimationFrame(() => { done() }))
  const longTasks = []
  let observing = false
  try {
    const observer = new PerformanceObserver((entryList) => {
      if (!observing) return
      for (const entry of entryList.getEntries()) longTasks.push(Math.round(entry.duration))
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch { /* unsupported */ }

  await frame()
  await frame()
  await frame()

  const rows = Array.from(list.children)
  if (rows.length === 0) return { error: 'the list rendered no rows' }
  const scrollable = box.scrollHeight - box.clientHeight
  if (scrollable <= 0) return { error: 'the list does not scroll' }

  /* How many rows the engine actually has in the rendering tree. `checkVisibility`
     asks the engine, not a class name. */
  const visibleRows = rows.filter(row => typeof row.checkVisibility === 'function'
    ? row.checkVisibility()
    : row.getBoundingClientRect().height > 0).length

  /* ── one forced layout, timed ───────────────────────────────────────────────
   * The page has just been touched (a style write), so the next layout read has to
   * finish everything pending. That is exactly the "unattributed main-thread time"
   * the reader's trace shows as its largest entry. */
  list.style.setProperty('--probe-touch', '1')
  const beforeLayout = performance.now()
  void box.scrollHeight
  const layoutOnceMs = Math.round((performance.now() - beforeLayout) * 100) / 100

  const gaps = []
  box.scrollTop = 0
  await frame()
  const startTop = box.scrollTop
  let highest = startTop
  observing = true
  let previous = performance.now()
  for (let step = 0; step < 120; step += 1) {
    box.scrollTop = Math.min(scrollable, box.scrollTop + 60)
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
    mode: window.__mode ?? 'unknown',
    rows: rows.length,
    laidOutRows: visibleRows,
    nodes: document.getElementsByTagName('*').length,
    scrollable,
    highestTop: highest,
    layoutOnceMs,
    frames: trimmed.length,
    medianFrameMs: sorted[Math.floor(sorted.length / 2)],
    worstFrameMs: sorted[sorted.length - 1],
    droppedFrames: dropped.length,
    longTasks,
    errors: window.__errors ?? [],
    pass: highest > startTop && dropped.length <= 2,
  }
})())()
