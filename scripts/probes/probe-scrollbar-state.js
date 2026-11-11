// 滚动条到底还在不在、多宽、颜色是什么——按计算值回答，不靠看图猜。
;;(() => {
  const read = (selector) => {
    const element = document.querySelector(selector)
    if (element === null) return { selector, found: false }
    const style = getComputedStyle(element)
    return {
      selector,
      found: true,
      overflowY: style.overflowY,
      widthFromRect: Math.round(element.getBoundingClientRect().width),
      clientWidth: element.clientWidth,
      lane: Math.round(element.getBoundingClientRect().width - element.clientWidth),
      scrollBarToken: style.getPropertyValue('--dsh-tb-scroll-bar').trim(),
      insetToken: style.getPropertyValue('--dsh-tb-scroll-inset').trim(),
      thumbColor: style.getPropertyValue('--dsh-tb-scroll-thumb-color').trim(),
      scrollbarWidthProp: style.scrollbarWidth,
      room: element.scrollHeight - element.clientHeight,
    }
  }
  return {
    comments: read('#comments'),
    transcript: read('#transcript'),
    viewMarkerPresent: document.querySelector('[data-dsh-taskboard-view]') !== null,
    panelMarkerPresent: document.querySelector('[data-dsh-taskboard-panel]') !== null,
    sheets: document.querySelectorAll('style').length,
  }
})()
