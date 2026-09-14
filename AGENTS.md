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

**本文件的地位**：随仓库走，是**项目的契约**，不是某一个人的私有笔记。它描述「这个项目
是什么、要求什么」，而不是「谁在维护它」。这条区分决定了本文能写什么：

| 能写（对任何接手者都成立） | 不能写（随人而变） |
| --- | --- |
| 机制、架构、不变量、硬性规范 | 某个账号的用户名、邮箱、npm 作用域 |
| 构建/测试/发布**该做什么、按什么顺序** | 推送目标、发布目标这些**取值** |
| 为什么这样要求（意图与边界） | 一次性的版本号、日期、某人当时的决定 |

**操作者取值一律现场取**，正文里凡是需要具体值的地方（仓库地址、包名、远端、署名），
都从仓库自身读：`package.json` 的 `name` / `repository.url`、`git remote -v`、
`git config user.name`、`npm whoami`。**仓库是这些事实的唯一权威来源**——换人、换
remote、换 npm 作用域时，改这些真实配置即可，本文不需要跟着改，也不会失准。

**这条只管本文，不管给人看的文档**。README 与 CONTRIBUTING 面向的使用者和贡献者，
要能直接复制粘贴，因此**必须写具体地址与命令**；易主时跟着改一次即可（改动集中在
安装命令与 Issue 链接几处）。区分标准是**读者是谁**：读者是 AI（需要推理、会读仓库）
就现场取值，读者是人（需要照做）就给现成命令。

**别人 fork 之后怎么办**：直接沿用即可。本文的机制与规范描述的是这个项目的做法，对
任何接手者同样成立；而所有"取值"都是现场读的，会自动指向他自己的仓库与账号。他若想改
工作方式（例如换分支模型、换 CI），按下面的编辑规则改本文即可——这正是本文"是活的"
的含义。**因此本文放在仓库里的意义不只是备份**：它是接手者（以及接手者的 AI）理解这个
项目的最短路径；哪天仓库只剩本文和代码，也不会有"只有原作者才知道"的隐性约定。

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

**产品与视觉文档**：除 README 外还有两份**同时给人看与给 AI 看**的文档——`PRODUCT.md`
（产品真相：用户、目标、定位、绑定约束、原则）与 `DESIGN.md`（视觉系统：令牌、排版、
布局、组件契约、Do/Don't）。分工是：

| 文档 | 回答什么 | 权威来源 |
| --- | --- | --- |
| `README.md` / `.en.md` | 怎么装、怎么用、坏了怎么办 | 随包发出，面向使用者与贡献者 |
| `PRODUCT.md` | 为谁做、做到什么算成功、哪些约束不许破 | 用户确认的产品事实 |
| `DESIGN.md` | 长什么样、为什么这样长、新界面怎么不跑偏 | **代码**（它记录现状，代码是规范源） |
| `docs/`、`AGENTS.md` | 给 AI 与接手者的说明 | 随人随事，不进包 |

**冲突时以代码为准**：`DESIGN.md` 是**对现状的记录**，不发明新世界。改动使它与代码不符
时，改 `DESIGN.md` 去对齐代码，而不是让代码迁就文档。`PRODUCT.md` 相反——它是产品真相，
代码若与它矛盾，是代码该改。

**这两份文档不触发版本号变更**：它们不在 `package.json` 的 `files` 清单里，**不随包
发出**，按 bump 的判据（使用者会不会看到）不 bump；改完只提交，不抬号。README 相反，
它随包发出，改一个字都要 bump。

**本文件不复制它们的内容**：本节只记**它们存在、谁是权威、何时同步**；事实本身住在各自
文件里。本文件是索引，不是副本——把内容抄进来，等于制造两份会漂移的真相。

**这两份文档用中文写**（与本文一致）：它们的第一读者是接手者与 AI，不是终端用户，
因此不需要英文版，也不随 npm 页面发布。

**双语说明要成对维护**：`README.md` 与 `README.en.md` 是**同一份文档的两个语言版本**，
不是两份文档，因此：

- **两份都随包发出、都展示在 npm 页面上**，改任何一份都算用户可见变化，都要 bump 版本号。
- **漂移是这类文档的主要失效方式**——一次改动只更新了一份，两份说着不同的事，而读者
  不知道自己看的那份是不是最新的。**所以改一份时必须打开另一份一起看。**
- **中文版是权威**，英文版是它的翻译；两者不一致时以中文版为准，并同步英文版。
- **不要机械对译**：中英文读者关心的问题不同（安装来源、可用平台、常见报错都可能不一样），
  逐句翻译会产出一份读起来像翻译腔、又没回答本地读者问题的文档。
- **改完要能回答一句话**：「另一份同步了吗？」——同步了就说改了哪几处；没同步就说清
  为什么（例如那条内容只对其中一种语言的读者有意义）。**答不上来，就是漏了。**

**派生内容用工具同步，不手工维护**：两份 README 各有一个**目录**，它完全由各节标题
决定，因此不手写。用 `scripts/sync-toc.mjs` 生成，插在成对标记之间——

```sh
pnpm toc    # 改完 README 结构后重跑，目录即与标题同步
```

**增删或改名任何二级标题之后必须跑一次**，否则 `pnpm verify` 会红（它内含 `--check`，
因此发版前也拦得住）。不要手工编辑标记之间的内容——下次生成会覆盖它。

锚点由工具按 GitHub 的算法算（中文原样保留、标点去掉、空格变连字符）。手工抄最容易
出错的两种：**带序号的标题**（`## 1. 安装` 的锚点是 `#1-安装`，中间那个点会消失）、
**带 emoji 的标题**（emoji 不进锚点）。写错的表现是「点了没反应」，不报错，所以交给工具。

**徽章**同理属于派生内容（由外部服务决定），但**不进自动检查**：它依赖网络，放进去会因
对方抖动而误报。规则是**写之前先验一遍能显示再写**。已确认：本仓库是私有的，
**GitHub 系列徽章（星标、许可、发布）全部显示不出来**，所以只用静态徽章与 npm 版本徽章。

`scripts/sync-toc.mjs` 由 `project-forge` skill 提供，为保持本项目**独立自包含**
（硬性规范 7）而在此留一份副本。升级该工具时以 skill 里的那一份为准，覆盖过来即可。

## 环境与上下文（以实际环境为准，不依赖固定值）

- 宿主：DeepSeek Harness (DSH) Web GUI，运行在用户本机。DSH 的一切皆插件；本插件以
  cordis 插件形态存在。平台与用户名不写死：需要时用命令发现（`process.platform`、
  `os.homedir()`），不要假设具体值。
- 项目根：本文件所在目录。DSH 数据根：`$DSH_HOME` 优先，否则主目录下 `.dsh`
  （由 `os.homedir()` 推导）。激活 profile：`profiles` 下的目录（以实际目录为准）。
  本插件的挂载方式**按角色不同**（见「先确认角色」）：维护者用 `link:<本目录>` 长期挂载；
  贡献者用 `dsh plugin --profile web add .` 把当前 checkout 挂进自己的 profile 调试即可，
  提交 PR 不需要改动任何人的挂载。
- `~/.dsh/cordis.patch.yml`：合法状态 = 不存在，或顶层 YAML 数组（存在但为空会令
  dsh 启动失败）；`~/.dsh/settings.yaml` 承载插件设置命名空间。
- 兄弟插件：本目录所在 `Plugins` 目录下的平级独立插件（用目录扫描发现）；与本项目
  完全独立、互不依赖、互不引用。
- 生效规则：host 半区改动需重启 `dsh web`；client 半区改动刷新页面即可。

## 版本管理与发布（必守）

本项目是「本地仓库 + 远端 `origin` + npm 包」三处结构。**维护者只描述需求，git 与发布
操作由 agent 代为执行**，不必重复交代流程。三处互不自动同步，各自由下面的动作推进。

### 先确认角色（涉及推送/发布前先做一次）

同一份本文，两种人会读：**维护者**（仓库与 npm 包都归他）与**贡献者**（clone 或 fork
别人的仓库来改）。两者能做的动作不同——**推 main、打 tag、发布这三件事只属于维护者**。
判断不靠问，靠仓库自身的事实（沿用本文「取值现场取」的同一套原则）：

| 检查 | 维护者 | 贡献者 |
| --- | --- | --- |
| `npm whoami` 与 `package.json` name 的作用域段（`@<scope>/…`） | 一致 → 他是这个包的发布者 | 不一致或未登录 → 发不了 |
| `git remote get-url origin` 与 `package.json` 的 `repository.url` | 指向正本仓库 → 有写权限 | 指向自己的 fork，或没有 origin → 推不进正本 |

**两项都过 = 维护者**，走本文全部流程，含 tag 与发布。
**任一不过 = 贡献者**：开发、构建、测试、改文档一律照本文做，但**到此为止**——把改动推到
自己的分支并开 PR，**不要** tag、不要建 Release、不要 `npm publish`（没有权限，且会搅乱
正本的版本号）。PR 里的 CI 只跑检查不跑发布（钥匙只在正本仓库的 tag 事件里有，fork 的请求
天然拿不到——既不泄密，也不会被卡住）。贡献者的清单见 `CONTRIBUTING.md`。
**判断不了时按贡献者走**：这是更安全的一次错误，代价只是少做一步发布。

### 三种触发与对应动作

**日常（默认，用户描述需求即触发）**——一次改到远端，不打标签：

1. `git status` 确认工作区；有未提交改动先存一个「改前存档点」。
2. 改代码。
3. `pnpm typecheck` + `pnpm test`。
4. 用户可见改动（行为/UI/文案/修复）→ bump `package.json` patch，**只抬号不打标签**，
   攒到发版里程碑再一次推出去（标签是里程碑，不是提交的附庸）。
   **判断标准是「使用者会不会看到」**，不是「改的是代码还是字」：

   | 要 bump | 不 bump |
   | --- | --- |
   | 行为、界面、交互、报错文案 | 重构、测试、构建脚本 |
   | **随包发出的说明**（README、README.en.md——npm 页面上展示的就是它，装完后也在包内） | **不进包的内部文档**（AGENTS.md、CONTRIBUTING.md） |

   最容易判错的是最下面一行：同样叫「文档」，README 是**产品表面**（使用者按它判断
   能不能用、怎么装），改名一个字都算用户可见；AGENTS.md 只是给 AI 的契约，改了不影响
   使用者。前者不 bump 就会出现「仓库里的说明已经改了，npm 上还是旧的」——已发生过。
5. `pnpm build`（**版号在 build 时进包**，顺序不能颠倒）。
6. `pnpm verify`。
7. `git add -A && git commit`——提交信息简短说明本次改动（中文或英文均可，禁止 emoji）。
   **`lib/` 与产生它的 src 改动必须同一次提交**。
8. `git push origin main`。

**发版（只有用户明确说「发版 / 发出去」才触发）**——在上面的基础上追加：

9. `git tag v<版本>` + `git push origin v<版本>`。
10. 建 GitHub Release，正文写**人话更新说明**（用户看的是这个；市场的新版说明优先读
    Release，其次提交记录，最后 npm 发布时间。仓库里不放 CHANGELOG.md）。
    **推 tag 即由 CI 自动建**（`release.yml` 从提交记录起草中文说明，已存在则跳过）。
    `scripts/github-release.mjs` 只作补漏路径（tag 推得比 job 早、或 job 失败时手动跑：
    `GITHUB_TOKEN=<pat> node scripts/github-release.mjs <tag> <notes文件> --repo owner/name`）。
    规则是**非 ASCII 正文不经 shell 传递**：写进
    UTF-8 文件，由脚本按字节发送。理由与平台无关——shell 的引用与编码规则各不相同（同一条
    命令在不同系统上行为不同），凡把中文拼进命令行或由 shell 拼请求体，都可能被静默改写；
    而这类损坏的共性是**API 仍返回 2xx**，只有打开页面才看得出。脚本另在写入后回读比对，
    不一致即报错。要发英文说明也用同一入口，理由相同：少一条需要分平台验证的路径。
11. `npm publish --access public`（需要 npm 账号的 2FA 验证码，见下）。

**停手（用户说「先别提交 / 只看效果」）**——只做到第 6 步，不 commit、不 push。
这条对两种角色都成立（贡献者本来也只做到这里）。

**贡献者版闭环**：第 1–6 步完全相同（含 bump——PR 里带上版本号是一致的做法，接不接受
由维护者定），第 7–8 步改为**推自己的分支并开 PR**，不落后面的 tag 与发布。

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
- **本文件不绑定具体账号**：仓库与包可能易主、复用或由他人接手，因此本文只写"怎么查"，
  不写死 GitHub 用户名、npm 作用域或邮箱。需要具体值时现场读 `package.json` 的
  `name` / `repository.url`（它们是这些身份的唯一权威来源），或 `git config user.name`、
  `npm whoami`。下面的步骤里凡是出现账号名的地方，都按这个方式取。
- 提交身份：`user.name` 用仓库所有者的常用署名，`user.email` 用 GitHub 的 noreply 地址
  （形如 `<id>+<login>@users.noreply.github.com`，从 `package.json` 的仓库地址或
  `git config` 现场确认，不写死具体值，避免暴露私人邮箱）。
- 发布前必查：`pnpm verify`（含产物不得出现本机路径、不得出现凭据、无 emoji 三项审计）；
  `npm pack` 产物装进隔离 profile 能真实加载，不用 `link:` 代替。
- **发布方式优先可信发布（OIDC）**：仓库已带 `.github/workflows/release.yml`，推 tag 即
  自动构建、测试并发布，无需人工验证码。前提是该包在 npm 网站上配置了对应的
  Trusted Publisher（组织/用户名、仓库名、工作流文件名 `release.yml`、允许 `npm publish`）。
  未配置时工作流会在 Publish 步骤失败（npm 返回 404 ── 权限不足时它不区分"无权"与"不存在"），
  此时退回手动发布：`npm publish --access public`，需要账号 2FA 的一次性验证码，
  **由账号持有人在自己终端执行**（agent 准备好一切并给出确切命令）。
  **Publish 红了先看日志是不是 404 类错**——是则先对 Trusted Publisher 三项（以 `release.yml`
  头注释为准），不要先怀疑代码。
- 不提交：`node_modules/`；**`lib/` 必须提交**（安装时不执行构建，缺了别人起不来）。

### 依赖版本同步（硬性，不必每次交代）

SDK 版本**必须跟随实际运行的 DSH**──不写死、不靠宽松范围蒙过去，每次都在现场查。
本节只写**规律与查法**，不写具体版本号（版本号会过期，写进来就是下一个坑）。

两条必须知道的规律：

- **SDK 与 DSH 本体同号**：`@deepseek-ai/dsh-*` 的版本号与正在运行的 DSH 一致；
  `@deepseek-ai/cordis` 走自己的一条线，不与本体同号。**个别包会停更**（不再跟随本体
  出号），所以每个包都要单独确认目标版本确实存在，不能假定"同号"普遍成立。
- **npm 的 `latest` dist-tag 不可信**：这些包的 `latest` 可能停在很旧的版本，而实际
  已发布更新的版本。因此**不得用 `npm view <pkg> version` 判断最新**（它读的就是
  `latest`）。一律用 `npm view <pkg> versions --json` 取完整列表，从末尾找目标版本。

同步动作（发现或执行 DSH 升级后主动做，不必等要求）：

1. 读**实际运行的** DSH 版本，作为目标版本：
   `node -p "require('<dsh 安装目录>/package.json').version"`（安装目录用
   `require.resolve` 或 `npm root -g` 现场求，不要写死）。
2. 逐个包确认该版本存在（见上「规律」），再写进 `package.json` 的 `devDependencies`
   （**只动这里**）。**不要顺手改 `peerDependencies` 与 README 的下限**——那是另一个
   概念，规则见下节。
3. `pnpm install` —— pnpm 会自动把新版本补进 `pnpm-workspace.yaml` 的
   `minimumReleaseAgeExclude`（新版本未过发布冷静期，不加会被拦）。
4. **迁移破坏性变更**：同步后 `pnpm typecheck` + `pnpm test` 必须全绿。跨版本升级
   常伴随 API 改名/移除，类型报错就是信号──按新契约改写，不要用 `any` 绕过。
   `pnpm test` 里若有官方文法镜像的 spec，其期望值也要同步（那是逐字镜像，不是偏好）。
5. 重新构建并**验证运行时可加载**：`lib/index.js` 必须能在该 DSH 上 import 成功
   （`node -e "import(...)"`），`lib/client.js` 的注册 id 必须等于包名（见下）。
6. 用户可见改动 → bump patch，走日常闭环。

### 最低支持版本（只在真不兼容时上移）

版本在这里是**两个不同的东西**，不要混：

| | 跟随版本 | 最低支持版本 |
| --- | --- | --- |
| 是什么 | 构建与类型检查所对的 SDK 版本 | 插件还能加载的最旧 DSH |
| 写在哪 | `package.json` 的 `devDependencies` | `peerDependencies` 的 `>=` 值 + README「环境要求」那一行 |
| 何时变 | 每次 DSH 升级都跟上去 | **只在真不兼容时上移** |
| 谁看得到 | 只有开发者 | 使用者（README 给人看） |

**最低支持版本只上移、不下移，且默认不动。** 升级 DSH 后插件照常加载、甚至继续在新版
上开发，恰恰说明旧的下限依然成立——**这时不要动它，也不要问要不要改成最新版**。只有
两种情况才上移：

1. 采用了只有新版才有的 API（旧版没有这个符号，加载即失败）；
2. 在旧版上实测加载失败。

上移时**两处必须一起改**（`peerDependencies` 的 `>=` 值 与 README 那一行）：它们是同一
事实的两种表达，漏改一处就会出现「README 说支持、装上去却报错」的错配。README 那行必须
写**具体版本号**（使用者需要一个能判断的数字），不能写成"最新版"这类模糊说法。

**客户端 bundle 的注册 id = 包名**（不是插件 id）。加载器定位行对应的包清单、按
**包名**给 bundle 定键，注册成别的名字会被拒（报 `loaded without registering <name>`）。
无作用域时二者相同，加了作用域才会分叉——`tsdown.config.ts` 的 `clientBundle()` 第一个
参数因此必须是包名。`pnpm verify` 内置此检查，`pnpm smoke` 会真的执行一遍 handshake。

### 平台模块表跟随 shell

`shared/web-platform.ts` 的 `PLATFORM_MODULES` 是浏览器模块表的**镜像**，决定哪些
import 走 external、哪些必须内联。它与真实 shell 不符时会在运行时炸——两种方向都危险：
列了一个已被移除的模块（shell 换实现时这类模块会消失），或少列一个新增的。因此
**每次 DSH 升级都要重新核对**，不要假定这份清单长期有效。**核对方法**：读
`<dsh>/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js`，搜
`__ModuleLoader__` 附近的 seed 对象（`react` 家族 + `@deepseek-ai/dsh-client-*`）。

### 构建可复现（硬性：产物必须与构建机无关）

`lib/` 是被跟踪的发布产物，且 CI 会在 Linux 上重建并与提交比对。因此**构建结果
不得依赖构建机的绝对路径、行尾或平台**。已踩过两个坑，现由 CI 与 `pnpm verify` 兜住：

- **不要把绝对路径交给会把它写进产物、或用来派生标识的工具**。lightningcss 的
  CSS Modules `[hash]_[local]` 前缀取自传给 `transform()` 的 `filename`——传绝对路径
  会让同一份 CSS 在不同目录（乃至不同系统）下编译出不同类名，`lib/client.js` 于是
  永远无法在别的机器上复现。构建脚本一律传**仓库相对路径**
  （`shared/tsdown.client.ts` 的 `portableCssPath()`）。
- **工作区行尾必须与 `.gitattributes` 一致**。sourcemap 的 `sourcesContent` 内嵌源码
  原文，工作区残留 CRLF 会被原样写进 `lib/client.js.map`（曾见 16 个源文件、约 8000
  处差异），而 CI 检出是 LF。修正：`git rm --cached -r . && git reset --hard`
  按 attributes 重新检出后重建。这条与用哪个系统开发无关：只要检出工具按平台改写行尾，
  就可能触发。
- **自检手段**：把仓库复制到另一个绝对路径、装依赖、构建，产物应逐字节相同。
  CI 的「Committed artifacts match a fresh build」就是这条规则在 Linux 上的常驻检查；
  它红了先怀疑以上两点，不要急于提交「本机能过」的产物。

### 改名要动哪几处（工具已自动读取，只剩声明处）

工具链（`scripts/*.mjs`、`scripts/dsh-task-board.js`、npm scripts）**都从 `package.json`
读身份**，不在代码里重复写名字。因此改名只需改声明处，改完让 `pnpm verify` 自己指出漏改：

| 改什么 | 影响谁 |
| --- | --- |
| `package.json` 的 `name` | 安装标识；工具据此推导，其余检查以它为基准 |
| `cordis.patch.yml` 行的 `name:` | 加载器按它解析包（漏改则启动找不到模块） |
| `tsdown.config.ts` 的 `PACKAGE_NAME` | 浏览器 bundle 的注册 id（漏改则界面加载失败） |
| README / CONTRIBUTING 里的安装命令 | 给人看的现成命令（不进包的内部文档不必改） |

**插件 id 不跟着包名变**：它由文件夹名与 `cordis.patch.yml` 的 `id:` 决定，路由此派生。
包名带作用域时二者不同，这正是它们必须分开写的原因（见「命名矩阵」）。

---

## 项目定位

DSH Web GUI 的任务看板插件：侧边栏「任务看板」入口 + 多列看板 + 任务经 DSH 会话机制
真实执行 + 5 段 cron 定时调度。**看板数据持久化在 DSH host 端（存储单元 `dsh_task_board`），
任意设备/浏览器（桌面 + 手机，跨 origin）经 SSE 实时同步看到的是同一块板；窄屏为紧凑布局。**
单一 npm 包，cordis 插件，host/client 双半区，MIT 许可，全新独立项目（零历史仓库引用）。

### 命名矩阵（硬性规范 3，新增标识不得偏离）

**插件 id 与包名是两个身份，不得混用**：id 是加载与数据身份的根，包名只是安装标识。
包名带作用域不改变任何 id、路由、存储单元或数据键。

**本表是规格，不是账号绑定**：表中的包名必须与 `package.json` 的 `name` 逐字一致
（改错一个字符就加载不了），所以照抄即可；但它是**从 `package.json` 读出来**的值，
不是本文"认领"某个账号。若项目易主或换作用域，改 `package.json` 后同步这张表即可，
本文其余部分不需要跟着变。

| 维度 | 值 |
| --- | --- |
| **插件 id**（行 id / 文件夹名 / 设置命名空间 / locale 命名空间 / `/api/<id>/*` 路由 / 存储单元 / 设置卡 slot） | `dsh-task-board` |
| **包名**（`package.json` name / 依赖键 / `dsh.profile.bundles` 项 / `cordis.patch.yml` 行 `name:` / **客户端 bundle 的 `__ModuleLoader__` 注册 id** / `/plugins/<包名>/client.js`） | 以 `package.json` 的 `name` 为准（当前为 `@firetruck666/dsh-task-board`，**含 npm 作用域**） |
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
- **成文契约**：本节只是索引；视觉决策的成文契约在 `DESIGN.md`（令牌真值、排版三档、
  布局与组件契约、Do/Don't，北极星「会记账的管家」）。它**记录**代码而不发明代码——
  改完视觉相关代码顺手核对，不符就改它；权威链见「本文件的定位与编辑规则」。
- **契约由 `pnpm verify` 兜住**（`scripts/verify-design-docs.mjs`）。它把文档对宿主令牌的
  依赖变成机械检查：文档里每个 `--dsw-*` 名字必须在**实际安装的 DSH** 里被声明过，每个
  记录的颜色值必须**逐位相等**于该令牌当前的解析值。三条必须知道的语义：

  1. **它是基线检查，不是主题审计**。全绿只说明「文档仍描述着它自称的那些令牌」，
     不说明「所有令牌都没问题」。
  2. **它不改文档、不自动修复**。令牌迁移了，唯一正确的动作是重跑 `/impeccable document`
     或按报错改正那个值，然后提交。
  3. **找不到 DSH 安装时打印 SKIP 并以 0 退出**——那时文档是**未验证**，不是**错的**。
     值本来就只在装了 DSH 的机器上读得到，所以在开发机上它有结论、在只有源码的环境里它不误报。

  两个例外都写在**文档自己身上**，不藏在脚本里：`--dsw-foo-*` 这种**族引用**（通配，不是名字）
  自动跳过；**故意记录某个 shell 从未声明的令牌**时，在该处写标记 `dsw-missing: --dsw-foo`
  （Markdown 里可写成 `<!-- dsw-missing: --dsw-foo -->`；JSON 没有注释语法，写进字符串即可）。
  标记是**名字级**豁免，且只在写了标记的文档里生效——没有标记的缺失名字一律报错。

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
- **交互卡 + 上下文块**：只订阅 `pendingInteractions`（board 永不注册 waterfall）；carrier 自带 `answer`/`cancel` 时**就卡作答**（`PendingMirror` 身份守卫：只结算当前快照里那一个对象，身份不符即拒，失败留卡报错），数据型 carrier 才降级为跳回原生会话；卡与原生提问卡逐条同形同行为（head 收起/放弃整组、编号或勾选选项 + 推荐徽章 + 自定义答案、上一题/进度/下一题、跳过本题、提交/提交中、就近报错）；todo/用量/goal 读官方 projection（缺面降级）；`SessionContextBlock` 宽行内/窄浮层（240px 封顶）；goal 可操作 strip；有未完成才显示。
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
   系统上跑通，不代表它在另一个系统上是同一个做法。发版说明已按此规则走（见上），
   本规范把它提升为全项目通则。
11. **双端同治（移动端不是一等公民之外的二等公民，而是同一等）**：任何 UI、交互、
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
