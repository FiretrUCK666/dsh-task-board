/**
 * 引用手势的接线：`QuoteSelection` 真的会在一次选区之后浮出、按下会把引用插进
 * 评论输入框。
 *
 * ── 这里能证明什么、不能证明什么 ─────────────────────────────────────────────
 *
 * jsdom **没有布局**，所以 `getBoundingClientRect()` 全返回零。位置那一半由
 * `quote-anchor.spec.ts` 按纯几何钉住（那里是算术，不需要布局），这里只钉**接线**：
 * 选区的四条判据是否真的成立、按下是否真的把引用交了出去、草稿是否真的变了。
 *
 * 所以本 spec 显式给选区矩形喂一个非零值——那是 jsdom 唯一缺的东西，而不是把判据
 * 放宽。位置算出来是零没关系，`quote-anchor.ts` 已经在那边被单独验过。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'
import { QuoteSelection } from '../src/client/board/QuoteSelection.tsx'

/** 让 `container` 上的一段文字可以被「选中」：造一个 Range 指向它。 */
function selectText(node: Node): void {
  const range = document.createRange()
  range.selectNodeContents(node)
  /* jsdom 没有布局，所以它连 `Range.getBoundingClientRect` 都没实现（这是布局 API）。
     真实浏览器里有，而且这一条正是整个手势的定位依据——所以这里给**这个实例**补上，
     喂一个真实矩形。判据里 `width === 0 || height === 0` 的检查仍然在跑，只是喂给它的
     不再是 0：这不是放宽判据，是补上 jsdom 缺的那个环境能力。 */
  ;(range as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => ({
    top: 100, left: 120, bottom: 120, right: 320, width: 200, height: 20, x: 120, y: 100, toJSON: () => ({}),
  }) as DOMRect
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/**
 * 给某个元素的 `getBoundingClientRect` 喂一个真矩形（jsdom 没有布局）。
 *
 * 面板的可摆范围与看板盒的原点都靠它：没有这两个矩形，位置换算就只剩零，而零会让
 * 「按钮是否落在面板里」这类断言无条件成立——一条永远为真的断言比没有断言更糟。
 */
function stubRect(element: Element, rect: { top: number; left: number; width: number; height: number }): void {
  element.getBoundingClientRect = () => ({
    top: rect.top,
    left: rect.left,
    bottom: rect.top + rect.height,
    right: rect.left + rect.width,
    width: rect.width,
    height: rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  }) as DOMRect
}

let host: HTMLDivElement
let root: Root | undefined
let onQuote: ReturnType<typeof vi.fn>

beforeEach(() => {
  host = document.createElement('div')
  host.setAttribute('data-dsh-taskboard-panel', '')
  const paragraph = document.createElement('p')
  paragraph.textContent = '这是一段会被引用的话'
  host.appendChild(paragraph)
  document.body.appendChild(host)
  /* 看板盒：`boardBox()` 找的是它，浮层 portal 进去。 */
  const board = document.createElement('div')
  board.setAttribute('data-dsh-taskboard-view', '')
  stubRect(board, { top: 0, left: 0, width: 800, height: 600 })
  document.body.appendChild(board)
  stubRect(host, { top: 40, left: 60, width: 600, height: 400 })
  onQuote = vi.fn()
})

afterEach(() => {
  act(() => { root?.unmount() })
  root = undefined
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})

/** 挂载手势组件并等一轮 effect。 */
async function mount(): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(QuoteSelection, { host, onQuote }))
  })
}

describe('QuoteSelection', () => {
  it('floats the action after a selection inside the panel', async () => {
    await mount()
    const paragraph = host.querySelector('p')
    expect(paragraph).not.toBeNull()
    await act(async () => {
      selectText(paragraph as Node)
      document.dispatchEvent(new Event('selectionchange'))
    })
    /* 按钮浮出来了：这是整条链路的入口，它不出现在就什么都不用谈。 */
    expect(document.querySelector('button')).not.toBeNull()
    expect(document.querySelector('button')?.textContent).toContain('引用')
  })

  it('hands over the encoded quote when the action is pressed', async () => {
    await mount()
    await act(async () => {
      selectText(host.querySelector('p') as Node)
      document.dispatchEvent(new Event('selectionchange'))
    })
    const button = document.querySelector('button') as HTMLButtonElement
    await act(async () => { button.click() })
    /* 交给调用方的是**已经编码好的引用**（逐行 `> ` 前缀），不是原始选中文本：
       编码只有一处（`quote-text.ts`），调用方不需要知道 Markdown 的行前缀怎么写。 */
    expect(onQuote).toHaveBeenCalledTimes(1)
    expect(onQuote.mock.calls[0][0]).toBe('> 这是一段会被引用的话')
  })

  it('stays hidden when nothing is selected', async () => {
    await mount()
    await act(async () => { document.dispatchEvent(new Event('selectionchange')) })
    expect(document.querySelector('button')).toBeNull()
  })

  it('ignores a selection that sits outside the panel', async () => {
    await mount()
    const outside = document.createElement('p')
    outside.textContent = '面板之外的文字'
    document.body.appendChild(outside)
    await act(async () => {
      selectText(outside)
      document.dispatchEvent(new Event('selectionchange'))
    })
    /* 别处的选择与本面板无关：这正是「手势挂在面板上」那条判据在起作用。 */
    expect(document.querySelector('button')).toBeNull()
  })

  it('ignores a selection made inside a textarea', async () => {
    await mount()
    const box = document.createElement('textarea')
    box.value = '我自己正在写的草稿'
    host.appendChild(box)
    await act(async () => {
      /* textarea 的选择在 jsdom 里走 selectionStart，而真实浏览器里它也会让
         `getSelection()` 指到 textarea 上——两种形状都要被判据挡住，否则「在输入框
         里全选再按按钮」会引用自己的草稿。 */
      box.setSelectionRange(0, box.value.length)
      selectText(box)
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(document.querySelector('button')).toBeNull()
  })

  it('dismisses on scroll, because a button pinned to a scrolled-away selection points at nothing', async () => {
    await mount()
    await act(async () => {
      selectText(host.querySelector('p') as Node)
      document.dispatchEvent(new Event('selectionchange'))
    })
    expect(document.querySelector('button')).not.toBeNull()
    await act(async () => { window.dispatchEvent(new Event('scroll')) })
    expect(document.querySelector('button')).toBeNull()
  })
})
