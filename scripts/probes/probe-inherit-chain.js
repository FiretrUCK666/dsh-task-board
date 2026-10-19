/**
 * 对比同一个组件在两个页面上**继承到的上下文差异**，逐项列出变化的那几个属性。
 *
 * 用户看到「清单那一排是齐的、看板这一排偏下」，而两边的组件是同一个、计算值也相同，
 * 那么差别只可能在**继承链**上：字号 / 行高 / 字体族 / 语言 / 缩放这些会传导进
 * 行盒与字体度量的东西。这个探针把从按钮往上一直到 `html` 的每一层都读出来，
 * 只报**与正文字号不同**的那些层，于是那一处不同会自己跳出来。
 */
(() => {
  const round = (value) => Math.round(value * 100) / 100
  const PROPS = [
    'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing',
    'fontVariantNumeric', 'textRendering', 'display', 'alignItems', 'boxSizing',
  ]

  const chain = (element) => {
    const out = []
    let node = element
    while (node !== null && node !== document.documentElement) {
      const style = getComputedStyle(node)
      const entry = {
        tag: node.tagName.toLowerCase(),
        cls: (node.className || '').toString().slice(0, 34),
        lang: node.getAttribute?.('lang') ?? null,
      }
      for (const prop of PROPS) entry[prop] = style[prop]
      out.push(entry)
      node = node.parentElement
    }
    return out
  }

  const find = (text) => {
    for (const element of document.querySelectorAll('button, a')) {
      if ((element.textContent ?? '').trim() === text) return element
    }
    return null
  }

  const pick = ['多选', '整理', '会话建卡', '动态']
  const out = {}
  for (const text of pick) {
    const element = find(text)
    if (element === null) { out[text] = null; continue }
    const rect = element.getBoundingClientRect()
    out[text] = {
      boxH: round(rect.height),
      self: getComputedStyle(element).fontSize + '/' + getComputedStyle(element).lineHeight,
      chain: chain(element),
    }
  }
  return JSON.stringify(out)
})()
