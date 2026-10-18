/**
 * 量「胶囊里的几样东西是不是同一族」。
 *
 * 读者报的是两种毛病，一量就能分开：
 *   1. **胶囊太窄** —— 量 `padding` 与内容宽，看图标槽与词之间有没有被挤；
 *   2. **图标与文案没有水平对齐** —— 量每个子元素的垂直中心，与胶囊中心相减。
 *
 * 「图标偏了」这件事靠 `align-items: center` 读不出来：flex 居中的是**盒子**，
 * 而一枚 svg 的盒心与它画出来的墨心不一定重合（icon 的 viewBox 里上下留白不等）。
 * 所以这里两样都量：盒心（`getBoundingClientRect`）与墨心（沿该元素的可见像素扫描），
 * 两者之差才是读者看到的那个偏移。
 *
 * 输出每行：pill / boxH / padL / padR / child / boxCenterY / deltaBox
 * 用法：node scripts/shot-panel.mjs --url file:///... --eval-file scripts/probes/probe-pill-geometry.js
 * 只读：不写 DOM、不改样式。
 */
(() => {
  const rows = []
  const round = value => Math.round(value * 100) / 100

  /* 「图标偏了」靠 `align-items: center` 读不出来：flex 居中居的是**盒子**，而一枚 svg
     的盒心与它画出来的墨心不一定重合（viewBox 里上下留白不等）。所以这里量的是墨心：
     文字用 `measureText` 的 `actualBoundingBox*`（真墨），svg 用它 `getBBox()` 的包围盒
     换算到屏幕坐标。盒心与墨心之差才是读者看见的那个偏移。 */
  const textInkCenterOf = (element) => {
    const text = element.textContent ?? ''
    if (text.trim() === '') return null
    const style = getComputedStyle(element)
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (context === null) return null
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const metrics = context.measureText(text)
    const ascent = metrics.actualBoundingBoxAscent
    const descent = metrics.actualBoundingBoxDescent
    const boxAscent = metrics.fontBoundingBoxAscent
    const boxDescent = metrics.fontBoundingBoxDescent
    if (ascent === undefined || boxAscent === undefined) return null
    const rect = element.getBoundingClientRect()
    const lineHeight = parseFloat(style.lineHeight)
    const lineBox = Number.isFinite(lineHeight) ? lineHeight : boxAscent + boxDescent
    const baseline = rect.top + (rect.height - lineBox) / 2 + (lineBox - (boxAscent + boxDescent)) / 2 + boxAscent
    return baseline - ascent + (ascent + descent) / 2
  }

  const svgInkCenterOf = (svg) => {
    const rect = svg.getBoundingClientRect()
    try {
      const box = svg.getBBox()
      if (box.height === 0) return rect.top + rect.height / 2
      const viewBox = svg.viewBox?.baseVal
      if (viewBox === undefined || viewBox.height === 0) {
        return rect.top + (box.y + box.height / 2) / Math.max(1, svg.height.baseVal.value) * rect.height
      }
      const scale = rect.height / viewBox.height
      return rect.top + (box.y + box.height / 2) * scale
    } catch {
      return rect.top + rect.height / 2
    }
  }

  /* 认领一枚胶囊**按结构，不按类名**：类名会被构建哈希，而探针不该知道某张表的类名。
     这里认三种：带 `data-dsh-tb-pilltext` 的可点控件（按钮家族）、组头（`<h2 data-size>`
     与 `role="presentation"` 的那一枚）、以及药丸族的任何祖先。 */
  const pillAncestorOf = (node) => {
    let current = node
    while (current !== null && current !== document.body) {
      if (current.matches('[data-dsh-tb-pilltext], [data-size], [role="presentation"] > *, [role="presentation"]')) return current
      current = current.parentElement
    }
    return null
  }
  const pills = [...document.querySelectorAll('[data-dsh-tb-pilltext], h2[data-size], [role="presentation"][data-size]')]
    .map(node => node.matches('[data-dsh-tb-pilltext]') ? pillAncestorOf(node) : node)
    .filter((node, index, all) => node !== null && all.indexOf(node) === index)

  for (const pill of pills) {
    const rect = pill.getBoundingClientRect()
    if (rect.height === 0) continue
    const style = getComputedStyle(pill)
    const centerY = rect.top + rect.height / 2
    const base = {
      pill: (pill.className || pill.tagName).toString().split(' ')[0],
      boxH: round(rect.height),
      boxW: round(rect.width),
      padL: round(parseFloat(style.paddingLeft) || 0),
      padR: round(parseFloat(style.paddingRight) || 0),
      padT: round(parseFloat(style.paddingTop) || 0),
      padB: round(parseFloat(style.paddingBottom) || 0),
      centerY: round(centerY),
    }
    const children = [...pill.querySelectorAll('svg, b, i, span')]
      .filter(node => (node.textContent ?? '').trim() !== '' || node.tagName.toLowerCase() === 'svg')
    for (const child of children) {
      const childRect = child.getBoundingClientRect()
      if (childRect.height === 0) continue
      const isSvg = child.tagName.toLowerCase() === 'svg'
      const inkCenter = isSvg ? svgInkCenterOf(child) : textInkCenterOf(child)
      if (inkCenter === null) continue
      rows.push({
        ...base,
        child: isSvg ? 'svg' : (child.textContent ?? '').trim().slice(0, 10),
        childH: round(childRect.height),
        childCenterY: round(childRect.top + childRect.height / 2),
        inkCenterY: round(inkCenter),
        // 正数 = 墨偏下；这才是读者看见的那个偏移。
        deltaInk: round(inkCenter - centerY),
      })
    }
  }

  if (rows.length === 0) return 'no pill with [data-dsh-tb-pilltext] found'
  const lines = rows.map(row =>
    `${row.pill} h=${row.boxH} w=${row.boxW} pad=${row.padL}/${row.padR}/${row.padT}/${row.padB} | ${row.child} childH=${row.childH} deltaInk=${row.deltaInk}`)
  const heights = [...new Set(rows.map(row => row.boxH))].sort((a, b) => a - b)
  lines.push(`distinct pill heights: ${heights.join(', ')}`)
  return lines.join('\n')
})()
