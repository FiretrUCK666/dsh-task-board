// 带图片的一段手势：掉几帧、长任务几条、图片怎么进 DOM。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   I1 该有的图片真的在屏上（否则「快」可能是因为没画）
//   I2 超过两帧预算的帧数（读者的「跳帧」）
//   I3 主线程上超过 50ms 的长任务（「卡」的定义）
//   I4 DOM 里承载图片字节的那部分有多长（`data:` 内联 vs 对象 URL）
//
// 同一份代码、同一段手势、同一张页，三次跑之间只改「图片怎么进 DOM」。所以 I2/I3 的差
// 就是那条路的价钱，而不是「内容多少」的价钱。
;;(() => (async () => {
  const box = document.getElementById('transcript')
  if (box === null) return { error: 'the page did not render a scroller — did the bundle load?' }

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

  const images = Array.from(document.querySelectorAll('img'))
  const decoded = images.filter(image => image.complete && image.naturalWidth > 0).length
  /* What the DOM actually carries for those pictures: the src attribute's length is
     what the engine had to keep in memory as a string, per image. */
  const srcChars = images.reduce((total, image) => total + (image.getAttribute('src')?.length ?? 0), 0)

  const scrollable = box.scrollHeight - box.clientHeight
  if (scrollable <= 0) return { error: 'the transcript does not scroll' }

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
    srcMode: window.__srcMode ?? 'unknown',
    images: images.length,
    decoded,
    srcChars,
    imageBytes: window.__bytes ?? 0,
    frames: trimmed.length,
    scrollable,
    startTop,
    lowestTop: lowest,
    medianFrameMs: sorted[Math.floor(sorted.length / 2)],
    worstFrameMs: sorted[sorted.length - 1],
    droppedFrames: dropped.length,
    longTasks,
    errors: window.__errors ?? [],
    pass: lowest < startTop && images.length > 0 === true && decoded === images.length && dropped.length <= 2,
  }
})())()
