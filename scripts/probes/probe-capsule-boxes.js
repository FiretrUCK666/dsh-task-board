/**
 * 只报**布局矩形**，一个字都不算。
 *
 * 这一步的可信之处在于它不含任何推导：`getBoundingClientRect()` 是浏览器排版的结果。
 * 下一步（`scripts/audit-panels.mjs`）拿这些矩形去截图像素里量字的墨，
 * 于是「字有没有落在盒子中心」由**像素**回答，而不是由我的公式回答。
 *
 * 输出里的 `dpr` 用来把 CSS 像素换算成设备像素。
 */
(() => {
  const round = (value) => Math.round(value * 100) / 100
  const out = []
  for (const element of document.querySelectorAll('*')) {
    const rect = element.getBoundingClientRect()
    if (rect.height < 14 || rect.height > 56 || rect.width < 18) continue
    const style = getComputedStyle(element)
    const radius = Math.max(
      parseFloat(style.borderTopLeftRadius) || 0,
      parseFloat(style.borderTopRightRadius) || 0,
    )
    /* 圆角至少半高才是胶囊；圆点、圆环也符合，但下面「有字」把它们排掉。 */
    if (radius < rect.height / 2 - 0.5) continue
    const text = (element.textContent ?? '').trim()
    if (text === '') continue
    /* 只收最内层那一枚：装着一排子胶囊的外壳，它的墨是并集，量了没有意义。 */
    const hasInnerCapsule = [...element.querySelectorAll('*')].some((child) => {
      const cr = child.getBoundingClientRect()
      if (cr.height < 14 || cr.height > 56) return false
      const cs = getComputedStyle(child)
      const cr2 = Math.max(
        parseFloat(cs.borderTopLeftRadius) || 0,
        parseFloat(cs.borderTopRightRadius) || 0,
      )
      return cr2 >= cr.height / 2 - 0.5 && (child.textContent ?? '').trim() !== ''
    })
    if (hasInnerCapsule) continue
    out.push({
      text: text.slice(0, 10),
      left: round(rect.left),
      top: round(rect.top),
      width: round(rect.width),
      height: round(rect.height),
    })
  }
  return JSON.stringify({ dpr: window.devicePixelRatio, viewport: [innerWidth, innerHeight], capsules: out })
})()
