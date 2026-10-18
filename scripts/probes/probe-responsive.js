/**
 * 量「这一页在任何宽度下都没有坏掉」。
 *
 * 读者要的不是「窄屏能放下」，是**每一档都不莫名其妙**。肉眼在一档上看不出「这里溢出了
 * 0.5px」或「这一行有两个邻居叠在一起」，而这类问题在真实的 360/390/412/768 上都会出现。
 * 所以这一条量四件事，每一件都能判真假：
 *
 *   1. **横向溢出**：文档比视口宽（`scrollWidth > clientWidth`），任何一处都算坏——它是
 *      「右边被切掉」的唯一机械证据。
 *   2. **出框**：任何一个可见元素的右沿超过视口，或左沿小于 0（滚动体里面的不算，
 *      那些由第 3 条管）。
 *   3. **文字被压扁**：一个元素的内容盒比它的行盒还矮（`clientHeight < lineHeight`），
 *      字就在自己的盒子里被切——这是「胶囊太窄」那类问题的机械形态。
 *   4. **横向滚动体里的东西**：只有**明确标了** `overflow-x: auto|scroll` 的祖先才允许
 *      出框（看板的列条、清单左栏的横带），其余一律算坏。
 *
 * 输出：每个宽度一行 `width | overflow | out | squeezed | verdict`。
 * 用法：node scripts/shot-panel.mjs --url file:///... --eval-file scripts/probes/probe-responsive.js
 * 只读。
 */
(() => {
  const round = value => Math.round(value * 100) / 100
  const doc = document.documentElement
  const viewport = doc.clientWidth

  /** 谁在横向滚？它里面的东西出框是合法的。 */
  const scrollableAncestorOf = (element) => {
    let node = element.parentElement
    while (node !== null && node !== doc) {
      const style = getComputedStyle(node)
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') return node
      node = node.parentElement
    }
    return null
  }

  const out = []
  const squeezed = []

  for (const element of document.querySelectorAll('[data-dsh-taskboard-view] *')) {
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    const style = getComputedStyle(element)
    if (style.visibility === 'hidden' || style.display === 'none') continue

    /* 2. 出框（横向滚动体里面的除外）。 */
    if (scrollableAncestorOf(element) === null) {
      if (rect.right > viewport + 0.5 || rect.left < -0.5) {
        out.push({
          tag: element.tagName.toLowerCase(),
          cls: (element.className || '').toString().split(' ')[0].slice(0, 40),
          left: round(rect.left),
          right: round(rect.right),
          text: (element.textContent ?? '').trim().slice(0, 16),
        })
      }
    }

    /* 3. 文字被压扁：内容盒低于行盒，而且它自己就有文字。
     *
     * **只对「读者看得见的字」下结论。** 只给读屏的那一层（`clip-path: inset(50%)`、
     * 1px 盒子）是有意被压到 1px 的，把它算成缺陷等于让探针去改一个正确的东西——这正是
     * 硬性规范 14 说的那种「不看上下文的检查器」。判据因此读结构：被裁到 1px 的那一族
     * （`clip-path` 不是 `none`，或 `inline-size` 只有 1px）不参与。 */
    const lineHeight = parseFloat(style.lineHeight)
    const hasOwnText = [...element.childNodes].some(node => node.nodeType === 3 && (node.textContent ?? '').trim() !== '')
    const visuallyHidden = style.clipPath !== 'none' || rect.width <= 1 || rect.height <= 1
    if (!visuallyHidden && hasOwnText && Number.isFinite(lineHeight) && lineHeight > 0) {
      const padTop = parseFloat(style.paddingTop) || 0
      const padBottom = parseFloat(style.paddingBottom) || 0
      const borderTop = parseFloat(style.borderTopWidth) || 0
      const borderBottom = parseFloat(style.borderBottomWidth) || 0
      const contentBox = rect.height - padTop - padBottom - borderTop - borderBottom
      if (contentBox + 0.5 < lineHeight) {
        squeezed.push({
          tag: element.tagName.toLowerCase(),
          cls: (element.className || '').toString().split(' ')[0].slice(0, 40),
          contentBox: round(contentBox),
          lineHeight: round(lineHeight),
          text: (element.textContent ?? '').trim().slice(0, 16),
        })
      }
    }
  }

  const overflow = doc.scrollWidth - viewport
  const verdict = overflow > 1 || out.length > 0 || squeezed.length > 0 ? 'BROKEN' : 'ok'
  out.slice(0, 6).forEach(one => out.push(one))
  return JSON.stringify({
    viewport,
    overflow: round(overflow),
    out: out.slice(0, 6),
    outCount: out.length,
    squeezed: squeezed.slice(0, 6),
    squeezedCount: squeezed.length,
    verdict,
  })
})()
