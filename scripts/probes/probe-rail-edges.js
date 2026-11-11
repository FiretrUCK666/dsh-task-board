// 三个盒子的右边缘到底在哪：面板、留言区那条带、评论区轨道。
//
// 「分界被弄坏了」这类报告只有在拿到坐标之后才可判：圆角按圆心画弧，两个盒子的右边缘
// 差 5px，两个弧就差 5px，屏上读作「两条边」。
(() => {
  const box = (selector) => {
    const element = document.querySelector(selector)
    if (element === null) return { selector, found: false }
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      selector,
      found: true,
      left: Math.round(rect.left * 100) / 100,
      right: Math.round(rect.right * 100) / 100,
      top: Math.round(rect.top * 100) / 100,
      bottom: Math.round(rect.bottom * 100) / 100,
      radiusEndEnd: style.borderEndEndRadius,
      background: style.backgroundColor,
      overflow: style.overflow,
      marginRight: style.marginRight,
      padRight: style.paddingRight,
    }
  }
  return {
    panel: box('[role="dialog"]'),
    body: box('[class*="reviewBody_"]'),
    rail: box('[class*="reviewRail_"]'),
    composer: box('[class*="reviewComposer"]'),
    folds: box('[class*="sessionRailFolds"]'),
    comments: box('#comments'),
  }
})()
