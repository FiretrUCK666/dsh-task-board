// 两块面板的胶囊与滚动体审计：**按结构认领，不按名单**。
//
// ── 为什么它不读类名 ──────────────────────────────────────────────────────────
//
// 这个项目原先的判据是一张**写出来的成员名单**（`item.module.css` 末尾那一族）加一个
// 探针里同样写死的成员表。两处都会漏，而漏掉的那一枚**既不修也不量**——读者报上来的那
// 枚行内状态胶囊就不在任何一份名单上。所以这里的每一条判据都只问「它长什么样」与
// 「它装了什么」，不问它叫什么：新加一颗胶囊，只要它长得像胶囊就自动进网。
//
// ── 六条判据 ─────────────────────────────────────────────────────────────────
//
//   A1 胶囊里的字居中了没有   盒子按「画了底或边 + 够圆 + 装着看得见的字 + 高 ≤ 56」
//                            认领；**只量最内层的那一颗**（装了几颗胶囊的盒子不算胶囊，
//                            否则并集的墨心会报一次假红）。
//   A2 滚动体是什么形状       每条非 `visible` 的 overflow 都报出来，附两轴的使用值与
//                            溢出量。触屏档与桌面档各跑一次，**差**才是信号：热区环越出
//                            滚动口时，这一档会凭空多出一条滚动轴。
//   A3 热区环越界了没有       生成中的 `::before`/`::after` 且 inset 有负值 = 一颗看不见的
//                            扩大热区。它的墨框必须落在**每一个**裁剪祖先（滚动体或
//                            `overflow: hidden`）的内边之内——越出去的那部分既不可点，
//                            又白白拉长滚动距离（量过：`.attachRow` 由此多出 6px 竖向
//                            溢出，手机上就是那两根圆头灰条）。
//   A4 字被切了没有           **只看竖向。** 墨盒与整条裁剪链求交，切掉超过 0.25px 就是一条
//                            缺陷。横向不判：一枚省略号里的字**本来就**长过它的盒子，那是
//                            设计；被切掉的一截字才是缺陷（量过：装字的盒子被裁到 8.41px
//                            而 12px 汉字的墨有 11px 高，字的上沿少了 1.59px、下沿少了 1px）。
//   A5 胶囊被装字的盒子压扁了没有  胶囊的高度地板 = 它自己声明的行盒 + 块向内衬 + 上下边。
//                            比这矮，说明它的高度被装字的盒子带着缩了（量过：22px 的芯片
//                            缩到 12.41px，因为它里面那个装字的盒子被裁到了 8.41px）。
//                            这是结构判据——**不含任何按字体量出来的数**。
//   A6 这把尺子还灵不灵        量真页面之前先种一颗**已知的坏胶囊**（偏上 + 被裁 + 被压扁），
//                            用同一套扫描量它，要求三条判据都报出来。报不出来就是 `blind`。
//                            「上一轮全绿而屏幕是坏的」的根子不是某个数算错，而是没有一步
//                            问过尺子还灵不灵——所以自证是**判据的一部分**，不是调试开关。
//
// ── 字的墨怎么量：**基线由浏览器给，不由算式给** ───────────────────────────────
//
// `Range.getClientRects()` 给的是**行盒**，行盒上下对称，于是真实的半像素偏差会被它报成 0。
// 而「基线在行盒里的位置 = 行盒顶 + 半行距 + 字体自身的高」是一个**算式**：它对被裁过的盒子
// 直接错约 1px（裁过的盒子基线在盒底，不在半行距里），而算错的尺子会把「偏上 0.85px 又被切掉
// 一截」读成「偏 0.3px，通过」——本项目的探针就是这么在屏幕上明显坏着的时候报绿的。
//
// 换成量：在**同一个行盒**里插一个空的 `inline-block`——它没有行盒，于是它的基线就是自己的
// 下边缘（CSS 2.1），它的 `bottom` 就是这一行的基线。量完立刻还原 DOM。没量到就报 `no-reading`：
// 三态里的「没量到」好过一个似是而非的数。
//
// 图形（SVG）走第三条路：`getBoundingClientRect()` 是几何包围盒，按 `stroke-width` 的一半
// 外扩才是描边的墨。
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
   *   竖 0.5   「把行盒居中」与「把墨居中」之间差的，是字体度量自己的那一点零点几像素
   *            （CJK 字形在 em 盒里本来就略高于几何中心）。它是**字体的事**，随字号与字重
   *            浮动；固定补偿只对一种字体成立（那正是旧机制的病），所以这里只量、不补。
   *            0.5px 在 DPR≥2 上不到两个设备像素，而真正的结构缺陷（丢了一格内衬、一行
   *            没居中、盒子被压扁）都是 1px 起步——判据落在那个量级。
   *   横 1.5   字形的左/右侧承与前进宽度让「墨心」与「盒心」本来就差约 1px——那不是排版
   *            缺陷。读者看得见的横向问题是「靠边」（>2px 的事），所以判据落在那个量级。 */
  /* **0.75px，而它的来历是量出来的。** 字的墨有多高取决于**这一行里是哪些字**：同一份字体、
   * 同一档，「国」与「新建任务」的墨心差 0.33px（12px 上），13px 的混排行（`.itemRailRow`）
   * 差到 0.65px——一个面板一枚令牌只能落在这几个数的中间，剩下的就是字形自己那点差，它**不是
   * 排版缺陷**。真正的结构缺陷是 1px 起步（丢了一格内衬、一行没居中、盒子被压扁——本项目量到过
   * 1.18px 的墨心偏差与 12.41px 的胶囊），判据落在这个量级仍然拦得住它们。
   *
   * ── 一个反复出现的「缺陷」其实是汉字自己：汉字的墨没有下行部分 ──────────────────
   *
   * 把四种标签真的画到画布上逐行数像素，得到的数是：**每一个标签的墨底都正好落在基线上**
   * （相对偏移 0），而墨顶分别是 −11 / −10 / −9。也就是说墨是**从基线往上长**的，它在行盒里
   * 天然偏上，偏多少取决于这一串字里有几个高字（「检查更新」的「更」比「动态」的「动」高 2px）。
   *
   * 于是同一排按钮里，长标签的墨心比短标签高，而这个差是**字体度量**，不是几何——`offY`
   * 量到的 −0.98 有一半正是它（另一半才是那个 0.48px 的墨位校正）。判定一个「胶囊没居中」
   * 的缺陷，看的是**同一枚标签在换字号、换内衬之后墨心有没有离开盒心**，而不是「这一排的每个
   * 标签是不是同一个数」——后者永远不可能成立，除非把汉字换成方块。
   *
   * 读这一条时请先看 `probe-ink-center.js`：它量的是「内容盒中心与墨心之差」，答案在
   * ±0.02px；本探针量的是「边框盒中心与墨心之差」，所以它天然多带一份墨位校正与字形差。
   * 两个数都对，问的不是同一件事。 */
  const TOL = 0.75
  const TOL_X = 1.5
  /** 「几块字与记号对齐」的容差。**它是竖向容差加一个圆整步**，不是另定的一个数：记号落在
   * 盒心上（`markOffY` 量到的就是那零点零几），所以「字 vs 记号」的上界就是「字 vs 盒心」的
   * 上界，两个各自取整的数最多再差一个圆整步。量到过 0.51 卡在 0.5 上——那不是缺陷，
   * 是同一个残差被量了两遍。 */
  const MARK_TOL = TOL + 0.1
  /** 热区环可以伸出的最大距离：0 表示「不许越出自己的裁剪祖先」。 */
  const RING_SLACK = 0.5
  /** 墨被切掉的圆整余量：「切没切」是有/无的事，只留亚像素取整的余地。 */
  const CUT_SLACK = 0.25
  /** 高度地板的圆整余量，同理。 */
  const FLOOR_SLACK = 0.25

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  /** 一个元素的类名（哈希前缀抹掉，报告里好认）。 */
  const keyOf = (el) => {
    const raw = typeof el.className === 'string' ? el.className : ''
    return raw.split(/\s+/).filter((one) => one !== '').map((one) => one.replace(/^[A-Za-z0-9]+_/, '')).join(' ').slice(0, 40)
  }

  /* ── 基线锚 ─────────────────────────────────────────────────────────────────── */

  /** 一串字排在哪几个行盒里。 */
  const lineRectsOf = (node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    return [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
  }

  const PROBE_ATTR = 'data-dsh-tb-probe'
  /** 空的 `inline-block` 没有行盒，于是它的基线**就是自己的下边缘**。零尺寸，不进流。 */
  const ANCHOR_STYLE = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;overflow:visible'
  const flexLike = (display) => display.includes('flex') || display.includes('grid')

  /** 这一行的基线在哪——**量出来**，不是算出来。量不到返回 null。 */
  const baselineOf = (run) => {
    const parent = run.node.parentElement
    if (parent === null) return null
    const line = lineRectsOf(run.node)[0]
    if (line === undefined) return null
    const undo = []
    try {
      let host = parent
      /* 文本是 flex/grid 容器的**匿名项**时，往容器里插行内块不会进那一行（它会成为另一个
         flex item）。先把这段文本搬进自己的 span 再插锚：匿名项与块化的 span 占的是同一格，
         几何不变。量完按相反顺序还原，页面回到原样。 */
      if (flexLike(getComputedStyle(parent).display)) {
        const span = document.createElement('span')
        span.setAttribute(PROBE_ATTR, '')
        parent.insertBefore(span, run.node)
        span.appendChild(run.node)
        undo.push(() => { span.parentNode?.insertBefore(run.node, span); span.remove() })
        host = span
      }
      const anchor = document.createElement('span')
      anchor.setAttribute(PROBE_ATTR, '')
      anchor.setAttribute('style', ANCHOR_STYLE)
      host.insertBefore(anchor, run.node.nextSibling)
      undo.push(() => anchor.remove())
      const rect = anchor.getBoundingClientRect()
      /* 锚必须落在**这一串字那一行**上：字正好占满一行时它会掉到下一行，那时它的下边缘是
         下一行的基线。读不准就报 `no-reading`。 */
      if (rect.height > 0.5 || rect.top < line.top - 0.5 || rect.bottom > line.bottom + 0.5) return null
      return rect.bottom
    } finally {
      for (const step of undo.reverse()) step()
    }
  }

  /** 墨的相对高度（相对基线，按元素自己的字号缩放）。
   *
   * **必须在放大字号上量再折算。** canvas 的 `actualBoundingBox*` 是**整数**：12px 的字量出来
   * 上高 11、下高 1，而真实值是 10.56 与 1.44——于是「墨心」在 12px 上有半像素级的取整误差，
   * 一个真实 1.08px 的偏差会被报成 0.5px（本项目量到过：同一枚胶囊，探针报 0.5，而按 200px
   * 折算出来是 1.08）。取整误差不随字号缩小，所以把量尺放大到 `INK_REF` 再乘回去，误差被摊薄
   * 十几倍，落到 12px 上不到 0.05px。 */
  const INK_REF = 200
  /** 行盒与基线在**这个字号**上量。字体的 ascent/descent 是按用到的字号取整的，所以在 200px 上
   * 量再折算回来是错的（量到过：SimSun 12px 上 4.00px，200px 折算 4.32px）。12px 是这两块面板
   * 正文那一档的字号，所以它是最有代表性的一档。 */
  const PROBE_FONT = 12
  /** 墨的相对高度（相对基线，按元素自己的字号）——**画出来的像素，不是 `actualBoundingBox*`**。
   *
   * 后者是字形轮廓的**理想值**，而读者看见的是画出来的像素，两者差半个像素、方向随字体变。
   * 量到过（同一枚 12px 的胶囊）：
   *
   *   默认字体   理想 上高 10 / 下高 **1**   画出来 上高 10 / 下高 **0**
   *   SimSun     理想 上高 10 / 下高 **2**   画出来 上高 10 / 下高 **1**
   *
   * 于是理想值说「墨心偏低 0.5px」，而画出来的墨**正好在盒心**（0.00）。按理想值去修，就是把
   * 一个本来居中的盒子推歪——本项目栽过这一次：桌面端本来是正的，被推高了 1.1px。而 0.5px 在
   * 像素网格上根本落不下去：**比一个设备像素更细的修正，只会变成另一台机器上的新偏差**。
   *
   * 做法：把这一串字按它自己的字体、字号、字重画进一个 canvas，扫 alpha 找墨的上沿与下沿；
   * 基线画在已知的 `baselineY`，所以上高/下高直接从像素来。理想值仍然读一份进报告
   * （`idealOffY`），用来让「理想 ≠ 眼睛」这件事在每一档读数里都看得见。 */
  const inkExtentsOf = (st, text) => {
    const size = px(st.fontSize)
    if (!Number.isFinite(size) || size <= 0 || text.trim() === '') return null
    const font = `${st.fontStyle} ${st.fontWeight} ${size}px ${st.fontFamily}`
    ctx.font = font
    const ideal = ctx.measureText(text)
    if (!Number.isFinite(ideal.fontBoundingBoxAscent)) return null
    const pad = Math.ceil(size)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(8, Math.ceil(ideal.width) + 2 * pad)
    canvas.height = Math.max(8, Math.ceil(size * 3))
    const paint = canvas.getContext('2d')
    if (paint === null) return null
    paint.font = font
    paint.textBaseline = 'alphabetic'
    paint.fillStyle = '#000'
    const baselineY = Math.round(size * 2)
    paint.fillText(text, pad, baselineY)
    const data = paint.getImageData(0, 0, canvas.width, canvas.height).data
    let top = canvas.height
    let bottom = -1
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (data[(y * canvas.width + x) * 4 + 3] > 24) {
          if (y < top) top = y
          if (y > bottom) bottom = y
        }
      }
    }
    if (bottom < 0) return null
    return {
      asc: baselineY - top,
      desc: bottom - baselineY,
      idealAsc: ideal.actualBoundingBoxAscent,
      idealDesc: ideal.actualBoundingBoxDescent,
      fontAsc: ideal.fontBoundingBoxAscent,
      fontDesc: ideal.fontBoundingBoxDescent,
    }
  }

  /** 一个盒子**本来**该有多高的行盒：`line-height` 是 px 就是它，`normal` 就是字体自己的
   * 内容区。裁墨那一类属性改的是盒子，不改这个声明——所以它是地板那一侧的权威。 */
  const declaredLineBox = (st, metrics) => st.lineHeight === 'normal'
    ? metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent
    : px(st.lineHeight)

  /* 见 `inkExtentsOf`：**量尺放大到 `INK_REF` 再折算**，否则 12px 上的整数取整会把一个
     1.08px 的偏差报成 0.5px。 */

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
        /* **不可见的那一串不算读数**：`.itemTagAddMirror` 是那把量宽的尺子（`visibility: hidden`），
         * 它的几何是「这段字要多宽」，屏上没有它的墨——把它算成一颗胶囊的标签，就会量出一个
         * 谁也没看见的偏差（量到过 +0.86px）。 */
        if (st.position !== 'absolute' && st.position !== 'fixed' && st.visibility !== 'hidden' && box.width > 2 && box.height > 2) {
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
    let hl = Number.POSITIVE_INFINITY
    let hr = Number.NEGATIVE_INFINITY
    let lineBox = 0
    for (const run of runs) {
      const lines = lineRectsOf(run.node)
      const line = lines[0]
      if (line === undefined) continue
      const baseline = baselineOf(run)
      if (baseline === null) continue
      const st = run.style
      const ink = inkExtentsOf(st, run.text)
      if (ink === null) continue
      lineBox = Math.max(lineBox, st.lineHeight === 'normal' ? ink.fontAsc + ink.fontDesc : px(st.lineHeight))
      /* **横向的权威是行盒，不是画布。** 画布给的是一串字的**前进宽度**，而排版还认
       * `font-variant-numeric` 这类字形特性——`tabular-nums` 下的 `1` 比画布量的宽近 2px，
       * 于是「画布宽度 ≠ 行盒宽度」在一个完全正常的盒子上也会成立（实测：`.itemPrioChip` 的
       * `!1` 因此被判成横向读不出来）。而横向要问的本来就是「这一排**排**居中了吗」——
       * 那是布局的事，行盒正是答案；纵向才是墨的事。
       *
       * **行盒要按裁剪口收一刀**：省略号生效时，这一串字的行盒比读者看得见的那一段长
       * （量到过：`.boardDemand` 因为这一刀没收到，内容被量成偏右 6px，而它是居中的）。
       * 收刀的前提是这一串自己就在口子里——整块滚出去的元素不能收，否则会量出一个负宽度。 */
      const own = run.node.parentElement === null ? null : run.node.parentElement.getBoundingClientRect()
      const clips = run.node.parentElement === null ? [] : clipBoxesOf(run.node.parentElement, true)
      const inside = own !== null && clips.every((c) => c.node === run.node.parentElement ||
        (own.left >= c.l - 1 && own.right <= c.r + 1 && own.top >= c.t - 1 && own.bottom <= c.b + 1))
      const clipL = inside && clips.length > 0 ? Math.max(...clips.map((c) => c.l)) : Number.NEGATIVE_INFINITY
      const clipR = inside && clips.length > 0 ? Math.min(...clips.map((c) => c.r)) : Number.POSITIVE_INFINITY
      for (const one of lines) {
        hl = Math.min(hl, Math.max(one.left, clipL))
        hr = Math.max(hr, Math.min(one.right, clipR))
        lineTops.add(round(one.top))
      }
      lineBox = Math.max(lineBox, st.lineHeight === 'normal' ? ink.fontAsc + ink.fontDesc : px(st.lineHeight))
      boxes.push({ t: baseline - ink.asc, b: baseline + ink.desc })
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
      l: Number.isFinite(hl) ? round(hl) : null,
      r: Number.isFinite(hr) ? round(hr) : null,
      t: round(Math.min(...boxes.map((b) => b.t))),
      b: round(Math.max(...boxes.map((b) => b.b))),
      lines,
      lineBox: round(lineBox),
    }
  }

  /** 图形（SVG）的墨：几何包围盒按描边宽度的一半外扩。
   *
   * **只取这一格里的第一枚图形。** 一行里的记号是**贴在这串字旁边的那一枚**，而一枚胶囊里可能
   * 还有第二个图形（尾部的箭头、移除按钮上的叉、题头右边那枚说明图标）——把两者的墨并起来，
   * 得到的中心落在它们**之间**，于是报出一个谁也看不见的偏差。量到过：`markOffY` 报 −1.1px，
   * 而逐个量那枚前导记号是 **0.00px**（墨心与盒心同一个数）。判据读错了对象，就会逼着人改对的
   * 东西来迁就它（硬性规范 14）。 */
  /**
   * 一枚胶囊里的**前导记号**：`svg`，或一个画了底/边的小盒子。
   *
   * 只认 `svg` 是不够的——总览页那颗状态点是一个 `<span>` + `border-radius` + 底色
   * （`homeStatusDot`），于是「图标 + 标签」那一排的并集里少了它，`offX` 报出 5px
   * 的假红（正好是点宽 + 间距的一半）。判据读错对象，就会逼着人把对的胶囊改歪
   * （硬性规范 14）。判据因此按**结构**认：不含文字、有尺寸、画了底或边。
   */
  const leadMark = (el) => {
    const svg = el.querySelector('svg')
    if (svg !== null) return svg
    for (const child of el.children) {
      if ((child.textContent ?? '').trim() !== '') continue
      const st = getComputedStyle(child)
      const r = child.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      const painted = st.backgroundColor !== 'rgba(0, 0, 0, 0)'
        || px(st.borderTopWidth) > 0
        || st.backgroundImage !== 'none'
      if (!painted) continue
      /* 一枚占据大半个盒子的盒子不是记号，是背景层。 */
      if (r.width > el.getBoundingClientRect().width * 0.6) continue
      return child
    }
    return null
  }

  const strokeInk = (el) => {
    const markEl = leadMark(el)
    if (markEl === null) return null
    const svg = markEl.tagName.toLowerCase() === 'svg' ? markEl : markEl.querySelector('svg')
    const shapes = svg === null
      ? [markEl]
      : [...svg.querySelectorAll('path, rect, circle, line, polyline')]
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
  const unionInk = (a, b) => {
    if (a === null) return b
    if (b === null) return a
    return {
      l: a.l === null || b.l === null ? null : Math.min(a.l, b.l),
      r: a.r === null || b.r === null ? null : Math.max(a.r, b.r),
      t: Math.min(a.t, b.t),
      b: Math.max(a.b, b.b),
      lines: a.lines,
    }
  }

  const boxOf = (el) => {
    const r = el.getBoundingClientRect()
    return { l: round(r.left), r: round(r.right), t: round(r.top), b: round(r.bottom), w: round(r.width), h: round(r.height) }
  }
  /* 中心只在**量得到**的时候给：`null` 混进算式会静默变成 0，而 0 是一个看起来很像答案的数
   * （实测栽过：墨的横向读数没量到时，`cy` 把 `null + null` 当 0 收下，偏差被报成 −955px）。 */
  const cy = (box) => (Number.isFinite(box.t) && Number.isFinite(box.b) ? round((box.t + box.b) / 2) : null)
  const cx = (box) => (Number.isFinite(box.l) && Number.isFinite(box.r) ? round((box.l + box.r) / 2) : null)

  /* ── 裁剪链：墨的刀 ─────────────────────────────────────────────────────────
   *
   * **只数面板自己的祖先。** `html`/`body` 不算：窗口边缘不是我们能修的裁剪，而且那外面的
   * 像素读者本来就够不着——量到过的那一枚（面板顶栏的铃）在工件页上被 `body` 裁掉 7px，那是
   * **工件页自己的壳**，不是面板的几何。
   *
   * 最近的那一条给 A3（热区环），整条链给 A4（墨被谁切了）。`includeSelf` 是给 A4 用的：
   * 装字的盒子自己就可能是那把刀（省略号那一条 `overflow: hidden`）。 */
  const clipBoxesOf = (el, includeSelf) => {
    const out = []
    let node = includeSelf ? el : el.parentElement
    while (node !== null && node !== document.body && node !== document.documentElement) {
      const st = getComputedStyle(node)
      if (st.overflowX !== 'visible' || st.overflowY !== 'visible' || st.clipPath !== 'none') {
        const r = node.getBoundingClientRect()
        out.push({
          node,
          // 名字为空时退回标签名：一个报成空串的裁剪者，读者认不出它说的是谁。
          key: keyOf(node) === '' ? node.tagName.toLowerCase() : keyOf(node),
          overflowX: st.overflowX,
          overflowY: st.overflowY,
          overflow: `${st.overflowX}/${st.overflowY}`,
          // 内边 = 边框盒减掉边框，也就是滚动口/裁剪口所在的那一格。
          l: r.left + node.clientLeft,
          t: r.top + node.clientTop,
          r: r.left + node.clientLeft + node.clientWidth,
          b: r.top + node.clientTop + node.clientHeight,
        })
      }
      node = node.parentElement
    }
    return out
  }

  /** 一串字被切掉多少。**逐边问**：这一串字自己在裁剪口里、而墨在外面，那才是被切掉的一截；
   * 整块内容滚出去了（元素自己就在裁剪口外）不算——那不是切，是没滚到。 */
  const cutOf = (run, ink) => {
    const parent = run.node.parentElement
    if (parent === null || ink === null) return null
    const clips = clipBoxesOf(parent, true)
    if (clips.length === 0) return null
    const own = parent.getBoundingClientRect()
    /* 每一条边取最紧的那把刀（裁剪链的交集）。 */
    const topClip = clips.reduce((a, c) => (c.t > a.t ? c : a))
    const bottomClip = clips.reduce((a, c) => (c.b < a.b ? c : a))
    const leftClip = clips.reduce((a, c) => (c.l > a.l ? c : a))
    const rightClip = clips.reduce((a, c) => (c.r < a.r ? c : a))
    /* 这一边作不作数：刀就是**自己**（省略号那一条 `overflow: hidden`）时永远作数；
     * 是祖先时，只有「这一串字还在那个口子里」才作数。 */
    const side = (clip, holds) => (clip.node === parent || holds ? round(Math.max(0, clip.gap)) : 0)
    return {
      top: side({ node: topClip.node, gap: topClip.t - ink.t }, own.top >= topClip.t - 1),
      bottom: side({ node: bottomClip.node, gap: ink.b - bottomClip.b }, own.bottom <= bottomClip.b + 1),
      left: ink.l === null ? 0 : side({ node: leftClip.node, gap: leftClip.l - ink.l }, own.left >= leftClip.l - 1),
      right: ink.r === null ? 0 : side({ node: rightClip.node, gap: ink.r - rightClip.r }, own.right <= rightClip.r + 1),
      by: `${topClip.key}/${bottomClip.key}`,
    }
  }

  /* ── A1：胶囊 ──────────────────────────────────────────────────────────────── */
  const looksLikeCapsule = (el) => {
    const r = el.getBoundingClientRect()
    /* **这张网的下沿必须低于任何一枚正常的胶囊，而不是低于缺陷。** 从前这里是 14px，于是
     * 「被压扁到 12.41px 的芯片」连进网都进不来——缺陷自己把自己的证据藏起来了，而 A5 正是
     * 为它写的。10px 以下不可能是一枚装得下字的胶囊，所以下沿放在那里。 */
    if (r.height < 10 || r.height > 56 || r.width < 24) return null
    const st = getComputedStyle(el)
    if (!['flex', 'inline-flex', 'block', 'inline-block', 'grid', 'inline-grid'].includes(st.display)) return null
    const radius = Math.max(px(st.borderTopLeftRadius), px(st.borderTopRightRadius))
    if (radius < 8 && radius < r.height / 2 - 0.5) return null
    const painted = (st.backgroundColor !== 'rgba(0, 0, 0, 0)' && st.backgroundColor !== 'transparent') ||
      px(st.borderTopWidth) > 0 || px(st.borderBottomWidth) > 0
    return painted ? st : null
  }

  /* **横向政策由盒子自己说，而且只在它说了算的那条轴上问。** 一枚胶囊的内容是靠中还是靠左：
   * flex/grid 容器里答案是 `justify-content`——`text-align` 在那里**不生效**，而 `<button>` 带着
   * browser 默认的 `text-align: center` 进来，于是「按 text-align 判」会把每一枚按钮型胶囊都
   * 当成声明了居中，再把它的内容量成一枚靠左的缺陷（量到过：`.boardDemand` 报 6px，而它是
   * `padding: 0 12px` 对称、内容本来就居中）。块容器里才读 `text-align`。
   * 审计只判「声明了居中的那些**真的**居中了吗」，靠左的那些**列出来**——「这一枚为什么靠左」
   * 是设计决定。 */
  const horizPolicy = (st) => {
    const flex = st.display.includes('flex') || st.display.includes('grid')
    if (flex) {
      return st.justifyContent === 'center' || st.justifyContent === 'space-around' || st.justifyContent === 'space-evenly' ? 'center' : 'start'
    }
    return st.textAlign === 'center' ? 'center' : 'start'
  }

  /* ── 一次扫描（可重跑：自证要在同一把尺子上量一颗种下的坏胶囊）───────────────── */
  const scan = () => {
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
        const mark = strokeInk(el)
        const content = unionInk(ink, mark)
        /* 切割逐串字求，取最大的那一边。 */
        let cutTop = 0
        let cutBottom = 0
        let cutLeft = 0
        let cutRight = 0
        let cutBy = null
        for (const run of runs) {
          const one = glyphInk(el, [run])
          const cut = one === null ? null : cutOf(run, one)
          if (cut === null) continue
          if (cut.top > cutTop) { cutTop = cut.top; cutBy = cut.by }
          if (cut.bottom > cutBottom) { cutBottom = cut.bottom; cutBy = cut.by }
          cutLeft = Math.max(cutLeft, cut.left)
          cutRight = Math.max(cutRight, cut.right)
        }
        /* **装得下**才是那条不变量：内容盒（盒高减掉块向内衬与上下边）不小于它自己声明的行盒。
         * 写成「盒高 ≥ 行盒 + 内衬」在墨心修正加了内衬之后会自己变红——那条式子里内衬出现两次，
         * 而真正要问的只有一件事：这一行字在它的内容盒里放得下吗。 */
        const contentBox = ink === null ? null : round(box.h - px(st.paddingTop) - px(st.paddingBottom) - px(st.borderTopWidth) - px(st.borderBottomWidth))
        const floor = ink === null ? null : ink.lineBox
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
          offX: content === null || cx(content) === null ? null : round(cx(content) - cx(box)),
          markOffY: mark === null ? null : round(cy(mark) - cy(box)),
          textVsMark: ink === null || mark === null ? null : round(cy(ink) - cy(mark)),
          cutTop: round(cutTop),
          cutBottom: round(cutBottom),
          cutLeft: round(cutLeft),
          cutRight: round(cutRight),
          cutBy,
          contentBox,
          floor,
          squeezed: contentBox !== null && floor !== null && contentBox < floor - FLOOR_SLACK,
        }
      })

    /* 判据只管**单行的**胶囊：多行的盒子装的是段落，不是标签（`lines` 就是那个判据）。 */
    const labels = capsules.filter((c) => c.lines === 1)
    const centred = labels.filter((c) => c.policy === 'center')
    const startAligned = labels.filter((c) => c.policy !== 'center')
    return {
      capsules,
      labels,
      centred,
      startAligned,
      worstV: worst(labels.map((c) => c.offY)),
      worstH: worst(centred.map((c) => c.offX)),
      worstMark: worst(labels.map((c) => c.textVsMark)),
      /* 判据只对**量得到的**那些下结论：读不出来的那一枚是 `no-reading`，不是一条缺陷。 */
      offendersV: labels.filter((c) => Number.isFinite(c.offY) && !within(c.offY, TOL)),
      offendersH: centred.filter((c) => Number.isFinite(c.offX) && !within(c.offX, TOL_X)),
      /* **只看竖向**的切割。横向那一截是省略号的定义，不是缺陷。 */
      cutOffenders: labels.filter((c) => c.cutTop > CUT_SLACK || c.cutBottom > CUT_SLACK),
      floorOffenders: labels.filter((c) => c.squeezed),
    }
  }

  const clean = scan()

  /* ── A6：自证 ────────────────────────────────────────────────────────────────
   *
   * 种一颗**已知的坏胶囊**：一行装不下（`line-height: 40px` 的盒子只有 20px 高 = 压扁）、
   * 里面的装字盒子只有 6px 高还 `overflow: hidden`（= 字被切）、块首内衬 6px（= 偏下）。
   * 三条判据都该报出来；少一条就是这把尺子瞎了。种下去的那一颗带 `data-dsh-tb-selftest`，
   * 量完删掉——**探针不许留在页面上**。 */
  const SELFTEST_KEY = 'selftestCapsule'
  const plantDefect = () => {
    const host = document.createElement('div')
    host.setAttribute('data-dsh-tb-selftest', '')
    host.className = SELFTEST_KEY
    host.setAttribute('style', 'position:fixed;left:-400px;top:0;box-sizing:border-box;width:120px;height:20px;display:inline-flex;align-items:center;justify-content:center;padding-block-start:6px;background:rgb(9,9,9);border-radius:999px;overflow:hidden;line-height:40px;font-size:12px;color:rgb(255,255,255)')
    const inner = document.createElement('span')
    inner.setAttribute('style', 'display:block;block-size:6px;overflow:hidden;line-height:20px')
    inner.textContent = '自检'
    host.appendChild(inner)
    document.body.appendChild(host)
    return host
  }

  let selfTest = 'blind'
  let planted = null
  const probe = plantDefect()
  try {
    planted = scan()
  } finally {
    probe.remove()
  }
  if (planted !== null) {
    const seen = (list) => list.some((c) => c.key === SELFTEST_KEY)
    const alive = {
      offY: seen(planted.offendersV),
      cut: seen(planted.cutOffenders),
      squeezed: seen(planted.floorOffenders),
    }
    selfTest = alive.offY && alive.cut && alive.squeezed ? 'caught' : `blind:${JSON.stringify(alive)}`
  }

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

  /* ── A3：热区环越界 ────────────────────────────────────────────────────────── */
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
      const clip = clipBoxesOf(el, false)[0] ?? null
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
    capsulesCentredV: stateOf(clean.labels.length, clean.labels.filter((c) => Number.isFinite(c.offY)).length, clean.offendersV.length === 0),
    capsulesCentredH: stateOf(clean.centred.length, clean.centred.filter((c) => Number.isFinite(c.offX)).length, clean.offendersH.length === 0),
    textVsMarkAligned: stateOf(clean.labels.filter((c) => c.textVsMark !== null).length, clean.labels.filter((c) => c.textVsMark !== null).length, clean.labels.filter((c) => c.textVsMark !== null).every((c) => within(c.textVsMark, MARK_TOL))),
    inkNotCut: stateOf(clean.labels.length, clean.labels.length, clean.cutOffenders.length === 0),
    capsulesNotSqueezed: stateOf(clean.labels.length, clean.labels.filter((c) => c.floor !== null).length, clean.floorOffenders.length === 0),
    ringsInsideClip: stateOf(rings.length, rings.length, clippedRings.length === 0),
    selfTest,
  }

  return {
    page: document.title,
    href: location.pathname.split('/').pop() ?? '',
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, scrollbars: innerWidth - document.documentElement.clientWidth },
    media,
    pass,
    counts: {
      capsules: clean.capsules.length,
      labels: clean.labels.length,
      startAligned: clean.startAligned.length,
      withTextSlot: clean.capsules.filter((c) => c.hasTextSlot).length,
      missingSlot: [...new Set(clean.capsules.filter((c) => !c.hasTextSlot).map((c) => c.key))],
      cut: clean.cutOffenders.length,
      squeezed: clean.floorOffenders.length,
      scrollers: scrollers.length,
      rings: rings.length,
      clippedRings: clippedRings.length,
      deadRings: deadRings.length,
    },
    worst: { offY: clean.worstV, offX: clean.worstH, textVsMark: clean.worstMark },
    offenders: {
      offY: clean.offendersV.map((c) => ({ key: c.key, label: c.label, offY: c.offY, h: c.h, lineHeight: c.lineHeight, padBlock: c.padBlock, markOffY: c.markOffY, slot: c.hasTextSlot })),
      offX: clean.offendersH.map((c) => ({ key: c.key, label: c.label, offX: c.offX, h: c.h, justify: c.justify })),
      cut: clean.cutOffenders.map((c) => ({ key: c.key, label: c.label, cutTop: c.cutTop, cutBottom: c.cutBottom, h: c.h, lineHeight: c.lineHeight, by: c.cutBy })),
      squeezed: clean.floorOffenders.map((c) => ({ key: c.key, label: c.label, h: c.h, contentBox: c.contentBox, lineBox: c.floor, lineHeight: c.lineHeight, padBlock: c.padBlock })),
      rings: clippedRings,
    },
    /* 够不着、但没有危害的那半圈：报出来给人看，不判红。 */
    deadRings: deadRings.map((ring) => ({ key: ring.key, dead: ring.dead, clippedBy: ring.clippedBy, clippedAxis: ring.clippedAxis })),
    /* 靠左的那些**列出来**，不判红：一枚胶囊为什么靠左是设计决定，报告里看得见就够了。 */
    startAligned: clean.startAligned.map((c) => ({ key: c.key, offX: c.offX, w: c.w, justify: c.justify, h: c.h })),
    capsules: clean.capsules,
    scrollers,
  }
})())
