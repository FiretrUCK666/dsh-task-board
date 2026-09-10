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

## 版本管理与发布（必守）

本项目是「本地仓库 + 远端 `origin` + npm 包」三处结构。**用户不掌握 git 与发布操作，
由 agent 代为执行**；用户只描述需求，不重复交代流程。三处互不自动同步，各自由下面的
动作推进。

### 三种触发与对应动作

**日常（默认，用户描述需求即触发）**——一次改到远端：

1. `git status` 确认工作区；有未提交改动先存一个「改前存档点」。
2. 改代码。
3. `pnpm typecheck` + `pnpm test`。
4. 用户可见改动（行为/UI/文案/修复）→ bump `package.json` patch。纯重构/测试/文档不 bump。
5. `pnpm build`（**版号在 build 时进包**，顺序不能颠倒）。
6. `pnpm verify`。
7. `git add -A && git commit`——提交信息简短说明本次改动（中文或英文均可，禁止 emoji）。
   **`lib/` 与产生它的 src 改动必须同一次提交**。
8. `git push origin main`。

**发版（只有用户明确说「发版 / 发出去」才触发）**——在上面的基础上追加：

9. `git tag v<版本>` + `git push origin v<版本>`。
10. 建 GitHub Release，正文写**人话更新说明**（用户看的是这个；市场的新版说明优先读
    Release，其次提交记录，最后 npm 发布时间。仓库里不放 CHANGELOG.md）。
11. `npm publish --access public`（需要 npm 账号的 2FA 验证码，见下）。

**停手（用户说「先别提交 / 只看效果」）**——只做到第 6 步，不 commit、不 push。

### 三处各管什么（不要混为一谈）

| 动作 | 效果 | 谁能感知 |
| --- | --- | --- |
| `git push` | 远端仓库更新 | 从 GitHub 源安装的人立刻可更新（市场比对 commit） |
| tag + GitHub Release | 立版本节点 + 写更新说明 | 用户能看到该版本的说明 |
| `npm publish` | npm 上的版本更新 | 从 npm 源安装的人可更新；市场的更新提示也读 npm 版本号 |

push 之后 npm 不会自动变化，npm 发布之后远端也不会自动变化。**未发布 ≠ 别人拿不到**：
从 GitHub 源安装的人在你 push 的瞬间就能拿到最新代码。

### 版本号与不变量

- 三档语义：patch（修补、小改动，日常默认）/ minor（明显新功能）/ major（大改版）。
- **单调递增，永不复用**：已 `npm publish` 的版本号不能再发第二次。npm 上的已发布版本
  无法删除，只能发新版本修正。
- **已推送的历史不改写**：不用 `git push --force`、不 rebase 已推送的提交。
- 回滚分档：未提交 → 丢弃；已提交未推送 → `git reset --hard <存档点>`；已推送 →
  `git revert`（不改写历史）；已发 npm → 只能发新版本修回。
- 用户可见改动完成后，**回复用户只报版号**（用户在已安装插件列表看号，板内任何位置不
  显示版本号）。（与「文档不记版本号快照」不冲突：那条禁的是文档里写「某版修了某事」，
  这里管的是包版本号递进。）

### 身份与发布前检查

- **插件 id 与包名是两件事**，见「命名矩阵」。改名只动包身份，不动 id 与数据键。
- 提交身份：`user.name` = `FiretrUCK`，`user.email` = GitHub noreply 地址（不暴露私人邮箱）。
- 发布前必查：`pnpm verify`（含产物不得出现本机路径、不得出现凭据、无 emoji 三项审计）；
  `npm pack` 产物装进隔离 profile 能真实加载，不用 `link:` 代替。
- npm 强制 2FA：发布需要一个由用户手机验证器生成的 6 位验证码（30 秒有效），因此
  **发布动作由用户在自己终端执行**，agent 准备好一切并给出确切命令。
- 不提交：`node_modules/`；**`lib/` 必须提交**（安装时不执行构建，缺了别人起不来）。


### 依赖版本同步（硬性，用户不必每次都提）

SDK 版本**必须跟随实际运行的 DSH**，不是"能跑就行"的宽松范围。版本号有两条已核实
的规律：

- `@deepseek-ai/dsh-*` 的版本号与 DSH 本体**同号**（本体 `0.1.5-rc.1` → SDK 同为
  `0.1.5-rc.1`）；`@deepseek-ai/cordis` 走自己的 4.x 线。
- 这些包在 npm 上的 **`latest` dist-tag 可能过期**（曾见 `latest` 停在 `0.0.1-rc.1`
  而实际已有 `0.1.5-rc.1`）。因此**不得用 `npm view <pkg> version` 判断最新**；要用
  `npm view <pkg> versions --json` 取列表末项，并逐个包确认该版本确实存在（`dsh-client-runtime`
  就停在旧版、没有新号）。

同步动作（发现或执行 DSH 升级后主动做，不必等用户要求）：

1. 用 `node -p "require('<dsh 安装目录>/package.json').version"` 读**实际运行的** DSH 版本。
2. 把它写进 `package.json` 的 `devDependencies` 与 `peerDependencies`，并同步 README 的
   「环境要求」。`peerDependencies` 用 `>=<该版本>` 表达"不低于"，避免把用户钉死。
3. `pnpm install` —— pnpm 会自动把新版本补进 `pnpm-workspace.yaml` 的
   `minimumReleaseAgeExclude`（新版本未过发布冷静期，不加会被拦）。
4. **迁移真正的破坏性变更**：同步后 `pnpm typecheck` + `pnpm test` 全绿才算完成。
   版本跳跃常伴随 API 改名/移除（已遇：`dsh-settings` 的 `settingsNamespace()` /
   `installSettingsSection()` 在 0.1.5-rc.1 被替换为类型级命名空间与
   `ctx.settings.installSection()`）。类型报错就是信号，按新契约改写，不要靠 `any` 绕过。
5. 重新构建并**验证运行时可加载**：`lib/index.js` 必须能在该 DSH 上 import 成功
   （`node -e "import(...)"`），`lib/client.js` 的注册 id 必须等于包名（见下）。
6. 用户可见改动 → bump patch，走日常闭环。

**客户端 bundle 的注册 id = 包名**（不是插件 id）。加载器定位行对应的包清单、按
**包名**给 bundle 定键，注册成别的名字会被拒（报 `loaded without registering <name>`）。
无作用域时二者相同，加了作用域才会分叉——`tsdown.config.ts` 的 `clientBundle()` 第一个
参数因此必须是包名。`pnpm verify` 内置此检查，`pnpm smoke` 会真的执行一遍 handshake。

### 平台模块表跟随 shell

`shared/web-platform.ts` 的 `PLATFORM_MODULES` 是浏览器模块表的**镜像**，决定哪些
import 走 external、哪些必须内联。list 与真实 shell 不符时：多列一个已被移除的模块
（曾见 `dsh-client-web-react`、`dsh-client-schema-form` 在 0.1.5-rc.1 消失）、或少列
一个新增的，都会在运行时炸。**核对方法**：读
`<dsh>/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js`，搜
`__ModuleLoader__` 附近的 seed 对象（`react` 家族 + `@deepseek-ai/dsh-client-*`）。

---

## 项目定位

DSH Web GUI 的任务看板插件：侧边栏「任务看板」入口 + 多列看板 + 任务经 DSH 会话机制
真实执行 + 5 段 cron 定时调度。**看板数据持久化在 DSH host 端（存储单元 `dsh_task_board`），
任意设备/浏览器（桌面 + 手机，跨 origin）经 SSE 实时同步看到的是同一块板；窄屏为紧凑布局。**
单一 npm 包，cordis 插件，host/client 双半区，MIT 许可，全新独立项目（零历史仓库引用）。

### 命名矩阵（硬性规范 3，新增标识不得偏离）

**插件 id 与包名是两个身份，不得混用**：id 是加载与数据身份的根，包名只是安装标识。
包名带作用域（`@firetruck666/dsh-task-board`）不改变任何 id、路由、存储单元或数据键。

| 维度 | 值 |
| --- | --- |
| **插件 id**（行 id / 文件夹名 / 设置命名空间 / locale 命名空间 / `/api/<id>/*` 路由 / 存储单元 / 设置卡 slot） | `dsh-task-board` |
| **包名**（`package.json` name / 依赖键 / `dsh.profile.bundles` 项 / `cordis.patch.yml` 行 `name:` / **客户端 bundle 的 `__ModuleLoader__` 注册 id** / `/plugins/<包名>/client.js`） | `@firetruck666/dsh-task-board` |
| 设置路由 | `/api/dsh-task-board/settings` |
| 权限预设路由 | `/api/dsh-task-board/permissions` |
| 看板数据路由（前缀） | `/api/dsh-task-board/board`（`/lease` `/command` `/events` SSE 子路径） |
| host 存储单元名（storage hub json 后端） | `dsh_task_board`（落 `~/.dsh/storages/dsh_task_board.json`；平台 `UNIT_NAME_RE` 只允许 `^[a-z][a-z0-9_]*$`，**不能含连字符**） |
| 公告 section | `plugin:dsh-task-board`（order 200） |
| 设置卡 slot id | `dsh-task-board`（`settings.plugin.item`，order 110） |
| localStorage 键（现为离线镜像 + 草稿 + 备份） | `dsh.taskBoard.v1` 等（**不得改名**，见「数据键稳定」） |

挂载：`package.json` 声明 `dsh.bundle.patch` → `cordis.patch.yml`；安装命令
`dsh plugin --profile web add @firetruck666/dsh-task-board`（本地开发用 `add .` 或
`link:<本目录>`）。`scripts/dsh-task-board.js` 是本地挂载辅助，会清理改名前的旧
无作用域键。

## 架构（索引：职责与入口，机制细节以代码注释为准，不复述）

### host 半区（DSH 主进程）

- `src/index.ts`：inject webServer/systemPrompt/settings；设置命名空间 + 设置/权限/看板/会话状态路由 + 公告/section 联动。**无图片路由**（见关键不变量）。
- `src/host/*-route.ts`：纯 `create*Handler`（可注入测试），服务一律 `ctx.get`。
- `src/host/board-service.ts` + `board-route.ts`：**BoardDoc 真相服务**（持有 + storage hub `KvUnit` 持久化 + 先落盘后应答 + SSE；路由见命名矩阵；缺 hub 则 localStorage 模式）。合并文法见核心层 `board-doc.ts`。

### client 半区（浏览器）

- `src/client/index.ts`：inject 六包（slots/sessions/workspaces/locale/remote/uiSession；uiSession 只读 `pendingInteractions`，board 永不注册 waterfall）；offline-first 挂载（Synced*Store 常驻 → 接线 → `controller.start()` 即时可用 → 后台 `sync.start()` 收敛）；提问面 `PendingMirror`；唤醒 `watchSessionActivity`；席位 `(held, proto, bootedAt)` 元组；宿主面全经 `platform.ts`（`buildApi` 钉端点，`tests/platform.spec.ts` 钉死；执行会话复用 workspace `sessionIds`，无则新建；翻页 follow 开口 cursor→tail→hook→page，`throughSeq` 全链透传，缺 cut 即拒）。
- `board-transport.ts`：fetch + EventSource（缺席降纯轮询）。`board-mount.tsx`：DOM 级挂中列（`[data-dsh-taskboard-view]` + 键盘内缩）；入口唯一官方侧栏 slot，无 DOM 注入。

### 设计系统层（宪法标题 + 锚点，展开解释见代码注释与 spec）

- 令牌只消费 `--dsw-*`（CSS 禁 hex/rgb，verify 审计）；表面三层（画布/不透明内层）；浮层家族同一 chrome（板盒 % 参照，禁 vw/vh；Dialog 默认 portal 板盒 + 一处 Escape）。
- 共用部件一律复用（`ui.tsx`/`Chip`/`Dialog`/`Markdown`/自动化唯一 UI/时间与 chip 唯一映射，见 `session-panel.tsx`/`automation-ui.tsx`）。
- 动效：装饰降级、状态指示器存活（只重定义令牌）；光效规则见下表；拖拽三件套（`drop-position`/`drag-autoscroll`/`use-flip`）；卡片三契约（`card-contract.spec`）。
- **光效规则表（呼吸显示与否的唯一判定，无例外）**：

  | 任务状态 | 卡片 | 会话行 |
  | --- | --- | --- |
  | 等待（处理/计划确认/提问） | 呼吸（waiting） | 呼吸（waiting） |
  | 进行中（板内/外源/续跑） | 呼吸（running） | 呼吸（running） |
  | 完善中 | 呼吸（refining） | 无 |
  | 已结束且未读 | 呼吸（未读） | 静默 |
  | 已读已结束 / 空闲 | 静默 | 静默 |

  「进行中」只由状态驱动、与未读无关（`TaskCard` `data-active`）。**未读信号只在卡片呼吸**（`markExecutionViewed`/详情打开清 `task.viewedAt`/`settleRefine` 自清单基线）——会话行不再渲染任何未读指示（点/晕），因为行旁边的卡片已有同一状态的呼吸，双处标记读作重复（用户决策）。外源轮从观察起视为 open（`sessionDisplay` 含 `external === true`）计入轮次集。
- **拖拽/穿模/控件**：插入条 + 自动滚动 + FLIP 全结构驱动（`drop-position`/`drag-autoscroll`/`use-flip`，跨列先滚入视野；排序只有按住拖拽）；卡片 `overflow:hidden` + 子项 `min-width:0` + 徽标两槽（`card-contract.spec`）；同排控件同级高（28/24px），字号三档，一强调四状态全令牌。
- **响应式与触屏**：参照 = 表面自身宽度（板 `dsh-tb` 680px / 面板 `dsh-tb-panel` 600px），禁 `@media(max-width)`；compact 列滑轨 + 五等分 tab（短名 + `aria-label` 全名）+ 列身份纯函数换算；板头两行具名 grid（导航 `"back title cruise"/"state state state"`、工具行 `"modes"/"search"`、拇指栏 relocation 禁重复）；触屏只加隐形人体工学；JS 开关唯一 `useSurfaceNarrow`；会话行三槽具名 grid（可选成员不占固定轨）；滚动跟随一条机制（`use-transcript.tsx`，按"谁被声明为滚动体"判定）；滚动条/内衬单归属（成员至多引用一次）；面板三行网格 + 折叠完整渲染 + 每区最多一滚动体；窄屏锚定弹层换 Dialog；表单行具名 areas + 说明必须可达（`mobile-contract`/`review-page` 双 spec 钉死）。
- **表单/说明/节奏/加载**：表单行具名 areas + 标签让位（`sectionHead` 恒一行）；说明必须可点可达（禁纯 `title=`）；节奏三宪法（p margin 清零 + gap 声明 / 偏移派生禁手写 ±3px / 可选成员具名落位）；加载三态（读中安静 / 失败行内重试 + 自动退避 / 空态非错）。

### 核心层（`src/core/` 纯逻辑 + 关键职责）

- 模块一行：`tasks`（状态机/车道/`newExternalRound`）· `schedule/scheduler`（cron tick）· `cruise`（窗口 v4）· `presets/run-presets` · `automation`（规则 + 就绪）· `colors/session-list/session-display/comment-thread/question-rpc/store` · `execution`（投递结算）· `controller`（台账 + 调度 + 席位 + 外源双通道）。
- 唯一推导：`task-live` + `linked-sessions`（相关集/运行态；链接只来自显式 session 绑定；归档即时同步）。
- 原生活动：`session-activity`（外源轮每运行期恰一轮 + wake 双通道 + 锚点去重 + `reconcileBoundTask` 即时同步；消费只认身份不认覆盖——`inBoardTurnOn` 才消费，`hasOpenRoundOn` 永不消费）。
- 同步域：`board-doc`（作者声明裁决 + 读态单调 max + section 同构）+ `host-sync`（迁移/去抖/SSE+轮询/租约）；用户意图写走 `userEdit` 单一漏斗。

### 关键不变量（避免重造已有机制；改前先读对应文件）

- **多端同步**：真相 = host `BoardDoc`；浏览器乐观写 + 去抖提交 + `applyRemote` 永不回写；单引擎泵（租约；席位 `(held,proto,bootedAt)` 任一半变即通知）；板头引擎指示只在真等待时出现；过旧弹窗显示服务端真实启动时间。细则见 `board-doc.ts`/`host-sync.ts`。
- **统一会话与评论单轨**：同会话同一线程；排队/插话两态，模式只由用户开关定；图片字节 part 直发、文件 `receiptId`（`toPromptImage`/`toPromptFile`），禁自建桥；线程行显示「含 N 张图片 / M 个文件」；附件条独立成行。
- **运行态唯一推导**：`task-live` + 相关集；`sessionDisplay(nativeRunning)`；直发轮经 `driveLiveStates` 走同一 `settledFollowUp`；行徽章与卡片列同涨同落。
- **官方 @ 引用**：`reference-source.ts` 唯一桥；子代理会话宿主回 `agent-busy`（官方语义）；插入走官方 mention；失败永不 reject（会话域失败降级板内目录）。
- **交互卡 + 上下文块**：只读订阅 `pendingInteractions`（board 永不注册 waterfall）；回答 = 跳回原生会话；todo/用量/goal 读官方 projection（缺面降级）；`SessionContextBlock` 宽行内/窄浮层（240px 封顶）；goal 可操作 strip；有未完成才显示。
- **多源绑定**：`binds` 真相源；session 绑定上卡，workspace 绑定只关联（拖入瞬间按注册表账本快照一次）；隐藏删除进 `removedSessions`（权威非相关门）；再拖回可恢复。
- **完成态留言 auto 回待办并驱动**（queue/steer 同规则）。
- **真执行补全**：空标题/描述从 Prompt 补（`supplementedTask` 唯一作用点，写入/启动时；永不覆盖）；空 Prompt 门禁只拦真执行（评论/插话/完善不封）；完善永不碰列；`refinable` 任一非空才可完善。
- **车道 = 会话**：`isOpenRound` 唯一判定（评论轮已注入才算；在跑才占槽）；预算数轮；lane 忙滚下一格不叠；排队数本车道；结果一律 `lastPlainResult`；外源检测走 `sessionIsBusy` + 消费只认身份；看门狗清扫每条在跑轮；卡片离进行中三处同判据。
- **自动化**：任务 `schedule` 与会话 `rules` 正交；UI 唯一 `AutomationEditor`；on-complete 永续循环（共用 `settledFollowUp`，规则轮成功即续）；链武装即开跑（`done` 硬停）；每会话至多一条规则。
- **巡航 v4**：`enabled` 主权；窗口三态 + 自动排序；`windowRangeIssueOf` 校验（跨午夜最多一晚）；状态行一句话解释开关值。
- **校验文案**：`inputInvalid` 唯一错边框；规则表单按会话→指令→Cron 报首错；`saveFailed` 兜底。
- **卡片纯摘要**：标题/描述/来源/时间/chips；色点标题行前；选中态覆盖 hover。
- **执行门禁**：`taskExecutable` 唯一判定；`ruleReadiness` 次序 disabled→blocked→paused→active（链跳列暂停）；评论插话永不封；`runTask` 单点拦截。
- **运行预设**：`run-presets.ts`；`deploy-default` 不可删；悬挂回退部署默认；UI 唯一 `RunConfigFields` + `RunPresetManager`。
- **会话标题**：原生 rename = 钉住语义；新建标题选填（留空走自动命名）；未命名统一 `sessionUntitled`；真名判据 `realTitleOf`；真相序宿主值 > 板台账 > 缺席。
- **新建会话**：入口在会话区说明行右端；链路 create→配model/agent/permission→rename→绑定；部分成功诚实展示不回滚；非执行。
- **rail 高度契约**：交互卡 320px 封顶 + 正文内滚 + 动作行钉卡外；每区最多一滚动体；会话列表手动序 + 插入条共用；列表无底部死区。
- **稳定性**：受控回退；就近 inline 反馈；订阅必带终止；正文不省略，元信息可 ellipsis。
- **草稿矩阵**：`drafts.ts`（设备本地）；未提交回来、提交清槽；comment/edit/refine/new/newsession/rule 六键；评论/完善 v1 信封（图 2.5M 自保，文件只留名）；busy 只认在途 lane。

## 构建与验证（改完必跑，全绿才算完成）

```sh
pnpm install     # 依赖变化后
pnpm build       # tsc -p tsconfig.build.json && tsdown → lib/index.js + lib/client.js
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm verify      # 静态门禁 + 客户端 bundle 冒烟（注册 id 与 factory 启动）
pnpm smoke       # 只跑客户端 bundle 冒烟：真的按加载器协议执行一遍 handshake
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
