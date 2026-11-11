(() => {
  const read = (selector) => {
    const element = document.querySelector(selector)
    if (element === null) return { selector, found: false }
    const style = getComputedStyle(element)
    return {
      selector,
      found: true,
      background: style.backgroundColor,
      borderRadius: style.borderRadius,
      overflow: style.overflow,
      borderTopLeftRadius: style.borderTopLeftRadius,
      borderBottomRightRadius: style.borderBottomRightRadius,
    }
  }
  const root = getComputedStyle(document.documentElement)
  return {
    panel: read('[data-overlay]'),
    header: read('[data-overlay] > :first-child'),
    footer: read('[data-overlay] > :last-child'),
    sheetToken: root.getPropertyValue('--dsh-tb-plane-sheet').trim(),
    floatToken: root.getPropertyValue('--dsh-tb-plane-float').trim(),
    inlayToken: root.getPropertyValue('--dsh-tb-plane-inlay').trim(),
    dswPaper: root.getPropertyValue('--dsw-surface-base').trim(),
    radiusToken: root.getPropertyValue('--dsh-tb-radius-xl').trim(),
  }
})()
