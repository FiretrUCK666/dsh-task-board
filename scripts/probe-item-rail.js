// Measures the checklist panel's alignment: where each element's INK sits and
// where its BOX sits, plus whether the things that share a line share a centre.
//
// ── 两条量法，各答各的问题 ─────────────────────────────────────────────────────
//
//   `Range.getClientRects()`  给**文字的行盒**（排版占的那一格），不是字形的墨。
//                             横向问「第一点墨从哪开始」时它对；**纵向问「字看着居中了
//                             没有」时它是错的**——行盒上下对称，于是它永远报 0，
//                             而读者看见的字偏下。
//   `TextMetrics.actual*`     给**字形真实的墨**：同一份 `font` 量一次文，拿
//                             `actualBoundingBoxAscent/Descent`（墨相对基线上下各伸出
//                             多少）与 `fontBoundingBoxAscent/Descent`（字体自己的
//                             上下界）配合半行距，就能把基线在行盒里的位置算出来，
//                             于是墨的上沿、下沿、中心都是真数。
//
// 图形（SVG）走第三条路：`getBoundingClientRect()` 对 SVG 子元素给的是**几何包围盒**，
// 再按 `stroke-width` 的一半外扩就是描边的墨（描边有一半画在几何外侧）。
//
// The last expression IS the answer: shot-panel evaluates this file and returns
// its completion value, so nothing here may end in `console.log`.
;((() => {
  const round = (value) => Math.round(value * 10) / 10

  /** 一行文字的**墨**：上沿、下沿、左右沿与**基线**，全部由字体自己的度量算出来。 */
  const glyphInk = (el) => {
    if (el === null) return null
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const boxes = []
    const baselines = []
    let canvas = null
    let ctx = null
    let node = walker.nextNode()
    while (node !== null) {
      const text = node.nodeValue ?? ''
      if (text.trim() !== '') {
        const parent = node.parentElement
        const style = parent === null ? null : getComputedStyle(parent)
        if (style !== null) {
          const range = document.createRange()
          range.selectNodeContents(node)
          const line = [...range.getClientRects()].find(r => r.width > 0 && r.height > 0)
          if (line !== undefined) {
            if (ctx === null) {
              canvas = document.createElement('canvas')
              ctx = canvas.getContext('2d')
            }
            ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
            const metrics = ctx.measureText(text)
            const ascent = metrics.fontBoundingBoxAscent
            const descent = metrics.fontBoundingBoxDescent
            if (Number.isFinite(ascent) && Number.isFinite(descent)) {
              // 基线在行盒里的位置：半行距 + 字体自身的高。
              const baseline = line.top + (line.height - (ascent + descent)) / 2 + ascent
              baselines.push(baseline)
              boxes.push({
                l: line.left - metrics.actualBoundingBoxLeft,
                r: line.left + metrics.actualBoundingBoxRight,
                t: baseline - metrics.actualBoundingBoxAscent,
                b: baseline + metrics.actualBoundingBoxDescent,
              })
            }
          }
        }
      }
      node = walker.nextNode()
    }
    if (boxes.length === 0) return null
    return {
      l: round(Math.min(...boxes.map(b => b.l))),
      r: round(Math.max(...boxes.map(b => b.r))),
      t: round(Math.min(...boxes.map(b => b.t))),
      b: round(Math.max(...boxes.map(b => b.b))),
      /* **基线是这一族真正要对齐的那条线。** 墨心不是：一个数字的墨坐在基线上方（大写
         高度），一个汉字的墨跨基线两侧——两串字墨心相同而基线不同，读者看到的是两行字。
         所以「几块字对齐了吗」问的是基线，而「这枚药丸居中了吗」问的才是墨心。 */
      baseline: round(baselines[0]),
    }
  }

  /** 一个图形（SVG）的**墨**：几何包围盒按描边宽度的一半外扩。 */
  const strokeInk = (el) => {
    if (el === null) return null
    const shapes = [...el.querySelectorAll('path, rect, circle, line')]
    if (shapes.length === 0) return null
    const boxes = shapes.map(shape => {
      const r = shape.getBoundingClientRect()
      const width = parseFloat(getComputedStyle(shape).strokeWidth)
      const grow = Number.isFinite(width) ? width / 2 : 0
      return { l: r.left - grow, r: r.right + grow, t: r.top - grow, b: r.bottom + grow }
    })
    return {
      l: round(Math.min(...boxes.map(b => b.l))),
      r: round(Math.max(...boxes.map(b => b.r))),
      t: round(Math.min(...boxes.map(b => b.t))),
      b: round(Math.max(...boxes.map(b => b.b))),
    }
  }

  /** 一个元素的墨：它自己就是图形（或里面有图形）时走图形那条路，否则走文字那条路。 */
  const inkOf = (el) => {
    if (el === null) return null
    const graphic = el.tagName.toLowerCase() === 'svg' || el.querySelector('svg') !== null
    return graphic ? strokeInk(el) : glyphInk(el)
  }

  const boxOf = (el) => {
    if (el === null) return null
    const r = el.getBoundingClientRect()
    return { l: round(r.left), r: round(r.right), t: round(r.top), b: round(r.bottom), w: round(r.width), h: round(r.height) }
  }

  const cx = (box) => (box === null ? null : round((box.l + box.r) / 2))
  const cy = (box) => (box === null ? null : round((box.t + box.b) / 2))

  /** 一个元素的墨心相对它自己盒心的偏移——「看着居中了没有」就是这两个数。 */
  const offsetOf = (el) => {
    const box = boxOf(el)
    const ink = inkOf(el)
    if (box === null || ink === null) return { name: nameOf(el), box, ink, offY: null, offX: null, baseline: null }
    return {
      name: nameOf(el),
      box,
      ink,
      offY: round(cy(ink) - cy(box)),
      offX: round(cx(ink) - cx(box)),
      baseline: ink.baseline ?? null,
    }
  }

  const nameOf = (el) => {
    if (el === null) return 'none'
    const named = el.getAttribute('data-name')
    if (named !== null) return named
    // **SVG 元素的 `className` 不是字符串**（它是 `SVGAnimatedString`），所以标签名
    // 先走一遍：一个报成「[object」的读数，读者认不出它说的是谁。
    if (typeof el.className !== 'string') return el.tagName.toLowerCase()
    return el.className.toString().split(' ')[0] ?? el.tagName.toLowerCase()
  }

  const all = (sel) => [...document.querySelectorAll(sel)]
  const one = (sel) => document.querySelector(sel)

  /* ── 一、日历那一行的三枚控件 ────────────────────────────────────────────────
   *
   * 判据三条：三格的墨心各在自己盒心（纵向 ≤ 0.5）、三格的墨心互相对齐（≤ 0.5）、
   * 中间那一格的墨与左右两枚箭头的墨之间，空气左右相等（≤ 1）。 */
  const navBtns = all('.itemRailNavBtn')
  const today = one('.itemRailToday')
  const prevBtn = navBtns[0] ?? null
  const nextBtn = navBtns[navBtns.length - 1] ?? null
  const navRow = boxOf(one('.itemRailMonthNav'))
  const orders = [
    { role: 'prev', el: prevBtn },
    { role: 'today', el: today },
    { role: 'next', el: nextBtn },
  ].map(part => {
    const box = boxOf(part.el)
    const ink = inkOf(part.el)
    return {
      role: part.role,
      box,
      ink,
      offY: box === null || ink === null ? null : round(cy(ink) - cy(box)),
      offX: box === null || ink === null ? null : round(cx(ink) - cx(box)),
      radius: part.el === null ? null : getComputedStyle(part.el).borderRadius,
    }
  })
  const prevInk = orders[0].ink
  const todayInk = orders[1].ink
  const nextInk = orders[2].ink
  const trio = {
    cells: orders,
    group: navRow === null || prevBtn === null || nextBtn === null ? null : {
      left: round(prevBtn.getBoundingClientRect().left),
      right: round(nextBtn.getBoundingClientRect().right),
      rowCentre: cx(navRow),
      offCentre: round((prevBtn.getBoundingClientRect().left + nextBtn.getBoundingClientRect().right) / 2 - cx(navRow)),
    },
    // 三格的墨心互相对齐吗：最大减最小。
    inkCentreSpread: prevInk === null || todayInk === null || nextInk === null
      ? null
      : round(Math.max(cy(prevInk), cy(todayInk), cy(nextInk)) - Math.min(cy(prevInk), cy(todayInk), cy(nextInk))),
    // 左右两枚箭头是同一枚记号吗：墨框的宽与高各自差多少。
    mirror: prevInk === null || nextInk === null ? null : {
      widthDiff: round(Math.abs((prevInk.r - prevInk.l) - (nextInk.r - nextInk.l))),
      heightDiff: round(Math.abs((prevInk.b - prevInk.t) - (nextInk.b - nextInk.t))),
    },
    // 「距胶囊左右空隙」：墨到墨，不是盒到盒。
    air: prevInk === null || todayInk === null || nextInk === null ? null : {
      left: round(todayInk.l - prevInk.r),
      right: round(nextInk.l - todayInk.r),
    },
  }
  if (trio.air !== null) trio.air.diff = round(Math.abs(trio.air.left - trio.air.right))

  /* ── 二、一族里每一行的「记号 · 词 · 数」 ────────────────────────────────────
   *
   * 这一族现在有四套做法（逐子元素垫位移 / 一族底衬 / 个例 3px 与 4px / 什么都不做），
   * 所以这里把**每一个**成员都量一遍——数不会撒谎，而屏上不会有人说话。 */
  const familyOf = (host) => {
    if (host === null) return null
    const box = boxOf(host)
    /* **文字取叶子**：一枚药丸里的字可能隔着一层盒子（`.itemGroupText` / `.itemRailText`
       是「几块字共享一条基线」的那个盒子），而基线要在**字与字之间**量，不是在盒子与
       盒子之间量。所以这里走一遍子树，取每一个没有元素孩子的格子——它们才是读者读到的
       那几串字。

       **`aria-hidden` 的不算**：安静行里那个 `·` 是一枚分隔符，它的墨（一个居中的小点）
       本来就**不该**落在行盒的中央——拿它去算「基线差多少」会把一个正确的排版报成缺陷。 */
    const leaves = [...host.querySelectorAll('*')].filter(el =>
      el.children.length === 0
      && el.getAttribute('aria-hidden') !== 'true'
      && el.closest('[aria-hidden="true"]') === null)
    const texts = leaves.map(el => offsetOf(el)).filter(p => p.baseline !== null)
    const union = texts.length === 0 ? null : {
      t: Math.min(...texts.map(p => p.ink.t)),
      b: Math.max(...texts.map(p => p.ink.b)),
    }
    return {
      host: offsetOf(host),
      parts: [...host.children]
        .filter(child => child.getAttribute('aria-hidden') !== 'true')
        .map(child => offsetOf(child)),
      texts,
      // 几串字的**基线**互差多少——「1 条」与「今天」那条判据问的就是它。
      baselineSpread: texts.length < 2 ? null : round(
        Math.max(...texts.map(p => p.baseline)) - Math.min(...texts.map(p => p.baseline)),
      ),
      // 而这一枚药丸的**墨心**（几串字的墨并起来）相对盒心差多少——「看着居中没有」。
      textInkOffY: union === null || box === null ? null : round((union.t + union.b) / 2 - cy(box)),
    }
  }

  const heads = all('.itemGroupHead').map(el => ({ name: nameOf(el), ...familyOf(el) }))
  const railRows = all('.itemRailRow').slice(0, 6).map(el => ({ name: nameOf(el), ...familyOf(el) }))

  /* ── 三、日历的日格 ─────────────────────────────────────────────────────────
   *
   * 一格数字是这一族里唯一「定高、内容自己居中」的那一种成员（26px 的格子），所以它
   * 的补偿算术与别的成员不是同一条——它必须被单独量。 */
  const dayCells = all('.itemRailDay').slice(0, 4).map(el => {
    const num = el.querySelector('.itemRailDayNum')
    return { cell: offsetOf(el), num: offsetOf(num) }
  })

  /* ── 四、安静行与空摘要 ───────────────────────────────────────────────────── */
  const quiet = all('.itemEmptyGroups, .itemEmptyGroup').map(el => offsetOf(el))

  /* ── 五、一族药丸：底衬归零之后，「墨心落在盒心」要每一枚都成立 ────────────────
   *
   * 这一族此前只有「定高、块向内衬为零」的成员是对的：`.itemOpt`（`padding: 3px 9px`）
   * 与 `.itemTag`（`padding: 1px 8px 2px`）各自带着自己的块向内衬，而表尾那条补偿写的是
   * **绝对值** `1px`，于是它把底衬**覆盖掉**——上 3 下 1，内容整整朝下 1px。读者看到的是
   * 「文案没有居中于它自己的胶囊，偏下了」。
   *
   * 所以每一枚都量（同一族里量一枚看起来最能代表的，就是这次漏掉它的原因）。
   * **输入框不在这里量**：`<input>` 没有文字节点，取不到墨；它的几何由「族成员不许有自己的
   * 块向内衬」那条结构门禁钉住，与 `.itemOpt` 逐字同形。 */
  const PILL_FAMILY = [
    '.itemOpt', '.itemTag', '.itemTopBarChip', '.itemNewButton', '.itemPrioChip', '.itemRefChip',
  ]
  const pills = PILL_FAMILY.flatMap(sel =>
    all(sel).slice(0, 4).map(el => {
      /* **墨走这个元素自己的文字**（`inkOf` 是走文字节点的那一条），不是走「没有元素孩子的
         格子」：一枚药丸的字常常就是它自己的直接文字节点（`.itemOpt` 就是），而按元素找会
         报 null——一个量不到的成员与一枚居中的成员在报告里长得一模一样。 */
      const self = offsetOf(el)
      const measured = familyOf(el)
      return {
        sel,
        name: nameOf(el),
        offY: self.offY,
        baselineSpread: measured === null ? null : measured.baselineSpread,
        h: self.box === null ? null : round(self.box.b - self.box.t),
        padTop: getComputedStyle(el).paddingBlockStart,
        padEnd: getComputedStyle(el).paddingBlockEnd,
      }
    }))
  /* 这一族的补偿读的是根上那个令牌：令牌不在（挂载页没有 `.itemRoot`），`var()` 就整条
     失效、底衬回落到 shorthand 那一档——量出来的数会**看着正常**，而屏上根本不是那样。 */
  const rootEl = document.querySelector('.itemRoot')
  const liftToken = rootEl === null ? null : getComputedStyle(rootEl).getPropertyValue('--item-ink-lift').trim()

  /* ── 判据 ───────────────────────────────────────────────────────────────────
   *
   * **0.25 而不是 0.5。** 0.5px 是「设备像素的一半」：在 2× 屏上它是一整颗像素，读者
   * 放大就看得见（这一轮报上来的那张图就是放大 7 倍截的）。真正的判据是**墨心落在盒心
   * 上**——一个小于四分之一像素的偏差不会把墨心推到相邻那一颗像素里去。
   *
   * **基线只报数，不当判据。** 结构上它已经由 `align-items: baseline` 保证（几块字装在
   * 一个盒子里，那个盒子按基线对齐自己的内容——换字体、换字号都一样）；而这里量出来的
   * 基线是**算**出来的（行盒顶 + 半行距 + canvas 报的字体上高），它对**回退字体**与粗体
   * 不算准：左栏那一行选中态（粗体）上读到 1.1px，而同一行的墨心读数是 0。所以基线留在
   * 数里给人看，判据落在墨心上——那是读者的眼睛真正在看的那件事。 */
  const TOL = 0.25
  /** 一个读数在给定容差内吗（缺失与 NaN 一律算「没量到」，不算通过）。 */
  const within = (value, tol) => value !== null && value !== undefined && Number.isFinite(value) && Math.abs(value) <= tol
  const withinTol = (value) => within(value, TOL)
  const worst = (list) => {
    const numbers = list.filter(v => v !== null).map(v => Math.abs(v))
    return numbers.length === 0 ? null : round(Math.max(...numbers))
  }

  const pass = {
    trioInkCentre: orders.every(c => withinTol(c.offY)),
    trioWorst: worst(orders.map(c => c.offY)),
    trioSpread: trio.inkCentreSpread !== null && trio.inkCentreSpread <= TOL,
    trioMirror: trio.mirror !== null && trio.mirror.widthDiff <= TOL && trio.mirror.heightDiff <= TOL,
    trioAir: trio.air !== null && trio.air.diff <= 1,
    headsBaselineRead: worst(heads.map(h => h.baselineSpread)),
    headsOptical: heads.every(h => h.textInkOffY === null || withinTol(h.textInkOffY)),
    headsWorst: worst(heads.map(h => h.textInkOffY)),
    rowsBaselineRead: worst(railRows.map(r => r.baselineSpread)),
    rowsOptical: railRows.every(r => r.textInkOffY === null || withinTol(r.textInkOffY)),
    rowsWorst: worst(railRows.map(r => r.textInkOffY)),
    cellsOptical: dayCells.every(c => c.num.ink !== null && withinTol(c.num.offY)),
    liftToken,
    pillsOptical: rootEl !== null && pills.length > 0 && pills.every(p => within(p.offY, 0.5)),
    pillsWorst: worst(pills.map(p => p.offY)),
    /* **上衬必须是 0。** 这一条量的是样式表读不到的那一层：`<button>` 的 UA 内衬
       （`padding: 1px 6px`）——只写 `padding-inline` 的成员会带着它进来，而门禁读的是作者
       样式表，看不见它。同一个类在 `<button>` 与 `<span>` 上量出来还不一样（标签那一族量到过
       0 与 1），所以这一条只能是**量**出来的判据。 */
    pillsFootOnly: pills.length > 0 && pills.every(p => p.padTop === '0px'),
  }

  return JSON.stringify({ viewport: window.innerWidth, trio, heads, railRows, dayCells, quiet, pills, pass })
})())
