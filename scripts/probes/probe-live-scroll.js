// 真页上的滚动判据：一段手势里，持有 pin 的组件重画几次、胶囊露不露面。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   L1 从末尾往上拉的整段手势里，持有 pin 的组件重画 **0 次**（读了 N 次 `__draws`
//      前后差为 0）
//   L2 胶囊在同一段手势里从隐藏变显示（`data-hidden` 消失、`disabled` 为 false）
//   L3 拉回末尾时胶囊再藏起来，那个组件仍然重画 0 次
//
// L1 与 L2 必须**同时**成立：只做 L1 很容易（不更新就行了），只做 L2 就是原来那个
// 毛病（每帧重画）。两者一起成立才叫「该动的东西动了，不该动的没动」。
//
// ── 为什么每格之间等一帧 ──────────────────────────────────────────────────────
//
// 组件把测量合并在一个 `requestAnimationFrame` 里（一次手势几十个 scroll 事件只量
// 一次）。不等帧就等于在问「真实实现还没轮到的那一次」，量到的是 0。
;(() => {
  const scroller = document.getElementById('comments')
  const pill = document.querySelector('[class*="reviewJumpLatest"]')
  if (scroller === null || pill === null) {
    return { error: 'the live page did not render its scroller/pill — did the bundle load?' }
  }
  const draws = window.__draws
  if (draws === undefined) return { error: 'the live page did not expose __draws' }

  const nextFrame = () => new Promise(done => requestAnimationFrame(() => { done() }))
  const end = () => scroller.scrollHeight - scroller.clientHeight
  const shown = () => pill.getAttribute('data-hidden') !== 'true'

  return (async () => {
    // 落到末尾（并让跟随把位置稳住），这里胶囊该藏着。
    scroller.scrollTop = end()
    await nextFrame()
    await nextFrame()
    const startShown = shown()
    const startDraws = draws.panel

    /* 读者的那一下：从末尾往上拉 20 格。这就是报告里「在底部往上一滑」的那一段。 */
    for (let i = 0; i < 20; i += 1) {
      scroller.scrollTop = Math.max(0, scroller.scrollTop - 60)
      await nextFrame()
    }
    const afterUp = { draws: draws.panel, shown: shown(), distance: end() - scroller.scrollTop }

    for (let i = 0; i < 20; i += 1) {
      scroller.scrollTop = Math.min(end(), scroller.scrollTop + 60)
      await nextFrame()
    }
    await nextFrame()
    const afterDown = { draws: draws.panel, shown: shown(), distance: end() - scroller.scrollTop }

    return {
      startShown,
      afterUp,
      afterDown,
      /* L1 / L3 合起来是一句话：整段来回手势，持有 pin 的组件一次都没重画。 */
      panelRedraws: afterDown.draws - startDraws,
      pillShowedWhileAway: afterUp.shown,
      pillHiddenBackAtEnd: afterDown.shown === false,
      pass:
        startShown === false
        && afterUp.shown === true
        && afterDown.shown === false
        && afterDown.draws - startDraws === 0,
    }
  })()
})()
