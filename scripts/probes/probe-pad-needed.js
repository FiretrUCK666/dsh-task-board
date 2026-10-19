/**
 * 一次性回答：**A 档（令牌 0）与 B 档（令牌 = 2px）之间，每枚胶囊的墨心各移动了多少。**
 *
 * 上一版探针只测了一档令牌值，于是「移了多少」这个数没法与「需要移多少」对比。
 * 这一版同时测 0px 与 2px，用**线性**反推每枚胶囊需要的内衬：
 *
 *     盒子不动、墨只跟着内衬走，所以位移量与内衬成正比。
 *     测出 pad=2px 时位移 m，则到达 0 所需内衬 = 2 * delta0 / m。
 *
 * 于是每枚胶囊的**真实需求**是一个读数，不是一个假设。有了它才能回答「一个全局令牌
 * 能不能同时满足 28px 的按钮与 20px 是小件」。
 *
 * 输出：key / delta0 / movedAt2 / 需要的内衬(px)
 */
(() => {
  const round = (value) => Math.round(value * 100) / 100
  const canvas = document.createElement('canvas').getContext('2d')

  const inkDelta = (element) => {
    const rect = element.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    const rects = [...range.getClientRects()].filter((one) => one.height > 0)
    if (rects.length === 0) return null
    const line = rects[0]
    const textNode = [...element.childNodes]
      .find((node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== '')
    const textHost = textNode === undefined ? (element.querySelector('span') ?? element) : element
    const textStyle = getComputedStyle(textHost)
    const fontSize = parseFloat(textStyle.fontSize)
    const lineHeight = parseFloat(textStyle.lineHeight) || fontSize
    canvas.font = `${textStyle.fontStyle} ${textStyle.fontWeight} ${fontSize}px ${textStyle.fontFamily}`
    const m = canvas.measureText((element.textContent ?? '').trim() || '字')
    const fa = m.fontBoundingBoxAscent
    const fd = m.fontBoundingBoxDescent
    const ia = m.actualBoundingBoxAscent
    const id = m.actualBoundingBoxDescent
    if (![fa, fd, ia, id].every(Number.isFinite)) return null
    const leading = (lineHeight - (fa + fd)) / 2
    const baseline = line.top + leading + fa
    const inkMid = (baseline - ia + baseline + id) / 2
    return {
      key: (element.className || '').toString().split(' ')[0].slice(0, 28),
      text: (element.textContent ?? '').trim().slice(0, 8),
      boxH: round(rect.height),
      fontSize,
      lineHeight: round(lineHeight),
      lineBoxH: round(line.height),
      delta: round(inkMid - (rect.top + rect.height / 2)),
    }
  }

  const targets = []
  for (const element of document.querySelectorAll('button, a, label, span, textarea')) {
    const rect = element.getBoundingClientRect()
    if (rect.width < 20 || rect.height < 14 || rect.height > 56) continue
    if ((element.textContent ?? '').trim() === '') continue
    const style = getComputedStyle(element)
    const radius = parseFloat(style.borderTopLeftRadius) || 0
    if (radius < rect.height / 2 - 0.5) continue
    targets.push(element)
  }

  const sample = (value) => {
    if (value === null) document.documentElement.style.removeProperty('--dsh-tb-optical-drop')
    else document.documentElement.style.setProperty('--dsh-tb-optical-drop', value)
    void document.body.offsetHeight
    return targets.map(inkDelta)
  }

  const zero = sample('0px')
  const two = sample('2px')
  sample(null)

  const byKey = new Map()
  for (let i = 0; i < targets.length; i += 1) {
    const a = zero[i]
    const b = two[i]
    if (a === null || b === null) continue
    const moved = b.delta - a.delta
    /* 2px 内衬产生了 |moved| 的位移；要把 a.delta 归零需要多少内衬。 */
    const need = Math.abs(moved) < 0.01 ? null : Math.abs(round((a.delta * 2) / moved) * 2) / 2
    const row = {
      key: a.key,
      text: a.text,
      boxH: a.boxH,
      fontSize: a.fontSize,
      lineHeight: a.lineHeight,
      lineBoxH: a.lineBoxH,
      delta0: a.delta,
      movedAt2: round(moved),
      needPad: need,
    }
    const seen = byKey.get(row.key)
    if (seen === undefined || Math.abs(row.delta0) > Math.abs(seen.delta0)) byKey.set(row.key, row)
  }

  return JSON.stringify({
    rows: [...byKey.values()].sort((a, b) => Math.abs(b.delta0) - Math.abs(a.delta0)),
  })
})()
