/**
 * 用**真像素**验证「下内衬 p 让墨上移 p/2」这条律，并求出本机需要的 p。
 *
 * 做法：同一页里放一排同构胶囊（定高 28 / flex 居中 / 行高 12），内衬从 0 扫到 4px，
 * 然后把每个盒子与它里面字的**墨**分别量出来。判据是「墨心 − 盒心」随 p 的变化率，
 * 应当贴近 −0.5。
 *
 * 这一条之所以必须用像素而不是布局：布局给的是**行盒**的位置，而读者看到的是**墨**。
 * 行盒居中不等于墨居中——正是这个差值得出报告里那些「偏了一点点」。
 */
(() => {
  const round = (value) => Math.round(value * 100) / 100

  const style = document.createElement('style')
  style.textContent = `
    .inkSweep { display:flex; flex-direction:column; gap:0; padding:0; background:#fff; }
    .inkSweep span { display:inline-flex; align-items:center; justify-content:center;
      box-sizing:border-box; block-size:28px; padding-inline:12px;
      border-radius:999px; background:#f3f3f3; line-height:12px;
      width:max-content; font-size:12px; font-weight:500; color:#111; }
  `
  document.head.append(style)
  const wrap = document.createElement('div')
  wrap.className = 'inkSweep'
  document.body.append(wrap)

  const pads = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]
  for (const pad of pads) {
    const button = document.createElement('span')
    button.textContent = '整理'
    button.style.paddingBlock = `0px ${pad}px`
    wrap.append(button)
    void button.offsetHeight
  }

  /* 把每一枚盒子的几何报出来；像素那一半由 `scripts/probes/measure-ink-bands.cjs` 读同一张图。 */
  const rows = []
  for (const button of wrap.children) {
    const rect = button.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(button)
    const line = range.getClientRects()[0]
    rows.push({
      pad: getComputedStyle(button).paddingBottom,
      boxTop: round(rect.top),
      boxH: round(rect.height),
      boxMid: round(rect.top + rect.height / 2),
      lineTop: line === undefined ? null : round(line.top),
      lineMid: line === undefined ? null : round(line.top + line.height / 2),
    })
  }
  style.remove()
  return JSON.stringify({ dpr: window.devicePixelRatio, rows })
})()
