// 量三件「谁在反复做同一件事」的事实，全部在真页上数次数，不靠读源码猜：
//
//   1. 一段 40 帧的滚动手势里，`getComputedStyle` 被调用几次
//      （每次调用都要让引擎把待处理的样式算完——这是滚动路径上最贵的一类读取）
//   2. 页面里一共开了几个 `ResizeObserver`，各自观察了几个节点
//      （两个观察者盯同一个节点 = 每次尺寸变化读两遍布局）
//   3. 同一段手势里，最长的一帧是多少毫秒（掉帧的直接读数）
//
// 数次数比读源码可靠：源码里 `resolveScroller` 只写了一次，但它在每帧的回调里，
// 于是**每帧一次**。只有数出来的数字能区分「写了一次」和「每帧做一次」。
;(() => {
  const result = { computedStyleCalls: 0, observers: [], errors: window.__errors }
  if (typeof window.__counted === 'undefined') return { error: 'the page did not install the counters' }

  const scroller = document.getElementById('comments')
  if (scroller === null) return { error: 'no scroller on the page' }

  const nextFrame = () => new Promise(done => requestAnimationFrame(() => { done() }))
  const end = () => scroller.scrollHeight - scroller.clientHeight

  return (async () => {
    scroller.scrollTop = end()
    await nextFrame()
    await nextFrame()

    /* 一段真手势：从末尾往上拉 20 格，再拉回 20 格。每一格之间等一帧，所以帧间隔
       就是这一格的真实耗时；一帧预算 16.7ms，超过它就是一帧没画出来。 */
    const gaps = []
    let last = performance.now()
    const afterFrame = async () => {
      await nextFrame()
      const now = performance.now()
      gaps.push(now - last)
      last = now
    }

    const before = window.__counted.getComputedStyle
    last = performance.now()
    for (let i = 0; i < 20; i += 1) {
      scroller.scrollTop = Math.max(0, scroller.scrollTop - 60)
      await afterFrame()
    }
    for (let i = 0; i < 20; i += 1) {
      scroller.scrollTop = Math.min(end(), scroller.scrollTop + 60)
      await afterFrame()
    }
    await afterFrame()

    result.computedStyleCalls = window.__counted.getComputedStyle - before
    result.frames = gaps.length

    // 帧时去掉首帧（它含着上一段准备工作）。
    const measured = gaps.slice(1)
    const sorted = [...measured].sort((a, b) => a - b)
    result.frameMedianMs = Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100
    result.frameP95Ms = Math.round(sorted[Math.floor(sorted.length * 0.95)] * 100) / 100
    result.frameWorstMs = Math.round(sorted[sorted.length - 1] * 100) / 100
    /* A MISSED DEADLINE IS NOT "OVER 16.7ms".
     *
     * rAF fires ON the vsync boundary, so half the frames land at 16.7 + a few
     * decimal places with nothing wrong at all — counting those as jank measures
     * the timer, not the work. A frame that actually could not be painted costs a
     * whole extra vsync, so it reads as ≳ 2x the interval. That is the number worth
     * reporting, and this is the mistake the first version of this probe made. */
    result.missedFrames = measured.filter(gap => gap > 25).length

    result.observers = window.__counted.observers
    result.observedNodes = window.__counted.observedNodes
    // 判据一：滚动帧里不许解析滚动根（那要读一次计算样式）。
    result.passStyle = result.computedStyleCalls === 0
    // 判据二：一个滚动区只需要一个观察者。
    result.passObserver = window.__counted.observers === 1
    // 判据三：这段手势里真正掉帧的不超过两帧（无头浏览器本身有抖动）。
    result.passFrames = result.missedFrames <= 2
    return result
  })()
})()

