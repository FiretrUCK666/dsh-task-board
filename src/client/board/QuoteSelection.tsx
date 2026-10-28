/**
 * 引用选中的文字：在会话面板里选中一段文字后，浮出一枚「引用文本」按钮，
 * 按下去就把那段字以 Markdown 引用行的形式写进评论输入框。
 *
 * ── 为什么要有它，以及它和宿主是什么关系 ─────────────────────────────────────
 *
 * 宿主 `dsh-message-quotes` 提供同样的手势（选中 → 浮出按钮 → 插入引用），但它走
 * `uiConversation` 那条服务线：选区由 conversation 服务裁决，插入由宿主自己的编辑器
 * （contentEditable 里的 QuoteNode）接住。**本插件的评论框是一个普通 `<textarea>`**
 * ——既不在那条服务的管辖里，也不是那个编辑器，所以那套接不进来（客户端打包门禁也
 * 禁止跨插件值导入）。于是这里自己做同一件事，**模型保持一致**：引用就是普通 Markdown
 * 文本，没有额外元数据、没有新消息类型。所以「发出去之后长什么样」那一半是现成的
 * ——`markdown-parser.ts` 认 `>` 引用块，`Markdown.tsx` 渲染成 `<blockquote>`。
 *
 * ── 引用的来源是「已经渲染出来的字」，不是输入框里的字 ───────────────────────
 *
 * 这与宿主的行为一致，也是唯一可行：`<textarea>` 内部的选区**没有任何 DOM 矩形**，
 * 浏览器不给。而面板里的转写与已有评论都是渲染过的节点，`getSelection()` 能给出它们的
 * 真实矩形。于是读者选中「刚才那段话」就能引用它——那正是需要引用的场合；引用自己还没
 * 发出去的草稿没有意义。
 *
 * ── 为什么它挂在整个面板上，而不是逐条消息挂 ─────────────────────────────────
 *
 * 选区可以横跨两条消息。逐条挂就要处理「跨两行」并做合并——同一份判据在很多地方重复，
 * 而且永远处理不全。挂面板只需要一个监听、一份判据：选区落在面板里、且不在输入框里。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Icon } from '../design/ui.tsx'
import { boardBox } from '../design/Dialog.tsx'
import { quoteAnchorOf } from './quote-anchor.ts'
import { quoteTextOf } from './quote-text.ts'

/**
 * 选区里不该被当成「可引用的字」的地方。
 *
 * 一个选区横跨面板时 `selection.toString()` 会把它们一起吐出来，而它们不是读者想引用
 * 的内容：输入框里是他自己正在写的草稿，按钮与菜单是控件。判据按祖先查——选区只要碰到
 * 这些，这次手势就不成立。
 */
const EXCLUDED = 'textarea, input, [contenteditable="true"], button, select, [role="menu"], [role="dialog"]'

/** 首帧还没量到真实尺寸时先按这个摆一次，量到之后再校正。 */
const ASSUMED = { width: 88, height: 28 }

/** 一次选区的快照：已经编码好的引用文本，以及它在视口里的外接矩形。 */
interface SelectionSnapshot {
  quote: string
  rect: { top: number; left: number; width: number; height: number }
}

/**
 * 读当前选区，判定它是否是一次「可引用的选择」。
 *
 * 四条同时成立，每条都对应一次真实的误触发：
 *
 * 1. **有非空选中文字**——没有就是一次点击，不是选择；
 * 2. **选区落在 `host` 之内**——面板之外的选择（侧栏、另一个面板）与本面板无关；
 * 3. **没有碰到 `EXCLUDED` 里的节点**——否则「在输入框里全选再按按钮」会引用自己的
 *    草稿，而那是最容易发生的一次误触；
 * 4. **外接矩形有面积**——不可见的选择不该引出按钮。
 *
 * 反向拖选由 `Range` 的包围盒处理，不需要单独判。
 *
 * @param host - 负责裁决的面板根节点。
 * @returns 选区快照，或 `undefined`（这次手势不成立）。
 */
function snapshotOf(host: HTMLElement): SelectionSnapshot | undefined {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return undefined
  const quote = quoteTextOf(selection.toString())
  if (quote === '') return undefined
  const range = selection.getRangeAt(0)
  const anchor = range.commonAncestorContainer
  const element = anchor instanceof Element ? anchor : anchor.parentElement
  if (element === null || !host.contains(element)) return undefined
  if (element.closest(EXCLUDED) !== null) return undefined
  const box = range.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return undefined
  return { quote, rect: { top: box.top, left: box.left, width: box.width, height: box.height } }
}

/**
 * 挂在面板上的引用手势。
 *
 * @param props.host - 负责裁决的面板根节点（选区必须落在它之内）；尚未挂载时传 null。
 * @param props.onQuote - 收下已经编码好的引用文本。
 */
export function QuoteSelection({ host, onQuote }: {
  host: HTMLElement | null
  /** 插入这段引用（已经逐行带 `> ` 前缀）。 */
  onQuote: (quote: string) => void
}) {
  const [pending, setPending] = useState<SelectionSnapshot | undefined>(undefined)
  const [spot, setSpot] = useState<{ top: number; left: number; placement: 'above' | 'below' } | undefined>(undefined)
  const actionRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (host === null) return
    const sync = (): void => {
      setPending(current => {
        const next = snapshotOf(host)
        /* 同一段选区反复触发时保持同一个对象：`selectionchange` 在拖选过程中连续到来，
           每次刷新都会重排一次浮层（肉眼能看见它在抖）。 */
        if (next === undefined) return undefined
        if (current !== undefined && current.quote === next.quote
          && current.rect.top === next.rect.top && current.rect.left === next.rect.left
          && current.rect.width === next.rect.width && current.rect.height === next.rect.height) return current
        return next
      })
    }
    document.addEventListener('selectionchange', sync)
    return () => { document.removeEventListener('selectionchange', sync) }
  }, [host])

  /* 摆位。
   *
   * **这里绝不能用「量到按钮才摆」的写法。** 按钮只有在 `spot` 已存在时才渲染，所以
   * 首帧量不到它；如果摆位依赖它的尺寸，就会永久卡在「没尺寸 → 不渲染 → 更没尺寸」
   * ——按钮永远出不来，而屏上没有任何报错。所以尺寸取「量到就用真值，量不到就用
   * `ASSUMED`」，摆位永远算得出来；量到真尺寸后（第二次 render）再校正一次。
   *
   * 另一件事同样承重：选区矩形是**视口坐标**，而浮层被 portal 进看板盒
   * （`position: relative`）。所以这里减去容纳盒的原点，把坐标换算到同一套空间——
   * 混用的后果是整体偏出一个侧栏的宽度，而它看起来只是「位置有点怪」。 */
  useLayoutEffect(() => {
    if (pending === undefined || host === null) { setSpot(undefined); return }
    const layer = boardBox()
    const bounds = host.getBoundingClientRect()
    const origin = layer.getBoundingClientRect()
    const measured = actionRef.current?.getBoundingClientRect()
    const anchorSpot = quoteAnchorOf(
      { top: pending.rect.top - origin.top, left: pending.rect.left - origin.left, width: pending.rect.width, height: pending.rect.height },
      { top: bounds.top - origin.top, left: bounds.left - origin.left, width: bounds.width, height: bounds.height },
      {
        width: measured === undefined || measured.width === 0 ? ASSUMED.width : measured.width,
        height: measured === undefined || measured.height === 0 ? ASSUMED.height : measured.height,
      },
    )
    setSpot(current => current !== undefined && current.top === anchorSpot.top
      && current.left === anchorSpot.left && current.placement === anchorSpot.placement
      ? current
      : anchorSpot)
    /* 依赖里有 `spot`：首帧按 `ASSUMED` 摆好、按钮因此渲染出来之后，这一趟才会量到
       真实尺寸并把位置校正过来（尤其是换语言之后宽度变了）。少了它，按钮就永远停在
       按猜测摆的位置上。 */
  }, [pending, host, spot])

  /* 滚动或改窗口就让按钮收起：它钉在选区上，而选区滚走之后按钮指向一片空白。收起是唯一
     诚实的行为——重新选中会再出现。 */
  useEffect(() => {
    if (pending === undefined) return
    const dismiss = (): void => { setPending(undefined) }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [pending])

  const take = useCallback(() => {
    if (pending === undefined) return
    onQuote(pending.quote)
    /* 收起按钮、清掉选区：读者接下来要在输入框里接着写，留着一片高亮会让他以为还要再
       按一次。 */
    setPending(undefined)
    window.getSelection()?.removeAllRanges()
  }, [pending, onQuote])

  if (pending === undefined || spot === undefined) return null
  /* 落进看板盒：面板本身 `overflow: hidden`，浮层留在面板 DOM 里会被它的圆角与裁剪切掉；
     看板盒是这一族浮层共同的锚点（同 Dialog / SessionFrame）。 */
  return createPortal(
    <div className={css.quoteLayer} style={{ top: `${spot.top}px`, left: `${spot.left}px` }}>
      <button
        ref={actionRef}
        type="button"
        className={css.quoteAction}
        /* 按下不能清掉选区：`pointerdown` 的默认行为会移走焦点并折叠选区，于是 `click`
           到来时选区已经没了——按钮看起来「按了没反应」。 */
        onPointerDown={event => { event.preventDefault() }}
        onClick={take}
      >
        <Icon name="copy" />
        <span>{t('review.quoteSelection')}</span>
      </button>
    </div>,
    boardBox(),
  )
}
