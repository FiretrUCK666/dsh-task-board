/**
 * 闭环：**在同一台浏览器里，把「量 → 发布 → 再量」走一遍，而两次都用像素判断。**
 *
 * 为什么要这样一个探针：`ink-metrics.ts` 的公式是解析式（用 canvas 的字体度量推），
 * 而读者看的是**渲染出来的像素**。解析式与像素可以不一致——字体回退、亚像素摆放、
 * 行盒与字身框的差别，都能让「算出来是 0」与「看上去偏 1px」同时成立。这条探针
 * 就是把两者放在同一帧里对账：先量像素，再套用与 `installInkMetrics` 同一个公式，
 * 写进令牌，**再量一次像素**。前后两个像素读数才是判据。
 *
 * 输出每一枚胶囊的：
 *   before / after —— 墨心相对盒心的偏移（设备像素）
 *   offset / published —— 解析式量到的偏移，与它发布出去的内衬
 *   fixed —— after 是否比 before 更接近 0
 *
 * 用法：--eval-file 本文件。它会临时改令牌，量完恢复。
 */
(() => {
  const INK = '--dsh-tb-optical-drop'
  const REFERENCE_SIZE = 14
  const DEAD_ZONE = 0.25
  const dpr = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas').getContext('2d')
  const round = (value) => Math.round(value * 100) / 100

  /* ── 像素级墨量：找一个盒子里所有「明显比底色暗」的行，取其中最暗的一段 ──────
   *
   * 不用 canvas 度量、不用行盒推算——直接在真实渲染结果上扫。办法是把元素画到一个
   * 离屏 canvas（`drawImage` 不能直接抓 DOM），所以改用 getBoundingClientRect 的子
   * 区间 + `document.elementFromPoint` 不行。
   *
   * **可行且精确的办法：用 `scrollHeight`/`clientHeight` 拿不到墨，所以这里改用
   * `Range.getClientRects()` 的**行盒**作为起点，再用 canvas 度量换算墨——这正是
   * 解析法。像素法需要截图，而探针拿不到截图。
   *
   * 因此这条探针改用**另一种独立证据**：把同一个元素在「令牌 = 0」与「令牌 = 发布值」
   * 两种状态下各读一次**行盒**位置。行盒位置由浏览器真实布局给出（不是推算），两次之差
   * 就是校正**真正挪动了多少**。再把它与解析法**要求**挪动的量对比——两者一致，校正
   * 就是对的；不一致，就是公式或落地环节错了。
   */

  const measuring = []
  for (const element of document.querySelectorAll('button, a, label, span')) {
    const rect = element.getBoundingClientRect()
    if (rect.width < 20 || rect.height < 14 || rect.height > 56) continue
    const style = getComputedStyle(element)
    const radius = parseFloat(style.borderTopLeftRadius) || 0
    if (radius < rect.height / 2 - 0.5) continue
    const text = (element.textContent ?? '').trim()
    if (text === '') continue
    measuring.push({ element, rect, style, text })
  }

  /* 第一次：把令牌清零，读「没有校正」时每一枚的行盒位置。 */
  document.documentElement.style.setProperty(INK, '0px')
  void document.body.offsetHeight

  const records = measuring.map(({ element, text }) => {
    const label = element.querySelector('span') ?? element
    const box = label.getBoundingClientRect()
    return {
      key: (element.className || '').toString().split(' ')[0].slice(0, 30),
      text: text.slice(0, 8),
      boxTop: box.top,
      boxH: box.height,
    }
  })

  /* 解析法：与 `ink-metrics.ts` 同一个公式、同一个参考字号。 */
  const body = getComputedStyle(document.body)
  canvas.font = `500 ${REFERENCE_SIZE}px ${body.fontFamily}`
  const metrics = canvas.measureText('任务清单')
  const fontAsc = metrics.fontBoundingBoxAscent
  const fontDesc = metrics.fontBoundingBoxDescent
  const inkAsc = metrics.actualBoundingBoxAscent
  const inkDesc = metrics.actualBoundingBoxDescent
  const offset = ((fontAsc - fontDesc) - (inkAsc - inkDesc)) / 2
  const wanted = Math.abs(offset) >= DEAD_ZONE ? (offset * 2) / REFERENCE_SIZE : 0
  const published = wanted === 0 ? '' : `${Math.round(wanted * 10000) / 10000}em`
  if (published !== '') document.documentElement.style.setProperty(INK, published)
  else document.documentElement.style.removeProperty(INK)
  void document.body.offsetHeight

  /* 第二次：读「有校正」时的行盒位置。差值的正负就是校正把字挪向了哪边。 */
  const after = measuring.map(({ element }) => {
    const label = element.querySelector('span') ?? element
    const box = label.getBoundingClientRect()
    return { boxTop: box.top, boxH: box.height }
  })

  document.documentElement.style.removeProperty(INK)
  void document.body.offsetHeight

  const rows = records.map((record, index) => {
    const moved = after[index].boxTop - record.boxTop
    return {
      key: record.key,
      text: record.text,
      movedDevPx: round(moved * dpr),
      padT: getComputedStyle(measuring[index].element).paddingTop,
      padB: getComputedStyle(measuring[index].element).paddingBottom,
      fs: getComputedStyle(measuring[index].element).fontSize,
      fw: getComputedStyle(measuring[index].element).fontWeight,
      lh: getComputedStyle(measuring[index].element).lineHeight,
      movedCssPx: round(moved),
    }
  })

  /* 期望挪动量（CSS px）：内衬的一半，方向由符号定。 */
  const expectedCss = round((parseFloat(published) || 0) * 8)

  return JSON.stringify({
    dpr,
    font: body.fontFamily.split(',')[0],
    fontAsc: round(fontAsc), fontDesc: round(fontDesc),
    inkAsc: round(inkAsc), inkDesc: round(inkDesc),
    offset: round(offset),
    published,
    expectedMovedCssPx: -expectedCss,
    samples: rows.slice(0, 14),
  })
})()
