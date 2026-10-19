/**
 * **canvas 画出来的墨，与 DOM 里画出来的墨，是同一件事吗？**
 *
 * 这一条决定运行时能不能用 canvas 来量「渲染后的墨」——如果两边不是同一件事，
 * 那 canvas 量出来的数就只能用来猜，不能用来校正。
 *
 * 有一个很可能的差别：**canvas 的后备存储是 CSS 像素**（`getImageData` 读的是
 * 1 倍的位图），而 DOM 的文字在设备像素上光栅化（这里 DPR=2）。**光栅化的比例不同，
 *  hinted 的字形外框就不同**——于是「墨有多高、落在基线哪里」也不同。
 *
 * 所以这一条量两遍：1 倍的 canvas 与 DPR 倍的 canvas，看它们的墨差多少。
 *
 * 用法：`--eval-file` 本文件。
 */
(() => {
  const params = new URLSearchParams(location.search)
  const text = params.get('text') ?? '待办'
  const size = Number(params.get('size') ?? '12')
  const dpr = window.devicePixelRatio || 1
  const family = getComputedStyle(document.body).fontFamily

  /** 在给定的比例上画一遍，量墨相对基线偏了多少。 */
  const measure = (scale) => {
    const canvas = document.createElement('canvas')
    canvas.width = 256 * scale
    canvas.height = 128 * scale
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx === null) return null
    ctx.scale(scale, scale)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 256, 128)
    ctx.font = `500 ${size}px ${family}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#000000'
    const baseline = 64
    ctx.fillText(text, 8, baseline)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const width = canvas.width
    let top = -1
    let bottom = -1
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4
        if (data[i] < 128) {
          if (top < 0) top = y
          bottom = y
          break
        }
      }
    }
    if (top < 0) return null
    return {
      scale,
      topRel: (top / scale) - baseline,
      bottomRel: (bottom / scale) - baseline,
      midRel: ((top + bottom) / 2) / scale - baseline,
      height: (bottom - top + 1) / scale,
    }
  }

  const one = measure(1)
  const dprScaled = measure(dpr)
  const ideal = (() => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx === null) return null
    ctx.font = `500 ${size}px ${family}`
    const m = ctx.measureText(text)
    return {
      inkAscent: m.actualBoundingBoxAscent,
      inkDescent: m.actualBoundingBoxDescent,
      idealMid: (-m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 2,
    }
  })()

  return JSON.stringify({ dpr, text, size, one, dprScaled, ideal })
})()
