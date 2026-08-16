# dsh-task-board — 项目说明（会话自动注入）

本文件在每次会话开始时自动注入上下文，是本项目的权威约定。任何修改必须遵守本文，
并以「构建 + 测试 + 自检」全绿为完成标准。

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
  注册命名空间（settings.yaml 持久化）并联动公告；`registerSettingsRoute` 注册设置路由；
  `sync()` 按 `enabled`/`announceToAgent` 注册/撤销 systemPrompt section。
- `src/host/settings-route.ts`：`createSettingsHandler(deps, ns)` 为纯函数
  （deps: `{describe, mutate, writable}`，可注入测试）；GET 返回
  `{available, value, base, user, writable, revision}`；POST 接收
  `{ops: [{op:'set'|'unset', path, value?}], expectedRevision}` 调 `settings.mutate`
  并回 fresh view；要求 `content-type: application/json`（防表单 CSRF）；
  服务读取一律 `ctx.get('webServer')` / `ctx.get('settings')`（不裸属性访问）。

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
  表单，`booleanField`/`textField`/`numberField`，save 统一写）+ `TaskBoardSettingsCard`
  （enabled / announceToAgent）。

### 核心层（`src/core/`，纯逻辑，与 UI 无关）

`tasks.ts`（任务模型 + 状态机纯函数）、`schedule.ts`（cron 解析 + 下次运行时刻）、
`scheduler.ts`（浏览器每分钟 tick；页面隐藏错过即跳过；进行中跳过）、`store.ts`
（TaskStore 接口 + localStorage 实现）、`execution.ts`（真实执行：
`workspaces.connectWorkspace` 复用/新建空白会话 + `session.prompt(queue)`；结算靠
会话列表对账，cold 窗口判定：列表缺失→取消 / 仍在跑→等待 / 快照可见→按
lastAgentError / turn-error 节点 / 否则成功）、`controller.ts`（台账 + 视图状态 +
导航感知）。

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

## 测试

- `tests/controller|execution|schedule|scheduler|store|tasks.spec.ts`：核心层纯逻辑。
- `tests/route-scope.spec.ts`：RouteSettingsScope 快照转换 / ops 映射 / 失败降级
  （vi.stubGlobal fetch）。
- `tests/settings-route.spec.ts`：createSettingsHandler 纯函数（GET 有/无命名空间、
  POST set/unset、mutate 抛错 envelope、writable 透传、405、readJsonBody）。
