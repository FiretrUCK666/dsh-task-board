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
  激活 profile 是 `profiles` 下的目录。挂载方式见「启停机制全貌」。
- **生效规则**：host 半区改动需重启 `dsh web`；client 半区改动刷新页面即可。
- 兄弟插件：本目录所在 `Plugins` 下的平级独立插件，与本项目互不依赖、互不引用。

## 版本管理与发布（必守）

本项目是「本地仓库 + 远端 `origin` + npm 包」三处结构。**维护者只描述需求，git 与发布由
agent 执行**，不必重复交代流程。三处互不自动同步：`git push` 让从 GitHub 源安装的人立刻
可更新；tag + Release 立版本节点并写更新说明；`npm publish` 更新 npm 上的版本（市场的更新
提示也读它）。**未发布 ≠ 别人拿不到**——push 之后 GitHub 源安装的人就已经拿到了。

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
用了只有新版才有的 API，或在旧版上实测加载失败。上移时**两处一起改**（漏一处就会出现
「README 说支持、装上去却报错」），且 README 那行必须写**具体版本号**。

### 平台模块表跟随 shell

`shared/web-platform.ts` 的 `PLATFORM_MODULES` 是浏览器模块表的**镜像**，决定哪些 import 走
external、哪些必须内联；与真实 shell 不符会在运行时炸。**每次 DSH 升级都要重新核对**，不要
假定它长期有效。**核对方法**：在 `<dsh>/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/`
下找**含 `__ModuleLoader__` 的那个 bundle**（文件名是内容哈希，所以按符号找、不按文件名找），
读它附近 `staticModules` 工厂返回的 seed 对象键（`react` 家族 + `@deepseek-ai/dsh-client-*`）。

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
| 看板数据路由（前缀） | `/api/dsh-task-board/board`（`/lease` `/command` `/events` SSE 子路径） |
| 其余 host 路由 | `/api/dsh-task-board/session-state`、`/update`、`/client-report` |
| host 存储单元名 | `dsh_task_board`（落 `~/.dsh/storages/dsh_task_board.json`；平台只允许 `^[a-z][a-z0-9_]*$`，**不能含连字符**） |
| 启停开关 | profile 里本条目的 `disabled`（不写 = 默认启用，见「启停机制全貌」） |
| **看板舞台 slot** | `main`，`key: dsh-task-board`（keyed slot；`activePanelId === null` 表示会话） |
| **侧栏入口 slot** | `sidebar.panellist`，`id: dsh-task-board`（**必须等于 `main` 的 key**，shell 靠它把行解析到舞台） |
| localStorage 键（同步模式下是离线镜像/草稿/备份） | `dsh.taskBoard.v1` 等（**不得改名**，见硬性规范 5） |

**本插件没有设置项，这是有意的**：每个行为都已经是使用者自己的选择（任务、定时、巡航、规则
都是看板上的数据，在界面里直接编辑），而「插件开不开」是插件管理页的开关——再加一个 `Config`
schema 就是给同一件事再加一个控件。

**本插件不向 agent 播报任何东西**：不注入 `systemPrompt`，看板靠自己出现在界面上被看到。

### 启停机制全貌（改任何一处之前先读这段）

装配是**层叠覆盖**：各 bundle 自带的 patch 按 `dsh.profile.bundles` 顺序叠加，然后是 profile 的
`cordis.patch.yml`，最后是 `--patch`。**后层按 `id` 覆盖前层的同一个 id**。于是有两种关法：

| 层级 | 谁在写 | 写什么 | 装配结果 |
| --- | --- | --- | --- |
| 包级 | 插件页右上角开关 | `bundles` 增删包名（profile 的 `package.json`） | 整个 bundle 的层不参与装配，包内所有条目一起消失 |
| 条目级 | 「已安装」列表里那一行的开关 | profile 的 `cordis.patch.yml` 里 `- id: <插件id>` + `disabled: true` | 该条目仍在，末尾多一行 `disabled`；删掉那行即恢复启用 |

**行级开关不需要预埋基准行**——`id` 是覆盖键，所以往 patch 里追加一条只带 id 的行就够了。
反过来，**patch 里没有我们的行是正常状态**：默认启用就是「什么也不写」。

两者都不需要插件配合：插件不注册设置页、也不读自己的启用状态。加载器只求值激活的行，所以
插件被关掉时它一行代码都不会跑——**「被组合即启用」是结构性质，不是判断逻辑**。

`cordis.yml` **不是配置文件**，是 profile 的**空根**（内容就是一段注释加 `[]`），由宿主在启动时
写成这样；`dsh --profile <名字> --dump-config` 渲染的扁平快照是诊断输出，不要把它留在那里。

挂载：包内 `cordis.patch.yml` 由 `package.json` 的 `dsh.bundle.patch` 指向，安装命令
（`dsh plugin --profile web add <包名或路径>`）只负责把包登记进 `bundles`。**三种安装方式
（npm / GitHub / 本地 `link:`）在这件事上完全一致，装完不需要任何手工步骤**，也不需要往
`cordis.patch.yml` 写任何东西（手写会造成同一个插件出现两条）。界面入口与存储单元在启动时
自动建立；显示名/说明/图标来自包内 `locale/` 与 `icon.svg`。

## 宿主契约表（外部插件只能这样接；由 `scripts/verify-host-contracts.mjs` 机械校验）

本插件与宿主之间只有下面这些接触面，由 `pnpm verify` 对照**实际安装的 DSH** 逐条核对，
少任何一条即红并指名。三者都不会让构建失败，所以必须机械核对：未声明的 slot 在
`slots.inject` 里**静默 no-op**；被删的服务成员只在用户点击那一刻抛 `TypeError`；缺失的
宿主服务让对应半区**永远等不到依赖、什么也注册不出来**。

### 插件依赖的 slot（必须由宿主声明）

| slot | 用途 |
| --- | --- |
| `main` | 看板舞台（keyed slot，key = `dsh-task-board`） |
| `sidebar.panellist` | 侧栏面板图标（id = `dsh-task-board`） |

### 插件按名读的宿主成员（必须存在）

| 包 | 成员 |
| --- | --- |
| `@deepseek-ai/dsh-client-ui-session` | `sessionStatus` |
| `@deepseek-ai/dsh-client-ui-session` | `pendingInteraction` |
| `@deepseek-ai/dsh-client-ui-workspace` | `openSession` |
| `@deepseek-ai/dsh-client-ui-layout` | `selectPanel` |
| `@deepseek-ai/dsh-api-session-controller` | `binding` |

### 插件注入的宿主服务（服务名必须由宿主提供，成员必须存在）

| 半区 | 服务名 | 读取的成员 | 提供包 |
| --- | --- | --- | --- |
| host | `webServer` | `register` | `@deepseek-ai/dsh-host-webserver` |
| client | `slots` | `inject` | `@deepseek-ai/dsh-client-ui-renderer` |
| client | `slots` | `register` | `@deepseek-ai/dsh-client-ui-renderer` |
| client | `sessions` | `list` | `@deepseek-ai/dsh-api-session-controller` |
| client | `sessions` | `binding` | `@deepseek-ai/dsh-api-session-controller` |
| client | `sessions` | `models` | `@deepseek-ai/dsh-api-session-controller` |
| client | `workspaces` | `list` | `@deepseek-ai/dsh-api-workspace-controller` |
| client | `locale` | `register` | `@deepseek-ai/dsh-client-locale` |
| client | `remote` | `$on` | `@deepseek-ai/dsh-api-gateway` |
| client | `uiSession` | `sessionStatus` | `@deepseek-ai/dsh-client-ui-session` |

**每个注入都是负债**：声明了一个实际不用的服务，会在该服务缺席的部署里白等——那个
半区永远不激活，什么也注册不出来。所以 `inject` 只列真正用到的：本插件**不**注入
`settings`、`configForms`（没有设置项要读写）、也不注入 `systemPrompt`（不向 agent
播报任何东西）。

该脚本另带反向检查（源码不得引用宿主已撤的成员），用 `--probe-removed` 自测：它拿一组
已知不存在的成员去扫源码，**必须报红**——否则说明检查本身失效了，而不是源码干净。
服务节同样自带自测，用 `--probe-services`：它拿一个不可能存在的服务名与一个不可能存在
的成员各喂一次，两次都必须报红。

**两条使用纪律**（比表本身更重要）：

1. **只用宿主自己声明的 seat，禁止猜 shell 的 DOM 或类名。** 界面全部经上面两个官方
   slot；自打的属性只标记**自己的**子树（`data-dsh-taskboard-view` /
   `data-dsh-taskboard-panel`），不读写 shell 的节点或类名——那是唯一不能靠文档兜住的
   脆弱面（shell 换实现即失效，且不报错）。
2. **接口只按名读，绝不 `instanceof`、绝不跨包值导入。** 宿主成员缺失时降级并说真话
   （`openSession` 返回 `false` 让 UI 就近报错），不抛、不静默假装成功。

## 架构（索引：职责与入口，机制细节以代码注释为准，不复述）

### host 半区（DSH 主进程）

- `src/index.ts`：inject 只有 `webServer`；五个 `ctx.effect` 各注册一条路由（权限/看板/
  会话状态/更新/页面自报）。**没有 `Config` schema、没有 enable 检查**——启停是 profile 行
  的 `disabled`，加载器只求值激活的行（见「启停机制全貌」）；**不向 agent 播报任何东西、
  不注入 `systemPrompt`；无图片路由、无设置路由**。
- `src/host/http-json.ts`：全部路由共用的信封与请求体读取（一个有界实现，禁各写一套）。
- `src/host/*-route.ts`：纯 `create*Handler`（可注入测试），服务一律 `ctx.get`。
- `src/host/board-service.ts` + `board-route.ts`：**BoardDoc 真相服务**（持有 + storage hub `KvUnit` 持久化 + 先落盘后应答 + SSE；路由见命名矩阵；缺 hub 则 localStorage 模式）。合并文法见核心层 `board-doc.ts`。

### client 半区（浏览器）

- `src/client/index.ts`：inject 六服务；offline-first 挂载（Synced*Store 常驻 → 接线 →
  `controller.start()` 即时可用 → 后台 `sync.start()` 收敛）；官方 seat 两处注册（`main`
  面板 / `sidebar.panellist` 入口）；宿主面全经 `platform.ts`（`buildApi` 钉端点，
  `tests/platform.spec.ts` 钉死）。**没有启用判断**：被组合即启用，整个生命周期挂在一个
  `ctx.effect` 上，插件被关掉时订阅、定时器、SSE 一起释放。
- `route-base.ts`：**浏览器侧路由的唯一出口**（去掉开头斜杠，交给 `document.baseURI`）。
  host 侧注册路径保持绝对；浏览器侧任何 `/api/...` 都必须经它，`tests/route-base.spec.ts` 扫描源码兜住。
- `TaskBoardPanel.tsx` / `TaskBoardIcon.tsx`：看板的两个官方 seat 组件。`board-transport.ts`：
  fetch + EventSource（缺席降纯轮询）。

### 设计系统层（成文契约在 `DESIGN.md`，展开解释见代码注释与 spec）

- **令牌**：只消费 `--dsw-*`（CSS 禁 hex/rgb，verify 审计）；表面三层（画布/不透明内层）；
  浮层同一 chrome，尺寸按板盒百分比算（**禁 vw/vh**）；Dialog 默认 portal 到板盒，Escape 只在一处管。
- **圆角几何在根层一次声明**：`corner-shape` 与 `border-radius` 是不继承的两条轴，环境里的
  superellipse 家族会把 `50%` 圆点渲染成方加圆弧，改半径修不掉。全板只声明一次
  （`[data-dsh-taskboard-view]` / `*[class]` / `[data-dsh-taskboard-panel]`，换肤只重映射
  `--dsh-tb-corner`）。**禁止逐处补 `corner-shape`，也禁止把 `50%` 换成 px 半径去「修圆」**。
- **光效是「呼吸与否」的唯一判定**：等待/进行中 → 卡片 + 会话行呼吸（attention）；已结束未读 →
  卡片呼吸，其未读会话的行与卡片会话点**同呼吸**（unread，同一族琥珀）；已读或空闲 → 静默。
  两口时钟各管各的粒度：卡片光读**任务未读**（打开详情即灭），行/点读**轮次未读**（复核页 /
  标已读 / 通过 / 通知按会话进入才灭），表面只读自己粒度、不互相重推（`sessionUnviewedOf`
  是行与点共用的唯一轮次判据）。卡片 `data-status`（黄边）与 `data-light`（光）读同一事实。
- **响应式与触屏**：参照是**表面自身宽度**（板 `dsh-tb` / 面板 `dsh-tb-panel`），**禁
  `@media(max-width)`**；紧凑档用列滑轨 + 五等分 tab（短名 + `aria-label` 全名）；窄屏锚定
  弹层换 Dialog；JS 侧唯一开关是 `useSurfaceNarrow`。
- **排版/间距/加载**：表单行用具名 areas 让标签让位；说明必须可点可达（**禁只挂 `title=`**）；
  间距一律 gap 声明、偏移由令牌派生（禁手写像素）；加载三态（读中安静 / 失败行内重试 + 自动
  退避 / 空态非错）；共用部件一律复用 `ui.tsx` / `Chip` / `Dialog` / `Markdown` / `AutomationEditor`。
- **拖拽**：`drop-position` / `drag-autoscroll` / `use-flip` 三件套全结构驱动；跨列先滚入视野；
  排序只在按住拖拽时发生。

### 核心层（`src/core/` 纯逻辑）

- 模块：`tasks` · `schedule`/`scheduler` · `cruise` · `presets`/`run-presets` · `automation` ·
  `colors`/`session-list`/`session-display`/`session-groups`/`comment-thread`/`question-rpc`/`store` ·
  `execution`（投递结算）· `controller`（台账 + 调度 + 席位 + 外源双通道）· `board-doc`/`host-sync`。
- **换栏落地**：引擎派生的换栏一律把卡片顶到**目标栏最上方**（按发生时间，最新在上），
  唯一落点是 `controller.land`/`landMany`，`promoteManyToColumnTop` 是排序层的唯一实现
  （`promoteToColumnTop` 是它的单张入口）。空转判据读**落位后的「栏位 + 键」赋值**，
  绝不读卡片自己那条来自上一栏的键——那会让跨栏落地整体空转（顶格失效、键相同时
  按数组顺序显示）。**留在原栏的结算不重排**；**用户手动拖动的位置永不被覆盖**
  （人工路径是 `moveTask`/`applyCardOrder`，与提升互不相干）。新卡出生（create/copy/
  instantiate）直接调 `promoteToColumnTop`，语义不同，不并进漏斗。
- **同步戳与显示口径必须分离**：`task.updatedAt` 是同步合并的 LWW 键，让位的同门
  必须盖章（漏盖即两台设备顺序漂移）；但屏上「更新于」读 `cardUpdatedAtOf(task)`
  （卡片自己的工作推进），否则一次顶格会让整栏同门一起写「刚刚」。
- **会话活跃度（「还在工作吗」的唯一判定）**：`session-lineage` 卷起子代理后代，`session-activity`
  给出 `own|descendant|idle|unknown`，`controller.sessionActiveOf` 是唯一对外查询口。`unknown`
  既不得读作 idle 去写台账，也不得读作 active 去长占。**裸值边界（改动即反向卡死）**：
  `execution.ts`、`zombieRoundEvent`、active-run 兜底、`cancelSpuriousExternal`、
  `reconcileBoundTask`、外源轮检测一律继续读 `byId[id].running` **原值**——卷起值只进活性层，
  否则轮次永不过期并产生幽灵外源轮。
- **唯一推导**：`task-live` + `linked-sessions`（相关集/运行态；链接只来自显式 session 绑定；
  归档即时同步）。

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
5. **数据键稳定**：`dsh.taskBoard.v1` 不得改名。同步模式下这些键是**离线镜像 / 草稿 / preSync
   备份**（真相在 host 存储单元），回退模式下它们就是真相——两种模式下用户数据都不因升级丢失。
   首次连上 host 时：host 为空则本地整视图 bootstrap；host 有数据则按 LWW 逐记录并入，分歧的
   整视图一次性备份到 `dsh.taskBoard.preSync.v1`（只此一次，之后不再产生副本）。
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
10. **非 ASCII 内容一律不经 shell 传递**：中文（及任何非 ASCII）写进文件、拼进命令行、
   或由 shell 拼进请求体，都可能被**静默改写**——这类损坏的共性是**不报错**（命令成功、
   API 返回 2xx、文件看着正常），只有打开内容才看得出。已确认的三种形态：Windows 的
   `-Encoding utf8` 会加 UTF-8 BOM（令 frontmatter / JSON 解析器读不到首行）、引号与
   转义规则各平台不同（内容被吃掉或转义被改写）、行尾被平台改写。
   **做法**：用文件工具（`write` / `edit`）写内容，而不是 shell；确需脚本时让脚本按
   字节处理，并在写入后**回读比对**，不一致即报错。理由与平台无关——一个做法在某个
   系统上跑通，不代表它在另一个系统上是同一个做法。发版说明就按此规则走——起草脚本
   写 UTF-8 文件、工作流用 `--notes-file` 按文件发送（见发版段），本规范把它提升为
   全项目通则。
11. **双端同治（移动端不是一等公民之外的二等公民，而是同一等）**：任何 UI、交互、
    文案、动效改动，**必须同时给出桌面与窄屏（手机）两档的结论**，且只能用
    「换行 / 换列 / 让位 / 短名 / 折叠 / 提高地板」表达——**禁止靠藏掉标签、藏掉
    控件、缩小字号来"省地方"**，禁止为窄屏另写一套组件或交互副路径。只在一档验证
    过的改动视为**未完成**。三条硬底线：① 容器装不下时让位而非压扁（裸 `1fr` 轨道、
    无地板的 `flex:1 1 0` 都算没做完）；② 文字永不画在盒外、截断只发生在"文字子槽"；
    ③ 触屏没有 hover——承载必要信息的说明不能只挂 `title=`，必须可点可达。

## 测试（布局约定）

- **一个 src 模块一个 spec，契约按表面/域分组**（review 页纯逻辑 / card 契约 / host 路由 /
  拖拽几何 / 端到端 controller），清单以 `tests/` 目录为准。**新增逻辑即配测试**——测试是契约，
  不是附件；不要随手加文件，先归入对应域的现有 spec。
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
