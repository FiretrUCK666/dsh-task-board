/**
 * 把**同一个组件在两种页面上的实例**摆在一起比：高度、内衬、行盒、以及字墨的偏移。
 *
 * 这一条要回答的是用户问的那句话——「它们用的不都是同一套东西吗」：
 * 如果组件相同而结果不同，差别只能在**继承下来的上下文**（字号 / 行高 / 内衬覆盖 /
 * flex 属性），所以这里把每个实例自己的计算值全部打出来，用来找那一处不同。
 *
 * 字墨偏移直接从像素里量（PIL 不可用，所以这里只报几何；像素那一半由
 * `.design/measure-bands.cjs` 读同一张图）。这一条负责「为什么」。
 */
(() => {
  const round = (value) => Math.round(value * 100) / 100

  const describe = (element, label) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const parent = element.parentElement
    const parentStyle = parent === null ? null : getComputedStyle(parent)
    const range = document.createRange()
    range.selectNodeContents(element)
    const lines = [...range.getClientRects()].filter((one) => one.height > 0)
    return {
      label,
      text: (element.textContent ?? '').trim().slice(0, 8),
      cls: (element.className || '').toString().slice(0, 40),
      boxH: round(rect.height),
      font: `${style.fontSize}/${style.fontWeight}`,
      lineHeight: style.lineHeight,
      pad: `${style.paddingTop}/${style.paddingBottom}`,
      padInline: `${style.paddingLeft}/${style.paddingRight}`,
      alignSelf: style.alignSelf,
      align: style.alignItems,
      display: style.display,
      lineBox: lines.length === 0 ? null : `${round(lines[0].height)}@${round(lines[0].top - rect.top)}`,
      parentCls: parent === null ? null : (parent.className || '').toString().slice(0, 40),
      parentAlign: parentStyle === null ? null : parentStyle.alignItems,
      parentDisplay: parentStyle === null ? null : parentStyle.display,
      parentFont: parentStyle === null ? null : parentStyle.fontSize,
      parentLineHeight: parentStyle === null ? null : parentStyle.lineHeight,
    }
  }

  const byText = (text) => {
    for (const element of document.querySelectorAll('button, a, [role="button"]')) {
      if ((element.textContent ?? '').trim() === text) return element
    }
    return null
  }

  const wanted = ['多选', '隐藏已完成', '排序要紧的先', '新建一条', '整理', '自动化']
  const out = []
  for (const text of wanted) {
    const element = byText(text)
    if (element === null) { out.push({ label: text, missing: true }); continue }
    out.push(describe(element, text))
  }
  return JSON.stringify(out)
})()
