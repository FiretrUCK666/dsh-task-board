// 框架空气：清单面板的行卡到左右两沿，在**每一档宽度**下是不是同一个数。
//
// ── 为什么这一支探针要存在 ────────────────────────────────────────────────────
//
// 行卡到左边有多远，曾经是一个**按档位切的数**（面板 ≥720 时是 0），而「左栏在行卡左边
// 当一列」这件事只在面板 ≥881 时成立：720–880 这一段行卡左边**没有任何邻居**，它左边
// 就是面板的左沿。于是那个区间里行卡到左沿量出来是 **0px**（贴住侧板），而同一屏的顶栏
// 文字还站在 16px 上——一屏之内两条线互相不认，读者看到的是「间隙有时有、有时没有」。
//
// 所以判据不是「读一遍声明」，是**把面板逐档扫一遍**：面板的每一档都是容器查询量出来的，
// 于是宽度由页面自己给（`body` 的宽度就是面板的宽度），一次装载量完整条阶梯。这不是为了
// 快：一个只会读声明的检查看不见「两个档位界线答同一个问题」，而那一类缺陷在屏上就是
// 「拖窗口的时候间隙在抽搐」。
//
// ── 六条判据 ─────────────────────────────────────────────────────────────────
//
//   F1 空气是一个数        每一档读回来的 `--item-air` 必须是同一个值。它随档位变，就是
//                          下一次「这一档和那一档不一样」的来源——而这条面板的两端本来
//                          就是同一个数，所以它没有第二个答案。
//   F2 左右相等            行卡到清单列两沿的距离之差 ≤ 0.5px。这是这条探针的主判据，
//                          也是读者报上来的那一件事。
//   F3 两个间隙都在        两个距离都 ≥ 8px。0 不是「小」，是**贴住**——`DESIGN.md` 里
//                          那条 0 就是读者报的「直接粘住了左边的侧板」。
//   F4 两条线是一条线      「共 N 条」那个数、行里第一个字（状态珠子）、日分段药丸的边
//                          ——三样到清单列左沿的距离之差 ≤ 1.5px。1px 是**行卡自己那条边**
//                          （`--item-hair-strong`），它是同一个数被量了两遍，不是两条线。
//   F5 横带也在同一条线上  左栏折成横带（`flex-direction: row`）的那几档里，横带的**内容
//                          左沿**与「共 N 条」到面板左沿的距离之差 ≤ 1.5px。横带在滚动体
//                          外面，自己付那一档内衬——付错了就是「带子上的字和行里的字不在
//                          一条线上」，而这两样在同一屏上（月题芯片与导航行都从那条线起排）。
//   F6 滚动条住得下        滚动条占的布局宽 ≤ 空气。细条画在空气里面才贴着面板的边走；
//                          比空气宽时它会盖上行卡的右沿，右间隙就不再是那个数。
//   F7 一排控件一种间距    顶栏那簇控件内部，同一行上相邻两枚之间的距离必须一样（≤ 1px）；
//                          折行时行与行之间读的必须是**带子自己那一档**（顶栏与这一簇的
//                          `row-gap` 相等）。主行动与芯片之间那一大块空白、折行后那条
//                          4px 的缝，都是这一条要挡的：**一行里两种间距就是没有骨架**。
//   F8 这把尺子还灵不灵    量真页面之前先把滚动体的左内衬改成 0，用同一套扫描量一次，
//                          要求 F2 报出来。报不出来就是 `blind`——「上一轮全绿而屏幕是坏的」
//                          的根子是**没有一步问过尺子还灵不灵**，所以自证是判据的一部分。
//
// ── 三态，而不是布尔 ────────────────────────────────────────────────────────
//
// 「这条面板上没有行」（空文档、搜索无结果）与「量不到」不是缺陷，所以它们各自是一个
// 状态（`not-here` / `no-reading`），而不是一个假红。没有行卡时 F2/F3/F4 报 `not-here`，
// F1/F5/F6/F7 照样判——顶栏与左栏在空文档上仍然在。
//
// 最后一个表达式就是答案（`shot-panel` 取表达式的完成值），所以这里不许以 `console.log`
// 收尾。
(() => {
  /* 阶梯：每一档都取，而四个界线（1080/1081、880/881、719/720、559/560）两侧各取一档，
   * 因为「两个界线答同一个问题」只会在界线那一像素上现形。 */
  const WIDTHS = [1600, 1440, 1200, 1081, 1080, 1000, 960, 900, 881, 880, 800, 760, 721, 720, 719, 640, 560, 480, 412, 390]
  /** 左右相等的容差：亚像素取整的余地，不足一个设备像素。 */
  const AIR_TOL = 0.5
  /** 这个数之下不是「小间隙」，是贴着——`DESIGN.md` 记的缺陷读数就是 0。 */
  const AIR_FLOOR = 8
  /** 两条线的容差：行卡自己那 1px 的边 + 一个圆整步。 */
  const LINE_TOL = 1.5
  /** 同一行里两枚控件之间允许的差：亚像素取整的余地。 */
  const GAP_TOL = 1
  const r2 = (v) => Math.round(v * 100) / 100
  const boxOf = (el) => {
    const r = el.getBoundingClientRect()
    return { l: r2(r.left), r: r2(r.right), w: r2(r.width) }
  }
  /** 一条判据的三态：`false` 与「我没量」在报告里长得一样（硬性规范 15）。 */
  const stateOf = (present, holds) => (present === 0 ? 'not-here' : holds ? 'pass' : 'fail')

  const panel = document.querySelector('[data-dsh-taskboard-view]')
  const workbench = document.querySelector('.itemWorkbench')
  const flow = document.querySelector('.itemFlow')
  const rail = document.querySelector('.itemRail')
  const calendarBody = document.querySelector('.itemRailCalendarBody')
  /* 没有这条框架（看板页、画廊页）不是缺陷：这一档量不到东西，报 `not-here` 让上层跳过。 */
  if (flow === null || workbench === null || panel === null) {
    return { pass: { listFrame: 'not-here' }, rungs: [], offenders: {}, counts: { rungs: 0, withCard: 0 } }
  }

  /** 把页面宽度设成这一档，然后读一次——面板是容器查询量出来的那个盒子，所以它的宽度就是它。 */
  function read(width) {
    document.body.style.width = `${width}px`
    const col = document.querySelector('.itemListColumn')
    if (col === null) return { width, missing: true }
    const colBox = boxOf(col)
    const panelBox = boxOf(panel)
    const flowStyle = getComputedStyle(flow)
    const row = document.querySelector('.itemRow')
    const lead = document.querySelector('.itemRowLead')
    const count = document.querySelector('.itemTopCount')
    const railRow = document.querySelector('.itemRailRow')
    const at = (el, from) => (el === null ? null : r2(boxOf(el).l - from))

    /* ── F7：顶栏那簇控件 ─────────────────────────────────────────────────────
     *
     * 同一行上相邻两枚之间的距离必须一样。折行时按上沿把同一行的挑出来再算——「同一行」
     * 在这里是量出来的，不是猜的（同一行的盒子高矮一样、上沿一致）。 */
    const bar = document.querySelector('.itemTopBar')
    const tools = document.querySelector('.itemTopBarTools')
    const toolBoxes = tools === null ? [] : [...tools.children].map((el) => el.getBoundingClientRect())
    const lines = []
    for (const one of toolBoxes) {
      const line = lines.find((each) => Math.abs(each.top - one.top) < 8)
      if (line === undefined) lines.push({ top: one.top, items: [one] })
      else line.items.push(one)
    }
    const spread = lines
      .filter((line) => line.items.length > 2)
      .map((line) => {
        const sorted = [...line.items].sort((a, b) => a.left - b.left)
        const gaps = sorted.slice(1).map((one, i) => one.left - sorted[i].right)
        return r2(Math.max(...gaps) - Math.min(...gaps))
      })
    return {
      width,
      panelW: panelBox.w,
      colW: colBox.w,
      railDirection: rail === null ? null : getComputedStyle(rail).flexDirection,
      air: getComputedStyle(workbench).getPropertyValue('--item-air').trim(),
      padL: flowStyle.paddingLeft,
      padR: flowStyle.paddingRight,
      /* 滚动条占的布局宽：`offsetWidth − clientWidth` = 边框 + 滚动条。0 = 叠加式，
       * 它不占布局宽但**仍然画在那 8px 空气里**。 */
      scrollbar: flow.offsetWidth - flow.clientWidth,
      cardLeft: row === null ? null : at(row, colBox.l),
      cardRight: row === null ? null : r2(colBox.r - boxOf(row).r),
      leadLeft: at(lead, colBox.l),
      countLeft: at(count, colBox.l),
      pipLeft: at(document.querySelector('.itemGroupHead'), colBox.l),
      countPanelLeft: at(count, panelBox.l),
      /* 横带的**内容左沿**（它自己那两档内衬推出来的线）：月题芯片与导航行都从这里起排，
       * 而顶栏那个数在下面那一行、从同一条线起排——两样在同一条竖线上就是这一条要判的。 */
      railPanelLeft: r2(boxOf(rail).l + parseFloat(getComputedStyle(rail).paddingLeft) - panelBox.l),
      toolLines: lines.length,
      toolsSpread: spread.length === 0 ? null : r2(Math.max(...spread)),
      /* 折行时行与行之间那一档必须与顶栏自己那一档是同一个数。**只在真的折了行时判**：
       * 一行里那个数不参与排版，拿它判红就是拿一个没生效的数说事。 */
      gapsMatch: bar === null || tools === null || lines.length < 2
        ? null
        : getComputedStyle(bar).rowGap === getComputedStyle(tools).rowGap,
    }
  }

  const rungs = []
  const failed = { symmetric: [], present: [], lines: [], rail: [], scrollbar: [], barGaps: [] }
  /* ── 阶梯量在**折叠**态上 ───────────────────────────────────────────────────
   *
   * 日历的折叠是读者的选择，而两个状态在窄档是两种排法（折起来带子是一行，展开时是一列）。
   * 这条阶梯问的是「行卡到两沿多远」与「几条线在不在同一条线上」——两句话都必须在**同一个
   * 状态**上量，否则「横带上的字与行里的字同一条线」那一条会有几档没有主体（展开时横带
   * 是一列，没有那一行）。折叠态也是窄档的默认：读者第一眼看到的就是它。 */
  const calendarRestore = { has: rail?.getAttribute('data-calendar') ?? null, hidden: calendarBody?.hidden ?? false }
  if (rail !== null) rail.removeAttribute('data-calendar')
  if (calendarBody !== null) calendarBody.hidden = true
  /** 三样东西该站在同一条线上的差值（行卡那条边算在里面）。 */
  const lineGaps = (rung) => (rung.leadLeft === null
    ? []
    : [rung.countLeft, rung.pipLeft]
      .filter((one) => one !== null)
      .map((one) => Math.abs(rung.leadLeft - one)))
  for (const width of WIDTHS) {
    const rung = read(width)
    rungs.push(rung)
    if (rung.missing === true) continue
    if (typeof rung.cardLeft === 'number') {
      if (Math.abs(rung.cardLeft - rung.cardRight) > AIR_TOL) failed.symmetric.push(rung)
      if (Math.min(rung.cardLeft, rung.cardRight) < AIR_FLOOR) failed.present.push(rung)
      if (lineGaps(rung).some((gap) => gap > LINE_TOL)) failed.lines.push(rung)
    }
    if (rung.railDirection === 'row' && rung.railPanelLeft !== null && rung.countPanelLeft !== null
      && Math.abs(rung.railPanelLeft - rung.countPanelLeft) > LINE_TOL) failed.rail.push(rung)
    if (rung.scrollbar > parseFloat(rung.padR)) failed.scrollbar.push(rung)
    /* 一行里两种间距 = 没有骨架；折行的两行之间读的必须是顶栏那一档。 */
    if (rung.toolsSpread !== null && rung.toolsSpread > GAP_TOL) failed.barGaps.push(rung)
    if (rung.gapsMatch === false) failed.barGaps.push(rung)
  }
  /* 页面宽度与日历状态还原：探针跑完之后截图与别的读数都该看到**它自己的**那一档。 */
  document.body.style.width = ''
  if (rail !== null && calendarRestore.has !== null) rail.setAttribute('data-calendar', calendarRestore.has)
  if (calendarBody !== null) calendarBody.hidden = calendarRestore.hidden

  const withCard = rungs.filter((rung) => typeof rung.cardLeft === 'number')
  const stripRungs = rungs.filter((rung) => rung.railDirection === 'row')
  const airValues = [...new Set(rungs.filter((rung) => rung.missing !== true).map((rung) => rung.air))]

  /* ── F7：自检 ───────────────────────────────────────────────────────────────
   *
   * 种一颗**已知的不对称**：把滚动体的左内衬改成 0。它不是「改一下探针」——探针本身不
   * 认这个类名，它只读几何；种完之后用同一套扫描去量，F2 必须报出来。 */
  let selfTest = 'blind'
  const plantedBackup = flow.style.paddingLeft
  flow.style.paddingLeft = '0px'
  try {
    const planted = read(900)
    selfTest = typeof planted.cardLeft === 'number' && Math.abs(planted.cardLeft - planted.cardRight) > AIR_TOL
      ? 'caught'
      : `blind:${JSON.stringify({ left: planted.cardLeft, right: planted.cardRight })}`
  } finally {
    flow.style.paddingLeft = plantedBackup
    document.body.style.width = ''
  }

  return {
    pass: {
      listFrame: 'pass',
      airConstant: stateOf(rungs.filter((rung) => rung.missing !== true).length, airValues.length === 1),
      airSymmetric: stateOf(withCard.length, failed.symmetric.length === 0),
      airPresent: stateOf(withCard.length, failed.present.length === 0),
      linesAgree: stateOf(withCard.length, failed.lines.length === 0),
      railOnLine: stateOf(stripRungs.length, failed.rail.length === 0),
      scrollbarFits: stateOf(rungs.length, failed.scrollbar.length === 0),
      barGapsEven: stateOf(rungs.filter((rung) => rung.toolsSpread !== null || rung.gapsMatch !== null).length, failed.barGaps.length === 0),      selfTest,
    },
    counts: {
      rungs: rungs.length,
      withCard: withCard.length,
      stripRungs: stripRungs.length,
      air: airValues.join('|') === '' ? 'none' : airValues.join('|'),
    },
    /* 每一档两个间隙，让「相等」这件事在报告里看得见，而不是只看见一句 pass。 */
    ladder: rungs.map((rung) => (rung.missing === true
      ? { width: rung.width, missing: true }
      : { width: rung.width, air: rung.air, left: rung.cardLeft, right: rung.cardRight, lines: `${String(rung.leadLeft)}/${String(rung.countLeft)}` })),
    offenders: failed,
    rungs,
  }
})()
