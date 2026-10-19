/**
 * 只量指定的几个类名：**它们的盒、它们的子项、以及子项的盒**。
 *
 * 目的：`itemRowCardChip` 与 `itemRowSteps` 这两枚需要的下内衬是别的两倍。要判断这是
 * 「多带了一个图标」造成的，还是「它们真的更高一点」，只能把它们**自己的结构化开来看**：
 * 有几个子项、各多高、墨在哪。
 */
(() => {
  const round = (value) => Math.round(value * 100) / 100
  const canvas = document.createElement('canvas').getContext('2d')
  const wanted = ['itemRowCardChip', 'itemRowSteps', 'itemRowAttach', 'itemOpt', 'itemTag']

  const rows = []
  for (const name of wanted) {
    const element = [...document.querySelectorAll(`[class*="${name}"]`)]
      .find((one) => (one.className || '').toString().split(' ').some((c) => c.endsWith(name)))
    if (element === undefined) continue
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const children = [...element.children].map((child) => {
      const childRect = child.getBoundingClientRect()
      return {
        tag: child.tagName.toLowerCase(),
        cls: (child.className || '').toString().slice(0, 24),
        h: round(childRect.height),
        top: round(childRect.top - rect.top),
      }
    })
    /* 整枚元素的文本墨心（不管它有几个子项）。 */
    const range = document.createRange()
    range.selectNodeContents(element)
    const lines = [...range.getClientRects()].filter((one) => one.height > 0)
    let inkDelta = null
    if (lines.length > 0) {
      const fontSize = parseFloat(style.fontSize)
      const lineHeight = parseFloat(style.lineHeight) || fontSize
      canvas.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`
      const m = canvas.measureText((element.textContent ?? '').trim() || '字')
      const fa = m.fontBoundingBoxAscent
      const fd = m.fontBoundingBoxDescent
      const ia = m.actualBoundingBoxAscent
      const id = m.actualBoundingBoxDescent
      const leading = (lineHeight - (fa + fd)) / 2
      const baseline = lines[0].top + leading + fa
      const inkMid = (baseline - ia + baseline + id) / 2
      inkDelta = round(inkMid - (rect.top + rect.height / 2))
    }
    rows.push({
      name,
      text: (element.textContent ?? '').trim().slice(0, 10),
      boxH: round(rect.height),
      display: style.display,
      align: style.alignItems,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      padBlock: `${style.paddingTop} / ${style.paddingBottom}`,
      childCount: element.children.length,
      children,
      inkDelta,
    })
  }
  return JSON.stringify(rows)
})()
