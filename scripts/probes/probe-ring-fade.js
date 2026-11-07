// 未读那盏环的量法：**卡片自己不淡，环自己淡**。
//
// 打开一张带未读卡的页面，读 1.6 秒内的计算值，回答两件事：
//
//   cardItselfFades  —— 卡片本体的 opacity 会不会在 0 与 1 之间来回。
//                       这曾经是 true（0.005 … 0.995）：环直接画在卡片上，`opacity`
//                       关键帧把标题、时间、芯片连同纸一起淡掉了。现在必须是 false。
//   ringLayerFades   —— 环那一层（`::before`）自己淡，这才是那句「呼吸」该住的地方。
//
// 判据只读**绘制结果**（computed opacity），不读源码——源码看起来完全正常，那是这个
// 缺陷当初能活下来的原因。结构判据在 `scripts/verify-breath-fades-decoration.mjs`；
// 这一支补的是它证明不了的那一半：真实浏览器里，字到底会不会跟着闪。
//
// 用法：
//   node scripts/shot-panel.mjs --url file:///<cwd>/tmp/ask/only.html \
//     --eval-file scripts/probes/probe-ring-fade.js --out tmp/ask/ring-fade.png
;(() => {
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
  const card = document.querySelector(".card[data-light='ring'], [class*='card'][data-light='ring']")
  if (card === null) {
    return Promise.resolve({ found: false, note: 'no unread card on this page' })
  }
  const read = () => {
    const style = getComputedStyle(card)
    const layer = getComputedStyle(card, '::before')
    return {
      card: Number(style.opacity),
      layer: Number(layer.opacity),
      layerAnimation: layer.animationName,
      layerOutline: layer.outlineWidth + ' ' + layer.outlineColor,
      cardAnimation: style.animationName,
    }
  }
  return (async () => {
    const samples = []
    for (let i = 0; i < 10; i += 1) {
      samples.push(read())
      await sleep(160)
    }
    const cardValues = samples.map((one) => one.card)
    const layerValues = samples.map((one) => one.layer)
    return {
      found: true,
      layerAnimation: samples[0].layerAnimation,
      layerOutline: samples[0].layerOutline,
      // 承重的一条：卡片本体一动不动。
      cardItselfFades: Math.min(...cardValues) < 0.99,
      // 它的另一半：淡的是环那一层。
      ringLayerFades: Math.max(...layerValues) - Math.min(...layerValues) > 0.5,
      cardSamples: cardValues.map((one) => one.toFixed(2)),
      layerSamples: layerValues.map((one) => one.toFixed(2)),
    }
  })()
})()
