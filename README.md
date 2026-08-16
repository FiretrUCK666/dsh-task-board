# dsh-task-board — DSH Web GUI 任务看板插件

一个完全独立、可热插拔的 DeepSeek Harness (DSH) 客户端 GUI 插件：在侧边栏「新会话」下方增加
**任务看板**入口，点击后中间列整体切换为多列看板视图；任务以 DSH 自身的会话机制
**真实执行**（`session.prompt`），执行状态实时回写卡片。

- 不修改 DSH 源码：以 cordis 插件 + 浏览器 DOM 扩展挂载（外挂形态）。
- 卸载即恢复原状，不影响其它配置段。
- 任务数据本地持久化，刷新页面、重启 DSH 均不丢失。
- 完全独立，不依赖任何其它插件包。

## 功能

- **侧边栏入口**：侧边栏内、新会话按钮下方注入「任务看板」入口行——图标与文字**整体居中**（宽栏显示图标+文字，折叠 rail 显示纯图标，随 DSH 主题 token 自适应）。
- **多列看板**：待规划 / 待办 / 进行中 / 待审核 / 已完成 五列；卡片显示标题、描述、
  工作区、更新时间与执行次数（执行中显示「进行中 · 第 N 次执行」；执行会话正等待你
  处理时显示「等待回应 · 权限审批/计划确认/提问」），状态徽章统一为
  同一套语义色文字、与标题左缘严格对齐，窄列自动换行不溢出；**执行流程**：任务「进行中」
  执行落定后进入「待审核」（人工环节）——成功与失败都停在这里等你看执行记录、评论或重跑，
  确认满意后点详情「移到已完成」或直接拖到「已完成」；「已失败」不再是独立状态，每次执行的成功/失败
  显示在执行记录里。**卡片可直接拖拽**：拖到其它列 = 移动（拖到「进行中」= 立即重新执行），
  **同列内拖拽 = 调整卡片顺序**（按指针最近的卡片间隙判定插入点，上下双向、任意数量都准确，
  粗指示条精确显示在插入间隙处、拖影跟随指针）；执行中拖到「待审核/已完成」会被拒绝并红闪提示，与自动执行/结算逻辑互不冲突；
  顶部支持搜索过滤、新建任务与自动巡航，「返回对话」固定在右上角。
- **新建任务**：「+ 新建任务」可选择**初始状态（待规划 / 待办，默认待办）**；新建的任务不会被自动执行，需手动启动（见「自动执行」）；任务多时各列可独立滚动。新建时可完整选择运行配置（Agent/工作区/模型/思考程度/权限），之后编辑同样生效于下次执行的新会话（评论页的会话面板只改当前会话，两套并存不冲突）。
- **任务详情**：点卡片打开详情（标题/描述/执行 Prompt/运行配置/执行记录），**不会**一点
  就执行；「编辑」可修改标题、描述、执行 Prompt 与运行配置（工作区 / Agent / 模型 /
  思考程度 / 权限），保存后卡片与详情立即刷新，**下一次执行（手动或定时）自动使用
  最新内容**；执行记录按「第 N 次执行」列出精确到秒的开始/结束时间与耗时；详情内
  提供「执行 / 重新执行」「删除（带确认）」「查看会话（跳转到执行 transcript）」以及
  手动移到待规划/待办/已完成。执行记录每条可点击：打开**评论页**（回顾对话 + 留评论继续干）或「查看会话」跳原生；「执行/重新执行」在详情底部——以当前最新执行 Prompt 开启全新一轮（评论是继续旧会话，两者互补不重复）。
- **斜杠命令补全**：新建与编辑任务的执行 Prompt 输入框内输入 `/` 弹出命令菜单
  （↑↓ 选择、回车/Tab/点击选中、Esc 关闭），候选与原生对话输入框完全一致——host
  命令注册表与技能目录两源合并（每条技能名即一个斜杠项），DSH 或任何插件注册/注销
  命令或技能自动反映，无需插件更新。
- **真实执行**：点「执行」后，插件通过客户端 runtime 连接工作区会话
  （`workspaces.connectWorkspace`，空白会话复用或 host 新建），把任务标题设为会话名，
  以任务 Prompt 调用 `session.prompt([{ type: 'text', text }], 'queue')` 驱动真实 agent；
  随后订阅该会话快照，轮次真实结束后把卡片置为 待审核 并记录执行结果。
  执行会话会出现在会话列表，可点进对话查看真实 transcript。
- **权限选择（原生预设）**：新建任务可选「权限」——选项来自 host 侧
  `permissionPresets` 服务的动态预设表（经 `/api/dsh-task-board/permissions` 路由下发），
  **不写死任何清单**；部署/DSH 更新预设（如本部署的 Read only / Workspace write /
  Full access）后看板自动跟随。执行时在首条 prompt 前以原生 `/permission <key>`
  命令应用到执行会话（与 GUI 权限选择器同一机制）；未选权限则跟随会话默认。
- **状态回写**：卡片状态（进行中 → 待审核）由真实会话状态驱动；刷新页面/重启后，
  遗留的 running 任务会按会话现状自动对账（reconcile）。
- **自动执行（定时 / 接续）**：详情面板可为任务配置两种驱动模式，规则有统一的生命周期，界面信息永远真实（不显示「下次运行」时必有原因）：
  - **待命**：规则已启用，但任务从未被手动启动——绝不自动运行，界面提示「需手动执行一次后生效」；
  - **生效**：任务被手动「执行」（或拖到「进行中」）启动过一次，且当前处于**待办 / 进行中**——按时间表到点触发，「完成后接续」持续续跑；
  - **暂停**：任务已手动启动过，但当前处于**待规划 / 待审核**——自动执行暂停，界面提示「已暂停」；任何让任务离开这两个状态的手动动作（执行/重新执行、拖到「进行中」、移到待办）都会恢复，不依赖唯一路径；
  - **已完成 = 彻底停用**：任务一移到「已完成」，任何已启用的自动规则会被**直接取消**（不再按时间表触发、不再接续续跑），规则配置保留但开关关闭——想恢复需在详情里重新勾选启用，移回待办/待规划不会自动复活，杜绝「完成即循环」。作为安全网，即使旧数据残留 enabled 规则，「已完成」状态也一律按暂停处理、绝不再驱动任务（见 tasks.ts 的 ruleReadiness / disarmSchedule）。
  - **按时间表（cron）**：5 段 cron 表达式（分 时 日 月 周，支持 `*` / `*/n` / `a-b` /
    逗号列表）+ 19 个内置预设（可增删改、自定义、一键恢复默认，存
    `dsh.taskBoard.presets.v1`），cron 输入框下方实时显示人类可读描述；
  - **完成后接续（chain）**：上一次运行完成后立即自动开始下一次，可设总运行次数
    或无限——无限链运行时任务持续保持「进行中」；失败或达到上限即停止。
  - 两种模式共用「运行次数上限」（留空 = 无限）；手动执行/拖拽不消耗自动运行计数，
    与自动规则互不干扰。
- **评论与评论页**：点执行记录某一条打开居中评论页——左侧显示该次执行会话的**最后一段对话**（视觉对齐原生，只显示尾部；完整历史用「查看会话」跳原生会话页，两页职责不同：评论页回顾 + 干预，会话页完整交互）；右侧栏分三段：**固定头部**（上下文用量条 + 会话面板 + 会话事实，永远可见、不会被评论挤走）→ **独立滚动的评论区** → **发送区固定栏底**。**会话面板**：模型/思考程度（`sessions.models`/`selectModel`）与权限（原生 `/permission` 命令注册表执行——**不是**把命令文本当消息发给 agent，所以切权限绝不会产生 agent 的「无法更改」式回复）即时作用于当前会话；会话工作区（cwd）与实际组合 Agent 只读展示（会话已运行无法换 Agent——原生 `agent-preset-locked`，任务卡片编辑的 Agent 作用于下次新执行，两处互不影响）。**上下文用量条**：原生 ContextMeter 同源同算法（`contextPressure`/`contextBreakdown` 投影，bluish-400 / #a78bfa / blue-450 三色段，无投影时降级 tokens 汇总）。**评论区是每任务 FIFO 队列**：可连续保存多条；巡航关 =「已保存」（可取消）、预算满/任务忙 =「排队中 · 第 N 位」（可取消）、注入后运行中、结算后显示结果；卡片同步「评论排队 N」徽章。**评论以 `/` 开头 = 斜杠命令**（与原生产法完全一致）：经原生命令注册表执行（如 `/plan ...` 真的会进入 plan 模式、`/permission ...` 真的切权限），未知命令退回普通文本（不丢输入），命令结果文案显示在评论条目下。**后台交互可见**：会话等待你处理（审批/plan/提问）时显示「等待回应」横幅 + 卡片徽章。**对话实时同步**：3 秒轻轮询按投影水位（asOfSeq）门控——只有会话真的产生新事件才重渲染（行级 memo，长对话也不卡），标签页隐藏时暂停、回来自动补刷，另有手动「刷新」。窄屏（<720px）回退单列堆叠。对话区按原生会话风格渲染，顶部结果横幅。
- **统一并发调度（自动巡航）**：看板头「返回对话」左侧开关 + **并发上限输入（默认 5，可设 1–20）**。这个数字是**全看板同时执行的会话/轮次上限**——手动执行、定时触发、完成后接续、自动巡航、评论注入全部走同一个调度器（`dispatch()`）：手动永远立即开始（但占用槽位），其余来源在预算满时**排队**，槽位释放即按优先级补位（排队中的定时/接续 → 评论（按提交时间）→ 巡航待办）。**不是**「卡片数」也不是「跑完一批才开下一批」：是连续补位、按会话计数的硬上限——10 张卡每张几百条评论也不可能同时开跑（每任务一次只跑一条评论，全局又被 N 封顶），从根上防止几十个会话并行打爆 API。巡航关闭时不取新任务、评论只保存不注入；已开始的跑完。任务离开待办（评论注入、手动执行、定时触发）不再被巡航重复抓取。
- **系统提示词注入**：host 半边（`src/index.ts`）通过 `SystemPrompt.section` 注册
  `plugin:dsh-task-board` 段（order 200），向每个 agent 声明本插件存在、能力与限制——
  插件在组合中（mount 后重启 DSH）即注入，移出组合（unmount 后重启）即消失，
  agent 无需任何外部文档就能知道如何与本看板协作。
- **设置路由**：host 半边经 `webServer` 注册 `/api/dsh-task-board/settings` 路由，
  向浏览器半边的 `RouteSettingsScope` 提供本插件的设置命名空间读写；设置卡
  （`settings.plugin.item` 席位，slot id `dsh-task-board`）始终渲染，命名空间不可用时
  显示「配置服务暂不可用」而非消失。

## 目录结构

```
package.json / tsconfig.json / tsdown.config.ts / vitest.config.ts   # 独立构建与测试
shared/tsdown.client.ts + shared/web-platform.ts                      # client bundle 构建预设
cordis.patch.yml                                                     # profile 挂载补丁（行 id dsh-task-board）
src/index.ts / src/invariant.ts                                       # host 半边：SystemPrompt section + 设置/权限路由
src/host/settings-route.ts                                           # 设置路由层（自包含，纯处理函数可测）
src/host/permission-route.ts                                         # 权限预设目录路由（读原生 permissionPresets 服务）
src/client/index.ts                                                   # apply(ctx)：接线 runtime 服务 + 挂载 DOM + 设置卡
src/client/route-scope.ts                                            # 路由后背的设置 scope
src/client/settings-form.ts                                          # 暂存式设置表单模型（最小 SettingsScopeLike 接口）
src/client/permission-label.ts                                       # 权限展示标签（镜像原生 picker 的展示规则）
src/client/PluginSettingsCard.tsx / TaskBoardSettingsCard.tsx         # 设置卡（始终渲染 + 不可用提示）
src/client/sidebar-entry.ts                                           # 侧边栏入口注入（自愈式 MutationObserver）
src/client/board-mount.tsx                                            # 中间列看板挂载 + 显隐切换
src/client/board/*.tsx                                                # React 看板视图（列/卡片/详情/新建/确认）
src/client/board.module.css                                           # 样式（--dsw-* token，随主题自适应）
src/core/tasks.ts                                                     # 任务模型 + 状态机（纯函数）
src/core/schedule.ts                                                  # cron 解析 + 下次运行时刻（纯函数）
src/core/scheduler.ts                                                 # 浏览器调度器（每分钟 tick 触发到期任务）
src/core/store.ts                                                     # 持久化（TaskStore 接口 + localStorage 实现）
src/core/execution.ts                                                 # 真实执行服务（会话连接/prompt/结算观察）
src/core/controller.ts                                                # 控制器（台账状态、视图状态、导航感知）
tests/*.spec.ts                                                       # 存储/状态流转/执行触发/cron/调度 + 设置路由与 scope 测试
scripts/dsh-task-board.js                                             # 一键挂载/卸载/状态 CLI
scripts/verify-standalone.mjs                                         # 独立插件静态校验门禁
```

## 关键设计

- **侧边栏没有可用的外挂槽位**：侧边栏壳只声明 `sidebar.workspaces` /
  `sidebar.settings` 两个 single 槽位，且已被占用；外部插件无法注册新槽位。因此入口行走
  **DOM 注入**，并用 MutationObserver 自愈（React 重渲染波及该节点时同帧内重新插入，
  无闪烁）。
- **中间列无法通过槽位替换**：`conversation` 槽位是 single 且已被占用。看板视图以 DOM
  方式挂在中列内（React 不管的尾部子节点），通过 `<html data-dsh-taskboard-active>`
  属性切换显隐，底下的对话子树保持挂载有状态。
- **持久化用浏览器 localStorage**：客户端插件跑在浏览器里，DSH 没有浏览器可写的
  文件通道；localStorage 也是 DSH 客户端自身快照存储的持久化方式。
- **执行走客户端 runtime**：`ctx.sessions.list` 订阅会话状态，`ctx.workspaces.connectWorkspace()`
  创建/复用会话，`session.prompt()` 真实驱动 agent，`ctx.sessions.open()` 跳转 transcript。
- **后台结算靠列表对账**：未打开的会话没有对话快照窗口（cold），所以执行结算以会话列表
  为准——每次列表变化都对账 running 任务；结果判定依次取「列表缺失→已取消 / 仍在跑→等待 /
  对话快照可见→按 lastAgentError / 原始历史尾部→turn-error 节点证明失败 / 否则按成功」，
  对账幂等。
- **设置走自建路由**：host 侧用 `registerSettingsRoute` 注册
  `/api/dsh-task-board/settings`，client 侧用 `RouteSettingsScope` 经该路由读写命名空间
  并维护快照，`CardForm` 通过最小 `SettingsScopeLike` 接口消费。
- **权限预设走原生服务**：host 侧 `registerPermissionRoute` 注册
  `/api/dsh-task-board/permissions`，每次请求实时读取 `permissionPresets` 服务的
  `names`/`optionOf`（结构性窄化接口，不依赖 SDK 包）；选项集合、名称、描述全部来自
  host 原生预设表，client 只镜像原生 picker 的展示规则（`danger-full-access` → Full
  access 等）——DSH 更新预设表后看板自动适配，无需改插件。
- **自动执行在浏览器端调度**：插件是纯客户端（无服务端通道），所以「到点执行」由
  标签页内的调度器完成——每分钟 tick 一次，页面从后台恢复可见时立即补 tick；到点
  触发前先把「下次运行」顺延到下一个 cron 匹配点再执行，同一 tick 不会重复触发；
  页面加载早期（会话列表基线未就绪）不触发，避免误执行。**规则生命周期**：scheduler、controller 与 UI 共用同一个判定（见 tasks.ts 的 ruleReadiness）——待命（启用但未手动启动）绝不触发；生效（已启动且处于待办/进行中）到点触发与接续正常；暂停（已启动但处于待规划/待审核/已完成）到点跳过并顺延，只在手动恢复（执行、移到待办等）后继续；「已完成」还会直接取消已启用的规则（disarmSchedule），移出已完成不会自动复活，防止完成即循环。限制：需要标签页保持打开
  （关闭期间错过的调度按「错过即跳过」处理，下次打开时只补跑已顺延的到期任务）；
  任务处于「进行中」时到点跳过本次，等下一个 cron 匹配点。

## 安装

本插件为独立插件目录，安装即把该目录作为 profile-bundle 挂到 web profile：

```sh
# 一键挂载（在 web profile 清单注册依赖 + bundle 行并 pnpm install）
node scripts/dsh-task-board.js mount

# 查看状态
node scripts/dsh-task-board.js status

# 卸载（移除注册行；重启 GUI 后恢复原状；任务数据保留在浏览器）
node scripts/dsh-task-board.js unmount
```

也可直接用官方 profile 机制（在插件目录内执行，用 `$(pwd)` 代替绝对路径）：

```sh
dsh plugin --profile web add link:$(pwd)
```

安装后**重启 `dsh web`**，侧边栏「新会话」下方出现「任务看板」入口即生效；页面刷新不够，需重启进程。

## 构建

前置：Node ≥ 20，官方 NPM SDK 可访问。类型与运行时 API 全部来自官方 NPM SDK（`@deepseek-ai/*`
devDependencies），**无需任何 DSH 源码 checkout**。

```sh
cd <插件目录>       # 例如：cd /path/to/dsh-task-board（本机位于 ~/.dsh/Plugins/dsh-task-board）
pnpm install        # 首次安装依赖
pnpm build          # 产出 lib/index.js + lib/client.js（tsdown + shared/tsdown.client.ts 预设）
pnpm typecheck      # 类型检查（node_modules 的 SDK 包类型）
pnpm test           # vitest：存储/状态流转/执行触发/cron/调度/设置路由/设置 scope
pnpm verify         # node scripts/verify-standalone.mjs . dsh-task-board（独立插件门禁）
```

## 挂载 / 卸载（profile 清单）

profile 清单中注册的行（`~/.dsh/profiles/web/package.json`）：

```json
{
  "dependencies": { "dsh-task-board": "link:<插件目录绝对路径>" },
  "dsh": { "profile": { "bundles": [ "...", "dsh-task-board" ] } }
}
```

> 注意：profile 层（bundle 行、`dsh.client` 元数据）在 dsh web 进程启动时读取，
> 挂载/卸载后需要**重启 dsh web GUI** 才生效（页面刷新不够）。

## 数据存储位置

- 任务台账存于浏览器 localStorage，键 `dsh.taskBoard.v1`（同一来源跨刷新/重启持久）。
- 卸载插件后数据保留；如需清除，浏览器控制台执行
  `localStorage.removeItem("dsh.taskBoard.v1")`。
- 存储层是 `TaskStore` 接口（`src/core/store.ts`），后续可换成 IndexedDB 或
  host 文件通道而不动上层逻辑。

## 手动验证步骤

1. `pnpm build` → `node scripts/dsh-task-board.js mount` → 重启 DSH → 刷新
   Web GUI 地址（默认 `http://127.0.0.1:3080`，以实际端口为准）。
2. 侧边栏「新会话」下方出现「任务看板」入口行；点击 → 中间列切换为五列看板。
3. 「+ 新建任务」填标题/描述/Prompt（Prompt 输入框内输入 `/` 会弹出命令菜单，可选中
   插入命令）；「初始状态」可选「待规划 / 待办」（默认待办）→ 卡片出现在所选列。
4. 点卡片 → 详情可见内容与 Prompt；点「执行」→ 卡片变「进行中」（会话列表出现
   以任务标题命名的会话，卡片显示「进行中 · 第 1 次执行」）；agent 跑完后卡片落到「待审核」（成功或失败都停在这里等你确认），详情执行记录按
   「第 1 次执行」列出精确的开始/结束时间与耗时（成功/失败显示在记录里），可「查看会话」
   跳转到真实 transcript。点执行记录那条 → 打开评论页：左侧是该次会话的最后对话（随会话进度实时同步），右侧栏固定头部 + 评论区可留评论（巡航未开时显示「已保存」，可连续保存多条；开启巡航后按并发预算排队注入，可取消未注入的评论）；评论以 `/` 开头会作为原生命令执行（如 `/plan ...`、`/permission ...`）；「移到已完成」按钮确认收尾。
5. 点详情「编辑」修改标题/描述/Prompt（或运行配置）→ 保存后卡片立即更新；再点
   「执行」，会话以新标题命名、发送的是新 Prompt。
6. 自动执行：详情 →「自动执行」勾选启用，选预设「每 10 分钟」（cron `*/10 * * * *`），
   卡片出现 定时 标识；**此时不会运行任何东西**——先点「执行」手动启动一次（规则被激活），
   再等待下一个整 10 分钟点，观察卡片自动进入「进行中」并最终完成，详情「上次触发」
   出现时间、执行记录新增一条（会话可跳转）。编辑过 Prompt 的任务，自动触发的下一次
   运行同样使用最新内容。「管理预设」里可增删改自定义预设、一键恢复默认。任务失败后同样进入「待审核」（执行记录显示失败），自动执行暂停（详情显示「已暂停」，不再显示下次运行），到点不会复活——点「重新执行」或「移到待办」即恢复。
7. 拖拽：按住卡片拖到其它列 → 卡片移动（拖到「进行中」→ 任务立即重新执行；正在执行时
   拖到「进行中/待审核/已完成」会被拒绝，列边框红闪）；**同列内拖动 → 调整卡片顺序**——
   指针在目标卡上半插入其前、下半插入其后（2 张卡也能双向换序），插入位置显示粗指示条。
8. 完成后接续：详情「自动执行」→ 模式切到「完成后接续」，留空次数 = 无限——先点
   「执行」手动启动一次（任务此前从未手动启动时，接续不会自动开跑），此后每次完成后
   自动续跑，卡片持续「进行中」；设次数上限则跑满后停止并落「待审核」。
9. 自动巡航：看板头开启「自动巡航」（并发上限先设小如 1）→ 待办任务逐个开始执行，
   完成后进入「待审核」；关掉巡航后不再取新任务、已开始的跑完。上限是全局并发——
   手动/定时/接续/评论也走同一调度：预算满时排队、释放即补位（可开多条评论后开启
   巡航观察「排队中 · 第 N 位」逐条注入）。
10. 刷新页面/重启 DSH → 任务与巡航开关仍在；卸载插件 → GUI 恢复原状。

## 命名约定

插件沿用全局一致的命名：

| 用途 | 值 |
| --- | --- |
| 行 id / 包名 | `dsh-task-board` |
| 设置命名空间 | `dsh-task-board` |
| 设置路由 | `/api/dsh-task-board/settings` |
| 公告 section | `plugin:dsh-task-board` |
| locale 命名空间 | `dsh-task-board` |
| 设置卡 slot id | `dsh-task-board` |
| localStorage 数据键 | `dsh.taskBoard.v1`（保持稳定） |

## 许可证

MIT — 见 LICENSE 文件。
