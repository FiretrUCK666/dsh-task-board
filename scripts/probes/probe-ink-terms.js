/**
 * **把算式里的每一个中间量打出来**，好和「扫出来的答案」对账。
 *
 * 要对的两头：
 *   - 算式给出的 `P`（`2 × (B − C + K)`）；
 *   - 扫出来的 `P`（内衬扫到哪一档，墨才落在盒心）。
 *
 * 两者对不上时，**看中间量**：是基线读错了、内容盒中心读错了，还是 canvas 那个
 * 「渲染后的墨」读错了。
 *
 * 用法：`--eval-file` 本文件；用 `?pick=` 指定要看哪一枚。
 */
(() => {
  const params = new URLSearchParams(location.search)
  const pick = params.get('pick') ?? '.itemOpt'
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  /** canvas 上画一遍，量墨相对基线偏了多少。 */
  const renderedOffset = (style, text, phase) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#000000'
    const baseline = 64 + phase
    ctx.fillText(text, 8, baseline)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let top = -1
    let bottom = -1
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const i = (y * canvas.width + x) * 4
        if (data[i] < 128) {
          if (top < 0) top = y
          bottom = y
          break
        }
      }
    }
    if (top < 0) return null
    return (top + bottom) / 2 - baseline
  }

  const rows = []
  for (const element of document.querySelectorAll(pick)) {
    if (rows.length >= 3) break
    const boxStyle = getComputedStyle(element)
    if (boxStyle.getPropertyValue('--dsh-tb-optical-target').trim() !== '1') continue
    const rect = element.getBoundingClientRect()
    let holder = element
    const hasOwn = [...element.childNodes]
      .some((node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== '')
    if (!hasOwn) {
      holder = [...element.querySelectorAll('*')].find((one) =>
        [...one.childNodes].some((node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== ''))
      if (holder === undefined) continue
    }
    const text = (holder.textContent ?? '').trim()
    if (text === '') continue
    const holderStyle = getComputedStyle(holder)
    const size = parseFloat(holderStyle.fontSize)
    ctx.font = `${holderStyle.fontStyle} ${holderStyle.fontWeight} ${size}px ${holderStyle.fontFamily}`
    const m = ctx.measureText(text)
    const strut = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent
    const lineHeight = parseFloat(holderStyle.lineHeight)
    const used = Number.isFinite(lineHeight) ? lineHeight : strut

    const range = document.createRange()
    range.selectNodeContents(holder)
    const lines = [...range.getClientRects()].filter((one) => one.height > 0)
    if (lines.length === 0) continue
    const line = lines[0]
    const baseline = line.top + Math.max((used - strut) / 2 + m.fontBoundingBoxAscent, m.fontBoundingBoxAscent)

    const padTop = parseFloat(boxStyle.paddingTop) || 0
    const padBottom = parseFloat(boxStyle.paddingBottom) || 0
    const borderTop = parseFloat(boxStyle.borderTopWidth) || 0
    const borderBottom = parseFloat(boxStyle.borderBottomWidth) || 0
    const contentMid = (rect.top + borderTop + padTop + rect.bottom - borderBottom - padBottom) / 2
    const phase = baseline - Math.floor(baseline)
    const K = renderedOffset(holderStyle, text, phase)

    rows.push({
      text: text.slice(0, 10),
      box: `${rect.top.toFixed(2)}..${rect.bottom.toFixed(2)}`,
      pad: `${padTop}/${padBottom}`,
      border: `${borderTop}/${borderBottom}`,
      contentMid: Number(contentMid.toFixed(2)),
      lineTop: Number(line.top.toFixed(2)),
      lineH: Number(line.height.toFixed(2)),
      baseline: Number(baseline.toFixed(2)),
      phase: Number(phase.toFixed(3)),
      K: K === null ? null : Number(K.toFixed(2)),
      BmC: Number((baseline - contentMid).toFixed(2)),
      P: Number((2 * (baseline - contentMid + (K ?? 0))).toFixed(2)),
      fontSize: holderStyle.fontSize,
      lineHeightStyle: holderStyle.lineHeight,
    })
  }
  return JSON.stringify(rows)
})()
