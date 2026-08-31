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

### 工程落地纪律（改代码与新增能力时的具体法则）

- **简单成熟，不造轮子**：优先选简单、成熟、被验证过的方案；动手前先问
  「已有的能不能用」，避免过度设计、重复造轮子；
- **先看再动**：修改或新增前，先检查项目现有代码、依赖与文档，摸清现状
  与既有约定，再动手；
- **最小可用，增量扩展**：从最小可用版本起步，按真实需要逐步扩展，不为
  未来需求提前叠加复杂度；
- **模块清晰，职责单一，复用已有**：模块边界清晰、职责单一；优先复用
  已有能力，能并入现成的就不另起炉灶；
- **为长期维护决策**：架构决策考虑长期维护成本，避免只解决眼前问题的
  临时方案——今天的临时补丁，是明天要还的债；
- **小改动，保稳定**：修改前先理解现有实现，尽量小范围改动，确保已有
  功能稳定；能少动就不多动。

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
真实执行 + 5 段 cron 定时调度。**看板数据持久化在 DSH host 端（存储单元 `dsh_task_board`），
任意设备/浏览器（桌面 + 手机，跨 origin）经 SSE 实时同步看到的是同一块板；窄屏为紧凑布局。**
单一 npm 包，cordis 插件，host/client 双半区，MIT 许可，全新独立项目（零历史仓库引用）。

### 命名矩阵（硬性规范 3，新增标识不得偏离）

| 维度 | 值 |
| --- | --- |
| 包名 / 文件夹名 / 行 id / 设置命名空间 / locale 命名空间 | `dsh-task-board` |
| 设置路由 | `/api/dsh-task-board/settings` |
| 权限预设路由 | `/api/dsh-task-board/permissions` |
| 看板数据路由（前缀） | `/api/dsh-task-board/board`（`/lease` `/command` `/events` SSE 子路径） |
| host 存储单元名（storage hub json 后端） | `dsh_task_board`（落 `~/.dsh/storages/dsh_task_board.json`；平台 `UNIT_NAME_RE` 只允许 `^[a-z][a-z0-9_]*$`，**不能含连字符**） |
| 公告 section | `plugin:dsh-task-board`（order 200） |
| 设置卡 slot id | `dsh-task-board`（`settings.plugin.item`，order 110） |
| localStorage 键（现为离线镜像 + 草稿 + 备份） | `dsh.taskBoard.v1` 等（**不得改名**，见「数据键稳定」） |

挂载：`cordis.patch.yml` 声明 `dsh.bundle.patch`，安装命令
`dsh plugin --profile web add link:<本目录>`。

## 架构（细节以代码为准，只列职责与入口）

### host 半区（DSH 主进程）

- `src/index.ts`：`inject = ['webServer','systemPrompt','settings']`；注册设置命名空间（settings.yaml 持久化）、设置/权限/看板/会话状态路由，公告与 systemPrompt section 随开关联动。**没有图片路由**：图片走官方 prompt 字节 part（见「统一会话与评论单轨」），板子不自建上传通道。
- `src/host/*-route.ts`：纯 `create*Handler`，可注入测试；服务读取一律 `ctx.get`；权限选项实时读原生 `permissionPresets` 服务（未挂载则 available:false，随 DSH 预设表自动适配）。
- `src/host/board-service.ts` + `board-route.ts`：**看板数据真相服务**——host 持有整份 `BoardDoc`（tasks + cruise + schedulePresets + runPresets + tombstones + stamps + revision），经 storage hub 的 json 后端 `KvUnit`（单元名见命名矩阵）持久化；写链串行、`applyCommit` 合并、**先落盘后应答**再 SSE 广播。路由（前缀 `/api/dsh-task-board/board`）：GET 文档（`?since` 短路 unchanged；**无 since 参数必须回全文档**——初始 fetch 靠它）、POST commit、POST `/lease`（引擎租约）、POST `/command`（发射中继）、GET `/events`（SSE：commit/lease/command 帧 + keep-alive）。storage hub 缺席 → available:false → 客户端整体退回 localStorage 模式（功能不降级为错误）。`tests/board-http.spec.ts` 用真实存储后端 + 真实 http.Server + 真实 SSE 覆盖这条链。

### client 半区（浏览器）

- `src/client/index.ts`：`inject = ['slots','sessions','workspaces','connection','locale']`；设置卡 + `RouteSettingsScope` 快照（失败降级不抛）。挂载流程：`await sync.start()`（迁移探测 + 首次租约）→ 按模式选存储（同步态 `Synced*Store` over host，回退态 `LocalStorage*Store`）→ 接线 `BoardController` + `ExecutionService` + `SchedulerService`；`sync.onRemote → controller.applyRemote + writeMirror`、`onEngine(held) → controller.setHostProto(hostProtoVersion()?)/setEngine(held)`（席位 = (held, proto) 元组，见「多端同步」）、`onCommand → controller.runTask`；调度器 `ready()` 并联 `sync.isEngine()`。
- `src/client/board-transport.ts`：`BoardSyncTransport` 浏览器实现（fetch 四调 + EventSource；EventSource 缺席降级纯轮询，仍收敛）。
- `src/client/board-mount.tsx`：板视图 DOM 级挂进中列（`[data-dsh-taskboard-view]` 容器 + 键盘内缩 watcher；`html[data-dsh-taskboard-active]` 显隐，对话子树保持挂载）。侧栏在启动稳定窗内始终不出现时挂**浮动角落入口**（`.entryFallback`，侧栏稍后出现则自动让位）。

### 设计系统层（板上 UI 的宪法，改 UI 先读这里）

- **令牌只消费原生语义层**：样式只引用 `--dsw-*`（宿主按浅/深色与皮肤重映射）；**硬性：CSS 不得出现 hex/rgb 字面量**（verify 审计为零）。板上经 `board.module.css` 顶部 `--dsh-tb-*` 别名层统一引用；侧栏入口与设置卡在 scope 外只用原生令牌。
- **表面三层**：画布层（`--dsh-tb-glass`/`--dsh-tb-bg`）只用于板/列背景；所有内层浮起/下沉表面（卡片/对话/面板/评论/菜单）一律**不透明**。
- **浮层几何（看板盒参照，全宽度统一）**：`.modalBackdrop` = 看板盒内 absolute inset:0 + 只纵滚（`overflow-y:auto` + 隐条——舞台不出条，可见条只属于面板滚动体）+ `margin:auto` 子项居中（**不用 align-items:center**——超高面板顶部会被裁到滚动之外），底部内边距携 `--dsh-tb-kb`（键盘内缩单一变量，见 keyboard-inset.ts）。**浮层家族 chrome（`.modal/.detail/.review`）共用一条声明**（margin:auto/不透明浮面/边框/radius-xl/shadow-3/入场动画 `--dsh-tb-motion`），各面板只加自身 width；**宽高一律板盒 % 参照，禁 vw/vh**（确需视口参照才用 `dvh`）。**`Dialog` 默认 portal 到看板盒**（`portal={false}` 是需显式声明的例外——backdrop 锚最近的 positioned 祖先会被其 overflow:hidden 裁剪；`SessionFrame` 恒 portal）；**`Dialog` 一处注册 Escape 关闭，全家族获得**。窄屏（`useNarrow()`）下锚定弹层换形态（巡航设置用 `Dialog`，宽屏保持 popover）。
- **共用部件**（一律复用，不手写重复标记）：`ui.tsx`（Button primary/ghost/danger/**dangerGhost**+`size="sm"`+`pressed`、Section、Disclosure、Notice、AttentionDot、Icon、Switch）、`Chip`、`Dialog`、`PromptInput`、`TimeField`、`Markdown`（`markdown-parser.ts` 安全子集，**勿改回全局 `g` 正则**）、`SessionRow`、`CommentsThread`、`session-panel.tsx`（SessionRailHead/SessionTranscript/SessionConfigEditor/SessionFacts/SessionWaitingNotice）、`session-chip.ts`（**状态 chip 唯一文法**）、`format-time.ts`（**时间文案唯一映射**：formatTime/formatDateTime/formatDuration/formatCruiseTime）、`cron-label.ts`（cron 文案唯一映射）、`automation-ui.tsx`（CronField/SessionRulesSection/SessionRuleForm/**AutomationEditor**/scheduleSummary——**自动化唯一 UI**）。
- **动效唯一语法**：注意力 = `--dsh-tb-attention` + `--dsh-tb-breath`；卡片外层呼吸环（`.card[data-unviewed]`/`.card[data-active]`）、会话行内层柔晕（`data-glow` 绑定、pause 而非 cancelled——永不闪烁）、浮层入场 `dshTbDialogIn`。**`prefers-reduced-motion` 分两类**：**装饰动效**（入场/hover/FLIP/smooth scroll）静态降级；**功能性状态指示器一律存活**——脉冲幅度是令牌（`--dsh-tb-breath` / `--dsh-tb-breath-spread` / `--dsh-tb-breath-halo`，keyframes 内引用），reduce 下**只重定义令牌**（放慢到 5s、收窄幅度），**绝不对环/晕写 `animation: none`**（静止的黄圈读作"卡死"，与"进行中"真相相反）。判据：**动效本身即信息者存活，只为悦目者舍弃**。
- **光效规则表（呼吸显示与否的唯一判定，无例外）**：

  | 任务状态 | 卡片 | 会话行 |
  | --- | --- | --- |
  | 等待（处理/计划确认/提问） | 呼吸（waiting） | 呼吸（waiting） |
  | 进行中（板内/外源/续跑） | 呼吸（running） | 呼吸（running） |
  | 完善中 | 呼吸（refining） | 无 |
  | 已结束且未读 | 呼吸（未读） | 呼吸（未读） |
  | 已读已结束 / 空闲 | 静默 | 静默 |

  「进行中」只由状态驱动、与未读无关（`TaskCard` `data-active`）。已结束未读呼吸各自单基线清除（`markExecutionViewed`/详情打开清 `task.viewedAt`/`settleRefine` 自清）。外源轮从观察起视为 open（`sessionDisplay` 含 `external === true`）计入轮次集。
- **拖拽与落位**：插入条 = `drop-position.ts`（`insertionGapOf`/`indicatorTopOf` 纯函数）+ 行/盒内 22px 底部留白；**拖拽自动滚动** = `drag-autoscroll.ts`（滚动期间根元素 `scroll-behavior` 临时置 auto——smooth 与逐帧滚动打架）；**FLIP 落位 = 结构驱动**（`use-flip.ts` 比对列+索引的 DOM 结构，滚动/hover 永不触发；本地拖拽、详情换列、远端 applyRemote 三种驱动共用同一条动画）。**滑轨上的移动必须可见**：跨列命中先把目标列滚入视野再播动画。会话排序**只有按住拖拽**一条路径。
- **卡片永不穿模（板上任何内容的硬契约）**：① 卡片盒 `overflow: hidden` 剪辑地板；② 所有 flex 子项 `min-width: 0` + 截断/换行链路（`cardTime` 可收缩、标题/描述 `overflow-wrap`）；③ 徽章两槽位文法——`Chip`：文字进 `.chipBody`（ellipsis）、前导图形进 `.chipLead`。`tests/card-contract.spec.ts` 钉死。
- **UI 小规则**：一个语义强调色（`--dsh-tb-accent`）+ 四个状态色（attention/success/danger/neutral），全令牌；半透明 `color-mix(in srgb, 令牌 alpha%, transparent)`，alpha 22%/10% 两级；4px 节奏、圆角 8/12/16/24；字号：标题 13-14 + 负字距、正文 13-14、元信息 12（同排不混字号）；交互 `--dsh-tb-motion`(160ms)；hover `--dsh-tb-hover`；focus 2px outline（`:focus-visible`，裸按钮也纳入）；**同一排控件同级高**（按钮 28px / `buttonSm` 24px / 分段轨道 28px）。
- **响应式与触屏（改窄屏/触摸问题先读这里）**：① **响应式参照 = 表面自身的宽度，不用视口**——`[data-dsh-taskboard-view]` 设 `container-type: inline-size` + `container-name: dsh-tb`（带 `-webkit-text-size-adjust:100%` 抗 font boosting），板体几何断点全写进 `@container dsh-tb (max-width: …)`（compact 680px）；**评审家族锚定面板自己**——`.review` 声明 `container-name: dsh-tb-panel`，头部/堆叠/列宽全部 `@container dsh-tb-panel (max-width: 600px)`（面板是唯一诚实参照：板宽而面板被 880px 封顶时头部照样该换行；面板不能查询自身，它的宽度内衬规则留在板容器 648px 档）；**板体布局永不用 `@media (max-width)`**。② **compact 列 = 自由横向滑轨** `flex: 0 0 clamp(200px, 46cqw, 320px)` + **列导航 tab 五等分具名 grid**（`.columnTabs` 基显 none、compact `repeat(5,minmax(0,1fr))`）；五等分只剩约一个半汉字的标签预算，故 tab 消费 `STATUS_SHORT_KEY`（`board.statusShort.*`，与全称同表的 locale 数据）、完整名进 `aria-label`、色点窄档让位（列头已有同色点）；**不用 scroll-snap**；**列身份是唯一真相、px 永远派生**：`activeColumnIndexAt`（位置→列）与逆运算 `scrollLeftForColumn`（列→位置，钳进可滚范围）两个纯函数承担全部换算，tab 直达与 `.columns` 的 ResizeObserver 宽度重锚共用后者（开合侧栏/旋转/分屏不再"往右偏一点"）；compact 底 `env(safe-area-inset-bottom)`。**板头 = 确定的行结构，不是折行汤**：成员归组（`.boardModes` = 整理+自动化、`.boardState` = 巡航状态+引擎指示，状态零段省略——「排队 0」是噪音）；compact 导航行 = 返回 + 板名 + 模式组，状态组 `flex:1 1 100%` 独占第二行（仅有内容时渲染，横幅再长也挤不散别的控件）；工具行 = 新建 + 巡航两端对齐一行、筛选 `flex:1 1 100%` 独占一行（占位符永远完整——宽度地板治不了结构问题，让位才是答案）；**标签一律保留**（藏标签换宽度是错误取舍）。③ **触屏 = 桌面 parity**：交互一件不改，`@media (hover: none) and (pointer: coarse)` 块**只承载隐形人体工学**（`::before` 热区 ≥36px、色点 24px、输入 16px 防缩放）。④ 行为/结构开关只认 `useNarrow()`。⑤ **会话行 = 具名 grid**（`.sessionRowTop` 槽位 lead/chip/act，compact 两行 `"lead act"/"chip act"`、标题槽硬 `minmax(60%,1fr)`）——chip 与动作每行同一 x；动作 = `.rowActionText` + `.rowActionIcon` 一对（宽档显字、窄档显图形）；窄档工作区标签 `flex-basis: 100%` 自成一行为标题让位。⑥ **滚动跟随 = 一条机制**（`use-transcript.tsx`）：`resolveScroller` 找**真正在滚的元素**，`useFollowScroll`（解析根 + window 捕获阶段 scroll 监听 + 在底跟随 + ResizeObserver 同盯内容与根）被转写尾与评论线程共用——"谁是滚动根"怎么变都不用改代码。⑦ **滚动条、内衬与截断归属**：可见条只属于贴表面边的滚动体，横向内衬由滚动体自持（rail 滚动体自持 `padding: 0 14px`，其内成员**不再加第二重内衬**——`.sessionRailScroll .interactionCard` 清掉 margin；`.interactionCard` 只留纵向 padding，滚动体与动作行各持 `padding: 0 12px`）；容器不得用 `overflow: hidden` 裁文字以外的东西，截断永远归文字子槽（`.boardStatusText` / `.chipBody`）。⑧ **评论/会话面板结构（双端同一组件，一切挤压/裁切/卡中部问题的根解）**：rail = **一个滚动体 + 上下文 dock + 一个钉底 composer**——`.sessionRailScroll`（flex:1、min-height:0、overflow-y:auto）装下状态行 + **两个下拉**（下拉①「上下文与运行配置」= 计量+运行配置，`.sessionRailHeadBody` 限高内滚；下拉②「评论」= 线程+交互卡+跳到最新），两者都走**唯一 `Disclosure` 文法**（chevron 折叠朝右/展开朝下：`[aria-expanded='false'] .detailChevron rotate(-90deg)`；手写折叠行 = 「箭头永远朝下」根因，禁止回潮）；滚动体之后是 `.sessionContextDock`（会话上下文常驻评论框正上方，in-flow、限高 180px 内滚、无未完成内容时 `:empty` 零高——**不在头部**），最后 `.reviewComposer` 钉底。**任何 rail 高度下 dock+composer 都可见可点，任何展开只增加滚动高度、永不挤压裁切别的东西**。堆叠档**不重言滚动模型**（只换 order 与高度份额；`@container dsh-tb-panel` 内不得出现 `.sessionRailScroll` 规则）；**手机堆叠 = 对话记录在上（`.reviewMain order:1`）、rail 在下（`.reviewRail order:2`）**——composer 因此落在面板底边（拇指处）而非卡在中部把对话甩下面（旧 rail-first 的病）；**高度份额不用容器/视口单位**（板盒只有 `inline-size`，块轴 `cqh` 会静默退化成视口单位）。评审头部窄档两行：**第 1 行 = 标题 + 徽标 + ×（同一水平面）**——× 内联 `flex:none` 贴右同行居中（**绝不绝对定位**，那让 × 与标题漂到不同基线），标题单行 ellipsis（完整名进 tooltip，换行标题会把 × 顶偏）；第 2 行 = 刷新/查看会话（`flex:1 1 100%` 换行 + `justify-content:flex-end` 贴右）。`.reviewHeader .iconButton` 收 24px（与 buttonSm 同级高）。rail 头下拉手机档**默认折叠**、评论下拉默认展开（初值取 `useNarrow()`）。⑨ **表单行「让位不压扁」**（见硬性规范 10）：放输入的轨道一律 `minmax(0|Nch, 1fr)`，可伸缩成员带地板（`.scheduleInput flex:1 1 140px`）且行 `flex-wrap`；层级一律**具名 grid areas**，**禁用 `margin-left:auto` + `border-left` 充当靠右**；下拉箭头内缩唯一令牌 `--dsh-tb-select-arrow-inset`；弹窗次级动作归底部动作行。⑩ **说明必须可达**：触屏无 hover，必要信息不能只挂 `title=`（引擎指示是 `button` + Dialog，见 `board.engineNoteOk`）。`tests/mobile-contract.spec.ts` + `review-page.spec.ts` 钉死以上全部。
- **加载反馈文法（loading ≠ failed ≠ empty，三态各如其分）**：任何异步读取面首帧是安静的「读取中」（`review.configLoading`），**绝不把在途渲染成红色失败**（「会话配置暂不可用」误报的根因）；失败 = 原因行 + **行内重试按钮 + 一次自动退避重试 + 回前台重试**（`SessionConfigEditor`；转写尾同理：3s 轻轮询的任何成功即自愈 error，`use-transcript.tsx` 的 `settle` 是单一结算口）；空 = 空态文案，不是错误。

### 核心层（`src/core/` 纯逻辑 + 关键职责）

- `tasks.ts`（状态机/COLUMNS/plainRunsOf/latestExecutionOf/chainUnlimited/taskExecutable/`newExternalRound`）· `schedule.ts` + `scheduler.ts`（cron 分钟 tick + cruiseTick）· `cruise.ts`（巡航窗口 v4）· `presets.ts` / `run-presets.ts` · `automation.ts`（会话规则 + 就绪语义）· `colors.ts` · `session-list.ts`（taskSessionsOf/orderedSessionsOf/sessionWindowOf）· `session-display.ts`（waiting>running>settled + viewedAt 基线 + nativeRunning）· `comment-thread.ts` · `question-rpc.ts` · `store.ts`（ledger 归一化）· `execution.ts`（投递与结算 + `createSession`）· `controller.ts`（台账 + 统一并发调度器 + 引擎席位 `setEngine`/`applyRemote` + 外源轮双通道 `recordNativeTurn`/`scanExternalActivity`）。
- **运行态与会话集合唯一推导** = `task-live.ts` + `linked-sessions.ts`：`relatedSessionIdsOf(task, linkedIds)`（refine → session 绑定 → 执行轮 → linked，去重稳定序；一切相关面只经此推导）；`taskLiveStateOf`（waiting > running > idle，running 以相关会话原生 `byId.running` 为真相）。`deriveLinkedSessions`：**链接行只来自显式 session 绑定**——工作区绑定是来源/配置关联，**永不派生成员会话**（有意的产品语义）。**原生归档即时同步**：`taskSessionsOf` ctx `archivedOf` 是唯一过滤点（读 `workspaces.list` 归档集），归档会话的行整体离卡、`linkedOf` 同源收缩（相关集/计数/liveState 同帧一致），轮次保留、取消归档带历史回来；行派生自原生真相非台账→两端零延迟。
- **原生活动检测** = `session-activity.ts`：外源轮双通道 + **每运行期恰一轮**——主通道 mux `user/message` 帧（`nativeTurnOf` 解析，直达 `controller.recordNativeTurn`）；兜底为**状态式**扫描（相关会话当下在跑且本期未消费即记轮，覆盖加载时已在跑/断流窗口；`book.recorded` 按运行期消费、会话回落 idle 即重新武装），两通道经**轮次锚点**（`ExecutionRecord.anchor` = 启动该轮的 user 消息 seq）跨通道/跨设备/跨引擎交接幂等去重；正文 = `latestUserMessage`（纯图片 → `imageOnly` 占位）。外源轮不排队/不注入、驱动卡片「进行中」、跑完经普通结算落「待审核」（`EXTERNAL_SETTLE_GRACE_MS` 内无回合证据 = 噪声取消）；主动添加（拖入源/新建/选入）经 `reconcileBoundTask` **即时同步当前实况**（当下在跑即记轮 + 未读呼吸；空闲不虚构）；一切写入在 await 之后以**当前记录**重建并复查守卫；已完成的过去回合永不回补。
- **同步域（多端一致的地基）**：`board-doc.ts` = **BoardDoc + 合并文法唯一居所**：逐记录以**作者声明**裁决——commit 携 `changed`（本副本相对基线内容移动过的 id 集，`changedIdsOf` 得出），claimed 无条件接收（host 串行到达序 = 后到者胜，**设备时钟不参与裁决**；内容相等的 claim 是 no-op），未 claimed 维持 LWW，删除带 `baseUpdatedAt` + 墓碑（at=所见最新+1），`stamps` 记 host 接收钟。**读态不是作者**：`viewedAt`（任务级与轮级）在 claim 比对前剔除（`authorshipKey`）——"点开卡片"不产生声明（否则陈旧副本凭一次点击覆盖引擎刚记的外源轮）；读态走**单调 max 合并**（`mergeReadState`），只前进不回退。**section 层同构**：commit 携 `sectionClaims`，claimed 无条件接收 + host 时钟落 at、未 claim 的基线副本一律跳过；无该字段回落纯 LWW。`normalizeBoardDoc`/`normalizeCruiseValue` 把介质的值当数据不当真相。`host-sync.ts` = `BoardSyncClient`：boot 一次性迁移（host 空 → 整视图 bootstrap；非空且分歧 → 按记录联合并入、section 归首写者、分歧整视图 `onBackup` 停放）、claims 逐次累积 / 全量 ack 后清空、去抖提交（在途合并 / trailing refire / 失败退避）、SSE + 轮询 + 重连汇入单一 resync、引擎租约（见「多端同步」）、`requestLaunch`、`hostProtoVersion()`；`Synced*Store` = 既有 store 接缝 over 共享文档 + 本地镜像。**用户意图写必经 `controller.userEdit(taskId, mutate)` 单一漏斗**（返回新对象即结构上强制 bump `updatedAt`；引擎派生写与读态写不走它，各有新鲜度语义；排序被挤位的 sibling 也补 stamp）。

### 关键不变量（避免重造已有机制；改前先读对应文件）

- **多端同步（host 唯一真相 + 引擎租约，一切数据一致性问题的根解）**：看板真相 = host 的 `BoardDoc`，localStorage 五键降级为离线镜像/草稿/备份。浏览器 = 乐观副本：本地写即时生效，经 `store.save → Synced*Store → BoardSyncClient` 去抖提交，**host `applyCommit` 合并后返回权威文档，所有副本向它收敛**；远端变化经 SSE（+ 轮询兜底 + 对账）→ `controller.applyRemote`（**永不回写**——回写即回声）。裁决文法见「同步域」。「添加已有会话」与侧栏拖入同走 `addTaskSource`。**引擎租约**：host 内存租约（TTL + 任何 API 命中续期 + 断流宽限期提前过期），**只有引擎端**跑 dispatch 泵/scheduler tick/reconcile/外源轮记轮/cruise 翻转/settledFollowUp+链续；非引擎端 = 纯视图 + 提交器（用户动作照常写台账，由引擎泵出；手动执行经 `requestLaunch` → host `/command` → 引擎 SSE，无引擎时 park 重放）——单泵 = 单并发预算 = 多端绝不双发（含双标签）。**席位跟可见性（双向即刻）**：`/lease` 携带 `active`，**转后台立刻写 `active:false`**（不等心跳），**可见端可从不活跃持有者抢夺席位**（双可见端不互抢、全后台维持最后持有者让定时照跑），回前台立即续租+resync——引擎永远坐在用户正看着的那台设备上。**流活性有界**：SSE 计数只在距持有者上次真实 HTTP touch `STREAM_ALIVE_MAX_MS` 内续命（半开 socket ≠ 活着）。**协议版本 `LEASE_PROTOCOL_ACTIVE`** 随 LeaseState 下发；**席位通知 = (held, proto) 元组变化**——host 重启只动协议不动席位，元组任一半移动都触发 seat 监听 → `controller.setHostProto`（相等不 notify），「服务端未重启」横幅因此**实时清除**而非残留到一个手动刷新（只通知 held 变化 = 上一代手机横幅永不消失的根因）；`hostProtoVersion()` 在首租应答前返回 **undefined**（未知 ≠ 旧，绝不误报），controller 默认取 CURRENT。旧 host（无版本）= 抢夺不生效，板头据此提示（host 改动须重启 `dsh web` 这件事界面可见）。**板头引擎指示**：同步模式且本机非引擎而有排队/待注入 → 提示"引擎在另一端"；空闲永不唠叨。**投递看门狗**：open 轮超 `OPEN_ROUND_WATCHDOG_MS` 且其会话 idle 无 turn 证据 → 合成 cancelled 结算释放（会话在跑/等人回应绝不判）；reconcile 也扫停车卡的 open 轮，`resolveCardDrop` 拒绝带 open 轮离列（僵尸轮会占并发预算并吞掉后续外源轮）。question tracker 每端独立流（先到先答，官方语义）；drafts 刻意设备本地不同步。storage hub 缺席 → 回退 localStorage 模式，功能不降级为错误。
- **统一会话与评论单轨**：相同会话 = 同一条线程（`sessionCommentsOf`）；直发/驱动/评论并轨为一种留言；发送两态 = 排队（调度器/巡航/FIFO，可取消）与插话（`steerComment` 立即送达）；**图片只有一条官方链路**：`sessions.prompt` 的合法 image part 是 `{type:'image', mediaType, data(base64), name?}`——浏览器送临时字节、**host 做持久 admission**，故 composer 的 `DraftImage` 经 `toPromptImage` 直发（`PromptImage` 贯穿 sessionMessage/steerCommentWithImages/sendRawMessage/sendComment），**绝不自建附件桥/上传路由**（自造 `{type:'image', attachment:{…}}` 不在合法 union 内、host 必拒）；admission 后的存储形状才是 `{type:'image', attachment: ImageAttachmentRef}`——`contentImagesOf` 折叠提取（去重、坏 part 跳过、纯图消息不丢），`MessageImage` 经官方 `sessions.attachment` 读回 base64 渲染缩略图（复用 `createTranscriptReader`）；客户端白名单/20MB 上限与就近 `.formError` 保持，附件条独立成行、动作行恒单行。
- **插话与任务运行态（单一推导）**：发送层 mode 参数化——`sessionMessage`/`sendRawMessage`/`commentRun`/driver.prompt 都收官方 `'queue' | 'steer'`；**三入口统一**（评论线程插话 → `steerComment`('steer')；会话规则 `send:'steer'` → 建轮**即带 injectedAt**〔dispatch 按注入标记过滤，杜绝同一轮双注入〕+ 立即注入；直接留言/交互卡回答不走此层）。**运行态与相关会话集唯一推导 = `task-live.ts`**：`sessionDisplay` 以 `nativeRunning` 把「settled 轮但会话真在跑」显示为 running（waiting 仍最优先）；`reconcile` 的 `driveLiveStates` 驱动**直发轮**（settle-at-birth 无事件路径）——会话跑 → 卡片进进行中，会话停 → 落「待审核」并走**同一条 `settledFollowUp`**；板内各轮事件结算路径不变（`isDirectLike` 只认已结算直发轮）。**一致性铁律**：行徽章（liveState）与卡片列（台账轮次）必须同涨同落。
- **官方 @ 引用机制（唯一桥 = reference-source.ts）**：所有输入框共用同一桥——与主界面 ui-reference 相同的两个 Remote 命名空间（`remote.fileReferences` + `remote.sessionReferenceResolver`，缺面降级为无 @ 菜单）。**官方身份政策（不可绕过、勿在代码里绕，参见 README 能力边界）**：目标会话为子代理路由会话（`origin === 'subagent'` 或挂在活跃父代理下）时宿主对一切通用 RPC 返回 `agent-busy`，官方 composer 同败（官方语义，无修复版本）。**插入全用官方文法**：`file-reference-grammar.ts` 与 `session-mention.ts` 为官方包**逐字镜像**（打包门禁禁跨插件值导入，契约测试钉死）；会话引用 = `@[label](dsh-session:…)`，解析全走官方链路。作用域：`PromptInput` 以目标 `sessionId` 唯一解析（`referenceSessionOf`）；`@"` 引号路径内不弹会话候选。**失败契约**：`listReferenceRows` 永不 reject（两域独立降级、坏行跳过 `diag.skipped`）；官方 log-only——菜单**绝无失败文案**，唯一例外 = 会话域官方失败时**降级为板内目录行**（`referenceSessionCatalog` + `catalogSessionRowsOf`：排自身、上限 50、插入仍是官方 mention；只降级"发现"，解析 100% 官方）；两域皆成功且真无候选才显示 `prompt.noReferences`。**菜单三文法（纯函数）**：能力门 `referenceMenuAvailable`；空态文案专属；`continueAfterPick` 只在目录下钻（`@"路径/`）重开菜单。
- **原生交互卡 + 上下文块**：agent 挂起时 `InteractionCard` 实时弹出，**回答只走原生 mux 通道**（`connection.api.respond`），普通留言不解决挂起提问。to-do 读**官方 `todos` projection**（与原生 TodoPanel 同源、宿主升级自动跟随；投影缺席降级事件解析）；goal/子代理走 session-state 桥（缺面即降级）。`SessionContextBlock` 常驻评审/会话面板的**上下文 dock**（滚动体之后、composer 之前——用户要的"就在评论框上方"；in-flow、限高 180px 内滚、无未完成内容时 `:empty` 零高），完善面板保留 in-flow 浮层形态；chevron 走全局折叠文法（折叠朝右/展开朝下）。**有未完成的才显示**：`contextWorthOf` 唯一判定——todo 任一未完成 / goal 活跃 / 子代理未完成（status 缺失按进行中算）；全完成才整块隐藏。**行文法**：标记 `flex: none` 贴首行（`align-items: flex-start`），文字进 `.chipBody`。**桥读原生形状**（session-state-route，`listChildren` 按父会话 id）：goal = `{objective, phase}`（phase complete 即不返回）；子代理 = `{label, activity}`（只返回在跑的 child；inactive = 已结束）。
- **多源绑定（拖入 = 添加，绝不刷新替代）**：`TaskRecord.binds: TaskBind[]` 是真相源；所有读者走 `taskBindsOf(task)` 投影；`copyTask` 不复制 binds 与会话规则（模板语义）。**session 绑定 = 会话出现在卡片上**；**workspace 绑定 = 仅来源/配置关联，永不派生会话行**。隐藏托盘「删除」= 从任务移除（`removedSessions`，其轮次同删）；**再拖回可恢复**（`addTaskSource` 清 removed）；工作区重新绑定不恢复任何会话。**`removedSessions` 是权威「非相关」门**：`taskSessionsOf`/`linkedOf`（显示）与 `relatedSessionIdsOf`（运行态/外源轮/rename 守卫/添加候选）一律减去它，被删会话重新成为「添加会话」候选。
- **完成态留言自动移回「待办」并驱动**（`reviveTaskIfDone`，queue/steer 同规则）。
- **真执行自动补全（缺则补、填则守、写入与发射点唯一）**：新建任务 标题/描述/执行 Prompt **全可空**（空 Prompt 只让任务惰性——真正运行/接续链被 `taskExecutable` 门禁拦截，创建不受限；未命名卡片显示 `card.untitled`）。**唯一作用点 = `supplementedTask`**：任务被写入（createTask/createBoundTask/updateTask）或真正启动（launchTask——一切发射路径）时，空标题/描述从执行 Prompt 补齐（标题 = Prompt 第一非空行 trim + 40 上限；描述 = 整个 Prompt trim）；已存在字段**永不覆盖**；评论轮/完善轮/外源轮不触发。
- **自动化两半互不干扰 + 完成接续（链）**：任务级 `schedule`（按时间表/完成后接续）与会话级 `rules`（指令 = 自定义或任务执行 Prompt（usePrompt，发送时取当前值非快照）；触发 = cron 或 on-complete）字段正交、语义独立（controller 单测钉死）。UI 唯一 = `AutomationEditor`（板与详情同一份；**启用开关只在编辑器内**；总览卡片 = 身份头 + 一行摘要 + 展开体）；分节用 `Segmented`。**on-complete = 永续循环**：**任何一次完成结算**（普通执行/用户评论轮/外源轮；完善轮与规则自己的轮除外）都触发，不受列暂停约束；**所有结算路径共用同一条 `settledFollowUp`**。规则轮走**自动化车道**（ruleId；`nextEligible` 优先、**不受巡航开关约束、绝不等巡航**；全局 FIFO + 预算；每规则在途至多一轮）；规则自己的轮**成功**结算即续下一轮，直到关闭/删除/会话消失/内容不可用；失败/取消不续；手写评论（无 ruleId）不触发。**链语义**：武装即开跑（`setSchedule`：`enabled && chain && 可执行 && 无在途轮`，任意列）；每次普通执行**成功结算瞬间**接续下一轮；**手动移动卡片（除 done）绝不解除武装**；`done` = 硬停；预算到顶自动解除。**显示真相**：已启用未触发 = 「等待任务完成触发」chip；排队/插话只是模式标签绝不误读为进行中；**每会话至多一条规则**；老数据归一化为 cron + 自定义指令。
- **巡航窗口 v4 文法**：**总开关主权**——`enabled` 是当前状态；窗口是计划表，只有「开始/结束时刻」越过时翻转开关；**增删窗口绝不动开关**（唯一例外：新增「只填结束」窗口，其开始时刻 = 创建时刻）。窗口 `{startAt?; endAt?}` 三态（都填=区间 / 只填开始=到点开并保持 / 只填结束=创建即开到点关）；列表**自动排序**（`sortWindows`：立即开启→按开始→按结束，开口最后）；每窗口一行文法（`cruiseWindowLabelOf`——「开始 → 次日 结束」/「{time} 起保持开启」/「已开启 · 至 {time}」，完整时刻走 tooltip）；**「次日」只用于紧邻后一日**（`isNextDay` 按日历日）；**状态行永远一句话解释开关为何是当前值**（`cruiseStatusLineOf`）。校验 = `windowRangeIssueOf`（归一化后判定，跨午夜只支持一晚）；`normalizeWindow` 对非法范围绝不虚构次日。
- **校验反馈文法**：`inputInvalid` 是唯一错误边框（cron/select/PromptInput/数字共用）；会话规则表单按 会话→指令→Cron 顺序报**首个失败字段**专属文案（`auto.form.invalidSession/invalidInstruction/invalidCron`）；`saveFailed` 兜底「保存失败」。
- **卡片 = 纯状态摘要**：标题/描述/来源行（`cardSourceLabel` 单一推导）/更新时间/状态与自动化 chips；运行窗口与评论时间线只归详情页。**视觉对齐**：色点在标题行前（8px 圆点 + 5px 顶距光学居中；元信息贴卡片内容边——**不要用「固定槽位/gutter」整体右移**）、板头/列头圆点 `translateY(-0.5px)`；**选中态**：`.card.selectedCard:hover` 必须覆盖 hover，accent 双环 + 上浮 + 右上对勾徽章 + 120ms 入场。
- **执行 Prompt 空 = 全链路阻断（执行专用）**：`taskExecutable(task)`（严格 `prompt.trim() !== ''`）是唯一判定；`ruleReadiness`（cron）与 `sessionRuleReadiness`（仅 usePrompt 规则）给 `{kind:'blocked'}`（次序 disabled → blocked → paused(列) → active；**链模式跳过列暂停、自定义指令会话规则永不因任务 Prompt 为空而 blocked**）；`runTask` 单点拦截一切执行路径（手动/定时/巡航/链/拖拽重跑），**「完成后接续」武装**在 `enabled && chain && !taskExecutable` 时直接拒绝（不持久化——编辑器显示 `detail.promptEmpty`）；**评论与插话永不被 Prompt 门禁**（composer 只在会话消失时禁用）；**例外（不封）**：需求完善流程、mux 交互卡回答、在途开轮续评、绑定会话被动观察。
- **运行配置预设（自定义 + 默认应用）**：`src/core/run-presets.ts`（键 `dsh.taskBoard.runPresets.v1`）；内置不可删 `deploy-default`（空配置 = 部署原生默认）；**默认回退链** = `defaultRunPresetOf`（defaultId 缺失/悬挂/被删 → 一律「部署默认」）；UI 唯一 = **`RunConfigFields`**（预设 picker + RunConfigEditor 整块组件，TaskForm 与 NewSessionModal 渲染同一份）+ `RunPresetManager`（添加/编辑 = 名称 + 同字段自编辑、删除、设为默认），新建任务 `initialDraft` 应用默认预设（草稿优先）。
- **会话标题（与原生一轨，绝不打架）**：原生 rename = 官方「钉住」语义（`sessions.rename` 以 `user` 源追加 `session/title`——钉住标题、作废在途自动生成、后续消息永不自动改名；不命名则宿主自动命名链完整保留）。板内两条入口走同一官方写：**新建会话标题选填**（`createTaskSession` 的 `title`——填了 rename 钉住，留空什么都不发、交给宿主自动命名；失败 = `titleError` 部分成功）；**会话行重命名**（`SessionRow` → `renameTaskSession`，目标须是本任务相关会话，空标题拒绝，成功只 notify——标题真相在宿主 list，无第二份状态）。**未命名文法**：宿主未命名的会话行统一显示 `detail.sessionUntitled`（`sessionRowTitleOf` 唯一推导 + `untitledLabel` 注入）。**认得宿主的确定性自动名**：判据唯一居所 = `linked-sessions.realTitleOf(title, cwd)`——durable `title` 恰等于 `cwd` 的 project basename（`workspaceLabelOf`）即宿主 fallback 名、非真名，返回 undefined 走未命名文法。**两个读者共用**：`controller.sessionTitle`（执行行/面板头）与 `rowOf`（链接行）；`rowOf` 的标题槽只放真名，工作区名只属于它自己的 `workspaceLabel` 槽。
- **详情页新建会话（会话区「+ 新建会话」）**：入口住在「会话 N」区块标题行的 **Section action 槽**（右端，双端同构，与「新增会话规则」同一文法），说明行紧随标题——按钮绝不插在标题与其说明之间；空列表也常驻，空任务有明确入口。`NewSessionModal` = `Dialog portal`（嵌套弹层硬性规范）+ `.modalScroll` 唯一滚动体，正文 = 选填标题 + 运行配置（初始值 = 任务自身配置）。链路 = `controller.createTaskSession` → `ExecutionService.createSession`（**保证全新会话**：face 结构化读取 + wire 兜底，face 缺失降级 connectWorkspace blank 复用）→ 按执行同序应用配置（model → agentPreset → `/permission`）→ 标题（官方 rename）→ `addTaskSource` 绑定。失败契约：创建失败 = ok:false、任务不动；配置/标题失败（会话已在）= 诚实部分成功 `configError`/`titleError`，会话保留、弹层内联展示，绝不回滚。新会话不是执行：无执行轮、不进调度器、不涉自动化。
- **交互卡/rail 永不横向爆框、纵向不挤**：rail 的 flex 子项全部 `min-width: 0`；行内按钮组可换行（`.interactionActions` flex-wrap）；卡片在完善面 `margin: 0 14px`（rail 滚动体内该 margin 清零——内衬归滚动体，见「响应式与触屏」⑦）。**高度契约**：`.interactionCard` `max-height: min(320px, 40vh)` + `overflow: hidden`，正文在 `.interactionCardBody`（`overflow-y: auto; min-height: 0`）内滚动，**动作行钉在卡外永远可见**。**rail 的高度契约**见「响应式与触屏」⑧：一个滚动体（状态行 + 两个下拉：配置、评论[线程+交互卡+跳到最新]，贴底自动跟随）+ 上下文 dock + 一个钉底 composer——dock 与 composer 是仅有的固定件，展开只加滚动高度、永不挤压裁切。
- **会话列表**：`orderedSessionsOf`（`sessionsOrder` 全量手动序；数组外新会话置顶（除非用户拖过））；板列与详情共用 `drop-position.ts` 插入条；详情列表拖拽用 `useDragAutoScroll`（滚动根 = `.detailBody`）。行文法见「响应式与触屏」⑤；执行行命名执行结果，链接行命名会话活动（未运行带 `detail.idleHint`）。**.sessionList 不容忍底部死区**：久置 `padding: 0`，只有 `[data-reordering]` 期间底部呼吸 14px 给尾部插入槽。
- **稳定性**：受控组件本地回退；composer 之上可滚动中区；就近 inline 反馈；订阅/轮询必带终止路径；正文永不省略（break-word），元信息可 ellipsis+title。
- **草稿覆盖矩阵（`drafts.ts`，键 `dsh.taskBoard.drafts.v1`，设备本地不同步）**：承诺 = "任何会随切换卸载、承载用户手写内容的输入面，未提交内容必须回来；提交/保存/取消即清槽"。现行键：`comment:<taskId>:<sessionId>`（评论 composer，评审页与链接面板共用同一身份）、`edit:<taskId>`（任务编辑表单，整份 TaskDraft JSON）、`refine:<taskId>`（完善答案）、`new`（新建任务弹窗）、`newsession:<taskId>`（新建会话标题 + 运行配置 JSON；损坏回落任务配置——草稿是便利非真相）、`rule:<taskId>:new`（会话规则 ADD 模式的指令；**编辑既有规则永不用草稿**）。瞬时单字段输入（搜索框、时间字段、选择器、巡航窗口）不入矩阵。新增输入面按同一矩阵归位，不另起存储。

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
5. **数据键稳定**：`dsh.taskBoard.v1` 不得改名。同步模式下这些键是**离线镜
   像/草稿/preSync 备份**（真相在 host 存储单元）；回退模式下仍是真相——两种
   模式下用户数据都不因升级丢失（首连 host 空 → 本地整视图 bootstrap；host 已
   有数据 → 本地记录按 LWW 联合并入、分歧整视图一次性备份到
   `dsh.taskBoard.preSync.v1`，见「同步域」迁移文法）。
6. **生命周期纪律**：订阅/监听/定时器/observer 全部注册 disposer；DOM 失败
   console.error 不抛；`ctx.effect` 内创建的资源随 effect 清理。
7. **独立自包含**：运行时依赖仅 `schemastery`（host Config schema）；不依赖兄弟
   插件；DOM 挂载标记由本插件自打（如 layout 自 stamp `data-dsh-frame`），不依赖
   外部垫片。
8. **不引入新依赖**：新增依赖需先在对话中说明理由并经确认。
9. **从机制上解决问题**：遇到新情况先按「行事总纲」的意图与边界推理，而不是等待
   规则增补或把特殊处理写死进代码；当真实的新场景反复出现时，按「本文件的定位与
   编辑规则」更新本文，而不是增加一次性补丁条款。
10. **双端同治（移动端不是一等公民之外的二等公民，而是同一等）**：任何 UI、交互、
    文案、动效改动，**必须同时给出桌面与窄屏（手机）两档的结论**，且只能用
    「换行 / 换列 / 让位 / 短名 / 折叠 / 提高地板」表达——**禁止靠藏掉标签、藏掉
    控件、缩小字号来"省地方"**，禁止为窄屏另写一套组件或交互副路径。只在一档验证
    过的改动视为**未完成**。三条硬底线：① 容器装不下时让位而非压扁（裸 `1fr` 轨道、
    无地板的 `flex:1 1 0` 都算没做完）；② 文字永不画在盒外、截断只发生在"文字子槽"；
    ③ 触屏没有 hover——承载必要信息的说明不能只挂 `title=`，必须可点可达。

## 测试（布局约定）

- **一个 src 模块一个 spec；契约按表面/域分组**（review 页纯逻辑 / card 契约 / host
  路由 / 拖拽几何 drag-contract / 端到端 controller）；**新增逻辑即配测试**——测试是
  契约，不是附件；不要随手加文件，先归入对应域的现有 spec。
- 清单：`tests/` 下 `tasks`、`schedule`、`scheduler`、`cruise`、`automation`、
  `presets`、`store`、`execution`、`session-activity`、`session-list`、
  `session-display`、`linked-sessions`、`task-live`（运行态唯一推导）、`question-rpc`、`refine`、`format-time`
  （核心纯逻辑）；`board-doc`（同步合并文法：LWW/墓碑/section/收敛）；
  `host-sync`（同步客户端全状态机：迁移/去抖提交/对账/租约 + **席位 (held, proto) 元组通知**（协议单独变化必须触发监听、首租前 proto 为 undefined）+ **双客户端共享真实
  BoardDataService 的端到端收敛**）；`question-tracker`（mux 问答流自愈契约：失败/关闭后必重连、dispose 后必不重连）；`drag-contract`（drop-position + drag-autoscroll）、`flip`、
  `comment-thread`、`markdown`、`slash-token`、`reference-source`（官方 @ 引用桥）、
  `file-reference-grammar`（官方文法镜像契约）、`drafts`、`sidebar-drag`、
  `review-page`（review-transcript/context-meter/menu-direction/interaction 合并 + **评审家族全部 CSS 契约**：rail 一个滚动体+钉底 composer、面板容器 dsh-tb-panel、头部两行、Disclosure 文法、Dialog 正文内衬、无 vh）、
  `card-contract`（card-layout + card-label 合并）、`mobile-contract`（容器查询
  机制/compact 几何无 vh/vw/触屏块/板头确定行+零段省略/溢出修复/离屏入口——钉死移动端设计）、
  `settings-route`、`board-route`、`board-service`、`board-http`（真实
  `JsonStorageBackend` + 真实 `http.Server` + 真实 SSE 的端到端冒烟——单测 fake 测不到的
  HTTP/落盘/流式契约）、
  `permission-route`、`session-state-route`（host 路由，同一
  惯用法各占一个）、`route-scope`（client 设置 scope）、`transcript-cache`（读取新鲜度层：在途合并/TTL/超时/失败不缓存——转写与图片读取共用）、`controller`（端到端，
  唯一大文件——共享 harness 不拆分；含引擎席位/applyRemote/中继门控/看门狗/读态不覆盖/图片形状透传）。

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
