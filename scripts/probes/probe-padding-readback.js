/**
 * 直接问浏览器：**同一枚按钮，令牌写进行内样式之后，它自己的 `padding-block` 有没有变。**
 *
 * 这一条是查「令牌发布了、但没有任何元素读到它」而写的。要问清三件事：
 *   1. 行内样式真的设上了吗（`getPropertyValue`）；
 *   2. 这条规则真的声明了 `padding-block` 吗（`getComputedStyle` 的 padding 读的是**结果**，
 *      不是声明——所以两者都要看）；
 *   3. 规范里同一条规则内 `padding-inline` 写在 `padding-block` 之前，会不会把后者盖掉。
 */
(() => {
  const INK = '--dsh-tb-optical-drop'
  const target = [...document.querySelectorAll('button')]
    .find((one) => (one.className || '').toString().includes('primaryButton')
      || (one.className || '').toString().includes('ghostButton'))
  if (target === undefined) return JSON.stringify({ error: 'no button' })

  const read = () => {
    const style = getComputedStyle(target)
    return {
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      height: style.height,
      boxSizing: style.boxSizing,
      align: style.alignItems,
      lineHeight: style.lineHeight,
      fontSize: style.fontSize,
    }
  }

  const before = read()
  const inlineBefore = document.documentElement.style.getPropertyValue(INK)

  document.documentElement.style.setProperty(INK, '8px')
  void document.body.offsetHeight
  const withToken = read()
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(INK)

  /* 再试一次：把令牌直接写在按钮本身上，排除继承链的问题。 */
  target.style.setProperty(INK, '8px')
  void document.body.offsetHeight
  const withLocal = read()
  target.style.removeProperty(INK)

  document.documentElement.style.removeProperty(INK)
  void document.body.offsetHeight

  return JSON.stringify({
    classes: (target.className || '').toString().slice(0, 60),
    text: (target.textContent ?? '').trim().slice(0, 10),
    inlineBefore,
    resolvedOnRoot: resolved,
    before,
    withTokenOnRoot: withToken,
    withTokenOnSelf: withLocal,
  })
})()
