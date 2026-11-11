// 读者那份 trace 指的方向：Rendering 910ms / Painting 567ms / 未归因 2,446ms。
//
// 前两样都不是「React 重算」，是**样式重算、排版、绘制**。我前面每一支探针量的都是
// React 那一层，所以全部读到 0——**我一直在量不贵的那一层**。
//
// 这一支不猜，直接问浏览器几件事：
//
//   A1 `document.getAnimations()` —— 此刻有多少个动画对象？其中多少个**正在跑**？
//        无限动画在合成线程上跑的话不该出现在这里；
//   A2 空闲的 2 秒里，有多少次动画帧回调、多少次样式重算；
//   A3 一层「谁在画」的清单：正在跑的动画按目标类名归类，数量从多到少。
//
// 判据只有一条：**空闲时不该有任何东西在持续重画。** 读者没有在操作页面的时候，
// 主线程和合成器都该是安静的。
;;(() => (async () => {
  const frame = () => new Promise(done => requestAnimationFrame(() => { done() }))

  /* ── A1: what is animating right now ─────────────────────────────────────── */
  const animations = document.getAnimations()
  const describe = (animation) => {
    const effect = animation.effect
    const target = effect === null || effect === undefined ? undefined : effect.target
    const element = target ?? undefined
    const name = element === undefined ? '(no target)'
      : `${element.tagName.toLowerCase()}.${String(element.className).split(' ').filter(Boolean).join('.')}`
    return { state: animation.playState, name }
  }
  const listed = animations.map(describe)
  const running = listed.filter(one => one.state === 'running')

  /** Group by class so the count reads as 「这一族有几个」. */
  const byName = new Map()
  for (const one of running) byName.set(one.name, (byName.get(one.name) ?? 0) + 1)
  const heaviest = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)

  /* ── A2: is the page idle when nobody is touching it? ────────────────────── */
  let frames = 0
  let counting = true
  const tick = () => { if (counting) { frames += 1; requestAnimationFrame(tick) } }
  requestAnimationFrame(tick)

  /* Long tasks during the idle window: anything above 50ms means the main thread
     was doing work while the reader did nothing. */
  const longTasks = []
  let observing = true
  try {
    const observer = new PerformanceObserver((list) => {
      if (!observing) return
      for (const entry of list.getEntries()) longTasks.push(Math.round(entry.duration))
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch { /* unsupported */ }

  const startedAt = performance.now()
  while (performance.now() - startedAt < 2000) await frame()
  counting = false
  observing = false

  /* ── A3: the shapes that make a scroller expensive ───────────────────────── */
  const scrollers = []
  for (const element of document.querySelectorAll('*')) {
    const style = getComputedStyle(element)
    if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue
    scrollers.push({
      name: `${element.tagName.toLowerCase()}.${String(element.className).split(' ').filter(Boolean)[0] ?? ''}`,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      children: element.childElementCount,
      // A custom bar is painted into the scroller's own picture; a native one gets
      // its own compositor layer. `scrollbar-width` is what a page can read back.
      customBar: style.getPropertyValue('scrollbar-width') === 'none' || style.width !== '',
      contain: style.contain,
      contentVisibility: style.contentVisibility,
      animations: element.getAnimations().length,
    })
  }

  return {
    animationsTotal: animations.length,
    animationsRunning: running.length,
    heaviest,
    idleFrames: frames,
    idleMs: Math.round(performance.now() - startedAt),
    idleLongTasks: longTasks,
    nodes: document.getElementsByTagName('*').length,
    scrollers: scrollers.slice(0, 8),
    errors: window.__errors ?? [],
  }
})())()
