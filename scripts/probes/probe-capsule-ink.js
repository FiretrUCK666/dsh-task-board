/**
 * 量「一枚胶囊里的字，在它自己的胶囊里到底偏了多少」。
 *
 * 与 `probe-ink-center.js` 的分工：那一条量的是**文字子槽**相对行盒的墨位（它回答
 * 「这一段字的墨是不是在自己的行里居中」）；这一条量的是**整枚胶囊**（盒子 + 内衬 +
 * 边框 + 子项），回答「读者看到的那个字，是不是在胶囊的正中」。
 *
 * 为什么必须要两个数：一个子槽可以在自己那一格里完美居中，而那一格本身并不在胶囊
 * 中央——上一版就是这样：`.segmentedButton` 用 `translateY` 抬整个盒子，子槽相对盒子
 * 永远是 0，可盒子已经不在轨道中央了。
 *
 * 判据三样一起给，缺一样就说不清：
 *   - `boxDelta`：**墨心** 相对 **胶囊盒心** 的偏移（px，正 = 墨偏下）
 *   - `padT` / `padB`：上下内衬（不对称就是「偏了」的机制）
 *   - `font`：字体族，因为同一个 `padding` 在不同字体下读出来的墨位不同
 *
 * 用法：node scripts/shot-panel.mjs --url file:///... --eval-file scripts/probes/probe-capsule-ink.js
 * 只读，不写任何文件。
 */
(() => {
  const round = value => Math.round(value * 100) / 100
  const canvas = document.createElement('canvas').getContext('2d')

  /** 一枚胶囊：有文字、有内衬、而且看得出来是个按得下去的东西。 */
  const isCapsule = (element) => {
    if (!['BUTTON', 'A', 'LABEL'].includes(element.tagName)) return false
    const rect = element.getBoundingClientRect()
    if (rect.width < 12 || rect.height < 12) return false
    const text = (element.textContent ?? '').trim()
    return text !== ''
  }

  const out = []
  for (const element of document.querySelectorAll('button, a, label')) {
    if (!isCapsule(element)) continue
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const text = (element.textContent ?? '').trim().slice(0, 14)

    /* 墨的上下沿：用 canvas 量**这段字**，字体取它实际渲染的那一档。 */
    canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const metrics = canvas.measureText(text)
    const ascent = metrics.actualBoundingBoxAscent
    const descent = metrics.actualBoundingBoxDescent
    if (!Number.isFinite(ascent) || !Number.isFinite(descent)) continue

    /* 字在盒里的垂直位置：基线由行盒决定，行盒由内衬挤在中部。
       我们不去推它，直接读子项的盒——那是浏览器真算出来的。 */
    const child = element.firstElementChild
    const lineBox = child !== null && child.getBoundingClientRect().height > 0
      ? child.getBoundingClientRect()
      : rect
    /* 基线在 lineBox 里的位置：半行距 + 字体的 ascent。 */
    const lineHeight = parseFloat(style.lineHeight)
    const resolvedLine = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : lineBox.height
    const fontAscent = metrics.fontBoundingBoxAscent
    const fontDescent = metrics.fontBoundingBoxDescent
    const halfLeading = (resolvedLine - (fontAscent + fontDescent)) / 2
    const baselineInLine = halfLeading + fontAscent

    /* 墨的上沿与下沿（页面坐标）。 */
    const inkTop = lineBox.top + baselineInLine - ascent
    const inkBottom = lineBox.top + baselineInLine + descent
    const inkCenter = (inkTop + inkBottom) / 2
    const boxCenter = rect.top + rect.height / 2

    out.push({
      text,
      cls: (element.className || '').toString().split(' ')[0].slice(0, 26),
      boxH: round(rect.height),
      padT: round(parseFloat(style.paddingTop) || 0),
      padB: round(parseFloat(style.paddingBottom) || 0),
      lineH: round(resolvedLine),
      inkH: round(descent + ascent),
      boxDelta: round(inkCenter - boxCenter),
      font: style.fontFamily.split(',')[0].replace(/["']/g, '').slice(0, 22),
    })
  }

  /* 只报**真的偏了**的那些（|delta| >= 0.5），按偏心从大到小——一屏上几十枚胶囊，
     全列出来等于没有重点。同时报总数，好让「全都没偏」也能被看见。 */
  const off = out.filter(one => Math.abs(one.boxDelta) >= 0.5)
  off.sort((a, b) => Math.abs(b.boxDelta) - Math.abs(a.boxDelta))
  return JSON.stringify({
    capsules: out.length,
    offCenter: off.length,
    worst: off.slice(0, 12),
  })
})()
