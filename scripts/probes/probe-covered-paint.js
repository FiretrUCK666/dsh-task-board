// 量「被盖住的那一层到底停了什么」——两件事分开量，因为它们由两条不同的机制停下。
//
// ── 为什么这一支探针要存在 ────────────────────────────────────────────────────
//
// 打开一张卡或一个会话面板只是**盖住**看板，并不卸载它。被盖住的看板在四件事上都不该
// 花钱：动画、绘制、布局、React 的重算。前两件由 `board.module.css` 的一条 `:has()`
// 规则停下（列子树 `content-visibility: hidden`），后两件由 `design/cover.ts` 那张登记
// 表停下（订阅不收、FLIP 不量）。
//
// **这条规则的正确性只能靠真实 DOM 回答**：`:has()` 的匹配取决于层级，而层级不是从
// 样式表能看出来的。写它的过程中组合符就从 `>` 改成了后代，因为面板实际渲染在 `.board`
// **里面**；一个看起来对、实际匹配不上的选择器在源码里读起来毫无异样。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   H1 覆盖层在时，列子树的 content-visibility 是 hidden（绘制与布局都跳过）
//   H2 覆盖层在时，列子树里的元素不再被渲染（checkVisibility 为假）
//   H3 覆盖层移除后，列子树回到 visible 且重新被渲染（**可逆**）
//   H4 覆盖层移除后，列的盒子仍然是同一个尺寸（盒子还在，关掉面板不跳）
//   H5 面板**内部**一个以 `_columns` 结尾的类名仍然是 visible（类名后缀那个老错）
//
// **H1-H2 与 H3-H5 是两组失败**：前两条说「没停下」，后三条说「停得太狠」——把面板
// 自己的内容一起藏掉、或者把列的盒子摘掉让整块板在关闭时跳一下。两组分开算，因为
// 修法方向相反。
//
// ── 怎么跑 ───────────────────────────────────────────────────────────────────
//
//   node scripts/probes/probe-covered-paint.cjs
//   node scripts/shot-panel.mjs --url file:///<cwd>/tmp/probe-covered-paint.html \
//     --eval-file scripts/probes/probe-covered-paint.js --audit --out tmp/covered-paint.png
//
// 造页在 `.cjs` 里（node 端要写文件），量页在这里（Chromium 端只读 DOM）——两半
// 分工，是因为同一份 `.js` 在 ESM 包里跑 node 时拿不到 `require`。
;(() => {
  const columns = document.querySelector('[data-dsh-tb-columns]')
  const insidePanel = document.querySelector('.abc123_fakeColumns')
  const card = document.querySelector('.card')
  if (columns === null || card === null) {
    return { error: 'the artifact page is missing its columns grid or its card — did the builder run?' }
  }

  const report = []
  const check = (id, label, got, want) => report.push({ id, label, got, want, ok: got === want })
  const style = (element) => (element === null ? 'missing' : getComputedStyle(element).contentVisibility)
  /** 「它被渲染了吗」。`content-visibility: hidden` 让整棵子树不再是渲染对象。 */
  const rendered = (element) => (element === null ? 'missing' : element.checkVisibility());

  check('H1', 'columns while covered', style(columns), 'hidden')
  check('H2', 'a card inside the skipped subtree is not rendered', rendered(card), false)
  if (insidePanel === null) {
    report.push({ id: 'H5', label: 'panel content', got: 'missing', want: 'visible', ok: false })
  } else {
    check('H5', 'a `_columns`-suffixed class INSIDE the panel is untouched', style(insidePanel), 'visible')
  }

  const boxWhileCovered = columns.getBoundingClientRect()

  // Closing the overlay must restore rendering, not merely start it hidden.
  const backdrop = document.getElementById('backdrop')
  if (backdrop !== null) backdrop.remove()
  check('H3', 'columns after overlay closed', style(columns), 'visible')
  check('H3b', 'the card is rendered again', rendered(card), true)

  const boxAfter = columns.getBoundingClientRect()
  /* THE BOX MUST SURVIVE EXACTLY, HEIGHT INCLUDED.
   *
   * `content-visibility: hidden` skips the subtree's layout and paint but KEEPS the
   * element's own box — and on the real board the grid's height comes from the board's
   * column flex (`flex: 1`), not from its contents. So the height is unchanged too, and
   * closing the panel cannot shift the board. That is the whole reason this shape was
   * chosen over `display: none`, and it is worth measuring rather than asserting in
   * prose: the artifact page reproduces the flex so the number means the same thing. */
  const kept = Math.round(boxWhileCovered.width) === Math.round(boxAfter.width)
    && Math.round(boxWhileCovered.height) === Math.round(boxAfter.height)
    && Math.round(boxWhileCovered.left) === Math.round(boxAfter.left)
    && Math.round(boxWhileCovered.top) === Math.round(boxAfter.top)
  check('H4', 'the box survives exactly (width, height, origin)', kept, true)

  return {
    report,
    measured: {
      coveredBox: { width: Math.round(boxWhileCovered.width), height: Math.round(boxWhileCovered.height) },
      revealedBox: { width: Math.round(boxAfter.width), height: Math.round(boxAfter.height) },
    },
  }
})()
