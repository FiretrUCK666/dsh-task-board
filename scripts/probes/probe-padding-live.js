/**
 * 读「令牌设成 X 之后，几枚典型胶囊的实际块向内衬是多少」。
 *
 * 这一条回答的是**因果链的中间那一环**：规则在不在、令牌读没读到。
 * 前几轮的教训是——规则看得见不等于它生效：被同族属性后声明的声明盖掉、
 * 被 `!important` 压过、或者根本没匹配上，三种都不会报错。
 *
 * 判据：令牌为 0 时内衬应是 `0/0`，令牌为 1px 时应是 `0/1`（或 `1/0`，看符号）。
 */
(() => {
  const round = (value) => Math.round(value * 100) / 100
  const out = []

  for (const token of ['0px', '1px', '-1px']) {
    document.documentElement.style.setProperty('--dsh-tb-optical-drop', token)
    void document.body.offsetHeight

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
      sample.push({
        text: (element.textContent ?? '').trim().slice(0, 8),
        pt: style.paddingTop,
        pb: style.paddingBottom,
        h: round(rect.height),
      })
      if (sample.length >= 6) break
    }
    out.push({ token, sample })
  }

  document.documentElement.style.removeProperty('--dsh-tb-optical-drop')
  return JSON.stringify(out)
})()
