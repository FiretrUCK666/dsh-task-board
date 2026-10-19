/**
 * 在不同的字体栈下量同一个公式，回答一个具体问题：
 * **读者那台机器上，`offset` 到底是多少？**
 *
 * 这一条是为「电脑端一个字都没变」写的。校正的公式只有在 `|offset| >= 0.25px` 时才会
 * 发布一个值；小于死区就一位都不动，而**不动**在正偏移的字体上就等于「一直偏下」。
 * 所以必须知道：Windows 上常见的几款中文字体，各自算出多少。
 *
 * 输出每一款字体：四个度量、offset、以及会不会发布。
 */
(() => {
  const REFERENCE_SIZE = 14
  const DEAD_ZONE = 0.25
  const canvas = document.createElement('canvas').getContext('2d')
  const round = (value) => Math.round(value * 100) / 100

  const stacks = [
    ['页面/body 实际用的', getComputedStyle(document.body).fontFamily],
    ['Microsoft YaHei', '"Microsoft YaHei", sans-serif'],
    ['Segoe UI', '"Segoe UI", sans-serif'],
    ['系统默认 sans-serif', 'sans-serif'],
    ['Arial', 'Arial, sans-serif'],
    ['SimSun', '"SimSun", serif'],
    ['PingFang SC', '"PingFang SC", sans-serif'],
    ['Noto Sans CJK', '"Noto Sans CJK SC", sans-serif'],
  ]

  const rows = []
  const seen = new Set()
  for (const [name, stack] of stacks) {
    if (seen.has(stack)) continue
    seen.add(stack)
    for (const weight of ['400', '500', '600']) {
      canvas.font = `${weight} ${REFERENCE_SIZE}px ${stack}`
      const m = canvas.measureText('任务清单')
      const fa = m.fontBoundingBoxAscent
      const fd = m.fontBoundingBoxDescent
      const ia = m.actualBoundingBoxAscent
      const id = m.actualBoundingBoxDescent
      if (![fa, fd, ia, id].every(Number.isFinite)) continue
      const offset = ((fa - fd) - (ia - id)) / 2
      const publishes = Math.abs(offset) >= DEAD_ZONE
      const em = publishes ? (offset * 2) / REFERENCE_SIZE : 0
      rows.push({
        name: weight === '500' ? name : '',
        weight,
        fontAsc: round(fa), fontDesc: round(fd),
        inkAsc: round(ia), inkDesc: round(id),
        offset: round(offset),
        publishes,
        em: round(em * 10000) / 10000,
      })
    }
  }
  return JSON.stringify({ referenceSize: REFERENCE_SIZE, deadZone: DEAD_ZONE, rows })
})()
