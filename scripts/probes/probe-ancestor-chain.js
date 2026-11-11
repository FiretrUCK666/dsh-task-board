// 真实页面上，滚动体的祖先链长什么样——特别是「谁在裁切、谁有圆角」。
//
// 这一支只读 DOM，不改任何东西。它回答一个问题：`border-radius` + `overflow: hidden`
// 这一对，在真实面板里是长在哪一层的。
;;(() => {
  const REPORT = []

  /** 一个盒子的关键几何与裁切相关的计算值。 */
  const describe = (element) => {
    const style = getComputedStyle(element)
    const radius = [style.borderTopLeftRadius, style.borderTopRightRadius,
      style.borderBottomRightRadius, style.borderBottomLeftRadius]
    const anyRadius = radius.some(one => one !== '0px')
    return {
      name: `${element.tagName.toLowerCase()}${element.id === '' ? '' : `#${element.id}`}`
        + `${typeof element.className === 'string' && element.className !== ''
          ? `.${element.className.split(' ').filter(Boolean).join('.')}` : ''}`,
      overflowY: style.overflowY,
      overflowX: style.overflowX,
      radius: anyRadius ? radius.join(' ') : '0',
      clips: style.overflowY !== 'visible' || style.overflowX !== 'visible',
      contain: style.contain,
      willChange: style.willChange,
      transform: style.transform === 'none' ? 'none' : 'yes',
      isolation: style.isolation,
      scrolls: element.scrollHeight - element.clientHeight > 4,
      room: element.scrollHeight - element.clientHeight,
    }
  }

  /** Walk up from a node, describing each ancestor. */
  const chainOf = (selector) => {
    const start = document.querySelector(selector)
    if (start === null) return { selector, found: false, chain: [] }
    const chain = []
    let node = start
    while (node !== null && node !== document.documentElement) {
      chain.push(describe(node))
      node = node.parentElement
    }
    return { selector, found: true, chain }
  }

  for (const selector of ['.commentsScroll', '#transcript', '[class*="reviewTranscriptScroll"]']) {
    const result = chainOf(selector)
    if (result.found) REPORT.push(result)
  }

  /* Every scrollable box on the page, so nothing is missed by a guessed selector. */
  const scrollers = []
  for (const element of document.querySelectorAll('*')) {
    const style = getComputedStyle(element)
    if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue
    const room = element.scrollHeight - element.clientHeight
    if (room <= 4) continue
    const chain = []
    let node = element.parentElement
    let depth = 0
    while (node !== null && depth < 6) {
      const one = describe(node)
      if (one.clips || one.radius !== '0') chain.push({ ...one, depth })
      node = node.parentElement
      depth += 1
    }
    scrollers.push({ ...describe(element), chain })
  }

  return { chains: REPORT, scrollers }
})()
