/**
 * 量「三页的左沿到底是不是同一条线」。
 *
 * 读者报的是「任务清单的侧边栏跟宿主侧边栏之间几乎没有间隙，而看板的 Dashboard 有」。
 * 这类问题肉眼能看出，但**差多少**必须量：差 4px 与差 16px 是两种改法。
 *
 * 量三样东西的位置：
 *   1. 面板自己的内容盒左沿（`getBoundingClientRect().left + paddingLeft`）；
 *   2. 工作台栏（那三颗 tab 的容器）的左沿与上沿；
 *   3. 第一个真正的内容元素（看板第一列的卡片 / 清单第一行 / 总览第一格）的左沿。
 *
 * 输出：page / 面板左沿 / 栏左沿 / 栏上沿 / 首个内容左沿 / 各自的内衬。
 * 用法：node scripts/shot-panel.mjs --url file:///... --eval-file scripts/probes/probe-frame-air.js
 * 只读。
 */
(() => {
  const round = value => Math.round(value * 100) / 100
  const out = []

  const panel = document.querySelector('[data-dsh-taskboard-view]')
  if (panel === null) return 'no panel host'
  const panelRect = panel.getBoundingClientRect()
  const panelStyle = getComputedStyle(panel)

  const nav = document.querySelector('nav[aria-label]')
  const navRect = nav === null ? null : nav.getBoundingClientRect()

  /* 第一块真正的内容：按页不同，所以按结构找——标题下面的第一个带底色的纸面。 */
  let first = null
  for (const node of document.querySelectorAll('[data-dsh-taskboard-view] *')) {
    const style = getComputedStyle(node)
    const rect = node.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 30) continue
    const hasGround = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent'
    const raised = style.boxShadow !== 'none'
    if (!hasGround && !raised) continue
    if (nav !== null && nav.contains(node)) continue
    first = { node, rect }
    break
  }

  out.push(`host      left=${round(panelRect.left)} top=${round(panelRect.top)} pad=${panelStyle.paddingLeft}/${panelStyle.paddingTop}`)
  out.push(navRect === null
    ? 'nav       (not found)'
    : `nav       left=${round(navRect.left)} top=${round(navRect.top)} w=${round(navRect.width)} h=${round(navRect.height)}`)
  out.push(first === null
    ? 'content   (not found)'
    : `content   left=${round(first.rect.left)} top=${round(first.rect.top)} w=${round(first.rect.width)} tag=${first.node.tagName.toLowerCase()}`)
  if (navRect !== null) {
    out.push(`gaps      nav-left-to-host=${round(navRect.left - panelRect.left)} nav-top-to-host=${round(navRect.top - panelRect.top)}`)
    if (first !== null) {
      out.push(`gaps      content-left-to-nav=${round(first.rect.left - navRect.left)} content-top-to-nav=${round(first.rect.top - navRect.bottom)}`)
    }
  }
  return out.join('\n')
})()
