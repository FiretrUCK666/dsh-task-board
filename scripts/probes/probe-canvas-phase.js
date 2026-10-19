/**
 * **canvas 画出来的墨，要与 DOM 里那行字一模一样，才算得出来。**
 *
 * 两处要对齐：
 *   1. **比例**：canvas 的后备存储默认是 CSS 像素（`getImageData` 读的是 1 倍的位图），
 *      而 DOM 的文字在**设备像素**上光栅化。光栅化比例不同，hinted 的字形外框就不同
 *      （实测 12px：1 倍的墨高 11px，2 倍的 11.5px，差半像素）。
 *   2. **横向相位**：DOM 里那行字的 x 常常带小数（`textLeft` = 344.84），
 *      canvas 必须画在**同一个小数相位**上，否则字形在 x 上被吸附的位置不同，
 *      墨的上下沿也跟着差。
 *
 * 这一条把四个组合都量一遍，看哪一个与 DOM 对得上——对得上的那个，就是运行时
 * 唯一能用的那个。
 *
 * 用法：`--eval-file` 本文件；用 `?text=` `?size=` `?xphase=` 指定。
 */
(() => {
  const params = new URLSearchParams(location.search)
  const text = params.get('text') ?? '待办'
  const size = Number(params.get('size') ?? '12')
  const xphase = Number(params.get('xphase') ?? '0')
  const dpr = window.devicePixelRatio || 1
  const family = getComputedStyle(document.body).fontFamily

  const measure = (scale, phaseX) => {
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
    ctx.fillText(text, 8 + phaseX, baseline)
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
      topRel: top / scale - baseline,
      bottomRel: bottom / scale - baseline,
      midRel: (top + bottom) / 2 / scale - baseline,
      height: (bottom - top + 1) / scale,
    }
  }

  return JSON.stringify({
    dpr,
    text,
    size,
    xphase,
    one: measure(1, 0),
    oneX: measure(1, xphase),
    scaled: measure(dpr, 0),
    scaledX: measure(dpr, xphase),
  })
})()
