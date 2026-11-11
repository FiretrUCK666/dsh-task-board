// 页面上每一个滚动体：它有没有「既画圆角又裁切」的祖先？
//
// ── 它回答的问题 ──────────────────────────────────────────────────────────────
//
// 一个既画圆角又裁切的盒子，会让它里面**每一条**滚动体落回主线程：每次滚轮都要回主线程
// 问一句「该滚哪个盒子」。帧还是 16.6ms，所以按帧率量不出来；读者感受到的是滚动位置
// 一格一格跳。机制与实测见 DESIGN.md「Shapes」那一节。
//
// 静态读样式表**判不了**这件事：一个 `border-radius` + `overflow: hidden` 的胶囊里可能
// 什么都没有，也可能藏着一个滚动体，而这两种在 CSS 里长得一模一样。所以判据必须在
// 运行时的 DOM 上走一遍——这个探针做的就是那件事。
//
// ── 为什么它不进门禁 ─────────────────────────────────────────────────────────
//
// 门禁读的是源码（没有布局、没有 DOM），它只能按形状报红；而按形状报红的代价是逼着人
// 去改一批本来正确的胶囊——那正是硬性规范 14 说的「不看上下文的检查器会逼人改对的东西」。
// 这一条判据要在真页面上量，所以它是探针，不是门禁。
//
// 用法：
//   node scripts/shot-panel.mjs --url <工件> --eval-file scripts/probes/probe-rounded-clip-ancestors.js
//
// 输出：`offenders` 为空的数组即通过（它同时也报出它查过几条滚动体——一个 0 只有在
// 仪器能变红时才算结论）。
(() => {
  const isRounded = (style) => {
    for (const corner of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']) {
      const value = style[corner]
      if (value !== undefined && value !== '' && value !== '0px') return true
    }
    return false
  }
  const clips = (style) => /^(hidden|clip)$/.test(style.overflowX) || /^(hidden|clip)$/.test(style.overflowY)

  const label = (element) => {
    const id = element.id === '' ? '' : `#${element.id}`
    const cls = typeof element.className === 'string' && element.className !== ''
      ? `.${element.className.trim().split(/\s+/).join('.')}`
      : ''
    return `${element.tagName.toLowerCase()}${id}${cls}`.slice(0, 90)
  }

  const scrollers = []
  for (const element of document.querySelectorAll('*')) {
    const style = getComputedStyle(element)
    if (!/^(auto|scroll)$/.test(style.overflowY) && !/^(auto|scroll)$/.test(style.overflowX)) continue
    const room = element.scrollHeight - element.clientHeight
    const roomX = element.scrollWidth - element.clientWidth
    if (room <= 4 && roomX <= 4) continue
    scrollers.push({ element, room, roomX })
  }

  const offenders = []
  for (const one of scrollers) {
    const ancestors = []
    let node = one.element.parentElement
    while (node !== null && node !== document.documentElement) {
      const style = getComputedStyle(node)
      if (isRounded(style) && clips(style)) ancestors.push(label(node))
      node = node.parentElement
    }
    if (ancestors.length > 0) {
      offenders.push({ scroller: label(one.element), rounded_clipping_ancestors: ancestors })
    }
  }

  return {
    scrollersChecked: scrollers.length,
    scrollers: scrollers.map(one => `${label(one.element)} (${one.room}px / ${one.roomX}px)`),
    offenders,
    pass: offenders.length === 0 && scrollers.length > 0,
  }
})()
