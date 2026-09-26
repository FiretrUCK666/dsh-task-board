/** 本模块读到的会话行（原生列表行的结构切片）。 */
export interface GroupSessionRow {
    title?: string;
    /** 会话自己的工作目录（工作区文件夹标签由它派生）。 */
    cwd?: string;
    /** 来源标记；`'subagent'` 是被 agent 召唤出来的会话。 */
    origin?: 'subagent';
    /** 空白会话（「新建会话」占位，不是对话）。 */
    blank?: boolean;
}
/** 本模块读到的登记表行（工作区的一行）。 */
export interface GroupWorkspaceRow {
    id: string;
    title: string;
    /** 这个工作区**自己记的**会话成员（登记表的归属账本，权威）。 */
    sessionIds?: readonly string[];
}
/** 两个原生快照的切片，一次喂全。 */
export interface SessionGroupSources {
    /** 会话行，按 id 索引。 */
    byId: Readonly<Record<string, GroupSessionRow | undefined>>;
    /** 原生列表顺序（`sessions.list.ids`）；缺省回退到键序。 */
    ids?: readonly string[];
    /** 登记表顺序的工作区。 */
    workspaces: readonly GroupWorkspaceRow[];
    /** registry 全局归档集合。 */
    archivedSessionIds: readonly string[];
}
/** 一组里的一个可添加会话。 */
export interface OfferableSession {
    sessionId: string;
    /** 真实标题；没有真标题就走未命名占位（**绝不**拿裸 id 冒充名字）。 */
    title: string;
    /** 会话自己的工作区文件夹标签（cwd 末段），未知时省略。 */
    workspaceLabel?: string;
}
/** 一个可折叠的分组：某个工作区，或末尾的「未分组」。 */
export interface SessionGroup {
    /** 工作区 id；未分组组用 {@link UNGROUPED_KEY}。 */
    key: string;
    /** 组标题（工作区名，或调用方给的未分组文案）。 */
    label: string;
    sessions: OfferableSession[];
}
/** 未分组那一组的键。空串——没有任何工作区的 id 是空的。 */
export declare const UNGROUPED_KEY = "";
/** 推导的全部可调项（文案由调用方给，核心层不碰 i18n）。 */
export interface SessionGroupOptions {
    /** 本卡已关联的会话（面板不再提供它们）。 */
    exclude?: ReadonlySet<string>;
    /** 会话没有真标题时的占位文案。 */
    untitledLabel: string;
    /** 「未分组会话」的文案。 */
    ungroupedLabel: string;
}
/**
 * 按工作区分组列出**当前可添加**的会话（闸门 1 之后），非空组一个不落
 * （闸门 2-4）。
 */
export declare function offerableSessionGroups(sources: SessionGroupSources, options: SessionGroupOptions): SessionGroup[];
/** 分组里会话的总数（面板底部的「已选/共 N」与空态判断都读它）。 */
export declare function countSessions(groups: readonly SessionGroup[]): number;
