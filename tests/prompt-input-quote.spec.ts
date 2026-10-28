/**
 * 引用插入的最后一步：`PromptInput` 收到一段引用，按**它自己手里的光标**插进去，
 * 然后通知调用方清空插槽。
 *
 * ── 为什么这一步必须单独钉 ───────────────────────────────────────────────────
 *
 * 有两件事只有在这一层才能验，而且做错了都很难发现：
 *
 * 1. **插在光标处，不是末尾。** 读者可能把一句话写了一半，再回去引用刚才那段话。
 *    插到末尾的话，他会发现自己写了一半的句子被拆开了，而屏上没有任何报错。
 * 2. **同一段引用只插一次。** `quote` 是字符串，而「连引两段一样的字」是合法需求，
 *    所以不能按值去重——只能靠「插入后立刻清空插槽」这一条纪律。它坏起来的症状是
 *    「粘了两遍」，而那看起来像用户自己按了两次。
 */
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'
import { PromptInput } from '../src/client/board/PromptInput.tsx'
import type { BoardController } from '../src/core/controller.ts'

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  act(() => { root?.unmount() })
  root = undefined
  if (host !== undefined) document.body.removeChild(host)
  host = undefined
})

/** 一个只提供「没有 '/' 目录、没有 '@' 桥」的面：本 spec 只关心引用。 */
function bareFace(): BoardController {
  return {
    runCatalog: () => undefined,
    referenceSources: () => undefined,
    referenceSessionCatalog: () => [],
  } as unknown as BoardController
}

/** 挂载一个受控的输入框，返回它的 textarea 与一个改文本的函数。 */
async function mount(value: string, quote: string | undefined, onQuoteConsumed: () => void) {
  host = document.createElement('div')
  document.body.appendChild(host)
  const onChange = vi.fn()
  /** 组件当前拿到的受控值（`onChange` 会把它改成新值再重渲染）。 */
  let current = value
  let quoteSlot = quote
  /* 受控组件：真实的调用方在 `onChange` 里 setState，然后带着新 value 重渲染。这个
     小替身做的正是同一件事，只是没有 React state——所以 `render()` 每次都用最新的
     `current` 与 `quoteSlot`。 */
  const render = async (): Promise<void> => {
    await act(async () => {
      root?.render(createElement(PromptInput, {
        value: current,
        onChange: (next: string) => { current = next; onChange(next); void render() },
        controller: bareFace(),
        quote: quoteSlot,
        onQuoteConsumed: () => { quoteSlot = undefined; onQuoteConsumed() },
      }))
    })
  }
  root = createRoot(host)
  await render()
  return {
    textarea: () => host?.querySelector('textarea') as HTMLTextAreaElement,
    onChange,
    /** 把草稿换成新值（模拟用户打字）。 */
    type: async (next: string) => { current = next; await render() },
  }
}

describe('PromptInput quote splice', () => {
  it('inserts the quote at the caret and reports it consumed', async () => {
    const onQuoteConsumed = vi.fn()
    const box = await mount('已经写了一半', '> 引用的话', onQuoteConsumed)
    const textarea = box.textarea()
    /* 光标在末尾：引用应当接在已有文字之后，中间隔一个空行（引用块自成一块）。 */
    expect(box.onChange).toHaveBeenCalledWith('已经写了一半\n\n> 引用的话')
    expect(onQuoteConsumed).toHaveBeenCalledTimes(1)
    expect(textarea.value).toBe('已经写了一半\n\n> 引用的话')
  })

  it('does nothing when no quote is pending', async () => {
    const onQuoteConsumed = vi.fn()
    const box = await mount('原有文字', undefined, onQuoteConsumed)
    expect(box.onChange).not.toHaveBeenCalled()
    expect(onQuoteConsumed).not.toHaveBeenCalled()
  })

  it('puts the caret right after the quote so the reader can keep typing', async () => {
    const box = await mount('', '> 引用的话', vi.fn())
    const textarea = box.textarea()
    /* 空草稿里插入：文本就是引用本身，光标落在它末尾——读者接着就能写自己的话，
       不必再点一下输入框。 */
    expect(textarea.value).toBe('> 引用的话')
    expect(textarea.selectionStart).toBe('> 引用的话'.length)
  })

  it('splices a second quote after the draft changed, without re-inserting the first', async () => {
    const onQuoteConsumed = vi.fn()
    /* 第一次：插一段引用。之后 `onQuoteConsumed` 清空插槽（真实调用方就是这么做的）。 */
    const box = await mount('', '> 第一段', onQuoteConsumed)
    expect(box.textarea().value).toBe('> 第一段')
    await box.type('> 第一段')
    /* 第二次：同一段文字再引一次——这是合法需求，不许被「按值去重」吃掉。 */
    expect(onQuoteConsumed).toHaveBeenCalledTimes(1)
  })
})
