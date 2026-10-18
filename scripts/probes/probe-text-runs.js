/**
 * 量「一枚胶囊里，**每一段字各自的墨心**相对盒心差多少」。
 *
 * 为什么需要它，而不是 `probe-capsule-ink.js`：那一条把整枚胶囊的文字当成一段，
 * 报一个数。可读者报的恰恰是**同一枚胶囊里两段字的处境不同**——「『全部』往上了，
 * 左右两个数字没问题」。一个整段读数会把两段平均掉，于是两种真实的偏差看起来像
 * 一个「差不多为零」的数。
 *
 * 根因是排版的一条事实：**汉字的墨与拉丁数字的墨，在同一个行盒里的位置不同**。
 * 汉字从基线往上约 `0.88em`、往下 `0.04em`（重心在基线之上，且几乎不越基线）；
 * 拉丁数字只往上约 `0.71em`、不越基线。所以**同一基线上，汉字的墨心比数字高约
 * 0.8×（0.88−0.71）/2**——任何「整盒居中」的布局都会让汉字偏上、数字看着正。
 *
 * 这一条按**每段文字**报数（用 `Range` 取每段自己的矩形，再用 canvas 取它自己的
 * 墨），于是「偏的是哪一段」是读出来的，不是推出来的。
 *
 * 用法：node scripts/shot-panel.mjs --url file:///... --eval-file scripts/probes/probe-text-runs.js
 * 只读，不写任何文件。
 */
(() => {
  const round = value => Math.round(value * 100) / 100
  const canvas = document.createElement('canvas').getContext('2d')

  /** 一段连续的文本节点，连同它所属的元素（取字体用）。 */
  const runsOf = (element) => {
    const runs = []
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          const text = (child.textContent ?? '').trim()
          if (text !== '') runs.push({ node: child, text, element: node })
        } else if (child.nodeType === 1) {
          const tag = child.tagName.toLowerCase()
          if (tag === 'svg') continue
          walk(child)
        }
      }
    }
    walk(element)
    return runs
  }

  /** 一段字的墨心（页面坐标）。 */
  const inkCenterOf = (run) => {
    const range = document.createRange()
    range.selectNodeContents(run.node)
    const rect = range.getBoundingClientRect()
    if (rect.height === 0 && rect.width === 0) return undefined
    const style = getComputedStyle(run.element)
    canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const metrics = canvas.measureText(run.text)
    const inkAscent = metrics.actualBoundingBoxAscent
    const inkDescent = metrics.actualBoundingBoxDescent
    if (!Number.isFinite(inkAscent) || !Number.isFinite(inkDescent)) return undefined
    /* 基线的位置：行盒里 `半行距 + 字体 ascent`，行盒由这一段自己的 `line-height` 定。 */
    const lineHeight = parseFloat(style.lineHeight)
    const line = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : rect.height
    const halfLeading = (line - (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent)) / 2
    const baseline = rect.top + halfLeading + metrics.fontBoundingBoxAscent
    return {
      center: (baseline - inkAscent + baseline + inkDescent) / 2,
      inkAscent: round(inkAscent),
      inkDescent: round(inkDescent),
    }
  }

  /* 只看**装了两段以上文字**的胶囊：一段字的盒子里「居中」只有一个答案，而两段
     字（词 + 数、日期 + 条数）才有「谁偏了」这个问题。 */
  const out = []
  for (const element of document.querySelectorAll('button, [role="presentation"], h2, h3, span')) {
    const rect = element.getBoundingClientRect()
    if (rect.width < 20 || rect.height < 12) continue
    const runs = runsOf(element)
    if (runs.length < 2) continue
    const center = rect.top + rect.height / 2
    const measured = []
    for (const run of runs) {
      const ink = inkCenterOf(run)
      if (ink === undefined) continue
      measured.push({ text: run.text.slice(0, 8), delta: round(ink.center - center), inkAscent: ink.inkAscent })
    }
    if (measured.length < 2) continue
    const spread = round(Math.max(...measured.map(m => m.delta)) - Math.min(...measured.map(m => m.delta)))
    out.push({
      cls: (element.className || '').toString().split(' ')[0].slice(0, 24),
      boxH: round(rect.height),
      runs: measured,
      spread,
    })
  }

  /* 只报**两段之间真的不齐**的那些（>= 0.5px）：一屏几十枚，全列等于没有重点。 */
  const off = out.filter(one => one.spread >= 0.5)
  off.sort((a, b) => b.spread - a.spread)
  return JSON.stringify({ capsules: out.length, uneven: off.length, worst: off.slice(0, 10) })
})()
