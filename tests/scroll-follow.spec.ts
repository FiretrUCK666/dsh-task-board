/**
 * 滚动不许重画面板——这条用真组件、真事件来钉，不靠读源码字样。
 *
 * ── 它守的那件真事 ──────────────────────────────────────────────────────────
 *
 * 读者的原话是「在底部往上一滑，画面会瞬间卡一下，滑动条也跟着卡一下；拉到上面一点
 * 之后上下滑动就变顺畅了」。根因不是某个回调慢，而是**「在不在底部」被写成了面板的
 * React 状态**：离开末尾的那一帧，整个面板（列表、输入框、折叠状态）重新渲染一次。
 *
 * 用真工件量过这一下有多贵：40 轮对话 + 40 条评论 = 928 个节点，整块重建
 * **17.8ms 中位 / 22.3ms 最差**（一帧的预算是 16.7ms）。所以那一帧画不出来。
 * 量法在 `scripts/probes/probe-scroll-rerender.{cjs,js}`。
 *
 * 所以这条测试钉的是**结构**：滚动时那个持有 pin 的组件**一次都不重画**，而胶囊自己
 * 拿得到新值。两者必须同时成立——只做到前者（不重画）就是胶囊永远不动，只做到后者
 * 就是回到原来的毛病。
 */
// @vitest-environment jsdom
import { act } from 'react'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TailFrame, useFollowScroll } from '../src/client/board/use-transcript.tsx'

/** 量到的几何：内容 5000px 高、视口 500px 高，所以可滚 4500px。 */
const CONTENT_HEIGHT = 5000
const VIEWPORT_HEIGHT = 500

/**
 * jsdom 不做排版，`scrollHeight` / `clientHeight` 恒为 0——而这两个值正是这条判据
 * 的输入。所以这里把**几何**钉住（stub 的是环境，不是组件：组件走的每个分支都是它
 * 自己的）。`height()` 由测试给，所以「内容长高」也能被测到。
 */
function pinGeometry(height: () => number): () => void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  const before = {
    scrollHeight: Object.getOwnPropertyDescriptor(proto, 'scrollHeight'),
    clientHeight: Object.getOwnPropertyDescriptor(proto, 'clientHeight'),
    scrollTop: Object.getOwnPropertyDescriptor(proto, 'scrollTop'),
  }
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => height() })
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => VIEWPORT_HEIGHT })
  Object.defineProperty(proto, 'scrollTop', {
    configurable: true,
    get(this: { __st?: number }) { return this.__st ?? 0 },
    set(this: { __st?: number }, value: number) {
      // 真实的 scrollTop 会被夹在 [0, scrollHeight - clientHeight] 里；这里照做，
      // 否则「跟随写超幅值」这条行为在测试里永远看不见 clamp。
      const max = Math.max(0, height() - VIEWPORT_HEIGHT)
      this.__st = Math.max(0, Math.min(max, value))
    },
  })
  return () => {
    for (const [name, descriptor] of Object.entries(before)) {
      if (descriptor === undefined) delete proto[name]
      else Object.defineProperty(proto, name, descriptor)
    }
  }
}

/** 一个「面板」：它持有 pin，并记录自己被画了几次。 */
function harness() {
  const drawn = { count: 0 }
  let pinRef: ReturnType<typeof useFollowScroll> | undefined
  const Harness = (): ReturnType<typeof createElement> => {
    drawn.count += 1
    const pin = useFollowScroll(ref, 'window-1')
    pinRef = pin
    return createElement(TailFrame, { pin, children: createElement('div', { ref, className: 'scroller' }) })
  }
  const ref: { current: HTMLDivElement | null } = { current: null }
  return { Harness, drawn, pin: () => pinRef }
}

describe('scrolling never re-renders the surface that owns the pin', () => {
  let disposeGeometry: () => void
  let host: HTMLDivElement
  let root: Root
  let contentHeight = CONTENT_HEIGHT
  const realResizeObserver = globalThis.ResizeObserver
  const realRaf = globalThis.requestAnimationFrame
  const realCancelRaf = globalThis.cancelAnimationFrame
  /** 观察器的回调：内容「长高」时由测试自己触发，等于浏览器跑了一次布局。 */
  let observed: Array<() => void> = []
  /** 排队中的帧回调。rAF 在这里**不立即执行**——一个真实的帧边界就是异步的，而同步
   *  执行会让组件里「先置标记、回调里清标记」那对语句次序颠倒。 */
  let frames: Array<() => void> = []
  const flushFrames = (): void => {
    const due = frames
    frames = []
    for (const callback of due) callback()
  }

  beforeEach(() => {
    contentHeight = CONTENT_HEIGHT
    disposeGeometry = pinGeometry(() => contentHeight)
    /* `act` is the only way to let React flush the passive effects these hook
       effects schedule, and React only supports it when the environment says so. */
    ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    frames = []
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      frames.push(() => callback(0))
      return frames.length
    }) as typeof globalThis.requestAnimationFrame
    globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame
    /* jsdom 没有 ResizeObserver。这里给一个**如实**的假面：`observe` 收下元素、
       记下回调，`disconnect` 清空——它只做「谁来通知我尺寸变了」这一件事，而那正是
       组件对它的唯一期望。 */
    observed = []
    class FakeResizeObserver {
      constructor(callback: () => void) { observed.push(callback) }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void { /* nothing to release in a fake with no targets */ }
    }
    ;(globalThis as unknown as Record<string, unknown>).ResizeObserver = FakeResizeObserver
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    host.remove()
    disposeGeometry()
    globalThis.requestAnimationFrame = realRaf
    globalThis.cancelAnimationFrame = realCancelRaf
    ;(globalThis as unknown as Record<string, unknown>).ResizeObserver = realResizeObserver
  })

  it('a scroll from the end upward does not re-render the panel, but does show the pill', () => {
    const one = harness()
    act(() => { root.render(createElement(one.Harness)) })
    const scroller = host.querySelector('.scroller') as HTMLDivElement
    expect(scroller, 'the harness must have mounted its scroller').not.toBeNull()
    const afterMount = one.drawn.count

    act(() => {
      // 读者在末尾往上拉了一屏：距离末尾还有 1000px。
      scroller.scrollTop = CONTENT_HEIGHT - VIEWPORT_HEIGHT
      scroller.dispatchEvent(new Event('scroll'))
      scroller.scrollTop -= 1000
      scroller.dispatchEvent(new Event('scroll'))
      // 一条手势里的多次事件被合并成一帧一次测量（正是一次帧边界）。
      flushFrames()
    })

    expect(one.drawn.count, 'a scroll event re-rendered the panel — that is the frame the reader cannot paint')
      .toBe(afterMount)
    // …而胶囊知道该露面了：它的读数来自订阅，不是从面板 props 传下来的。
    const pill = host.querySelector('button') as HTMLButtonElement
    expect(pill, 'the pill must be mounted').not.toBeNull()
    expect(pill.getAttribute('data-hidden'), 'the pill must show once the reader has left the end').toBeNull()
    expect(pill.disabled, 'a visible pill must be clickable').toBe(false)
  })

  it('coming back to the end hides the pill again, still without re-rendering the panel', () => {
    const one = harness()
    act(() => { root.render(createElement(one.Harness)) })
    const scroller = host.querySelector('.scroller') as HTMLDivElement
    const afterMount = one.drawn.count

    act(() => {
      scroller.scrollTop = CONTENT_HEIGHT - VIEWPORT_HEIGHT - 1000
      scroller.dispatchEvent(new Event('scroll'))
      flushFrames()
    })
    const pill = host.querySelector('button') as HTMLButtonElement
    expect(pill.getAttribute('data-hidden'), 'the pill must be visible away from the end').toBeNull()

    act(() => {
      scroller.scrollTop = CONTENT_HEIGHT - VIEWPORT_HEIGHT
      scroller.dispatchEvent(new Event('scroll'))
      flushFrames()
    })
    expect(pill.getAttribute('data-hidden'), 'the pill must hide at the end').toBe('true')
    expect(pill.disabled, 'a hidden pill must not be clickable').toBe(true)
    expect(one.drawn.count, 'scrolling back re-rendered the panel').toBe(afterMount)
  })

  it('the follow gate leaves the end on its own tight line, regardless of the pill', () => {
    // 「滚动条也跟着卡一下」那个症状的另一面：读者往上拉一点点，胶囊可能还在闪／
    // 刚露面，而**跟随必须已经停手**。120px 的迟滞只是胶囊的退场线，不能兼职做
    // 「还在不在末尾」的判据——否则一条新消息（3 秒轮询让这成为常态流量）就会把
    // 读者拽回末尾。
    const one = harness()
    act(() => { root.render(createElement(one.Harness)) })
    const scroller = host.querySelector('.scroller') as HTMLDivElement
    const end = CONTENT_HEIGHT - VIEWPORT_HEIGHT

    act(() => {
      scroller.scrollTop = end - 100
      scroller.dispatchEvent(new Event('scroll'))
      flushFrames()
    })
    // 100px 已经超过胶囊的入场线（24px），所以它露面了——这是对的，读者确实离开了末尾。
    const pill = host.querySelector('button') as HTMLButtonElement
    expect(pill.getAttribute('data-hidden'), 'the pill shows as soon as the reader leaves the end').toBeNull()
    const held = scroller.scrollTop
    expect(held, 'the harness must really be 100px from the end').toBe(end - 100)

    /* THE NEW ROUND ARRIVES (the 3-second poll makes this ordinary traffic): the
       content grows by 800px and the observer reports the new size. A follow that
       read the pill's 120px hysteresis would still call this 「在末尾」 and write the
       reader to the NEW end. */
    contentHeight = CONTENT_HEIGHT + 800
    act(() => {
      for (const notify of observed) notify()
      flushFrames()
    })
    expect(scroller.scrollTop, 'a reader 100px from the end was pulled to it — the follow gate read the pill hysteresis')
      .toBe(held)
    // …and it stays that way for a fellow measure: still no re-render of the panel.
    expect(one.drawn.count, 'a new round re-rendered the panel').toBe(1)
  })
})
