# dsh-task-board 任务看板重构 —— 设计规范（v2）

本规范是决策级契约：Phase 2-6 的实现者只照此落地，不再做设计取舍。全文沿用现有命名规律与既有符号（反引号引用），不引入新前缀命名空间；CSS 只用 `--dsw-*` 与 `--dsh-tb-*` 令牌，无 hex/rgb 字面量；全文无 emoji。

本规范基于现状审计（A）、外部参考（B）、自动化 UX 调研（C）与下列已定方向性决策撰写，方向性决策不得推翻：

1. 侧边栏入口镜像原生「新会话」按钮的 computed 表面样式（深浅色+玻璃都不透明）。
2. 悬浮层（新建任务/卡片详情/评论页/会话面板/确认框）以看板盒为参照系绝对定位 + flex 居中；删除 `--dsh-tb-board-offset` 机制。
3. 统一行文法：`SessionRow` 单一 leading 排版 + 紧凑小按钮（查看会话/隐藏/处理）；执行记录去掉「第 N 次执行」作为行身份的写法，改为会话/时刻身份，序号降为安静注记/计数。
4. 评论线程按会话统一（`sessionCommentsOf(task, sessionId)`），执行页与链接面板同会话互见同一线程；注入队列仍任务级 FIFO。
5. 自动化独立：去掉 `primed` 门（开启即生效，定时/接续按最新 prompt 反复执行）；保留 backlog/review/done=暂停、done=自动停用作为安全网；卡片不再被自动化绑死。
6. 看板头部统一为单一工具栏节奏（标题块 + 右侧 28px 胶囊动作簇：胶囊搜索、primary 新建、透明自动巡航开关+并发输入、返回对话小图标）；移除自动巡航的白底盒。
7. 板内会话面板是会话的主表面，原生跳转降级为安静的次要入口。
8. 数据键 `dsh.taskBoard.v1` 不变；字段级迁移允许（`primed` 归一化 true）；禁 emoji；CSS 只用 `--dsw-*` 与 `--dsh-tb-*` 令牌；不引入新依赖。

---

## 1. 设计目标与原则

- **看板即闭环工作台**：任务从创建、执行、评论续跑、审核到完成的每个动作都应能在看板内完成；「查看会话」原生跳转降级为安静次要入口，不因板内无法展示全貌而被迫出板。核心矛盾（任务被逼出板、`BoardController.onSessionsChanged` 因 `sessions.open` 改选中而 `closeBoard`）由统一会话面板 + 紧凑查看按钮解决。
- **任务与会话锚定为同一条持久工作条目**：借鉴 Hermes Kanban「任务=持久行、评论/解除是显式人力动作」的思路，本项目执行轮次是 `ExecutionRecord` 的独立历史、评论是每任务 FIFO 的人工指令；绝不自动替用户续跑。评论=驱动、手工恢复=唯一解除途径这条纪律不可破坏。
- **自动化是独立可选的编排，不是列/卡片的隐性属性**（参考 Routa「kanban 由 lane automation 触发」但反其道而行）：自动化必须挂在任务级 `ScheduleRule` 上、开启即生效、可随时打断，绝不做成「卡片移入某列就隐式触发」。卡片可自由拖移，自动化以「离开即暂停/停止」表达而非「拒绝移动」。
- **取消 primed 门，换取开启即生效，同时补上干预入口与安全网**：去掉 `primed` 与 `ruleReadiness` 的 `standby` 分支后必须一并提供「立即运行/跳过/停止接续/暂停」，否则是用一个安全网换另一个事故源。保留 backlog/review/done=暂停、done=自动停用作为自动化不越权的硬边界。
- **玻璃只留画布，内表面一律不透明**（Apple Liquid Glass 层级纪律，与现有别名层宪法同源）：`--dsh-tb-glass`/`--dsh-tb-bg` 只用于板/列背景随皮肤透明；所有内层浮起/下沉表面（卡片/对话/面板/评论/菜单/全部新增控件）一律不透明且只用派生令牌。
- **同语义动作跨表面同文同色**（Linear + Apple HIG）：同一动作（查看会话、立即运行、停止接续、暂停、隐藏）在任何表面用同一控件/同一文法，共用部件而非手写重复标记；注意力动效只用 `--dsh-tb-attention`/`--dsh-tb-breath` 一个语法。

---

## 2. 信息架构（层级与导航）

层级：**看板 → 列 → 卡片 → 详情 → 会话面板**。每层只放职责内的东西。

- **看板（`TaskBoard`）**：板头工具栏 + 五列。放：搜索、新建、自动巡航开关/并发、返回对话、列计数。不放：任何单任务细节。
- **列（`.column`）**：列标题 + 状态点 + 计数 + 卡片列表。放卡片排序信息。不放控制逻辑。
- **卡片（`TaskCard`）**：标题/描述/工作区/更新时间/徽章（定时、批次进度、评论排队、新内容、待处理、运行中、接续中、失败暂停）。**在过道上直接读出阶段与阻塞原因**（借鉴 AgentPeek「卡片即活状态」）；悬停快速动作（立即运行/快速留言）见第 4 节。不放完整对话。
- **详情（`TaskDetail`）**：内容/描述/运行配置/需求完善/自动化编辑/执行记录/链接会话/状态移动/footer 动作。放单任务全部编辑与自动化配置。
- **会话面板（`SessionFrame` 外壳下的 `ReviewDetail`/`SessionDetail`）**：会话的主表面——对话 transcript + 右栏状态（上下文条/config/会话事实/v等待条）+ 评论线程 + composer。放会话级全部操作。

**「链接会话」与「执行记录」统一成一个会话视角**：

- 两者共用 `SessionRow` 骨架的现状保留，但把 leading 的语义从「第 N 次 vs link 图标」统一为**一个「会话身份槽」**：`ExecutionRow` 的 leading 由「第 N 次执行」改为**会话标题（取自该 execution 的 `sessionId` 对应原生行 title，无 title 时回落为发起时刻）+（安静注记）`· 第 N 次`**，与 `LinkedRow` 的「link 图标 + 标题 + 工作区胶囊」对齐成同一种「会话条目」语言；序号 `detail.executionNo` 降为 `SessionRow` meta 行的一个小号计数或在 chip 内作为安静计数，不再是行 identity。
- 两者在详情中**相邻排版、同一 section 容器文法**（`.sessionList` + 共享行分隔/hover），标题头统一表达为「会话」（执行记录与链接会话分别以 `executions`/`sessions` 计数区分），中间不再隔着运行配置与自动化 section：建议将「执行记录」「链接会话」两个 `Section` 合并为一个「会话」section，内部用 `data-kind='execution'|'linked'` 分组（沿用 `SessionRow` 的 `kind`），执行记录在上、链接在下，用同一 `Section` 标题节奏。
- 两者的 `meta` 行语义槽统一：执行行 = 会话起止/时长；链接行 = 会话最近更新。都读 `formatDateTime`/`formatTime` 同一文法。
- 计数即所见：`Section` 标题计数 = 可见行数（隐藏不计数、恢复回补），沿用 `hasHiddenRows`/`unhideTaskRows`。

---

## 3. 数据模型与状态机增量

数据键 `dsh.taskBoard.v1` 不变。以下均为字段级增量，`store.parseLedger` 的结构校验与归一化按既有模式扩展。

### 3.1 `ScheduleRule`（`src/core/tasks.ts`）

- **删除字段**：`primed: boolean`。实现上保留键并在 `normalizeSchedule` 中归一化为 `true`（决策 8「primed 归一化 true」），这样旧数据读入即视为 active，等效于已经过手动激活。`withSchedule` 中 `'primed' in patch` 分支删除；`controller.launchTask` 中 `trigger === 'manual'` 写 `primed` 的代码删除（controller.ts:881-891）。
- **不新增字段**（避免扩散）：`chain` 的「已运行次数/上限」沿用 `runCount`/`maxRuns`，cron 沿用 `nextRunAt`/`lastTriggeredAt`/`runCount`/`maxRuns`。
- **建议新增字段**（可选，待确认是否必要）：`stopped?: { at: number; note?: 'chain-stopped' }` 用于记录「停止接续」这种只停链不动列的动作是用户显式触发（区别于普通 `enabled:false`）。若不需要留存原因，可不加（实现者在 Phase 5 决定；不加则所有干预统一走 `enabled:false`，文案直接区分）。

### 3.2 `ruleReadiness`（`src/core/tasks.ts`）

去掉 `standby` 分支，收窄为三态（`RuleReadiness`）：

- `disabled`：`schedule === undefined || !enabled`。
- `paused`（`status: 'backlog' | 'review' | 'done'`）：enabled 但任务在不可驱动列——`backlog`=搁置、`review`=人工裁决待审、`done`=已完成（配合 `disarmSchedule` 硬停）。
- `active`：enabled 且任务在 `todo`/`running`。

审计字段：`withSchedule` 的默认 `primed: current?.primed ?? false` 改为 `true`；`parseLedger.normalizeSchedule` 的 `primed: rule.primed === true` 改为 `true`（恒真并保留键以便旧数据无损）。

### 3.3 状态机：开启即生效的首次触发

- `controller.setSchedule`（controller.ts:731-757）在 patch 使规则 `enabled === true` 时必须处理「启用即启动」：
  - cron：`nextRunAtMs` 已由现有代码即时计算；**不再需要手动启动**，到点 `SchedulerService.tick` 自然触发（因无 `primed` 门）。
  - chain：**必须先启动第一轮**，否则会落进 `scheduler.tick` 的 chain 分支——该分支 `if (task.status !== 'running') continue`，导致躺在 todo 的 chain 永不启动。实现：`setSchedule` 里 `enabled` 从 false 变 true 且 `mode === 'chain'` 且 `task.status` 非 running 时，persist 后调用 `runTask(id, 'chain')` 启动第一轮（复用现有 `dispatch` 预算）。
  - 由此 `scheduler.tick` 的 standby 分支（scheduler.ts:101）删除；`maybeContinueChain`（controller.ts:952-965）与 `runTask` 里对 `primed` 的判断删除，chain 的接续条件改为「`enabled && mode === 'chain'` 且最新 run 已 settled 且仍在 within budget」。

### 3.4 卡片不再被自动化绑死（`resolveCardDrop`）

- `resolveCardDrop`（tasks.ts:582-596）删除 `chainOwns` 的「非 running 一律 `reject:'scheduled'`」分支。
- 新语义：chain 不阻止卡片离开 running，而是以「离开即暂停/停止」表达：
  - 拖到 `done` = 完成并停链（`controller.moveTask` 现有 `disarmSchedule` 已处理）。
  - 拖到 `backlog`/`todo` = 暂停链条（`ruleReadiness` 在 `backlog` 判 `paused`；`todo` 反而会继续 active——需区分：拖到 `todo` 表示「保持开启继续跑」，拖到 `backlog` 表示「搁置暂停」。若希望「离开即暂停」更彻底，可在拖到任何非 running 列时对 chain 任务调用 `setSchedule({enabled:false})` 显式停链，由用户在详情重开——实现者二选一并写测试固化。**默认采用：拖到 `done` 停链；拖到 `backlog`/`review` 暂停（paused）；拖到 `todo` 视为手动接管、规则转 paused 前先停链**，杜绝「回 todo 又连锁启动」的意外，给用户显式控制感）。
  - 新增显式「停止接续」按钮（见第 6 节）作为唯一可打断链条的结构性入口。
- `settleExecution`（tasks.ts:457-472）的 `chainIncomplete`/`batchIncomplete` 保持「succeeded 且预算未满时 stay running」语义不变——这是批处理正确性，不属「绑死」。真正要改的是：**失败的 chain 不再 stay running**（现状 `outcome !== 'succeeded'` 已落到 review，是对的），并让 review 的失败原因可被呈现代码读到（见第 6 节）。

### 3.5 评论线程按会话统一（见第 7 节详述）

新增纯函数 `sessionCommentsOf(task, sessionId)`，覆盖「同一原生会话」的全部评论轮次；与既有 `commentsOf`/`sessionThreadOf` 关系见第 7 节。

### 3.6 纯函数与既有测试影响面

- `tests/tasks.spec.ts`：改写 `primed`/`standby` 用例（580-600 行区域）为「开启即 active」；改写 `resolveCardDrop` 的 `scheduled` reject 用例（396-419）为「chain 卡可打断/离开即暂停」。
- `tests/scheduler.spec.ts`：改写 standby 分支用例（105-117）为「cron 开启即到点触发」；改写 chain 恢复用例（251-286）去掉 primed。
- `tests/controller.spec.ts`：改写 748-752（primed false/true 断言）与 1481（chain primed:true 构造）为启用即 active/chain 启用即启动。
- `tests/store.spec.ts`：`normalizeSchedule` 的 primed 归一化断言（218/239/266/283）改为恒 true。
- `tests/comment-thread.spec.ts`：新增 `sessionCommentsOf` 用例（见第 7 节清单）。
- 新增纯逻辑用例：chain 启用即触发、cron 跳过不补跑、chain 卡片可打断、停止接续只停链不动列（见第 8 节）。

---

## 4. 交互模型（逐表面）

### 4.1 看板头部工具栏（决策 6）

现状 `TaskBoard` 板头一行铺满搜索框、primary 新建、`.cruise` 白底盒、`.boardClose`。改为**单一工具栏节奏**：

- 布局：左「标题块」（`board.title` 16px/600 + 计数），右侧一组 **28px 胶囊动作簇**（`--dsh-tb-button-h` 28px、`--dsh-tb-button-radius` 18px 一致）。
- 元素（右到左）：
  1. **返回对话小图标**：把 `.boardClose` 从占位 ghost 按钮改为 `iconButton`，放最右（现有 `Icon name="close"` 语义改为返回箭头时给 `Icon` 加 `arrowLeft` 名；不放则沿用 `arrowRight`）。
  2. **自动巡航开关 + 并发输入**：移除 `.cruise` 白底盒（board.module.css:1943-1967），改为**透明胶囊**：`Switch`（label=自动巡航，沿用 `t('board.cruise')`）+ 一个窄 `input.cruiseLimit`，两者同处一个 `inline-flex` 容器、无实底、无淡盒，只用 `--dsh-tb-hover` 悬停 + focus 2px outline，玻璃皮肤下读作透明浮起而非白块。
  3. **primary 新建**：`Button variant="primary"`（36px 高 `--dsh-tb-button-h-lg`，与 shell 节奏一致）。
  4. **胶囊搜索**：`.search` 改胶囊：`border-radius: var(--dsh-tb-radius-xl)`（999px 胶囊），背景 `--dsh-tb-input-bg` 保持不透明，宽度 `flex: 0 1 260px` 不变。
- 动作簇全部同高 28px、同胶囊半径、`--dsh-tb-motion` 160ms。

### 4.2 列与卡片（含悬停快速执行/快速留言，本次范围）

- **卡片**：沿用 `TaskCard`。徽章区按第 6 节呈现自动化三态（运行/接续中、已暂停待审、已关闭）。`hasOpenRun` 唯一判定 + 未读呼吸环、等待回应、评论排队、批次进度、需求完善中全部沿用 `Chip`。
- **卡片悬停快速动作**（新增，`TaskCard` 内加 hover 层，`@media (hover:hover)` 显示）：
  - **快速留言**（轻量）：卡片 hover 右上浮现一个小 `iconButton`，点击展开一个内联 `PromptInput`（复用现有 `PromptInput` 文法），提交走 `controller.submitSessionComment`？——否：无 sessionAnchor 语义。改为：快速留言对**有已结算执行的 task** 走 `controller.submitComment(taskId, latestExecutionId, text)`；对 bound task 且无执行记录时聚焦到详情内的链接面板。若实现复杂，降级为仅「聚焦到评论」（悬停动作可留待 Phase 4 手测后决定是否保留，见第 9 节范围说明）。
  - **立即运行**：卡片 hover 加轻量 run-now 图标按钮，复用 `rerunTask` 语义与现有动效（`dshTbDropConfirm` 落点动效不强制用于按钮，沿用 `--dsh-tb-hover`/pressed/focus）。disabled 条件与详情 footer 的 `busy` 一致（`hasOpenRun`）。
- **拖拽**：`resolveCardDrop` 改造后，chain 卡不再在拖离 running 时红闪拒绝；落到非 running 列按 3.4 语义执行（暂停/停链/接管），沿用落点闪烁/拒绝闪烁的 `dshTbDropConfirm`/`dshTbRejectFlash` 已有效反馈（reduced-motion 静态降级）。

### 4.3 详情页（`TaskDetail`）

- **布局**：`.detail` 改为以看板盒为参照居中（决策 2 落地，见第 5 节面板几何），宽度 `min(640px, ...)` 保留；`.detailBody` 可滚动区之上的固定内容（header/footer/ScheduleSection 顶部）保持 flex 稳定。
- **执行记录 + 链接会话合并为「会话」视角**（第 2 节）：`ExecutionRow`/`LinkedRow` 同 `Section`，leading 统一、序号降级。
- **「第 N 次执行」处理**：`TaskDetail` leading（`detail.executionNo`，TaskDetail.tsx:127）、`ReviewDetail` badge（ReviewDetail.tsx:173，`SessionFrame badge`）、卡片 running Chip（TaskCard.tsx:183）三处统一：序号不作为行 identity，只在 `SessionRow` meta 行或 chip 内作安静计数「第 N 次」。卡片 running chip 文案改为「运行中 · 第 N 次」保留计数但不再作前缀强调（弱化数字语义，回应调研 C 的低严重度项）。
- **自动化编辑**：`ScheduleSection` 折叠行 summary 直接显示三态摘要（见第 6 节），不做成常驻大按钮。
- **footer**：保留「重新执行」primary（天然 run-now），停止接续/立即运行按第 6 节显隐。
- **不新增常驻噪音**：干预入口按第 6 节「放置与显隐」执行。

### 4.4 会话面板（统一线程 + 双模式 composer 现状保留）

- `ReviewDetail`/`SessionDetail` 共用 `SessionFrame` 外壳与右栏 `SessionRailHead`/`SessionTranscript` 现状保留。
- **双模式 composer 保留**：执行评论页只有「驱动」；链接会话面板在「驱动任务」与「直发会话」间切换（`SessionDetail` 现状，决策 7 不推翻）。
- **「查看会话」按钮全局降级**：`SessionRow` 内、`ReviewDetail`/`SessionDetail`/`RefineSection` header 里的全尺寸 ghost `Button`（`detail.viewSession`）改为**紧凑 icon 级变体**（见第 5 节「紧凑按钮」），原生跳转降级为安静次要入口；header 高度随之收敛（ReviewDetail.tsx:175-186 / SessionDetail.tsx:163-172 不再渲染全尺寸按钮）。
- **板内会话面板是主表面**：会话面板承载完整 transcript tail + 评论线程 + composer，满足「全程不出板」；`controller.openSession` 仍在但只作为次要跳转。
- 失败则保留草稿、会话消失禁用 composer、完成态拒发等 `SessionDetail` 现有契约全部保留。

### 4.5 评论不同步（审计 UX gap 修复）

根因是评论状态只随 `persistAndNotify`/3s 水位轮询推进（`useTranscriptTail` 的 3s 水位，use-transcript.tsx:153）。修复方向：

- 评论 chip 状态推进仍以控制器 notify 为准（不变），但补「即时骑乘」：提交后立刻给该 round 一个本地乐观状态（`queued`），并在 `useTranscriptTail` 返回的事件/水位到达时刷新，缩短「看起来没进去」的窗口。具体可在 `CommentsThread` 对 `review.commentPending`（巡航关时只保存不注入）增加明确提示文案「已保存，开启自动巡航后注入」，避免用户误判为丢失——这是纯文案 + 现有状态机，不改调度。
- 巡航关时 `locales` 的 `review.commentPending`/`commentPendingHint` 文案补足「未注入会被误判为丢失」的问题（第 5 节视觉/文案一致性）。

---

## 5. 视觉语言

### 5.1 对齐令牌表（`--dsh-tb-*` 派生，全部来自 board.module.css 顶部别名层）

| 语义 | 令牌 | 派生自 | 用途 |
| --- | --- | --- | --- |
| 画布玻璃/背景 | `--dsh-tb-glass`/`--dsh-tb-bg` | `--dsw-alias-bg-base` | 板/列背景，随皮肤透明 |
| 浮起表面 | `--dsh-tb-surface-float` | `--dsw-alias-bg-layer-1` | 卡片/对话/面板/评论，不透明 |
| 下沉表面 | `--dsh-tb-surface-sunken` | `--dsw-alias-bg-layer-2` | 次要下沉块 |
| 菜单表面 | `--dsh-tb-surface-menu` | `--dsw-specific-menu` | 斜杠/菜单弹层 |
| 遮罩 | `--dsh-tb-mask` | `--dsw-alias-bg-mask-1/3` 混 | 悬浮层背景 |
| 边框 | `--dsh-tb-border`/`--dsh-tb-border-soft` | `--dsw-alias-border-l2/l1` | 浮层/输入边框 |
| 分隔 | `--dsh-tb-separator` | `--dsw-alias-separator-primary` | 行/section 分隔 |
| 圆角 | `--dsh-tb-radius-sm/md/lg/xl` | 8/12/16/24 | 部件圆角 |
| 按钮几何 | `--dsh-tb-button-h(28)`/`--dsh-tb-button-h-lg(36)`/`--dsh-tb-button-radius(18)` | 原生节奏 | 所有按钮 |
| 阴影 | `--dsh-tb-shadow-1/2/3` | `--dsw-shadow-lv1/2/3` | 浮层深度 |
| 文本 | `--dsh-tb-text-1/2/3` | `--dsw-alias-label-primary/secondary/tertiary` | 正文层级 |
| 强调 | `--dsh-tb-accent` | `--dsw-alias-state-business-primary` | 单语义强调色 |
| 状态 | `--dsh-tb-attention/success/danger` | warn/success/error primary | 注意力/成功/危险 |
| 半透明态 | `--dsh-tb-attention-alpha/-soft` | 22%/10% `color-mix` | 状态底色/柔晕 |
| 输入底 | `--dsh-tb-input-bg` | `--dsw-specific-input-major` | 输入框 |
| focus | `--dsh-tb-focus-ring`/`--dsh-tb-focus-color` | business α/primary | focus 2px outline |
| 动效 | `--dsh-tb-motion`(160ms)/`--dsh-tb-breath`(2.6s) | — | 交互/呼吸 |

所有新增控件**只引用本表派生令牌**，绝不出现 hex/rgb（`verify` 硬性审计）；半透明用 `color-mix(in srgb, token, transparent)` 两级 22%/10%。

### 5.2 面板几何（决策 2，删除 `--dsh-tb-board-offset`）

- 现状：`.modal`/`.detail`/`.review` 用 `left: calc(var(--dsh-tb-board-offset,0px)/2)` 机械右移半个侧栏宽（board.module.css:763/994/1976），导致偏右。
- 目标：删除 `--dsh-tb-board-offset` 的**赋值**（TaskBoard.tsx:125-140 的 ResizeObserver + `setProperty` 整段删除）；`.modal`/`.detail`/`.review` 的 `left` 删除，改为**以看板盒为参照系的绝对定位 + flex 居中**：`modalBackdrop` 从 `position:fixed; inset:0` 改为 `position:absolute; inset:0` 并保持 `display:flex; align-items:center; justify-content:center`；因其父级 `[data-dsh-taskboard-view]`（`.board` 容器，`position:absolute; inset:0`）即看板盒左缘，故彻底消除「侧栏偏移」。
- 同时把 `controller.openTask` 触发的 `TaskDetail`、`NewTaskModal`、`ConfirmDialog`、`ReviewDetail`/`SessionDetail` 全部钉在看板盒内，任何视口都贴不到列线。

### 5.3 玻璃皮肤规则（决策 5 视觉）

- 画布走皮肤：板/列背景 `--dsh-tb-glass`/`--dsh-tb-bg` 随皮肤透明度。
- 内表面一律不透明：卡片/对话/面板/评论/菜单/所有新增控件用 `--dsh-tb-surface-float/-sunken/-menu`（不透明）、或描边文字 `Chip fill={false}` 的半透明 `color-mix` 底（22%/10%）。
- 单层玻璃主材料、不叠双层半透明：任何浮层不叠两层半透明；按钮内嵌在不透明实底上。
- 移除自动巡航白底盒：`.cruise` 不再用 `--dsw-alias-bg-layer-2` 实底 + `--dsw-alias-border-l1` 边框 + 8px 圆角（board.module.css:1943-1952），改为透明胶囊（见 4.1）。

### 5.4 紧凑按钮 / 行文法 / 注意力动效

- **紧凑小按钮变体**：在 `ui.tsx` 的 `Button` 上支持一个尺寸档（新增 `size?: 'sm'` 或独立 `iconButton` 形态），用于行内/header 的「查看会话」（`detail.viewSession`）、「隐藏」（已有 `.rowHide`）、「处理」（已有 `.sessionRowHandle`）。紧凑变体：高 `--dsh-tb-button-h` 28px 内收（padding `0 10px`、字号 12px），或 icon-only；沿用 `--dsh-tb-hover`/focus/pressed，与 `.rowHide` 同一枚安静文法。所有 `SessionRow`、`ReviewDetail`/`SessionDetail`/`RefineSection` header 的「查看会话」改用它。
- **统一行文法**：`SessionRow` 的 leading 按第 2 节统一；`sessionRowActions` 里「查看会话/处理/隐藏」全部收敛为紧凑动作；`meta` 行 `formatDateTime`/`formatTime` 一致。
- **注意力动效**：`--dsh-tb-attention` + `--dsh-tb-breath` 唯一语法；卡片外层 `dshTbBreathRing`、执行行内层 `dshTbBreathHalo`（无边框无平染）；`prefers-reduced-motion` 全部静态降级（沿用 board.module.css 1910-1939 区间）。
- **可达性纪律**：`:focus-visible` 2px outline、hover/pressed 微反馈、`prefers-reduced-motion` 降级、44pt 触控目标（图标至少 28-30px 命中区）。

---

## 6. 自动化独立模型

### 6.1 状态机：`disabled / active / paused / done-disarm`

去掉 `standby` 后，`ruleReadiness` 三态 + 完成即停：

- `disabled`：`enabled === false`。
- `active`：`enabled && status ∈ {todo, running}`。
- `paused`：`enabled && status ∈ {backlog, review, done}`（`paused.review`/`paused.backlog`/`paused.done`，复用现有 `pausedLabelOf` 文案，`review` 需补「因失败」原因词）。
- `done-disarm`：完成即 `disarmSchedule`（`enabled:false`，配置保留可重开）——硬停，不是 paused。

### 6.2 开启即生效的首次触发时机

- cron：`setSchedule` 启用即算 `nextRunAtMs`，到点 `SchedulerService.tick` 触发（无 primed 门）；「下次运行：<本地时间>」在编辑器实时显示。
- chain：`setSchedule` 启用且 `mode==='chain'` 时**立即启动第一轮**（`runTask(id,'chain')`），并在编辑器用 chain 专属文案（「每次完成后立即接续 · 已运行 N 次 · 上限 M（或 ∞）」）替代 `notScheduled` 误导描述（`ScheduleSection` 的 `nextLabel` 在 chain 模式现统一返回 `notScheduled`，必须改为 chain 专用文案）。
- **防误跑护栏**：chain 无限次数默认 `maxRuns` 留空时，启用给一个「确认开启无限接续」轻量 `ConfirmDialog`（现成组件）；同时在 `deep|en` 文案提示真实会话持续执行的风险。

### 6.3 运行中跳过（不与补跑混淆）

- cron：仅当 `nextRunAtAt` 在未来时显示「跳过本次」；跳过 = 手动把 `nextRunAt` 推到下一个匹配时刻（直接调 `controller.applyScheduleNextRun(id, nextRunAtMs(cron, now), undefined)`），就地反馈「已跳到下次」；链无意义不显示。不补跑、关后不悄悄补跑错过时刻——沿用 scheduler「错过即跳过、绝不 catch-up」原则。
- 卡片不被自动化绑死见 3.4。

### 6.4 卡片徽章与详情摘要呈现

- **卡片**（`TaskCard`）：
  - 方案 a —— 模式徽章：`Chip` 区分「定时」vs「接续」（复用 chip 文法，title 用 `scheduleChipTitle` 增强）。
  - 方案 b —— chain 下叠加「接续中」语义：运行中已有 spinning「运行 · 第 N 次」徽章，chain 模式叠加「接续中」Chip。
  - 方案 c —— 失败落 review：用 error 色 chip（已有 `latest.result==='failed'→'error'` 逻辑）并加「失败 · 已暂停」danger 档 chip，让 review 列内「自动化失败」与「成功待确认」一眼可分。
- **详情 `ScheduleSection` summary**：折叠行 `.scheduleSummary` 直接显示三态摘要——`运行/接续中`（active）、`已暂停（上次自动运行失败 / 因 <状态> 暂停）`（paused.review 带原因词）、`已关闭`（disabled/done）。规则去掉 standby 后正好对应三态。

### 6.5 干预入口位置与显隐（不做成常驻按钮，避免板面噪音）

- **立即运行一次**：已存在详情 footer「重新执行」（`rerunTask` 天然 run-now），cron/chain/无调度均可；卡片 hover 加轻量 run-now 图标（见 4.2）。同语义动作用 `Button`/iconButton 同一文法。
- **跳过本次**：仅 cron 且 `nextRunAt` 在未来时显示，放 cron 编辑器内就近；点后就地反馈「已跳到下次」。
- **停止接续 / 停止自动执行**：chain 模式显示（可能无限跑）。语义= `setSchedule({enabled:false})`，文案区分「只停链、不动卡片列」——新增独立「停止接续」动作（只停 `enabled:false`、卡片列不变），顶部总开关 `Switch` 保留作全局通断。三类动作唯一入口、同文同色。
- **确认框**：chain 无限启用、停止接续均走 `ConfirmDialog`。

### 6.6 失败后行为的呈现（三级一致信号）

自动化失败 → `settleExecution` 落 review 且 chain 因 `result!=='succeeded'` 不接续、cron 因 `status==='review'` 判 paused：

1. 卡片 chip：error 色 + 「失败 · 已暂停」（6.4 方案 c）。
2. 详情 `ScheduleSection` summary：「已暂停（上次自动运行失败）」+ 恢复动作「点重新执行立即继续」/「移到待办按原计划继续」（现 `paused.review` 文案补「因失败」原因词）。
3. 执行历史行：`execution.error` 展示 + `failed→'error'` chip（现有逻辑保留）。

### 6.7 干预/状态控件不露丑

全部引用别名层派生令牌（5.1），不新增独立皮肤；禁止白底盒。立即运行/停止接续复用 `primaryButton`/`ghost`/`danger` 的 `--dsw-alias-button-primary-fill` 体系；状态徽章沿用 `Chip fill={false}` 描边 + `color-mix` 22%/10% 两级；跳过/暂停用 ghost + focus 2px outline + hover `--dsh-tb-hover`，动画 `--dsh-tb-motion`；闪烁/呼吸沿用 `dshTbBreathRing`/`dshTbDropConfirm` 语法且 reduced-motion 静态降级；面板几何仍以板左缘为基准居中（5.2）。

---

## 7. 评论线程按会话统一

### 7.1 派生规则

现状双锚（`commentsOf` 按 `parentExecutionId`、`sessionThreadOf` 按 `sessionAnchor`）保留为**底层归属**，新增一个**会话级视图纯函数**作为统一入口：

```ts
// src/client/board/comment-thread.ts（新增）
export function sessionCommentsOf(
  task: TaskRecord,
  sessionId: string,
  cruiseOn: boolean,
): CommentView[] {
  return task.executions
    .filter((round): round is ExecutionRecord & { comment: string } =>
      round.comment !== undefined && round.sessionId === sessionId)
    .map(round => ({ round, state: commentRoundState(round, cruiseOn) }))
}
```

派生规则：按**原生会话 `sessionId`** 归集该任务下所有注入到该会话的评论轮次，含执行锚定（`parentExecutionId`）与会话锚定（`sessionAnchor`）两种轮——因为它们最终都注入到同一个 `sessionId`（`newCommentRound` 工厂统一设置 `sessionId`，且 `commentRun` 本就是 sessionId 参数化）。旧数据（无 `parentExecutionId` 且无 `sessionAnchor` 的评论）按其 `sessionId` 归入；`sessionId` 未填的（尚未注入的）按锚兜底（`parentExecutionId`→该 execution 的 session、`sessionAnchor`→锚自身）。

### 7.2 两种表面的取值

- **执行页（`ReviewDetail`）**：评论线程从 `commentsOf(task, execution, cruiseOn)` 改为 `sessionCommentsOf(task, execution.sessionId, cruiseOn)`——同会话内、不同执行轮提交的评论**互见同一线程**。现有「一个轮次只带一个锚、绝不串表面」的约束由 derived 层替换为「同一原生会话内互见」，从用户视角消除了「执行页留言、链接面板看不到」的割裂。
- **链接面板（`SessionDetail`）**：评论线程从 `sessionThreadOf(task, sessionId, cruiseOn)` 改为 `sessionCommentsOf(task, sessionId, cruiseOn)`——与执行页同会话互见。
- **注入队列位次**：仍任务级 FIFO，`queuePositionOf` 逻辑不变——`commentsOf`/`sessionThreadOf`/`sessionCommentsOf` 只决定某会话线程的**可见成员**；`queuePositionOf` 对整个任务 pending 评论排序（`comment-thread.ts:87-93`），不随视图变化。同一执行页的座次号因此可能因跨执行轮评论出现间隙，但注入顺序与显示位次都以任务级 FIFO 为准（注释需同步说明）。
- `sessionRoundsOf`（session-display.ts:37-43）已排除 `sessionAnchor` 轮于执行会话之外；`sessionCommentsOf` 则相反地把两者都纳入会话线程。二者职责不同：前者判会话「忙」状态，后者判「哪个线程可见评论」。保持区分，不合并。

### 7.3 队列位次

同一会话内、同一任务的评论按 `startedAt` FIFO 位次显示「排队中 · 第 N 位」；不同会话（执行原生会话 vs 链接会话）各自按任务级 FIFO 排，绝不两套队列（决策 4：注入队列仍任务级 FIFO，与现状一致）。

### 7.4 旧数据兼容

- 无 `parentExecutionId`、无 `sessionAnchor`、但 `sessionId` 有值的旧评论：`sessionCommentsOf` 按 `sessionId` 收编，不丢。
- 无 `sessionId`（未注入且未接 session）的评论：保留在 `saved`/`queued` 状态、可取消，不因归集规则丢失。
- `store.parseLedger` 无需为评论线程加迁移；`newCommentRound` 工厂确保新轮次必有 `sessionId`。

### 7.5 测试用例清单（tests/comment-thread.spec.ts 新增）

1. `sessionCommentsOf` 归集同一 `sessionId` 的执行锚定与会话锚定评论。
2. 不同 sessionId 的评论不互串。
3. 旧数据（无锚、仅 `sessionId`）按 session 收编。
4. 执行页（ReviewDetail 视角）采用 `sessionCommentsOf` 后，同会话不同执行轮互见。
5. 链接面板视角与执行页视角在共享会话上返回相同成员集合。
6. `queuePositionOf` 仍按任务级 FIFO，与视图无关。
7. 注入队列仍任务级 FIFO，跨会话轮次加入不改变单调顺序语义。
8. 未注入（saved/queued 无 sessionId）评论可取消、不丢。

---

## 8. 分阶段验收标准

对应 Phase 2-6。每阶段以 `pnpm build`/`pnpm typecheck`/`pnpm test`/`pnpm verify` 全绿为硬门槛；git 流程照旧（改前存档 + 改后提交，禁 emoji）。

### Phase 2 —— 视觉/排版（决策 1、2、3、6，改 client 刷新即效）

- 手测：侧边栏入口镜像原生「新会话」computed 样式（深浅色+玻璃都不透明）。
- 手测：任务详情/评论页/新建/确认框以看板盒居中，不再偏右；删除 `--dsh-tb-board-offset` 赋值后任何视口不贴列线。
- 手测：`SessionRow` leading 统一（执行行以会话标题 + 安静「第 N 次」注记，链接行 link 图标 + 标题 + 工作区胶囊）；「查看会话」改用紧凑按钮；header 高度收敛；执行记录与链接会话同「会话」section 相邻排布。
- 手测：板头单一工具栏节奏，`.cruise` 白底盒移除变透明胶囊，搜索/新建/巡航/返回同一 28px 胶囊簇。
- 手测：玻璃皮肤下内表面不透明、无白底盒、无 hex 泄露；`prefers-reduced-motion` 静态降级。
- 自动：`verify` 通过（无 hex/rgb 字面量）。

### Phase 3 —— 数据/状态机（决策 5、8，改 client+host 视范围）

- 自动：`tests/tasks.spec.ts`/`tests/scheduler.spec.ts`/`tests/controller.spec.ts`/`tests/store.spec.ts` 的 primed/standby 用例改写为「开启即 active」；`normalizeSchedule` primed 恒 true。
- 自动：新增 chain 启用即触发、cron 跳过不补跑、chain 卡片可打断（`resolveCardDrop` 不再 reject scheduled）、停止接续只停链不动列的纯逻辑用例。
- 手测：旧 localStorage 数据（带 `primed:false`）读入即视为 active，不丢数据。

### Phase 4 —— 交互/自动化 UI（决策 5、6，改 client）

- 手测：cron 启用即显示「下次运行：<本地时间>」；chain 启用即启动第一轮且编辑器显示 chain 专属文案；chain 无限启用有 `ConfirmDialog` 确认；「立即运行/跳过/停止接续」在正确位置/显隐出现且就地反馈。
- 手测：卡片徽章三态（运行/接续中、已暂停待审、已关闭）+ 「失败 · 已暂停」danger chip；详情 `ScheduleSection` summary 直读三态带「因失败」原因词。
- 手测：chain 卡拖到 done=停链、backlog/review=暂停、todo=停链接管，不再红闪拒绝；卡片 hover 快速运行可用。
- 自动：`tests/tasks.spec.ts` 新增「停止接续只停链不动列」「done 落点停链」断言。

### Phase 5 —— 评论线程按会话统一（决策 4，改 client）

- 自动：`tests/comment-thread.spec.ts` 新增 `sessionCommentsOf` 全量用例（7.5 清单）。
- 手测：执行页与链接面板同会话互见同一评论线程；排队位次按任务级 FIFO；旧数据不丢；巡航关时未注入有明确「已保存」提示。
- 自动：`tests/controller.spec.ts` 中 `submitComment`/`submitSessionComment` 既有用例回归通过（双锚并存不破坏 FIFO）。

### Phase 6 —— 全板闭环与回归（决策 7，改 client/host）

- 手测：板内会话面板为会话主表面，全程不出板可完成 创建→执行→评论续跑→审核→完成→回移；原生「查看会话」为安静次要入口且 header 不高。
- 手测：脚本清理 `--dsh-tb-board-offset` 与废弃 CSS 类（`.name` 定义与 `css.name` 引用对照，`noUnusedLocals`/`noUnusedParameters` 开启下无死代码）。
- 自动：`pnpm build`/`pnpm typecheck`/`pnpm test`/`pnpm verify` 全绿；README 与 AGENTS.md 同步（能力/命令变化）。
- git：改前存档点 + 改后提交（禁 emoji）。

---

## 9. 显式不做（范围外）

- **不做列级自动化**：不把「卡片移入某列」作为触发边界（Routa 列触发模型不照搬），自动化只挂任务级 `ScheduleRule`。
- **不做外部持久层**：不引入 host 文件通道 / SQLite / markdown 任务文件；任务即 DSH 会话本身，`dsh.taskBoard.v1` 单键整存维持，跨设备共享列为「待确认」问题（现状审计数据模型备注），不在本重构内解决。
- **不做三列自动排序**：保留手动拖拽与归档控制权（AgentPeek 三列自动排序不照搬）；看板列仍五个（待规划/待办/进行中/待审核/已完成），不新增「Attention/等待归集」列。
- **不做自动重推/自动续跑**：评论/解除是显式人力动作，绝不自动替用户重启（Hermes #28944 教训）。
- **不新增依赖**：一切用现有 `@deepseek-ai/*`/React/schemastery，不引新 npm 包。
- **不做链式语义重写**：chain 仍是「按最新 prompt 反复执行」，不做成「任务=可编辑 markdown 源」；快速留言若实现成本过高则降级（悬停快速运行保留，快速留言为本次软性范围，Phase 4 手测后决定保留与否，属范围内取舍而非设计回退）。
- **不重建调度内核**：`SchedulerService.tick`/统一并发 `dispatch` 逻辑沿用，只删 `primed`/`standby` 触点与补干预入口；不做服务端定时器（仍是浏览器端 tick，跨标签不共享「待确认」）。
- **不引入新命名空间**：新增函数/字段沿用 `comment-thread`/`tasks`/`controller`/`SessionRow`/`ruleReadiness` 等既有前缀，不建 `dsh-tb-xxx-2` 之类新前缀。
