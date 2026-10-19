/**
 * 量每一个胶囊的墨心偏移，**全部列出来**，不筛「最差的十二个」。
 *
 * 与 `probe-capsule-ink.js` 的分工：那一条用来一眼看出「还有没有歪的」，只报超过半个
 * 像素的那些；这一条用来判**一条规则到底需不需要墨位校正**——它把每一枚都算出来，
 * 连同它自己的居中机制（`align-items` / 行盒 / 内衬），于是「该不该补」是读数说了算，
 * 不是读注释说了算。
 *
 * 输出一行 JSON：{ rows: [{key, text, boxH, padT, padB, lineH, align, delta, mech}] }
 * 用法：node scripts/shot-panel.mjs --url file:///... --eval-file scripts/probes/probe-capsule-census.js
 * 只读，不写任何文件。
 */
(() => {
  const round = (value) => Math.round(value * 100) / 100
  const canvas = document.createElement('canvas').getContext('2d')
  const rows = []

  /* 只量**装字的**盒子：有可见文字、够高装下一行。图形、槽、进度条不在这里。 */
  for (const element of document.querySelectorAll('button, a, label, span, div, p, li, input, select')) {
    const rect = element.getBoundingClientRect()
    if (rect.width < 12 || rect.height < 10 || rect.height > 56) continue
    const style = getComputedStyle(element)
    const radius = Math.max(parseFloat(style.borderTopLeftRadius) || 0, parseFloat(style.borderTopRightRadius) || 0)
    /* 胶囊：圆角够圆（不小于半高的一半），或者干脆等于 999。 */
    if (radius < 8 && radius < rect.height / 2 - 0.5) continue

    const own = Array.from(element.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent ?? '')
      .join('')
    const text = (own === '' ? element.textContent ?? '' : own).trim()
    if (text === '') continue

    canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const metrics = canvas.measureText(text.slice(0, 20))
    const fontAscent = metrics.fontBoundingBoxAscent
    const fontDescent = metrics.fontBoundingBoxDescent
    const inkAscent = metrics.actualBoundingBoxAscent
    const inkDescent = metrics.actualBoundingBoxDescent
    if (![fontAscent, fontDescent, inkAscent, inkDescent].every(Number.isFinite)) continue

    /* 基线：行盒（由 line-height 决定）在内衬之间垂直居中，基线在行盒里是
       `halfLeading + fontAscent`。盒子是高是矮、由 flex 居中还是由行盒撑满，
       这一条算式都成立——它只问「行盒在哪」，不问它是怎么到那儿的。 */
    const padTop = parseFloat(style.paddingTop) || 0
    const padBottom = parseFloat(style.paddingBottom) || 0
    const contentTop = rect.top + padTop + (parseFloat(style.borderTopWidth) || 0)
    const contentHeight = rect.height - padTop - padBottom
      - (parseFloat(style.borderTopWidth) || 0) - (parseFloat(style.borderBottomWidth) || 0)
    const declared = parseFloat(style.lineHeight)
    const lineBox = Number.isFinite(declared) ? declared : fontAscent + fontDescent
    const halfLeading = (lineBox - (fontAscent + fontDescent)) / 2
    /* 字在内容盒里怎么落：flex/grid 的 `align-items: center` 把**行盒**居中；
       其余情况行盒从内容盒顶部开始堆。两者算出来的基线起点不同。 */
    const isFlex = style.display.includes('flex') || style.display.includes('grid')
    const centred = isFlex && style.alignItems === 'center'
    const lineTop = centred
      ? contentTop + (contentHeight - lineBox) / 2
      : contentTop
    const baseline = lineTop + halfLeading + fontAscent
    const inkCenter = baseline - inkAscent + (inkAscent + inkDescent) / 2
    const boxCenter = rect.top + rect.height / 2

    rows.push({
      key: (element.className || '').toString().split(' ')[0].slice(0, 32),
      text: text.slice(0, 12),
      boxH: round(rect.height),
      padT: round(padTop),
      padB: round(padBottom),
      lineH: round(lineBox),
      align: style.alignItems,
      display: style.display,
      delta: round(inkCenter - boxCenter),
      mech: centred ? 'centre' : 'flow',
    })
  }

  /* 同一枚类名常常出现很多次，按类名收一份最差值就够判「这条规则对不对」。 */
  const byKey = new Map()
  for (const row of rows) {
    const seen = byKey.get(row.key)
    if (seen === undefined || Math.abs(row.delta) > Math.abs(seen.delta)) byKey.set(row.key, row)
  }
  return JSON.stringify({ rows: [...byKey.values()] })
})()
