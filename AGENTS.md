# dsh-task-board — 项目说明（会话自动注入）

本文件在每次会话开始时自动注入上下文。它是本项目与 AI 之间的接口契约，是项目的
唯一权威约定；任何修改必须遵守本文，并以「构建 + 测试 + 自检」全绿为完成标准。

## 行事总纲（最高准则，优先于一切具体方法）

做任何事，先想清楚「根本」在哪里，再动手。追求一次解决一类问题，而不是反复处理
同一个问题的表象；追求整体清晰、可维护、可演进，而不是越堆越乱。这是所有行动的
最高准则，本文的一切方法都是它的落地方式。

### 四条准则

- **治本，不治标**：遇到问题先找根因，想清楚「怎样才算真正解决」再动手；修一次，
  就要让这一类问题不再复发——只把表面压下去，不算解决；
- **写原则，不写死**：能归为通则的，绝不写成个案特例；能用结构和机制表达的，
  绝不靠写死的细节；不依赖特定细节的做法，环境怎么变都不会失效——通则即稳定；
- **融入结构，不打补丁**：任何新增（能力、规则、流程、工具用法）都要找到它在整体
  中的位置并融入进去，而不是在边上再挂一块；同一个问题第二次出现，说明上次治的
  是标，回头治根；
- **保持清朗，不堆屎山**：所有产物——方案、清单、目录、文件、流程、代码——都要
  结构清晰、职责分明、可维护可演进；宁可多想一步，也不留下一堆难以理解、难以
  修改的堆积物。

### 动手前三问（适用于任何任务）

1. 我这是在治标，还是在治本？
2. 这个做法能覆盖一类问题，还是只覆盖眼前这一个？
3. 做完之后，整体是更清晰了，还是更臃肿了？

任务编排、搜索调研、文件整理……一切具体方法，都是这条总纲的落地方式。

## 本文件的定位与编辑规则

**本文件是活的**：它随项目演进被更新、增删、重构，不是一份永不变化的快照。
会话中若发现本文与代码现状不一致，以「本文意图 + 代码现状」为准，并按下面规则修正本文。

**AI 有权编辑本文件**。出现以下情况时，AI 应直接更新本文件（并提交到 git），
而不是绕过它、只做口头约定、或把特殊处理写死进代码：

- 规则过时或与代码行为不符；
- 用户要求调整项目约定；
- 发现本文无法覆盖的新场景，且该场景会反复出现；
- 本文表述不清、导致理解歧义。

**编辑本文件的小规矩**：

- 面向 AI 阅读：专业、准确、可执行；不写面向终端用户的科普内容（用户要求大白话时，
  在对话中解释，不写进本文件）。
- 与代码一致：修改项目行为后，若本文描述失准，须同步修正；发现过时描述应主动更新。
- 写意图不写快照：优先表达「为什么」与「边界」，让未来会话能推理到未覆盖的情形；
  避免堆砌一次性补丁式的例外条款，避免记录无意义的日期/版本号。
- 精炼：不重复、不冗余；结构清晰（标题层级 / 表格 / 代码块）。
- 遵守项目硬性规范（禁 emoji 等）；涉及用户可见能力或命令变化时，同步更新 README。

**文档同步**：README 面向人（能力 / 安装 / 使用 / 命令），本文件面向 AI（机制 / 规范 /
流程），两者描述同一项目。AI 修改项目或本文件后，应检查 README 是否仍准确，
不匹配时同步更新并提交。

## 任务编排方法论（通用能力，适用于每一次交互）

### 一、核心能力

熟练掌握任务编排的整套工具——任务清单（to-do）、长期目标（goal）、行动计划（plan）、
流程编排（workflow）与子代理（sub-agent）调度。清楚它们各自的适用场景，更关键的是
懂得它们可以像拼图一样自由组合：同一个任务里，各工具可以各管一段，没有固定的先后
顺序，也没有「一个任务只能选一种」的限制。价值不在于「会用工具」，而在于「看清任务
结构，为每一块配装最合适的工具」：清单防遗漏，目标保持久，方案促对齐，并行提速度。

### 二、任务拆解：看清结构，动态配装

工具的选用不按「任务大小」划一档，而是按「任务结构」逐块配装——同一个任务里可以
同时用到 plan、to-do、goal、子代理、workflow，各管一段。各工具的调用方式由会话自动
注入说明，此处只讲「怎么配」。

（一）**先拆结构**。拿到任务先做一次轻量拆解，从常见维度看清它的结构——有哪些块
（步骤、阶段、子目标）、块与块是什么关系（先后、并行、可独立）、整体要多久
（一次性还是跨轮次）。这些只是常见维度，凡影响配装的方面都可以纳入，不限于此。

（二）**再配工具**。给每一块按它的性质配工具，规则只有几条，覆盖所有情况：

- 执行需要骨架 → 用 to-do 记录并逐项更新（多步任务的通用骨架，块无论大小）；
- 方向不明、影响大或不可逆 → 先出 plan 与用户对齐，或先问清再动手；
- 块可独立完成 → 交给子代理后台执行，回来自己验收整合；
- 大量同构的独立块 → 用 workflow 一次性批量编排；
- 要跨轮次、长期推进 → 立 goal 跟踪，不靠记忆；
- 有耗时步骤（长命令、批处理、长抓取）→ 放后台跑，不阻塞主线。

以上是常见性质；遇到规则没覆盖的性质，按同一思路判断——看清这块需要什么就配什么，
拿不准就先问用户。

（三）**动态组合**。以上规则按实际结构自由拼装：几块就配几套，一块也能配多套；没有
「一个任务只能选一种」的约束，也没有「必须从哪一步开始」的顺序。常见拼法仅示意，
按任务结构随意增减、重排：

- 复杂项目 = plan 对齐方向 → to-do 拆执行 → 独立部分子代理并行 → goal 跟踪长尾；
- 研究调研 = 拆问题 → 多路并行检索 → 抓取全文 → 交叉验证 → 结构化汇报；
- 长线事务 = goal 立目标 → 每轮 to-do 推进 → 阶段汇报；
- 一次性小事 = 直接做，不套任何工具。

### 三、编排心法（引导话术）

- 「先想结构，再动手」：复杂任务到手，先问三个问题——要拆成几块？哪些块能并行？
  哪些块有先后依赖？想清楚结构再开始。
- 「工具是拼图，不是阶梯」：同一个任务里可以多个工具各管一段，不必层层递进，也
  不必从头到尾只用一种。
- 「小事快办，大事立纲」：单步的事直接做；多步的事先建清单；说不清步骤的事先出
  方案与用户对齐。
- 「能并行的绝不串行」：相互独立的子任务同时推进，不要一件一件排队等。
- 「能委托的绝不自己扛」：独立、自包含的子任务交给子代理后台执行，自己专注协调、
  整合与把关。
- 「指令是它的整个世界」：子代理没有上下文和记忆，你写进指令的才是它知道的——
  背景、目标、边界、交付物一次说清，让它无需追问即可独立完成；结果回来后自己
  检查整合。
- 「长期的事交给目标，不靠记忆」：需要跨多轮持续推进的事立 goal 跟踪；用户说
  「继续」时，先确认目标状态，再接着干。
- 「结构变了就重新配装」：任务推进中出现新块、新依赖或时长变化，回到拆解重新配
  工具，不硬走原方案。
- 「边做边同步」：完成一项更新一项清单，进度主动汇报；任务收尾按「做了什么 /
  结果如何 / 下一步建议」汇报。
- 「不确定先问」：用户意图、可选方向或关键取舍不明时，用一句话问清再定打法。

执行节奏是循环的，不是一步到位：拆解 → 配装 → 推进 → 汇报，过程中随时回到拆解
重新配装。

### 四、协作纪律

- 不杀鸡用牛刀：能直接完成的事不套编排工具，工具是为复杂度服务的；
- 不套固定模板：配装跟着任务结构走，不按固定流程或固定顺序硬套，上次的打法对
  下次任务只是参考；
- 不列而不更：建了清单就要逐项更新状态，清单是给用户的进度表；
- 不闷头大干：任务开始先说清思路，重要节点主动汇报，不擅自扩大范围；
- 不编造用法：工具的具体参数与调用方式以会话中注入的说明为准，拿不准就先读说明
  或问用户。

### 五、委托的指令：让子代理一次到位

子代理没有上下文，也没有记忆：它不知道你是谁、前面发生过什么、用户要什么——它
知道的全部，就是你写进指令里的内容。指令是它的整个世界，指令里没有的东西它只能
猜，一猜就会漂移。所以委托的本质是：把「想清楚」放在动笔之前。workflow 编排的
每一个 worker 也是如此——每份 prompt 都必须自包含。

动笔前先换位：把自己放进子代理的位置，问自己「拿到这段指令后，我还会想问什么、
还会猜什么、还会自作主张什么？」——凡是你觉得它会问、会猜、会擅自发挥的地方，
都要写进指令。常见维度包括：背景（为什么做、已知什么、必须遵守的约束）、交付
（交什么、怎样算完成、如何验收）、边界（不能碰什么、什么要原样保留）、卡住时
怎么办（停下汇报还是按默认继续）——但不止这些：产出格式、输出语言、时间与优先级、
依赖与假设、风格与语气……凡是它不知道而需要知道的，都是指令的一部分。

写完后做一次「隔离检验」：假设这个子代理没有任何其他信息，只凭这段指令，能不能
不问问题就独立完成？哪一条会让它猜，就补哪一条。

防漂移要点：

- 关键事实写进指令，不指望它「应该知道」；
- 给明确的完成定义和产出格式，让它交回的东西可以直接验收、直接整合；
- 给歧义的处理方式：宁可停下来问，也不要擅自发挥；
- 并行委托时，任何一份指令都不许依赖另一份的内容——每份都要自足。

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

- `src/index.ts`：`inject = ['webServer','systemPrompt','settings']`；注册设置命名空间（settings.yaml 持久化）并联动公告；注册设置/权限路由；`sync()` 按 `enabled`/`announceToAgent` 注册/撤销 systemPrompt section。
- `src/host/*-route.ts`：纯 `create*Handler`（settings/permission/attachment/session-state），可注入测试；服务读取一律 `ctx.get`；权限选项实时读原生 `permissionPresets` 服务（未挂载则 available:false，随 DSH 预设表自动适配）。

### client 半区（浏览器）

- `src/client/index.ts`：`inject = ['slots','sessions','workspaces','connection','locale']`；设置卡（settings.plugin.item）+ `RouteSettingsScope` 快照（失败降级不抛）+ `syncEnabled` 门控；接线 `BoardController` + `ExecutionService` + `SchedulerService`（localStorage 存储）。
- 挂载（无官方槽位，DOM 级，失败 console.error 不抛）：侧边栏入口与看板视图，MutationObserver 自愈重插；`html[data-dsh-taskboard-active]` 显隐，对话子树保持挂载。

### 设计系统层（板上 UI 的宪法，改 UI 先读这里）

- **令牌只消费原生语义层**：样式只引用 `--dsw-*`（宿主按浅/深色与皮肤重映射）；**硬性：CSS 不得出现 hex/rgb 字面量**（verify 审计为零）。板上经 `board.module.css` 顶部 `--dsh-tb-*` 别名层统一引用；侧栏入口与设置卡在 scope 外只用原生令牌。
- **表面三层（玻璃皮肤也照此）**：画布层（`--dsh-tb-glass`/`--dsh-tb-bg`）只用于板/列背景；所有内层浮起/下沉表面（卡片/对话/面板/评论/菜单）一律**不透明**（玻璃皮肤下内表面保可读）。
- **面板几何（随板居中）**：`.modalBackdrop` 为看板盒内 absolute 定位，浮层由 flex 在其中居中（与侧栏/祖先 transform/皮肤解耦）。**嵌套浮层（弹窗内的弹窗/确认框）必须 `portal` 到看板盒**（`Dialog` 的 `portal`；`ConfirmDialog` 恒真；`PresetManager`/`RunPresetManager` 亦然）——内层留在外层弹窗 DOM 会被外层 `.modal`（position:relative + overflow:hidden）锚定并裁剪（「被限死/被截住」根因）。**每个弹窗正文必须是 `.modalScroll` 唯一滚动体**（NewTaskModal/ConfirmDialog/PresetManager/RunPresetManager/AutomationPanel——超高内部滚动，底部按钮永远可达；正文裸露堆叠即「底部被截」根因）；`.dialogHeader` 分隔线之下由滚动体 14px 内边距留出呼吸空间，内容绝不紧贴分隔线。
- **共用部件**（一律复用，不手写重复标记）：`ui.tsx`（Button primary/ghost/danger/**dangerGhost**+`size="sm"`+`pressed`、Section、Disclosure、Notice、AttentionDot、Icon、Switch）、`Chip`、`Dialog`、`PromptInput`、`TimeField`、`Markdown`（`markdown-parser.ts` 安全子集，**勿改回全局 `g` 正则**，此前 OOM 根因）、`SessionRow`、`CommentsThread`、`session-panel.tsx`（SessionRailHead/SessionTranscript/SessionConfigEditor/SessionFacts/SessionWaitingNotice）、`session-chip.ts`（**状态 chip 唯一文法**）、`cron-label.ts`（cron 文案唯一映射）、`automation-ui.tsx`（CronField/SessionRulesSection/SessionRuleForm/**AutomationEditor**/scheduleSummary——**自动化唯一 UI**）。
- **动效唯一语法**：注意力 = `--dsh-tb-attention` + `--dsh-tb-breath`（2.6s）；卡片外层呼吸环 `dshTbBreathRing`（`.card[data-unviewed]`/`.card[data-active]`）、执行行内层柔晕（`.sessionRow::after`，`data-glow` 绑定、pause 而非 cancelled——永不闪烁）；`prefers-reduced-motion` 全部静态降级。
- **光效规则表（呼吸显示与否的唯一判定，无例外）**：

  | 任务状态 | 卡片 | 会话行 |
  | --- | --- | --- |
  | 等待（处理/计划确认/提问） | 呼吸（waiting） | 呼吸（waiting） |
  | 进行中（板内/外源/续跑） | 呼吸（running） | 呼吸（running） |
  | 完善中 | 呼吸（refining） | 无 |
  | 已结束且未读 | 呼吸（未读） | 呼吸（未读） |
  | 已读已结束 / 空闲 | 静默 | 静默 |

  「进行中」只由状态驱动、与未读无关（`TaskCard` `data-active` = running/待回应/完善中）。已结束未读呼吸各自单基线清除（`markExecutionViewed`/详情打开清 `task.viewedAt`/`settleRefine` 自清）。外源轮从观察起视为 open（`sessionDisplay` 含 `external === true`）并计入会话轮次集。
- **拖拽落点**：插入条 = `drop-position.ts`（`insertionGapOf`/`indicatorTopOf`，纯函数单测）+ 行/盒内 22px 底部留白（否则尾部槽被裁剪）；**拖拽自动滚动** = `drag-autoscroll.ts`（滚动期间根元素 `scroll-behavior` 临时置 auto——smooth 与逐帧滚动打架）；成功落点 = FLIP 落位（`use-flip.ts`，`flipCandidatesOf` 单测）。
- **卡片永不穿模（板上任何内容的硬契约）**：① 卡片盒 `overflow: hidden` 硬剪辑地板；② 所有 flex 子项 `min-width: 0` + 截断/换行链路（`cardTime` 可收缩、标题/描述 `overflow-wrap: anywhere`）；③ 徽章两槽位文法——`Chip`：文字进 `.chipBody`（ellipsis）、前导图形进 `.chipLead`。`tests/card-contract.spec.ts` 钉死。
- **UI 小规则**：一个语义强调色（`--dsh-tb-accent`）+ 四个状态色（attention/success/danger/neutral），全令牌；半透明 `color-mix(in srgb, 令牌 alpha%, transparent)`，alpha 22%/10% 两级；4px 节奏、圆角 8/12/16/24；字号：标题 13-14 + 负字距、正文 13-14、元信息 12（同排不混字号）；交互 `--dsh-tb-motion`(160ms)；hover `--dsh-tb-hover`；focus 2px outline（`:focus-visible`，裸按钮也要纳入）；**同一排控件同级高**（按钮 28px / `buttonSm` 24px / 分段轨道=28px）。

### 核心层（`src/core/` 纯逻辑 + 关键职责；细节以代码为准）

- `tasks.ts`（状态机/plainRunsOf/COLUMNS/latestExecutionOf/chainUnlimited/taskColumnAllowsAutomation）· `schedule.ts`（cron）· `scheduler.ts`（每分钟 tick + cruiseTick）· `cruise.ts`（巡航窗口 v4）· `presets.ts`（schedule 预设）· `automation.ts`（会话规则 + automationRowsOf + 就绪语义 + automationTasksOf）· `colors.ts`（PALETTE + withTaskColor）· `session-activity.ts`（原生侧对账 + `latestUserMessage`）· `session-list.ts`（taskSessionsOf/orderedSessionsOf/sessionWindowOf）· `session-display.ts`（waiting>running>settled + viewedAt 基线）· `linked-sessions.ts`（deriveLinkedSessions）· `comment-thread.ts`（会话线程 + 排队位次 + latestCommentView）· `question-rpc.ts`（原生问答 wire 模型）· `store.ts`（ledger 持久化 + 老数据归一化）· `execution.ts`（投递与结算）· `controller.ts`（台账 + 统一并发调度器）。

### 关键不变量（避免重造已有机制；改前先读对应文件）

- **统一会话与评论单轨**：相同会话 = 同一条线程（`sessionCommentsOf`）；直发/驱动/评论并轨为一种留言；发送两态 = 排队（调度器/巡航/FIFO，可取消）与插话（`steerComment` 立即送达）；图片走 `AttachmentStrip` → host 附件桥 → prompt part。
- **官方 @ 引用机制（唯一桥 = reference-source.ts）**：所有输入框（留言/完善回答/规则指令/执行 Prompt/交互卡回答）共用同一桥——与主界面 ui-reference 相同的两个 Remote 命名空间（`remote.fileReferences` + `remote.sessionReferenceResolver`，结构化读取，缺面降级为无 @ 菜单）。**官方身份政策（不可绕过，勿在代码里绕——属官方 api-remotes 政策，参见 README 能力边界）**：目标会话为「子代理路由会话」（`origin === 'subagent'` 或挂在活跃父代理下）时，宿主对一切通用 RPC（含两个引用命名空间）返回 `agent-busy`，官方 composer 同样不可用（官方语义：子代理会话请走子代理投递通道；无官方修复版本）。插入用**官方文法**：`file-reference-grammar.ts`（`activeAtToken` 引号 token + `formatFileMention`，官方包**逐字镜像**——打包门禁禁止跨插件值导入，镜像 + 契约测试钉死官方行为）与 `session-mention.ts`（官方会话引用编码逐字镜像：`dsh-session:` + base64url(JSON(id)) + label 转义）；会话候选插入官方规范 URI `@[label](dsh-session:…)`，host 在任意 user 消息的 agent/pre-step 自动解析为「引用会话」上下文——**板子只产出官方文本，解析全走官方链路**。`PromptInput` 以 `sessionId`（目标会话）为作用域：`referenceSessionOf`（refine→执行→绑定 → 当前会话 → 列表首项）是唯一解析；`@"` 引号路径内不弹会话候选（官方规则）；目录下钻靠开口引号延续。
  **失败契约**：`listReferenceRows` 永不 reject——两域各自独立解析（缺面/RPC 拒绝/`{ok:false}` envelope 只降级自身），行映射逐行守卫（坏行跳过，`diag.skipped`）；`createdAt` 按官方契约为 epoch 毫秒，缺失/非法只省略日期段（`safeCreatedAt`）。**官方 log-only 语义**（官方契约原文：source-failed = 静默移除该组 + log，无错误 UI 层）：失败原因只进 `diag` → console 一行，**菜单里绝无失败文案**；**唯一例外 = 会话域官方失败时**（网关对子代理托管目标会话 agent-busy 拒绝查找，官方与看板同败）**会话组无缝换为板内目录行**（`controller.referenceSessionCatalog()` + `catalogSessionRowsOf`：排除自身、上限 50、与官方同样式、插入文本为官方 mention）——**只降级「发现」，解析仍 100% 官方**。只有两域都成功且真无候选才显示 `prompt.noReferences`；效果链带兜底 catch（保留旧行，绝不留空菜单死等）。
  **@ 菜单三文法（纯函数定死）**：能力门 `referenceMenuAvailable`（缺目标会话或缺桥 = 不弹，与 / 缺 catalog 同一纪律）；空态文案 `prompt.noReferences` 专属（绝不借用 / 的「无匹配命令」）；插入后续开 `continueAfterPick`——只有目录下钻（`@"路径/`）才重开菜单，文件/会话/命令插入后一律静默（光标落在活 token 上盲重开是「无匹配命令」回归根因）。
- **原生交互卡（评论区即答）**：agent 挂起时 `InteractionCard` 实时弹出；**回答只走原生 mux 通道**（`connection.api.respond({rpcId, result})`），普通留言不解决挂起的 ask_user_question。to-do 读**官方 `todos` projection**（`pickProjections` 从历史尾页 `Partial<SessionProjectionMap>` 结构读取——与自带 TodoPanel 同一宿主折叠源，宿主升级自动跟随；投影缺席降级事件解析）；goal/子代理走 `/api/dsh-task-board/session-state` 桥（缺面即降级）。`SessionContextBlock` 为**浮层**（头部一行 + chevron 默认折叠；展开是 rail 内 absolute 面板，45vh 独立滚动、外点关闭），有则全有、无则全无。
- **上下文块（有未完成的才显示）**：`contextWorthOf(context)` 是唯一判定——todo 任一未 completed / `goal.active === true` / 子代理 status 缺失或不在 finished 集（inactive/finished/completed/done/settled）→ 值得显示；全部弄好才整块隐藏（已完成 todo 保留勾+划线；子代理 status 缺失保守视为进行中）。**桥读原生形状**（session-state-route，`listChildren` 异步 + 按父会话 id）：goal = `GoalView.{objective, phase}`（`phase === 'complete'` 即完成、不返回）；子代理 = `SubagentListEntry.{label, activity}`（只返回 `kind === 'child'` 且在跑的，`activity === 'inactive'` = 已结束）；旧实现的 `activeGoal`/`title/status` 读法错误且与原生不符——**永不回退**。
- **原生侧同步**：原生会话直接发言 → 观察 running 翻转补记**外源轮**（不排队/不注入）；主动添加（拖入源）立即「进行中」+ 未读呼吸，跑完落「待审核」，空闲不虚构、同源幂等；页面加载被动观察不补历史。**外源轮正文 = `latestUserMessage`（最新一条 user 消息即真相，绝不回退旧消息；纯图片 → `imageOnly` 占位）**。
- **多源绑定（拖入 = 添加，绝不刷新替代）**：`TaskRecord.binds: TaskBind[]` 是真相源；所有读者走 `taskBindsOf(task)` 投影；`copyTask` 不复制 binds 与会话规则（模板语义）。**隐藏托盘「删除」= 从任务移除**（`removedSessions`）；**显式拖回可恢复**——`addTaskSource` 清 removed，被动派生绝不复活。
- **完成态留言自动移回「待办」并驱动**（`reviveTaskIfDone`，queue/steer 同规则）。
- **真执行自动补全（缺则补、填则守、写入与发射点唯一）**：新建任务 标题/描述/执行 Prompt **全可空**（空 Prompt 只让任务惰性——真正运行/接续链被 `taskExecutable` 门禁拦截，创建不受限；未命名卡片显示 `card.untitled`）。**唯一作用点 = `supplementedTask`**：任务被写入（createTask/createBoundTask/updateTask）或真正启动（launchTask——手动/重复/接续链/定时/巡航/排队发射一切路径）时，空标题/描述从执行 Prompt 补齐（标题 = Prompt 第一非空行 trim + 40 上限；描述 = 整个 Prompt trim）；已存在字段**永不覆盖**；评论轮/完善轮/外源轮不是任务执行，不触发。
- **自动化两半互不干扰**：任务级 `schedule`（按时间表/完成后接续）与会话级 `rules`（指令内容 = 自定义指令或任务执行 Prompt（usePrompt，发送时取任务当前 Prompt，非快照）；触发 = 按时间表 cron 或每次完成 on-complete）字段正交、语义独立——关任务级 schedule 会话规则照常触发（controller 单测钉死）。两者共用 `AutomationEditor`（唯一 UI，板与详情一致）——编辑器内分「任务自动化」「会话规则」两个分区标题；**启用开关只在编辑器内（唯一一份）**——面板卡片 = 身份头 + 一行可展开摘要 + 展开体 = 共享编辑器原样；「按时间表/完成后接续」与规则「触发方式」「指令内容」共用 `Segmented` 分段文法。
  **on-complete 语义（完成后继续 = 永续循环）**：**任何一次完成结算**——普通执行、用户评论轮、外源轮——都触发（完善轮与规则自己的轮除外：前者是准备不是完成，后者的续跑是专属 fireLoopRule 钩子），不受列暂停约束；**所有结算路径共用同一条结算后约定**（`settledFollowUp`：live watch 的 handleExecutionEvent 与恢复/对账的 reconcileRunningTasks 都走它——页面刷新/冷会话/漏掉的列表翻转结算成的「完成」同样触发，这是「任务完成了一次却没有任何反应」的根治）。规则轮走**自动化车道**（ruleId 标记；`nextEligible` 的 ruleRound 优先、不受巡航开关约束、全局 FIFO + 预算注入；cron 排队轮与 on-complete 轮同走——**定时规则绝不等巡航**）；**每规则同时在途至多一轮**（fireRuleRound 守卫）。**规则自己的指令轮**（`ExecutionRecord.ruleId`）**成功**结算即再触发同一规则——一轮接一轮，直到关闭/删除/会话消失/内容不可用（usePrompt 规则要求任务 Prompt 非空）；失败/取消不续；用户手写评论（无 ruleId）永不触发。**显示真相**：on-complete 规则已启用但还没触发 = 「等待任务完成触发」chip；发送方式（排队/插话）只是模式标签、tooltip 声明，绝不误读成「排队中/正在跑」；编辑表单提示「先让任务完成一次（给会话留言/对话也算）」。**每会话至多一条规则**（`createSessionRule` 拒绝同会话第二条）；老数据（无 trigger/usePrompt）归一化为 cron + 自定义指令。
- **完成接续（链）语义**：武装即开跑（`setSchedule`：`enabled && chain && 可执行 && 无在途轮`，**任意列**，绝不等待手动重新执行）；每次**普通执行成功结算**瞬间接续下一轮（失败/取消/完善轮不接续；预算到顶自动解除武装）；**手动移动卡片（除 done）绝不解除武装**（链只在结算瞬间动作；「停止接续」用编辑器内按钮）；`done` = 硬停。`ruleReadiness` 链模式**跳过列暂停**（disabled → blocked → active），列暂停只属 cron 轮盘；调度器链恢复 tick 以「最新一轮已结算且未到预算」为条件。
- **巡航窗口 v4 文法**：**总开关主权**——`enabled` 是当前状态、用户点为主；窗口是计划表，只有「开始/结束时刻」越过时翻转开关；**增删窗口绝不动开关**（唯一例外：新增「只填结束」窗口，其开始时刻 = 创建时刻）——拔光窗口后手动开/关永远匹配。窗口 `{startAt?; endAt?}` 三态（都填=区间、只填开始=到点开并保持、只填结束=创建即开、到点关）；列表**自动排序**（立即开启→按开始→同开始按结束，开口的最后——`windowSortKeyOf`/`sortWindows`）；每窗口**一行文法**（`cruiseWindowGrammarOf` + `cruiseWindowLabelOf`：`[生效中 ·] 开始 → 次日 结束` / `{time} 起保持开启` / `已开启 · 至 {time}`，中英文案单测钉死，完整时刻走 tooltip）；**「次日」只用于结束为开始「紧邻后一日」**（`isNextDay` 按日历日 +1，跨月/跨年正确）——间隔多天按真实日期；**状态行永远一句话解释开关为什么是当前值**（`cruiseStatusLineOf`）。校验 = `windowRangeIssueOf`（归一化后判定）：双空/同时刻/结束早于开始超过一天（文案带实际天数与起止值，跨午夜只支持一晚）/开始已过/结束已过，各具专属内联提示；`normalizeWindow` 对非法范围绝不虚构次日。
- **校验反馈文法**：`inputInvalid` 是唯一错误边框（cron/select/PromptInput/数字共用）；会话规则表单按 会话→指令→Cron 顺序报**首个失败字段**专属文案（`auto.form.invalidSession/invalidInstruction/invalidCron`）；`saveFailed` 兜底「保存失败」。
- **卡片 = 纯状态摘要**：标题/描述/来源行（`cardSourceLabel` 单一推导）/更新时间/状态与自动化 chips；运行窗口与评论时间线只归详情页；**视觉对齐**：色点在标题行前（行内 8px 圆点 + 5px 顶距光学居中，标题随其后；元信息贴卡片内容边——**不要用「固定槽位/gutter」方案整体右移**）、板头/列头圆点 `translateY(-0.5px)`；**选中态**：`.card.selectedCard:hover` 必须覆盖 hover（同特异性被 `.card:hover` 压掉——光标在卡上看不到选中光环），accent 双环 + 上浮 + 右上对勾徽章 + 120ms 入场。
- **执行 Prompt 空 = 全链路阻断（执行专用）**：`taskExecutable(task)`（严格 `prompt.trim() !== ''`）是唯一判定；`ruleReadiness`（cron）与 `sessionRuleReadiness`（仅 usePrompt 规则）给 `{kind:'blocked'}`（次序 disabled → blocked → paused(列) → active；**链模式跳过列暂停、自定义指令会话规则永不因任务 Prompt 为空而 blocked**）；`runTask` 单点拦截手动/快速/重新执行/拖拽重跑/定时/巡航/接续链，**「完成后接续」武装**在 `enabled && chain && !taskExecutable` 时直接拒绝（不持久化——编辑器显示 `detail.promptEmpty`，绝不出现假死武装）；**评论与插话永不被 Prompt 门禁**（composer 只在会话消失时禁用——发送灰 bug 根因）；**例外（不封）**：需求完善流程、mux 交互卡回答、在途开轮续评、绑定会话被动观察。
- **运行配置预设（自定义 + 默认应用）**：`src/core/run-presets.ts`（键 `dsh.taskBoard.runPresets.v1`）；内置不可删 `deploy-default`（空配置 = 部署原生默认）；**默认回退链** = `defaultRunPresetOf`（defaultId 缺失/悬挂/被删 → 一律「部署默认」）；UI 唯一 = `TaskForm` 的「配置预设」行 + `RunPresetManager`（添加/编辑 = 名称 + RunConfigEditor 同字段自编辑，新建以当前表单配置为起点、删除、设为默认），新建任务 `initialDraft` 应用默认预设（草稿优先）。
- **交互卡/rail 永不横向爆框、纵向不挤**：rail 的 flex 子项全部 `min-width: 0`；行内按钮组可换行（`.interactionActions` flex-wrap）；卡片 `margin: 0 14px`。**高度契约**：`.interactionCard` `max-height: min(320px, 40vh)` + `overflow: hidden`，正文在 `.interactionCardBody`（`overflow-y: auto; min-height: 0`）内滚动，**动作行钉在卡外永远可见**（长计划挤压 bug 根因）；`.reviewRail` `overflow: hidden`；`SessionRail` 交互卡位于 `.sessionRailScroll`（评论 + 卡同一滚动区，贴底自动跟随），composer 钉在 rail 底部。合同由 `review-page.spec.ts` CSS 契约钉死。
- **会话列表**：`orderedSessionsOf`（`sessionsOrder` 全量手动序；数组外新会话置顶——默认规则不变，除非用户拖过）；板列与详情共用 `drop-position.ts` 插入条；详情列表拖拽用 `useDragAutoScroll`（滚动根 = `.detailBody`）。**行文法（执行/链接统一 `SessionRow` 骨架 + `sessionStateChip` 唯一状态推导）**：已有轮次的会话 = 行标题 + 状态 chip；执行行命名执行结果（已完成/已取消），链接行命名会话活动（已完成/未运行——「未运行」带 `detail.idleHint` 悬浮说明）；行首 = 类型图标 + 会话标题 + **可选工作区标签**（执行行取任务工作区、链接行取会话自身；与标题相同则省略）。**.sessionList 不容忍底部死区**：久置列表 `padding: 0`（最后一行 hover 覆盖整行），只有 `.sessionList[data-reordering]` 期间底部呼吸 14px 给尾部插入槽。
- **稳定性**：受控组件本地回退；composer 之上可滚动中区；就近 inline 反馈；订阅/轮询必带终止路径；正文永不省略（break-word），元信息可 ellipsis+title；正文禁用固定高 + overflow hidden 裁字。

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
  `comment-thread`、`markdown`、`slash-token`、`reference-source`（官方 @ 引用桥）、
  `file-reference-grammar`（官方文法镜像契约）、`drafts`、`sidebar-drag`、
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
