/**
 * 量「运行时把令牌发布出去之后，每一枚胶囊的墨真的落回盒心了吗」。
 *
 * 与其它探针的分工：`probe-capsule-census.js` 量的是**默认值 0** 下的样子（那时校正
 * 当然不生效，所以它量的是「这条规则需不需要校正」）；这一条先在 `:root` 上写一个
 * 已知的令牌值，**模拟 `installInkMetrics` 已经跑过**，再量一遍，看每一枚胶囊的墨心
 * 是不是真的回到了盒心。
 *
 * 为什么必须这么做：静态产物页不会执行 `installInkMetrics`，所以令牌在产物页上永远是
 * `0px`，而「0 时正好居中」恰恰可能意味着校正被别的东西盖掉了却看不出来。注入一个
 * 非零值，就把「有没有生效」变成一个可读的数。
 *
 * 输出：{ tested, offAfterCorrection, worst } —— 期望 `offAfterCorrection` 为 0。
 * 用法：node scripts/shot-panel.mjs --url file:///... --eval-file scripts/probes/probe-capsule-live-correction.js
 * 只读：写一个内联样式到 `documentElement`，量完删掉。
 */
(() => {
  const INK = '--dsh-tb-optical-drop'
  /* 0.0714em 是 `offset 0.5px / 参考字号 14px × 2` 在 13px 的字上算出来的量级；
     取一个明确非零、又确实会移动内容的值，才看得出「生效了没有」。 */
  const PROBE_VALUE = '0.0714em'

  const round = (value) => Math.round(value * 100) / 100
  const canvas = document.createElement('canvas').getContext('2d')

  /** 量一枚盒子里那串字的墨心，相对盒子边框盒的中心。 */
  const measure = (element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width < 12 || rect.height < 10 || rect.height > 56) return null
    const style = getComputedStyle(element)
    /* **胶囊 = 完全圆角**（圆角不小于半高），与 `align-capsules.mjs` 的判据同一个意思。
       按「圆角 ≥ 8px」收会把卡片、瓦片、行也收进来（它们是 14–20px 圆角的一段内容，
       块向内衬是它们自己的排版），于是「没被校正」的读数量到的是一批**本来就不该被
       校正**的东西——一个量错的探针比没有更糟。 */
    const radius = Math.max(parseFloat(style.borderTopLeftRadius) || 0, parseFloat(style.borderTopRightRadius) || 0)
    if (radius < rect.height / 2 - 0.5) return null
    const own = Array.from(element.childNodes)
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent ?? '')
      .join('')
    const text = (own === '' ? element.textContent ?? '' : own).trim()
    if (text === '') return null
    canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const metrics = canvas.measureText(text.slice(0, 20))
    const fontAscent = metrics.fontBoundingBoxAscent
    const fontDescent = metrics.fontBoundingBoxDescent
    const inkAscent = metrics.actualBoundingBoxAscent
    const inkDescent = metrics.actualBoundingBoxDescent
    if (![fontAscent, fontDescent, inkAscent, inkDescent].every(Number.isFinite)) return null

    const padTop = parseFloat(style.paddingTop) || 0
    const padBottom = parseFloat(style.paddingBottom) || 0
    const border = parseFloat(style.borderTopWidth) || 0
    const contentTop = rect.top + padTop + border
    const contentHeight = rect.height - padTop - padBottom - border
      - (parseFloat(style.borderBottomWidth) || 0)
    const declared = parseFloat(style.lineHeight)
    const lineBox = Number.isFinite(declared) ? declared : fontAscent + fontDescent
    const halfLeading = (lineBox - (fontAscent + fontDescent)) / 2
    const isFlex = style.display.includes('flex') || style.display.includes('grid')
    const centred = isFlex && style.alignItems === 'center'
    const lineTop = centred ? contentTop + (contentHeight - lineBox) / 2 : contentTop
    const baseline = lineTop + halfLeading + fontAscent
    const inkCenter = baseline - inkAscent + (inkAscent + inkDescent) / 2
    return {
      key: (element.className || '').toString().split(' ')[0].slice(0, 32),
      text: text.slice(0, 12),
      delta: round(inkCenter - (rect.top + rect.height / 2)),
      padTop: round(padTop),
      padBottom: round(padBottom),
    }
  }

  const scan = () => {
    const rows = []
    for (const element of document.querySelectorAll('button, a, label, span, div, p, li, input, select')) {
      const one = measure(element)
      if (one !== null) rows.push(one)
    }
    /* 同一枚类名收一份最差值：判的是「这条规则对不对」，不是「这一屏有几个实例」。 */
    const byKey = new Map()
    for (const row of rows) {
      const seen = byKey.get(row.key)
      if (seen === undefined || Math.abs(row.delta) > Math.abs(seen.delta)) byKey.set(row.key, row)
    }
    return [...byKey.values()]
  }

  /* 基线：不写令牌时它们在哪（静态产物页上令牌就是 0）。 */
  const before = scan()

  /* 注入令牌，强制重排，再量。 */
  document.documentElement.style.setProperty(INK, PROBE_VALUE)
  void document.body.offsetHeight
  const after = scan()

  /* 撤掉注入，把页面还原成它原来的样子。 */
  document.documentElement.style.removeProperty(INK)
  void document.body.offsetHeight

  /* **判据**：写了令牌之后，每一枚的墨心都该比之前更靠近盒心。
     偏移的方向由令牌的符号决定，所以「更接近 0」才是唯一正确的检查——只看绝对值
     变小还不够：一枚本来就在 +0.5 的胶囊被推到 −0.5 也是「变了一点」，但那不叫校正。 */
  const beforeByKey = new Map(before.map((one) => [one.key, one]))
  const moved = []
  const notMoved = []
  for (const afterOne of after) {
    const beforeOne = beforeByKey.get(afterOne.key)
    if (beforeOne === undefined) continue
    const improved = Math.abs(afterOne.delta) < Math.abs(beforeOne.delta) - 0.01
    const record = {
      key: afterOne.key,
      text: afterOne.text,
      before: beforeOne.delta,
      after: afterOne.delta,
      padT: afterOne.padTop,
      padB: afterOne.padBottom,
    }
    if (improved) moved.push(record)
    else notMoved.push(record)
  }
  notMoved.sort((a, b) => Math.abs(b.after) - Math.abs(a.after))

  return JSON.stringify({
    probeValue: PROBE_VALUE,
    tested: moved.length + notMoved.length,
    corrected: moved.length,
    notCorrected: notMoved.length,
    worstUncorrected: notMoved.slice(0, 10),
  })
})()
