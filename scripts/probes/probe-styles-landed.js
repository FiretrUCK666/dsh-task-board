// 注入的 CSS 到底落地了没有？——顺手报出两个滚动体的计算样式。
//
// 这一支存在的原因很具体：一支探针读到「改了也没用」时，有两种可能，而它们的结论相反
// ——**改动没落地**，或者**落地了但没用**。不先分清这两件事，后面的每一个读数都是猜。
//
// 它读的是页面上**真实存在的**两个滚动体：评论列表与对话。
;;(() => {
  const read = (selector) => {
    const element = document.querySelector(selector)
    if (element === null) return { selector, found: false }
    const style = getComputedStyle(element)
    return {
      selector,
      found: true,
      willChange: style.willChange,
      transform: style.transform,
      contain: style.contain,
      contentVisibility: style.contentVisibility,
      overflowAnchor: style.overflowAnchor,
      backfaceVisibility: style.backfaceVisibility,
      scrollbarWidth: style.scrollbarWidth,
      room: element.scrollHeight - element.clientHeight,
    }
  }

  /* The ancestor that clips with a radius — the one under test. */
  const clipped = []
  for (const element of document.querySelectorAll('*')) {
    const style = getComputedStyle(element)
    const radius = style.borderTopLeftRadius
    if (radius === '0px') continue
    if (style.overflowY === 'visible' && style.overflowX === 'visible') continue
    clipped.push({
      name: `${element.tagName.toLowerCase()}.${typeof element.className === 'string'
        ? element.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''}`,
      radius,
      overflowY: style.overflowY,
      overflowX: style.overflowX,
    })
  }

  return {
    comments: read('#comments'),
    transcript: read('#transcript'),
    clippedAncestors: clipped.slice(0, 6),
    injected: document.querySelectorAll('style').length,
  }
})()
