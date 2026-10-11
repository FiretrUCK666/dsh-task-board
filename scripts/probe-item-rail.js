// Measures the checklist rail's alignment: where each element's INK starts and
// where its BOX starts, plus whether the things that share a band share a
// centre line. Ink comes from `Range.getClientRects()` (the pixels a reader
// sees), boxes from `getBoundingClientRect()` — the two differ by exactly the
// padding, and that difference is what "往左偏了" means.
//
// The last expression IS the answer: shot-panel evaluates this file and returns
// its completion value, so nothing here may end in `console.log`.
;(() => {
  const round = (value) => Math.round(value * 10) / 10
  const inkOf = (el) => {
    if (el === null) return null
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
    if (rects.length === 0) return null
    return {
      l: round(Math.min(...rects.map(r => r.left))),
      r: round(Math.max(...rects.map(r => r.right))),
      t: round(Math.min(...rects.map(r => r.top))),
      b: round(Math.max(...rects.map(r => r.bottom))),
    }
  }
  const boxOf = (el) => {
    if (el === null) return null
    const r = el.getBoundingClientRect()
    return { l: round(r.left), r: round(r.right), t: round(r.top), b: round(r.bottom), w: round(r.width), h: round(r.height) }
  }
  const one = (sel) => document.querySelector(sel)
  const all = (sel) => [...document.querySelectorAll(sel)]
  const describe = (name, el) => {
    const box = boxOf(el)
    const ink = inkOf(el)
    return {
      name,
      box,
      ink,
      // The two gaps that decide whether things LOOK aligned: how far the ink
      // sits inside its own box, and how far the ink centre sits from the box
      // centre (vertical, the "没有上下居中" question).
      insetLeft: box !== null && ink !== null ? round(ink.l - box.l) : null,
      inkCentreOffsetY: box !== null && ink !== null ? round((ink.t + ink.b) / 2 - (box.t + box.b) / 2) : null,
      inkCentreOffsetX: box !== null && ink !== null ? round((ink.l + ink.r) / 2 - (box.l + box.r) / 2) : null,
    }
  }

  const navBtns = all('.itemRailNavBtn')
  const rows = all('.itemRailRow')
  const current = rows.find(row => row.getAttribute('aria-current') === 'true') ?? rows[0] ?? null

  /* ── 三枚控件是一条**居中的组**，不是「一枚拉满 + 两个装饰」 ──────────────────
   *
   * 判据是**组心 = 行心**：`‹` 的盒左沿到 `›` 的盒右沿的中点，与那一行的中点差多少。
   * 再加一条：中间那一枚（`today`）的左右内衬相等吗——「它包住自己的字」说的是这两个数。 */
  const navRow = boxOf(one('.itemRailMonthNav'))
  const firstNav = boxOf(navBtns[0] ?? null)
  const lastNav = boxOf(navBtns[navBtns.length - 1] ?? null)
  const trio = firstNav === null || lastNav === null || navRow === null ? null : {
    left: firstNav.l,
    right: lastNav.r,
    width: round(lastNav.r - firstNav.l),
    centre: round((firstNav.l + lastNav.r) / 2),
    rowCentre: round((navRow.l + navRow.r) / 2),
    offCentre: round((firstNav.l + lastNav.r) / 2 - (navRow.l + navRow.r) / 2),
  }

  /* ── 今天那一格与别的格子是**同一个几何** ────────────────────────────────────
   *
   * 「今天」是底、「被选」是环，但两者必须是那 26px 的整格：一格比邻居小一圈（或缩进
   * 两个像素）读者看到的是「这一格歪了」。所以量今天那一格的盒与一个普通格子的盒，
   * 逐个数比。 */
  const cells = all('.itemRailDay').filter(el => !el.className.includes('Blank'))
  const todayCell = one('.itemRailDay[data-today]')
  const plainCell = cells.find(el => el.getAttribute('data-today') === null) ?? null
  const cell = (el) => {
    const box = boxOf(el)
    return box === null ? null : { w: box.w, h: box.h, radius: getComputedStyle(el).borderRadius }
  }
  const cellShape = {
    today: cell(todayCell),
    plain: cell(plainCell),
    sameBox: boxOf(todayCell) !== null && boxOf(plainCell) !== null
      && boxOf(todayCell).w === boxOf(plainCell).w && boxOf(todayCell).h === boxOf(plainCell).h,
    sameRadius: todayCell !== null && plainCell !== null
      && getComputedStyle(todayCell).borderRadius === getComputedStyle(plainCell).borderRadius,
  }

  /* ── 月题的墨落在第一列数字的墨带里 ─────────────────────────────────────────
   *
   * 网格与周首行共用同一张七列网格，所以「第一列」由前七个日格的数字报出来：一位数
   * （4、11、18、25）的墨左沿就是那一列的墨带。 */
  const grid = described('grid', one('.itemRailMonthGrid'))
  const columnInk = cells.slice(0, 7).map(el => {
    const mark = inkOf(el.querySelector('.itemRailDayNum'))
    return mark === null ? null : mark.l
  })

  return JSON.stringify({
    viewport: window.innerWidth,
    parts: [
      describe('rail', one('.itemRail')),
      describe('monthFold', one('.itemRailCalendarFold')),
      describe('month', one('.itemRailMonth')),
      describe('navPrev', navBtns[0] ?? null),
      describe('today', one('.itemRailToday')),
      describe('navNext', navBtns[navBtns.length - 1] ?? null),
      describe('row', current),
      describe('row.mark', current === null ? null : current.querySelector('.itemRailMark')),
      describe('row.word', current === null ? null : current.querySelector('.itemRailWord')),
      describe('row.count', current === null ? null : current.querySelector('.itemRailCount')),
    ],
    trio,
    cellShape,
    grid,
    columnInk,
  })
})()

/** Same reading, one line, for a selector given inline. */
function described(name, el) {
  if (el === null) return { name, box: null }
  const r = el.getBoundingClientRect()
  return { name, box: { l: Math.round(r.left * 10) / 10, r: Math.round(r.right * 10) / 10, w: Math.round(r.width * 10) / 10 } }
}
