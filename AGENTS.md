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
  cordis 插件形态存在。平台与用户名不写死：需要时用命令发现（如 `process.platform`、
  `os.homedir()`），不要假设具体值。
- 项目根目录：本文件（AGENTS.md）所在目录。任何需要项目路径的操作，用相对本文件
  的方式推导，不写死绝对路径。
- DSH 数据根：`$DSH_HOME` 环境变量优先；未设置时为用户主目录下的 `.dsh`
  （跨平台由 `os.homedir()` 推导）。激活 profile 为 `profiles` 下的目录（当前部署为
  `web`，以实际目录为准）；本插件经该 profile 的 `dsh.profile.bundles` 挂载（本目录被
  `link:` 到 `profiles/<name>/node_modules`）。
- `~/.dsh/cordis.patch.yml` 为 home 级 patch 层（合法状态：不存在，或顶层 YAML 数组；
  存在但为空会令 dsh 启动失败）；`~/.dsh/settings.yaml` 承载插件设置命名空间。
- 兄弟插件：本目录所在 `Plugins` 目录下、与本目录平级的其他独立插件（用目录扫描
  发现，不要假设固定清单）；它们与本项目完全独立、互不依赖、互不引用。
- 版本管理：本地 git 仓库（无远程），详见「版本管理流程」。
- 生效规则：host 半区改动需重启 `dsh web`；client 半区改动刷新页面即可。

## 项目定位

DSH Web GUI 的任务看板插件：侧边栏「任务看板」入口 + 中间列多列看板 + 任务经 DSH
会话机制真实执行 + 5 段 cron 定时调度。单一 npm 包，cordis 插件，host/client 双半区，
MIT 许可，全新独立项目（零历史仓库引用）。

### 命名矩阵（全局一致，新增标识不得偏离）

| 维度 | 值 |
| --- | --- |
| 包名 / 文件夹名 | `dsh-task-board` |
| 行 id（cordis.patch.yml） | `dsh-task-board` |
| 设置命名空间 | `dsh-task-board` |
| 设置路由 | `/api/dsh-task-board/settings` |
| 权限预设路由 | `/api/dsh-task-board/permissions` |
| 公告 section | `plugin:dsh-task-board`（order 200） |
| locale 命名空间 | `dsh-task-board` |
| 设置卡 slot id | `dsh-task-board`（`settings.plugin.item`，order 110） |
| localStorage 数据键 | `dsh.taskBoard.v1`（**不得改名**，用户数据依赖） |

挂载：`cordis.patch.yml` 声明 `dsh.bundle.patch`，经 profile `dsh.profile.bundles`
加载；安装命令 `dsh plugin --profile web add link:<本目录>`。

## 架构

### host 半区（DSH 主进程）

- `src/index.ts`：`inject = ['webServer', 'systemPrompt', 'settings']`；
  `installSettingsSection(ctx, settingsNamespace('dsh-task-board'), Config, ...)`
  注册命名空间（settings.yaml 持久化）并联动公告；`registerSettingsRoute` 注册设置路由、
  `registerPermissionRoute` 注册权限预设路由；`sync()` 按 `enabled`/`announceToAgent`
  注册/撤销 systemPrompt section。
- `src/host/settings-route.ts`：`createSettingsHandler(deps, ns)` 为纯函数
  （deps: `{describe, mutate, writable}`，可注入测试）；GET 返回
  `{available, value, base, user, writable, revision}`；POST 接收
  `{ops: [{op:'set'|'unset', path, value?}], expectedRevision}` 调 `settings.mutate`
  并回 fresh view；要求 `content-type: application/json`（防表单 CSRF）；
  服务读取一律 `ctx.get('webServer')` / `ctx.get('settings')`（不裸属性访问）。
- `src/host/permission-route.ts`：`createPermissionHandler(deps)` 为纯函数
  （deps: `{read}`，可注入测试）；GET `/api/<ns>/permissions` 返回
  `{available, options}`。权限选项**不写死**：每次请求实时读
  `ctx.get('permissionPresets')`（结构性窄化接口，不依赖 SDK 包）的 `names`/`optionOf`，
  服务未挂载则 available:false，DSH 更新预设表后自动适配。

### client 半区（浏览器）

- `src/client/index.ts`：`inject = ['slots', 'sessions', 'workspaces', 'connection', 'locale']`；
  `RouteSettingsScope` 持快照（status: loading/ready/unavailable，fetch 失败降级不抛）；
  设置卡注入 `settings.plugin.item`；`syncEnabled` 门控挂载；核心接线
  `BoardController` + `ExecutionService` + `SchedulerService`（localStorage 存储）。
- 挂载机制（无官方槽位可用，全部 DOM 级，失败只 console.error 不抛）：
  - 侧边栏入口：`[data-pane="sidebar"]` / `[class*="sidebarCol"]` 兜底定位，
    MutationObserver 自愈重插。
  - 看板视图：`[data-pane="conversation"]` / `[class*="centerCol"]` 兜底定位，
    列内追加容器 + `html[data-dsh-taskboard-active]` 显隐，对话子树保持挂载。
- 设置卡：`PluginSettingsCard`（始终渲染，不可用时显示提示）+ `CardForm`（staged
  表单，`booleanField` save 统一写）+ `TaskBoardSettingsCard`
  （enabled / announceToAgent）。

#### 设计系统层（板上 UI 的宪法，改 UI 先读这里）

- **令牌只消费原生语义层，不写死任何值**：所有样式引用 `--dsw-*`（`--dsw-alias-*` /
  `--dsw-specific-*` / `--dsw-static-*` / `--dsw-font-*` / `--dsw-shadow-*`）。这些令牌由
  宿主按浅色/深色与皮肤插件重映射，因此看板**自动适配主题与未来皮肤，零独立皮肤**。
  硬性：CSS 不得出现 hex/rgb 字面量（`scripts/verify` 前的 grep 审计为零）。
- **看板别名层**：`board.module.css` 顶部 `[data-dsh-taskboard-view]` 定义 `--dsh-tb-*`
  （边框/圆角/阴影/文字层级/状态色/动效时长），全部派生自原生令牌；组件样式统一引用
  别名层，保证「板上统一值只改一处」。侧栏入口与设置卡在 scope 之外，只用原生令牌，
  不得引用 `--dsh-tb-*`。
- **共用部件（`src/client/board/ui.tsx`）**：`Button`（primary/ghost/danger）、
  `Section`（详情区标题统一）、`Notice`（等待提示中性框 + warn chip）、`AttentionDot`
  （未读圆点）、`Icon`（内联 SVG 集中）。`Chip` / `Dialog` / `PromptInput` /
  `TranscriptTail`+`useTranscriptTail` 为既有共用部件。各界面一律复用，不手写重复标记。
- **同一套注意力动效**：未读/待办信号只用一个语法——`--dsh-tb-attention`（warn）颜色 +
  `--dsh-tb-breath`（2.6s ease-in-out）。卡片用外层呼吸环 `dshTbBreathRing`，执行记录行
  用**内层柔晕 `dshTbBreathHalo`（无边框、无平染）**，两者同色同步。`prefers-reduced-motion`
  下全部退化为静态细环/细晕。
- **防回归守卫**：`tsconfig.json` 开启 `noUnusedLocals` / `noUnusedParameters`（
  `_` 前缀参数豁免）——死 import/死变量直接编译报错；废弃 CSS 类须人工删除（
  审计方法：提取 `board.module.css` 内 `.name` 定义，与 `src/` 中 `css.name` 引用对照）。
- **UI 设计小规则（改任何 UI 都遵守，保持整体一致）**：
  - 配色：一个语义强调色（`--dsh-tb-accent`=原生 business-primary）+ 四个状态色
    （attention/success/danger/neutral），一律用令牌；半透明一律 `color-mix(in srgb,
    <令牌> <alpha>%, transparent)`，alpha 用 22%/10% 两级，不做真毛玻璃。
  - 布局/间距：4px 节奏（6/8/10/12/16/24），区块间 gap 用统一值；圆角成比例——控件
    8–12、卡片 16、弹层 24。
  - 字体：只用原生 `--dsw-font-*` 栈；大标题 16–17px/600 + `letter-spacing:-0.01em~-0.015em`
    （负字距随字号增大收紧，Apple 节奏），正文 13px 行高 1.5，次级文本走 text-2/3。
  - 动效：全部走后端一个语法——交互 `--dsh-tb-motion`(160ms) + 注意力 `--dsh-tb-breath`(2.6s)；
    新动画必须进 `prefers-reduced-motion` 降级块。
  - 交互态：hover 用 `--dsh-tb-hover`，pressed 微缩/下沉，focus 统一 2px outline 随圆角
    （仅 `:focus-visible`）。

### 核心层（`src/core/`，纯逻辑，与 UI 无关）

`tasks.ts`（任务模型 + 状态机纯函数）、`schedule.ts`（cron 解析 + 下次运行时刻）、
`scheduler.ts`（浏览器每分钟 tick；页面隐藏错过即跳过；进行中跳过）、`store.ts`
（TaskStore 接口 + localStorage 实现）、`execution.ts`（真实执行：
`workspaces.connectWorkspace` 复用/新建空白会话 + `session.prompt(queue)`；执行前按
任务配置应用 agent preset 与权限（原生 `/permission <preset>` 命令，先于首条
prompt）；结算靠会话列表对账，cold 窗口判定：列表缺失→取消 / 仍在跑→等待 /
快照可见→按 lastAgentError / turn-error 节点 / 否则成功）、`controller.ts`（台账 +
视图状态 + 导航感知 + **统一并发调度器**）。

**统一并发调度器（controller 内唯一启动决策点）**：所有执行来源——手动、定时、接续、
自动巡航、评论注入——共用同一并发预算（按「同时在跑的轮次/会话」计数，`dispatch()`
按优先级启动：排队 schedule/chain（预算满入队、启动前重校验、陈旧丢弃）→ 评论续跑
（全局提交时间 FIFO，同任务严格按序）→ 巡航待办）。手动不限额但计并发。评论是每任务
FIFO 队列（`ExecutionRecord.injectedAt` 区分 已保存/已排队 与 已注入，未注入可取消）；
巡航关只保存不注入。`dispatch` 幂等扫描式，由 `persistAndNotify`/巡航开关触发，重入合并。

**斜杠命令与权限切换（原生命令注册表，绝不走 prompt 文本）**：`session.prompt` 无斜杠
裁决，评论页两类操作必须经 `remote.commands.execute`（`RemoteCommandsFace.execute`）：
(a) 权限切换 `SessionConfigFace.setPermission` → 原生 `/permission <preset>`，命中才改
权限并回原生文案，绝不把命令文本当消息发给 agent；(b) `submitComment(..., command=true)`
→ `ExecutionRecord.command`，`runCommentCommand` 走 sendCommand——matched 立即结算
（kind:error 记 failed），unmatched 退回普通文本。评论页 Agent 不可切换（原生
`agent-preset-locked`）只读展示，与任务卡片编辑两处独立。

**评论页会话事实以投影为权威（结构校验读取，不依赖域包类型）**：`pickProjections` 提取
`contextPressure`/`contextBreakdown`/`permissions`（`TranscriptProjectionsShape`）。权限
下拉事实源 = `permissions` 投影 `currentValue/options`（与原生 PermissionSelect 同源，
非任务卡片 `permission` 字段）；切换成功立即 reload + 3s 轮询兜底。**评论线程按执行独立
显示**（comment-thread.ts，纯函数）：`parentExecutionId` 归属（旧数据按 session 兜底，
session 缺失不显示），各执行评论各归各页；`queuePositionOf` 是任务级排队位次；执行序号
统一走 `plainRunsOf(task)`（过滤 comment 轮的单一编号源，详情列表与评论页头部共用）。

**会话显示状态派生（session-display.ts，纯函数）**：`sessionDisplay` 归集同会话轮次
（`sessionId === execution.sessionId` 或 `parentExecutionId === execution.id`），状态
优先级 waiting（open 轮 + `pendingInteractionOf`）> running（open 轮）> 最新 settled；
普通执行/完善轮开放（即使无 `injectedAt`），未注入排队评论不算开放。`sessionTimes`
（会话起止/耗时）、`taskPendingCount`（待处理徽章）。**未读提醒**：`taskUnviewed` /
`taskUnviewedCount` / `executionUnviewed`，基线 = `viewedAt`（旧数据按最新活动归一化，
升级零噪音）；打开详情清卡片提醒、打开评论页清该行提醒。

**共享 transcript tail（use-transcript.tsx + TranscriptTail.tsx）**：`useTranscriptTail`
封装 加载/3s 水位门控轮询/贴底跟随（距底 <24px）/上翻暂停 + `useResizeFollow`
（ResizeObserver 布局跟随，打开即滚底、rail 头部异步加载不跳位）；「滑到最新」为**纯
图标小胶囊**（无文字，`title` 浮层）。评论页与完善面板共享同一机制。

**执行记录行（ExecutionRow）**：状态/时间走 `sessionDisplay`/`sessionTimes` 实时派生；
非等待态「查看会话」为共享 ghost 按钮（与链接行/AI 完善/评论页一致），等待态显琥珀
「处理 →」按钮跳原生会话；活跃行动态减负（已完成行简洁）；**未读行** = 共用
`AttentionDot` + 内层呼吸柔晕（无边框、无平染，与卡片呼吸环同一注意力语法）。

**需求完善（backlog AI 调研闭环，refine.ts + controller）**：`startRefine` 启动 refine
轮次（`ExecutionRecord.refine`），用任务绑定的完善会话（`TaskRecord.refineSessionId` 惰性
创建、每轮复用），发内置完善指令（`buildRefinePrompt` zh/en）。**零配置零搜索集成**：
调研/抓取/提问全走 agent 原生工具。等待用 `pendingInteractionOf` 感知，`answerRefine`
直接把回答注入完善会话；`applyRefineResult` 把对话尾段最新 assistant 文本写入任务
prompt（用户确认才应用）。结算 `settleRefine` 不动任务列、不触发 chain
（`maybeContinueChain` 跳过 refine 轮）、计入 `hasOpenRun`（完善中禁止再启动正式执行）；
`plainRunsOf` 排除 refine 轮。面板布局：标题栏（状态+轮次数+查看会话）→ 共享
transcript tail（≤12 行）→ 回答栏 → 应用操作栏。

**链接会话（拖入建卡，linked-sessions.ts + sidebar-drag.ts + TaskBoard.tsx）**：从侧边栏
把一个**会话**或**整个工作区文件夹**拖进看板 → 创建带 `TaskRecord.bind`
（`{kind:'session'|'workspace', id}`）的卡片；「链接会话」区与「执行记录」同列详情页、
**正交并列**，是按需派生、不是副本——`deriveLinkedSessions` 纯函数镜像原生分组规则
（工作区 `items[].sessionIds` 按序 + `archivedSessionIds` 归档过滤 + `blank` 空白位跳过 +
用户 `hidden.sessions` 隐藏），数据来自 `sessions.list.byId`（title/cwd/running/
pendingInteraction）与 `workspaces.list`（sessionIds/archivedSessionIds）。板子已订阅
sessions.list 与 workspaces.list → 新开会话/归档/改名**自动实时同步**，因此没有「同步」
按钮；只有存在 `hidden.sessions` 时才显示「恢复全部已隐藏」（`hasHiddenRows` 判定 +
`unhideTaskRows(sessions)`）——无隐藏即无按钮，杜绝死按钮。每行：标题、工作区名、实时
状态 chip、查看会话、隐藏（非破坏）；**整行可点** → 打开 `SessionDetail` 会话详情面板。
**拖拽数据**：原生工作区浏览器对文件夹行与会话行都自带 `draggable` 并打 `text/plain`
（文件夹 key=workspaceId、会话 node.id=sessionId，已在原生产物核实）。dragover 阶段读
不到 payload（drag data store 保护模式，getData 返回空），故板子用 **latch 机制**：
board 根 `onDragEnter` 按 `dataTransfer.types`（`candidateExternalDrag` 纯函数：自有 MIME
或 text/plain）且 `dragSourceRef` 未置位（板内卡片拖拽在 dragstart 同步置位，ref 先于
任何 dragenter）时 latch 为外部拖拽；列高亮与 drop 都由 latch 驱动；payload 内容只在
drop 时用 `externalDragOf`（自有 MIME 优先，其次 text/plain 判本板任务 id 排除卡片拖拽，
再按 `externalKindOf` 分类）读取。全部拖拽瞬态（高亮/落点/latch）由 `clearDrag` 全量
复位，并有 window 级 `drop`/`dragend` 监听兜底（窗口外松手、Escape、源元素被移除都不
留残留）；列级 dragleave 不再清外部高亮（消除跨子元素抖动）。落列：**落哪列建哪列**
（`landingStatusOf` 五列全尊重；板底空白落 todo）。执行记录行与链接行都支持**非破坏
隐藏**（`hidden.executions` 隐藏不重排）、`unbindTask` 解绑转回普通任务。`bind`/`hidden`
均为可选字段、store 轻归一化（畸形丢弃），旧数据零影响。

**统一面板外壳（SessionFrame.tsx）**：执行评论页（`ReviewDetail`）与链接会话详情
（`SessionDetail`）共用同一**纯布局外壳**——backdrop + 头部（标题 + 类型徽章 + 动作槽）+
左对话右 rail 双栏；执行族业务（context meter、实时模型/权限配置、评论线程 + composer、
注入排队态）留在 ReviewDetail 内部，绝不放进外壳，杜绝语义泄漏。`SessionDetail` **只读
面板**：实时 transcript（同一 `useTranscriptTail`）+ 会话事实 + 实时状态 + 「查看会话/
隐藏/解绑」；**没有留言框**——链接会话是原生实时视图，留言不能（也不会）驱动任务，
面板用 `detail.sessionReadonly` 明说边界。两族行文法统一（状态 chip + ghost「查看会话」
+ rowHide 隐藏 + 时间格式；执行行非等待态「查看会话」同为 ghost），唯一强差在执行行：
琥珀「处理」等待键 + 未读 AttentionDot + 评论摘要——「可操作 rich / 只读 sparse」的重
量差本身就是防误驱动最强的区分。链接行不加行级未读（viewedAt 为任务级，加行级需扩数据
模型，收益低；实时 chip 已表达「有更新」）。

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

## 测试

- `tests/controller|execution|schedule|scheduler|store|tasks.spec.ts`：核心层纯逻辑。
- `tests/refine.spec.ts`：需求完善指令模板（zh/en 字段嵌入、输出格式、提问约束）。
- `tests/review-transcript.spec.ts` / `tests/context-meter.spec.ts` /
  `tests/menu-direction.spec.ts` / `tests/comment-thread.spec.ts`：评论页纯逻辑
  （折叠规则 / 上下文条算术 / 斜杠菜单方向 / 评论归属与排队位次）。
- `tests/route-scope.spec.ts`：RouteSettingsScope 快照转换 / ops 映射 / 失败降级
  （vi.stubGlobal fetch）。
- `tests/settings-route.spec.ts`：createSettingsHandler 纯函数（GET 有/无命名空间、
  POST set/unset、mutate 抛错 envelope、writable 透传、405、readJsonBody）。
- `tests/permission-route.spec.ts`：createPermissionHandler 纯函数（有/无权限服务、
  选项组装、read 抛错 envelope、405）。

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
