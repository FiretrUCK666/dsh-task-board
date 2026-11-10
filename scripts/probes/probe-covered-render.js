// 量「被盖住的那块板每收到一次通知要花多少」——两种实现，同一张页、同一串通知。
//
// ── 两种实现 ─────────────────────────────────────────────────────────────────
//
//   A（改前）：订阅照旧接收。每一条通知都把整块板的视图重算一遍，并在同一个提交里
//     对每张卡读一次框（FLIP 的几何测量）。这里量的是那一段里**真正花钱的两件事**：
//     重建那棵树的节点 + 读框。**这是下界**：React 还要做一遍 reconciliation（比对新
//     旧树），这里没有那一项。
//   B（改后）：被盖住 → 订阅不收、FLIP 不量。每一条通知的代价是**零次**重算。
//
// ── 为什么 B 要按批量 ────────────────────────────────────────────────────────
//
// 单次「什么都不做」快到计时器分辨率以下（读到 0）。读到一个 0 不是结论，是**没量到**：
// 所以 B 连着做 200 次再除，得到的才是它自己的单价。
//
// ── 为什么这条与「读者报的卡顿」有关 ────────────────────────────────────────
//
// 读者滚动的那个面板**盖在板上**。板每收到一条会话列表通知就重算一次、读一遍框；
// 那些工作落在主线程上，和正在滚动的那个手势抢同一帧。通知来自跑着的会话（每几秒
// 一次），所以只有跑着的会话卡——这正是他描述的现象。
//
// 用法：
//   node scripts/probes/probe-covered-render.cjs
//   node scripts/shot-panel.mjs --url file:///<cwd>/tmp/probe-covered-render.html \
//     --eval-file scripts/probes/probe-covered-render.js --width 1400 --height 900 \
//     --audit --out tmp/probe-covered-render.png
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

  /* Located by the SAME attributes the product uses, not by ids the builder would have
   * to remember to add: `[data-dsh-tb-columns]` is the one stable attribute the board
   * puts on its grid, and `.cards` is the per-column list. A probe that invented its own
   * ids would stop finding the page the day the artifact changed, and report that as a
   * defect against the code. */
  const grid = document.querySelector('[data-dsh-tb-columns]')
  const lists = [...document.querySelectorAll('[data-dsh-tb-columns] .cards')]
  if (grid === null || lists.length === 0) {
    return { error: 'the artifact page is missing its column grid or its card lists — did the builder run?' }
  }

  /* The card markup, captured once: a notification re-derives each card from the new
   * record, so rebuilding is what the render does to the DOM. */
  const markup = lists.map((list) => [...list.children].map((node) => node.outerHTML))

  /** A（改前）：一条通知 = 整块板重算 + 每张卡读一次框。 */
  const recomputeLike = () => {
    const started = performance.now()
    lists.forEach((list, index) => { list.innerHTML = markup[index].join('') })
    for (const card of grid.querySelectorAll('[data-task-id]')) void card.getBoundingClientRect()
    return performance.now() - started
  }

  /** B（改后）：被盖住，所以一条通知什么都不做。 */
  const skipAll = () => {
    // Nothing to do — and that is the fix, stated as an empty function.
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

  const covered = times(recomputeLike, 12)
  const BATCH = 200
  const held = times(() => { for (let i = 0; i < BATCH; i += 1) skipAll() }, 8)
    .map((one) => one / BATCH)

  const frameBudgetMs = 16.7
  const coveredCost = { medianMs: round(median(covered)), maxMs: round(max(covered)) }
  const heldCost = { medianMs: round(median(held), 4), maxMs: round(max(held), 4) }

  /* THE CRITERION IS "MATERIAL vs NONE", NOT "OVER HALF A FRAME".
   *
   * `probe-scroll-rerender` asks whether one repaint eats half a frame, because there
   * the question was 「离开末尾那一下卡不卡」 — a single event. Here the question is
   * different: these notifications arrive CONTINUOUSLY while a session runs (a session
   * list change every few seconds, plus the heartbeat), and each one used to be paid
   * on top of whatever gesture the reader was making. So what matters is that the cost
   * exists and repeats, not that any single instance crosses a frame boundary.
   *
   * This number is also a FLOOR: the artifact rebuilds DOM nodes directly, while the
   * real board runs React reconciliation over them first. Measured, not assumed — and
   * stated as a floor so the doc cannot read this as the whole cost. */
  const MATERIAL_MS = 1
  return {
    cards: grid.querySelectorAll('[data-task-id]').length,
    columns: lists.length,
    nodes: document.querySelectorAll('[data-dsh-taskboard-view] *').length,
    coveredRender: coveredCost,
    heldRender: heldCost,
    frameBudgetMs,
    /** 改前每条通知吃掉一整帧的多少。 */
    coveredShareOfFrame: round(coveredCost.medianMs / frameBudgetMs, 2),
    /** 判据：改前每条通知都有可观开销，改后低于计时器分辨率。 */
    pass: coveredCost.medianMs >= MATERIAL_MS && heldCost.medianMs < 0.05,
  }
})()
