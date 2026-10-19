/**
 * 量**真实渲染出来的胶囊**：用截图级别的办法（把元素搬到 sheet 的 canvas 里画不了），
 * 所以改用**像素差**——把同一枚元素在「令牌 0」与「令牌 X」两档下各截一次，逐行比较
 * 哪一行开始有墨，就得到「墨真的挪了多少」。
 *
 * 但这条探针没法截图。于是它用**浏览器自己给的布局数**：
 *   - `Range.getClientRects()` 给出**行盒**的矩形（真实布局，不是推算）；
 *   - `canvas.measureText` 给出墨相对**基线**的上下沿（字体度量）；
 *   - 基线在行盒里的位置 = `leading + fontAsc`，而 `leading` 由 `line-height` 定。
 *
 * 这就是完整的解析式，且**行盒来自真实布局**——上一版的错误是假设「行盒 = 盒高」，
 * 而现在盒子高度、内衬、line-height 全部从 `getComputedStyle` 取真值。
 */
(() => {
  const round = (value) => Math.round(value * 100) / 100
  const canvas = document.createElement('canvas').getContext('2d')
  const dpr = window.devicePixelRatio || 1

  /** 一枚元素里那一行字的墨心，相对它自己边框盒的中心。 */
  const inkDelta = (element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    /* 找真正装字的那一行：用 Range 圈住元素的文本。 */
    const range = document.createRange()
    range.selectNodeContents(element)
    const rects = [...range.getClientRects()].filter((one) => one.height > 0)
    if (rects.length === 0) return null
    const line = rects[0]

    /* 这段字的字体：从**装字的那一层**读，不是从外层按钮读。 */
    const textNode = [...element.childNodes].find((node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== '')
    const textHost = textNode === undefined
      ? element
      : (element.querySelector('span') ?? element)
    const textStyle = getComputedStyle(textHost)
    const fontSize = parseFloat(textStyle.fontSize)
    const lineHeight = parseFloat(textStyle.lineHeight) || fontSize

    canvas.font = `${textStyle.fontStyle} ${textStyle.fontWeight} ${fontSize}px ${textStyle.fontFamily}`
    const metrics = canvas.measureText((element.textContent ?? '').trim() || '字')
    const fontAsc = metrics.fontBoundingBoxAscent
    const fontDesc = metrics.fontBoundingBoxDescent
    const inkAsc = metrics.actualBoundingBoxAscent
    const inkDesc = metrics.actualBoundingBoxDescent
    if (![fontAsc, fontDesc, inkAsc, inkDesc].every(Number.isFinite)) return null

    const leading = (lineHeight - (fontAsc + fontDesc)) / 2
    const baseline = line.top + leading + fontAsc
    const inkTop = baseline - inkAsc
    const inkBottom = baseline + inkDesc
    const inkMid = (inkTop + inkBottom) / 2
    const boxMid = rect.top + rect.height / 2

    return {
      key: (element.className || '').toString().split(' ')[0].slice(0, 28),
      text: (element.textContent ?? '').trim().slice(0, 8),
      boxH: round(rect.height),
      fontSize,
      lineHeight: round(lineHeight),
      lineBoxH: round(line.height),
      inkH: round(inkAsc + inkDesc),
      /* 正 = 墨偏下 */
      declDelta: round(inkMid - boxMid),
    }
  }

  /* 同一枚元素在令牌 0 与令牌 X 两档下各量一次：**差值就是校正真正兑现了多少**。 */
  const targets = []
  for (const element of document.querySelectorAll('button, a, label, span')) {
    const rect = element.getBoundingClientRect()
    if (rect.width < 20 || rect.height < 14 || rect.height > 56) continue
    if ((element.textContent ?? '').trim() === '') continue
    const style = getComputedStyle(element)
    const radius = parseFloat(style.borderTopLeftRadius) || 0
    if (radius < rect.height / 2 - 0.5) continue
    targets.push(element)
  }

  document.documentElement.style.setProperty('--dsh-tb-optical-drop', '0px')
  void document.body.offsetHeight
  const zero = targets.map(inkDelta)

  document.documentElement.style.setProperty('--dsh-tb-optical-drop', '1px')
  void document.body.offsetHeight
  const withToken = targets.map(inkDelta)

  document.documentElement.style.removeProperty('--dsh-tb-optical-drop')
  void document.body.offsetHeight

  const rows = []
  for (let i = 0; i < targets.length; i += 1) {
    if (zero[i] === null || withToken[i] === null) continue
    rows.push({
      ...zero[i],
      /* 令牌生效后墨心相对盒心还差多少；以及它一共挪了多少。 */
      afterDelta: withToken[i].inkH === null ? null : round(withToken[i].declDelta),
      moved: round(withToken[i].declDelta - zero[i].declDelta),
    })
  }

  const byKey = new Map()
  for (const row of rows) {
    const seen = byKey.get(row.key)
    if (seen === undefined || Math.abs(row.declDelta) > Math.abs(seen.declDelta)) byKey.set(row.key, row)
  }

  return JSON.stringify({
    dpr,
    total: rows.length,
    worstAtZero: [...byKey.values()].sort((a, b) => Math.abs(b.declDelta) - Math.abs(a.declDelta)).slice(0, 12),
  })
})()
