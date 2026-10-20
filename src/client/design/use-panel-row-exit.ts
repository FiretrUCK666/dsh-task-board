/**
 * 面板列表那一行的「再按一下就退出」。
 *
 * shell 拥有那一整行（按钮、几何、悬停与选中底色、宽栏里的名字），并且自己调
 * `ctx.layout.selectPanel(<id>)`——而那个动词**只会打开**面板。所以面板正开着时再按
 * 那一行，必须变成「离开面板」；面板没开着时，那一按仍然是打开它。
 *
 * **为什么监听挂在按钮上，而不是挂在图标上。** `closest` 从图标自己的节点往上走到
 * slot 契约里由 shell 拥有的那个按钮，原生监听在按钮上就跑，比 React 挂在根上的
 * 合成事件**先**跑——所以在这里 `stopPropagation()` 能让 shell 自己的
 * `selectPanel(id)` 不触发。只挂 React 的 `onClick` 会漏掉名字与键盘：它们的目标是
 * 那一行，不是这枚图标。
 *
 * 这件事有四个消费者（总览、看板、清单、设计系统那四行读同一份机制），所以它住在
 * `design/` 这一层：一份机制，四处引用，改一处四处一起变。
 *
 * @module dsh-task-board/design/use-panel-row-exit
 */
import { useEffect, type RefObject } from 'react'

/**
 * 把面板列表那一行接成「再按一下即离开」。
 *
 * @param rootRef - 图标自己的节点；监听挂在它往上第一个 `button` 上。
 * @param active - 面板是否正显示在主栏里；不是就什么都不做，让 shell 去打开它。
 * @param onExit - 离开面板的那条出口；缺席 = 纯图标，这一行仍然能把面板打开。
 */
export function usePanelRowExit(
  rootRef: RefObject<SVGSVGElement>,
  active: boolean,
  onExit: (() => void) | undefined,
): void {
  useEffect(() => {
    if (onExit === undefined) return
    const button = rootRef.current?.closest('button')
    if (!(button instanceof HTMLButtonElement)) return
    const onClick = (event: Event): void => {
      if (!active) return
      event.stopPropagation()
      onExit()
    }
    button.addEventListener('click', onClick)
    return () => { button.removeEventListener('click', onClick) }
  }, [active, onExit])
}
