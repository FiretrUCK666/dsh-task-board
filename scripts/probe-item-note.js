// Measures the right column's footnote in the state row — before and after the
// fix — in one run. `grid-column: auto` is exactly the pre-fix placement (the
// item falls into the first free cell, which is the 64px name track), so the
// "before" number is taken from the same page and the same font as the "after".
;(() => {
  const el = document.querySelector('.itemOptRow > .itemOptsFoot')
  if (el === null) return JSON.stringify({ missing: true })
  const box = (node) => {
    const r = node.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height) }
  }
  const after = box(el)
  const before = (() => {
    const kept = el.style.gridColumn
    el.style.gridColumn = 'auto'
    const r = box(el)
    el.style.gridColumn = kept
    return r
  })()
  return JSON.stringify({
    viewport: window.innerWidth,
    row: box(el.parentElement),
    before,
    after,
  })
})()
