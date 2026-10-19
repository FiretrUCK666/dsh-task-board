/**
 * 读「父级 `line-height` 不同」时，同一个按钮的行盒落在哪里。
 *
 * 这一条要证的是：按钮自己的 `line-height` 写了 12px，**行盒并不因此稳定**——
 * 因为行盒高度还取决于这一行里最高的那个东西（struts），而 struts 来自父级的
 * 字号与行高。父级 16px/normal 的 strut 约 19px，它会把这行撑高，
 * 字却仍按自己的基线放，于是墨相对盒子偏移。
 */
(() => {
  const round = (value) => Math.round(value * 100) / 100
  const out = []
  for (const id of ['a', 'b', 'c', 'd']) {
    const element = document.getElementById(id)
    if (element === null) continue
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const range = document.createRange()
    range.selectNodeContents(element)
    const line = range.getClientRects()[0]
    const parentStyle = getComputedStyle(element.parentElement)
    out.push({
      id,
      text: (element.textContent ?? '').trim(),
      boxH: round(rect.height),
      ownLineHeight: style.lineHeight,
      parentFont: parentStyle.fontSize,
      parentLineHeight: parentStyle.lineHeight,
      lineH: line === undefined ? null : round(line.height),
      lineTopInBox: line === undefined ? null : round(line.top - rect.top),
      lineMidInBox: line === undefined ? null : round(line.top + line.height / 2 - rect.top),
      boxMid: round(rect.height / 2),
    })
  }
  return JSON.stringify(out)
})()
