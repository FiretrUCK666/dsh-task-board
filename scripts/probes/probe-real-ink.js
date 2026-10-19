/**
 * 真正的判据：**把字画进一个和按钮一模一样的盒子里，看它的墨落在哪。**
 *
 * ── 为什么之前那个公式不够 ────────────────────────────────────────────────
 *
 * `ink-metrics.ts` 用 `fontBoundingBox*` 当「盒子」，但浏览器排一行字时用的不是
 * fontBoundingBox。它用**内容区**（盒高减内衬减边）与 **`line-height`**：
 *
 *     lineBox  = line-height
 *     leading  = (lineBox − (fontAsc + fontDesc)) / 2
 *     baseline = 内容区顶 + leading + fontAsc
 *     墨心     = baseline − inkAsc + (inkAsc + inkDesc) / 2
 *     盒心     = 盒高 / 2（含内衬）
 *
 * 于是「墨偏下多少」同时取决于**盒高**、**行高**、**内衬**与字体四个度量。只拿字体
 * 度量去推，等于假设盒子恰好等于行盒——本项目里从来没有这个假设。
 *
 * 这条探针把公式整个换掉：用离屏 canvas **按真实盒子的尺寸与行高画一遍**，再扫像素找
 * 墨。它不依赖任何「字体度量代表盒子」的假设。
 *
 * 用法：--eval-file 本文件；输出每一种「盒高 × 字号 × 行高」组合的墨心偏移。
 */
(() => {
  const round = (value) => Math.round(value * 100) / 100
  const probe = document.createElement('canvas')
  const ctx = probe.getContext('2d')
  const family = getComputedStyle(document.body).fontFamily

  /**
   * 把一行字画进 `boxH` 高、`lineHeight` 行高的盒子里，量墨心相对盒心的偏移。
   * @returns 正数 = 墨偏下（px）
   */
  const measure = (text, fontSize, lineHeight, boxH, weight) => {
    const scale = 4 // 超采样，亚像素才看得出来
    probe.width = Math.ceil(fontSize * 6 * scale)
    probe.height = Math.ceil(boxH * scale)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, probe.width, probe.height)
    ctx.scale(scale, scale)
    ctx.fillStyle = '#000'
    ctx.font = `${weight} ${fontSize}px ${family}`
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'

    /* 基线：内容区 = 整盒（内衬不计，和 `align-items:center` 的 flex 盒子一致），
       行盒在内容区里垂直居中，基线 = 行盒顶 + leading + fontAsc。 */
    const m = ctx.measureText(text)
    const fontAsc = m.fontBoundingBoxAscent
    const fontDesc = m.fontBoundingBoxDescent
    const leading = (lineHeight - (fontAsc + fontDesc)) / 2
    const lineTop = (boxH - lineHeight) / 2
    const baseline = lineTop + leading + fontAsc
    ctx.fillText(text, 0, baseline)

    /* 扫像素找墨的上下沿。 */
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data
    let top = -1
    let bottom = -1
    for (let y = 0; y < probe.height; y += 1) {
      let has = false
      for (let x = 0; x < probe.width; x += 1) {
        if (data[(y * probe.width + x) * 4 + 3] > 40) { has = true; break }
      }
      if (has) { if (top < 0) top = y; bottom = y }
    }
    if (top < 0) return null
    const inkMid = (top + bottom + 1) / 2 / scale
    return { offset: inkMid - boxH / 2, inkH: (bottom - top + 1) / scale, fontAsc, fontDesc }
  }

  /* 本项目真实存在的组合：按钮 28px / 13px 字 / 1em 行高；小件 20px / 12px；
     页签 26px / 13px；芯片 20px / 12px 行高 16px。 */
  const cases = [
    { name: '按钮 28px · 13px · 1em', fontSize: 13, lineHeight: 13, boxH: 28 },
    { name: '按钮 28px · 12px · 1em', fontSize: 12, lineHeight: 12, boxH: 28 },
    { name: '页签 26px · 13px · 1em', fontSize: 13, lineHeight: 13, boxH: 26 },
    { name: '小件 20px · 12px · 1em', fontSize: 12, lineHeight: 12, boxH: 20 },
    { name: '芯片 20px · 12px · 16px', fontSize: 12, lineHeight: 16, boxH: 20 },
    { name: '芯片 20px · 11px · 16px', fontSize: 11, lineHeight: 16, boxH: 20 },
    { name: '行内 24px · 13px · 1em', fontSize: 13, lineHeight: 13, boxH: 24 },
  ]

  const rows = []
  for (const one of cases) {
    for (const weight of ['400', '500', '600']) {
      const reading = measure('任务清单', one.fontSize, one.lineHeight, one.boxH, weight)
      if (reading === null) continue
      rows.push({
        name: weight === '500' ? one.name : '',
        weight,
        fontSize: one.fontSize,
        lineHeight: one.lineHeight,
        boxH: one.boxH,
        offset: round(reading.offset),
        inkH: round(reading.inkH),
      })
    }
  }
  return JSON.stringify({ family: family.split(',')[0], rows })
})()
