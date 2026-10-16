// Measures the detail's right column, row by row: how tall each property row is
// and whether it carries a footnote.
//
// The number worth measuring is the COLUMN's, not a sentence's: a footnote that
// makes ONE row twice as tall as its neighbours is a defect about the whole
// column. So this reports every row's height and whether it carries a footnote,
// and the tallest row is the one to look at.
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
