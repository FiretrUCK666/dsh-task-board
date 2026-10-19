/**
 * 扫一串小数内衬，读**行盒顶**在盒子里的位置。
 *
 * 这一条回答的是「浏览器到底会不会用亚像素内衬」：
 * 如果行盒顶随内衬连续移动，那么 0.2 / 0.4 / 0.6 这些值是真实存在的台阶，
 * 校正就能精确归零；如果它成对跳（0.2 与 0.4 一样、0.6 与 0.8 一样），
 * 说明可用台阶只有一格，`round()` 到整像素就是唯一能落地的值。
 *
 * 量法用 `Range.getClientRects()`：这是排版结果，不受抗锯齿与截图缩放影响。
 */
(() => {
  const round = (value) => Math.round(value * 1000) / 1000
  const out = []

  const st = document.createElement('style')
  st.textContent = `
    .probeWrap { display:flex; flex-direction:column; gap:8px; padding:12px; background:#fff }
    .probeBtn { display:inline-flex; align-items:center; justify-content:center;
      box-sizing:border-box; block-size:28px; padding-inline:12px;
      border-radius:999px; background:#f3f3f3; line-height:12px;
      width:max-content; font-size:12px; font-weight:500; }
  `
  document.head.append(st)

  const wrap = document.createElement('div')
  wrap.className = 'probeWrap'
  document.body.append(wrap)

  const values = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6]
  for (const value of values) {
    const button = document.createElement('span')
    button.className = 'probeBtn'
    button.textContent = '整理'
    button.style.paddingBlock = `0px ${value}px`
    wrap.append(button)
    void button.offsetHeight
  }

  for (const button of wrap.children) {
    const rect = button.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(button)
    const line = range.getClientRects()[0]
    out.push({
      pad: getComputedStyle(button).paddingBottom,
      boxTop: round(rect.top),
      boxH: round(rect.height),
      lineTop: line === undefined ? null : round(line.top - rect.top),
      lineH: line === undefined ? null : round(line.height),
      boxMid: round(rect.top + rect.height / 2),
      lineMid: line === undefined ? null : round(line.top + line.height / 2),
    })
  }

  wrap.remove()
  st.remove()
  return JSON.stringify(out)
})()
