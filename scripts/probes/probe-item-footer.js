// Reads the footer's real geometry out of the browser that drew it.
// The file's last expression IS the answer: shot-panel evaluates this script and
// returns its completion value, so nothing here may end in `console.log`.
;(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel)
    if (el === null) return { sel, missing: true }
    const r = el.getBoundingClientRect()
    const c = getComputedStyle(el)
    return {
      sel,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      display: c.display,
      wrap: c.flexWrap,
      justify: c.justifyContent,
      align: c.alignItems,
      dir: c.flexDirection,
      minInline: c.minInlineSize,
      flex: c.flex,
      whiteSpace: c.whiteSpace,
      overflow: c.overflow,
    }
  }
  const panel = document.querySelector('[data-dsh-taskboard-panel]')
  return JSON.stringify({
    viewport: window.innerWidth,
    panel: panel === null ? null : Math.round(panel.getBoundingClientRect().width),
    parts: [
      pick('.itemOpenAct'),
      pick('.itemOpenActions'),
      pick('.itemOpenActions > .itemOptsFoot'),
      pick('.itemOpenBtns'),
    ],
  })
})()
