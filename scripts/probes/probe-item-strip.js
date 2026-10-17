// 面板的高度预算：导航带与列表怎么分这一块的高度，以及装不下的东西能不能滚到。
//
// ── 为什么这一支探针要存在 ────────────────────────────────────────────────────
//
// 导航带的高度是**内容**决定的：日历一展开，它是 240px 的一幅月历。曾经横带用
// `flex-wrap` 收下它——而 `wrap` 会把十九枚芯片逐枚当成可以换行的东西，于是带子长到
// **421–541px**（面板 390–800）。在一个 600px 高的手机上面板里，列表那一行只剩几十像素，
// 而**两条轴都不滚**：列表的滚动体高度接近 0，读者按不开任何一个按钮，整个面板也拖不动
// （读者报的就是这一次）。所以判据不是「带子多高」，而是两句话：
//
//   · **工作永远拿得到它那一半**（`minmax(50%, 1fr)` 是对工作的保证，不是对带子的限制）；
//   · **装不下的东西一定能滚到**（带子被上限咬住时，它自己纵向可滚——被裁掉的内容既按
//     不动也滚不到）。
//
// 宽度决定档位，高度决定预算，所以这条阶梯是**两维**的：`(宽, 高)` 一对一对地量。
// 页面宽度与高度都由探针设定（面板就是这两个盒子）。
//
// ── 四条判据 ─────────────────────────────────────────────────────────────────
//
//   S1 工作拿到了一半    每一档里列表那一列的高度 ≥ 板盒的 45%（地板是 50%，那 5% 留
//                       给「带子比一半还矮」的档：地板只在带子想要更多时才咬）。
//   S2 列表能用          列表的滚动体 ≥ 72px（一行的高度）——一个按不动的列表不算列表。
//   S3 装得下的滚得到    带子纵向溢出时，它的 `overflow-y` 必须是 `auto`/`scroll`；
//                       `hidden`/`clip` 意味着下面的内容既按不动也滚不到。
//   S4 导航是一条横带    日历展开时，导航那几组仍然**一条行**（所有行的上沿落在同一个数上），
//                       装不下就横向滚——不是十九枚各落一行。
//   S5 这把尺子还灵不灵  量之前先把带子的 `overflow-y` 改成 `hidden` 并把高度压到装不下，
//                       要求 S3 报出来。报不出来就是 `blind`。
//
// 最后一个表达式就是答案（`shot-panel` 取表达式的完成值）。
(() => {
  /* (面板宽, 面板高)：宽度决定档位，高度决定预算。 */
  const RUNGS = [
    [412, 900], [412, 700], [412, 560], [560, 900],
    [640, 700], [900, 900], [900, 500], [1440, 900],
  ]
  /** 地板是 50%，判据落在 45%：那 5% 是「带子比一半还矮」的档，地板不该咬它。 */
  const FLOOR_SHARE = 0.45
  /** 一行的地板：一行的高度就是这一页行卡的最小高度。 */
  const LIST_FLOOR = 72
  /** 同一条横带的行上沿容差：亚像素取整。 */
  const ROW_TOL = 2
  const r1 = (v) => Math.round(v * 10) / 10
  const stateOf = (present, holds) => (present === 0 ? 'not-here' : holds ? 'pass' : 'fail')
  const scrollable = (value) => value === 'auto' || value === 'scroll'

  const root = document.querySelector('[data-dsh-taskboard-view]')
  const rail = document.querySelector('.itemRail')
  const body = document.querySelector('.itemRailCalendarBody')
  if (root === null || rail === null || body === null) {
    return { pass: { listFrame: 'not-here' }, rungs: [], offenders: {}, counts: { rungs: 0 } }
  }

  /** 把面板设成这一档，并（按需）把日历展开。 */
  function read(width, height, open) {
    document.body.style.width = `${width}px`
    document.body.style.height = `${height}px`
    if (open) {
      rail.setAttribute('data-calendar', '')
      body.hidden = false
    } else {
      /* **两态都由这一支探针说**，不读页面当前那一个：面板的折叠态是读者的选择（窄档
       * 默认折起、宽档默认展开），量预算的两档都必须自己摆好，否则「折叠」那几档量到的
       * 是展开的样子。 */
      rail.removeAttribute('data-calendar')
      body.hidden = true
    }
    const board = document.querySelector('.itemWorkbench')
    const col = document.querySelector('.itemListColumn')
    const flow = document.querySelector('.itemFlow')
    const rows = [...document.querySelectorAll('.itemRailChips .itemRailRow')]
    const railStyle = getComputedStyle(rail)
    const chips = document.querySelector('.itemRailChips')
    const tops = [...new Set(rows.map((one) => Math.round(one.getBoundingClientRect().top)))]
    return {
      width,
      height,
      open,
      boardH: r1(board.getBoundingClientRect().height),
      colH: r1(col.getBoundingClientRect().height),
      flowH: r1(flow.getBoundingClientRect().height),
      railH: r1(rail.getBoundingClientRect().height),
      railOverflowY: railStyle.overflowY,
      railOverflow: rail.scrollHeight - rail.clientHeight,
      rowTops: tops.length,
      rowCount: rows.length,
      /* 导航在宽档是**一列**（左栏），在窄档才是**一条横带**：S4 只对后者成立。 */
      chipsDirection: chips === null ? null : getComputedStyle(chips).flexDirection,
      chipsOverflowX: chips === null ? null : chips.scrollWidth - chips.clientWidth,
      chipsOverflow: chips === null ? null : getComputedStyle(chips).overflowX,
    }
  }

  const rungs = []
  const failed = { floor: [], usable: [], reachable: [], oneRow: [] }
  for (const [width, height] of RUNGS) {
    for (const open of [false, true]) {
      const rung = read(width, height, open)
      rungs.push(rung)
      if (rung.colH < rung.boardH * FLOOR_SHARE - 1) failed.floor.push(rung)
      if (rung.flowH < LIST_FLOOR) failed.usable.push(rung)
      /* 溢出且不可滚 = 被裁掉：只有带子自己纵向可滚时，下面的内容才算够得到。 */
      if (rung.railOverflow > 1 && !scrollable(rung.railOverflowY)) failed.reachable.push(rung)
      /* 横带那几档（展开），导航必须仍然是一条行；宽档它是一列，那不算缺陷。 */
      if (rung.chipsDirection === 'row' && rung.rowCount > 1 && rung.rowTops !== 1) failed.oneRow.push(rung)
    }
  }
  /* 还原：截图与别的读数都该看到页面自己的那一档。 */
  rail.removeAttribute('data-calendar')
  body.hidden = true
  document.body.style.width = ''
  document.body.style.height = ''

  /* ── S5：自检 ───────────────────────────────────────────────────────────────
   *
   * 种一颗**已知的裁掉**：把带子的纵向溢出关掉，再把面板压到装不下。同一套扫描必须
   * 报出「溢出且不可滚」。 */
  let selfTest = 'blind'
  const restore = { overflowY: rail.style.overflowY, width: document.body.style.width, height: document.body.style.height, calendar: rail.getAttribute('data-calendar') }
  rail.style.overflowY = 'hidden'
  try {
    const planted = read(412, 300, true)
    selfTest = planted.railOverflow > 1 && !scrollable(planted.railOverflowY) ? 'caught' : `blind:${JSON.stringify({ overflow: planted.railOverflow, y: planted.railOverflowY })}`
  } finally {
    rail.style.overflowY = restore.overflowY
    rail.removeAttribute('data-calendar')
    body.hidden = true
    document.body.style.width = restore.width
    document.body.style.height = restore.height
  }

  return {
    pass: {
      listFrame: 'pass',
      listFloor: stateOf(rungs.length, failed.floor.length === 0),
      listUsable: stateOf(rungs.length, failed.usable.length === 0),
      stripReachable: stateOf(rungs.length, failed.reachable.length === 0),
      chipsOneRow: stateOf(rungs.filter((one) => one.chipsDirection === 'row').length, failed.oneRow.length === 0),
      selfTest,
    },
    counts: { rungs: rungs.length, open: rungs.filter((one) => one.open).length },
    /* 每一档两行数，让「谁拿了多少」在报告里看得见。 */
    ladder: rungs.map((one) => (one.open ? 'open ' : 'fold ') + `${one.width}x${one.height}: rail ${one.railH} col ${one.colH} flow ${one.flowH}`),
    offenders: failed,
    rungs,
  }
})()
