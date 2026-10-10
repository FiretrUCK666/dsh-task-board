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
  })
})()
