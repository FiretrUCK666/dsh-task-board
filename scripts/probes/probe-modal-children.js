// 面板里，谁在给圆角上色——找出「圆角是画在谁身上」的那个盒子。
//
// 背景：`border-radius` + `overflow: hidden` 同时出现在一个**滚动体的祖先**上时，
// Chromium 会把那个滚动体推回主线程（实测：90 个滚轮事件 90 次都要回主线程找滚动目标；
// 只去掉圆角、或只去掉裁切，都立刻恢复合成线程滚动）。
//
// 所以拆的时候必须先知道：这个圆角是给谁用的？如果只是给面板自己的底色收角，那
// `overflow: hidden` 可以走；如果有子元素铺了**自己的不透明底色**顶到角上，那裁切是
// 必需的，圆角就得往下发给那几个孩子。
;;(() => {
  const modal = document.querySelector('[class*="modal_"]')
  if (modal === null) return { error: 'no modal on this page' }
  const modalStyle = getComputedStyle(modal)

  const kids = []
  for (const child of modal.children) {
    const style = getComputedStyle(child)
    kids.push({
      name: `${child.tagName.toLowerCase()}.${typeof child.className === 'string'
        ? child.className.split(' ').filter(Boolean).join('.') : ''}`,
      background: style.backgroundColor,
      backgroundImage: style.backgroundImage === 'none' ? 'none' : 'yes',
      radius: style.borderTopLeftRadius,
      overflowY: style.overflowY,
      position: style.position,
      inset: style.inset,
      height: Math.round(child.getBoundingClientRect().height),
      containsScroller: child.querySelector('[id="comments"], [id="transcript"]') !== null,
    })
  }

  /* Every scroller inside the modal, and how deep it sits. */
  const scrollers = []
  for (const element of modal.querySelectorAll('*')) {
    const style = getComputedStyle(element)
    if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue
    const room = element.scrollHeight - element.clientHeight
    if (room <= 4) continue
    scrollers.push({
      name: `${element.tagName.toLowerCase()}${element.id === '' ? '' : `#${element.id}`}`,
      room,
      scrollbarWidth: style.width,
    })
  }

  return {
    modal: {
      radius: modalStyle.borderTopLeftRadius,
      overflowY: modalStyle.overflowY,
      background: modalStyle.backgroundColor,
      height: Math.round(modal.getBoundingClientRect().height),
    },
    kids,
    scrollers,
  }
})()
