# dsh-task-board — 项目说明（会话自动注入）

本文件在每次会话开始时自动注入上下文。它是本项目与 AI 之间的接口契约，是项目的
唯一权威约定；任何修改必须遵守本文，并以「构建 + 测试 + 自检」全绿为完成标准。

## 行事总纲（最高准则，优先于一切具体方法）

- 治本，不治标：找到根因，修一次让一类问题不再复发；只压表面不算解决。
- 写原则，不写死：能归为通则的不写成个案特例；能靠结构和机制表达的不写死细节。
- 融入结构，不打补丁：新增能力找到它在整体中的位置并融入，不在边上再挂一块。
- 保持清朗，不堆屎山：方案、清单、目录、文件、流程、代码都要结构清晰、职责分明。
- 动手前三问：治标还是治本？覆盖一类还是一个？做完更清晰还是更臃肿？

## 本文件的定位与编辑规则

- 本文件是**活的**：随项目演进被更新、增删、重构，不是快照。发现本文与代码现状
  不一致时，以「本文意图 + 代码现状」为准并修正本文。
- **AI 有权编辑本文件**：规则过时、用户调整约定、本文无法覆盖且会反复出现的新场景、
  表述不清——直接更新并提交，而不是绕过它、只做口头约定、或把特殊处理写死进代码。
- 面向 AI 阅读：专业、准确、可执行；不写面向终端用户的科普内容。
- 写意图不写快照：优先表达「为什么」与「边界」，让未来会话能推理到未覆盖的情形；
  避免一次性补丁条款与无意义的日期/版本号。
- 精炼、不重复、结构清晰；遵守硬性规范（禁 emoji 等）；用户可见能力或命令变化时
  同步更新 README 并提交（README 面向人：能力 / 安装 / 使用 / 命令）。

## 环境与上下文（以实际环境为准，不依赖固定值）

- 宿主：DeepSeek Harness (DSH) Web GUI，运行在用户本机。DSH 的一切皆插件；本插件以
  cordis 插件形态存在。平台与用户名不写死：需要时用命令发现（`process.platform`、
  `os.homedir()`），不要假设具体值。
- 项目根：本文件所在目录。DSH 数据根：`$DSH_HOME` 优先，否则主目录下 `.dsh`
  （由 `os.homedir()` 推导）。激活 profile：`profiles` 下的目录（当前部署为 `web`，
  以实际目录为准）；本插件经 `dsh.profile.bundles` `link:` 挂载。
- `~/.dsh/cordis.patch.yml`：合法状态 = 不存在，或顶层 YAML 数组（存在但为空会令
  dsh 启动失败）；`~/.dsh/settings.yaml` 承载插件设置命名空间。
- 兄弟插件：本目录所在 `Plugins` 目录下的平级独立插件（用目录扫描发现）；与本项目
  完全独立、互不依赖、互不引用。
- 生效规则：host 半区改动需重启 `dsh web`；client 半区改动刷新页面即可。

## 项目定位

DSH Web GUI 的任务看板插件：侧边栏「任务看板」入口 + 多列看板 + 任务经 DSH 会话机制
真实执行 + 5 段 cron 定时调度。单一 npm 包，cordis 插件，host/client 双半区，MIT 许可，
全新独立项目（零历史仓库引用）。

### 命名矩阵（硬性规范 3，新增标识不得偏离）

| 维度 | 值 |
| --- | --- |
| 包名 / 文件夹名 / 行 id / 设置命名空间 / locale 命名空间 | `dsh-task-board` |
| 设置路由 | `/api/dsh-task-board/settings` |
| 权限预设路由 | `/api/dsh-task-board/permissions` |
| 公告 section | `plugin:dsh-task-board`（order 200） |
| 设置卡 slot id | `dsh-task-board`（`settings.plugin.item`，order 110） |
| localStorage 数据键 | `dsh.taskBoard.v1`（**不得改名**，用户数据依赖） |

挂载：`cordis.patch.yml` 声明 `dsh.bundle.patch`，安装命令
`dsh plugin --profile web add link:<本目录>`。

## 架构（细节以代码为准，只列职责与入口）

### host 半区（DSH 主进程）

- `src/index.ts`：`inject = ['webServer','systemPrompt','settings']`；注册设置命名空间
  （settings.yaml 持久化）并联动公告；注册设置/权限路由；`sync()` 按
  `enabled`/`announceToAgent` 注册/撤销 systemPrompt section。
- `src/host/*-route.ts`：纯 `create*Handler`（settings/permission/attachment/
  session-state），可注入测试；服务读取一律 `ctx.get`；权限选项**不写死**——实时读
  原生 `permissionPresets` 服务，未挂载则 available:false，DSH 更新预设表自动适配。

### client 半区（浏览器）

- `src/client/index.ts`：`inject = ['slots','sessions','workspaces','connection','locale']`；
  设置卡（settings.plugin.item）+ `RouteSettingsScope` 快照（失败降级不抛）+ `syncEnabled`
  门控；接线 `BoardController` + `ExecutionService` + `SchedulerService`（localStorage 存储）。
- 挂载（无官方槽位，DOM 级，失败 console.error 不抛）：侧边栏入口与看板视图，均
  MutationObserver 自愈重插；`html[data-dsh-taskboard-active]` 显隐，对话子树保持挂载。

### 设计系统层（板上 UI 的宪法，改 UI 先读这里）

- **令牌只消费原生语义层**：样式只引用 `--dsw-*`（宿主按浅/深色与皮肤重映射，自动
  适配主题与未来皮肤，零独立皮肤）；**硬性：CSS 不得出现 hex/rgb 字面量**（verify
  审计为零）。板上经 `board.module.css` 顶部 `--dsh-tb-*` 别名层统一引用；侧栏入口与
  设置卡在 scope 外只用原生令牌。
- **表面三层（玻璃皮肤也照此）**：画布层（`--dsh-tb-glass`/`--dsh-tb-bg`）只用于板/列
  背景；所有内层浮起/下沉表面（卡片/对话/面板/评论/菜单，`--dsh-tb-surface-float/
  -sunken/-menu`）一律**不透明**（原生约定：玻璃皮肤下内表面保可读）。
- **面板几何（随板居中）**：`.modalBackdrop` 为看板盒内 absolute 定位，浮层由 flex 在
  其中居中——与侧栏宽度、祖先 transform/filter、皮肤效果完全解耦。
- **共用部件**（一律复用，不手写重复标记）：`ui.tsx`（Button primary/ghost/danger/
  **dangerGhost**（行内轻量危险）+ `size="sm"`（24px 胶囊）+ `pressed`、Section、
  Disclosure、Notice、AttentionDot、Icon、Switch）、`Chip`、`Dialog`、`PromptInput`、
  `TimeField`、`Markdown`（`markdown-parser.ts` 安全子集，**勿改回全局 `g` 正则**，
  此前 OOM 根因）、`SessionRow`（执行/链接单行骨架）、`CommentsThread`、
  `session-panel.tsx`（SessionRailHead/SessionTranscript/SessionConfigEditor/
  SessionFacts/SessionWaitingNotice）、`session-chip.ts`（**状态 chip 唯一文法**）、
  `cron-label.ts`（cron 文案唯一映射）、`automation-ui.tsx`（CronField/
  SessionRulesSection/SessionRuleForm/**AutomationEditor**/scheduleSummary——
  **自动化唯一 UI**）。
- **动效唯一语法**：注意力 = `--dsh-tb-attention` + `--dsh-tb-breath`（2.6s）；卡片外层
  呼吸环 `dshTbBreathRing`、执行行内层柔晕（`.sessionRow::after` 光晕层，`data-glow`
  状态绑定、pause 而非 cancelled——永不闪烁）；`prefers-reduced-motion` 全部静态降级。
- **拖拽落点**：插入条 = `drop-position.ts`（`insertionGapOf`/`indicatorTopOf`，纯函数
  单测）+ 行/盒内 22px 底部留白（否则尾部槽被裁剪）；**拖拽自动滚动** =
  `drag-autoscroll.ts`（`edgeScrollStep` + `useDragAutoScroll`，滚动期间把根元素
  `scroll-behavior` 临时置为 auto——smooth 会与逐帧滚动打架）；成功落点 = 卡片自身
  FLIP 落位（`use-flip.ts` 结构驱动，`flipCandidatesOf` 单测）。
- **卡片永不穿模（板上任何内容的硬契约）**：① 卡片盒 `overflow: hidden` 硬剪辑地板；
  ② 所有 flex 子项 `min-width: 0` + 截断/换行链路（`cardTime` 可收缩、标题/描述
  `overflow-wrap: anywhere`）；③ 徽章两槽位文法——`Chip`：文字进 `.chipBody`
  （ellipsis）、前导图形进 `.chipLead`。`tests/card-contract.spec.ts`（CSS 契约 +
  中英文案）钉死。
- **UI 小规则**：一个语义强调色（`--dsh-tb-accent`）+ 四个状态色（attention/success/
  danger/neutral），全令牌；半透明用 `color-mix(in srgb, 令牌 alpha%, transparent)`，
  alpha 22%/10% 两级；4px 节奏、圆角 8/12/16/24；字号：标题 13-14 + 负字距、正文
  13-14、元信息 12（同排不混字号）；交互 `--dsh-tb-motion`(160ms)；hover
  `--dsh-tb-hover`；focus 2px outline（`:focus-visible`，裸按钮也要纳入）；
  **同一排控件同级高**（按钮 28px / `buttonSm` 24px / 分段控件轨道=28px）。

### 核心层（`src/core/` 纯逻辑 + 关键职责；细节以代码为准）

- `tasks.ts`（状态机/plainRunsOf/COLUMNS/latestExecutionOf/chainUnlimited/
  taskColumnAllowsAutomation）· `schedule.ts`（cron）· `scheduler.ts`（每分钟 tick +
  cruiseTick）· `cruise.ts`（巡航窗口 v3）· `presets.ts`（schedule 预设）·
  `automation.ts`（会话规则 + automationRowsOf 单一投影 + 就绪语义 +
  automationTasksOf）· `colors.ts`（PALETTE + withTaskColor，标签已删仅留颜色）·
  `session-activity.ts`（原生侧对账 + `latestUserMessage`）· `session-list.ts`
  （taskSessionsOf 去重/优先级/隐藏/永久移除 + orderedSessionsOf 手动序 +
  sessionWindowOf）· `session-display.ts`（waiting>running>settled + viewedAt 基线）·
  `linked-sessions.ts`（deriveLinkedSessions）· `comment-thread.ts`（会话线程 + 排队位
  次 + latestCommentView）· `question-rpc.ts`（原生问答 wire 模型）· `store.ts`
  （ledger 持久化 + 老数据结构归一化）· `execution.ts`（投递与结算）·
  `controller.ts`（台账 + 统一并发调度器）。

### 关键不变量（避免重造已有机制；改前先读对应文件）

- **统一会话与评论单轨**：相同会话 = 同一条线程（`sessionCommentsOf`）；直发/驱动/
  评论并轨为一种留言；发送两态 = 排队（经调度器/巡航/FIFO，可取消）与插话
  （`steerComment` 立即送达）；图片走 `AttachmentStrip` → host 附件桥 → prompt part。
- **原生交互卡（评论区即答）**：agent 挂起时 `InteractionCard` 实时弹出；**回答只走
  原生 mux 通道**（`connection.api.respond({rpcId, result})`），普通留言不解决挂起的
  ask_user_question。to-do 读**官方 `todos` projection**（`pickProjections` 从历史尾页
  `Partial<SessionProjectionMap>` 结构读取——与自带 TodoPanel 同一宿主折叠源，宿主升级
  自动跟随；投影缺席降级事件解析）；goal/子代理走 `/api/dsh-task-board/session-state`
  桥（缺面即降级）。`SessionContextBlock` 为**浮层**（头部一行 + chevron 默认折叠；
  展开是 rail 内 absolute 面板，45vh 独立滚动、外点关闭），有则全有、无则全无。
- **原生侧同步**：原生会话直接发言 → 观察 running 翻转补记**外源轮**（不排队/不注入）；
  主动添加（拖入源）立即「进行中」+ 未读呼吸，跑完落「待审核」，空闲不虚构、同源幂等；
  页面加载被动观察不补历史。**外源轮正文 = `latestUserMessage`（最新一条 user 消息即
  真相，绝不回退旧消息；纯图片 → `imageOnly` 占位）**。
- **多源绑定（拖入 = 添加，绝不刷新替代）**：`TaskRecord.binds: TaskBind[]` 是真相源；
  所有读者走 `taskBindsOf(task)` 投影；`copyTask` 不复制 binds（模板语义）。
  **隐藏托盘「删除」= 从任务移除**（`removedSessions`，清记录/隐藏史/手动序槽位）；
  **显式拖回（会话或工作区）可恢复**——`addTaskSource` 清 removed，被动派生绝不复活。
- **完成态留言自动移回「待办」并驱动**（`reviveTaskIfDone`，queue/steer 同规则）；任务
  自动化在 done 列暂停（`ruleReadiness` 显示原因），移回自动恢复。
- **卡片 = 纯状态摘要**：标题/描述/来源行（`cardSourceLabel` 单一推导）/更新时间/状态
  与自动化 chips；运行窗口与评论时间线只归详情页；**视觉对齐**：卡片色点在标题行固定
  15px 槽内（`cardColorMark` absolute，标题/摘录/元信息同一列）、`cardColorMark` 5px
  顶距、板头/列头圆点 `translateY(-0.5px)`；**选中态**：`.card.selectedCard:hover`
  必须覆盖 hover（同特异性会被 `.card:hover` 压掉——光标在卡上就看不到选中光环），
  accent 双环 + 上浮 + 右上对勾徽章 + 120ms 入场。
- **会话列表**：`orderedSessionsOf`（`sessionsOrder` 全量手动序；数组外新会话置顶——
  默认规则不变，除非用户拖过）；板列与详情共用 `drop-position.ts` 插入条；详情列表
  拖拽用 `useDragAutoScroll`（滚动根 = `.detailBody`）。
- **稳定性**：受控组件本地回退；composer 之上可滚动中区；就近 inline 反馈；订阅/轮询
  必带终止路径；正文永不省略（break-word），元信息可 ellipsis+title；正文禁用固定高 +
  overflow hidden 裁字。

## 构建与验证（改完必跑，全绿才算完成）

```sh
pnpm install     # 依赖变化后
pnpm build       # tsc -p tsconfig.build.json && tsdown → lib/index.js + lib/client.js
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm verify      # node scripts/verify-standalone.mjs . dsh-task-board
```

生效规则：改 host 半区（src/index.ts、src/host/）需重启 `dsh web`；改 client 半区
刷新页面即可。

## 硬性规范

1. **禁 emoji**：代码、注释、文案、文档、提交信息一律不得出现 emoji 字符。
2. **仅官方 NPM SDK**：类型/运行时 API 只来自 `@deepseek-ai/*`（devDependencies）；
   **禁止修改 DSH 源码**；tsconfig 不得 `extends`/`paths` 指向 DSH 源码 checkout
   或任何外部目录。
3. **命名一致性**：见命名矩阵；不得引入新前缀/新命名空间。
4. **零历史残留**：项目内不得出现任何历史仓库标识、路径或来源表述；
   `scripts/verify-standalone.mjs` 内置防回归黑名单（其自身文件豁免）。
5. **数据键稳定**：`dsh.taskBoard.v1` 不得改名。
6. **生命周期纪律**：订阅/监听/定时器/observer 全部注册 disposer；DOM 失败
   console.error 不抛；`ctx.effect` 内创建的资源随 effect 清理。
7. **独立自包含**：运行时依赖仅 `schemastery`（host Config schema）；不依赖兄弟
   插件；DOM 挂载标记由本插件自打（如 layout 自 stamp `data-dsh-frame`），不依赖
   外部垫片。
8. **不引入新依赖**：新增依赖需先在对话中说明理由并经确认。
9. **从机制上解决问题**：遇到新情况先按「行事总纲」的意图与边界推理，而不是等待
   规则增补或把特殊处理写死进代码；当真实的新场景反复出现时，按「本文件的定位与
   编辑规则」更新本文，而不是增加一次性补丁条款。

## 测试（布局约定）

- **一个 src 模块一个 spec；契约按表面/域分组**（review 页纯逻辑 / card 契约 / host
  路由 / 拖拽几何 drag-contract / 端到端 controller）；**新增逻辑即配测试**——测试是
  契约，不是附件；不要随手加文件，先归入对应域的现有 spec。
- 清单：`tests/` 下 `tasks`、`schedule`、`scheduler`、`cruise`、`automation`、
  `presets`、`store`、`execution`、`session-activity`、`session-list`、
  `session-display`、`linked-sessions`、`question-rpc`、`refine`、`format-time`
  （核心纯逻辑）；`drag-contract`（drop-position + drag-autoscroll）、`flip`、
  `comment-thread`、`markdown`、`slash-token`、`drafts`、`sidebar-drag`、
  `review-page`（review-transcript/context-meter/menu-direction/interaction 合并）、
  `card-contract`（card-layout + card-label 合并）、`settings-route`、
  `permission-route`、`attachment-route`、`session-state-route`（host 路由，同一
  惯用法各占一个）、`route-scope`（client 设置 scope）、`controller`（端到端，
  唯一大文件——共享 harness 不拆分）。

## 版本管理流程（必守）

本项目使用本地 git 仓库做版本管理（无远程；用户不用掌握 git，由 agent 代为执行）。

- **修改前**：`git status` 确认工作区状态；如有未提交改动先 `git add -A && git commit`
  存一个「改前存档点」。
- **修改后**：build/typecheck/test/verify 全绿后 `git add -A && git commit`，提交信息
  简短说明本次改动（中文或英文均可，禁止 emoji）。
- **回滚**：用户要求「回到上一个版本 / 撤销改动」时——未提交的改动用
  `git checkout -- <file>` 丢弃；已提交的用 `git log --oneline` 定位存档点后
  `git reset --hard <commit>`（执行前确认工作区无未提交的重要改动，并向用户说明影响）。
- 不提交：`node_modules/`、`lib/`（已在 .gitignore 忽略）。
