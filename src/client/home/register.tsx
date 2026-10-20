/**
 * 工作台总览作为**四个主舞台面板之一**的贡献点（看板、清单、总览、设计系统预览）。
 *
 * 形状照抄清单的 `item/register.tsx`：一个组件、一个身份常量，注册本身交给装配层
 * （`client/index.ts`）。这一层不知道座位与 `order`——那是装配层的表，加第四个面板只改
 * 那张表，不改这里。注册进 `main` 的 key 与 `sidebar.panellist` 那一行的 id 必须是**同一个
 * 值**（shell 靠它把一行解析到它的舞台），所以身份只声明一次、两处读它。
 *
 * 面板读的是 `workbench/stage.ts` 那唯一一个持有者；页面自己订阅看板（见 `panel.tsx`），
 * 所以这里只负责把组件交出去，没有旁路数据。
 */
import { WORKBENCH_KEYS } from '../workbench/chrome.ts'
import { HomePage } from './panel.tsx'

/**
 * 总览的舞台身份——`main` 的 key 与面板列表那一行的 id，一个值。
 */
export const HOME_GROUP = { id: WORKBENCH_KEYS.home } as const

/**
 * 面板本体：装配层注册进 `main` 的那个组件。
 * @returns 总览页。
 */
export function HomePanel() {
  return <HomePage />
}
