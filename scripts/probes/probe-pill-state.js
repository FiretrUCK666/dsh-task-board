// 两档各自的「滑到最新」胶囊：看得见 / 看不见，两种状态都要真的画一遍。
//
// 打开 `tmp/probe-scroll-rerender.html` 之后按 `state` 开关那枚胶囊的隐藏状态——
// 它用的就是真样式表里那条 `[data-hidden='true']` 规则（`visibility: hidden` 保留
// 占位），所以这张图回答的是「读者看到的是不是这样」，不是「组件怎么算出来的」。
//
// 用法（两档 × 两态各一张）：
//   node scripts/shot-panel.mjs --url file:///<cwd>/tmp/probe-scroll-rerender.html \
//     --eval-file scripts/probes/probe-pill-state.js --out tmp/pill-on-wide.png
//   加上 `--width 412 --height 900` 就是窄档。
;(() => {
  const pill = document.getElementById('commentsPill')
  if (pill === null) return { error: 'no pill in the artifact page' }
  const params = new URLSearchParams(location.search)
  const hidden = params.get('state') === 'hidden'
  pill.toggleAttribute('data-hidden', hidden)
  pill.disabled = hidden
  return {
    hidden,
    box: (() => {
      const rect = pill.getBoundingClientRect()
      return { width: Math.round(rect.width), height: Math.round(rect.height) }
    })(),
    // The declared hiding tool must be `visibility`, because it PRESERVES the box:
    // removing the box at the end is what re-clamps the scroller under the reader.
    visibility: getComputedStyle(pill).visibility,
  }
})()
