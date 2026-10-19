/**
 * 量「加了内衬之后，行盒到底动没动」。
 *
 * 这是整条因果链上最后一环，也是我这几轮一直跳过去的那一环：
 * 内衬改变的是**内容盒**，而字在内容盒里的位置由**行盒的居中**或**行盒顶**决定。
 * 如果行盒也随内容盒一起被压扁（因为它撑满内容盒），那么墨心根本不会移动——
 * 这就是「规则生效、内衬生效、字不动」的全部原因。
 *
 * 对每一枚胶囊，在令牌 0 / 1px / -1px 三档下分别读：
 *   - 盒子的 rect
 *   - 文字的**行盒** rect（Range.selectNodeContents）
 * 两者一比就知道「行盒是跟着内容盒走，还是钉住不动」。
 */
(() => {
  const round = (value) => Math.round(value * 100) / 100

  const pick = () => {
    const out = []
    for (const element of document.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect()
      if (rect.height < 14 || rect.height > 56 || rect.width < 18) continue
      const style = getComputedStyle(element)
      const radius = Math.max(
        parseFloat(style.borderTopLeftRadius) || 0,
        parseFloat(style.borderTopRightRadius) || 0,
      )
      if (radius < rect.height / 2 - 0.5) continue
      const text = (element.textContent ?? '').trim()
      if (text === '' || text.length > 6) continue
      out.push(element)
      if (out.length >= 5) break
    }
    return out
  }

  const measure = (element) => {
    const rect = element.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(element)
    const lines = [...range.getClientRects()].filter((one) => one.height > 0)
    if (lines.length === 0) return null
    const style = getComputedStyle(element)
    return {
      text: (element.textContent ?? '').trim().slice(0, 6),
      boxTop: round(rect.top),
      boxH: round(rect.height),
      lineTop: round(lines[0].top),
      lineH: round(lines[0].height),
      pad: `${style.paddingTop}/${style.paddingBottom}`,
      lineHeight: style.lineHeight,
      display: style.display,
      align: style.alignItems,
    }
  }

  const targets = pick()
  const out = []
  for (const token of ['0px', '1px', '-1px']) {
    document.documentElement.style.setProperty('--dsh-tb-optical-drop', token)
    void document.body.offsetHeight
    out.push({ token, rows: targets.map(measure).filter((one) => one !== null) })
  }
  document.documentElement.style.removeProperty('--dsh-tb-optical-drop')
  return JSON.stringify(out)
})()
