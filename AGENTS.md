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

本文件是**项目的契约**（面向 AI），随仓库走，描述「这个项目是什么、要求什么」，不描述
「谁在维护它」。这条区分决定它写什么：**能写**机制、架构、不变量、硬性规范、构建/测试/
发布该做什么；**不能写**账号、远端、作用域这类取值，以及一次性的版本号、日期、决定。

**取值一律现场读**：仓库地址、包名、远端、署名都从 `package.json` 的 `name` /
`repository.url`、`git remote -v`、`git config user.name`、`npm whoami` 取。仓库是这些
事实的唯一权威来源，改真实配置即可，本文不必跟着改。**这条只管本文**：README 与
CONTRIBUTING 给人看、要能直接复制粘贴，因此必须写具体命令（易主时改那几处）。

**本文是活的**：与代码不符时以「本文意图 + 代码现状」为准，并修正本文。出现下列情况时
AI 应直接改本文并提交，而不是绕过它、只做口头约定、或把特殊处理写死进代码：规则过时或
与代码不符；用户要求调整约定；出现会反复发生而本文覆盖不到的场景；本文表述有歧义。

**编辑本文时**：面向 AI（专业、准确、可执行，不写科普）；与代码一致（改行为就同步描述）；
写意图不写快照（表达「为什么」与「边界」而不是记录历史）；精炼；遵守硬性规范（禁 emoji）；
涉及用户可见能力或命令时同步 README。

### 几份文档的分工

| 文档 | 回答什么 | 权威来源 | 是否随包发出 |
| --- | --- | --- | --- |
| `README.md` / `.en.md` | 怎么装、怎么用、坏了怎么办 | 随包发出，面向使用者 | 是，改动即用户可见 |
| `PRODUCT.md` | 为谁做、做到什么算成功、哪些约束不许破 | 用户确认的产品事实 | 否 |
| `DESIGN.md` | 长什么样、为什么这样长、新界面怎么不跑偏 | **代码** | 否 |
| `AGENTS.md`、`CONTRIBUTING.md` | 给 AI 与接手者的说明 | 本文即契约 | 否 |

- **冲突时以代码为准**：`DESIGN.md` 记录现状，不发明新世界——改它去对齐代码，不让代码迁就它。
  `PRODUCT.md` 相反：代码与它矛盾时改代码。
- **不随包发出的文档不 bump 版本**（改完只提交）；README 随包发出，改一个字都要 bump。
- **中文版是权威**，英文版是它的翻译；两份是同一份文档的两个语言版本，改一份必须打开另一份
  一起看，且不要机械对译（两种语言的读者关心的问题不同）。改完要能回答「另一份同步了吗」。
- **本文是索引，不是副本**：只记别的文档存在、谁是权威、何时同步，不抄内容。
- **派生内容用工具生成**：两份 README 的目录由 `pnpm toc`（`scripts/sync-toc.mjs`）写在
  成对标记之间——增删或改名任何二级标题后必须重跑，否则 `pnpm verify` 会红（它内含
  `--check`）。锚点由工具按 GitHub 算法算，手抄最容易错的是带序号与带 emoji 的标题，
  写错表现为「点了没反应」且不报错，所以不要手写。
- **徽章依赖外部服务，不进自动检查**（会因对方抖动误报）：写之前先验一遍能显示再写。
- `scripts/sync-toc.mjs` 由 `project-forge` skill 提供，为保持**独立自包含**（硬性规范 7）
  在此留一份副本；升级时以 skill 里那份为准，覆盖过来。

## 环境与上下文（以实际环境为准，不依赖固定值）

- 宿主：DeepSeek Harness (DSH) Web GUI，本机运行；一切皆插件，本插件以 cordis 插件形态
  存在。平台与用户名不写死——需要时用 `process.platform`、`os.homedir()` 现场发现。
- 项目根：本文件所在目录。DSH 数据根：`$DSH_HOME` 优先，否则 `os.homedir()` 下的 `.dsh`；
  激活 profile 是 `profiles` 下的目录。挂载方式见「启停机制全貌」。**生效规则**：host 半区改动
  需重启 `dsh web`；client 半区改动刷新页面即可。

## 版本管理与发布（必守）

本项目是「本地仓库 + 远端 `origin` + npm 包」三处结构，**维护者只描述需求，git 与发布由 agent
执行**。三处互不自动同步：`git push` 让从 GitHub 源安装的人立刻可更新；tag + Release 立版本节点
并写更新说明；`npm publish` 更新 npm 上的版本。**未发布 ≠ 别人拿不到**。

### 先确认角色（涉及推送/发布前先做一次）

**推 main、打 tag、发布只属于维护者**，判断不靠问，靠仓库自身的事实：

| 检查 | 维护者 | 贡献者 |
| --- | --- | --- |
| `npm whoami` 对得上 `package.json` name 的作用域段 | 是 | 否 |
| `git remote get-url origin` 与 `package.json` 的 `repository.url` 指向同一正本仓库 | 是 | 否 |

**两项都过 = 维护者**，走全部流程。**任一不过或判断不了 = 贡献者**（更安全的一次错误）：
开发、构建、测试、改文档照本文做，但**到此为止**——推自己的分支并开 PR，**不** tag、**不**
建 Release、**不** `npm publish`（没权限，且会搅乱正本的版本号）。清单见 `CONTRIBUTING.md`。

`npm whoami` 401 / 未登录只是登录态缺失，不改变归属：默认仍按贡献者（本机登录态只影响
这项证据与手动 publish 兜底，不影响工作流发布）。**用户在本会话主动下达维护者动作
（推 main、打 tag、发版）即为授权——直接执行，不再重复判定**；agent 不得主动开口求放行。

### 日常（默认，用户描述需求即触发）——一次改到远端，不打标签

1. `git status` 确认工作区；动手前记下 HEAD（`git rev-parse --short HEAD`）作「改前存档点」，
   工作区另有未提交改动先 `git stash push` 保存。
2. 改代码。
3. `pnpm typecheck` + `pnpm test`。
4. 用户可见改动 → bump `package.json` patch，**只抬号不打标签**（标签是里程碑，不是提交的
   附庸）。判据是**使用者会不会看到**：

   | 要 bump | 不 bump |
   | --- | --- |
   | 行为、界面、交互、报错文案、随包发出的 README | 重构、测试、构建脚本、不进包的内部文档 |

   （同样叫「文档」，README 是产品表面，改一个字都算用户可见；`AGENTS.md` 只是给 AI 的契约。）
5. `pnpm build`（**版号在 build 时进包**，顺序不能颠倒）。
6. `pnpm verify`。
7. `git add -A && git commit`——提交信息简短说明本次改动（禁 emoji）。**`lib/` 与产生它的
   src 改动必须同一次提交**。
8. `git push origin main`。

**停手**（用户说「先别提交 / 只看效果」）：只做到第 6 步，不 commit、不 push。
**贡献者版闭环**：第 1–6 步相同（含 bump），第 7–8 步改为推自己的分支并开 PR。

### 发版（只有用户明确说「发版 / 发出去 / npm publish」才触发）——在日常闭环基础上追加

9. `git tag v<版本>` + `git push origin v<版本>`。**发版的剩余步骤全部由
   `.github/workflows/release.yml` 完成，agent 不手动执行任何一步**：它重跑全 gate
   （build / typecheck / test / verify）、校验 tag 与 `package.json` 版本一致、经
   `scripts/draft-release-notes.mjs` 从提交记录起草中文说明（读上一个标签取区间，
   正文写 UTF-8 文件、按硬性规范 10 不经 shell）并 `gh release create --notes-file`
   创建 GitHub Release（用内置 `github.token`；已存在则跳过，幂等）、以 OIDC
   （npm Trusted Publisher）发布，最后回读 registry 确认该版本真的可见（publish 退出 0
   不等于已上架）。**正常路径不需要 PAT、不需要本机 npm 登录、不需要 gh CLI、
   不需要 2FA**：不探测 `GITHUB_TOKEN`、不手动建 Release、不手动 `npm publish`；
   Release 步失败就重跑工作流（幂等），不转手动脚本。
10. **Publish 红了先看日志是不是 404 / ENEEDAUTH 类错**：那是 npmjs.com 上 Trusted
    Publisher 未配置或配错（npm 保存时不校验，错字只在发布时暴露）。以 `release.yml`
    头注释列的三项为准核对，不要先怀疑代码。确认未配置才退回手动
    `npm publish --access public`：需要账号 2FA 验证码，**由账号持有人在自己终端执行**
    （agent 准备好一切并给出确切命令）。

### 版本号与不变量

- 三档语义：patch（修补、小改动，日常默认）/ minor（明显新功能）/ major（大改版）。
- **单调递增，永不复用**：已 `npm publish` 的版本号不能再发第二次（已发布的版本删不掉，
  只能发新版本修正）。
- **已推送的历史不改写**：不用 `git push --force`、不 rebase 已推送的提交。
- 回滚分档：未提交 → 丢弃；已提交未推送 → `git reset --hard <存档点>`；已推送 →
  `git revert`；已发 npm → 只能发新版本。
- 用户可见改动完成后，**回复用户只报版号**（板内任何位置不显示版本号）。

### 身份与发布前检查

- **插件 id 与包名是两件事**（见「命名矩阵」）：改名只动包身份，不动 id 与数据键。
- 提交身份：`user.name` 用仓库所有者常用署名；`user.email` 用 GitHub noreply 地址
  （`<id>+<login>@users.noreply.github.com`，从仓库地址或 `git config` 现场确认），
  不写死具体值，避免暴露私人邮箱。
- 发布前必查 `pnpm verify`（含产物不得出现本机路径、不得出现凭据、无 emoji 三项审计），
  并把 `npm pack` 产物装进隔离 profile 真实加载一遍，不用 `link:` 代替。
- 不提交 `node_modules/`；**`lib/` 必须提交**（安装时不执行构建，缺了别人起不来）。

### 依赖版本同步（硬性，不必每次交代）

**SDK 版本必须跟随实际运行的 DSH**，每次现场查，不写死、也不靠宽松范围蒙过去。两条规律：

- **SDK 与 DSH 本体同号**：`@deepseek-ai/dsh-*` 的版本与正在运行的 DSH 一致；`@deepseek-ai/cordis`
  走自己的线，不与本体同号。**个别包会停更**，所以每个包都要单独确认目标版本确实存在。
- **npm 的 `latest` dist-tag 不可信**（可能停在很旧的版本）。**不得用 `npm view <pkg> version`
  判断最新**，一律 `npm view <pkg> versions --json` 取完整列表，从末尾找目标版本。

同步动作（发现或执行 DSH 升级后主动做）：

1. 读**实际运行的**版本作为目标：`node -p "require('<dsh 安装目录>/package.json').version"`
   （安装目录用 `require.resolve` 或 `npm root -g` 现场求）。
2. 逐个确认该版本存在，再写进 `package.json` 的 `devDependencies`（**只动这里**，不要顺手改
   `peerDependencies` 与 README 的下限）。
3. `pnpm install`（pnpm 会自动把新版本补进 `pnpm-workspace.yaml` 的
   `minimumReleaseAgeExclude`，未过冷静期不加会被拦）。
4. **迁移破坏性变更**：`pnpm typecheck` + `pnpm test` 必须全绿。跨版本升级常伴随 API 改名或
   移除，类型报错就是信号——按新契约改写，不要用 `any` 绕过；测试里的官方文法镜像 spec 是
   逐字镜像，期望值要跟着同步。
5. 重新构建并**验证可加载**：`lib/index.js` 能在该 DSH 上 import 成功，`lib/client.js` 的注册
   id 等于包名。
6. 用户可见改动 → bump patch，走日常闭环。

### 最低支持版本（只在真不兼容时上移）

| | 跟随版本 | 最低支持版本 |
| --- | --- | --- |
| 是什么 | 构建与类型检查所对的 SDK | 插件还能加载的最旧 DSH |
| 写在哪 | `devDependencies` | `peerDependencies` 的 `>=` 值 + README「环境要求」那一行 |
| 何时变 | 每次 DSH 升级都跟上 | **只在真不兼容时上移**，默认不动 |

**「插件在新版上照常工作」恰恰说明旧下限仍成立——这时不要动它。** 只有两种情况才上移：
用了只有新版才有的 API，或在旧版上实测加载失败。上移时**两处一起改**，且 README 那行必须写
**具体版本号**。

### 平台模块表跟随 shell

`shared/web-platform.ts` 的 `PLATFORM_MODULES` 是浏览器模块表的**镜像**，与真实 shell 不符会在
运行时炸。**每次 DSH 升级都要重新核对**（核对方法：到 `dsh-web-frontend/dist/assets/` 下找**含
`__ModuleLoader__` 的那个 bundle**——文件名是内容哈希，按符号找不按文件名找——读它附近
`staticModules` 工厂返回的 seed 对象键）。

### 构建可复现（硬性：产物必须与构建机无关）

`lib/` 是被跟踪的发布产物，CI 会在 Linux 上重建并与提交比对，因此**构建结果不得依赖构建机的
绝对路径、行尾或平台**。三条规则由 CI 与 `pnpm verify` 兜住：

- **绝对路径不得进入产物或用来派生标识**：lightningcss 的 CSS Modules 类名前缀取自传给
  `transform()` 的 `filename`，传绝对路径会让同一份 CSS 在不同目录编译出不同类名。构建脚本
  一律传仓库相对路径（`shared/tsdown.client.ts` 的 `portableCssPath()`）。
- **工作区行尾必须与 `.gitattributes` 一致**：sourcemap 的 `sourcesContent` 内嵌源码原文，
  残留 CRLF 会被原样写进 `lib/client.js.map`。修正：`git rm --cached -r . && git reset --hard`
  按 attributes 重新检出后重建。
- **自检**：把仓库复制到另一个绝对路径、装依赖、构建，产物应逐字节相同（CI 的
  「Committed artifacts match a fresh build」是常驻检查；它红了先怀疑上面两条）。

### 改名的声明处

工具链（`scripts/*.mjs`、npm scripts）都从 `package.json` 读身份，不在代码里重复写名字。
改名只需改声明处，改完让 `pnpm verify` 指出漏改：

| 改什么 | 影响 |
| --- | --- |
| `package.json` 的 `name` | 安装标识；工具据此推导 |
| `cordis.patch.yml` 行的 `name:` | 加载器按它解析包（漏改则启动找不到模块） |
| `tsdown.config.ts` 的 `PACKAGE_NAME` | 浏览器 bundle 的注册 id（漏改则界面加载失败） |
| README / CONTRIBUTING 的安装命令 | 给人看的现成命令 |

**插件 id 不跟着包名变**（它由文件夹名与 `cordis.patch.yml` 的 `id:` 决定，路由此派生）。
**客户端 bundle 的注册 id 必须等于包名**（不是插件 id）：加载器按包名给 bundle 定键，注册成
别的名字会被拒（报 `loaded without registering <name>`）。`pnpm verify` 内置此检查，
`pnpm smoke` 会真的按加载器协议执行一遍 handshake。

---

## 项目定位

DSH Web GUI 的任务看板插件：侧边栏「任务看板」入口 + 多列看板 + 任务经 DSH 会话机制
真实执行 + 5 段 cron 定时调度。**看板数据持久化在 DSH host 端（存储单元 `dsh_task_board`），
任意设备/浏览器（桌面 + 手机，跨 origin）经 SSE 实时同步看到的是同一块板；窄屏为紧凑布局。**
单一 npm 包，cordis 插件，host/client 双半区，MIT 许可，全新独立项目（零历史仓库引用）。

### 命名矩阵（硬性规范 3，新增标识不得偏离）

**插件 id 与包名是两个身份，不得混用**：id 是加载与数据身份的根，包名只是安装标识，带作用域
不改变任何 id、路由、存储单元或数据键。**包名以 `package.json` 的 `name` 为准**（本表照抄它，
改错一个字符就加载不了）；易主或换作用域时改 `package.json` 再同步这一格即可。

| 维度 | 值 |
| --- | --- |
| **插件 id**（行 id / 文件夹名 / locale 命名空间 / `/api/<id>/*` 路由 / 存储单元 / 两个 slot 的 id） | `dsh-task-board` |
| **包名**（`package.json` name / 依赖键 / `dsh.profile.bundles` 项 / `cordis.patch.yml` 行 `name:` / bundle 注册 id / `/plugins/<包名>/client.js`） | 以 `package.json` 的 `name` 为准（当前 `@firetruck666/dsh-task-board`，**含作用域**） |
| 权限预设路由 | `/api/dsh-task-board/permissions` |
| 看板数据路由（前缀） | `/api/dsh-task-board/board`（看板本身在根 tail；`/items` 是第二份文档；`/lease` `/command` `/events` SSE 子路径） |
| 其余 host 路由 | `/api/dsh-task-board/session-state`、`/update`、`/client-report` |
| host 存储单元名 | `dsh_task_board`（落 `~/.dsh/storages/dsh_task_board/` **目录**；`per-record` 布局下单元名就是目录名，而平台只允许 `^[a-z][a-z0-9_]*$`，**不能含连字符**——这就是数据根叫 `dsh_task_board` 的原因） |
| 单元内文档名 | `documents/<name>.json`（`board` 是看板真相，`meta` 是迁移标记；加一种新数据 = 加一个文档名） |
| 启停开关 | profile 里本条目的 `disabled`（不写 = 默认启用，见「启停机制全貌」） |
| **看板舞台 slot** | `main`，`key: dsh-task-board`（keyed slot；`activePanelId === null` 表示会话） |
| **清单舞台 slot** | `main`，`key: dsh-task-board-items`（与看板同一个座位、不同键） |
| **侧栏入口 slot** | `sidebar.panellist`，`id` 与各自的 `main` 键**一致**（shell 靠它把行解析到舞台） |
| **插件行的开关** | `cordis.patch.yml` 的四行 = 详情页的四个开关；关掉 `dsh-task-board-agent` 之后**所有会话的 AI 都看不到本插件的工具、命令与提示词** |
| localStorage 键（同步模式下是离线镜像/草稿/备份） | `dsh.taskBoard.v1` 等（**不得改名**，见硬性规范 5） |

**本插件没有设置项，这是有意的**：每个行为都已经是使用者自己的选择（任务、定时、巡航、规则
都是看板上的数据，在界面里直接编辑），而「插件开不开」是插件管理页的开关。

**本插件向 agent 播报的是行为准则，不是能力清单**：注入 `systemPrompt` 的 `tool:taskboard` 一节，
**固定文本**（变动会击穿提示缓存）。能力清单一律走 `taskboard_capabilities` 按需查——
**清单进提示词就是目录的第二份拷贝，过期清单比没有清单更糟**。

### 启停机制全貌（改任何一处之前先读这段）

装配是**层叠覆盖**：各 bundle 自带的 patch 按 `dsh.profile.bundles` 顺序叠加，然后是 profile 的
`cordis.patch.yml`，最后是 `--patch`。**后层按 `id` 覆盖前层的同一个 id**。于是有两种关法：

| 层级 | 谁在写 | 写什么 | 装配结果 |
| --- | --- | --- | --- |
| 包级 | 插件页右上角开关 | `bundles` 增删包名（profile 的 `package.json`） | 整个 bundle 的层不参与装配，包内所有条目一起消失 |
| 条目级 | 「已安装」列表里那一行的开关 | profile 的 `cordis.patch.yml` 里 `- id: <插件id>` + `disabled: true` | 该条目仍在，末尾多一行 `disabled`；删掉那行即恢复启用 |

**行级开关不需要预埋基准行**——`id` 是覆盖键，所以往 patch 里追加一条只带 id 的行就够了。
反过来，**patch 里没有我们的行是正常状态**：默认启用就是「什么也不写」。

**前提**：那一行必须是**真实装载的** Loader 条目。否则插件管理页的 `listPlugins()` 会给它
`readOnlyReason: "unaddressable"`，两个开关都锁住——不是本插件的问题，是组合没把这一行装上。

**插件详情页没有「slot 列表开关」这种东西**：那个页面上的「包含的组件 / Components」是**区块标题**，
枚举的是 bundle 自己 `cordis.patch.yml` 里的 `insert:` 条目行，与 slot 名毫无关系；详情页里真实的
开关只有两个（右上角「启用 {name}」与每行「启用组件 {name}」），只改 `disabled`/`config` 而不
`insert` 的覆盖行不出现在那个列表里。**插件不注册设置页、也不读自己的启用状态**：加载器只求值
激活的行，所以插件被关掉时它一行代码都不会跑——**「被组合即启用」是结构性质，不是判断逻辑**。

`cordis.yml` **不是配置文件**，是 profile 的**空根**（一段注释加 `[]`），由宿主在启动时写成这样；
`dsh --profile <名字> --dump-config` 渲染的扁平快照是诊断输出，不要把它留在那里。挂载由
`package.json` 的 `dsh.bundle.patch` 指向包内 `cordis.patch.yml`，安装命令只负责把包登记进
`bundles`；**三种安装方式（npm / GitHub / 本地 `link:`）在这件事上完全一致，装完不需要任何
手工步骤**，手写 `cordis.patch.yml` 反而会造成同一个插件出现两条。

## 宿主契约表（外部插件只能这样接；由 `scripts/verify-host-contracts.mjs` 机械校验）

本插件与宿主之间只有下面这些接触面，由 `pnpm verify` 对照**实际安装的 DSH** 逐条核对，
少任何一条即红并指名。三者都不会让构建失败，所以必须机械核对：未声明的 slot 在
`slots.inject` 里**静默 no-op**；被删的服务成员只在用户点击那一刻抛 `TypeError`；缺失的
宿主服务让对应半区**永远等不到依赖、什么也注册不出来**。

### 插件依赖的 slot（必须由宿主声明）

| slot | 用途 |
| --- | --- |
| `main` | 看板舞台（keyed slot，key = `dsh-task-board`） |
| `main` | 任务清单舞台（keyed slot，**key = `dsh-task-board-items`**——一个面板一个键） |
| `sidebar.panellist` | 侧栏面板列表里的两行：看板（id = `dsh-task-board`）与清单（id = `dsh-task-board-items`） |
| `tool.call.toolview` | AI 动作在对话里的呈现（keyed，按工具名） |

**清单与看板是同一形状的两个主舞台面板**：两个 `main` 键、面板列表里的两行、共用同一个
`selectPanel(null)` 出口——出口只有一条，「离开一个面板」就不可能是两种意思。

**这张表只列真有人用的座位**，且与 patch 行、`exports`、`tsdown` entry 一致——门禁查的就是这三个。

### 插件按名读的宿主成员（必须存在）

| 包 | 成员 |
| --- | --- |
| `@deepseek-ai/dsh-client-ui-session` | `sessionStatus` |
| `@deepseek-ai/dsh-client-ui-session` | `pendingInteraction` |
| `@deepseek-ai/dsh-client-ui-workspace` | `openSession` |
| `@deepseek-ai/dsh-client-ui-layout` | `selectPanel` |
| `@deepseek-ai/dsh-api-session-controller` | `binding` |
| `@deepseek-ai/dsh-api-session-controller` | `retain` |

### 插件注入的宿主服务（服务名必须由宿主提供，成员必须存在）

| 半区 | 服务名 | 读取的成员 | 提供包 |
| --- | --- | --- | --- |
| host | `webServer` | `register` | `@deepseek-ai/dsh-host-webserver` |
| host | `tools` | `register` | `@deepseek-ai/dsh-tools` |
| host | `commands` | `register` | `@deepseek-ai/dsh-commands` |
| host | `systemPrompt` | `section` | `@deepseek-ai/dsh-system-prompt` |
| client | `slots` | `inject` | `@deepseek-ai/dsh-client-ui-renderer` |
| client | `slots` | `register` | `@deepseek-ai/dsh-client-ui-renderer` |
| client | `sessions` | `list` | `@deepseek-ai/dsh-api-session-controller` |
| client | `sessions` | `binding` | `@deepseek-ai/dsh-api-session-controller` |
| client | `sessions` | `models` | `@deepseek-ai/dsh-api-session-controller` |
| client | `workspaces` | `list` | `@deepseek-ai/dsh-api-workspace-controller` |
| client | `locale` | `register` | `@deepseek-ai/dsh-client-locale` |
| client | `remote` | `$on` | `@deepseek-ai/dsh-api-gateway` |
| client | `uiSession` | `sessionStatus` | `@deepseek-ai/dsh-client-ui-session` |

**每个注入都是负债**：声明了一个实际不用的服务，会在该服务缺席的部署里白等——那个半区永远不
激活，什么也注册不出来。所以 `inject` 只列真正用到的（本插件**不**注入 `settings` /
`configForms`，也**不**注入右栏那个服务——清单曾在打开时顺手收起右栏，主舞台面板并不和它争
地方，那条连同 `dsh-client-ui-sidebar-right` 一起删了）。**留一行没有使用者的服务，和留一个
没有使用者的座位是同一种过时。** 该脚本另带两组反向自测（`--probe-removed` / `--probe-services`）：
拿一组**不可能存在**的成员与服务名各扫一次，**两次都必须报红**——否则说明检查本身失效了，
而不是源码干净。

**两条使用纪律**（比表本身更重要）：

1. **只用宿主自己声明的 seat，禁止猜 shell 的 DOM 或类名。** 界面全部经上面两个官方 slot；
   自打的属性只标记**自己的**子树（`data-dsh-taskboard-view` / `data-dsh-taskboard-panel`），
   不读写 shell 的节点或类名——那是唯一不能靠文档兜住的脆弱面（shell 换实现即失效，且不报错）。
2. **接口只按名读，绝不 `instanceof`、绝不跨包值导入。** 宿主成员缺失时降级并说真话
   （`openSession` 返回 `false` 让 UI 就近报错），不抛、不静默假装成功。

## 架构（索引：职责与入口，机制细节以代码注释为准，不复述）

这一节是**索引**，只回答「有什么、归谁、去哪读」：**机制只有一份，写在它所属的模块注释里**，
下面出现的每个文件与函数名就是那个位置。**已经成文的规则不在这里重写一遍**——重复的第三份
只会在其中一份改动时变成谎话。

### host 半区（DSH 主进程）

- `src/index.ts`：inject 只有 `webServer`；`ctx.effect` 各注册一条路由。**模型的整个面搬去了
  它自己的一行**（`src/host-agent.ts`），所以关掉「AI 接口」是装配层的事，不是一次会被忘掉的
  运行时判断。**没有 `Config` schema、没有 enable 检查**——启停是 profile 行的 `disabled`。
- `src/host/surfaces.ts` 与 `cordis.patch.yml` 的四行：**一行 = 详情页上的一个开关**；面板的开关
  只能由宿主侧那一行先宣告（`host-board.ts` / `host-items.ts` 只有几行，宣告本身就是开关的实现）。
- `src/host/agent/`：三个工具（能力查询 / 查询 / 执行）、两条斜杠命令、系统提示那一节。
  **动作目录是它们的唯一权威**（`actions` 枚举按构造取自目录，筛选词表取自 `task-search.ts` 的
  注册表，一个字都不抄）；写工具走 `core/task-transitions.ts` 的共享纯函数——**界面与 AI 调同一套
  语义实现**。批量顺序执行、首个失败即停、**不回滚**、逐条报告；`dry_run` 跑同一套文法的克隆。
  **引擎缺席就明说引擎缺席**。
- `src/host/session-state.ts`：会话态势推导（看板与 AI 读同一份）。答案三态而非布尔：`unknown`
  是「这台机器能看多远」。纯读取模块，测试扫源码禁掉它有任何写路径。
- `src/host/http-json.ts` / `src/host/*-route.ts`：路由共用的信封与请求体读取（禁各写一套）；
  纯 `create*Handler`（可注入测试），服务一律 `ctx.get`。
- `src/host/board-service.ts` + `board-route.ts`：**文档真相服务（看板 + 清单，各有 revision）**
  （持有 + 持久化 + 先落盘后应答 + SSE；缺 hub 则 localStorage 模式）。两份文档由同一个 service
  持有：同名单元同时只能有一个活句柄。存储单元是 `per-record` 文档树（见命名矩阵），
  `openBoardUnit` 是单元打开与**一次性**布局迁移的唯一入口，旧文件与新文档树**必须顺序开关**；
  迁移只对**完全空树**发生（判据是「这棵树写没写过」），**所以删掉数据根仍是一次真正的重置**。
  `KvUnit` 的形状以类型为准。
- `src/host/data-root.ts`：**全插件唯一自己碰介质的地方**，只做一件事——把迁移前的旧整体文件改名
  让位。三道守卫缺一不可（数据已在新位置、文件确属本单元那个版本、目标名没被占）；**改名不是
  删除**，新名字不以 `.json` 结尾。路径全部现场发现。新增任何直接读写数据根的代码都要先想清楚
  为什么不能经 `ctx.storage`。

### client 半区（浏览器）

- `src/client/index.ts`：inject 六服务；offline-first 挂载（副本常驻 → 接线 → 即时可用 → 后台
  收敛）；官方 seat 两处注册（`main` 面板 / `sidebar.panellist` 入口）；宿主面全经 `platform.ts`。
  **没有启用判断**：被组合即启用，生命周期挂在一个 `ctx.effect` 上。
- `route-base.ts`：**浏览器侧路由的唯一出口**（交给 `document.baseURI`）；host 侧注册路径保持绝对，
  浏览器侧任何 `/api/...` 都必须经它。`TaskBoardPanel.tsx` / `TaskBoardIcon.tsx`：看板的两个官方
  seat 组件。`board-transport.ts`：fetch + EventSource（缺席降纯轮询）。
- `src/client/item/`：**清单面板**，与看板同一形状的第二个主舞台面板（`main` key =
  `dsh-task-board-items`，面板列表 `order` 120 紧跟看板，共用同一个 `selectPanel(null)` 出口，
  两图标同构；**座位见宿主契约表，此处不复述**）。**它是一个有内部分页的工作台**：页面身份是
  **写死的产品常量**（`ITEM_PAGES`），三页**永远在轨上、各带自己的数，空页写 0 而不消失**——
  「被问到而答案是零」与「这个问题根本不存在」是两件事；派生页（标签、停滞、归档、筛选结果）
  **不进轨**，只给入口。几何、分页与每页的行文法成文在 `DESIGN.md` 的清单节，本文不复述。
  挂上卡的事项才给「问 AI」（`board-ask.ts` → `/board/ask`），**回执说是哪一个会话**；
  **一律不用 Dialog**（`boardBox()` 会锚到看板上去）。`hostLostItems()` 为真时说「host 读不到」，
  **不能显示成「你一条都没有」**。副本只存在**一个** holder（`itemListStage`）上。
  `src/client/surfaces.ts` 开机读一次 `/board/surfaces`，**读不到就什么都不收窄**。
  **恢复是 host 操作而不是客户端提交**（`items-archive.ts` → `GET /board/items?includeDeleted=1`
  与 `POST /board/items/restore`）：墓碑的戳压在它删掉的那一行之上，原样重提会被墓碑吃掉，
  接口回 200 而文档没变，所以只有 host 能写那个戳。**寻址键有两个、各具名、互不为兜底**：界面的
  一次撤销传 `id`（刚记下的行 `ref === 0`，按编号找不到墓碑），模型的 `item.restore` 传 `ref`
  （编号是「人说得出口的那个东西」）。面板的义务是**恢复没回来就说没回来**，且**「读不到」不得画
  成「空」**。

### 设计系统层（**成文契约全在 `DESIGN.md`**；此处只留改代码前必须先知道的三件事）

- **令牌**：只消费 `--dsw-*`（CSS 禁 hex/rgb，verify 审计）。**画布层吃画布令牌、内层表面才吃
  不透明层令牌**（The Opaque Inner Rule）——把画布当内层画，宿主的玻璃皮肤就一点也透不进来。
  尺寸按板盒百分比算（**禁 vw/vh**）；`Dialog` 默认 portal 到板盒，Escape 只在一处管。
- **圆角与形状是两条轴**：`corner-shape` 在根层**一次**声明（全表一处也不许补），`--dsh-tb-corner`
  是换肤的唯一开关。**「圆变方」从来不是半径的问题**，改半径永远修不好它。
- **判据一律不落在界面上**：行轨定值、字阶、颜色预算、三种日期的四种读法、窄屏逐控件结论，全部
  成文在 `DESIGN.md` 的对应节，并且多数各带一条机械断言。**改界面前先读那一节，别从代码反推。**
  响应式**禁 `@media(max-width)`**（JS 侧唯一开关是 `useSurfaceNarrow`）；触屏**只加热区不改几何**；
  拖拽的投放与排序契约见 `DESIGN.md`（**已知缺口：换栏走 HTML5 拖放，触屏不触发，而那一半的发起端
  在宿主，本插件修不了**）。

### 核心层（`src/core/` 纯逻辑）

- 模块：`tasks` · `task-demand` · `schedule`/`scheduler` · `cruise` · `presets`/`run-presets` ·
  `automation` · `execution`（投递结算）· `controller`（台账 + 调度 + 席位 + 外源双通道）·
  `board-doc`/`host-sync` · `board-merge-core`（合并文法核，**两份文档共用一份**）· `items-doc`
  （清单文档，墓碑带载荷所以删掉的条目找得回）· `item`（清单一行的模型）· **`item-view`**
  （**清单的全部推导：查询文法 / 分组 / 排序 / 行投影 / 三个日期的读法 / 停滞与豁免 / 要处理句子，
  以及页面集 `ITEM_PAGES`**——**界面与模型读的是同一份**，`task-search.ts` 的 `matchItemQuery`
  只是通向它的一道门）· `board-actions`（动作目录，界面与 AI 的唯一同步面，见硬性规范 12）·
  `task-transitions`（看板的语义层）· **`item-transitions`（清单的语义层，与界面同一批纯函数：
  补丁 / 步骤 / 删除 / 恢复 / 快记造行 / 提升成卡）**· `colors`/`session-list`/
  `session-display`/`session-groups`/`comment-thread`/`question-rpc`/`store`。
- **清单的补丁类型是从裁定表派生的，而派生会静默塌掉**：`ItemPatch` 的键集合由 `ITEM_FIELDS`
  的 `access` 列**推导**（`WritableItemKey`），所以被判 `derived` / `forbidden` 的字段在编译期就
  patch 不进去。**这层保护有一个失效方向，而且失效时不报错**：`ITEM_FIELDS` 一旦被「简化」回
  `Record<…, FieldSpec>` 标注（排他性检查照样过、编译照样绿），`access` 拓宽成并集 →
  `WritableItemKey` 塌成 `never` → `ItemPatch` 变成 `{}` → **`{}` 接受任何对象字面量** →
  `{ ref: 3 }` 静默通过。**门禁不是变成一堵墙，是变成一扇敞开的门。** 所以那一行
  `@ts-expect-error` 棘轮是承重的：标注回退时它让 `tsc` 报 `TS2578`，退化从此是**构建失败**。
  **它放在 core 而不是 spec，因为 spec 要有人记得打开。** 同族的第二个实例在 `item-view.ts`
  的 `KEY_GAPS`（按 `Record<ItemSort, …>` 建表，加一档排序会红两处：卡语义与卡话）——**手写的
  「我列全了吗」永远该由类型或文件系统回答，而不是由一个人记得维护。**
- **要决的门**在 `task-demand.ts`：三个子句一条推导，卡片芯片 / 板顶诉求行 / 通知抽屉**三处同读**，
  抽屉的分类就是那两类（`notifications.ts`）。两处不要写错的地方在代码注释里：`openTask`
  （点卡片）**绝不动轮次戳**——卡片是摘要不是对话；「第 N 次执行」只在真有编号运行时说。
- **轮次集合只有两份**（`session-display.ts` / `execution.ts`）：**会话**回答「这段对话在这张卡上
  发生过什么」，**执行复核线程**回答「这一页复核页上有什么没看的」；`cancelled` 不是工作，不进任何
  门。「等你处理」的唯一集合走 `relatedSessionIdsOf`（绑定 + 轮次 + 工作区当前成员 − 已删除）；
  拖进来的会话从绑定起归这张卡管，且**卡片自己必须出声**（圆点在触屏上不可见）。
- **落位**（`tasks.ts`）：引擎派生的换栏与「会话开始或结束工作」都把对象顶到目标列**最上方**，唯一
  落点是 `controller.land`/`landMany`；**留在原栏的结算不重排，用户手动拖动的位置永不被覆盖**；
  **轮次记录只经 `land` 进台账**。屏上「更新于」读 `cardUpdatedAtOf(task)` 而不是同步戳
  `task.updatedAt`，否则一次顶格会让整栏写「刚刚」。
- **活性**（`session-lineage.ts` / `session-activity.ts`）：判定与 `unknown` 的两面见「关键不变量」的
  运行态一条。**裸值边界（改动即反向卡死）**：结算与看门狗（`execution.ts`、`zombieRoundEvent`、
  active-run 兜底、`cancelSpuriousExternal`、`reconcileBoundTask`、外源轮检测）一律继续读**原生会话表
  那一份 `running`**——**局部变量名常是 `summary`，它就是 `byId[id]`**。按本条去搜 `byId[id].running`
  只会搜到两处：**先搜 `summary.running` 与 `byId[…].running`**——搜不到就等于没有那条例外。
- **唯一推导**：`task-live` + `linked-sessions`（相关集/运行态；链接只来自显式 session 绑定）。

### 关键不变量（改前先读对应文件；这里只记边界，细节在代码）

- **多端同步**：真相 = host `BoardDoc`；浏览器乐观写 + 去抖提交 + `applyRemote` 永不回写；单引擎泵
  （租约；席位 `(held,proto,bootedAt)` 任一半变即通知）。
- **运行态唯一推导**：`live` 腿读**会话活跃度**（`own ∨ descendant`），不是裸 `running`；结算的列门
  读同一条腿（轮的期限不因后代延长）；卡片黄边与呼吸同源。
- **统一会话与评论单轨**：同会话同一线程；排队/插话两态只由用户开关定；图片走字节 part、文件走
  `receiptId`（禁自建桥）。
- **附件即内容**：判空只有一处 `isBlankMessage`（文字空且无图无文件才算空）——只发图不发字是真消息，
  任何发送路径都不得拒它。
- **归档是「可恢复的隐藏」，不是删除**：只从 `ctx.workspaces.list` 快照派生 + 订阅，**任何界面不得
  缓存归档结论、不得写进台账**（派生 + 订阅 = 恢复即自愈）。判据三处挑选面共用一套闸门；规则不向
  归档会话投递但**保留 due 槽**；`sessionAvailability()` 是「不可用」的唯一判据。
- **执行门禁**：`taskExecutable` 唯一判定；`ruleReadiness` 次序 disabled→blocked→paused→active；评论与
  插话永不封；`runTask` 单点拦截。空标题/描述从 Prompt 补（永不覆盖）。
- **卡片是 view-model 的投影，不是第二个判断者**：`cardViewModelOf.primary` 就是那颗主芯片
  （组件不再另排一次序，也不再自己算运行数/末次结果/接续/暂停失败）。「下一句话」行读同一个
  `primary`，所以一张卡不可能在相邻两行说两件事。`executing` 与 `hasOpenRun` 曾是两个名字
  同一个谓词（注释却宣称它们是「显示/门禁」之分）——现在只留 `hasOpenRun`。
- **当前值与历史值必须分开读**（权限那类 bug 的根）：**历史页捎带的 projections 是「这个会话当时
  做过什么」**（待办、token、上下文压力），**描述会话「现在是什么设置」的一律走活投影读**
  （`SessionConfigFace.readPermission` → `remote.session.projections`）——`/permission` 不开新一轮
  对话，所以历史页里那份拷贝永远不刷新，面板曾一直显示改动前的预设。**宿主把两件事分开存**：
  `permissions` 投影线上**只有 `{ currentValue: string }`**，候选项来自**另一个**
  `permissionPresets` 目录（`catalog.listPermissions()`）——索要一个 `options` 数组，就把好好的值
  判成「读不到」。**活值读不到就说读不到**（`review.permissionUnreadable`），绝不拿「默认」顶替
  （「默认」本身就是一句关于会话状态的话）；目录里没有的当前值**照原样显示**，不许悄悄改写成
  列表里第一项。**实时选择器里不得有「取消设置」项**（`/permission` 没这个动作，选了等于没选）；
  运行配置表单里的「默认」含义不同（本次运行不写预设），留在那里。
- **借用必持有**：宿主只在**有人持有**某个会话代次时才借出驱动（`sessions.binding` 文档原文：
  "or undefined without a retained generation"）。所以凡是**拥有**一段工作的一次运行、一次续跑、
  一次新建会话配置，一律经 `execution.sessions.hold` 借到**结算为止**（`platform.sessionHoldFactory`
  是唯一实现，引用来源标签走声明合并，不传裸字符串）；`binding` 只留给不得比持有者活得久的读
  （目标条目的即时投影、结算 reconcile 的一次探测、重命名降级）。借不到就诚实失败：开不了会话
  按 `configError` 带着宿主给的原因上报，绝不静默。
- **自动化不许有「上着却跑不起来」的规则**（死臂）：任务级排期与**会话规则**同一条律，读侧
  （`ruleReadiness` / `sessionRuleReadiness` 报 blocked）与写侧（`setSchedule` 拒绝上臂、
  `controller.deadArmedRule` 三条会话写入路径共用）缺一不可。**送达闸门同理唯一**：
  `controller.ruleDeliverable`（在场且未归档）由 cron 心跳、`fireOnCompleteRules`、`fireLoopRule`
  三条路径共用——往收起来的对话发消息等于把它从原生侧边栏的视角里复活。跳过/暂停的档期一律
  **前滚到下一个匹配**，且**不盖 `lastAt`**：那个戳记的是「真的发出去过」，跳过不是发送。
- **车道 = 会话**：`isOpenRound` 唯一判定；预算数轮；卡片离进行中唯一判定 `leaveRunningTargetOf`
  （open/live/schedule 三腿），不另起特判。
- **交互卡**：只订阅 `uiSession.sessionStatus`；carrier 自带 `answer`/`cancel` 时就卡作答（身份守卫：
  身份不符即拒，失败留卡报错）；数据型 carrier 才降级跳回原生；**board 永不注册 waterfall**。
- **自动化与巡航**：任务 `schedule` 与会话 `rules` 正交；on-complete 永续（`done` 硬停）；每会话至多
  一条规则；巡航 `enabled` 主权。
- **草稿**：`drafts.ts` 设备本地；未提交回来、提交清槽；五键；评论 v1 信封。
- **稳定性**：受控回退；就近 inline 反馈；订阅必带终止；正文不省略、元信息可省略号。

## 构建与验证（改完必跑，全绿才算完成）

```sh
pnpm install     # 依赖变化后
pnpm build       # clean-lib + tsc -p tsconfig.build.json + tsdown → lib/index.js + lib/client.js
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm verify      # 静态门禁 + 客户端 bundle 冒烟（注册 id 与 factory 启动）
pnpm smoke       # 只跑客户端 bundle 冒烟：真的按加载器协议执行一遍 handshake
```

`lib/` 是**既跟踪又生成**的产物目录，而打包器写的是**带内容哈希**的 chunk 名：内容一变就多一个
新文件、旧的从不删，于是每次构建都往 npm 里多塞一个没人加载的孤儿。`build` 因此先经
`scripts/clean-lib.mjs` **清空 `lib/`**（该目录下每个文件都由 `pnpm build` 产生，没有手写文件）。

生效规则：改 host 半区（src/index.ts、src/host/）需重启 `dsh web`；改 client 半区
刷新页面即可。

**看渲染结果**用 `node scripts/shot-panel.mjs`（开发工具，**不在 `files` 里、不进包**；用法见该
文件头的 usage 段）。本机没跑 `pnpm run dev:web`，所以闭环是「改 → `pnpm build` → 刷新 → 截图」。
零依赖：Node 内置 `WebSocket` 直连机器上已有的 Chromium，不碰 `dependencies`。`--eval` 在截图前
跑一次 JS 并打印返回值，所以「点进某个面板」不用改脚本。`dsh web` 有认证：**先把启动时打印的那个
带 token 的完整 URL 放进 `DSH_SHOT_URL`**（令牌不进 shell 历史，脚本也从不打印它）；没有就退回去
读不带 token 的地址，脚本会**明确说被拒了**，不会假装成功、也不会写出一张看起来像排版坏了的图。

## 硬性规范

1. **禁 emoji**：代码、注释、文案、文档、提交信息一律不得出现 emoji 字符。
2. **仅官方 NPM SDK**：类型/运行时 API 只来自 `@deepseek-ai/*`（devDependencies）；
   **禁止修改 DSH 源码**；tsconfig 不得 `extends`/`paths` 指向 DSH 源码 checkout
   或任何外部目录。
3. **命名一致性**：见命名矩阵；不得引入新前缀/新命名空间。
4. **零历史残留**：项目内不得出现任何历史仓库标识、路径或来源表述；
   `scripts/verify-standalone.mjs` 内置防回归黑名单（其自身文件豁免）。
5. **数据键稳定**：`dsh.taskBoard.v1` 不得改名。同步模式下这些键是**离线镜像 / 草稿 / preSync
   备份**（真相在 host 存储单元），回退模式下它们就是真相——两种模式下用户数据都不因升级丢失。
   首次连上 host 时：host 为空则本地整视图 bootstrap；host 有数据则按 LWW 逐记录并入，分歧的
   整视图一次性备份到 `dsh.taskBoard.preSync.v1`（只此一次）。
6. **生命周期纪律**：订阅/监听/定时器/observer 全部注册 disposer；DOM 失败
   console.error 不抛；`ctx.effect` 内创建的资源随 effect 清理。
7. **独立自包含**：**运行时没有任何依赖**（`dependencies` 为空；schema 层随设置项一起去掉了，
   host 只 import 类型）；不依赖兄弟插件；界面全部经宿主官方 seat（见「宿主契约表」），
   不依赖任何外部垫片。自打的属性只用来标记**自己的**子树（`data-dsh-taskboard-view` /
   `data-dsh-taskboard-panel`），不读写 shell 的 DOM 或类名。
8. **不引入新依赖**：新增依赖需先说明理由并经确认。确认渠道按角色走（见「先确认角色」）：
   维护者在本会话里确认；贡献者先在 Issue 里讨论，再提 PR。
9. **从机制上解决问题**：遇到新情况先按「行事总纲」的意图与边界推理，而不是等待
   规则增补或把特殊处理写死进代码；当真实的新场景反复出现时，按「本文件的定位与
   编辑规则」更新本文，而不是增加一次性补丁条款。
10. **非 ASCII 内容一律不经 shell 传递**：中文写进文件、拼进命令行、或由 shell 拼进请求体，
    都可能被**静默改写**——共性是**不报错**（命令成功、API 2xx、文件看着正常）。已确认的三种：
    `-Encoding utf8` 加 BOM（首行对 frontmatter 与 JSON 解析器不可读）、引号与转义规则各平台不同、
    行尾被平台改写。**做法**：用文件工具写内容，确需脚本时让它按字节处理并**回读比对**。理由与平台
    无关——一个做法在某系统跑通不代表在另一系统是同一个做法。**这三样现在有门禁**
    （`verify-standalone.mjs` 的 encoding 审计，随 `pnpm verify` 跑）：**U+FFFD**、**UTF-8 BOM**、
    **CRLF**（残留的会原样进 `lib/client.js.map` 的内嵌源码）。三者都**不改任何逻辑，所以没有一条
    功能测试会红**——这正是它们必须由门禁抓、而不是靠人记得回读的原因。`.bat` / `.cmd` 按
    `.gitattributes` 豁免。审计的自测：`--probe-encoding`。
11. **双端同治（移动端不是一等公民之外的二等公民，而是同一等）**：任何 UI、交互、
    文案、动效改动，**必须同时给出桌面与窄屏（手机）两档的结论**，且只能用
    「换行 / 换列 / 让位 / 短名 / 折叠 / 提高地板」表达——**禁止靠藏掉标签、藏掉
    控件、缩小字号来"省地方"**，禁止为窄屏另写一套组件或交互副路径。只在一档验证
    过的改动视为**未完成**。三条硬底线：① 容器装不下时让位而非压扁（裸 `1fr` 轨道、
    无地板的 `flex:1 1 0` 都算没做完）；② 文字永不画在盒外、截断只发生在"文字子槽"；
    ③ 触屏没有 hover——承载必要信息的说明不能只挂 `title=`，必须可点可达。
12. **动作目录是界面与模型之间唯一的同步面，改界面必须同时改它**：
    `src/core/board-actions.ts` 是动作目录（一条表，四个表面读它：工具 schema、能力查询、
    指令规则、覆盖门禁）。**改界面的任何一处之前先问「目录里有同名同参的动作吗」**：两个方向
    各有各的门禁（字段方向编译期、界面方向静态扫描），缺一不可，**门禁红了就改实现，别改门禁**。
    读投影与视图开关不是动作，进 `INTERNAL` 时**必须写清理由**——没有理由的豁免与漏掉一个没有
    区别；`DEBT: ` 开头的理由是如实记下的欠账，每次运行都把笔数打出来。
    **说清不等于说得进去**：一句写在散文里的默认值，门禁读不到；`ParamSpec.default` 里的同一个
    默认值，门禁与渲染器都读得到。**任何要跨表面同步的判定，都必须落在字段上**，不是落在
    `summary` 里。机制细节与自测方式见 `scripts/verify-action-coverage.mjs` 的头注释。
13. **共享接线的参数签名就是接口，改它等于改别人的文件。** 模块之间靠参数传递的形状
    （`registerItemList(ctx, itemStage)` 这类）是**接口**，调用方是别人：把两个参数改成一个，
    不会让调用方「顺带更新」，只会让它在自己的时刻坏掉。**要改签名，先把所有调用点找出来**；
    改不动就加一个新入口、把旧的留着。
14. **一个不看上下文的检查器，会逼着人改对的东西来迁就它。** CSS 断言第一版把注释里的
    字样当成了「令牌使用」，于是正确的修法变成了改注释躲开扫描；真正的修法是**让扫描先剥
    注释再匹配**。遇到一条让实现变得不如以前的检查，先怀疑检查的读法，别先怀疑实现。
15. **「我没查过」和「我查过」在报告里长得一模一样。** 报告里写过「核了 X、核了 Y」，
    就意味着没核的那几处不会有人替你核——而它们常常正是地基。**核过的逐条列出来，没核的
    明说没核**：含糊的肯定比一句「这条我没看」贵。

## 测试（布局约定）

- **一个 src 模块一个 spec，契约按表面/域分组**，清单以 `tests/` 目录为准。**新增逻辑即配测试**
  ——测试是契约不是附件；不要随手加文件，先归入对应域的现有 spec。
- **非显然的分工**（细节在各 spec 里）：`host-sync`/`board-doc` 是同步文法与租约全状态机
  （席位 `(held, proto, bootedAt)` 任一半变化都要触发监听，首租前 proto 为 undefined）；
  `board-service` 带 **LeaseState 唯一构造点**的机械禁令；`board-http` 用真实存储 + 真实
  `http.Server` + 真实 SSE，覆盖 fake 测不到的链路（四种租约应答必带 proto + bootedAt）；
  `controller` 是唯一大文件（端到端，共享 harness 不拆分）；`session-groups` 是会话选择器
  名单的**唯一**规则处（子代理/空白槽/归档的排除、工作区归属账本、未分组尾组，官方
  `sessionVisible` 逐字镜像），`tasks` 带换栏落地的碰撞回归用例（跨栏落地不得读卡片
  自己那条外来键当守卫）；`review-page` / `mobile-contract` /
  `card-contract` 承载**全部 CSS 布局契约**（见设计系统层）；`file-reference-grammar` /
  `session-mention` 是官方包逐字镜像（打包门禁禁跨插件值导入）。
- **`execution.spec.ts` 的假环境必须如实模拟宿主的持有语义**：`binding` 只对**被持有**的
  会话返回驱动（`hold` 才是入口）。一个从 Map 里直接发驱动的假面会让整份 suite 在线上
  全线失败时依然全绿——**「假面比现实宽容」和「假面比现实窄」一样危险**：前者让缺陷隐身，
  后者把正确的实现报成缺陷。
- **`task-demand.spec.ts` 钉的是「三处同读一个门」**：`gateOf` / `sessionGateOf` /
  `boardDemandOf` 的每条用例都是一处曾经互相矛盾的表面对；**任何把它退回单条车道的改动
  （加回 `comment === undefined` 过滤）都必须让这里变红**。`session-permission.spec.ts` 同理
  钉住「权限只读活投影、没有本地副本、选择器里没有取消项」。
