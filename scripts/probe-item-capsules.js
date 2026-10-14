// 两块面板的胶囊与滚动体审计：**按结构认领，不按名单**。
//
// ── 为什么它不读类名 ──────────────────────────────────────────────────────────
//
// 这个项目原先的判据是一张**写出来的成员名单**（`item.module.css` 末尾那一族）加一个
// 探针里同样写死的成员表。两处都会漏，而漏掉的那一枚**既不修也不量**——读者报上来的那
// 枚行内状态胶囊就不在任何一份名单上。所以这里的每一条判据都只问「它长什么样」与
// 「它装了什么」，不问它叫什么：新加一颗胶囊，只要它长得像胶囊就自动进网。
//
// ── 三条判据 ─────────────────────────────────────────────────────────────────
//
//   A1 胶囊里的字居中了没有   盒子按「画了底或边 + 够圆 + 装着看得见的字 + 高 ≤ 56」
//                            认领；**只量最内层的那一颗**（装了几颗胶囊的盒子不算胶囊，
//                            否则并集的墨心会报一次假红）。
//   A2 滚动体是什么形状       每条非 `visible` 的 overflow 都报出来，附两轴的使用值与
//                            溢出量。触屏档与桌面档各跑一次，**差**才是信号：热区环越出
//                            滚动口时，这一档会凭空多出一条滚动轴。
//   A3 热区环越界了没有       生成中的 `::before`/`::after` 且 inset 有负值 = 一颗看不见
//                            的扩大热区。它的墨框必须落在**每一个**裁剪祖先（滚动体或
//                            `overflow: hidden`）的内边之内——越出去的那部分既不可点，
//                            又白白拉长滚动距离（量过：`.attachRow` 由此多出 6px 竖向
//                            溢出，手机上就是那两根圆头灰条）。
//
// ── 字的墨怎么量 ─────────────────────────────────────────────────────────────
//
// `Range.getClientRects()` 给的是**行盒**，行盒上下对称，于是真实的半像素偏差会被它报成
// 0；字的墨只能由 `TextMetrics.actualBoundingBox*` 配半行距算出来。图形（SVG）走第三条
// 路：`getBoundingClientRect()` 是几何包围盒，按 `stroke-width` 的一半外扩才是描边的墨。
//
// 最后一个表达式就是答案（`shot-panel` 取表达式的完成值），所以这里不许以 `console.log` 收尾。
;((() => {
  const round = (v) => Math.round(v * 100) / 100
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
  const within = (v, tol) => Number.isFinite(v) && Math.abs(v) <= tol
  const worst = (list) => {
    const numbers = list.filter((v) => Number.isFinite(v)).map((v) => Math.abs(v))
    return numbers.length === 0 ? null : round(Math.max(...numbers))
  }
  /* 一条判据的**三态**：`false` 与「我没量」在报告里长得一样（硬性规范 15）。 */
  const stateOf = (present, readable, holds) =>
    present === 0 ? 'not-here' : readable === 0 ? 'no-reading' : holds ? 'pass' : 'fail'

  /** 两轴容差。**竖向严、横向松，理由不一样：**
   *
   *   竖 0.5   槽把墨居中之后剩下的那一点，是「汉字的墨比 cap 边高」这一条**脚本常量**——
   *            它随字号与字重浮动，两种字体度量下量到 −0.3 与 +0.03，12px 与 13px 的成员
   *            又差 0.16。刻意**不加补偿**：一个固定的补偿只对一种度量成立（那正是旧机制的
   *            病），而这里的残差在 DPR≥2 上不到一个设备像素。
   *   横 1.5   字形的左/右侧承与前进宽度让「墨心」与「盒心」本来就差约 1px——那不是排版
   *            缺陷。读者看得见的横向问题是「靠边」（>2px 的事），所以判据落在那个量级。 */
  const TOL = 0.5
  const TOL_X = 1.5
  /** 「几块字与记号对齐」的容差——两号字可以差半格，所以比药丸宽一档。 */
  const MARK_TOL = 0.5
  /** 热区环可以伸出的最大距离：0 表示「不许越出自己的裁剪祖先」。 */
  const RING_SLACK = 0.5

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  /** 一个元素的类名（哈希前缀抹掉，报告里好认）。 */
  const keyOf = (el) => {
    const raw = typeof el.className === 'string' ? el.className : ''
    return raw.split(/\s+/).filter((one) => one !== '').map((one) => one.replace(/^[A-Za-z0-9]+_/, '')).join(' ').slice(0, 40)
  }

  /* ── 字的墨：一个一个**看得见的**文字节点并起来 ─────────────────────────────
   *
   * 「看得见」是承重的：`srOnly`（1×1 绝对定位）里也坐着字，把它算进来会把整颗胶囊的墨框
   * 拉高一截——量过，一枚列头因此从 0.5 报成 4.25。 */
  const visibleRuns = (el) => {
    const out = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null) {
      const text = node.textContent ?? ''
      const parent = node.parentElement
      if (text.trim() !== '' && parent !== null) {
        const st = getComputedStyle(parent)
        const box = parent.getBoundingClientRect()
        if (st.position !== 'absolute' && st.position !== 'fixed' && box.width > 2 && box.height > 2) {
          out.push({ node, text, style: st })
        }
      }
      node = walker.nextNode()
    }
    return out
  }

  const glyphInk = (el, runs) => {
    const boxes = []
    const lineTops = new Set()
    for (const run of runs) {
      const range = document.createRange()
      range.selectNodeContents(run.node)
      const line = [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0)
      if (line === undefined) continue
      const st = run.style
      ctx.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`
      const metrics = ctx.measureText(run.text)
      const ascent = metrics.fontBoundingBoxAscent
      const descent = metrics.fontBoundingBoxDescent
      if (!Number.isFinite(ascent) || !Number.isFinite(descent)) continue
      // 基线在行盒里的位置 = 行盒顶 + 半行距 + 字体自身的高。
      const baseline = line.top + (line.height - (ascent + descent)) / 2 + ascent
      lineTops.add(round(line.top))
      boxes.push({
        l: line.left - metrics.actualBoundingBoxLeft,
        r: line.left + metrics.actualBoundingBoxRight,
        t: baseline - metrics.actualBoundingBoxAscent,
        b: baseline + metrics.actualBoundingBoxDescent,
      })
    }
    if (boxes.length === 0) return null
    /* **行数决定这颗盒子算不算「一枚胶囊的标签」。** 一段多行的说明不是标签：它的墨是几行
     * 并起来的，量它的「墨心对不对齐盒心」问的是另一件事，而答案会随字数变。
     *
     * 两行的判据是**行盒顶差超过 2px**，不是「顶不完全相等」：一枚芯片里「文件名 + 字节数」
     * 是两个并排的 flex item，字号不同、各自居中，行盒顶天然差半像素——按严格相等数，它们
     * 会被当成两行，那颗胶囊就**从判据里消失**（量到过：只剩 `not-here`，看起来像一次干净的量）。 */
    const tops = [...lineTops].sort((a, b) => a - b)
    let lines = 0
    let previous = Number.NEGATIVE_INFINITY
    for (const top of tops) {
      if (top - previous > 2) lines += 1
      previous = top
    }
    return {
      l: round(Math.min(...boxes.map((b) => b.l))),
      r: round(Math.max(...boxes.map((b) => b.r))),
      t: round(Math.min(...boxes.map((b) => b.t))),
      b: round(Math.max(...boxes.map((b) => b.b))),
      lines,
    }
  }

  /** 图形（SVG）的墨：几何包围盒按描边宽度的一半外扩。 */
  const strokeInk = (el) => {
    const shapes = [...el.querySelectorAll('path, rect, circle, line, polyline')]
    if (shapes.length === 0) return null
    const boxes = shapes.map((shape) => {
      const r = shape.getBoundingClientRect()
      const grow = px(getComputedStyle(shape).strokeWidth) / 2
      return { l: r.left - grow, r: r.right + grow, t: r.top - grow, b: r.bottom + grow }
    })
    return {
      l: round(Math.min(...boxes.map((b) => b.l))),
      r: round(Math.max(...boxes.map((b) => b.r))),
      t: round(Math.min(...boxes.map((b) => b.t))),
      b: round(Math.max(...boxes.map((b) => b.b))),
    }
  }

  /** 墨框的并集（字与记号各是一块墨；「这一排内容居中了吗」问的是并集）。 */
  const unionInk = (a, b) => (a === null ? b : b === null ? a : {
    l: Math.min(a.l, b.l), r: Math.max(a.r, b.r), t: Math.min(a.t, b.t), b: Math.max(a.b, b.b), lines: a.lines,
  })

  const boxOf = (el) => {
    const r = el.getBoundingClientRect()
    return { l: round(r.left), r: round(r.right), t: round(r.top), b: round(r.bottom), w: round(r.width), h: round(r.height) }
  }
  const cy = (box) => (box.l + box.r === 0 ? 0 : round((box.t + box.b) / 2))
  const cx = (box) => round((box.l + box.r) / 2)

  /* ── A1：胶囊 ──────────────────────────────────────────────────────────────── */
  const looksLikeCapsule = (el) => {
    const r = el.getBoundingClientRect()
    if (r.height < 14 || r.height > 56 || r.width < 24) return null
    const st = getComputedStyle(el)
    if (!['flex', 'inline-flex', 'block', 'inline-block', 'grid', 'inline-grid'].includes(st.display)) return null
    const radius = Math.max(px(st.borderTopLeftRadius), px(st.borderTopRightRadius))
    if (radius < 8 && radius < r.height / 2 - 0.5) return null
    const painted = (st.backgroundColor !== 'rgba(0, 0, 0, 0)' && st.backgroundColor !== 'transparent') ||
      px(st.borderTopWidth) > 0 || px(st.borderBottomWidth) > 0
    return painted ? st : null
  }

  /* **横向政策由盒子自己说。** 一枚胶囊的内容是靠中还是靠左，答案在它自己的
   * `justify-content`（flex）或 `text-align`（块）里——那不是审计该猜的事，也不是该由一枚
   * 新属性重复一遍的事。审计只判「声明了居中的那些**真的**居中了吗」，并把靠左的那些**列出来**
   * （名单进报告），因为「这一枚为什么靠左」是设计决定。谁连一句政策都没写、靠继承碰巧对了，
   * 那是静态门禁管的事（那里读得到声明，浏览器里读不到「没写」）。 */
  const horizPolicy = (st) => {
    if (st.justifyContent === 'center' || st.justifyContent === 'space-around' || st.justifyContent === 'space-evenly') return 'center'
    if (st.textAlign === 'center') return 'center'
    return 'start'
  }

  const candidates = []
  for (const el of document.querySelectorAll('*')) {
    if (looksLikeCapsule(el) === null) continue
    const runs = visibleRuns(el)
    if (runs.length === 0) continue
    candidates.push({ el, runs })
  }
  /* **只量最内层那一颗。** 装了几颗胶囊的盒子（一行标签、一排选择器）自己也符合「画了底、
   * 够圆、装着字」，但它的墨是**并集**：量它等于量一排东西的中心，那不是任何一颗胶囊。 */
  const capsules = candidates
    .filter((one) => !candidates.some((other) => other !== one && one.el.contains(other.el)))
    .map(({ el, runs }) => {
      const st = getComputedStyle(el)
      const box = boxOf(el)
      const ink = glyphInk(el, runs)
      const mark = el.querySelector('svg') === null ? null : strokeInk(el)
      const content = unionInk(ink, mark)
      return {
        key: keyOf(el),
        /* 屏上那串字的前几个字：**只为了让人认得出是哪一颗**，判据不看它。一枚在报告里
         * 叫 `ghostButton` 的盒子，两个面板加起来有几十个。 */
        label: (el.textContent ?? '').trim().slice(0, 14),
        tag: el.tagName.toLowerCase(),
        h: box.h,
        w: box.w,
        display: st.display,
        align: st.alignItems,
        justify: st.justifyContent,
        lineHeight: st.lineHeight,
        fontSize: st.fontSize,
        padBlock: `${st.paddingTop}/${st.paddingBottom}`,
        policy: horizPolicy(st),
        lines: ink === null ? null : ink.lines,
        hasTextSlot: el.querySelector('[data-dsh-tb-pilltext]') !== null || el.hasAttribute('data-dsh-tb-pilltext'),
        offY: ink === null ? null : round(cy(ink) - cy(box)),
        /* **横着问的是「这一排内容居中了吗」，不是「字的墨心居中了吗」。** 一枚「图标 + 标签」
         * 的按钮，居中的是那两件东西并起来的一排；只量字，会把「图标占了左边 7px」报成缺陷
         * （量过：面板顶栏那颗新建按钮就是这样，7px 正好是图标宽加间距的一半）。
         * 纵着仍然只量字：读者说「字没居中于它的胶囊」时，说的是字。 */
        offX: content === null ? null : round(cx(content) - cx(box)),
        markOffY: mark === null ? null : round(cy(mark) - cy(box)),
        textVsMark: ink === null || mark === null ? null : round(cy(ink) - cy(mark)),
      }
    })

  /* 判据只管**单行的**胶囊：多行的盒子装的是段落，不是标签（`lines` 就是那个判据）。 */
  const labels = capsules.filter((c) => c.lines === 1)
  const centred = labels.filter((c) => c.policy === 'center')
  const startAligned = labels.filter((c) => c.policy !== 'center')
  const worstV = worst(labels.map((c) => c.offY))
  const worstH = worst(centred.map((c) => c.offX))
  const worstMark = worst(labels.map((c) => c.textVsMark))
  const offendersV = labels.filter((c) => !within(c.offY, TOL))
  const offendersH = centred.filter((c) => !within(c.offX, TOL_X))

  /* ── A2：滚动体 ────────────────────────────────────────────────────────────── */
  const scrollers = []
  /* 一个元素的稳定身份：DOM 里第几个。两档跑的是同一页同一份静态渲染，顺序一样；
   * 类名只为了让报告好读，不参与配对。 */
  const indexOf = new Map()
  ;[...document.querySelectorAll('*')].forEach((el, at) => indexOf.set(el, at))
  for (const el of document.querySelectorAll('*')) {
    const st = getComputedStyle(el)
    if (st.overflowX === 'visible' && st.overflowY === 'visible') continue
    scrollers.push({
      at: indexOf.get(el),
      key: keyOf(el),
      overflow: `${st.overflowX}/${st.overflowY}`,
      dh: el.scrollHeight - el.clientHeight,
      dw: el.scrollWidth - el.clientWidth,
      client: `${el.clientWidth}x${el.clientHeight}`,
    })
  }

  /* ── A3：热区环越界 ──────────────────────────────────────────────────────────
   *
   * **裁剪者只数面板自己的祖先。** `html`/`body` 不算：窗口边缘不是我们能修的裁剪，而且那
   * 外面的像素读者本来就够不着——量到过的那一枚（面板顶栏的铃）在工件页上被 `body` 裁掉
   * 7px，那是**工件页自己的壳**，不是面板的几何。 */
  const clipAncestorOf = (el) => {
    let node = el.parentElement
    while (node !== null && node !== document.body && node !== document.documentElement) {
      const st = getComputedStyle(node)
      if (st.overflowX !== 'visible' || st.overflowY !== 'visible') {
        const r = node.getBoundingClientRect()
        return {
          // 名字为空时退回标签名：一个报成空串的裁剪者，读者认不出它说的是谁。
          key: keyOf(node) === '' ? node.tagName.toLowerCase() : keyOf(node),
          overflowX: st.overflowX,
          overflowY: st.overflowY,
          overflow: `${st.overflowX}/${st.overflowY}`,
          // 内边 = 边框盒减掉边框，也就是滚动口所在的那一格。
          l: r.left + node.clientLeft,
          t: r.top + node.clientTop,
          r: r.left + node.clientLeft + node.clientWidth,
          b: r.top + node.clientTop + node.clientHeight,
        }
      }
      node = node.parentElement
    }
    return null
  }

  const rings = []
  for (const el of document.querySelectorAll('*')) {
    for (const pseudo of ['::before', '::after']) {
      const st = getComputedStyle(el, pseudo)
      if (st.content === 'none' || st.position !== 'absolute') continue
      const t = px(st.top)
      const l = px(st.left)
      const b = px(st.bottom)
      const r = px(st.right)
      if (t >= 0 && l >= 0 && b >= 0 && r >= 0) continue
      const elBox = el.getBoundingClientRect()
      const box = { l: elBox.left + l, t: elBox.top + t, r: elBox.right - r, b: elBox.bottom - b }
      const clip = clipAncestorOf(el)
      /* **只数「环比元素多出来的那一圈」。** 元素自己在裁剪盒外——内容滚下去了、或者在长列表
       * 下面——不是环的问题：把那种情况算进来，一页会报出一千多像素的假越界（量到过，
       * `itemProseGrip` 与滚到下面去的按钮都这样）。所以逐边问：**元素的这一边在裁剪盒里，
       * 而环的这一边在外面**，那才是被裁掉的那一圈。 */
      let outBy = 0
      let outByScrollable = 0
      let dead = 0
      if (clip !== null) {
        for (const [elementInside, gap, axis] of [
          [elBox.left >= clip.l, clip.l - box.l, 'x'],
          [elBox.top >= clip.t, clip.t - box.t, 'y'],
          [elBox.right <= clip.r, box.r - clip.r, 'x'],
          [elBox.bottom <= clip.b, box.b - clip.b, 'y'],
        ]) {
          if (!elementInside) continue
          const over = Math.max(0, gap)
          outBy = Math.max(outBy, over)
          /* **危害只在「用户真的能滚的那条轴」上。** 环伸到一个 `auto`/`scroll` 的滚动口之外，
           * 那条滚动体就多出一段滚动距离——手机上那两根条就是这么来的。伸到一个 `hidden`/`clip`
           * 的裁剪框之外只是**够不着的那半圈**：条不会出现，滚动也不会变。后者报出来，不判红——
           * 判据要量的是危害，不是几何。 */
          const axisOverflow = axis === 'x' ? clip.overflowX : clip.overflowY
          if (axisOverflow === 'auto' || axisOverflow === 'scroll') outByScrollable = Math.max(outByScrollable, over)
          else dead = Math.max(dead, over)
        }
        outBy = round(outBy)
        outByScrollable = round(outByScrollable)
        dead = round(dead)
      }
      rings.push({
        key: `${keyOf(el)}${pseudo}`,
        inset: `${st.top}/${st.right}/${st.bottom}/${st.left}`,
        outBy,
        outByScrollable,
        dead,
        clippedBy: clip === null ? null : clip.key,
        clippedAxis: clip === null ? null : clip.overflow,
      })
    }
  }
  /* 判红的那一批 = **会给可滚的轴加出滚动距离**的那些；`dead` 只报数。 */
  const clippedRings = rings.filter((ring) => ring.outByScrollable > RING_SLACK)
  const deadRings = rings.filter((ring) => ring.outByScrollable <= RING_SLACK && ring.dead > RING_SLACK)

  /* ── 判据 ──────────────────────────────────────────────────────────────────── */
  const media = {
    both: matchMedia('(hover: none) and (pointer: coarse)').matches,
    coarse: matchMedia('(pointer: coarse)').matches,
    hoverNone: matchMedia('(hover: none)').matches,
    touchPoints: navigator.maxTouchPoints,
  }
  const pass = {
    tier: media.both ? 'touch' : 'desktop',
    /* 判据只对**量得到的**下结论：一枚胶囊都没有的页面是 `not-here`，不是通过。 */
    capsulesCentredV: stateOf(labels.length, labels.filter((c) => Number.isFinite(c.offY)).length, offendersV.length === 0),
    capsulesCentredH: stateOf(centred.length, centred.filter((c) => Number.isFinite(c.offX)).length, offendersH.length === 0),
    textVsMarkAligned: stateOf(labels.filter((c) => c.textVsMark !== null).length, labels.filter((c) => c.textVsMark !== null).length, labels.filter((c) => c.textVsMark !== null).every((c) => within(c.textVsMark, MARK_TOL))),
    ringsInsideClip: stateOf(rings.length, rings.length, clippedRings.length === 0),
  }

  return {
    page: document.title,
    href: location.pathname.split('/').pop() ?? '',
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, scrollbars: innerWidth - document.documentElement.clientWidth },
    media,
    pass,
    counts: {
      capsules: capsules.length,
      labels: labels.length,
      startAligned: startAligned.length,
      withTextSlot: capsules.filter((c) => c.hasTextSlot).length,
      missingSlot: [...new Set(capsules.filter((c) => !c.hasTextSlot).map((c) => c.key))],
      scrollers: scrollers.length,
      rings: rings.length,
      clippedRings: clippedRings.length,
      deadRings: deadRings.length,
    },
    worst: { offY: worstV, offX: worstH, textVsMark: worstMark },
    offenders: {
      offY: offendersV.map((c) => ({ key: c.key, offY: c.offY, h: c.h, lineHeight: c.lineHeight, padBlock: c.padBlock, markOffY: c.markOffY, slot: c.hasTextSlot })),
      offX: offendersH.map((c) => ({ key: c.key, offX: c.offX, h: c.h, justify: c.justify })),
      rings: clippedRings,
    },
    /* 够不着、但没有危害的那半圈：报出来给人看，不判红。 */
    deadRings: deadRings.map((ring) => ({ key: ring.key, dead: ring.dead, clippedBy: ring.clippedBy, clippedAxis: ring.clippedAxis })),
    /* 靠左的那些**列出来**，不判红：一枚胶囊为什么靠左是设计决定，报告里看得见就够了。 */
    startAligned: startAligned.map((c) => ({ key: c.key, offX: c.offX, w: c.w, justify: c.justify, h: c.h })),
    capsules,
    scrollers,
  }
})())
