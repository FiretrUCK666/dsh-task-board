// Measures the detail's right column, row by row: how tall each property row is
// and whether it carries a footnote.
//
// It used to measure the 状态 row's footnote, and it also produced the "before"
// number for it by putting the item back into the name track (`grid-column:
// auto`) — that fix is in, and the sentence no longer lives in the column at
// all. What is worth measuring changed with it: the reason the footnote was a
// defect is that it made ONE row twice as tall as its neighbours, and that is a
// number about the whole column, not about the sentence.
//
// The last expression IS the answer: shot-panel evaluates this file and returns
// its completion value, so nothing here may end in `console.log`.
;(() => {
  const round = (value) => Math.round(value * 10) / 10
  const rows = [...document.querySelectorAll('.itemOptRow')].map(row => {
    const label = row.querySelector('.itemOptName')
    const note = row.querySelector('.itemOptsFoot')
    return {
      label: (label?.textContent ?? '?').trim(),
      h: round(row.getBoundingClientRect().height),
      note: note === null ? null : round(note.getBoundingClientRect().height),
    }
  })
  return JSON.stringify({ viewport: window.innerWidth, rows })
})()
