/**
 * **设计法则表**：一处登记，三处消费。
 *
 * ── 它解决的是哪一种错 ────────────────────────────────────────────────────
 *
 * 这个项目里每一条设计法则都有三个「家」：**实现**（CSS / 组件里的那一行）、
 * **门禁**（`scripts/verify-*.mjs` 里判它的那段）、**标本**（`gallery/` 里让人
 * 看见它的那一眼）。
 *
 * 三处分离时，最贵的失效不是「某一处写错了」，而是**三处各自安静地漂开**：
 *
 *   · 有人在 CSS 里加了一条新胶囊，门禁不认识它 → 它永远不会被检查；
 *   · 有人加了一条法则，忘了写门禁 → 下一个人不知道它在承重；
 *   · 门禁改了判据，标本还摆着旧样子 → 读者照着展览学了一个过时的规矩。
 *
 * 而这三件事**都不会让构建失败**。所以它们必须由结构回答，不能靠记性：
 * 这张表是那三处唯一的交会点，`verify-design-sync.mjs` 拿它逐条对账。
 *
 * ── 一条法则必须回答什么 ──────────────────────────────────────────────────
 *
 * 一条法则只有在四件事都能指出来时才算「有主」：判它的门禁、让人看见它的标本、
 * 它在实现里的落点、以及它为什么长这样。缺任何一样，它就会在下次改动里漂走
 * ——这门禁报的是**缺哪一样**，不是「不够好」。
 *
 * **新增一条承重法则的正确顺序**：先在这张表里登记（写下四样），再写实现、
 * 门禁与标本。反过来做（先写实现）会让那条法则在表外活一段时间，而表外的法则
 * 没有任何东西替它保证——那正是本文件要终结的循环。
 */

/** 一条设计法则。 */
export interface DesignLaw {
  /** 稳定的机器名（`kebab-case`）。门禁按它对账，所以**不许改**。 */
  readonly id: string
  /** 一句话说清它要求什么（中文，面向读代码的人）。 */
  readonly rule: string
  /** 判它的门禁脚本（相对仓库根）。`undefined` 表示还没有门禁——门禁会报出来。 */
  readonly gate?: string
  /** 让人看见它的标本（`gallery` 里的分组 id）。`undefined` 表示还没有标本。 */
  readonly specimen?: string
  /** 实现落点：真正承重的那一处（文件 + 说明）。 |
   *  这不是文档，是**对账的锚**——门禁会确认那个文件存在。 */
  readonly home: string
  /** 为什么是这条法则（而不是别的）。一条说不出理由的法则会被下一个人删掉。 */
  readonly why: string
}

/**
 * 全部承重法则。
 *
 * 顺序是从「底座」到「表面」：令牌 → 墨位 → 悬浮 → 几何 → 复用。读这张表就等于
 * 读这个设计系统的目录，而每一行都能点到它的门禁与标本。
 */
export const DESIGN_LAWS: readonly DesignLaw[] = [
  {
    id: 'one-colour-per-family',
    rule: '一个状态族只有一枚色令牌；洗底与边只读梯子，调用点不许自己调透明度。',
    gate: 'scripts/verify-palette.mjs',
    specimen: 'colours',
    home: 'src/client/design/tokens.module.css',
    why: '同一块屏上出现两种黄（芯片文字与旁边的会话点），读者读不出哪一个才是「这一档」。',
  },
  {
    id: 'hover-is-reversed',
    rule: '悬浮层与它所在的那张纸反向，强度读同一条梯子；深色主题只翻方向，不换强度。',
    gate: 'scripts/verify-hover-contrast.mjs',
    specimen: 'interaction',
    home: 'src/client/design/tokens.module.css',
    why: '原来读宿主那枚 4% 的墨：官方浅色下看不见，第三方皮肤下看得见——同一个交互两个观感。',
  },
  {
    id: 'ink-centre-equals-box-centre',
    rule: '一行字的行高等于它的墨高，块向内衬带运行时量出来的校正，于是墨心落在盒心。',
    gate: 'scripts/verify-capsule-centring.mjs',
    specimen: 'ink',
    home: 'src/client/design/ink-metrics.ts',
    why: '行盒只解决 halfLeading 那一半；字体上下沿不对称那一半只能由运行时量出来，写死任何常量都只修一台机器。',
  },
  {
    id: 'mixed-text-centres-per-run',
    rule: '一行里字号不同的几段字，**每段各自居中**（不用基线共线）。',
    gate: 'scripts/verify-capsule-centring.mjs',
    specimen: 'ink',
    home: 'src/client/item/item.module.css',
    why: '汉字的墨几乎全在基线之上、数字只占上 0.71em，靠基线会让词偏高（量到 0.5 对 1.0，改后 0.5 对 0.5）。',
  },
  {
    id: 'nudge-scales-with-font-size',
    rule: '墨位校正按**字号**缩放（发布为 `em`），不是一个全局 px。',
    gate: 'tests/ink-metrics.spec.ts',
    specimen: 'ink',
    home: 'src/client/design/ink-metrics.ts',
    why: '字体上下沿的不对称是比例而非固定长度：一个 px 值喂给 12/13/15 三档，只有一档是对的。',
  },
  {
    id: 'surface-ladder',
    rule: '深度只由三件事说：色调台阶、受光的顶边、投影。悬浮层不许用 backdrop-filter。',
    gate: 'scripts/verify-palette.mjs',
    specimen: 'surfaces',
    home: 'src/client/design/tokens.module.css',
    why: '毛玻璃会把下面的内容读成一团；这里的隐喻是「三张摊在同一张桌子上的纸」。',
  },
  {
    id: 'one-button-base',
    rule: '所有按钮共用一条底座（高度、内衬、字号、行高、墨位），页面只声明布局。',
    gate: 'tests/mobile-contract.spec.ts',
    specimen: 'buttons',
    home: 'src/client/design/components.module.css',
    why: '两个面板都渲染的形态必须住进 design/；否则改一处不改另一处，而屏上不会有人说一句话。',
  },
  {
    id: 'decoration-never-shares-the-material-property',
    rule: '装饰不许与承载材质的属性共用同一个（例如用 box-shadow 做实时描边）。',
    gate: 'scripts/verify-decoration-property.mjs',
    specimen: 'surfaces',
    home: 'src/client/board.module.css',
    why: '一次动画把 box-shadow 换掉，进行中那几张卡直接失去纸面——环必须走 outline。',
  },
  {
    id: 'frame-geometry-is-fixed',
    rule: '换页不许移动栏或栏里的任何东西：页签轨道定宽、读数槽常驻、外空气归外壳。',
    gate: 'scripts/verify-design-docs.mjs',
    specimen: 'shell',
    home: 'src/client/design/WorkbenchShell.tsx',
    why: '读者在总览 / 看板 / 清单之间切换时，位置一动就等于每次都要重新找一遍。',
  },
  {
    id: 'primary-action-follows-the-thumb',
    rule: '窄档的主行动搬到底部栏杆（`ThumbRail`），宽档留在工具带最右端——同一个动作的两个位置。',
    gate: 'tests/mobile-contract.spec.ts',
    specimen: 'rail',
    home: 'src/client/design/ThumbRail.tsx',
    why: '窄档的竖向额度最紧（412×900 上板头 144px）；底部栏杆不推内容，且是单手唯一够得到的位置。',
  },
  {
    id: 'capsule-gate-is-a-gate-not-a-list',
    rule: '新增胶囊不用手工对齐：门禁按结构（`inline-flex` + 居中 + 一行字）判定，逐条列出漏网的。',
    gate: 'scripts/verify-capsule-centring.mjs',
    specimen: 'ink',
    home: 'scripts/verify-capsule-centring.mjs',
    why: '写成清单的判据会在下次新增时漏掉；写成结构的判据不需要有人记得。',
  },
  {
    id: 'scroll-region-never-pins-a-floor',
    rule: '滚动区同时是 flex 项时，地板必须是 `0`；写死的 px 地板会在矮屏上长出容器外。',
    gate: 'scripts/verify-scroll-floor.mjs',
    specimen: 'shell',
    home: 'src/client/board.module.css',
    why: '读者看到的是「滚动条的头突破天际」：一个 120px 的地板比它所在的列还高，滚动区于是画到卡片圆角之外。',
  },
  {
    id: 'a-record-is-one-row',
    rule: '一条记录（动态、通知、会话行）是**一行**：主体吃剩余宽度，动作与时间贴右；不是两行，且自带纸面。',
    gate: 'scripts/verify-hover-contrast.mjs',
    specimen: 'interaction',
    home: 'src/client/board.module.css',
    why: '`width: 100%` 让动作簇无条件独占一整行，一条记录被拆成两截，读者读到的不是「一条发生了的事」而是几段散落的字。',
  },
] as const

/** 按 id 取一条法则（门禁与预览页共用）。 */
export function lawById(id: string): DesignLaw | undefined {
  return DESIGN_LAWS.find(law => law.id === id)
}

/** 已经登记了门禁的那些（预览页用它标出「这一条有人守着」）。 */
export function guardedLaws(): readonly DesignLaw[] {
  return DESIGN_LAWS.filter(law => law.gate !== undefined)
}
