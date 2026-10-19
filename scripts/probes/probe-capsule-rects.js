/**
 * 输出若干胶囊的**边框盒**（设备像素），好让截图逐像素核对同一块区域。
 *
 * 为什么要这么绕：探针自己算「墨心」用的是 canvas 度量，而读者看的是**渲染出来的
 * 像素**。两者可以不一致——比如字体回退、抗锯齿、或者探针把行盒位置推错。所以这里
 * 只交出几何（不含任何墨的推算），由外面的像素扫描独立回答「墨在哪」。
 *
 * 用法：--eval-file 本文件；输出每一枚的 class、文字、rect（设备像素，含 dpr 换算）。
 */
(() => {
  const dpr = window.devicePixelRatio || 1
  const round = (value) => Math.round(value * 100) / 100
  const wanted = ['workbenchTab', 'workbenchCheck', 'ghostButton', 'primaryButton', 'boardDemand', 'itemGroupHead', 'chip']
  const rows = []
  for (const target of wanted) {
    const element = [...document.querySelectorAll(`[class*="${target}"]`)]
      .find((one) => (one.className || '').toString().split(' ').some((c) => c.endsWith(target)))
    if (element === undefined) continue
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    rows.push({
      key: target,
      text: (element.textContent ?? '').trim().slice(0, 10),
      /* 设备像素：截图上可直接用。 */
      devTop: round(rect.top * dpr),
      devBottom: round(rect.bottom * dpr),
      devLeft: round(rect.left * dpr),
      devRight: round(rect.right * dpr),
      cssH: round(rect.height),
      padTop: style.paddingTop,
      padBottom: style.paddingBottom,
      lineHeight: style.lineHeight,
      fontSize: style.fontSize,
      dpr,
    })
  }
  return JSON.stringify(rows)
})()
