// 覆盖层盖住看板时，背后的动画必须真的停下——**读浏览器算出来的值，不读源码字符串**。
//
// ── 为什么这一支探针要存在 ────────────────────────────────────────────────────
//
// 打开一张卡或一个会话面板只是**盖住**看板，并不卸载它：列、卡片、以及它们那些
// 2.6 秒一轮的呼吸灯全都在跑，就藏在读者正在滚动的东西后面。每一帧都在为没人看的
// 地方重绘，而这份代价叠在读者真正在做的那次滚动上。
//
// 判据写在一条 `:has()` 选择器里（`board.module.css` 的
// 「ANIMATION STOPS WHEN AN OVERLAY COVERS IT」）。**这条规则的正确性只能靠真实
// DOM 回答**：`:has()` 的匹配取决于层级，而层级不是从样式表能看出来的——写这条规则
// 的过程中组合符就从 `>`（子）改成了后代，因为面板实际渲染在 `.board` **里面**。
// 一个看起来对、实际匹配不上的选择器，在源码里读起来毫无异样。
//
// ── 判据 ─────────────────────────────────────────────────────────────────────
//
//   H1 覆盖层在时，它背后的卡片是 paused
//   H2 覆盖层在时，它背后的列是 paused
//   H3 覆盖层在时，它背后的会话行是 paused
//   H4 覆盖层移除后，卡片重新是 running
//   H5 覆盖层移除后，列重新是 running
//
// **「盖住时还是 running」与「移除后还是 paused」是两种不同的失败**，所以 H4/H5
// 单独算，不并进 H1-H3：前者说明规则没生效，后者说明生效了但不可逆——关掉面板后
// 呼吸灯永远停着，比不停更坏。
//
// ── 怎么跑 ───────────────────────────────────────────────────────────────────
//
// 需要一张与真实层级同形状的工件页：`node scripts/probes/probe-overlay-pause.cjs`
// 写出它，然后把本文件交给 Chromium：
//
//   node scripts/probes/probe-overlay-pause.cjs
//   node scripts/shot-panel.mjs --url file:///<cwd>/tmp/probe-overlay-pause.html \
//     --eval-file scripts/probes/probe-overlay-pause.js --audit
//
// 造页在 `.cjs` 里（node 端要写文件），量页在这里（Chromium 端只读 DOM）——两半
// 分工，是因为同一份 `.js` 在 ESM 包里跑 node 时拿不到 `require`。
;(() => {
  const state = (sel) => {
    const element = document.querySelector(sel)
    return element === null ? 'missing' : getComputedStyle(element).animationPlayState
  }
  const report = []
  const check = (id, label, got, want) => report.push({ id, label, got, want, ok: got === want })

  check('H1', 'card behind overlay', state('.card'), 'paused')
  check('H2', 'column behind overlay', state('.column'), 'paused')
  check('H3', 'sessionRow behind overlay', state('.sessionRow'), 'paused')

  // Closing the overlay must restore the animation, not merely start it stopped.
  const backdrop = document.getElementById('backdrop')
  if (backdrop !== null) backdrop.remove()
  check('H4', 'card after overlay closed', state('.card'), 'running')
  check('H5', 'column after overlay closed', state('.column'), 'running')

  return report
})()
