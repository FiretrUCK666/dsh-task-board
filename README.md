# dsh-task-board — DSH Web GUI 任务看板插件

一个完全独立、可热插拔的 DeepSeek Harness (DSH) 客户端 GUI 插件：在侧边栏「新会话」下方增加
**任务看板**入口，点击后中间列整体切换为多列看板视图；任务以 DSH 自身的会话机制
**真实执行**（`session.prompt`），执行状态实时回写卡片。

- 不修改 DSH 源码：以 cordis 插件 + 浏览器 DOM 扩展挂载（外挂形态）。
- 卸载即恢复原状，不影响其它配置段。
- 任务数据本地持久化，刷新页面、重启 DSH 均不丢失。
- 完全独立，不依赖任何其它插件包。

## 功能

### 看板与卡片

- **侧边栏入口**：新会话按钮下方一行「任务看板」，点击即切换到看板视图（随 DSH 主题自适应，折叠栏显示纯图标）。
- **五列看板**：待规划 / 待办 / 进行中 / 待审核 / 已完成。卡片显示标题、描述、工作区、更新时间与执行次数；执行中显示「进行中 · 第 N 次执行」，会话在等你处理时显示「等待回应」。
- **拖拽**：卡片拖到其它列 = 移动（拖到「进行中」= 立即重新执行）；同列内拖动 = 调整顺序，插入位置有精确指示条；执行中拖到「待审核/已完成」会被拒绝并红闪提示。侧边栏的**单个会话或整个工作区文件夹也可以直接拖进来建卡**，拖到哪列就落在哪列。
- **新建任务**：可选初始状态（待规划 / 待办），可完整配置运行配置（工作区 / Agent / 模型 / 思考程度 / 权限）。
- 看板顶部支持搜索过滤、自动巡航开关与并发上限设置，右上角随时返回对话。

### 执行

- **真实执行**：点「执行」→ 任务由真实 agent 会话运行，状态实时回写卡片；执行会话会出现在原生会话列表，可点进去看完整对话。
- **权限**：新建任务可选权限预设（选项跟随部署动态更新，不写死），执行时以原生命令应用到执行会话；未选则跟随会话默认。
- **状态回写**：刷新页面或重启后，遗留的执行任务按会话现状自动对账，不会卡在假状态。

### 复盘与干预

- **执行记录**：每次执行列出精确的开始/结束时间与耗时、成功/失败；行内直接显示该次执行的最新评论与等待状态；可隐藏某条（不删除、编号不变）。
- **评论页**：点执行记录打开——左侧是该次会话的实时对话（尾部），右侧是上下文用量条 + 会话配置 + 评论区 + 固定发送区。**留言会驱动任务继续跑**（按提交顺序排队注入，显示真实位次；`/` 开头的斜杠命令走原生命令注册表）；会话的模型 / 思考程度 / 权限可在此即时调整。
- **链接会话**：拖入的会话/工作区以**实时视图**展示（新开会话、归档、改名自动同步，无需手动刷新）。点开会话面板——与评论页同一套体验（对话 + 上下文条 + 可改配置 + 会话事实），底部可**直接向该原生会话发消息**（等于在原生对话里打字，不会驱动本任务；要驱动任务请用执行记录留言）；支持隐藏与解绑。
- **未查看提醒**：有内容没看过时，卡片带呼吸光晕 + 「新 N」徽章；执行行有未读圆点，点开即清；旧数据升级不闪屏。

### 自动化

- **自动化（任务级）**：详情里可为任务配置**定时执行**（5 段 cron + 内置预设）或**完成后接续**（可设次数上限或无限续跑）；需先手动执行一次激活，任务移到已完成即自动停用。
- **自动巡航（板级）**：看板头一键开启，批量执行全部待办任务；并发上限是全局的——手动、定时、接续、评论留言都走同一个调度器，满额自动排队、释放即补位。
- **需求完善**：待规划任务就是想法池——让 AI 调研你的需求、逐条向你提问，最后产出可直接执行的 Prompt（你确认后才应用到任务）。

### 集成

- **斜杠命令补全**：执行 Prompt 输入框内输入 `/` 弹出命令菜单，与原生对话输入框完全一致，DSH 或插件注册/注销命令自动跟随。
- 插件会在每个 agent 的系统提示中声明自己，让 agent 知道如何与看板协作；设置卡始终可用（配置服务不可用时也会提示而非消失）。

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
src/core/session-display.ts                                           # 共享会话状态派生（执行行/卡片共用）
src/client/board/use-transcript.tsx                                   # 共享 transcript tail hook（加载/轮询/跟随/跳转）
src/client/board/SessionFrame.tsx                                     # 统一会话面板外壳（评论页/链接会话共用）
src/client/board/session-panel.tsx                                    # 共享右栏组件（上下文条/配置/事实/等待/transcript 渲染）
tests/*.spec.ts                                                       # 存储/状态流转/执行触发/cron/调度 + 设置路由与 scope 测试
scripts/dsh-task-board.js                                             # 一键挂载/卸载/状态 CLI
scripts/verify-standalone.mjs                                         # 独立插件静态校验门禁
```

## 关键设计

- **无官方槽位，DOM 注入**：侧边栏与中间列都没有可外挂的槽位，入口与看板视图以 DOM 方式
  注入（MutationObserver 自愈、`html[data-dsh-taskboard-active]` 显隐、对话子树保持挂载）。
- **持久化用浏览器 localStorage**：客户端插件没有可写的文件通道；localStorage 与 DSH 快照
  同源。执行走客户端 runtime：`connectWorkspace()` 建会话 + `session.prompt()` 真实驱动。
- **后台结算靠会话列表对账**：未打开会话没有对话快照窗口，结算以列表为准（列表缺失→取消 /
  仍在跑→等待 / 快照可见→按错误节点 / 否则成功），幂等。
- **自动执行在浏览器端调度**：每分钟 tick、隐藏错过即跳过、进行中跳过、到点前顺延下次；
  规则生命周期（待命/生效/暂停/完成即取消）由 `ruleReadiness` 统一判定。需要标签页保持打开。
- **皮肤与深浅色零适配**：全板样式只消费 DSH 原生 `--dsw-*` 语义令牌（浅色/深色与皮肤插件
  重映射令牌即可整体换肤），板上经 `--dsh-tb-*` 别名引用，另见仓库 AGENTS.md「设计系统层」。
- 设置走自建路由（`/api/dsh-task-board/settings`）；权限预设实时读原生 `permissionPresets`
  （`/api/dsh-task-board/permissions`），DSH 更新预设表自动适配。

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
   待规划任务可在详情页「需求完善」里让 AI 调研并打磨出可执行的 Prompt。
4. 点卡片 → 详情可见内容与 Prompt；点「执行」→ 卡片变「进行中」（会话列表出现
   以任务标题命名的会话，卡片显示「进行中 · 第 1 次执行」）；agent 跑完后卡片落到「待审核」（成功或失败都停在这里等你确认），详情执行记录按
   「第 1 次执行」列出精确的开始/结束时间与耗时（成功/失败显示在记录里，状态为该次执行自身的结果，与评论无关），行内直接显示该次执行的最新评论文本与状态（无需点开即可知道会话上次被交代了什么；会话在等你处理时行内显示「等待回应」），可「查看会话」
   跳转到真实 transcript。「自动化」模块默认折叠为一行状态摘要，点击展开完整编辑器。点执行记录那条 → 打开评论页：左侧是该次会话的最后对话（随会话进度实时同步），右侧栏固定头部 + 评论区可留评论（巡航未开时显示「已保存」，可连续保存多条；开启巡航后按并发预算排队注入，可取消未注入的评论）；评论以 `/` 开头会作为原生命令执行（如 `/plan ...`、`/permission ...`）；「移到已完成」按钮确认收尾。
5. 点详情「编辑」修改标题/描述/Prompt（或运行配置）→ 保存后卡片立即更新；再点
   「执行」，会话以新标题命名、发送的是新 Prompt。
6. 自动化（定时）：详情 →「自动化」勾选启用，选预设「每 10 分钟」（cron `*/10 * * * *`），
   卡片出现 定时 标识；**此时不会运行任何东西**——先点「执行」手动启动一次（规则被激活），
   再等待下一个整 10 分钟点，观察卡片自动进入「进行中」并最终完成，详情「上次触发」
   出现时间、执行记录新增一条（会话可跳转）。编辑过 Prompt 的任务，自动触发的下一次
   运行同样使用最新内容。「管理预设」里可增删改自定义预设、一键恢复默认。任务失败后同样进入「待审核」（执行记录显示失败），自动化暂停（详情显示「已暂停」，不再显示下次运行），到点不会复活——点「重新执行」或「移到待办」即恢复。
7. 拖拽：按住卡片拖到其它列 → 卡片移动（拖到「进行中」→ 任务立即重新执行；正在执行时
   拖到「进行中/待审核/已完成」会被拒绝，列边框红闪）；**同列内拖动 → 调整卡片顺序**——
   指针在目标卡上半插入其前、下半插入其后（2 张卡也能双向换序），插入位置显示粗指示条。
8. 完成后接续：详情「自动化」→ 模式切到「完成后接续」，留空次数 = 无限——先点
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
