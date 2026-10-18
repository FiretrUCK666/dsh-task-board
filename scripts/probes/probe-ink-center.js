/**
 * 量「字有没有落在它自己那个盒子的中间」。
 *
 * 为什么不能用行盒：`Range.getClientRects()` 报的是**行盒**，它上下对称，半像素的
 * 偏移读出来正好是 0。读者看见的那点墨要靠 `ctx.measureText()` 的
 * `actualBoundingBoxAscent/Descent`（墨的真实上下沿）与 `fontBoundingBox*`（基线位置）
 * 一起算，两者之差才是「偏上/偏下」。
 *
 * 输出每一行：label / 文本 / delta（正数=偏下，负数=偏上）/ 盒高 / 墨高。
 * 用法：
 *   node scripts/shot-panel.mjs --url file:///... --eval-file scripts/probes/probe-ink-center.js
 * 只读：不写 DOM、不改样式，量完就走。
 *
 * ── 它与 `probe-item-capsules.js` 分工不同，两个数都对 ────────────────────────
 *
 * 本探针量的是「**内容盒**中心与墨心之差」：它答的是「墨位校正有没有把字放正」。
 * 那个探针量的是「**边框盒**中心与墨心之差」：它答的是「这个控件看上去正不正」——
 * 两句话差着一份内衬，所以本探针读 −0.02、那个读 −0.98 是**同一枚按钮**。
 *
 * 判「字在它自己那格字里居中吗」读本探针；判「一个控件的视觉重心在哪」读那个。
 * 只拿一个数的结论去改样式，改的会是另一个问题。
 */
(() => {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (context === null) return 'no 2d context'
  const rows = []

  const measure = (box, label, text) => {
    const rect = box.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const style = getComputedStyle(box)
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const metrics = context.measureText(text === '' ? box.textContent ?? '' : text)
    const boxAscent = metrics.fontBoundingBoxAscent
    const boxDescent = metrics.fontBoundingBoxDescent
    const inkAscent = metrics.actualBoundingBoxAscent
    const inkDescent = metrics.actualBoundingBoxDescent
    if (boxAscent === undefined || inkAscent === undefined) return
    /* 量的是**内容盒**，不是边框盒：`align-items: center` 居中内容盒，而控件的墨位
       校正正是靠一档下内衬做的（见 `--dsh-tb-optical-drop`）。按边框盒算会把内衬当成
       「本来就该有的空气」，于是校正生效了读数却一动不动——一个量错的探针比没有更糟。 */
    const padTop = parseFloat(style.paddingTop) || 0
    const padBottom = parseFloat(style.paddingBottom) || 0
    const contentTop = rect.top + padTop
    const contentHeight = rect.height - padTop - padBottom
    const baseline = contentTop + (contentHeight - (boxAscent + boxDescent)) / 2 + boxAscent
    const inkCenter = baseline - inkAscent + (inkAscent + inkDescent) / 2
    const boxCenter = rect.top + rect.height / 2
    rows.push({
      label,
      text: (text === '' ? box.textContent ?? '' : text).trim().slice(0, 8),
      delta: Number((inkCenter - boxCenter).toFixed(2)),
      boxH: Number(rect.height.toFixed(1)),
      inkH: Number((inkAscent + inkDescent).toFixed(1)),
    })
  }

  document.querySelectorAll('[class*="workbenchTabLabel"]').forEach((element, index) => {
    measure(element.parentElement ?? element, `tab-${index}`, element.textContent ?? '')
  })
  document.querySelectorAll('button').forEach((element, index) => {
    if (index > 24) return
    const text = (element.textContent ?? '').trim()
    if (text === '') return
    measure(element, `button-${index}`, text)
  })
  document.querySelectorAll('[class*="chip"]').forEach((element, index) => {
    if (index > 10) return
    const text = (element.textContent ?? '').trim()
    if (text === '') return
    measure(element, `chip-${index}`, text)
  })

  console.log(JSON.stringify(rows, null, 0))
  return rows
})()
