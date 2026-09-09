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

- `src/client/index.ts`：`inject = ['slots','sessions','workspaces','locale','remote','uiSession']`（`uiSession` 只读订阅官方 `pendingInteractions` 快照——board 永不注册 waterfall listener；`dsh.client.inject` 含 api-remotes/api-session-controller/api-workspace-controller/client-connection/client-locale/client-ui-session 六包）；设置卡 + `RouteSettingsScope` 快照（失败降级不抛）。挂载流程（offline-first，入口永不等网络）：`Synced*Store` 常驻（未同步读本地镜像）→ 接线 `BoardController` + `ExecutionService` + `SchedulerService` → `controller.start()` → `bindBoard` + `mountBoard`（入口即时可用）→ 后台 `sync.start()` 收敛（迁移/union 后 `applyRemote` + 席位认领）；提问面 = `PendingMirror`（官方快照只读投影，无 uiSession 面时回落 legacy mux tracker）；原生活动唤醒 = `watchSessionActivity`（`api-session/activity` 直达 + list `updatedAt` 推进双通道 → `controller.recordActivityWake` → 调度 reconcile 读尾）；`sync.onRemote → controller.applyRemote + writeMirror`、`onEngine(held) → controller.setHostProto(hostProtoVersion()?)/setHostBoot(hostBootTime()?)/setEngine(held)`（席位 = (held, proto, bootedAt) 元组，见「多端同步」）、`onCommand → controller.runTask`；调度器 `ready()` 并联 `sync.isEngine()`。执行/结算的宿主面全部经 `platform.ts`：`buildApi` 把每个域方法钉到宿主真实注册的 Remote 端点（`tests/platform.spec.ts` 契约测试钉死，宿主升级改端点会先在测试里爆）；`sessionDriverOf` 把 `sessions.binding` 的 Session 适配为 `SessionDriver`（turnEnds 只由空白会话首轮边界推导，其余轮次经 host 会话列表 + history 面结算）；执行会话解析 `ExecutionService.connectSession` 复用 workspace 官方 `sessionIds`、无则 `sessions.create`。
- `src/client/board-transport.ts`：`BoardSyncTransport` 浏览器实现（fetch 四调 + EventSource；EventSource 缺席降级纯轮询，仍收敛）。
- `src/client/board-mount.tsx`：板视图 DOM 级挂进中列（`[data-dsh-taskboard-view]` 容器 + 键盘内缩 watcher；`html[data-dsh-taskboard-active]` 显隐，对话子树保持挂载）。看板入口唯一 = **官方侧栏 slot**（`sidebar.footer.action`，`SidebarFooter.tsx` 注册 + `SidebarFooterController` 桥接：apply 时注册、mountUiBody 时 `bindBoard` 绑定真实板开关——壳层在宽列/窄轨/移动 overlaid 抽屉同一 React 树渲染，结构上不存在「时隐时现」）；**无 DOM 注入、无浮动角落兜底**（用户决策删除；旧 `sidebar-entry.ts` 注入行已删除——它只落在列内子树，移动 overlaid 呈现看不见，正是「按钮时隐时现」的根）。

### 设计系统层（板上 UI 的宪法，改 UI 先读这里）

- **令牌只消费原生语义层**：样式只引用 `--dsw-*`（宿主按浅/深色与皮肤重映射）；**硬性：CSS 不得出现 hex/rgb 字面量**（verify 审计为零）。板上经 `board.module.css` 顶部 `--dsh-tb-*` 别名层统一引用；侧栏入口与设置卡在 scope 外只用原生令牌。
- **表面三层**：画布层（`--dsh-tb-glass`/`--dsh-tb-bg`）只用于板/列背景；所有内层浮起/下沉表面（卡片/对话/面板/评论/菜单）一律**不透明**。
- **浮层几何（看板盒参照，全宽度统一）**：`.modalBackdrop` = 看板盒内 absolute inset:0 + 只纵滚（`overflow-y:auto` + 隐条——舞台不出条，可见条只属于面板滚动体）+ `margin:auto` 子项居中（**不用 align-items:center**——超高面板顶部会被裁到滚动之外），底部内边距携 `--dsh-tb-kb`（键盘内缩单一变量，见 keyboard-inset.ts）。**浮层家族 chrome（`.modal/.detail/.review`）共用一条声明**（margin:auto/不透明浮面/边框/radius-xl/shadow-3/入场动画 `--dsh-tb-motion`），各面板只加自身 width；**宽高一律板盒 % 参照，禁 vw/vh**（确需视口参照才用 `dvh`）。**`Dialog` 默认 portal 到看板盒**（`portal={false}` 是需显式声明的例外——backdrop 锚最近的 positioned 祖先会被其 overflow:hidden 裁剪；`SessionFrame` 恒 portal）；**`Dialog` 一处注册 Escape 关闭，全家族获得**。窄表面（板 680px / 面板 600px 档）下锚定弹层换形态（巡航设置用 `Dialog`，宽屏保持 popover）。
- **共用部件**（一律复用，不手写重复标记）：`ui.tsx`（Button primary/ghost/danger/**dangerGhost**+`size="sm"`+`pressed`、Section、Disclosure、Notice、Icon、Switch）、`Chip`、`Dialog`、`PromptInput`、`TimeField`、`Markdown`（`markdown-parser.ts` 安全子集，**勿改回全局 `g` 正则**）、`SessionRow`、`CommentsThread`、`session-panel.tsx`（SessionRailHead/SessionTranscript/SessionConfigEditor/SessionFacts/SessionWaitingNotice）、`session-chip.ts`（**状态 chip 唯一文法**）、`format-time.ts`（**时间文案唯一映射**：formatTime/formatDateTime/formatDuration/formatCruiseTime）、`cron-label.ts`（cron 文案唯一映射）、`automation-ui.tsx`（CronField/SessionRulesSection/SessionRuleForm/**AutomationEditor**/scheduleSummary——**自动化唯一 UI**）。
- **动效唯一语法**：注意力 = `--dsh-tb-attention` + `--dsh-tb-breath`；卡片外层呼吸环（`.card[data-unviewed]`/`.card[data-active]`）、会话行内层柔晕（`data-glow` 绑定、pause 而非 cancelled——永不闪烁）、浮层入场 `dshTbDialogIn`。**`prefers-reduced-motion` 分两类**：**装饰动效**（入场/hover/FLIP/smooth scroll）静态降级；**功能性状态指示器一律存活**——脉冲幅度是令牌（`--dsh-tb-breath` / `--dsh-tb-breath-spread` / `--dsh-tb-breath-halo`，keyframes 内引用），reduce 下**只重定义令牌**（放慢到 5s、收窄幅度），**绝不对环/晕写 `animation: none`**（静止的黄圈读作"卡死"，与"进行中"真相相反）。判据：**动效本身即信息者存活，只为悦目者舍弃**。
- **光效规则表（呼吸显示与否的唯一判定，无例外）**：

  | 任务状态 | 卡片 | 会话行 |
  | --- | --- | --- |
  | 等待（处理/计划确认/提问） | 呼吸（waiting） | 呼吸（waiting） |
  | 进行中（板内/外源/续跑） | 呼吸（running） | 呼吸（running） |
  | 完善中 | 呼吸（refining） | 无 |
  | 已结束且未读 | 呼吸（未读） | 静默 |
  | 已读已结束 / 空闲 | 静默 | 静默 |

  「进行中」只由状态驱动、与未读无关（`TaskCard` `data-active`）。**未读信号只在卡片呼吸**（`markExecutionViewed`/详情打开清 `task.viewedAt`/`settleRefine` 自清单基线）——会话行不再渲染任何未读指示（点/晕），因为行旁边的卡片已有同一状态的呼吸，双处标记读作重复（用户决策）。外源轮从观察起视为 open（`sessionDisplay` 含 `external === true`）计入轮次集。
- **拖拽与落位**：插入条 = `drop-position.ts`（`insertionGapOf`/`indicatorTopOf` 纯函数）+ 行/盒内 22px 底部留白；**拖拽自动滚动** = `drag-autoscroll.ts`（滚动期间根元素 `scroll-behavior` 临时置 auto——smooth 与逐帧滚动打架）；**FLIP 落位 = 结构驱动**（`use-flip.ts` 比对列+索引的 DOM 结构，滚动/hover 永不触发；本地拖拽、详情换列、远端 applyRemote 三种驱动共用同一条动画）。**滑轨上的移动必须可见**：跨列命中先把目标列滚入视野再播动画。会话排序**只有按住拖拽**一条路径。
- **卡片永不穿模（板上任何内容的硬契约）**：① 卡片盒 `overflow: hidden` 剪辑地板；② 所有 flex 子项 `min-width: 0` + 截断/换行链路（`cardTime` 可收缩、标题/描述 `overflow-wrap`）；③ 徽章两槽位文法——`Chip`：文字进 `.chipBody`（ellipsis）、前导图形进 `.chipLead`。`tests/card-contract.spec.ts` 钉死。
- **UI 小规则**：一个语义强调色（`--dsh-tb-accent`）+ 四个状态色（attention/success/danger/neutral），全令牌；半透明 `color-mix(in srgb, 令牌 alpha%, transparent)`，alpha 22%/10% 两级；4px 节奏、圆角 8/12/16/24；字号：标题 13-14 + 负字距、正文 13-14、元信息 12（同排不混字号）；交互 `--dsh-tb-motion`(160ms)；hover `--dsh-tb-hover`；focus 2px outline（`:focus-visible`，裸按钮也纳入）；**同一排控件同级高**（按钮 28px / `buttonSm` 24px / 分段轨道 28px）。
- **响应式与触屏（改窄屏/触摸问题先读这里）**：① **响应式参照 = 表面自身的宽度，不用视口**——`[data-dsh-taskboard-view]` 设 `container-type: inline-size` + `container-name: dsh-tb`（带 `-webkit-text-size-adjust:100%` 抗 font boosting），板体几何断点全写进 `@container dsh-tb (max-width: …)`（compact 680px）；**评审家族锚定面板自己**——`.review` 声明 `container-name: dsh-tb-panel`，头部/堆叠/列宽全部 `@container dsh-tb-panel (max-width: 600px)`（面板是唯一诚实参照：板宽而面板被 880px 封顶时头部照样该换行；面板不能查询自身，它的宽度内衬规则留在板容器 648px 档）；**板体布局永不用 `@media (max-width)`**。② **compact 列 = 自由横向滑轨** `flex: 0 0 clamp(200px, 46cqw, 320px)` + **列导航 tab 五等分具名 grid**（`.columnTabs` 基显 none、compact `repeat(5,minmax(0,1fr))`）；五等分只剩约一个半汉字的标签预算，故 tab 消费 `STATUS_SHORT_KEY`（`board.statusShort.*`，与全称同表的 locale 数据）、完整名进 `aria-label`、色点窄档让位（列头已有同色点）；**不用 scroll-snap**；**列身份是唯一真相、px 永远派生**：`activeColumnIndexAt`（位置→列）与逆运算 `scrollLeftForColumn`（列→位置，钳进可滚范围）两个纯函数承担全部换算，tab 直达与 `.columns` 的 ResizeObserver 宽度重锚共用后者（开合侧栏/旋转/分屏不再"往右偏一点"）；compact 底 `env(safe-area-inset-bottom)`。**板头 = 两行确定的成员归属，不是折行汤**：成员归组（`.boardModes` = 整理+自动化+通知+动态、`.boardState` = 运行/排队+引擎指示，状态零段省略——「排队 0」是噪音）；**主行动归属（relocation，禁重复）**：窄屏拇指栏（新建+铃+动态，复用同一处理器）出现即顶头双生隐藏（`.boardNewTask`/`modeDynamic`/modes 内铃 `display:none`）——一处行为，两处 DOM，每宽度只见一处；**导航行 = 返回 + 板名 … 空位 + 状态组 + 自动巡航 + 新建任务（右簇）**——标题紧贴左，状态/巡航/新建同贴右（状态坐巡航左边）；一次性动作永远最右；**工具行 = 筛选（左，与返回/板名同一条 x）… 空位 + 整理 + 自动化（右）**。compact 各自确定性地换行，且**换行由具名网格区域说**：导航行 = `"back title cruise" / "state state state"`（巡航是常态开关、占第一行右——曾经和新建并排的算术 `28+132+96+24=280` 把标题压到 16px，所以新建下沉拇指栏、巡航独占右端；状态是通告行、有内容才出现，无内容时 `:not(:has(.boardState))` 收成单行、不留死空），工具行 = `"modes" / "search"`（模式组只剩整理/自动化、左对齐与返回/筛选同 x；筛选独占整幅白长条）。**宽档推右靠唯一 `.boardSpacer`（flex:1），绝不用 `margin-left:auto`**（auto margin 只右对齐所在行首项，一换行即散架）；**标签一律保留**。③ **触屏 = 桌面 parity**：交互一件不改，`@media (hover: none) and (pointer: coarse)` 块**只承载隐形人体工学**（`::before` 热区 ≥36px、色点 24px、输入 16px 防缩放）。④ 行为/结构开关只认 `use-narrow.ts` 的唯一信号 **`useSurfaceNarrow(selector, maxPx)`**（ResizeObserver 量 CSS 容器查询同一个表面，JS 与 CSS 永不分歧——评审面板折叠默认态与巡航 popover↔Dialog 共用它，分别锚 `[data-dsh-taskboard-panel]` 600px 与 `[data-dsh-taskboard-view]` 680px，与 CSS 断点同值；视口代理 `useNarrow()` 已冻结为 `@deprecated`——中窗口 + 侧栏打开时视口说"宽"而表面已经堆叠，任何形态开关跟视口走都是错的）。绝不自己写 matchMedia/宽度猜测。⑤ **会话行 = 具名 grid，可选成员绝不靠自动落位**（`.sessionRowTop` = lead|chip|act 三槽，端线同文法——chip 与动作同一列 x；compact：动作收图形(`.rowActionText`→无、`.rowActionIcon`→显)后 lead 拿 `minmax(0,1fr)` 整余轨，**`.sessionRowLead` 是单轨具名网格 `"identity"`、身份块显式 `grid-area: identity`**——曾经的 `12px minmax(0,1fr)` + 自动落位，在链接行（从不渲染未读点）时把整块身份推进固定 12px 轨 → 名字轨 0px → 标题只剩一个字、工作区消失：**「可选成员占固定轨」是结构性 bug**；lead 里无任何带偏移的徽标——**会话行未读指示已整体移除**（见光效表：未读只呼吸在卡片），故每行左边界恒等；identity 网格 = icon+标题 line1 / **工作区跨双轨 line2**，chip `padding-left:0`——**图形、工作区、chip、meta 同一条 x**，行内 4px 节奏；动作键 `align-self:start` 对标题线。⑥ **滚动跟随 = 一条机制**（`use-transcript.tsx`）：`resolveScroller` 按**「谁被声明为滚动体」**（自身或最近祖先 computed `overflow-y: auto|scroll`）判定，**绝不看"此刻能不能滚"**（内容短时向上逃逸到祖先 = 「跳转范围错误」的根因），`useFollowScroll`（解析根 + window 捕获阶段 scroll 监听 + 在底跟随 + ResizeObserver 同盯内容与根）被转写尾与评论线程共用——"谁是滚动根"怎么变都不用改代码。⑦ **滚动条、内衬与截断归属**：可见条只属于贴表面边的滚动体，横向内衬由滚动体自持（评论滚动区 `.commentsScroll` 自持内衬，其内成员**不再加第二重内衬**——`.commentsScroll .interactionCard` 清掉 margin；`.interactionCard` 只留纵向 padding）；**一条表面的内容线只有一个令牌**（rail = `--dsh-tb-rail-inset`，每个成员**至多引用一次**：折叠体自带内衬时其折叠行不再补 margin，反之亦然）；容器不得用 `overflow: hidden` 裁文字以外的东西，截断永远归文字子槽（`.boardStatusText` / `.chipBody` / `.sectionHead h4`）。⑧ **评论/会话面板结构（双端同一组件、同一 DOM；挤压/裁切/卡中部/跳转范围的根解）**：`SessionRail` 交出**两块**——`.sessionRailFolds`（状态行 + 配置折叠 + 评论折叠）与调用方的 `.reviewComposer`。**宽档**：rail = flex 列 `[folds flex:1 1 auto + min-height:0] → [composer flex:none]`；folds 内 `.sessionRailHead`（**Disclosure**，展开 = **完整渲染**，无 max-height、无内部滚动条）与 `.sessionRailComments[data-open]`（**Disclosure**，展开 `flex:1 1 auto`+`min-height:0`，内含该档唯一滚动体 `.commentsScroll`，`scrollRef` 挂它）。**窄档（`@container dsh-tb-panel ≤600px`）**：rail `display:contents`（只 clip 不滚——含 composer 的滚动面就是"发送框被推走"的机制本身，contents 元素声明滚动则是 `resolveScroller` 会走进去的谎），`.reviewBody` = 三行网格 `minmax(0,auto) / minmax(0,1fr) / minmax(0,auto)` = `"folds" "transcript" "composer"`。三条不变量：**① 每行要么缩到 0 并自己滚、要么是中间那条 1fr——不存在"裁了又够不着"**（固定百分比轨两处翻车：折叠收起时白占高 = 死空带；不可缩的 auto composer 在软键盘 + 长草稿时把三轨顶过面板被 `overflow:hidden` 剪掉发送按钮）；**② 折叠体永远完整渲染，滚动归所属区域这一个声明体**（窄档 `.commentsScroll` 改 `overflow-y:visible` 让给折叠区，不套娃）；**③ 排布由具名区域说，绝不用 `order`**。窄档两折叠**默认收起**（对话 + 留言是首屏），挂起提问**强制展开评论折叠并立刻滚到该卡**，强制展开期间折叠行 inert。默认态与几何共用一个参照：`useSurfaceNarrow('[data-dsh-taskboard-panel]', 600)`。**头部**：宽档一行 = 标题+徽标 | 上下文头(flex none ≤320px，锚头下) | 刷新/查看会话 | ×；窄档两行 = 标题+徽标+×（× 内联贴右，**绝不绝对定位**；标题单行 ellipsis，全名进 tooltip/aria）/ 上下文头(左)+动作(右)；窄档上下文展开即内联限高 240px。**发送区自我说明**：排队/插话与拒绝原因的行归 **composer**（折叠默认收起时它是触屏唯一可达的解释，⑩）。**高度份额不用容器/视口单位**（`cqh/cqb/vh/dvh` 禁；`%` 只用于参照为 definite 高度的网格轨道）。
⑨ **表单行「让位不压扁」**（见硬性规范 10）：放输入的轨道一律 `minmax(0|Nch, 1fr)`，可伸缩成员带地板（`.scheduleInput flex:1 1 140px`）且行 `flex-wrap`；层级一律**具名 grid areas**，**禁用 `margin-left:auto` + `border-left` 充当靠右**；**区块标题行（`.sectionHead`）双端恒为一行**（`"title action"`）——让位的是标签文字（`minmax(0,1fr)` + 省略号三件套），绝不把动作簇换到第二行拆散"标题 + 按钮"这一对（「会话规则与新增会话规则在电脑端一条水平线，手机端不是」）；下拉箭头内缩唯一令牌 `--dsh-tb-select-arrow-inset`；弹窗次级动作归底部动作行。⑩ **说明必须可达**：触屏无 hover，必要信息不能只挂 `title=`（引擎指示是 `button` + Dialog，见 `board.engineNoteOk`）。`tests/mobile-contract.spec.ts` + `review-page.spec.ts` 钉死以上全部。
- **对齐与节奏的三条宪法（治「间距这里和别处不一样」整类）**：① **不继承媒介的间距**——`[data-dsh-taskboard-view] p { margin: 0 }` 一处清零 UA 的 `1em`；版面节奏一律由 `gap`/`margin` 显式声明，作为布局行的 `<p>` 绝不靠浏览器默认值（那正是"会话 3 下面一大片空、按钮不贴会话列表"的来源：隐形 16px×2）。② **偏移必须派生**——两个不同高度的成员要光学对齐时，写 `calc((行盒 − 控件高) / 2)`（消费 `--dsh-tb-hint-line` / `--dsh-tb-button-h-sm` 令牌），**绝不手写 ±3px**（数值对、符号反 = 偏 6px 且改字号即失效）。③ **可选成员不得占固定轨**——网格里有"可能存在也可能不存在"的成员时，该网格必须具名区域并把主成员显式落位；自动落位 + 固定轨 = 一行一种几何、另一行另一种（手机会话行标题塌成一个字的真因）。
- **加载反馈文法（loading ≠ failed ≠ empty，三态各如其分）**：任何异步读取面首帧是安静的「读取中」（`review.configLoading`），**绝不把在途渲染成红色失败**（「会话配置暂不可用」误报的根因）；失败 = 原因行 + **行内重试按钮 + 一次自动退避重试 + 回前台重试**（`SessionConfigEditor`；转写尾同理：3s 轻轮询的任何成功即自愈 error，`use-transcript.tsx` 的 `settle` 是单一结算口）；空 = 空态文案，不是错误。

### 核心层（`src/core/` 纯逻辑 + 关键职责）

- `tasks.ts`（状态机/COLUMNS/plainRunsOf/latestExecutionOf/chainUnlimited/taskExecutable/`newExternalRound`）· `schedule.ts` + `scheduler.ts`（cron 分钟 tick + cruiseTick）· `cruise.ts`（巡航窗口 v4）· `presets.ts` / `run-presets.ts` · `automation.ts`（会话规则 + 就绪语义）· `colors.ts` · `session-list.ts`（taskSessionsOf/orderedSessionsOf/sessionWindowOf）· `session-display.ts`（waiting>running>settled + viewedAt 基线 + nativeRunning）· `comment-thread.ts` · `question-rpc.ts` · `store.ts`（ledger 归一化）· `execution.ts`（投递与结算 + `createSession`）· `controller.ts`（台账 + 统一并发调度器 + 引擎席位 `setEngine`/`applyRemote` + 外源轮双通道 `recordNativeTurn`/`scanExternalActivity`）。
- **运行态与会话集合唯一推导** = `task-live.ts` + `linked-sessions.ts`：`relatedSessionIdsOf(task, linkedIds)`（refine → session 绑定 → 执行轮 → linked，去重稳定序；一切相关面只经此推导）；`taskLiveStateOf`（waiting > running > idle，running 以相关会话原生 `byId.running` 为真相）。`deriveLinkedSessions`：**链接行只来自显式 session 绑定**——工作区绑定是来源/配置关联，**永不派生成员会话**（有意的产品语义）。**原生归档即时同步**：`taskSessionsOf` ctx `archivedOf` 是唯一过滤点（读 `workspaces.list` 归档集），归档会话的行整体离卡、`linkedOf` 同源收缩（相关集/计数/liveState 同帧一致），轮次保留、取消归档带历史回来；行派生自原生真相非台账→两端零延迟。
- **原生活动检测** = `session-activity.ts`：外源轮 + **每运行期恰一轮**——实时通道为 `api-session/activity` 唤醒（`activity-wake.ts`：直达事件 + list `updatedAt` 推进双通道 → `controller.recordActivityWake` 记戳 → 调度 reconcile 读尾；legacy live frame（`nativeTurnOf` 解析，直达 `controller.recordNativeTurn`）保留为旧宿主快路）；兜底为**状态式**扫描（相关会话当下在跑且本期未消费即记轮，覆盖加载时已在跑/断流窗口；`book.recorded` 按运行期消费、会话回落 idle 即重新武装），各通道经**轮次锚点**（`ExecutionRecord.anchor` = 启动该轮的 user 消息 seq）跨通道/跨设备/跨引擎交接幂等去重；正文 = `latestUserMessage`（纯图片 → `imageOnly` 占位）。外源轮不排队/不注入、驱动卡片「进行中」、跑完经普通结算落「待审核」（`EXTERNAL_SETTLE_GRACE_MS` 内无回合证据 = 噪声取消）；主动添加（拖入源/新建/选入）经 `reconcileBoundTask` **即时同步当前实况**（当下在跑即记轮 + 未读呼吸；空闲不虚构，忙闲判据 = `sessionIsBusy`）；一切写入在 await 之后以**当前记录**重建并复查守卫；已完成的过去回合永不回补。
- **同步域（多端一致的地基）**：`board-doc.ts` = **BoardDoc + 合并文法唯一居所**：逐记录以**作者声明**裁决——commit 携 `changed`（本副本相对基线内容移动过的 id 集，`changedIdsOf` 得出），claimed 无条件接收（host 串行到达序 = 后到者胜，**设备时钟不参与裁决**；内容相等的 claim 是 no-op），未 claimed 维持 LWW，删除带 `baseUpdatedAt` + 墓碑（at=所见最新+1），`stamps` 记 host 接收钟。**读态不是作者**：`viewedAt`（任务级与轮级）在 claim 比对前剔除（`authorshipKey`）——"点开卡片"不产生声明（否则陈旧副本凭一次点击覆盖引擎刚记的外源轮）；读态走**单调 max 合并**（`mergeReadState`），只前进不回退。**section 层同构**：commit 携 `sectionClaims`，claimed 无条件接收 + host 时钟落 at、未 claim 的基线副本一律跳过；无该字段回落纯 LWW。`normalizeBoardDoc`/`normalizeCruiseValue` 把介质的值当数据不当真相。`host-sync.ts` = `BoardSyncClient`：boot 一次性迁移（host 空 → 整视图 bootstrap；非空且分歧 → 按记录联合并入、section 归首写者、分歧整视图 `onBackup` 停放）、claims 逐次累积 / 全量 ack 后清空、去抖提交（在途合并 / trailing refire / 失败退避）、SSE + 轮询 + 重连汇入单一 resync、引擎租约（见「多端同步」）、`requestLaunch`、`hostProtoVersion()`；`Synced*Store` = 既有 store 接缝 over 共享文档 + 本地镜像。**用户意图写必经 `controller.userEdit(taskId, mutate)` 单一漏斗**（返回新对象即结构上强制 bump `updatedAt`；引擎派生写与读态写不走它，各有新鲜度语义；排序被挤位的 sibling 也补 stamp）。

### 关键不变量（避免重造已有机制；改前先读对应文件）

- **多端同步（host 唯一真相 + 引擎租约，一切数据一致性问题的根解）**：看板真相 = host 的 `BoardDoc`，localStorage 五键降级为离线镜像/草稿/备份。浏览器 = 乐观副本：本地写即时生效，经 `store.save → Synced*Store → BoardSyncClient` 去抖提交，**host `applyCommit` 合并后返回权威文档，所有副本向它收敛**；远端变化经 SSE（+ 轮询兜底 + 对账）→ `controller.applyRemote`（**永不回写**——回写即回声）。裁决文法见「同步域」。「添加已有会话」与侧栏拖入同走 `addTaskSource`。**引擎租约**：host 内存租约（TTL + 任何 API 命中续期 + 断流宽限期提前过期），**只有引擎端**跑 dispatch 泵/scheduler tick/reconcile/外源轮记轮/cruise 翻转/settledFollowUp+链续；非引擎端 = 纯视图 + 提交器（用户动作照常写台账，由引擎泵出；手动执行经 `requestLaunch` → host `/command` → 引擎 SSE，无引擎时 park 重放）——单泵 = 单并发预算 = 多端绝不双发（含双标签）。**席位跟可见性（双向即刻）**：`/lease` 携带 `active`，**转后台立刻写 `active:false`**（不等心跳），**可见端可从不活跃持有者抢夺席位**（双可见端不互抢、全后台维持最后持有者让定时照跑），回前台立即续租+resync——引擎永远坐在用户正看着的那台设备上。**流活性有界**：SSE 计数只在距持有者上次真实 HTTP touch `STREAM_ALIVE_MAX_MS` 内续命（半开 socket ≠ 活着）。**协议版本 `LEASE_PROTOCOL_ACTIVE` 与服务端启动时刻 `bootedAt` 随 LeaseState 下发**，且 **LeaseState 只有一处构造**（`leaseState()`；被拒分支 = `{...current, held:false}`，只翻调用者相对的旗标）——`proto`/`bootedAt` 是**必填类型字段**，漏字段直接编译不过（被拒分支曾手拼漏 `proto` → **每一个非引擎端**都从当前服务端读出"旧服务端"，重启多少次横幅都在）。线路上是 `LeaseWire`（旧服务端可不带，缺席本身就是证据）；**席位通知 = (held, proto, bootedAt) 元组变化**，任一半移动都触发 seat 监听 → `controller.setHostProto`/`setHostBoot`（相等不 notify），横幅因此**实时清除**而非残留到一个手动刷新；`hostProtoVersion()` 在首租应答前返回 **undefined**（未知 ≠ 旧，绝不误报），controller 默认取 CURRENT。旧 host（无版本）= 抢夺不生效，板头据此提示。**板头引擎指示**：同步模式且本机非引擎而有排队/待注入 → 提示"引擎在另一端"；空闲永不唠叨。**提示必须可查证**：过旧弹窗显示**该服务端进程的真实启动时间**——"我明明重启了"只有两种答案（确实是旧进程 / 地址连到另一个未重启实例），一个时钟读数当场判定。**投递看门狗**：见「车道」的"清扫与年龄"——清扫覆盖每一条在跑轮（含停车卡的与从未绑定会话的），`resolveCardDrop` 拒绝带在跑轮离列。question tracker 每端独立流（先到先答，官方语义）；drafts 刻意设备本地不同步。storage hub 缺席 → 回退 localStorage 模式，功能不降级为错误。
- **统一会话与评论单轨**：相同会话 = 同一条线程（`sessionCommentsOf`）；直发/驱动/评论并轨为一种留言；发送两态 = 排队（调度器/巡航/FIFO，可取消）与插话（`steerComment` 立即送达）；**发送模式只由用户开关决定，附件绝不改变它**——带附件的排队轮把附件存在轮上（图片 = `ExecutionRecord.promptImages` 临时字节，文件 = `promptFiles` 的 `{receiptId, name, bytes}`），调度器注入时 text+附件一起发（`sendComment` 面收 images + files 参数），绝不为「有附件」而强制直达（曾经的 bug：选排队发图却立刻发出）；带附件的插话经 `steerCommentWithImages` 直达；线程对携带附件的排队轮显示「含 N 张图片 / M 个文件」；**附件两条官方链路**：图片 part 是 `{type:'image', mediaType, data(base64), name?}`——浏览器送临时字节、**host 做持久 admission**，故 composer 的 `DraftImage` 经 `toPromptImage` 直发（`PromptImage` 贯穿 sessionMessage/steerCommentWithImages/sendRawMessage/sendComment），**绝不自建附件桥/上传路由**（自造 `{type:'image', attachment:{…}}` 不在合法 union 内、host 必拒）；文件 part 是 `{type:'file', receiptId}`——浏览器先经官方 `fileUploads/upload` 把**原字节**分段上传到**同一会话**（receipt 按 Agent 作用域，跨会话必须重传；任务 prompt 的文件只存 name+bytes，发送时重 staged），`DraftFile` 经 `toPromptFile` 取 receipt；admission 后的存储形状才是 `{type:'image', attachment: ImageAttachmentRef}`——`contentImagesOf` 折叠提取（去重、坏 part 跳过、纯图消息不丢），`MessageImage` 经官方 `sessions.attachment` 读回 base64 渲染缩略图（复用 `createTranscriptReader`）；客户端白名单/20MB 上限与就近 `.formError` 保持，附件条独立成行、动作行恒单行。
- **插话与任务运行态（单一推导）**：发送层 mode 参数化——`sessionMessage`/`sendRawMessage`/`commentRun`/driver.prompt 都收官方 `'queue' | 'steer'`；**三入口统一**（评论线程插话 → `steerComment`('steer')；会话规则 `send:'steer'` → 建轮**即带 injectedAt**〔dispatch 按注入标记过滤，杜绝同一轮双注入〕+ 立即注入；直接留言/交互卡回答不走此层）。**运行态与相关会话集唯一推导 = `task-live.ts`**：`sessionDisplay` 以 `nativeRunning` 把「settled 轮但会话真在跑」显示为 running（waiting 仍最优先）；`reconcile` 的 `driveLiveStates` 驱动**直发轮**（settle-at-birth 无事件路径）——会话跑 → 卡片进进行中，会话停 → 落「待审核」并走**同一条 `settledFollowUp`**；板内各轮事件结算路径不变（`isDirectLike` 只认已结算直发轮）。**一致性铁律**：行徽章（liveState）与卡片列（台账轮次）必须同涨同落。
- **官方 @ 引用机制（唯一桥 = reference-source.ts）**：所有输入框共用同一桥——与主界面 ui-reference 相同的两个 Remote 命名空间（`remote.fileReferences` + `remote.sessionReferenceResolver`，缺面降级为无 @ 菜单）。**官方身份政策（不可绕过、勿在代码里绕，参见 README 能力边界）**：目标会话为子代理路由会话（`origin === 'subagent'` 或挂在活跃父代理下）时宿主对一切通用 RPC 返回 `agent-busy`，官方 composer 同败（官方语义，无修复版本）。**插入全用官方文法**：`file-reference-grammar.ts` 与 `session-mention.ts` 为官方包**逐字镜像**（打包门禁禁跨插件值导入，契约测试钉死）；会话引用 = `@[label](dsh-session:…)`，解析全走官方链路。作用域：`PromptInput` 以目标 `sessionId` 唯一解析（`referenceSessionOf`）；`@"` 引号路径内不弹会话候选。**失败契约**：`listReferenceRows` 永不 reject（两域独立降级、坏行跳过 `diag.skipped`）；官方 log-only——菜单**绝无失败文案**，唯一例外 = 会话域官方失败时**降级为板内目录行**（`referenceSessionCatalog` + `catalogSessionRowsOf`：排自身、上限 50、插入仍是官方 mention；只降级"发现"，解析 100% 官方）；两域皆成功且真无候选才显示 `prompt.noReferences`。**菜单三文法（纯函数）**：能力门 `referenceMenuAvailable`；空态文案专属；`continueAfterPick` 只在目录下钻（`@"路径/`）重开菜单。
- **原生交互卡 + 上下文块**：agent 挂起时 `InteractionCard` 实时弹出，**回答走官方 pending 问题通道**——0.1.5 机制 = 只读订阅 `uiSession.pendingInteractions` 快照（board 永不注册 waterfall listener、不发布、不回答——waterfall 是先答者赢的认领链，注册即与官方 composer 踩踏；回答动作 = `sessions.open` 跳回原生会话；`PendingMirror` 适配为控制器的 `QuestionRpcFace`，`answerInPlace=false` 时卡片为只读 + 「去会话回答」单按钮）。普通留言不解决挂起提问。to-do 读**官方 `todos` projection**（与原生 TodoPanel 同源、宿主升级自动跟随；投影缺席降级事件解析）；用量读**官方 `tokenUsage` projection**（整日志累计——分页窗口的 `sumUsage` 只在 meter 包缺席时兜底）+ **`sessionStats` projection**（轮/步/模型与工具耗时行）；goal 读**官方 `goal` projection**（`core/projections.ts` 结构化透传：`null` = 已清除，`complete` 不显示；子代理与无 projection 的宿主走 session-state 桥，缺面即降级）。`SessionContextBlock` 常驻评审/会话面板**头部**（宽档 = 标题与动作之间一行、浮层锚头下展开；窄档 = 第二行左件、展开是**同一套浮层**——锚整头、全头宽、240px 封顶内滚、滑到动作下面，**永不在格子里 in-flow 展开**（格内展开即"左半格挤右半格"）；完善面板保留 in-flow 浮层形态；chevron 走全局折叠文法（折叠朝右/展开朝下）。**有未完成的才显示**：`contextWorthOf` 唯一判定——todo 任一未完成 / goal 活跃 / 子代理未完成（status 缺失按进行中算）；全完成才整块隐藏。**行文法**：标记 `flex: none` 贴首行（`align-items: flex-start`），文字进 `.chipBody`。**goal 行是可操作的 strip**（`GoalStrip` = 板上 GoalBar：阶段 chip + 目标 + 暂停/恢复/行内编辑/清除，经官方 `remote.goals` 动词、CAS ref 调用时从 live binding 现读、失败行内显示；complete/已清除渲染空；activation 经 `goal/activation-changed` + `goals.get` 初值，轮询重刷同 id 保留；无 `remote.goals` 面降级只读行）。**桥读原生形状**（session-state-route，`listChildren` 按父会话 id）：goal = `{objective, phase}`（phase complete 即不返回）；子代理 = `{label, activity}`（只返回在跑的 child；inactive = 已结束）。
- **多源绑定（拖入 = 添加，绝不刷新替代）**：`TaskRecord.binds: TaskBind[]` 是真相源；所有读者走 `taskBindsOf(task)` 投影；`copyTask` 不复制 binds 与会话规则（模板语义）。**session 绑定 = 会话出现在卡片上**；**workspace 绑定 = 仅来源/配置关联，永不派生会话行**——唯一例外是文件夹拖入**创建瞬间**的快照：按注册表自己的归属账本（workspace 行的 `sessionIds`，显示序）一次并入当前可见未归档非空白成员（用户拖的是"文件夹连同里面正在跑的东西"，不是空壳；同名文件夹的会话绝不混入——账本是唯一成员真相，不做 cwd 猜测；无账本的旧宿主才回落 cwd 扫描；之后新建的会话永不自动并入，归档即离行）。每次快照打一行命名日志（took/skipped 明细），"会话哪来的"永远可查。隐藏托盘「删除」= 从任务移除（`removedSessions`，其轮次同删）；**再拖回可恢复**（`addTaskSource` 清 removed）；工作区重新绑定不恢复任何会话。**`removedSessions` 是权威「非相关」门**：`taskSessionsOf`/`linkedOf`（显示）与 `relatedSessionIdsOf`（运行态/外源轮/rename 守卫/添加候选）一律减去它，被删会话重新成为「添加会话」候选。
- **完成态留言自动移回「待办」并驱动**（`reviveTaskIfDone`，queue/steer 同规则）。
- **真执行自动补全（缺则补、填则守、写入与发射点唯一）**：新建任务 标题/描述/执行 Prompt **全可空**（空 Prompt 只让任务惰性——真正运行/接续链被 `taskExecutable` 门禁拦截，创建不受限；未命名卡片显示 `card.untitled`）。**AI 完善需求是空 Prompt 的正道，但不是无米之炊**：`refinable`（标题/描述/Prompt 任一非空）是 `startRefine` 的硬门禁，全空任务按钮置灰 + 行内 hint（空指令发出去只烧一轮、别无产出）。**完善永不碰列**：refine 轮是 backlog 列内的准备——`settleRefine` 保列；显示层用 `executing`（排除 refine）判定"进行中"，`hasOpenRun` 只留作阻塞语义（run 门禁、并发预算、拖拽规则、reconcile 可驱动）；首轮 sessionId 待绑定窗口的原生 running 不记外部轮（未绑定即不归属）。**唯一作用点 = `supplementedTask`**：任务被写入（createTask/createBoundTask/updateTask）或真正启动（launchTask——一切发射路径）时，空标题/描述从执行 Prompt 补齐（标题 = Prompt 第一非空行 trim + 40 上限；描述 = 整个 Prompt trim）；已存在字段**永不覆盖**；评论轮/完善轮/外源轮不触发。
- **车道 = 会话，卡片只是聚合（一切「为什么还在排队」的根解）**：**唯一判定** `tasks.ts:isOpenRound`——按种类枚举：普通轮 / refine 轮 / **外源轮（原生发言：它带 `comment` 只是留言正文，不是"排队中"）**= 未结算即在跑；评论轮 = **已注入**才在跑（保存未注入的留言不占槽、不让会话忙、不显转圈）。派生 `openRoundsOf` / `sessionIsBusy(task, sessionId)` / `hasOpenRun`（还有任何一轮在跑，**绝不看"最后一条记录"**），以下每一处都必须复用它，不得再写第二份：
  - **并发预算数轮不数卡**（`inFlightCount`）——「并行数 3」= 三个会话同时跑，也就是唯一的节流阀（旧的 per-card 齐发保护改由它承担；设 1 即严格串行）。
  - `nextEligible` 评论与规则两车道都**按会话取头**：忙车道绝不静默旁边空闲车道；**一条 lane 一个有序队列**（留言与规则指令在同一会话上互不插队）；**未绑定会话的在跑轮 = 车道未知，整卡暂不放行**（普通执行的会话由 `ExecutionService.connectSession` 异步解析——复用 workspace 自己的会话（官方 `sessionIds`）或经 `sessions.create` 新建；解析结果可能正交回卡上已在用的那条）。
  - **卡片只在再无在跑轮时离开进行中**：`settleExecution` / `driveLiveStates`（旧 steer 轮不得决定列，每卡只记一次完成边沿 `directFallbackRounds`）/ `resolveCardDrop` 三处同判据。
  - **外源检测同一判据**（`recordExternalRound` / `hasOpenRoundOn` / `reconcileBoundTask` 走 `sessionIsBusy`）——否则"会话在排队"被误当"会话在跑"，**吞掉用户在原生工作区发的消息**；反向：留言绝不插到正在跑的原生轮之前。插话（steer）按定义越过车道与预算（轮出生即 `injectedAt`，同会话两轮并存是有意不是破口）。**消费只认身份不认覆盖**：`inBoardTurnOn`（本板回合）veto 才消费运行期；`hasOpenRoundOn`（车道被占）veto 永不消费——占位会自己解除（结算/取消）而会话还在跑同一轮，先消费后解除=边被吃掉、卡片永不点亮（"刷新后进行中不亮"根因）；`reconcileBoundTask` 同理（一次只记一个，多余的进调度复检）。
  - **链的接续与恢复同源**（`maybeContinueChain` 与 `scheduler.ts` 都读「最后一条普通轮成功 + 卡片安静」，绝不看最后一行）：已排队就不重复计数；`cancelled/failed` 不续。
  - **清扫与年龄**：看门狗年龄锚 = `injectedAt ?? startedAt`（按保存时间算会误杀刚注入的轮）；未绑定轮超期判 cancelled（唯一清扫口，否则永久占槽）；`cancelSpuriousExternal` 扫**每一条**在跑外源轮。
  - **reconcile 的自动化副作用要二次确认 `this.engine`**（await 期间席位会因可见性迁移，被废黜的端绝不 launch）。
  - **一条 cron 规则一个到点一个轮**：lane 忙则把到点滚到下一格，绝不叠第二份。
  - **「排队中 · 第 N 位」数本会话车道且不含已注入的轮**（`queuePositionOf` 按 `sessionId ?? sessionAnchor` 分组）。
  - **卡片结果一律 `lastPlainResult(task)`**，绝不 `latestExecutionOf()?.result`（最后一行常是留言/外源轮，曾使同一张卡一端显示失败、另一端显示成功）。
  已知残余限制：`board-doc` 的认领是整条 task 记录级，两台设备同时往同一张卡追加轮次仍可能后到者覆盖前者（修法 = executions 按轮次 id 并集 + 显式删除集，属同步文法改动，未做）。`tasks`/`controller`/`comment-thread`/`scheduler` 四 spec 钉死以上。
- **自动化两半互不干扰 + 完成接续（链）**：任务级 `schedule`（按时间表/完成后接续）与会话级 `rules`（指令 = 自定义或任务执行 Prompt（usePrompt，发送时取当前值非快照）；触发 = cron 或 on-complete）字段正交、语义独立（controller 单测钉死）。UI 唯一 = `AutomationEditor`（板与详情同一份；**启用开关只在编辑器内**；总览卡片 = 身份头 + 一行摘要 + 展开体）；分节用 `Segmented`。**on-complete = 永续循环**：**任何一次完成结算**（普通执行/用户评论轮/外源轮；完善轮与规则自己的轮除外）都触发，不受列暂停约束；**所有结算路径共用同一条 `settledFollowUp`**。规则轮走**自动化车道**（ruleId；`nextEligible` 优先、**不受巡航开关约束、绝不等巡航**；全局 FIFO + 预算；每规则在途至多一轮）；规则自己的轮**成功**结算即续下一轮，直到关闭/删除/会话消失/内容不可用；失败/取消不续；手写评论（无 ruleId）不触发。**链语义**：武装即开跑（`setSchedule`：`enabled && chain && 可执行 && 无在途轮`，任意列）；每次普通执行**成功结算瞬间**接续下一轮；**手动移动卡片（除 done）绝不解除武装**；`done` = 硬停；预算到顶自动解除。**显示真相**：已启用未触发 = 「等待任务完成触发」chip；排队/插话只是模式标签绝不误读为进行中；**每会话至多一条规则**；老数据归一化为 cron + 自定义指令。
- **巡航窗口 v4 文法**：**总开关主权**——`enabled` 是当前状态；窗口是计划表，只有「开始/结束时刻」越过时翻转开关；**增删窗口绝不动开关**（唯一例外：新增「只填结束」窗口，其开始时刻 = 创建时刻）。窗口 `{startAt?; endAt?}` 三态（都填=区间 / 只填开始=到点开并保持 / 只填结束=创建即开到点关）；列表**自动排序**（`sortWindows`：立即开启→按开始→按结束，开口最后）；每窗口一行文法（`cruiseWindowLabelOf`——「开始 → 次日 结束」/「{time} 起保持开启」/「已开启 · 至 {time}」，完整时刻走 tooltip）；**「次日」只用于紧邻后一日**（`isNextDay` 按日历日）；**状态行永远一句话解释开关为何是当前值**（`cruiseStatusLineOf`）。校验 = `windowRangeIssueOf`（归一化后判定，跨午夜只支持一晚）；`normalizeWindow` 对非法范围绝不虚构次日。
- **校验反馈文法**：`inputInvalid` 是唯一错误边框（cron/select/PromptInput/数字共用）；会话规则表单按 会话→指令→Cron 顺序报**首个失败字段**专属文案（`auto.form.invalidSession/invalidInstruction/invalidCron`）；`saveFailed` 兜底「保存失败」。
- **卡片 = 纯状态摘要**：标题/描述/来源行（`cardSourceLabel` 单一推导）/更新时间/状态与自动化 chips；运行窗口与评论时间线只归详情页。**视觉对齐**：色点在标题行前（8px 圆点 + 5px 顶距光学居中；元信息贴卡片内容边——**不要用「固定槽位/gutter」整体右移**）、板头/列头圆点 `translateY(-0.5px)`；**选中态**：`.card.selectedCard:hover` 必须覆盖 hover，accent 双环 + 上浮 + 右上对勾徽章 + 120ms 入场。
- **执行 Prompt 空 = 全链路阻断（执行专用）**：`taskExecutable(task)`（严格 `prompt.trim() !== ''`）是唯一判定；`ruleReadiness`（cron）与 `sessionRuleReadiness`（仅 usePrompt 规则）给 `{kind:'blocked'}`（次序 disabled → blocked → paused(列) → active；**链模式跳过列暂停、自定义指令会话规则永不因任务 Prompt 为空而 blocked**）；`runTask` 单点拦截一切执行路径（手动/定时/巡航/链/拖拽重跑），**「完成后接续」武装**在 `enabled && chain && !taskExecutable` 时直接拒绝（不持久化——编辑器显示 `detail.promptEmpty`）；**评论与插话永不被 Prompt 门禁**（composer 只在会话消失时禁用）；**例外（不封）**：需求完善流程、mux 交互卡回答、在途开轮续评、绑定会话被动观察。
- **运行配置预设（自定义 + 默认应用）**：`src/core/run-presets.ts`（键 `dsh.taskBoard.runPresets.v1`）；内置不可删 `deploy-default`（空配置 = 部署原生默认）；**默认回退链** = `defaultRunPresetOf`（defaultId 缺失/悬挂/被删 → 一律「部署默认」）；UI 唯一 = **`RunConfigFields`**（预设 picker + RunConfigEditor 整块组件，TaskForm 与 NewSessionModal 渲染同一份）+ `RunPresetManager`（添加/编辑 = 名称 + 同字段自编辑、删除、设为默认），新建任务 `initialDraft` 应用默认预设（草稿优先）。
- **会话标题（与原生一轨，绝不打架）**：原生 rename = 官方「钉住」语义（`sessions.rename` 以 `user` 源追加 `session/title`——钉住标题、作废在途自动生成、后续消息永不自动改名；不命名则宿主自动命名链完整保留）。板内两条入口走同一官方写：**新建会话标题选填**（`createTaskSession` 的 `title`——填了 rename 钉住，留空什么都不发、交给宿主自动命名；失败 = `titleError` 部分成功）；**会话行重命名**（`SessionRow` → `renameTaskSession`，目标须是本任务相关会话，空标题拒绝，成功只 notify——标题真相在宿主 list，无第二份状态）。**未命名文法**：宿主未命名的会话行统一显示 `detail.sessionUntitled`（`sessionRowTitleOf` 唯一推导 + `untitledLabel` 注入）。**认得宿主的确定性自动名**：判据唯一居所 = `linked-sessions.realTitleOf(title, cwd)`——durable `title` 恰等于 `cwd` 的 project basename（`workspaceLabelOf`）即宿主 fallback 名、非真名，返回 undefined 走未命名文法。**两个读者共用**：`controller.sessionTitle`（执行行/面板头）与 `rowOf`（链接行）；`rowOf` 的标题槽只放真名，工作区名只属于它自己的 `workspaceLabel` 槽。
- **详情页新建会话（会话区「+ 新建会话」）**：入口住在「会话 N」**说明行右端**——说明（状态为该次执行自身的结果…）左、按钮右，**同一水平面**（按钮中心 = 说明首行中心，偏移按 `(行盒−按钮高)/2` 派生，见「对齐三条宪法」②），标题「会话 N」独占一行；按钮绝不插在标题与其说明之间；**说明行自身 `margin:0`**（否则 UA 的 1em 会在标题与说明、说明与会话列表之间各塞进 16px 隐形空气——"按钮不贴会话边界、上面一大片空"）；空列表也常驻，空任务有明确入口。`NewSessionModal` = `Dialog portal`（嵌套弹层硬性规范）+ `.modalScroll` 唯一滚动体，正文 = 选填标题 + 运行配置（初始值 = 任务自身配置）。链路 = `controller.createTaskSession` → `ExecutionService.createSession`（**保证全新会话**：face 结构化读取 + wire 兜底，face 缺失降级为复用 workspace 已有会话（官方 `sessionIds`））→ 按执行同序应用配置（model → agentPreset → `/permission`）→ 标题（官方 rename）→ `addTaskSource` 绑定。失败契约：创建失败 = ok:false、任务不动；配置/标题失败（会话已在）= 诚实部分成功 `configError`/`titleError`，会话保留、弹层内联展示，绝不回滚。新会话不是执行：无执行轮、不进调度器、不涉自动化。**Agent 行真相序（`sessionInfo`）**：宿主无预设读口（列表/models/投影三处皆无），显示读宿主字段即永远"部署默认"——真相序 = 宿主实发值（未来兼容）> 板子应用台账（`session-agents.ts`，两次 `selectAgentPreset.ok` 经 `onAgentApplied` 记录，本机键）> 缺席（诚实默认）；失败的应用永不记录。
- **交互卡/rail 永不横向爆框、纵向不挤**：rail 的 flex 子项全部 `min-width: 0`；行内按钮组可换行（`.interactionActions` flex-wrap）；卡片在完善面 `margin: 0 var(--dsh-tb-rail-inset) 2px`（rail 滚动体内该 margin 清零——内衬归滚动体，见「响应式与触屏」⑦）。**高度契约**：`.interactionCard` `max-height: 320px`（**px，绝不用 `40vh`**——卡片活在按板盒百分比定尺寸的面板里，视口单位量的是另一个盒子）+ `overflow: hidden`，正文在 `.interactionCardBody`（`overflow-y: auto; min-height: 0`）内滚动，**动作行钉在卡外永远可见**。**rail 的高度契约**见「响应式与触屏」⑧：宽档 = [折叠块(状态行+配置头+评论) flex:1 min-height:0 自带兜底滚动] + [钉底 composer]；窄档 = 三行网格（折叠区只长到自己内容的高度 / 对话 1fr / composer 独立行且可缩可滚）——**每个区域最多一个滚动体，发送框永远是自己那一格，任何情况下都不存在"被裁掉又够不着"**。
- **会话列表**：`orderedSessionsOf`（`sessionsOrder` 全量手动序；数组外新会话置顶（除非用户拖过））；板列与详情共用 `drop-position.ts` 插入条；详情列表拖拽用 `useDragAutoScroll`（滚动根 = `.detailBody`）。行文法见「响应式与触屏」⑤；执行行命名执行结果，链接行命名会话活动（未运行带 `detail.idleHint`）。**.sessionList 不容忍底部死区**：久置 `padding: 0`，只有 `[data-reordering]` 期间底部呼吸 14px 给尾部插入槽。
- **稳定性**：受控组件本地回退；composer 之上可滚动中区；就近 inline 反馈；订阅/轮询必带终止路径；正文永不省略（break-word），元信息可 ellipsis+title。
- **草稿覆盖矩阵（`drafts.ts`，键 `dsh.taskBoard.drafts.v1`，设备本地不同步）**：承诺 = "任何会随切换卸载、承载用户手写内容的输入面，未提交内容必须回来；提交/保存/取消即清槽"。现行键：`comment:<taskId>:<sessionId>`（评论 composer，评审页与链接面板共用同一身份）、`edit:<taskId>`（任务编辑表单，整份 TaskDraft JSON）、`refine:<taskId>`（完善答案）、`new`（新建任务弹窗）、`newsession:<taskId>`（新建会话标题 + 运行配置 JSON；损坏回落任务配置——草稿是便利非真相）、`rule:<taskId>:new`（会话规则 ADD 模式的指令；**编辑既有规则永不用草稿**）。瞬时单字段输入（搜索框、时间字段、选择器、巡航窗口）不入矩阵。新增输入面按同一矩阵归位，不另起存储。评论/完善 composer 的草稿是 v1 信封（文字 + 图片 + 丢失文件名，`composer-images.ts` 编解码，老裸文字兼容读）：图片 2.5M 上限自保整表（超了只留文字并明示），文件字节不可恢复、只留名并提示重加；附件 busy 文案只认在途 lane（`busyKind`），永不读落袋。

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
- **清单以 `tests/` 目录为准**（一名一个 spec，命名即被测模块/表面）。非显然分工：
  `host-sync`/`board-doc` = 同步文法与租约全状态机（**席位 (held, proto, bootedAt) 任一半变化都要触发监听**、首租前 proto 为 undefined、双客户端共享真实 `BoardDataService` 收敛）；`board-service` 含 **LeaseState 唯一构造点的机械禁令**，`board-http` 用真实存储 + 真实 http.Server + 真实 SSE 覆盖 fake 测不到的链路（**四种租约应答必带 proto+bootedAt**）；`question-tracker` = mux 问答流自愈；`transcript-cache` = 读取新鲜度层；`controller` 是唯一大文件（端到端，共享 harness 不拆分）；`review-page`/`mobile-contract`/`card-contract` 承载**全部 CSS 布局契约**（见设计系统层）；`file-reference-grammar`/`session-mention` 是官方包逐字镜像（打包门禁禁跨插件值导入）。
