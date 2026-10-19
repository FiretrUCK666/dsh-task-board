/**
 * 量工作台那三个页签：**轨道与页签各自的盒，以及它们的中线差**。
 *
 * 读者报了两件事，都需要分开量：
 *   - 电脑端「胶囊没有水平居中」——那是**横向**：页签在它那一格轨道里居中了吗；
 *   - 移动端「胶囊偏下」——那是**纵向**：页签在轨道里居中了吗。
 *
 * 两轴都用同一个办法：把子盒的中线与父盒的中线相减。盒的中线是边界盒的中心，
 * 与「字的墨」无关——所以这一条量的是**几何**，`probe-capsule-ink` 量的是**墨**。
 * 两件事都必须对，而它们错的机制完全不同。
 *
 * 用法：--eval-file 本文件
 */
(() => {
  const round = (value) => Math.round(value * 100) / 100
  const out = { nav: null, tabs: [], problems: [] }

  const nav = document.querySelector('[class*="workbenchNav"]')
  if (nav === null) return JSON.stringify({ error: 'no workbenchNav on this page' })

  const navRect = nav.getBoundingClientRect()
  const navStyle = getComputedStyle(nav)
  out.nav = {
    x: round(navRect.x), y: round(navRect.y),
    w: round(navRect.width), h: round(navRect.height),
    padTop: navStyle.paddingTop, padRight: navStyle.paddingRight,
    padBottom: navStyle.paddingBottom, padLeft: navStyle.paddingLeft,
    border: `${navStyle.borderTopWidth} ${navStyle.borderRightWidth} ${navStyle.borderBottomWidth} ${navStyle.borderLeftWidth}`,
    align: navStyle.alignItems,
    cols: navStyle.gridTemplateColumns,
    gap: navStyle.columnGap,
  }

  /* 轨道的内容盒：页签该在的区域。 */
  const content = {
    left: navRect.left + (parseFloat(navStyle.borderLeftWidth) || 0) + (parseFloat(navStyle.paddingLeft) || 0),
    right: navRect.right - (parseFloat(navStyle.borderRightWidth) || 0) - (parseFloat(navStyle.paddingRight) || 0),
    top: navRect.top + (parseFloat(navStyle.borderTopWidth) || 0) + (parseFloat(navStyle.paddingTop) || 0),
    bottom: navRect.bottom - (parseFloat(navStyle.borderBottomWidth) || 0) - (parseFloat(navStyle.paddingBottom) || 0),
  }
  const contentMidY = (content.top + content.bottom) / 2
  const contentMidX = (content.left + content.right) / 2

  for (const tab of nav.querySelectorAll('button')) {
    const rect = tab.getBoundingClientRect()
    const style = getComputedStyle(tab)
    const own = {
      label: (tab.textContent ?? '').trim().slice(0, 10),
      x: round(rect.x), y: round(rect.y), w: round(rect.width), h: round(rect.height),
      /* 纵向：页签中线 与 轨道内容区中线 之差（正 = 页签偏下）。 */
      offY: round((rect.top + rect.height / 2) - contentMidY),
      /* 纵向间隙，一眼看出是「上宽下窄」还是「上窄下宽」。 */
      topGap: round(rect.top - content.top),
      bottomGap: round(content.bottom - rect.bottom),
      /* 横向：页签在它自己的格子里居中了吗。格子宽从计算后的轨道读。 */
      display: style.display,
      justify: style.justifyContent,
      padInline: `${style.paddingLeft} / ${style.paddingRight}`,
      boxSizing: style.boxSizing,
    }
    out.tabs.push(own)
    if (Math.abs(own.offY) > 0.5) {
      out.problems.push(`${own.label}: 纵向偏 ${own.offY}px（上 ${own.topGap} / 下 ${own.bottomGap}）`)
    }
    if (own.topGap !== own.bottomGap) {
      out.problems.push(`${own.label}: 上下间隙不等（上 ${own.topGap} / 下 ${own.bottomGap}）`)
    }
  }

  /* 横向：轨道内容区与三枚页签合起来是不是对称。 */
  const first = out.tabs[0]
  const last = out.tabs[out.tabs.length - 1]
  if (first !== undefined && last !== undefined) {
    const leftAir = round(first.x - content.left)
    const rightAir = round(content.right - (last.x + last.w))
    out.horizontal = {
      contentLeft: round(content.left), contentRight: round(content.right),
      leftAir, rightAir,
      /* 三枚页签并起来的中线 与 轨道内容区中线 之差（正 = 整组偏右）。 */
      groupOffX: round(((first.x + last.x + last.w) / 2) - contentMidX),
    }
    if (leftAir !== rightAir) {
      out.problems.push(`整组横向不对称：左 ${leftAir} / 右 ${rightAir}`)
    }
    if (Math.abs(out.horizontal.groupOffX) > 0.5) {
      out.problems.push(`整组横向偏 ${out.horizontal.groupOffX}px`)
    }
  }

  return JSON.stringify(out)
})()
