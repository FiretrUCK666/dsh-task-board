// 三种浮层在「面板不再裁切、圆角由各段自己承担」之后的样子。
//
// 这一页只做一件事：并排渲染同一个面板在改法前后两版的四角裁切图，四倍放大。
// 四角必须**逐像素相同**——圆角是这套材料的签名，修性能不能拿它去换。
;;(() => {
  const shot = (selector) => {
    const element = document.querySelector(selector)
    if (element === null) return null
    const rect = element.getBoundingClientRect()
    return {
      selector,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      radius: getComputedStyle(element).borderTopLeftRadius,
      overflow: getComputedStyle(element).overflowY,
      children: [...element.children].map(child => ({
        name: typeof child.className === 'string' ? child.className.split(' ')[0] : '',
        background: getComputedStyle(child).backgroundColor,
        radius: getComputedStyle(child).borderTopLeftRadius,
        bottomRadius: getComputedStyle(child).borderBottomLeftRadius,
      })),
    }
  }
  return {
    review: shot('[class*="modal_"]'),
  }
})()
