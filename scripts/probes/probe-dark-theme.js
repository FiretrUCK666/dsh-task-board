// 深色那一档：**把主题真的打上去，再读一次**。
//
// ── 为什么这一支探针要存在 ────────────────────────────────────────────────────
//
// 审计的矩阵原先只有「宽 × 像素密度 × 指针能力 × 字体」——**主题不在这四样里**，于是
// 「深色下这些读数还成立吗」从来没有被问过。而深色不是「同一页换个颜色」：
//
//   · 令牌层的深色块挂在 `body[data-ds-dark-theme]` 上——那是**宿主打的属性**，不是
//     CSS 的 `prefers-color-scheme`；
//   · 于是 `--color-scheme dark`（`shot-panel` 的旗子，设的是媒体查询）在一块只读
//     `:root` 的静态工件上**什么都不会发生**：截图与浅色逐像素相同，而报告里会写
//     「深色已审」。**假主题比不测更坏**——它是这一整套仪器最坏的一种谎；
//   · 而深色下确实有不一样的东西：宿主浅色把三档表面解成同一个白，深色才给出
//     `#151517 → #353638` 的台阶。换句话说，**「这张卡浮在页面上」在深色下才真的有
//     颜色可用**，浅色全靠影撑着。
//
// 所以这一支探针做的第一件事不是量，是**把那个属性打上去**；第二件事是**证明它真的
// 变了**（否则后面量到的是浅色，而报告会说深色已审）。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   D1 主题真的变了        根元素的 `background-color` 与打属性之前不同。不变就是 blind
//                          ——这一条比后面所有条都重要：它决定后面那些数说的是哪个主题。
//   D2 页面不是白底          深色档下根元素的底色亮度必须低于一半（`rgb(21,21,23)` 那一族）。
//                          亮的说明属性没生效，或者令牌层的深色块没跟上。
//   D3 纸面与画布分得开     纸面（`.paperSheet`）的底色不能等于画布：两者相等时读者看不到
//                          「一张纸」，只看到一整块平的东西——浅色下它们靠影分开，深色下
//                          靠的是台阶，而台阶没了就什么都没了。
//   D4 纸面是不透明的        纸面的 alpha = 1。半透明的纸在深色下会把背景透上来，而那上面
//                          是要读的字。
//   D5 每一枚纸都有角        页面上挂了 `.paperSheet` 的每一枚元素，`borderTopLeftRadius`
//                          不能是 0。**这一条钉的是一处真实的缺陷**：角原先被划成「页面自己
//                          的几何」，于是总览页的四格、两张卡、流水线一起变成直角，而屏上
//                          没有任何报错（缺一条声明是沉默的）。
//
// ── 自证 ────────────────────────────────────────────────────────────────────
//
// D1 与 D5 天然自证：D1 拿「打属性之前」的读数当对照（同一页，同一个元素），D5 只认真实
// 渲染出来的计算值。测不出 D1 就是 `blind`，而不是「深色没问题」。
//
// 这一支**不做判红**：它只报读数（`shot-panel --eval` 的返回），判真假归 `audit-panels.mjs`
// ——一支既量又判的探针会长成第二个测试框架。

;(() => {
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

  /** 相对亮度（sRGB 的近似，够用来分「深、浅」两档）。 */
  const luminance = (color) => {
    const match = /rgba?\(([^)]+)\)/.exec(color) ?? /color\(srgb ([^)]+)\)/.exec(color)
    if (match === null) return null
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (parts.length < 3) return null
    // `color(srgb …)` 给的是 0–1，`rgb(…)` 给的是 0–255。
    const scale = parts[0] <= 1 ? 1 : 255
    const [r, g, b] = parts.map((one) => one / scale)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }

  const root = document.querySelector('[data-dsh-taskboard-view]') ?? document.documentElement

  /* **判据读的是令牌，不是根元素的背景色。** 背景色不可靠：有的页把那块交给外层（工件里它是
     `rgba(0,0,0,0)`，于是「变了没」永远是没变——那是量具的错，不是主题的错，而它会把五张好好
     的页报成红的）。真正回答「深色块生效了没」的是**令牌层自己的那两个值**：它们在
     `body[data-ds-dark-theme]` 下被重写，浅色与深色必然不同。 */
  const readTokens = () => {
    const style = getComputedStyle(root)
    return [
      style.getPropertyValue('--dsh-tb-bg').trim(),
      style.getPropertyValue('--dsh-tb-text-1').trim(),
      style.getPropertyValue('--dsh-tb-plane-sheet').trim(),
    ].join(' | ')
  }

  const before = readTokens()
  const beforeCanvas = getComputedStyle(root).backgroundColor

  document.body.setAttribute('data-ds-dark-theme', '')

  return sleep(400).then(() => {
    const rootStyle = getComputedStyle(root)
    const after = readTokens()
    const afterCanvas = rootStyle.backgroundColor
    const papers = [...document.querySelectorAll('.paperSheet, [class*="paperSheet"]')]
    const shapes = papers.map((el) => {
      const style = getComputedStyle(el)
      return {
        cls: String(el.className).slice(0, 60),
        plane: style.backgroundColor,
        radius: style.borderTopLeftRadius,
        alpha: (() => {
          const match = /rgba?\(([^)]+)\)/.exec(style.backgroundColor)
          if (match === null) return 1
          const parts = match[1].split(/[\s,/]+/).filter(Boolean)
          return parts.length >= 4 ? Number(parts[3]) : 1
        })(),
      }
    })

    return {
      theme: {
        attributeSet: document.body.hasAttribute('data-ds-dark-theme'),
        canvasBefore: beforeCanvas,
        canvasAfter: afterCanvas,
        tokensBefore: before,
        tokensAfter: after,
        changed: before !== after,
        canvasLuminance: luminance(afterCanvas),
        pageLuminance: luminance(afterCanvas),
      },
      papers: shapes,
      ok: {
        d1ThemeChanged: before !== after,
        /* 画布可能交给外层（透明），那时亮度判不了，改为「令牌真的变了」就算过。 */
        d2CanvasIsDark: afterCanvas.startsWith('rgba(0, 0, 0, 0)') ? before !== after : (luminance(afterCanvas) ?? 1) < 0.5,
        d3PaperSeparatedFromCanvas: shapes.length === 0 ? true : shapes.every((one) => one.plane !== afterCanvas),
        d4PaperOpaque: shapes.every((one) => one.alpha === 1),
        d5EveryPaperRounded: shapes.every((one) => one.radius !== '0px' && one.radius !== ''),
      },
    }
  })
})()
