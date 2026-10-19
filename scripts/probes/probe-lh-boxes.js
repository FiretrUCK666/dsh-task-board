/**
 * 同一枚按钮、只改 `line-height`：行盒高度变了，墨在哪里？
 *
 * 这一条用**像素**读墨，而不是读行盒——因为读者看的是墨。行盒居中不代表墨居中，
 * 这正是整场问题的核心，所以必须直接量墨。
 *
 * 输出每枚按钮：盒子上下边（从底色找）、墨的上下边（从暗像素找）、两者的中点差。
 */
(() => {
  const round = (value) => Math.round(value * 100) / 100
  const out = []
  for (const element of document.querySelectorAll('.btn')) {
    const rect = element.getBoundingClientRect()
    out.push({
      id: element.id,
      lineHeight: getComputedStyle(element).lineHeight,
      top: round(rect.top),
      height: round(rect.height),
    })
  }
  return JSON.stringify({ dpr: window.devicePixelRatio, boxes: out })
})()
