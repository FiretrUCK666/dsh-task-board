/**
 * 可添加会话的分组推导——会话选择器（卡片「添加会话」与看板「会话建卡」共用
 * 的那一个面板）**唯一**的名单来源。
 *
 * 为什么单独一个模块：挑会话这件事曾经是「把全量会话目录摊平，再在视图层
 * 过滤」，于是两处各写一套、规则还各漏一半。名单的正确与否是一条**规则**，
 * 不是两段界面代码，所以规则住在这里，面板只负责画。
 *
 * 四道闸门，顺序固定，每条都有出处：
 *
 * 1. **官方可见文法**（逐字镜像 shell `dsh-client-ui-workspace` 的
 *    `sessionVisible()` 在 `default` 档下的行为）：
 *      - `origin === 'subagent'` 排除。原生侧边栏把子代理会话挂在**父会话**
 *        底下，从不当顶层行；选择器要的是「可以挂到卡片上的对话」，那不是
 *        子代理。Agent Team 的成员会话同理。
 *      - `blank === true` 排除。空白会话只是「新建会话」的占位槽，不是一段
 *        对话（官方只放行「当前选中的那一个」空白槽；选择器没有这个概念，
 *        所以一个都不放行）。与 `snapshotWorkspaceSessions` 的旧口径一致。
 *      - 命中 registry 的归档集合排除。归档是「可恢复的隐藏」，取消归档后
 *        它会自己回来——所以这是派生 + 订阅，不缓存、不写台账。
 * 2. **归属 = registry 自己的账本**（`workspace.sessionIds`）。绝不用 cwd 或
 *    标题去猜：别处一个同名文件夹不是这个工作区（`snapshotWorkspaceSessions`
 *    早就把这条写成口径了）。没有任何工作区认领的会话落进末尾的「未分组」
 *    组——**绝不静默丢弃**，用户选不选是用户的事。
 * 3. **顺序**：工作区按登记表顺序，组内按原生列表顺序；「未分组」永远最后。
 * 4. **空组不渲染**（一个空标题是噪音）；`exclude` 最后应用（卡片场景剔除
 *    「本卡已关联」的会话——绑第二次是个空操作，列表就不该给这个选项）。
 *
 * 纯函数、无框架、无 IO，所以 spec 可以拿假快照直接跑。
 */
import { realTitleOf, workspaceLabelOf } from './linked-sessions.ts'

/** 本模块读到的会话行（原生列表行的结构切片）。 */
export interface GroupSessionRow {
  title?: string
  /** 会话自己的工作目录（工作区文件夹标签由它派生）。 */
  cwd?: string
  /** 来源标记；`'subagent'` 是被 agent 召唤出来的会话。 */
  origin?: 'subagent'
  /** 空白会话（「新建会话」占位，不是对话）。 */
  blank?: boolean
}

/** 本模块读到的登记表行（工作区的一行）。 */
export interface GroupWorkspaceRow {
  id: string
  title: string
  /** 这个工作区**自己记的**会话成员（登记表的归属账本，权威）。 */
  sessionIds?: readonly string[]
}

/** 两个原生快照的切片，一次喂全。 */
export interface SessionGroupSources {
  /** 会话行，按 id 索引。 */
  byId: Readonly<Record<string, GroupSessionRow | undefined>>
  /** 原生列表顺序（`sessions.list.ids`）；缺省回退到键序。 */
  ids?: readonly string[]
  /** 登记表顺序的工作区。 */
  workspaces: readonly GroupWorkspaceRow[]
  /** registry 全局归档集合。 */
  archivedSessionIds: readonly string[]
}

/** 一组里的一个可添加会话。 */
export interface OfferableSession {
  sessionId: string
  /** 真实标题；没有真标题就走未命名占位（**绝不**拿裸 id 冒充名字）。 */
  title: string
  /** 会话自己的工作区文件夹标签（cwd 末段），未知时省略。 */
  workspaceLabel?: string
}

/** 一个可折叠的分组：某个工作区，或末尾的「未分组」。 */
export interface SessionGroup {
  /** 工作区 id；未分组组用 {@link UNGROUPED_KEY}。 */
  key: string
  /** 组标题（工作区名，或调用方给的未分组文案）。 */
  label: string
  sessions: OfferableSession[]
}

/** 未分组那一组的键。空串——没有任何工作区的 id 是空的。 */
export const UNGROUPED_KEY = ''

/** 推导的全部可调项（文案由调用方给，核心层不碰 i18n）。 */
export interface SessionGroupOptions {
  /** 本卡已关联的会话（面板不再提供它们）。 */
  exclude?: ReadonlySet<string>
  /** 会话没有真标题时的占位文案。 */
  untitledLabel: string
  /** 「未分组会话」的文案。 */
  ungroupedLabel: string
}

/**
 * 按工作区分组列出**当前可添加**的会话（闸门 1 之后），非空组一个不落
 * （闸门 2-4）。
 */
export function offerableSessionGroups(
  sources: SessionGroupSources,
  options: SessionGroupOptions,
): SessionGroup[] {
  const archived = new Set(sources.archivedSessionIds)
  const order = sources.ids ?? Object.keys(sources.byId)
  // 归属账本：会话 id -> 工作区 id。一个会话只登记在一个工作区下（原生
  // 登记表就是这样），所以先到先得，绝不覆盖。
  const owner = new Map<string, string>()
  for (const workspace of sources.workspaces) {
    for (const sessionId of workspace.sessionIds ?? []) {
      if (!owner.has(sessionId)) owner.set(sessionId, workspace.id)
    }
  }

  const byWorkspace = new Map<string, OfferableSession[]>()
  for (const sessionId of order) {
    const row = sources.byId[sessionId]
    if (row === undefined) continue
    // 闸门 1：官方可见文法（子代理 / 空白槽 / 归档）。
    if (row.origin === 'subagent') continue
    if (row.blank === true) continue
    if (archived.has(sessionId)) continue
    if (options.exclude?.has(sessionId) === true) continue
    const offer: OfferableSession = {
      sessionId,
      // 真标题优先（`realTitleOf` 会把「等于文件夹名」的宿主自动名判为无名），
      // 否则未命名占位。裸 sessionId 永远不冒充名字。
      title: realTitleOf(row.title, row.cwd) ?? options.untitledLabel,
      ...row.cwd !== undefined ? { workspaceLabel: workspaceLabelOf(row.cwd) } : {},
    }
    const key = owner.get(sessionId) ?? UNGROUPED_KEY
    const bucket = byWorkspace.get(key)
    if (bucket === undefined) byWorkspace.set(key, [offer])
    else bucket.push(offer)
  }

  const groups: SessionGroup[] = []
  const push = (key: string, label: string): void => {
    const sessions = byWorkspace.get(key)
    if (sessions === undefined || sessions.length === 0) return
    groups.push({ key, label, sessions })
  }
  // 闸门 3：登记表顺序在前，「未分组」永远最后。
  for (const workspace of sources.workspaces) push(workspace.id, workspace.title)
  push(UNGROUPED_KEY, options.ungroupedLabel)
  return groups
}

/** 分组里会话的总数（面板底部的「已选/共 N」与空态判断都读它）。 */
export function countSessions(groups: readonly SessionGroup[]): number {
  let total = 0
  for (const group of groups) total += group.sessions.length
  return total
}
