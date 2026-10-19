/**
 * 定向读数：把几个**具体类名**的盒子连同它的父级链一起量出来，回答「偏的是哪一层」。
 *
 * 为什么需要它：`probe-capsule-live-correction.js` 报一个类名，但同一个元素上常挂着
 * 两个类（`.chip.chipFill`），而校正只写在其中一个上。只报一个名字，会让人以为
 * 「这条规则没生效」，其实生效在另一条规则上。这一条把类名全名、计算后的上下内衬、
 * 以及解析出来的令牌值一起报出来——三样摆在一起，「有没有生效」就不用猜。
 *
 * 用法：--eval-file 本文件，配合下面的 TARGETS。
 */
(() => {
  const TARGETS = ['cruisePill', 'switch', 'switchLabel', 'chip', 'chipFill', 'itemTagAdd',
    'workbenchCheck', 'workbenchTab', 'ghostButton', 'primaryButton', 'boardDemand', 'columnTab']
  const canvas = document.createElement('canvas').getContext('2d')
  const round = (value) => Math.round(value * 100) / 100

  const inkDelta = (element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const own = Array.from(element.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent ?? '')
      .join('')
    const text = (own === '' ? element.textContent ?? '' : own).trim()
    if (text === '' || rect.height === 0) return null
    canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const metrics = canvas.measureText(text.slice(0, 20))
    const fa = metrics.fontBoundingBoxAscent
    const fd = metrics.fontBoundingBoxDescent
    const ia = metrics.actualBoundingBoxAscent
    const id = metrics.actualBoundingBoxDescent
    if (![fa, fd, ia, id].every(Number.isFinite)) return null
    const padTop = parseFloat(style.paddingTop) || 0
    const padBottom = parseFloat(style.paddingBottom) || 0
    const border = parseFloat(style.borderTopWidth) || 0
    const contentTop = rect.top + padTop + border
    const contentHeight = rect.height - padTop - padBottom - border
      - (parseFloat(style.borderBottomWidth) || 0)
    const declared = parseFloat(style.lineHeight)
    const lineBox = Number.isFinite(declared) ? declared : fa + fd
    const halfLeading = (lineBox - (fa + fd)) / 2
    const isFlex = style.display.includes('flex') || style.display.includes('grid')
    const centred = isFlex && style.alignItems === 'center'
    const lineTop = centred ? contentTop + (contentHeight - lineBox) / 2 : contentTop
    const baseline = lineTop + halfLeading + fa
    const inkCenter = baseline - ia + (ia + id) / 2
    return {
      text: text.slice(0, 10),
      delta: round(inkCenter - (rect.top + rect.height / 2)),
      contentH: round(contentHeight),
      lineBox: round(lineBox),
    }
  }

  const rows = []
  for (const target of TARGETS) {
    for (const element of document.querySelectorAll(`[class*="${target}"]`)) {
      const classes = (element.className || '').toString()
      /* 只要那个类名**正好是**其中一段，避免 `chip` 把 `chipBody` 也带上。 */
      if (!classes.split(' ').some((one) => one.endsWith(target))) continue
      const style = getComputedStyle(element)
      const radius = parseFloat(style.borderTopLeftRadius) || 0
      const rect = element.getBoundingClientRect()
      const reading = inkDelta(element)
      rows.push({
        want: target,
        classes: classes.slice(0, 46),
        tag: element.tagName.toLowerCase(),
        h: round(rect.height),
        radius: round(radius),
        pill: radius >= rect.height / 2 - 0.5,
        padBlock: `${round(parseFloat(style.paddingTop) || 0)} / ${round(parseFloat(style.paddingBottom) || 0)}`,
        delta: reading === null ? null : reading.delta,
        lineBox: reading === null ? null : reading.lineBox,
      })
      break
    }
  }
  return JSON.stringify({
    token: getComputedStyle(document.documentElement).getPropertyValue('--dsh-tb-optical-drop').trim(),
    rows,
  })
})()
