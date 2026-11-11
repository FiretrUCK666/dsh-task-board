// 关闭这条路：点叉号、点空白处，那一层真的没了吗？
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   C1 打开那张卡之后，详情那一层真的在屏上（`#sheet` 存在、`#backdrop` 存在）
//   C2 打开期间，被盖住的看板读作「被盖住」（`data-covered` 为 true）
//   C3 点**叉号**之后，那一层消失
//   C4 再打开一次，点**空白处**（遮罩本身）之后，那一层消失
//
// C3 / C4 就是读者报的那两下。它们在 `?mode=old`（旧实现）那一页上必须变红——否则这条
// 判据只是碰巧通过，而碰巧通过的东西下一次不会报警。
;;(() => (async () => {
  const frame = () => new Promise(done => requestAnimationFrame(() => { done() }))
  const sheet = () => document.getElementById('sheet')
  const backdrop = () => document.getElementById('backdrop')
  const open = document.getElementById('open')
  if (open === null) return { error: 'the page did not render its open button — did the bundle load?' }

  const click = async (element) => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }))
    element.click()
    await frame()
    await frame()
  }

  await frame()
  await frame()

  /* C1 / C2：打开 */
  await click(open)
  const openedSheet = sheet() !== null
  const openedBackdrop = backdrop() !== null
  const coveredWhileOpen = document.getElementById('board')?.getAttribute('data-covered')

  /* C3：点叉号 */
  let afterCloseButton = 'no-sheet-to-close'
  if (openedSheet) {
    const close = document.getElementById('close')
    if (close === null) return { error: 'the sheet rendered without its close button' }
    await click(close)
    afterCloseButton = sheet() === null ? 'closed' : 'still-open'
  }

  /* C4：再打开，点空白处 */
  let afterBackdrop = 'no-sheet-to-close'
  await click(open)
  if (sheet() !== null) {
    const cover = backdrop()
    if (cover === null) return { error: 'the sheet rendered without its backdrop' }
    /* 点在遮罩**自己**身上（不是它里面的面板）：那正是产品里判断「点到空白」的方式。 */
    cover.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }))
    await frame()
    await frame()
    afterBackdrop = sheet() === null ? 'closed' : 'still-open'
  }

  return {
    mode: window.__mode ?? 'new',
    openedSheet,
    openedBackdrop,
    coveredWhileOpen,
    afterCloseButton,
    afterBackdrop,
    errors: window.__errors ?? [],
    /* C1 / C2 / C3 / C4 */
    pass: openedSheet && openedBackdrop && coveredWhileOpen === 'true'
      && afterCloseButton === 'closed' && afterBackdrop === 'closed',
  }
})())()
