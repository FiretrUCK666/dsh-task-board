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
  绝不靠写死的细节——能做成配置、参数、规则表或自动探测的，就不把具体值、具体
  路径、具体名字硬编码进代码，环境变了、需求变了，代码不用重写；但动态化要真的
  服务于这个目的，不是为动态而动态。不依赖特定细节的做法，环境怎么变都不会失效
  ——通则即稳定；
- **融入结构，不打补丁**：任何新增（能力、规则、流程、工具用法）都要找到它在整体
  中的位置并融入进去，而不是在边上再挂一块；同一个问题第二次出现，说明上次治的
  是标，回头治根；
- **保持清朗，不堆屎山**：所有产物——方案、清单、目录、文件、流程、代码——都要
  结构清晰、职责分明、可维护可演进，改动时知道该动哪一处，而不是牵一发动全身；
  宁可多想一步，也不留下一堆难以理解、难以修改的堆积物。每次改动后自问：这次
  之后，还能不能在不弄坏别处的前提下接着往下写？答不上来，就是屎山又长高了
  一层，回退一步重做。

### 方案与决策

**先尽全力想出最优解**，这是默认动作：把请求做到能力范围内最好，直接说清最佳方案
是什么、为什么是它，不偷懒，不把决定权随手丢回去。

**给一个还是给几个，现场判断**，标准只有一条：这个选择是否取决于只有使用者自己
知道的实际情况。不是——只给最优解；是——给出几个方案让他挑。多方案必须是方向
不同、各自完整可用的平行路线（「都行得通，只是取向不一样」），不是从保守到激进
的梯子，也不拿明知不成立的选项凑数——一个稳妥但不成立的方案没有任何价值。不搞
「永远给一个」或「永远给三个」的套路。

**一次想到底**：设计必须一步到位、充分考虑清楚，不分期、不写「第一版先这样，然后
观察某某再调整」这类试探性措辞。（这条管**方案设计**；代码实现仍按「最小可用、
增量扩展」走，两者不矛盾。）

**取舍要说明影响**，且始终是 UX（使用者用起来顺不顺手）、DX（以后改、以后加功能
累不累）、AX（后续接手的人能不能看懂、能不能安全改动）三件事同时变好，并且不
破坏任何已有东西。需要取舍时说清楚对日常使用和后续维护的实际影响；普通取舍自己
决定，差别明显、或以后很难撤回的决定才交给使用者选。

### 动手前后四问（适用于任何任务）

前三条动手前问，第四条动手后问：

1. 我这是在治标，还是在治本？
2. 这个做法能覆盖一类问题，还是只覆盖眼前这一个？
3. 做完之后，整体是更清晰了，还是更臃肿了？
4. 我实际跑过了吗，凭什么说它真的成了？

### 工程落地纪律（改代码、写文档、新增能力时的具体法则）

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
  功能稳定；能少动就不多动；
- **高效稳定**：既不慢也不脆——不在每次运行都重复做白工，也不让一次
  小异常把整个流程带崩；
- **修故障修根因，不糊一层**：先查清错误为什么发生再动手，修完这一类问题
  就不该再来；不许用「加个判断挡住它」「出错就重试一次」把症状往后推。
  被替换掉的旧逻辑一并清干净，不留两套做法并存；
- **不修好一个、弄坏一个**：每改一处，重新确认跟它相关的功能还正常；
  改完就宣布完成、不去看别处，等于把一个故障换成了一个更隐蔽的故障；
- **做完必须反复实测**：不能靠「看起来对了」——代码真跑一遍，改完确认真的
  好了、别处也没坏，脚本、配置、文档同样要过一遍；来回多验几遍，涉及好几处
  的地方每处都验。判断标准：拿得出实际跑过的结果才算完成，拿不出就是没做完；
- **不立碑，不写履历**：不为一次意外新增永久规则或纪念性注释——规则要来自
  真实的结构需要，而不是来自一次意外的惊吓；代码、脚本、配置、文档、文件名
  只写它现在做什么，不写改过什么、谁改的、旧版本什么样，也不写
  「以前是…改成…」这类履历——履历放提交记录里。判断标准：一个从没看过
  这个项目的人，只看这一份能不能正确理解？不能，就是里面混进了过时的东西。

任务编排、搜索调研、文件整理……一切具体方法，都是这条总纲的落地方式。

## 本文件的定位与编辑规则

本文件是**项目的契约**（面向 AI），随仓库走：写**机制、架构、不变量、硬性规范、构建/测试/
发布该做什么**，不写账号、远端、作用域这类取值，也不写一次性的决定。

**取值一律现场读**（`package.json` / `git remote -v` / `git config user.name` / `npm whoami`）
——仓库是唯一权威。**这条只管本文**：README 与 CONTRIBUTING 给人看，必须写具体命令。

**本文是活的**：与代码不符时以「本文意图 + 代码现状」为准并修正本文；过时、与代码不符、覆盖不到、
有歧义——都应直接改本文并提交，而不是绕过它、只做口头约定、或把特殊处理写死进代码。
编辑时：面向 AI、与代码一致、写意图不写快照、精炼、禁 emoji、涉及用户可见能力或命令时同步 README。

### 几份文档的分工

| 文档 | 回答什么 | 权威来源 | 是否随包发出 |
| --- | --- | --- | --- |
| `README.md` / `.en.md` | 怎么装、怎么用、坏了怎么办 | 随包发出，面向使用者 | 是，改动即用户可见 |
| `PRODUCT.md` | 为谁做、做到什么算成功、哪些约束不许破 | 用户确认的产品事实 | 否 |
| `DESIGN.md` | 长什么样、为什么这样长、新界面怎么不跑偏 | **代码** | 否 |
| `AGENTS.md`、`CONTRIBUTING.md` | 给 AI 与接手者的说明 | 本文即契约 | 否 |

- **冲突时以代码为准**：`DESIGN.md` 记录现状、改它去对齐代码；`PRODUCT.md` 相反——代码与它
  矛盾时改代码。
- **不随包发出的文档不 bump 版本**（改完只提交）；README 随包发出，改一个字都要 bump。
- **中文版是权威**，英文版是它的翻译；改一份必须打开另一份一起看，不要机械对译。
- **本文是索引，不是副本**：只记别的文档存在、谁是权威、何时同步。
- **派生内容用工具生成**：两份 README 的目录由 `pnpm toc`（`scripts/sync-toc.mjs`）写在成对
  标记之间，增删或改名二级标题后必须重跑，否则 `pnpm verify` 会红。**锚点不要手写**（写错
  表现为「点了没反应」且不报错）。徽章依赖外部服务，**不进自动检查**。

## 环境与上下文（以实际环境为准，不依赖固定值）

- 宿主：DeepSeek Harness (DSH) Web GUI；本插件以 cordis 插件形态存在。平台与用户名不写死——
  需要时用 `process.platform`、`os.homedir()` 现场发现。
- 项目根：本文件所在目录。DSH 数据根：`$DSH_HOME` 优先，否则 `os.homedir()` 下的 `.dsh`；
  激活 profile 是 `profiles` 下的目录，挂载方式见「启停机制」。**生效规则**：host 半区改动需
  重启 `dsh web`，client 半区改动刷新页面即可。

## 版本管理与发布（必守）

本项目是「本地仓库 + 远端 `origin` + npm 包」三处结构，**维护者只描述需求，git 与发布由 agent
执行**。三处互不自动同步：`git push` 让从 GitHub 源安装的人立刻可更新；tag + Release 立版本节点
并写更新说明；`npm publish` 更新 npm 上的版本。**未发布 ≠ 别人拿不到**。

### 先确认角色（涉及推送/发布前先做一次）

**推 main、打 tag、发布只属于维护者**，判断不靠问，靠仓库自身的事实：**维护者 = `npm whoami`
对得上 `package.json` name 的作用域段，且 `git remote get-url origin` 与 `repository.url` 指向
同一正本仓库**。**任一不过、判断不了、或 `npm whoami` 401**（只是登录态缺失）= 贡献者：
开发、构建、测试、改文档照本文做，但**到此为止**——推自己的分支并开 PR，**不** tag、**不**建
Release、**不** `npm publish`。**用户在本会话主动下达维护者动作即为授权——直接执行，不再重复
判定**，agent 不得主动开口求放行。清单见 `CONTRIBUTING.md`。

### 日常（用户描述需求即触发）——一次改到远端，不打标签

1. `git status` 确认工作区；动手前记下 HEAD 作「改前存档点」（`git rev-parse --short HEAD`），
   另有未提交改动先 `git stash push`。
2. 改代码。
3. `pnpm typecheck` + `pnpm test`。
4. 用户可见改动 → bump `package.json` patch，**只抬号不打标签**。判据是**使用者会不会看到**：

   | 要 bump | 不 bump |
   | --- | --- |
   | 行为、界面、交互、报错文案、随包发出的 README | 重构、测试、构建脚本、不进包的内部文档 |

5. `pnpm build`（**版号在 build 时进包**，顺序不能颠倒）。
6. `pnpm verify`。
7. `git add -A && git commit`——提交信息简短说明本次改动（禁 emoji）。**`lib/` 与产生它的
   src 改动必须同一次提交**。
8. `git push origin main`。

**停手**（用户说「先别提交 / 只看效果」）：只做到第 6 步。**贡献者版闭环**：第 1–6 步相同
（含 bump），第 7–8 步改为推自己的分支并开 PR。

### 发版（只有用户明确说「发版 / 发出去 / npm publish」才触发）

9. `git tag v<版本>` + `git push origin v<版本>`——**其余步骤全由 `.github/workflows/release.yml` 完成，agent 不手动执行任何一步**（重跑 gate、
   校验版本、写说明、建 Release、OIDC 发布、回读 registry）。**正常路径不需要 PAT、本机 npm 登录、gh CLI 或 2FA**；失败就重跑工作流（幂等）。
   **它到底做什么，读那个文件本身**。
10. 唯一的例外：**publish 报 404 / ENEEDAUTH 类是 npmjs.com 的 Trusted Publisher 配错**；按
    `release.yml` 头注释那三项核对，确认没配才退回手动 `npm publish --access public`——需要
    2FA 码，**由账号持有人在自己终端执行**。

### 版本号与不变量

三档语义：patch（日常默认）/ minor（明显新功能）/ major（大改版）。**单调递增，永不复用**：
已 `npm publish` 的版本号不能再发第二次。**已推送的历史不改写**：不用 `git push --force`、
不 rebase。回滚分档：未提交 → 丢弃；已提交未推送 → `git reset --hard <存档点>`；已推送 →
`git revert`；已发 npm → 只能发新版本。用户可见改动完成后**只报版号**（板内不显示版本号）。

### 身份与发布前检查

- 提交身份：`user.name` 用仓库所有者常用署名；`user.email` 用 GitHub noreply 地址
  （`<id>+<login>@users.noreply.github.com`，现场确认）。
- 发布前必查 `pnpm verify`，并把 `npm pack` 产物装进隔离 profile 真实加载一遍。
- 不提交 `node_modules/`；**`lib/` 必须提交**（安装时不执行构建，缺了别人起不来）。

### 依赖版本同步（硬性，不必每次交代）

**SDK 版本必须跟随实际运行的 DSH**，每次现场查，不写死、也不靠宽松范围蒙过去。两条规律：

- **SDK 与 DSH 本体同号**：`@deepseek-ai/dsh-*` 的版本与正在运行的 DSH 一致；`@deepseek-ai/cordis`
  走自己的线。**个别包会停更**，所以每个包都要单独确认目标版本确实存在。
- **npm 的 `latest` dist-tag 不可信**（可能停在很旧的版本）。**不得用 `npm view <pkg> version`
  判断最新**，一律 `npm view <pkg> versions --json` 取完整列表，从末尾找目标版本。

同步动作（DSH 升级后主动做）：读**实际运行的**版本作为目标（`node -p
"require('<dsh 安装目录>/package.json').version"`），逐个确认该版本存在，只写进 `devDependencies`
（**不动** `peerDependencies` 与 README 下限），然后 `pnpm install`、typecheck + test 全绿（跨版本
升级常伴随 API 改名，类型报错就是信号——按新契约改写，**不要用 `any` 绕过**）、构建并确认
`lib/index.js` 能 import、`lib/client.js` 注册 id 等于包名。用户可见改动 → bump patch。

### 最低支持版本（只在真不兼容时上移）

跟着 DSH 走的是 `devDependencies`；**上移的是** `peerDependencies` 的 `>=` 值 + README「环境要求」
那一行，而它**只在真不兼容时上移**（新版本才有的 API，或在旧版上实测加载失败）。**「插件在新版上
照常可用」恰恰说明旧下限仍成立**——这时不要动它。

### 构建可复现（硬性：产物必须与构建机无关）

CI 在 Linux 上重建 `lib/` 并与提交比对，所以**产物不得依赖构建机的绝对路径或行尾**：绝对路径不得
进产物或派生标识（见 `build/tsdown.client.ts` 的 `portableCssPath()`）；行尾须与 `.gitattributes`
一致（残留 CRLF 会写进 map 的内嵌源码）。两条都由 CI 与 `verify` 兜住；自检是把仓库复制到另一
绝对路径构建，产物应逐字节相同。
### 改名的声明处

工具链（`scripts/*.mjs`、npm scripts）都从 `package.json` 读身份，不在代码里重复写名字。
改名只改声明处，`pnpm verify` 会指出漏改：

| 改什么 | 影响 |
| --- | --- |
| `package.json` 的 `name` | 安装标识；工具据此推导 |
| `cordis.patch.yml` 行的 `name:` | 加载器按它解析包（漏改则启动找不到模块） |
| `tsdown.config.ts` 的 `PACKAGE_NAME` | 浏览器 bundle 的注册 id（漏改则界面加载失败） |
| README / CONTRIBUTING 的安装命令 | 给人看的现成命令 |

**插件 id 不跟着包名变**（它由文件夹名与 `cordis.patch.yml` 的 `id:` 决定，路由此派生）。**客户端
bundle 的注册 id 必须等于包名**（不是插件 id）：加载器按包名给 bundle 定键，注册成别的名字会被拒
（报 `loaded without registering <name>`）。`pnpm verify` 内置此检查。

---

## 项目定位

DSH Web GUI 的任务看板插件：侧边栏入口 + 多列看板 + 任务经 DSH 会话机制真实执行 + 5 段 cron 定时
调度。**看板数据持久化在 DSH host 端（存储单元 `dsh_task_board`），任意设备/浏览器（桌面 + 手机，
跨 origin）经 SSE 实时同步看到的是同一块板；窄屏为紧凑布局。** 单一 npm 包，cordis 插件，host/client
双半区，MIT 许可，零历史仓库引用。

### 命名矩阵（硬性规范 3，新增标识不得偏离）

**插件 id 与包名是两个身份，不得混用**：id 是加载与数据身份的根，包名只是安装标识，带作用域
不改变任何 id、路由、存储单元或数据键。**包名以 `package.json` 的 `name` 为准**。

| 维度 | 值 |
| --- | --- |
| **插件 id**（行 id / 文件夹名 / locale 命名空间 / `/api/<id>/*` 路由 / 存储单元 / 两个 slot 的 id） | `dsh-task-board` |
| **包名**（`package.json` name / 依赖键 / `dsh.profile.bundles` 项 / `cordis.patch.yml` 行 `name:` / bundle 注册 id / `/plugins/<包名>/client.js`） | 以 `package.json` 的 `name` 为准（当前 `@firetruck666/dsh-task-board`，**含作用域**） |
| 权限预设路由 | `/api/dsh-task-board/permissions` |
| 看板数据路由（前缀） | `/api/dsh-task-board/board`（看板本身在根 tail；`/items` 是第二份文档；`/lease` `/command` `/events` SSE 子路径） |
| 其余 host 路由 | `/api/dsh-task-board/session-state`、`/update`、`/client-report`、`/attachments`（收字节与按 ref 读回） |
| host 存储单元名 | `dsh_task_board`（落 `~/.dsh/storages/dsh_task_board/` **目录**；平台只允许 `^[a-z][a-z0-9_]*$`，**不能含连字符**） |
| 单元内文档名 | `documents/<name>.json`（`board` 是看板真相，`meta` 是迁移标记；加一种新数据 = 加一个文档名） |
| 启停开关 | profile 里本条目的 `disabled`（不写 = 默认启用，见「启停机制」） |
| **舞台 slot 的 key** | 四个 `main` 舞台各带一个 keyed slot，**key 都取插件 id 派生的名字**；侧栏入口是 `sidebar.panellist` 的一行，**id 与各自的 `main` 键一致**。具体键见「宿主契约表」 |
| **插件行的开关** | `cordis.patch.yml` 的五行 = 详情页的五个开关；关掉 `dsh-task-board-agent` 之后**所有会话的 AI 都看不到本插件的工具、命令与提示词** |
| localStorage 键（同步模式下是离线镜像/草稿/备份） | `dsh.taskBoard.v1` 等（**不得改名**，见硬性规范 5） |

**本插件没有设置项**：每个行为都是看板上的数据，在界面里直接编辑。

**本插件向 agent 播报的是行为准则，不是能力清单**：注入 `systemPrompt` 的 `tool:taskboard` 一节是
**固定文本**（变动会击穿提示缓存）；能力清单一律走 `taskboard_capabilities` 按需查。

### 启停机制（改任何一处之前先读这段）

**「被组合即启用」是结构性质，不是判断逻辑**：插件不读自己的启用状态，被关掉时一行代码都不跑。开关只有两个层级：**包级**（profile `package.json` 的 `bundles` 增删包名）与
**条目级**（profile `cordis.patch.yml` 里 `- id: <插件id>` + `disabled: true`，删掉那行即恢复）。

三条容易踩的：**行级开关不需要预埋基准行**（`id` 是覆盖键）；那一行必须是**真实装载的** Loader 条目，
否则插件管理页会把两个开关锁成 `unaddressable`；插件详情页的「包含的组件」是**区块标题**，
枚举的是 `insert:` 条目行、与 slot 名无关。挂载由 `package.json` 的 `dsh.bundle.patch` 指向包内
`cordis.patch.yml`，**手写 patch 反而会造成同一个插件出现两条**。

**开发仪器由环境门控，不由 profile 行门控**：设计系统预览页的 surface 由**包行**在
`DSH_TASK_BOARD_DESIGN_PREVIEW=1` 时宣告——给它一行就等于给每个用户的插件详情页多一个开关，而它是
开发仪器不是产品面板。浏览器侧读不到宿主时它的默认是**不注册**，与两个产品面板**相反**。

## 宿主契约表（外部插件只能这样接；由 `scripts/verify-host-contracts.mjs` 机械校验）

本插件与宿主之间只有下面这些接触面，由 `pnpm verify` 对照**实际安装的 DSH** 逐条核对，少一条即红
并指名。三者都不会让构建失败，所以必须机械核对——**静默 no-op、延迟到点击那一刻才抛、
整半区等不到依赖**，都只有用户能发现。

### 插件依赖的 slot（必须由宿主声明）

| slot | 用途 |
| --- | --- |
| `main` | 总览舞台（keyed slot，key = `dsh-task-board-home`） |
| `main` | 看板舞台（keyed slot，key = `dsh-task-board`） |
| `main` | 任务清单舞台（keyed slot，**key = `dsh-task-board-items`**——一个面板一个键） |
| `main` | 设计系统预览舞台（keyed slot，**key = `dsh-task-board-design`**，只在开发环境注册） |
| `sidebar.panellist` | 侧栏面板列表里的四行：总览 / 看板 / 清单 / 设计系统（id 与各自的 `main` 键**一致**） |
| `tool.call.toolview` | AI 动作在对话里的呈现（keyed，按工具名） |

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

**这张表是声明，不是副本**——`verify-host-contracts.mjs` 逐条解析它，与实际安装的 DSH 和源码里
各半区的 `inject` 列表对照，少一行即红。

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

**每个注入都是负债**：声明一个实际不用的服务，在那个半区永不激活的部署里白等。
所以 `inject` 只列真正用到的（**不**注入 `settings` / `configForms`，也**不**注入右栏那个服务）。
该脚本另带反向自测（`--probe-removed` / `--probe-services` / `--probe-attachment-face`）：拿
**不可能存在**的成员与服务名各扫一次，**都必须报红**——否则检查本身失效了。

### 插件按名读的宿主服务（**不进 `inject`**：缺席即降级）

`ctx.get(<名>)` 直接读、不声明——读不到时那个动作不出现，插件照常加载。核对方式同上表；
**只判在不在的服务**在成员一列写服务名本身。

| 半区 | 服务名 | 读取的成员 | 提供包 |
| --- | --- | --- | --- |
| host | `profileContext` | `dir` | `@deepseek-ai/dsh` |
| host | `pluginManager` | `installBundle`、`removeBundle`、`registries` | `@deepseek-ai/dsh-plugin-manager` |
| host | `hmr` | `hmr` | `@deepseek-ai/dsh-hmr` |
| host | `attachments` | `admitEncodedFile`、`saveImage`、`readImage`、`readFileStream` | `@deepseek-ai/dsh-attachment` |

**两条使用纪律**：

1. **只用宿主自己声明的 seat，禁止猜 shell 的 DOM 或类名。** 界面全部经上面两个官方 slot；
   自打的属性只标记**自己的**子树（`data-dsh-taskboard-view` / `data-dsh-taskboard-panel`），
   不读写 shell 的节点或类名——那是唯一兜不住的脆弱面。
2. **接口只按名读，绝不 `instanceof`、绝不跨包值导入。** 宿主成员缺失时降级并说真话
   （`openSession` 返回 `false` 让 UI 就近报错），不抛、不假装成功。

## 架构（索引：职责与入口，机制细节以代码注释为准，不复述）

只回答「有什么、归谁、去哪读」：**机制只有一份，写在它所属的模块注释里**，下面出现的每个
文件与函数名就是那个位置。

### host 半区（DSH 主进程）

- `src/index.ts`：inject 只有 `webServer`；`ctx.effect` 各注册一条路由。**模型的整个面在它自己的
  一行**（`src/host-agent.ts`）。**启停不在代码里判断**（见「启停机制」）。
- `src/host/surfaces.ts` 与 `cordis.patch.yml` 的五行：面板的开关只能由宿主侧那一行先宣告。
- `src/host/agent/`：三个工具（能力查询 / 查询 / 执行）、两条斜杠命令、系统提示那一节。
  **动作目录是它们唯一的权威**；写工具走 `src/core/task-transitions.ts` 的共享纯函数——
  **界面与 AI 调同一套语义实现**。**引擎缺席就明说引擎缺席**。
- `src/host/session-state.ts`：会话态势推导（看板与 AI 读同一份），答案三态而非布尔。
- `src/host/http-json.ts` / `src/host/*-route.ts`：请求体读取与路由；信封本身在
  `core/http-envelope.ts`（两半共用），这一层只是 transport；纯
  `create*Handler`，服务一律 `ctx.get`。
- `src/host/board-service.ts` + `board-route.ts`：**文档真相服务（看板 + 清单，各有 revision）**；
  同名单元同时只能有一个活句柄；`openBoardUnit` 是单元打开与布局迁移的唯一入口。
- `src/host/data-root.ts`：**全插件唯一自己碰介质的地方**。新增任何直接读写数据根的代码都要先想清楚
  为什么不能经 `ctx.storage`。

### client 半区（浏览器）

- `src/client/index.ts`：inject 六服务；offline-first 挂载（副本常驻 → 接线 → 即时可用 → 后台
  收敛）；官方 seat 两处注册（`main` 面板 / `sidebar.panellist` 入口）；宿主面全经 `platform.ts`。
  **没有启用判断**（被组合即启用），生命周期挂在一个 `ctx.effect` 上。
- `route-base.ts`：**浏览器侧路由的唯一出口**（交给 `document.baseURI`）；浏览器侧任何
  `/api/...` 都必须经它。`TaskBoardPanel.tsx` / `TaskBoardIcon.tsx`：看板的两个官方 seat 组件。
  `board-transport.ts`：fetch + EventSource（缺席降轮询）。
- `src/client/item/`：**清单面板**，与看板同形状的第二个主舞台面板（**座位见宿主契约表**）。
  **骨架是「左栏 + 一列」**：方向只在左栏（`rail.tsx` 吃 `item-rail.ts` 的推导）；顶栏只有
  **搜索 · 排序 · ＋新建一条**，**筛选不在顶栏**；列表按**日**分段。几何与四条版面判据在
  `DESIGN.md`。
  **键盘是一等公民**：`keyboard.ts` 一张映射表 + 一个注册点 + disposer，`ItemKeyActions` 闭合
  ——**加一个没有处理器的键是编译错误**；**一层东西占着键盘时（菜单 / 展开的行 / 浮层），只有那一层
  自己的键与 `Esc` 活着**。`facets.ts` 是搜索框的**文本编辑器**、`selection.ts` 是纯状态机；
  `labels.ts` 的词与色**从看板那一份导入**。
  **「问 AI」是唯一通向模型的一按**（`core/item-ask.ts`）：没挂卡的行也按得动，**开始还是继续由卡自己说**。
  **「运行配置」常驻详情右栏**，按下去跑的就是屏上那一份。**一律不用 Dialog**。
  `hostLostItems()` 为真时说「读不到」，**不能画成「你一条都没有」**。副本只存在**一个** holder；
  `client/surfaces.ts` 开机读一次 `/board/surfaces`，**读不到就什么都不收窄**；名单本身在 `core/surfaces.ts`（两半都读，所以它住在 core）。
  **归档是一个抽屉、两扇门**：恢复是 host 操作而不是客户端提交（`client/items-archive.ts`）。
  **寻址键两个、各具名、互不为兜底**：界面撤销传 `id`，模型的 `item.restore` 传 `ref`。
  **恢复没回来就说没回来**。
- `src/client/chat/`：**AI 动作在对话里的呈现**（`tool.call.toolview` 座位），渲染模型的回执。
### 前端架构（**索引**：成文契约在 `DESIGN.md` 的 Design System 节，机制在代码注释里）

**四层各有归属，判据只有一条——有第二个消费者**（「看起来通用」不算）。「一处」= 一个读它 /
渲染它的文件（同目录两个文件是两处）。

| 层 | 位置 | 判据 |
| --- | --- | --- |
| 令牌 | `design/tokens.module.css` | 一个值被**两处以上**消费 |
| 形态 | `design/base.module.css` | **至少两处**消费它 |
| 组件 | `design/<X>.tsx` + `design/components.module.css` | **至少两个渲染点**；两个面板都渲染的必须在这里 |
| 页面 | `board/` `item/` `home/` `gallery/` `chat/` | 只有这一页的几何与排版 |
| 装配 | `workbench/` | 三页共用的判定：座位键、唯一持有者、栏的 props。**它不是页面** |

**层方向是门禁**：`design/` 不许 import 任何一页（只许客户端根部与 `core/`），否则「这形状归谁」
成了「哪一页渲染它」的函数。两个例外都有理由，记在同一张豁免表里。
**改 CSS 前必须知道**：类名属于**表**（按文件名哈希），跨表选择器在生产包里静默失效——所以共享形态
只能住 `design/`，**页面表里出现第二份拷贝即违规**（硬性规范 20；`verify-class-ownership.mjs`）。
**改界面前先读 `DESIGN.md` 的 Design System 节。**

清单面板的留白走 padding 不走 margin：那条 `<p>` 重置包在 `:where()` 里，**给的是零特异性**，
所以它只压得住 UA 的默认值，**类规则赢它**。

### 核心层（`src/core/` 纯逻辑）

**按域分组；每一组点名「先读哪一个」，其余同域文件在那一组里找。** 不逐个罗列：一份会
随时过期的花名册，代价是每加一个文件都要来改它，而没人会改第五处——**要列全，就由文件系统列**
（`scripts/verify-design-docs.mjs` 与各门禁扫的正是真实文件）。判定「有没有」永远读 `src/core/`。

| 域 | 先读这一个 | 这一域还有什么 |
| --- | --- | --- |
| **文档真相** | `board-doc` / `host-sync`（同步文法 + 租约） | `board-merge-core`（合并文法核，**两份文档共用一份**）· `items-doc`（墓碑带载荷）· `board-events` · `projections` |
| **台账与调度** | `controller`（台账 + 调度 + 席位 + 外源双通道） | `automation` · `schedule`/`scheduler` · `cruise` · `presets`/`run-presets` · `flow-metrics` |
| **看板语义** | `task-transitions`（语义层） | `tasks` · `task-demand`（要决的门）· `task-live` · `task-search` · `task-templates` · `linked-sessions` |
| **清单语义** | `item-transitions`（与界面同一批纯函数） | `item`（一行的模型）· **`item-view`（全部推导的门面，按域拆十个模块，re-export 全部有人读的符号）——界面与模型读同一份** · 其余 `item-*` 按名字就是在那一域里做事的 |
| **会话与执行** | `execution`（投递结算） | `session-list`/`session-display`/`session-groups`/`session-lineage`/`session-agents`/`session-activity` · `question-rpc`/`question-mirror` · `goal-verbs` |
| **动作与出口** | `board-actions`（动作目录，见硬性规范 12） | `client-report` · `update-check`/`update-view` · `workbench-summary` · `item-ask` |
| **共用的地基** | `values`（`stringOf`/`messageOf`/`isRecord` 三个收敛后的家） | `http-envelope`（**两个半区共用的信封**）· `surfaces`（面板名单）· `local-day` · `attachment` · `colors` · `store` |

`comment-thread`、`quote-text`、`quote-anchor` 也不在 core（同住 `src/client/board/`）。
- **清单的补丁类型是从裁定表派生的，而派生会静默塌掉**：`ItemPatch` 的键集由 `ITEM_FIELDS` 的
  `access` 列**推导**（`WritableItemKey`）。所以那行 `@ts-expect-error` 棘轮是**承重的**
  （退化从此是**构建失败**），同族第二实例在 `item-sort.ts` 的 `KEY_GAPS`。
  **手写的「我列全了吗」永远该由类型或文件系统回答**。
- **要决的门**在 `task-demand.ts`：三个子句一条推导，卡片芯片 / 板顶诉求行 / 通知抽屉**三处同读**。
- **轮次集合只有两份**（`session-display.ts` / `execution.ts`）：**会话**与**执行复核线程**各答一件事。
- **落位**（`tasks.ts`）：换栏与「会话开始或结束工作」都把对象顶到目标列**最上方**，唯一落点是
  `controller.land`/`landMany`。
- **唯一推导**：`task-live` + `linked-sessions`。

### 关键不变量（改前先读对应文件；这里只记边界，细节在代码）

- **多端同步**：真相 = host `BoardDoc`；浏览器乐观写 + 去抖提交 + `applyRemote` 永不回写；单引擎泵
  （租约；席位任一半变即通知）。
- **运行态唯一推导**：`live` 腿读**会话活跃度**（`own ∨ descendant`），不是裸 `running`；结算的列门
  读同一条腿（轮的期限不因后代延长）；卡片黄边与呼吸同源。
- **统一会话与评论单轨**：同会话同一线程；排队/插话两态只由用户开关定；附件一律是官方附件库里的
  ref（`ctx.attachments`，字节不进文档、禁自建桥），发送那一刻才物化。
- **附件即内容**：判空只有一处 `isBlankMessage`（文字空且无图无文件才算空）——只发图不发字是真消息，
  任何发送路径都不得拒它。**ref 整份走**：只许 `omit` 掉本插件两代老形状（`data`/`receiptId`），
  **逐项列举字段就是漏字段**（手抄表丢掉官方 ref 的字段，于是每张图必坏）。
- **归档是「可恢复的隐藏」，不是删除**：只从 `ctx.workspaces.list` 快照派生 + 订阅，**任何界面不得
  缓存归档结论、不得写进台账**。规则不向归档会话投递但**保留 due 槽**；`sessionAvailability()` 是
  「不可用」的唯一判据。
- **执行门禁**：`taskExecutable` 唯一判定；`ruleReadiness` 次序 disabled→blocked→paused→active；
  评论与插话永不封；`runTask` 单点拦截。空标题/描述从 Prompt 补（永不覆盖）。
- **卡片是 view-model 的投影，不是第二个判断者**：`cardViewModelOf.primary` 就是那颗主芯片，
  「下一句话」行读同一个 `primary`，所以一张卡不可能在相邻两行说两件事。
- **`hasOpenRun` 是「进行中」这唯一的谓词名**——第二个名字只会让人以为有「显示/门禁」之分。
- **当前值与历史值必须分开读**（权限那类 bug 的根）：历史页捎带的 projections 是「这个会话当时
  做过什么」，**描述会话「现在是什么设置」的一律走活投影读**——`/permission` 不开新一轮对话，
  历史页里那份拷贝永远不刷新。**宿主把两件事分开存**：`permissions` 投影线上**只有
  `{ currentValue: string }`**，候选项来自**另一个** `permissionPresets` 目录——索要一个
  `options` 数组就把好好的值判成「读不到」。**活值读不到就说读不到**，绝不拿「默认」顶替；
  目录里没有的当前值**照原样显示**。
- **借用必持有**：宿主只在**有人持有**某个会话代次时才借出驱动。所以**拥有**一段工作的一次运行、
  一次续跑、一次新建会话配置，一律经 `execution.sessions.hold` 借到**结算为止**；`binding` 只留给
  不得比持有者活得久的读。借不到就诚实失败：开不了会话按 `configError` 带着宿主给的原因上报。
- **自动化不许有「上着却跑不起来」的规则**（死臂）：任务级排期与**会话规则**同一条律，读侧
  （`ruleReadiness` / `sessionRuleReadiness` 报 blocked）与写侧（`setSchedule` 拒绝上臂、
  `controller.deadArmedRule` 三条会话写入路径共用）缺一不可。**送达闸门同理唯一**：
  `controller.ruleDeliverable` 由 cron 心跳、`fireOnCompleteRules`、`fireLoopRule` 三条路径共用。
  跳过/暂停的档期一律**前滚到下一个匹配**，且**不盖 `lastAt`**——那个戳记的是「真的发出去过」。
- **车道 = 会话**：`isOpenRound` 唯一判定；预算数轮；卡片离进行中唯一判定 `leaveRunningTargetOf`
  （open/live/schedule 三腿），不另起特判。
- **交互卡**：只订阅 `uiSession.sessionStatus`；carrier 带 `answer`/`dismiss`（官方那两个动作名）
  时才就地作答，身份不符即拒、失败留卡报错——**能不能就地答按会话判**；数据型的降级跳回原生；
  **board 永不注册 waterfall**。
- **自动化与巡航**：任务 `schedule` 与会话 `rules` 正交；on-complete 永续（`done` 硬停）；每会话至多
  一条规则；巡航 `enabled` 主权。
- **草稿**：`drafts.ts` 设备本地；未提交回来、提交清槽；评论 v1 信封（键表见该文件）。
- **稳定性**：受控回退；就近 inline 反馈；订阅必带终止。

## 新增与复用（要加东西之前先读这一节）

**这一节只回答一个问题：你要加的那个东西，已经存在吗？** 答案不是「看起来像」，是**它住在哪个
文件**。一次全项目普查找出 **55 处同一段逻辑被抄成多份**，没一处会报错。

### 一、顺序是硬的

**复用 → 扩展 → 新增**，每一步都要说得出**为什么上一步不行**。允许「新增」的触发只有两个：

- 用户明确要求一个新东西——此时「像已有的」不是理由，需求本身是；
- 确实没有可用的——**说得出「最近的那个是什么、为什么它不行」**。

「这个场景特殊」「以后可能用得上」「先这样，以后再抽」**都不是触发**。最后一个尤其贵：两份已经
分家，而下一个人看到的是两个长得一样的东西。

### 二、新增的东西先落共享层

**先落共享层，再在需要的地方调用**——哪怕它现在只有一处消费者。

| 加什么 | 落哪 | 为什么是那儿 |
| --- | --- | --- |
| 一个形状（一段共用的几何 / 底色 / 影） | `src/client/design/base.module.css` | 跨页面共享的形态只能住这一层 |
| 一个组件（一块可渲染的东西） | `src/client/design/<X>.tsx` + `design/components.module.css` | 两个面板都渲染的必须在这里 |
| 一个值（颜色 / 间距 / 圆角 / 档位） | `src/client/design/tokens.module.css` | 令牌层是值的唯一家 |
| 一段纯逻辑 | `src/core/` | 界面与模型读同一份 |
| 一个词 | `src/client/locales.ts` | 词表只有一份，zh 与 en 同时改 |
| 一条动作 | `src/core/board-actions.ts` | 动作目录是界面与模型之间唯一的同步面 |

**不在页面表就地写一份。**「等第二个消费者出现再搬」不算办法——到那时两份已经分家，
而其中一份永远不会被想起来。

### 三、唯一实现

同一件事在项目里只能有**一处实现**，其余全部 import。三档分别这么判：

- **值**：一个枚举、一张对照表、一个颜色——只有一处定义。抄一份的代价不是那几行，
  是**改一处不报错**。
- **形态**：同一段声明在两个文件里各写一遍 = 违规。第二个家必须在**同一张表**里
  （`verify-class-ownership.mjs` 拦跨表类名，`verify-design-docs.mjs` 拦同体声明）。
- **重复实现**：一个容器里两份以上就收敛成一份，**哪怕只有一处用**。

**这一节由三道门禁守着**（都读结构，不读字样）：

| 门禁 | 守什么 |
| --- | --- |
| `scripts/verify-one-implementation.mjs` | **一个名字只能有一个家**：同名同体是拷贝，同名异体是两个家（跨半区的会单独标出来） |
| `scripts/verify-client-host-boundary.mjs` | **两个半区不许互相伸手**：client 打进浏览器、host 打进 Node，两边都要用的就住 `core/` |
| `scripts/verify-dead-export.mjs` | **没人用的东西不许留着**：没人读的导出是死代码，它会骗人（紧挨 `@ts-expect-error` 的棘轮不算） |

**依赖单向**：`design/` 不许 import 任何一页（只许客户端根部与 `core/`）。**令牌上移是同一个
道理**：共享层读页面表声明的变量，今天靠 DOM 继承侥幸活着，换一个消费者就读不到，于是**整条声明
静默丢弃**（`padding-inline` 在计算值阶段失效，内衬变 0，屏上没有任何报错）。

**同一门文法也是一个家。** `#12` 指一张卡、`#要做` 是搜索限定词——两门文法各有一个家
（`scripts/verify-address-grammar.mjs` 守着）。地址文法曾经被抄了十份，其中六份少一个
`.trim()`，于是 `# 12` 在一个动作里找得到、在另一个动作里找不到，**而没有一条测试会红**。

### 四、留痕：新增登记

**新增一个共享单元要留一条记录**（`src/client/design/addition-records.ts`，四个字段）：

| 字段 | 写什么 |
| --- | --- |
| 单元 | 加了什么 |
| 最接近的既有 | 现有最像它的那一个（**必须真的存在**） |
| 为什么不能用 | 说不出就是没查过 |
| 谁要求新增 | 用户明确要求 / 门禁发现 / 机械拆出来的 |

后两个空着即红。**理由写在实现之前**——实现之后补的理由都是借口。

### 五、新增一条法则或门禁

**几何判据要量，而量法要留档。** 对齐、居中这类事**jsdom 给不出答案**（没有布局），所以它们由
`shot-panel.mjs` 开真 Chromium 量（`pnpm run audit` **先造工件再量那一批**；没有浏览器时它**明说
SKIP**，不假装量过）。**被审的页集由 `scripts/audit-pages.mjs` 一处定义**。**每一个这样的数都写进
`DESIGN.md` 并写清量法**。
**混排行只用 `center` + 每段 `line-height: 1em`**，`baseline` 留给纯文字行；记号上单独的
`translateY` 补偿必须一起删。**装字的定高盒子让行盒高 = 墨高**（`line-height:
var(--dsh-tb-text-line-h)`）**并用 `align-items: center` 居中，不许用块向内衬去补墨位**——那个
补法在结构上无效，还会裁掉字、并让那个变量**被继承**。判据读结构、不读数值与类名，
`verify-capsule-centring.mjs` 守着（`--probe-blindspots`）；**压滚动内容的头自带不透明底**
（`verify-pinned-surface.mjs`）。法则在 `design/laws.ts`，`verify-design-sync` 双向对账：
加法则给门禁与标本，**门禁也必须进表**；**「文件里有、但 `verify` 没调用」也算红**
（`--probe-orphan-gate`）。**自测开关一律经 `scripts/probe-args.mjs` 读**：拼错的
`--probe-*` 必须报错退出，不能静默变成一次正常跑。

**新增一条门禁**（`scripts/verify-<名>.mjs`）时：`scripts/run-gates.mjs` 会**自动发现**它，
不必登记；但它**必须进法则表**（`design/laws.ts`，守视觉的）或**进 `NON_VISUAL`**
（`scripts/verify-design-sync.mjs` 里那唯一一份手写白名单，守逻辑的）——漏了报 `unlisted`。
**证明它会红只能在 `tests/` 里种**（硬性规范 16）：在真实文件里改一下再改回来，证的是
「改动生效」而不是「门禁会红」。

### 六、每条可判定的规则都指得出门禁

**指不出的，要么补门禁，要么把那条删掉**——没有门禁守着的规则是**假线索**：它让人以为这件事有人管。
一条规则的责任是「它红了就有人得动手」，不是「它写得很对」。

关系是双向的：规则指门禁，门禁进法则表，而两者由 `verify-design-sync` 双向对账。**新增一个门禁
而没有把它列进某张表，得到的不是「多一道保险」，是一道没人认领的红。**

## 构建与验证（改完必跑，全绿才算完成）

```sh
pnpm install     # 依赖变化后
pnpm build       # clean-lib + tsc + tsdown → lib/index.js + lib/client.js
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm verify      # 静态门禁 + 客户端 bundle 冒烟
pnpm smoke       # 只跑客户端 bundle 冒烟：真的执行一遍加载器 handshake
```

**门禁不用记着跑哪一个**：`run-gates.mjs` 发现磁盘上每一个 `scripts/verify-*.mjs` 并逐个跑，
所以**新写一个门禁就自动生效，不必登记**。CI 每次 push 跑与本地同一套命令。

打包器写的是**带内容哈希**的 chunk 名，内容一变就多一个新文件、旧的从不删，所以 `build` 先经
`scripts/clean-lib.mjs` **清空 `lib/`**（该目录下每个文件都由 `pnpm build` 产生，没有手写文件）。

**看渲染结果**用 `node scripts/shot-panel.mjs`（**不进包**）。

### 闭环验证与操作规范

**改完必看**（通则见行事总纲）：门禁全绿只证明规则没被破坏。界面改动 = 两档截图亲眼看过；
行为改动 = 真实交互走一遍，并在 `tests/` 里留下 spec。**触屏那一档要真的渲染出来**：
`pnpm run audit` 跑两档宽 × 三档 DPR × 两种指针能力 + 一档换字体——**窄宽不等于触屏**。
量法见硬性规范 19；工具名与用法**现场读 `package.json` 的 scripts 与 `scripts/`**。

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
7. **独立自包含**：**运行时没有依赖**（`dependencies` 为空，host 只 import 类型）；不依赖兄弟插件；
   界面只经官方 seat（自打属性见契约表两条纪律）。
8. **不引入新依赖**：新增依赖需先说明理由并经确认。确认渠道按角色走（见「先确认角色」）：
   维护者在本会话里确认；贡献者先在 Issue 里讨论，再提 PR。
9. **从机制上解决问题**：遇到新情况先按「行事总纲」的意图与边界推理，而不是等待
   规则增补或把特殊处理写死进代码；当真实的新场景反复出现时，按「本文件的定位与
   编辑规则」更新本文，而不是增加一次性补丁条款。
10. **非 ASCII 内容一律不经 shell 传递**：中文写进文件、拼进命令行、或由 shell 拼进请求体，都可能被
    **静默改写**——共性是**不报错**。**做法**：用文件工具写内容，确需脚本时让它按字节处理并**回读
    比对**。三种已确认的形态——**U+FFFD**、**UTF-8 BOM**、**CRLF**——**不改任何逻辑，所以没有一条功能
    测试会红**，这正是它们必须由 `verify-standalone.mjs` 的 encoding 审计抓的原因（自测
    `--probe-encoding`）。
11. **双端同治（移动端不是二等公民，而是同一等）**：任何 UI、交互、文案、动效改动，**必须同时给出
    桌面与窄屏两档的结论**，且只能用「换行 / 换列 / 让位 / 短名 / 折叠 / 提高地板」表达——**禁止靠
    藏掉标签、缩小字号来"省地方"**，禁止为窄屏另写一套组件或交互副路径。只在一档验证过的改动视为
    **未完成**。三条硬底线：① 装不下时让位而非压扁（裸 `1fr` 轨道、无地板的 `flex:1 1 0` 都不算
    做完）；② 文字永不画在盒外；③ 触屏没有 hover——承载必要信息的说明不能只挂 `title=`。
12. **动作目录是界面与模型之间唯一的同步面，改界面必须同时改它**：
    `src/core/board-actions.ts` 是动作目录（一条表，四个表面读它：工具 schema、能力查询、
    指令规则、覆盖门禁）。**改界面的任何一处之前先问「目录里有同名同参的动作吗」**：两个方向
    各有各的门禁（字段方向编译期、界面方向静态扫描），缺一不可，**门禁红了就改实现，别改门禁**。
    读投影与视图开关不是动作，进 `INTERNAL` 时**必须写清理由**——没有理由的豁免与漏掉一个没有
    区别；`DEBT: ` 开头的理由是如实记下的欠账。**说清不等于说得进去**：一句写在散文里的默认值，
    门禁读不到；`ParamSpec.default` 里的同一个默认值，门禁与渲染器都读得到。**任何要跨表面同步的
    判定，都必须落在字段上**。机制细节见 `scripts/verify-action-coverage.mjs` 的头注释。
13. **共享接线的参数签名就是接口，改它等于改别人的文件。** 模块之间靠参数传递的形状是**接口**，
    调用方是别人：把两个参数改成一个，不会让调用方「顺带更新」，只会让它在自己的时刻坏掉。
    **要改签名，先把所有调用点找出来**；改不动就加一个新入口、把旧的留着。
14. **一个不看上下文的检查器，会逼着人改对的东西来迁就它。** 判据只许读**结构**，不许读
    字样：注释里出现「令牌」两个字不是一次令牌使用，所以扫描**先剥注释再匹配**。
    遇到一条让实现变得不如以前的检查，先怀疑检查的读法，别先怀疑实现。
15. **「我没查过」和「我查过」在报告里长得一模一样。** 报告里写过「核了 X、核了 Y」，就意味着没核的
    那几处不会有人替你核——而它们常常正是地基。**核过的逐条列出来，没核的明说没核**。
16. **证明门禁会红，只能在 `tests/` 里种。** 在真实文件里改一下再改回来，证的是**改动生效**
    而非**门禁会红**。根因是**两个写者共用一个工作区而互不知情**，所以共享工作区里
    **`git add -A` 与「在 `src/` 上做临时改动」互相回避**；要种就种在 `tests/` 里。
17. **一个概念只有一套词汇，别的地方导入，不抄。** 值的枚举、词的对照表、颜色、形状——凡是有
    「同一件事在两处出现」的地方，只有一处是定义处，其余全部 import。抄一份的代价不是那几行，
    是**改一处不报错**：读者要「两处颜色一致」时，其中一处不会跟着变，而屏上不会有人说一句话。
    判据是结构性的：清单的状态、状态词与颜色都**导入**看板那一份（`ITEM_STATUS_VIEWS` /
    `STATUS_KEY` / `--dsh-tb-status-*`），所以加一栏、改一个词、换一个颜色都只动看板那一处，
    清单这边由类型与门禁跟着变。**颜色**：色相只经 `--dsh-tb-*`，洗底深浅只读梯子
    （`--dsh-tb-wash*` / `--dsh-tb-edge`）——本层已命名的宿主令牌，调用点再直读就是同一个色的
    第二条路。机械拦：`verify-palette.mjs`。
18. **删一个词、一档状态、一个组件，是那次改名的一部分，不是下一件事。** 同一个改动里要一起清干净：
    孤儿 locale 键、没人读的 CSS 类、变成死代码的函数、只给死代码写的测试、以及**已经不再如实模拟真相的
    fixture**。留着它们的代价不是难看，是**下一个人会以为它们还被需要**——而「一个看起来很权威的假
    线索」比缺一行注释贵得多。判据：`pnpm verify` 的孤儿键与类漂移审计必须是 0。
19. **几何判据要量，而量法要留档。** 正文在「新增与复用」第五节（量法、法则表三联、门禁进表、
    自测开关经 `scripts/probe-args.mjs`）——**那里是唯一一份**，此处不重复，只留这一句索引。
20. **开发页面先复用，再扩展，最后才新增。** 正文在「新增与复用」第一至三节（顺序、新增落哪一层、
    唯一实现三档）——**那里是唯一一份**，此处不重复；机械拦是 `verify-class-ownership.mjs`、
    `verify-design-docs.mjs`，以及「一个家」那三道（`verify-one-implementation.mjs`、
    `verify-client-host-boundary.mjs`、`verify-dead-export.mjs`）。
21. **折叠记号与层叠各只有一张表。** 折叠旋转只认祖先的 `aria-expanded`（共享类 `.foldMark`）；
    `z-index` 只许读 `--dsh-tb-layer-*` 五档。正文在 `DESIGN.md` 的「两条跨页机制」，
    机械拦是 `verify-fold-mark.mjs` 与 `verify-stacking.mjs`。

## 测试（布局约定）

- **一个 src 模块一个 spec，契约按表面/域分组**，清单以 `tests/` 目录为准。**新增逻辑即配测试**
  ——测试是契约不是附件；先归入对应域的现有 spec。
- **非显然的分工**（细节在各 spec 里）：`host-sync`/`board-doc` 是同步文法与租约状态机；
  `board-service` 带 **LeaseState 唯一构造点**的机械禁令；`board-http` 用真实存储 + 真实 SSE；
  `controller` 是唯一大文件；**看板**的 CSS 布局契约在 `card-contract` / `mobile-contract` /
  `review-page`，**清单**的全在 `panel-render.spec.ts` 与 `locales.spec.ts`；`item-board-linkage`
  钉**两个面板之间**的一致性。看渲染结果：`DSH_PANEL_HTML=<path> pnpm test` 出页面，
  再 `node scripts/shot-panel.mjs` 截图。
- **`execution.spec.ts` 的假环境必须如实模拟宿主的持有语义**：`binding` 只对**被持有**的会话返回
  驱动（`hold` 才是入口）。一个从 Map 里直接发驱动的假面会让整份 suite 在线上全线失败时依然全绿
  ——**假面比现实宽容或比现实窄同样危险**。
- **`task-demand.spec.ts` 钉的是「三处同读一个门」**：每条用例钉的都是一对必须说同一句话的表面；
  **任何把它退回单条车道的改动都必须让这里变红**。`session-permission.spec.ts` 同理钉住「权限只读活
  投影、无本地副本、选择器无取消项」。
