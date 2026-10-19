/**
 * 墨位校正：**每一枚装字的盒子，各自算出自己该差多少**。
 *
 * ── 为什么必须逐元素 ──────────────────────────────────────────────────────────
 *
 * 屏上看到的是**字**（墨），而盒子里装的是**行盒**。两者不同心，差多少取决于三样
 * 东西，而这三样**逐元素不同**：
 *
 *   1. **字体度量**：字体的上下沿不对称，墨在行盒里就不居中。
 *   2. **行盒比元素盒高多少**：本项目的行高是 `1em`，中文字体的自然行高约 `1.33em`
 *      ——行盒比元素盒高出来的那一截落在盒子的哪一边，由元素自己的 `line-height`
 *      与 strut 决定。
 *   3. **字号**：上面两条都随字号缩放。
 *
 * 而且**渲染时基线会被吸附到整像素**：内衬 0.8px 与 1px 落在同一格（墨一动不动），
 * 1.1px 才跳一格。所以「差多少」不是连续的，而是**一格一格**的，而每一格的门槛
 * 由那一枚自己的几何决定。
 *
 * **⇒ 一个全局常数只能对齐一族，把别族推歪。**（量过的三个族：12px 的芯片要
 * 1.1px、13px 的页签要 2.0px、组头要 1.25px。）
 *
 * ── 这一版怎么算 ────────────────────────────────────────────────────────────
 *
 * 对每一枚**声明自己要被校正**的盒子（CSS 里写了 `--dsh-tb-optical-target: 1`）：
 *
 *   1. 从排版结果读出那行字的**基线**（`Range.getClientRects()` + 字体度量）；
 *   2. 读出**盒子的内容盒中心**（墨该待的地方）；
 *   3. 用 canvas 画一遍**同一串字**（同样的相位），量出**渲染后的墨**相对基线
 *      偏了多少——这是字体自己的性质，与元素无关；
 *   4. 由此解出「内衬该是多少」，写进这一枚自己的 `--dsh-tb-optical-shift`。
 *
 * 写的是**一个 CSS 变量**：CSS 那一侧仍然是自己那一行 `padding-block`，读的是
 * `var(--dsh-tb-optical-shift, 0px)`。所以：
 *
 *   - **不动几何**（没有 transform、没有 relative 定位）：不裁切、不重排、
 *     不让旁边的图标跟着动；
 *   - **不动宿主页**（只认自己那棵子树里的 `--dsh-tb-optical-target: 1`）；
 *   - **换机器自动重算**（量的是那台机器的字体与那一刻的排版）。
 */

/** 盒子上那个「我要被校正」的标记。CSS 里与它同一条规则必须读 `--dsh-tb-optical-shift`。 */
export const OPTICAL_TARGET_PROPERTY = '--dsh-tb-optical-target'

/** 写在这一枚盒子上的那个变量。 */
export const OPTICAL_SHIFT_PROPERTY = '--dsh-tb-optical-shift'

/** 死区：差值小于它就不动——不值得为一个四舍五入的噪声改布局。 */
const DEAD_ZONE = 0.2

/** canvas 量字体度量用的一张离屏画布（一张就够，量完只读不写）。 */
let scratch: CanvasRenderingContext2D | undefined

function context(): CanvasRenderingContext2D | undefined {
  if (scratch !== undefined) return scratch
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas')
  const ratio = Math.max(1, Math.min(4, Math.round(window.devicePixelRatio || 1)))
  /* **画布必须按设备像素比来画。** `getImageData` 读的是后备存储，而 canvas 的后备
     存储默认是**一个 CSS 像素一格**——于是它按 1 倍光栅化，而 DOM 的文字是在**设备
     像素**上光栅化的。光栅化比例不同，hinted 的字形外框就不同：实测 12px 的中文，
     1 倍画布的墨高 11px、DPR 画布的 11.5px，差半像素——比要校正的那点偏移还大。 */
  canvas.width = 256 * ratio
  canvas.height = 128 * ratio
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (ctx === null) return undefined
  ctx.scale(ratio, ratio)
  scratch = ctx
  return scratch
}

/**
 * 一枚元素的字体度量。
 *
 * @param style - 那枚元素的计算样式（字号、字重、字栈都从它来）。
 * @param text - 要量的那串字。
 */
function metricsOf(style: CSSStyleDeclaration, text: string): {
  ascent: number
  descent: number
} | undefined {
  const ctx = context()
  if (ctx === undefined) return undefined
  const size = Number.parseFloat(style.fontSize)
  if (!Number.isFinite(size) || size <= 0) return undefined
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`
  const measured = ctx.measureText(text)
  const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = measured
  if (!Number.isFinite(ascent) || !Number.isFinite(descent)) return undefined
  return { ascent, descent }
}

/**
 * **渲染后的墨**相对基线偏了多少。
 *
 * 用 canvas 在**同样的亚像素相位**上画一遍同一串字，量它的像素：这是「屏幕上的字」
 * 而不是「字形轮廓」。两者在小字号下能差将近一个像素（光栅化把字形吸附到像素
 * 栅格），而读者看到的是前者。
 *
 * @param phase - 基线的小数部分（0~1）。canvas 与 DOM 用同一套光栅化，所以相位
 *   相同则量到的东西相同。
 */
function renderedInkOffset(style: CSSStyleDeclaration, text: string, phase: number): number | undefined {
  const ctx = context()
  if (ctx === undefined) return undefined
  const size = Number.parseFloat(style.fontSize)
  if (!Number.isFinite(size) || size <= 0) return undefined

  const canvas = ctx.canvas
  const ratio = canvas.width / 256
  ctx.clearRect(0, 0, 256, 128)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 256, 128)
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#000000'
  const baseline = 64 + phase
  ctx.fillText(text, 8, baseline)

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let top = -1
  let bottom = -1
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const i = (y * canvas.width + x) * 4
      if (data[i] < 128) {
        if (top < 0) top = y
        bottom = y
        break
      }
    }
  }
  if (top < 0) return undefined
  /* 位图上的行号要换回 CSS 像素（画布是按设备像素比开的）。 */
  return (top + bottom) / 2 / ratio - baseline
}

/** 一枚盒子里**直接装着字**的那个元素。 */
function textHolder(box: HTMLElement): HTMLElement | undefined {
  const hasOwn = [...box.childNodes]
    .some((node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== '')
  if (hasOwn) return box
  const found = [...box.querySelectorAll('*')].find((one) =>
    [...one.childNodes].some((node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== ''))
  return found instanceof HTMLElement ? found : undefined
}

/**
 * 算一枚盒子该差多少内衬。
 *
 * 记号：`B` 是基线（排版结果），`C` 是内容盒中心（墨该待的地方），`K` 是渲染后的
 * 墨相对基线的偏移（字体自己的性质，与元素无关）。加了 `P` 的下内衬之后，基线上移
 * `P/2`，于是渲染出来的墨心是
 *
 *     snap(B − P/2) + K
 *
 * `snap` 是浏览器把基线吸附到像素栅格的那一步——**它让「差多少」变成一格一格的**：
 * 内衬 0.8px 与 1px 落在同一格（墨一动不动），1.1px 才跳一格。
 *
 * 要墨心等于 `C`，就要 `snap(B − P/2)` 等于 `C − K`。而**基线只能落在整像素上**，
 * 所以真正要命中的是 `C − K` 附近的**那个整数** `T'`：
 *
 *     snap(B − P/2) = T'   ⟺   B − P/2 ∈ [T' − 0.5, T' + 0.5)
 *
 * 于是 `P = 2 × (B − T')`。
 *
 * **`T'` 怎么取**：取离 `C − K` 最近的那个整数；**正好落在半像素上时取低的那一侧**
 * （`ceil(T − 0.5)`）。理由有两条：其一，DOM 渲染出来的墨比理想度量**略低**
 * （实测 12px：理想 −4.5px、实际 −4.25px——光栅化把字形吸附得比轮廓短一点），
 * 所以平局时瞄准「略低」才是对准实际；其二，读者对「偏上」的察觉比「偏下」敏感
 * （半像素的字在栅格上偏上时，下沿会贴到盒边）。
 */
function shiftOf(box: HTMLElement): number | undefined {
  const holder = textHolder(box)
  if (holder === undefined) return undefined
  const text = (holder.textContent ?? '').trim()
  if (text === '') return undefined

  const boxStyle = getComputedStyle(box)
  const holderStyle = getComputedStyle(holder)
  const metrics = metricsOf(holderStyle, text)
  if (metrics === undefined) return undefined

  const range = document.createRange()
  range.selectNodeContents(holder)
  const lines = [...range.getClientRects()].filter((one) => one.height > 0)
  if (lines.length === 0) return undefined
  const line = lines[0]

  /* 基线 = 行盒顶 + max(半行距_内联 + 字体上沿, 半行距_strut + 字体上沿)。
     strut 来自**元素自己**的字体（块容器的 strut 用它自己的 font/line-height）。 */
  const strut = metrics.ascent + metrics.descent
  const lineHeight = Number.parseFloat(holderStyle.lineHeight)
  const used = Number.isFinite(lineHeight) ? lineHeight : strut
  const baseline = line.top + Math.max(
    (used - strut) / 2 + metrics.ascent,
    metrics.ascent,
  )

  /* 盒子的内容盒中心：墨该待的地方。 */
  const rect = box.getBoundingClientRect()
  const padTop = Number.parseFloat(boxStyle.paddingTop) || 0
  const padBottom = Number.parseFloat(boxStyle.paddingBottom) || 0
  const borderTop = Number.parseFloat(boxStyle.borderTopWidth) || 0
  const borderBottom = Number.parseFloat(boxStyle.borderBottomWidth) || 0
  const contentTop = rect.top + borderTop + padTop
  const contentBottom = rect.bottom - borderBottom - padBottom
  const contentMid = (contentTop + contentBottom) / 2

  /* 渲染后的墨相对基线偏了多少：同一个字体、同样的相位、同样的设备像素比。 */
  const phase = baseline - Math.floor(baseline)
  const inkOffset = renderedInkOffset(holderStyle, text, phase)
  if (inkOffset === undefined) return undefined

  /* 目标：基线该落在哪个整像素上。 */
  const target = Math.ceil((contentMid - inkOffset) - 0.5)
  return 2 * (baseline - target)
}

/**
 * 把**自己子树里**那些声明了要校正的盒子，各算各的。
 *
 * 只认 `--dsh-tb-optical-target: 1` 的元素——那是 CSS 显式声明的「这一枚要校正」。
 * 于是：**宿主自己的界面一个都不碰**（上一版就是栽在这里：它把整个 document 的
 * 每一行字都改了，于是整个 DSH 页面都在被抬起）。
 *
 * @param root - 自己的子树。默认整个 document，但**只处理带标记的**。
 * @returns 写了几枚。
 */
export function applyInkShifts(root: ParentNode = document): number {
  let written = 0
  for (const element of root.querySelectorAll<HTMLElement>('*')) {
    const style = getComputedStyle(element)
    if (style.getPropertyValue(OPTICAL_TARGET_PROPERTY).trim() !== '1') continue
    const shift = shiftOf(element)
    if (shift === undefined) continue
    const next = Math.abs(shift) < DEAD_ZONE ? '0px' : `${Math.round(shift * 100) / 100}px`
    if (element.style.getPropertyValue(OPTICAL_SHIFT_PROPERTY) === next) continue
    element.style.setProperty(OPTICAL_SHIFT_PROPERTY, next)
    written += 1
  }
  return written
}

/**
 * 排队一次测量。
 *
 * **用微任务，不用 `setTimeout`。** 这是「跳页时弹一下」那条反馈的根因：延时 80ms
 * 意味着**浏览器已经画过一帧了**，于是新出现的文字先在没校正的位置上待一帧，
 * 下一帧才被挪过去——读者看到的就是「弹一下」。
 *
 * 微任务在**当前任务末尾、下一次绘制之前**跑完：文字在**它第一次被画出来之前**就已经
 * 在正确的位置上了。同一批里的多次变化会被合并成一次（微任务只排一个）。
 */
function scheduler(): () => void {
  let queued = false
  return () => {
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      applyInkShifts()
    })
  }
}

/**
 * 装上墨位校正：立刻量一次，然后在字体到齐、内容变化、尺寸变化时再量。
 *
 * 三条触发都必需，缺一条就有一种真实场景一直歪：
 *   - `fonts.ready`：中文字体常晚到，第一帧量的是回退字体；
 *   - `MutationObserver`（只看子节点）：切页、展开一行、列表增删都会出现新的盒子；
 *   - `ResizeObserver`：面板宽度变化会让文字换行、让行盒换高。
 *
 * @returns 一个 disposer；不返回它会让每次挂载都多留一个观察者。
 */
export function installInkMetrics(seat?: HTMLElement | null): () => void {
  const run = scheduler()
  run()

  const cleanups: Array<() => void> = []

  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
  if (fonts !== undefined) {
    void fonts.ready.then(() => { run() }).catch(() => {
      /* 字体没加载成功不是让页面失败的理由：第一帧那一量已经覆盖了正在渲染的字。 */
    })
  }

  const target = seat ?? document.body
  if (target !== null) {
    if (typeof MutationObserver === 'function') {
      /* 只看子节点：**不看属性**，因为校正本身就是写样式，看属性会自己触发自己。 */
      const observer = new MutationObserver(() => { run() })
      observer.observe(target, { childList: true, subtree: true })
      cleanups.push(() => { observer.disconnect() })
    }
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => { run() })
      observer.observe(target)
      cleanups.push(() => { observer.disconnect() })
    }
  }

  return () => {
    for (const cleanup of cleanups) cleanup()
  }
}
