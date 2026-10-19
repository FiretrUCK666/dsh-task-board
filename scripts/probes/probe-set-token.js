/**
 * 把令牌设成一个固定值，然后**留在那里**给截图用。
 *
 * 为什么要单独一个探针：前几次我用「替换 HTML 里的 </head>」来注入 CSS，量出来
 * 一模一样——也就是说那次注入根本没生效，而我把「没有变化」当成了结论。
 * 这一版走**同一个文档、同一个样式层**：直接改 `documentElement` 上的自定义属性，
 * 与运行时 `ink-metrics.ts` 做的事完全同一条路径。
 *
 * 值取自**文件名**：`probe-set-token-0.js` / `probe-set-token-1.js` / `probe-set-token-neg1.js`。
 */
(() => {
  const files = document.currentScript === null ? [] : []
  /* 用 URL 上带的状态参数决定值：`?token=1`。shot-panel 的 --url 支持查询串。 */
  const params = new URLSearchParams(location.search)
  const raw = params.get('token')
  const value = raw === null ? '0px' : `${raw}px`

  document.documentElement.style.setProperty('--dsh-tb-optical-drop', value)
  void document.body.offsetHeight

  /* 回读：证明它真的落到了属性上，而不是被更后面的 `:root` 规则盖掉。
     行内样式压过任何选择器，除非对方 `!important`——所以这一条同时是一个断言。 */
  const readBack = getComputedStyle(document.documentElement)
    .getPropertyValue('--dsh-tb-optical-drop')
    .trim()

  const sample = []
  for (const element of document.querySelectorAll('*')) {
    const rect = element.getBoundingClientRect()
    if (rect.height < 14 || rect.height > 56 || rect.width < 18) continue
    const style = getComputedStyle(element)
    const radius = Math.max(
      parseFloat(style.borderTopLeftRadius) || 0,
      parseFloat(style.borderTopRightRadius) || 0,
    )
    if (radius < rect.height / 2 - 0.5) continue
    if ((element.textContent ?? '').trim() === '') continue
    sample.push({ text: (element.textContent ?? '').trim().slice(0, 6), pt: style.paddingTop, pb: style.paddingBottom })
    if (sample.length >= 3) break
  }

  return JSON.stringify({ set: value, readBack, sample })
})()
