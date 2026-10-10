// Measures the checklist detail's two new things: the run-configuration block
// above the action row, and the action row itself (how many visual lines the
// button row and the footer take).
//
// Why measure rather than describe: the block is a stack of five selects whose
// height follows whatever the deployment's catalog advertises, and the footer is
// a wrapping row whose line count is exactly what a narrow band decides. Both
// are answers jsdom cannot give (hard rule 19), and the numbers are what the
// DESIGN.md section cites.
//
// The last expression IS the answer: shot-panel evaluates this file and returns
// its completion value, so nothing here may end in `console.log`.
;(() => {
  const round = (value) => Math.round(value * 10) / 10
  const box = (element) => {
    if (element === null) return null
    const rect = element.getBoundingClientRect()
    return { x: round(rect.left), y: round(rect.top), w: round(rect.width), h: round(rect.height) }
  }
  const lines = (element) => {
    if (element === null) return 0
    // The reader-visible line count of a wrapped row: the distinct top edges of
    // its children, which is what 「一条线还是两条」 actually means on screen.
    const tops = new Set([...element.children].map(child => Math.round(child.getBoundingClientRect().top)))
    return tops.size
  }
  const runConfig = document.querySelector('[class*="itemRunConfig"]')
  const actions = document.querySelector('[class*="itemOpenActions"]')
  const buttons = document.querySelector('[class*="itemOpenBtns"]')
  const act = document.querySelector('[class*="itemOpenAct"]')
  const selects = runConfig === null ? 0 : runConfig.querySelectorAll('select').length
  const fields = runConfig === null ? 0 : runConfig.querySelectorAll('[class*="fieldLabel"]').length
  return JSON.stringify({
    viewport: window.innerWidth,
    body: box(document.body),
    runConfig: box(runConfig),
    runConfigFields: fields,
    runConfigSelects: selects,
    // The block must span the card, not sit in the right column: its width is
    // compared against the action row's, which is known to be full width.
    act: box(act),
    actionLines: lines(actions),
    buttonLines: lines(buttons),
  })
})()
