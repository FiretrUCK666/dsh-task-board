// 祖先上的 `:has()` 在子树里每次样式失效时要多付多少钱。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   H1 面板真的画出来了，评论区真的能滚
//   H2 一次**强制样式重算**要多少毫秒（写一个自定义属性，再读一次 `getComputedStyle`）
//   H3 一段手势里掉了几帧
//
// H2 是关键：`getComputedStyle` 会逼引擎把所有待处理的样式失效算完，包括那条
// `:has()` 的重新求值。它不是一项精确的归因，但两档之间的差就是那条规则的价钱。
;;(() => (async () => {
  const box = document.getElementById('scroller')
  const view = document.querySelector('[data-dsh-taskboard-view]')
  if (box === null) return { error: 'the page did not render its scroller — did the bundle load?' }
  if (view === null) return { error: 'the page did not render its view root' }

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
  if (scrollable <= 0) return { error: 'the comments box does not scroll' }

  /* ── H2: one forced style recalc, ten times, median ────────────────────────
   * Writing a custom property on the view invalidates style for the whole subtree,
   * which is precisely the situation the `:has()` rule must re-answer. Reading
   * `getComputedStyle` on a deep node forces the engine to finish that work. */
  const recalc = []
  for (let run = 0; run < 10; run += 1) {
    view.style.setProperty('--probe-touch', String(run))
    const started = performance.now()
    void getComputedStyle(box).color
    recalc.push(performance.now() - started)
  }
  recalc.sort((a, b) => a - b)

  /* The same measurement with NO invalidation before it: the floor of the timer. */
  const floor = []
  for (let run = 0; run < 10; run += 1) {
    const started = performance.now()
    void getComputedStyle(box).color
    floor.push(performance.now() - started)
  }
  floor.sort((a, b) => a - b)

  /* ── H3: a real gesture ──────────────────────────────────────────────────── */
  const gaps = []
  box.scrollTop = 0
  await frame()
  const startTop = box.scrollTop
  let highest = startTop
  observing = true
  let previous = performance.now()
  for (let step = 0; step < 120; step += 1) {
    box.scrollTop = Math.min(scrollable, box.scrollTop + 48)
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
    useHas: window.__useHas === true,
    comments: window.__rows === undefined ? 0 : window.__rows(),
    nodes: document.getElementsByTagName('*').length,
    scrollable,
    recalcMs: Math.round(recalc[5] * 100) / 100,
    recalcMaxMs: Math.round(recalc[9] * 100) / 100,
    floorMs: Math.round(floor[5] * 1000) / 1000,
    frames: trimmed.length,
    highestTop: highest,
    medianFrameMs: sorted[Math.floor(sorted.length / 2)],
    droppedFrames: dropped.length,
    longTasks,
    errors: window.__errors ?? [],
    pass: highest > startTop && dropped.length <= 2,
  }
})())()
