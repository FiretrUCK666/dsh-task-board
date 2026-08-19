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

- `src/index.ts`：`inject = ['webServer', 'systemPrompt', 'settings']`；注册设置命名空间
  （settings.yaml 持久化）并联动公告；注册设置路由与权限预设路由；`sync()` 按
  `enabled`/`announceToAgent` 注册/撤销 systemPrompt section。
- `src/host/settings-route.ts` / `permission-route.ts`：纯函数可注入测试；服务读取一律
  `ctx.get`（不裸属性访问）；权限选项**不写死**——每次实时读 `permissionPresets` 服务，
  未挂载则 available:false，DSH 更新预设表自动适配。

### client 半区（浏览器）

- `src/client/index.ts`：`inject = ['slots', 'sessions', 'workspaces', 'connection', 'locale']`；
  `RouteSettingsScope` 快照（失败降级不抛）；`syncEnabled` 门控挂载；核心接线
  `BoardController` + `ExecutionService` + `SchedulerService`（localStorage 存储）。
- 挂载（无官方槽位，DOM 级，失败 console.error 不抛）：侧边栏入口
  `[data-pane="sidebar"]`/`[class*="sidebarCol"]` 兜底 + MutationObserver 自愈重插；
  看板视图 `[data-pane="conversation"]`/`[class*="centerCol"]` 兜底 +
  `html[data-dsh-taskboard-active]` 显隐，对话子树保持挂载。
- 设置卡：`settings.plugin.item`（keyed）；`PluginSettingsCard` 始终渲染 + `CardForm`
  staged 表单 + `TaskBoardSettingsCard`（enabled / announceToAgent）。

#### 设计系统层（板上 UI 的宪法，改 UI 先读这里）

- **令牌只消费原生语义层**：所有样式引用 `--dsw-*`（宿主按浅/深色与皮肤插件重映射，
  自动适配主题与未来皮肤，零独立皮肤）；硬性：CSS 不得出现 hex/rgb 字面量（verify
  审计为零）。
- **看板别名层**：`board.module.css` 顶部 `[data-dsh-taskboard-view]` 定义 `--dsh-tb-*`
  （边框/圆角/阴影/文字层级/状态色/动效时长，派生自原生令牌），组件统一引用别名层，
  板上统一值只改一处；侧栏入口与设置卡在 scope 外，只用原生令牌。
- **表面三层（canvas/opaque 分裂，玻璃皮肤也照此）**：`--dsh-tb-glass`/`--dsh-tb-bg`（画布
  层，= `--dsw-alias-bg-base`，随皮肤的透明度走）只用于板/列背景；所有内层浮起/下沉表面
  （卡片/对话/面板/评论/菜单，`--dsh-tb-surface-float/-sunken/-menu`，= bg-layer-1/2/菜单色）
  一律**不透明**——与玻璃皮肤「内表面不透明保可读」的原生约定一致；画布之上的遮罩
  `--dsh-tb-mask`（mask-1/3 混色，偏强）盖住列线。粗体按钮 `primaryButton` 用原生
  `--dsw-alias-button-primary-fill`，半径 18px、**与 ghost/danger 同级高 28px**（强调靠
  填充色，不靠更高——同一行的 执行/保存/取消/删除 不混高），14px 字，与 shell 原生按钮
  同节奏；正文 14px/1.5。
- **面板几何（随板居中）**：`.modalBackdrop` 为**看板盒内绝对定位**（父级即
  `[data-dsh-taskboard-view]`，position:absolute inset:0），浮层 `.modal/.detail/.review`
  由 flex 在其中居中——以看板盒为参照系，与侧栏宽度、祖先 transform/filter、皮肤效果
  完全解耦，任何视口都贴不到列线、不偏右（不再需要 `--dsh-tb-board-offset` 偏移变量）。
- **共用部件**：`ui.tsx`（Button primary/ghost/danger + `size="sm"` 紧凑变体、Section、
  **Disclosure**（chevron+标题+一行状态摘要的通用折叠块）、Notice、AttentionDot、Icon、
  Switch）+ `Chip`/`Dialog`/`PromptInput`/`TranscriptRow`/`useTranscriptTail`/
  `JumpToLatest`/`SessionFrame`/`session-panel.tsx`（SessionRailHead/
  SessionTranscript/SessionConfigEditor/SessionFacts/SessionWaitingNotice）+ `SessionRow`
  （执行行与链接行共用一个行骨架）/`CommentsThread`（评论页与链接会话面板共用一个评论
  项文法）。各界面一律复用，不手写重复标记。
- **注意力动效（唯一语法）**：`--dsh-tb-attention`（warn）+ `--dsh-tb-breath`（2.6s
  ease-in-out）。卡片外层呼吸环 `dshTbBreathRing`，执行行内层柔晕 `dshTbBreathHalo`
  （无边框、无平染）；`prefers-reduced-motion` 全部静态降级。
- **拖拽落点动效（板内卡片 + 侧栏拖入）**：目标列 hover = 业务色描边；侧栏会话/工作区
  拖入列 = 呼吸环（同一 `--dsh-tb-breath` 语法）；成功落点 = 加速 180ms 落位闪烁
  `dshTbDropConfirm`；拒绝落点 = 180ms 危险色闪烁 `dshTbRejectFlash`。闪烁是即逝反馈
  （自带定时器清除，不经 `clearDrag`——window 兜底的 drop 监听在列 handler 之后触发，
  会先擦掉还没播完的闪烁），全在 reduced-motion 下静态降级。
- **防回归守卫**：`noUnusedLocals`/`noUnusedParameters` 开启（死 import/死变量=编译错
  误）；废弃 CSS 类人工删除（`.name` 定义与 `css.name` 引用对照）。
- **UI 小规则**：一个语义强调色（`--dsh-tb-accent`）+ 四个状态色
  （attention/success/danger/neutral），全令牌；半透明 `color-mix(in srgb, 令牌 alpha%,
  transparent)`，alpha 22%/10% 两级；4px 节奏、圆角 8/12/16/24；只用 `--dsw-font-*` 栈
  （大标题 16-17px/600 + 负字距，正文 13px/1.5）；交互 `--dsh-tb-motion`(160ms)；hover
  `--dsh-tb-hover`、pressed 微缩、focus 2px outline（`:focus-visible`）。

### 核心层（`src/core/`，纯逻辑，与 UI 无关）

`tasks.ts`（任务模型 + 状态机纯函数）、`schedule.ts`（cron 解析 + 下次运行时刻）、
`scheduler.ts`（每分钟 tick，隐藏错过即跳过、进行中跳过；开头调 `cruiseTick` 翻转巡航窗口）、
`cruise.ts`（巡航窗口状态机：`effectiveEnabled`/`coveringWindow`/`applyManualToggle`/
`sortWindows`）、`store.ts`（TaskStore + localStorage）、`execution.ts`
（`connectWorkspace` 复用/新建空白会话；投递统一走斜杠感知路径——`/` 开头经原生命令
注册表（`deliverCommandLine`，见下），否则 `session.prompt(queue)`；执行前按任务配置
应用 agent preset 与权限（原生 `/permission` 命令）；结算靠会话列表对账）、`controller.ts`
（台账 + 视图状态 + 导航感知 + **统一并发调度器**）。

- **自动巡航（窗口模型，cruise.ts + controller）**：`CruiseState { enabled, limit, schedule:
  CruiseWindow[] }`，`CruiseWindow = { startAt; endAt? }`；有效态 = `effectiveEnabled(state,
  now)`（任一窗口覆盖当前时刻），**手动开 = 加一个无结束窗口**（从现在一直保持），**手动关 =
  只关当前覆盖窗口**（未来窗口保留）——`applyManualToggle`；`setCruiseSchedule` 整体替换
  窗口列表并按新表重算 enabled（注意用新 schedule 计算，别用旧 state）；`tickCruise(now)`
  在窗口边界翻转（经 scheduler 的 `cruiseTick` 每分钟调用，持久化 + dispatch + notify）。
  巡航只控制「取新任务」：已开始的任务不受关闭影响。UI：板头**两行命令栏**——行 1 =
  返回对话 + 板名 + 状态条（正在跑 N · 排队 M）+ 巡航胶囊（Switch + 展开箭头，弹层 =
  立即开关 + 并发 + 定时窗口编辑器，datetime-local 加窗/移除/状态行），行 2 = 通栏筛选
  搜索胶囊；「+ 新建任务」是唯一强调按钮。
- **统一并发调度器（controller 内唯一启动决策点）**：手动/定时/接续/巡航/评论共用同一
  并发预算（同时在跑的会话数）；优先级 排队 schedule/chain → 评论续跑（提交 FIFO，同
  任务严格按序）→ 巡航待办；手动不限额但计并发。评论为每任务 FIFO（`injectedAt` 区分
  已保存/已排队/已注入，未注入可取消）；巡航关只保存不注入；`dispatch` 幂等扫描式、
  重入合并。**会话锚定评论进同一队列**：`submitSessionComment`（链接会话面板驱动）
  建的轮次带 `sessionAnchor`，与执行评论（`submitComment`，带 `parentExecutionId`）共用
  `newCommentRound` 工厂、同一条 FIFO、同一注入路径（`commentRun` 本就是 sessionId 参数化
  ——任意会话可注入），提交先后决定顺序，绝无两套队列。
- **斜杠命令与权限（原生命令注册表，绝不走 prompt 文本，执行与评论共用一条投递路径）**：
  执行 Prompt 以 `/` 开头（`ExecutionService.run`）与评论/链接面板驱动（`submitComment`/
  `submitSessionComment` 的 `command=true`）都经**同一个** `deliverCommandLine`：matched 命令
  经 `remote.commands.execute` 执行（与原生 composer 同一 RPC）——若命令开启了真实回合
  （如 `/plan <消息>` 会开 plan 模式并 `steer` 消息，全程 `running=true` 直至 plan-review
  批准后回合真正结束），则观察会话至回合结束，任务保持「进行中」、绝不按 matched 结算；
  纯配置命令（`/permission`、`/goal`、`/plan off`、bare `/plan`、`/compact`…）在
  `waitForCommandWork` 观察窗口（`commandGraceMs`，默认 2s）内无回合证据即结算；unmatched
  或无注册表桥回退普通文本（原生 default-sink，绝不丢输入）。权限切换
  `SessionConfigFace.setPermission` → 原生 `/permission <preset>`（driver 直通）；评论页
  Agent 不可切换（`agent-preset-locked`）只读展示。
- **投影为权威 + 评论线程（按会话统一）**：`pickProjections` 提取
  `contextPressure`/`contextBreakdown`/`permissions`（结构校验读取，不依赖域包类型）；
  权限下拉事实源 = `permissions` 投影（非任务卡片 `permission` 字段）。**线程按原生会话
  归集**：`sessionCommentsOf(task, sessionId)` 是唯一线程入口——同一 `sessionId` 下
  执行锚定（`parentExecutionId`）与会话锚定（`sessionAnchor`）的评论互见同一线程
  （执行评论页与链接会话面板都读它，同一会话的评论再也不各看各的）；`queuePositionOf`
  仍任务级 FIFO 显示位次。`sessionRoundsOf` 排除会话锚定轮用于判会话「忙」——线程视图
  与忙状态职责分离。执行序号统一 `plainRunsOf(task)`（过滤 comment/refine 轮的单一
  编号源）。
- **会话统一模型（session-list.ts，任务级单一「会话」视图）**：`taskSessionsOf(task, ctx)`
  把板内执行会话（每次 Run 的 session）与链接外部会话（`controller.linkedOf`）按
  **sessionId 去重**成一个列表——同一会话绝不出现两次（run 优先于 linked），从执行页
  或链接面板进入同一会话看到的是同一条评论线程（结构性解决"评论区不同步"）。每行 =
  `TaskSessionRow`（sessionId/kind/title/workspaceLabel/executionId/runIndex/display/
  updatedAt/unviewed），run 行以该会话最新 plain-run 为代表（评论共享 session 不加行），
  refine 会话不并入（保留独立 RefineSection）。**隐藏按会话统一 + 逐条恢复**：`hiddenSessionIdsOf`
  由 `hidden.sessions ∪ hidden.executions 映射` 得出，`hideTaskSession`/`unhideTaskSessions`
  （旧 `hideTaskRow`/`hasHiddenRows` 已移除）统一操作 sessionId；`unhideTaskSession(taskId,
  sessionId)` 单条恢复（同步修剪 executions 族），详情页「已隐藏 N 个会话」托盘 = 每条可恢复
  + 头部恢复全部。
- **自动化独立（开启即生效，不绑卡）**：`ScheduleRule` 无手动激活门——
  `ruleReadiness` 三态（disabled / paused / active：backlog·review·done = 暂停、done 完成
  即 `disarmSchedule` 硬停）；`setSchedule` 启用 chain 且卡片可驱动（todo/running）时立即
  首跑，cron 到点经 scheduler tick 触发；`resolveCardDrop` 不再因 chain 拒绝移动，
  `moveTask` 以「拖到已完成=停链 / 待规划·待审核=暂停 / 待办=停止接续手动接管」表达
  「离开即暂停/停止」；`TaskCard` 悬停快速执行（`rerunTask` 同 run guard）。**复制为模板
  （`copyTask`）带上自动化**：schedule 原样克隆（enabled/mode/maxRuns 保留、runCount 归零、
  cron 重算 nextRunAt），executions/hidden/bind 不复制，落待规划。UI 上是
  详情页独立分区 `AutomationSection`：共用 `Disclosure` 一行状态摘要（折叠态零按钮），
  展开态 = 触发方式分段 + 当前模式配置 + 按状态显隐的跳过/停止，无保存/取消（即改即
  生效），**启用即展开**（`schedule.enabled === true` 时初始展开，且启用动作后自动展开），
  与板级「自动巡航」的关系用一行 `detail.schedule.boundary` 讲清。
- **会话状态派生（session-display.ts）**：`sessionDisplay` 归集同会话轮次，状态优先级
  waiting > running > 最新 settled；`sessionTimes`/`taskPendingCount`；未读
  `taskUnviewed`/`executionUnviewed`，基线 `viewedAt`（旧数据归一化零噪音）。
- **共享 transcript tail（use-transcript.tsx + session-panel.tsx）**：加载/3s 水位门控
  轮询/贴底跟随/上翻暂停 + `useResizeFollow`；`SessionTranscript` 共享渲染（等待条/状态/
  列表/滑到最新）；「滑到最新」纯图标胶囊；评论页/链接会话/完善面板共用同一机制。
- **统一会话行（SessionRow，执行行 + 链接行一个骨架）**：两种 session 行共用同一组件
  （kind='execution'|'linked'）与同一个表面（`.sessionRow` 同封面/同分隔/同 hover/同键盘）
  与同一个 identity 排版（`.sessionRowLeading` 14px/500，执行 = 会话标题 + 安静「第 N 次」
  注记、链接 = link 图标 + 标题 + 工作区胶囊）+ 状态 chip + 右侧紧凑动作（执行等待态琥珀
  「处理」，其余 `Button size="sm"`「查看会话」+「隐藏」）；次行 = 元信息（执行：起止/耗时；
  链接：更新于）。执行专属 footer 槽：评论摘要/动向/错误。域名类（chip 文案、
  `sessionDisplay`/`sessionCommentsOf`）由调用方算好传入，文法单写
  一处——两种行从今往后不可能长歪。

- **需求完善（refine）**：backlog 专属；完善会话惰性创建、每轮复用；`answerRefine`
  即时注入（不经调度器）；`applyRefineResult` 用户确认后写任务 prompt；结算不动列、
  不触发 chain、计入 `hasOpenRun`；`plainRunsOf` 排除 refine 轮。

- **链接会话（拖入建卡/换绑，linked-sessions.ts + sidebar-drag.ts）**：拖侧栏**会话**或
  **工作区文件夹**进看板 → `bind` 卡片；`deriveLinkedSessions` 纯派生（工作区 sessionIds
  按序 - archived - blank - hidden），订阅 sessions/workspaces → 新开会话/归档/改名自动
  实时同步，无「同步」按钮。**显式绑定的单会话跳过 archived/blank 过滤**（用户拖进来
  就一定要显示；工作区绑定仍过滤），工作区绑定时以 `boundWorkspaceTitle` 作所有行的
  稳定工作区标签回落（cwd 缺失也显示）。每行：标题/工作区/实时状态 chip/查看会话/隐藏
  （非破坏，`hideTaskSession` 统一按会话隐藏），整行可点打开 `SessionDetail`；
  `unbindTask` 解绑（按钮在详情 footer）。**拖进已打开的详情 = 绑定到现有任务**：
  `bindTaskSource(taskId, bind)` 在已有任务上落/换绑（覆盖旧 bind，持久化）；详情「会话」
  区是落点（latch 排除卡片拖拽 + 呼吸环 + 落位闪烁），新绑工作区里的新会话实时同步。
  **拖拽**：原生行自带 draggable 并打 `text/plain`；dragover 读不到
  payload（保护模式）→ board 根按 types（`candidateExternalDrag`）且 `dragSourceRef` 未
  置位（排除卡片拖拽）latch，drop 时 `externalDragOf` 读 payload 分类；`clearDrag` 全量
  复位 + window `drop`/`dragend` 兜底；**落哪列建哪列**（`landingStatusOf`）。`bind`/
  `hidden` 可选、store 轻归一化，旧数据零影响。

- **统一会话面板（SessionFrame.tsx + session-panel.tsx）**：执行评论页与链接会话面板共用
  纯布局外壳（backdrop + 头部徽章 + 左对话右 rail）与右栏 `SessionRailHead`（上下文条 /
  实时配置（模型/思考程度/权限，任意会话通用，权限投影映射在此统一派生）/ 会话事实 /
  等待条）+ `SessionTranscript` 共享渲染。**composer 双模式（链接面板一个显式开关，
  默认「驱动任务」）**：执行评论页只有「驱动」——`submitComment` → FIFO → 调度器注入
  （巡航门控）；链接会话面板在「驱动任务」与「直发会话」间切换。驱动模式 =
  `submitSessionComment`（`sessionAnchor` 轮，进同一队列，见调度器节），面板显示本会话
  的评论线程（`sessionCommentsOf` + 共享 `CommentsThread`，排队可取消）；直发模式 =
  `sendSessionMessage` → host `sessions.prompt`/`remote.commands.execute`，`/` 走注册表未
  匹配回退文本，**成功时追加一条 direct 轮**（`newDirectRound`：settled、无 injectedAt、
  `sessionAnchor=sessionId`）——直发也进同一会话线程（带「直发」标签），但绝不驱动。
  **直发 ≠ 驱动契约**：不进调度器、不占并发预算、不触发
  巡航/接续/状态变化；面板在直发模式以「不会驱动本任务」+ `detail.sessionDirect` 提示防
  误驱动，失败保留草稿、会话消失禁用。完成态任务两模式都拒发（`detail.commentQueuedDone`
  提示先移回待办）。rail 统一「可滚动中区 + 底部固定 composer」一个滚动模式（
  `.sessionRailHead` 固定头 / `.sessionRailScroll` 中区滚动）。**计数即所见**：标题计数 =
  可见行数（隐藏不计数、恢复回补；面板徽章同源）；执行序号 = 绝对 plain-run 序列；卡片
  计数同源。

- **稳定性守则（改交互/UI 必守）**：受控组件绑异步数据必有本地回退（显示 = 本地选择 ??
  服务端非空 ?? 默认，失败回退）；固定操作区（composer）之上必有可滚动中区（flex:1 +
  min-height:0 + overflow-y:auto），头部变高不挤压操作区；就近 inline 反馈（如「已应用」）
  放字段旁、位于滚动区内；同语义动作跨表面同文同色；含方向词的文案随布局重排校验；
  轮询/订阅必有终止路径（会话消失停轮询、卸载清 disposer）。

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

- `tests/controller|execution|schedule|scheduler|store|tasks|session-list|linked-sessions|drop-position|cruise.spec.ts`：核心层纯逻辑（含巡航窗口状态机与调度器 cruiseTick）
- `tests/sidebar-drag.spec.ts`：侧栏拖拽契约（分类/排除卡片拖拽/清拖）。
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
