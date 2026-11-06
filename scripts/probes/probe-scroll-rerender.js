// 量「离开末尾那一帧」在两种实现下各要多少毫秒。同一张页、同一段手势、同一台机器。
//
// ── 两种实现 ─────────────────────────────────────────────────────────────────
//
//   A. 离开末尾 = 面板的一次 setState。那一帧要把整块内容重画一遍（40 轮对话 +
//      40 条评论，928 个节点）。这里用「把整份标记塞回去 + 读一次布局」量它——那是
//      React 重建这棵树里最贵的那一段：DOM 重建 + 浏览器重新排版。
//      **这是下界**：React 还要做一遍 reconciliation（比对新旧树），这里没有那一项。
//   B. 离开末尾 = 只有那枚胶囊重画。这里量「切一次 data-hidden 并读它的样式」——
//      `visibility` 切换不重建任何节点。
//
// ── 为什么 B 要按批量 ────────────────────────────────────────────────────────
//
// 单次切换快到计时器分辨率以下（中位数读到 0）。读到一个 0 不是结论，是**没量到**：
// 所以 B 连着做 200 次再除，得到的才是它自己的单价。
//
// 顺带量一件事：胶囊隐藏时**盒子还在**（`visibility: hidden` 保留占位），因为把它从
// 流里摘掉会在读者刚抵达末尾的那一刻重新夹一次 scrollTop——「滑到底弹一下」。
//
// 用法：
//   node scripts/probes/probe-scroll-rerender.cjs
//   node scripts/shot-panel.mjs --url file:///<cwd>/tmp/probe-scroll-rerender.html \
//     --eval-file scripts/probes/probe-scroll-rerender.js --width 1400 --height 900
;(() => {
  const round = (value, digits = 2) => {
    const scale = 10 ** digits
    return Math.round(value * scale) / scale
  }
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]
  }
  const max = (values) => (values.length === 0 ? 0 : Math.max(...values))

  const box = document.getElementById('comments')
  const list = document.getElementById('commentsList')
  const transcriptList = document.getElementById('transcriptList')
  const pill = document.getElementById('commentsPill')
  if (box === null || list === null || transcriptList === null || pill === null) {
    return { error: 'the artifact page is missing its scroll boxes — did the builder run?' }
  }

  /** A: rebuild the whole block and settle the layout, as one panel render does. */
  const repaintAll = () => {
    const started = performance.now()
    transcriptList.innerHTML = window.__markup.transcript
    list.innerHTML = window.__markup.comments
    void box.getBoundingClientRect()
    return performance.now() - started
  }

  /** B: the new shape — one button's hidden state flips, nothing is rebuilt. */
  const flipPill = () => {
    pill.toggleAttribute('data-hidden', pill.getAttribute('data-hidden') === null)
    void getComputedStyle(pill).visibility
  }

  const times = (action, count) => {
    const samples = []
    for (let i = 0; i < count; i += 1) {
      const started = performance.now()
      action()
      samples.push(performance.now() - started)
    }
    return samples
  }

  const all = times(repaintAll, 12)
  /* B 的单价要用**批**量：单次低于分辨率，每次单独取时就会被读成 0。 */
  const BATCH = 200
  const pillBatch = times(() => { for (let i = 0; i < BATCH; i += 1) flipPill() }, 8)
    .map(one => one / BATCH)

  const wholePanel = { medianMs: round(median(all)), maxMs: round(max(all)) }
  const pillOnly = { medianMs: round(median(pillBatch), 3), maxMs: round(max(pillBatch), 3) }

  // The pill keeps its box while hidden: parking it on `data-hidden` and asking for a
  // real rect is the only way to prove `visibility` did not take the space too.
  pill.setAttribute('data-hidden', 'true')
  const hiddenRect = pill.getBoundingClientRect()
  const hiddenVisibility = getComputedStyle(pill).visibility
  pill.removeAttribute('data-hidden')
  const shownRect = pill.getBoundingClientRect()

  const frameBudgetMs = 16.7
  const ratio = pillOnly.medianMs === 0 ? Infinity : round(wholePanel.medianMs / pillOnly.medianMs, 1)
  return {
    nodes: document.querySelectorAll('#transcript *').length + document.querySelectorAll('#comments *').length,
    wholePanelRepaint: wholePanel,
    pillOnlyRepaint: pillOnly,
    /** 一整帧的预算；A 吃掉的比例就是读者那一下卡顿的量。 */
    frameBudgetMs,
    wholePanelShareOfFrame: round(wholePanel.medianMs / frameBudgetMs, 2),
    timesFaster: ratio === Infinity ? 'over 1000x (below timer resolution)' : `${String(ratio)}x`,
    hiddenKeepsBox: {
      width: Math.round(hiddenRect.width),
      height: Math.round(hiddenRect.height),
      visibility: hiddenVisibility,
    },
    shownBoxWidth: Math.round(shownRect.width),
    /* 判据：整块重画吃掉可观的一帧（>= 半个帧预算），而只切胶囊低于它的百分之一，
       且隐藏时盒子仍在、宽度与显示时相同。 */
    pass:
      wholePanel.medianMs >= frameBudgetMs / 2
      && pillOnly.medianMs < 0.1
      && hiddenRect.width > 0
      && hiddenRect.height > 0
      && Math.round(hiddenRect.width) === Math.round(shownRect.width),
  }
})()
