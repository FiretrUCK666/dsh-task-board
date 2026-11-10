// 把评论区滚到中段，然后量三件事——**这三件事都只在真组件里成立**。
//
// ── 为什么先滚再量 ────────────────────────────────────────────────────────────
//
// 读者报的现象是「上下滑动会很卡、移动条跳帧」。滑到中段是唯一能同时看到三件事的位置：
//
//   1. 滑块在轨道中段（不在顶部、也不在贴底时被隐藏）；
//   2. 胶囊露面（离开末尾才有「滑到最新」）；
//   3. 取消按钮在一屏之外也要能被点到（`onCancel` 换了归属，接错就按不动）。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   R1 评论区真的能滚（scrollHeight > clientHeight），且滚到了中段
//   R2 这段滚动没有让面板重画（`__draws` 前后差 0）——滚动不许进 React
//   R3 点击一条待发评论的取消真的走通了（`__cancelled` 收到那个 round id）
//
// R2 是这次改动的核心契约之一（滚动位置不是面板状态）；R3 钉的是「少了一根线之后
// 取消还活着」——那是删 prop 时最容易悄悄弄坏的东西。
;(() => {
  const box = document.getElementById('comments')
  if (box === null) return { error: 'the page did not render its comments scroller — did the bundle load?' }
  const pill = document.querySelector('[class*="reviewJumpLatest"]')

  const nextFrame = () => new Promise(done => requestAnimationFrame(() => { done() }))
  const draws = () => (window.__draws === undefined ? -1 : window.__draws())

  return (async () => {
    await nextFrame()
    await nextFrame()
    const startDraws = draws()
    const scrollable = box.scrollHeight - box.clientHeight
    if (scrollable <= 0) {
      return { error: 'the comments box does not scroll — the page cannot show the state the reader reported' }
    }

    box.scrollTop = Math.round(scrollable / 2)
    await nextFrame()
    await nextFrame()

    /* R2 —— 滚动本身不许让持有 pin 的那一层重画。 */
    const scrolledTo = box.scrollTop
    const pillVisible = pill === null ? 'missing' : pill.getAttribute('data-hidden') !== 'true'

    /* R3 —— 取消一条待发评论：点的是真按钮，读的是 controller 收到的 id。 */
    const cancel = [...document.querySelectorAll('[class*="reviewCommentCancel"]')][0]
    const before = (window.__cancelled ?? []).length
    if (cancel !== undefined) cancel.click()
    await nextFrame()
    const cancelled = (window.__cancelled ?? []).length - before

    return {
      scrollable,
      scrolledTo,
      scrollFraction: Math.round((scrolledTo / scrollable) * 100) / 100,
      pillVisible,
      panelRedrawsDuringScroll: draws() - startDraws,
      cancelHandled: cancelled,
      /* THE GEOMETRY IS PART OF THE EVIDENCE. A picture alone cannot say whether the
         panel got its 880px allowance or was cut to the generic 520px dialog width —
         and that difference is invisible in a thumbnail. Measured from the DOM, in
         CSS pixels, so the number and the picture can be read against each other. */
      panelBox: (() => {
        const panel = document.querySelector('[role="dialog"]')
        if (panel === null) return 'missing'
        const rect = panel.getBoundingClientRect()
        return { width: Math.round(rect.width), height: Math.round(rect.height) }
      })(),
      commentsBox: { clientHeight: Math.round(box.clientHeight), width: Math.round(box.getBoundingClientRect().width) },
      /* THE BAR MUST STILL BE OURS. A `scrollbar-width: none` anywhere upstream would
         leave the reader with no indicator at all, and a picture of a scroller with no
         bar reads as 「the page has no scrollbar rule」 rather than 「the rule was
         dropped」. `innerWidth - clientWidth` is the bar's lane, in CSS pixels. */
      barLanePx: Math.round(box.getBoundingClientRect().width - box.clientWidth),
      transcriptMissing: document.getElementById('transcript') === null,
      errors: window.__errors ?? [],
      /* 判据只覆盖这一页能回答的：滚到中段、胶囊露面、取消走通、滚动没重画。 */
      pass: scrolledTo > 0 && pillVisible === true && cancelled === 1 && draws() - startDraws === 0,
    }
  })()
})()
