/**
 * 把「怎么让一行字在胶囊里居中」的几种做法**并排量出来**，而不是一次改一个去试。
 *
 * 为什么需要这一条：同一件事在代码里有过四种做法——`line-height: 1`、下内衬
 * `2 × drop`、`text-box-trim`、以及图标上的 `translate`——而它们各自的残余偏差从
 * 没有摆在同一把尺子下面比较过。于是每一次「调一下」都是在不知道其他做法更好的
 * 前提下进行的，读起来像在打补丁，实际上也确实是在打补丁。
 *
 * 这一条造四个**一模一样**的胶囊（同高、同字号、同内衬、同文字），只有居中机制
 * 不同，然后量各自的**墨心相对盒心**。差值就是那个机制的全部残余误差。
 *
 * 判据：`|delta| < 0.25px` 算「对齐了」。人眼在 1x 屏上分不出半像素，但连续几枚
 * 各差一点会读成「这一排歪了」。
 *
 * 用法：node scripts/shot-panel.mjs --url file:///... --eval-file scripts/probes/probe-centering-approaches.js
 * 只读，不写任何文件。
 */
(() => {
  const round = value => Math.round(value * 100) / 100
  const canvas = document.createElement('canvas').getContext('2d')

  /** 墨心相对盒心的偏移（px，正 = 墨偏下）。 */
  const measure = (element, text) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const metrics = canvas.measureText(text)
    const ascent = metrics.actualBoundingBoxAscent
    const descent = metrics.actualBoundingBoxDescent

    /* 行的位置：字所在的**行盒**。取文字子项的盒（有就取），否则取胶囊自己。 */
    const child = element.firstElementChild
    const line = child !== null && child.getBoundingClientRect().height > 0
      ? child.getBoundingClientRect()
      : rect
    const lineHeight = parseFloat(style.lineHeight)
    const resolved = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : line.height
    const halfLeading = (resolved - (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent)) / 2
    const baseline = line.top + halfLeading + metrics.fontBoundingBoxAscent

    const inkCenter = (baseline - ascent + baseline + descent) / 2
    return round(inkCenter - (rect.top + rect.height / 2))
  }

  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:white;padding:16px;display:flex;gap:12px;align-items:flex-start;'
  document.body.appendChild(host)

  /* 四份做法。共同的部分写一次，差别只在 `centering`。 */
  const base = 'display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:28px;padding:0 14px;border:1px solid #ccc;border-radius:999px;font-size:13px;font-weight:500;background:#fff;color:#111;'
  const approaches = [
    { id: 'line-height-1', note: '现在这一套：行高 1，靠字体度量', css: 'line-height:1;' },
    { id: 'pad-2drop', note: '下内衬 2×0.04em 的墨位校正', css: 'line-height:1;padding-bottom:calc(0.04em * 2);' },
    { id: 'trim-cap', note: 'text-box-trim + cap alphabetic', css: 'line-height:1;text-box-trim:trim-both;text-box-edge:cap alphabetic;' },
    { id: 'trim-text', note: 'text-box-trim + text（字体自报上下沿）', css: 'line-height:1;text-box-trim:trim-both;text-box-edge:text;' },
    { id: 'tight-line', note: '行高 = 字号，无任何补偿', css: 'line-height:1;letter-spacing:0;' },
  ]

  const results = []
  for (const approach of approaches) {
    const button = document.createElement('button')
    button.type = 'button'
    button.style.cssText = base + approach.css
    /* 与产品同样的结构：文字包一层槽（裸文本在 flex 里会变成匿名项）。 */
    const slot = document.createElement('span')
    slot.textContent = '新建任务'
    button.appendChild(slot)
    host.appendChild(button)
    results.push({
      id: approach.id,
      note: approach.note,
      applied: getComputedStyle(button).getPropertyValue('text-box-trim').trim() || 'none',
      delta: measure(button, '新建任务'),
    })
  }

  /* 顺带量一次**产品里真的有图标的那一枚**，因为「图标与文字对齐」是另一半问题。 */
  const withIcon = document.querySelector('button svg')
  let iconReport = null
  if (withIcon !== null) {
    const button = withIcon.closest('button')
    const box = button.getBoundingClientRect()
    const icon = withIcon.getBoundingClientRect()
    iconReport = {
      text: (button.textContent ?? '').trim().slice(0, 10),
      iconTop: round(icon.top - box.top),
      iconBottom: round(box.bottom - icon.bottom),
    }
  }

  host.remove()
  return JSON.stringify({ results, icon: iconReport })
})()
