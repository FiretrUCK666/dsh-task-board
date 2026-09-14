---
name: 任务看板 (dsh-task-board)
description: DSH Web 界面里的任务看板插件——借来的色阶、密集的 11-14px 层级、全药丸形状，靠状态呼吸而不是靠装饰说话。
colors:
  # 解析快照（DSH 0.1.5-rc.1，浅色主题）。规范源是 --dsw-* 令牌，不是这些值。
  canvas: "#ffffff"
  surface-layer-1: "#ffffff"
  surface-layer-2: "#ffffff"
  surface-layer-3: "#ffffff"
  text-primary: "#0f1115"
  text-secondary: "#61666b"
  text-tertiary: "#81858c"
  text-on-fill: "#ffffff"
  accent-business: "#4176e6"
  state-warn: "#f59e0b"
  state-success: "#22c55e"
  state-error: "#ec1313"
  border-hairline: "#0000001a"
  border-hairline-soft: "#0000000a"
  border-strong: "#0000001f"
  quiet-chip-fill: "#ffffff"
  interactive-hover: "#2631480f"
  mask-modal: "#00000073"
  brand-fill: "#0f1115"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  emphasis:
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.35
  row-line:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "20px"
  hint:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "18px"
  control:
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1
  chip:
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  meta:
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "16px"
  title:
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "24px"
  content-h1:
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.4
  content-h2:
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  mono:
    fontFamily: "SF Mono, JetBrains Mono, Fira Code, Consolas, Liberation Mono, Menlo, Courier, PingFang SC, Microsoft YaHei"
    fontSize: "11px"
    lineHeight: "16px"
rounded:
  sm: "10px"
  md: "14px"
  lg: "20px"
  xl: "28px"
  pill: "999px"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "6px"
  sm-md: "8px"
  md: "10px"
  md-lg: "12px"
  lg: "16px"
  rail-inset: "14px"
components:
  button-primary:
    backgroundColor: "{colors.brand-fill}"
    textColor: "{colors.text-on-fill}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    height: "28px"
    padding: "0 14px"
  button-ghost:
    backgroundColor: "{colors.quiet-chip-fill}"
    textColor: "{colors.text-primary}"
    typography: "{typography.chip}"
    rounded: "{rounded.pill}"
    height: "28px"
    padding: "0 12px"
  button-ghost-sm:
    backgroundColor: "{colors.quiet-chip-fill}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"
    height: "24px"
  button-danger-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.state-error}"
    rounded: "{rounded.pill}"
    height: "28px"
  chip-filled:
    backgroundColor: "{colors.quiet-chip-fill}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.chip}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  card:
    backgroundColor: "{colors.surface-layer-1}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
  input:
    backgroundColor: "{colors.quiet-chip-fill}"
    textColor: "{colors.text-primary}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "34px"
    padding: "0 12px"
  dialog:
    backgroundColor: "{colors.surface-layer-1}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
  column:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
  column-tab:
    backgroundColor: "{colors.quiet-chip-fill}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
---

# Design System: 任务看板 (dsh-task-board)

## Overview

**Creative North Star: "会记账的管家" (The Concierge's Ledger)**

这套界面是一本**账**，不是一张海报。管家已经熟悉这栋房子：他知道东西该放哪，做完就记上，
只在真有事时才说话。所以这里的视觉语言从头到尾是**低音量的准确**——没有一个元素在争宠，
而每一个状态都毫不含糊。用户来这里不是为了欣赏它，是为了在五秒内知道「现在什么在跑、
什么在等我」，然后走开。

它的第一原则是**克制的外观**：板不拥有颜色、字体、玻璃或深浅主题，全部从 DSH 宿主借来。
全部样式里**没有一处硬编码颜色**（由 `pnpm verify` 的审计强制），所有颜色、边框、阴影、
文本层级与动效常量都从一层别名流向宿主语义令牌。这带来一个罕见的结果：换主题、换皮肤时
这块板自动跟着走，零适配。视觉个性的位置因此不在调色板上，而在**几何与状态的精确度**上。

第二原则是**密集但可读**。这是操作界面（Operate），不是营销页：字号落在 11–14px 区间，
按钮 28px 高，卡片内边距 9/12px，节奏靠具名 gap 而不是继承的边距。密度换来的是一屏能装
下更多真实信息；可读性则靠四档明确的文本层级（外加标题档）与永不重叠的具名网格来守住，
而不是靠放大字号。

第三原则是**状态即装饰**。这个系统几乎不做装饰性动效——唯一的常态动画是「呼吸」光环，
而它本身就是一条消息（在跑 / 未读 / 等你）。因此它不能被静音：`prefers-reduced-motion`
下呼吸减速降幅，但绝不置零——置零会把「活着」读成「卡住」，那是与事实相反的谎言。
其余动效一律短促（160ms）、有目的、可降级：挂载时板头与列轨同起一次（`dshTbBoardIn`），
新卡片凭结构印记（FLIP 钩子给无旧矩形的卡片盖 `data-fresh`）同语法到达一次；
浮层家族另有自己的景深语法（`dshTbDialogIn` 带 scale），纯淡入只留 `dshTbFadeIn`——
三套各有含义，不另起第四套；交错延迟（stagger）一律不用。

**Key Characteristics:**
- 颜色完全借自宿主令牌，板零所有权，随主题与皮肤自动漂移
- 密集的 11/12/13/14px 四档层级（外加 16px 标题档），靠层级与对齐而非字号制造清晰
- 全药丸形状语言：按钮、标签页、chip 一律 999px；只有卡片与面板走圆角阶梯
- 唯一常驻动效是状态呼吸，且它是消息而非装饰
- 响应式参照的是**板自身宽度**（容器查询），不是窗口宽度
- 深度靠不透明分层而非模糊：画布可透，内层一律不透明

## Colors

调色板不属于这块板，而是从 DSH 宿主**借来的语义色阶**——下面是它在浅色主题下的解析快照。

### Primary

- **Business Blue** (`#4176e6`，暗色 `#679efe`)：唯一的强调色，承载「可操作 / 已选中 / 交互中」。
  用在选中卡片的双环光晕、选中标签页的描边与 10% 填充、输入框聚焦环、引擎运行指示点。
  它不是品牌色，是**动作色**。（准确地说：它来自宿主 `deepseek-500` 家族，暗色档 `deepseek-400`。）
- **Brand Ink** (`#0f1115`，暗色 `#f9fafb`)：主按钮填充与最高层级文本。深浅主题下自动反转，
  所以「主按钮」这个概念在两种主题里都成立，不需要两套规则。

### Neutral

- **Canvas White** (`#ffffff`，暗色 `#151517`)：画布层。它是**唯一允许透出壁纸**的表面，
  透明皮肤下背景图示于此可见。
- **Inner Opaque** (`#ffffff`，暗色 `#232324` / `#2c2c2e` / `#353638`)：内层浮起、下沉与菜单表面。
  三种内层令牌在浅色主题下解析值相同，在暗色下逐级变亮——**内层永远不透明**，与原生玻璃皮肤
  的约定一致。
- **Ink / Ink Soft / Ink Faint** (`#0f1115` / `#61666b` / `#81858c`；暗色 `#f9fafb` / `#cfd3d6` / `#adb2b8`)：
  文本层级是三档（字号是另一件事，见 Typography）。第三档按设计只承载可舍弃的元信息
（时间戳、占位符、计数）；**说明与提示**属第二档，因为用户要读了才能正确操作。
- **Hairline** (`#0000001a`，暗色 `#ffffff1f`) 与 **Hairline Soft** (`#0000000a`)：所有 1px 描边。
  颜色越浅、层级越轻的边界用 soft；这是「卡片看得见边、内部划分不喧哗」的实现方式。

### Secondary / Tertiary

不适用。这块板只有一个强调色，其余全部是状态色（见下），因此不虚构第二、第三强调色。

### 状态色（语义，非装饰）

- **State Green** (`#22c55e`)：成功、已完成。
- **State Amber** (`#f59e0b`)：**等待与未读**——这是本系统里最重要的颜色，因为它就是
  「管家在跟你说话」的信号。呼吸光环、未读徽标、通知点全部用它，22% / 10% 两档透明度
  是从它派生出的唯一 alpha 阶梯。
- **State Red** (`#ec1313`，暗色 `#f25a5a`)：错误与危险操作。

### Named Rules

**The Borrowed Palette Rule.** 板不写颜色值。任何新样式只能消费 `--dsh-tb-*` 别名，
而每个别名必须落在某个 `--dsw-*` 宿主令牌上。写 hex、rgb 或新造一层近似色都是错误，
`pnpm verify` 会拦下来。

**The One Attention Color Rule.** 「需要注意」只有一种颜色（State Amber）。未读、等待作答、
运行中、通知——全部用它，只在形态上区分（外环 / 内晕 / 实心点）。再加第二种提醒色就会让
两种提醒互相削弱。

**The Opaque Inner Rule.** 画布层可以透（跟随皮肤的玻璃感），但每一个内层表面——
卡片、面板、弹窗、菜单、输入框——一律消费不透明层令牌。半透明表面叠在半透明画布上会双重衰减，
读起来像「背景变不透明」；可读性由控件自身承担，不靠压平背景。

## Typography

**Body Font:** `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif`（DSH 的 `--dsw-font-family`，跟随系统，含中文字族回退）
**Mono Font:** `"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, "PingFang SC", "Microsoft YaHei"`（DSH 的 `--ds-font-family-code`）

**Character:** 没有自己的字体——这是刻意的。板与宿主用同一套系统字族，所以插件的文字
与旁边的原生界面在字重、字距、渲染上完全一致，看不出拼接痕迹。个性来自**尺寸阶梯的克制**：
只有四档（外加一个标题档）。

### Hierarchy

- **Title** (600, 16px, 24px)：板名、弹窗标题、详情页与复核页主标题。用于「你正在处理
  一整件事」的场合。
- **Emphasis** (500, 14px)：**界面文字里最醒目的一档**——卡片标题、详情正文、会话名、
  行内图标按钮、侧栏入口行。只用在真正需要先被读到的那一行（全文件 5 处）。
- **Control** (500, 13px, 1)：按钮、输入框、下拉框、列名、次级标题（31 处）。字重 500 是
  这里的默认强调方式——比加粗克制，比常规可读。
- **Body / Row line** (400–500, 12px, 1.5 或声明的 20px 行盒)：界面主力（82 处）。
  说明文字、列表行、chip、状态行都在这一档。
- **Meta** (400, 11px, 16px)：时间戳、路径、徽标数字、最小辅助标记（18 处）。
- **Content pass**（仅限 Markdown 渲染，**不是界面文字**）：小标题 **h1 17px / h2 15px**，
  代码块 12.5px、行内代码 0.92em——它们跟随内容本身，不参与界面的字号纪律。
- 外壳的完整阶梯（24/20/16/14/13/12/11）是可继承的上游参照，板用到 11 到 16 这一段。

### Named Rules

**The Four-Size Rule.** 界面文字只用 11 / 12 / 13 / 14px 四档（外加 16px 的标题档）。
需要强调时先改字重（500 到 600）或颜色层级，不要新增字号。更多档位不会带来更多清晰，
只会带来更多不一致。

**The Content-Pass Exemption.** 上面这条只管**界面**文字。渲染 Markdown 时用的是另一套
字号（15 / 17 / 12.5px、行内代码 0.92em），因为它排的是**内容**而不是界面——内容该有
自己的排版节奏，把它压进界面字阶只会让正文读起来像表单。

**The Declared Line Box Rule.** 行高要么声明成令牌（`--dsh-tb-row-line: 20px`、
`--dsh-tb-hint-line: 18px`），要么写成无单位倍数。绝不依赖 `normal`：它随字体与皮肤变化，
任何对着它测量的偏移都会在别的环境下漂移。

## Layout

空间模型是**五列看板 + 具名网格行**。

- **列**：`.columns` 是五等分的横向布局，每列 `border-radius: lg (20px)`，列内卡片列表是
  该列**唯一的滚动体**（`overflow-y: auto`）。列与列之间靠留白分开，不靠分隔线。
- **板头两档用的是两套不同的机制，各有各的理由。** 桌面档是 **flex 行 + 一个具名 spacer**
  （`.boardRow` 是 `display: flex`）：右簇靠 `.boardSpacer` 弹到末端，**刻意不用
  `margin-left: auto`**——那个写法只右对齐换行后的首项，一换行即散架。紧凑档（< 680px）则
  改为**具名 grid 区域**，层级由区域名说明而不是靠 `order` 加自动外边距堆出来：导航行
  `"back title cruise"` / `"state state state"`，工具行 `"modes"` / `"search"`。
  换句话说：**具名区域是窄屏才需要的东西**（那时一行装不下，必须确定性地换行），
  桌面的 flex + spacer 已经够用，且它的失败模式被这行 spacer 关掉了。
- **响应式的参照是板自身的盒子宽度，永远不是视口。** 板声明
  `container-type: inline-size; container-name: dsh-tb`，所有紧凑规则都是
  `@container dsh-tb (max-width: 680px)`。会话面板同理，声明 `dsh-tb-panel`（600px）。
  这样在侧栏收起/展开、分屏、手机上都是对的；而 `@media (max-width)` 会在侧栏展开时误判。
- **紧凑档（< 680px）**：五列变成一个**横向自由滑动**的轨道（单列宽 `clamp(200px, 46cqw, 320px)`），
  配一排五等分的列导航标签（短名 + `aria-label` 全名）；板头换行成确定的两行；底部出现拇指栏
  （新建、通知、动态）。**什么都没有被藏起来——只有几何变了。**
- **刻意不使用 `scroll-snap`**：列导航条已经能把任一列直接带进视野，而 snap 会在每次容器
  尺寸变化时按像素 `scrollLeft` 重新吸附——开合侧栏会让整块板「每次都挪一点」（累积漂移，
  已踩过）。自由滑动才是与桌面一致的诚实模型：桌面也没有 snap。
- **节奏**：段落外边距全局清零（`[data-dsh-taskboard-view] p { margin: 0 }`），
  所有间距由具名 `gap` 声明。可见的 gap 阶梯是 2 / 4 / 6 / 8 / 10 / 12 / 16px，
  其中 8px 出现 67 次、6px 32 次、10px 25 次。
- **偏移一律派生**：需要对齐的 x 坐标由令牌相加得出（`--dsh-tb-lead-x: calc(12px + 7px)`），
  绝不手写 ±3px 微调——手写的数字会在任一侧尺寸变化时静默失效。
- **内容内衬单归属**：同一表面的一条内容线只声明一次（`--dsh-tb-rail-inset: 14px`），
  该表面的每个成员引用令牌，不重打数字。

## Elevation & Depth

**不靠模糊，靠分层与阴影。** 系统有三层表面：画布（可透，跟随皮肤）、内层浮起
（不透明）与菜单/下沉（不透明、更深）。深度由两层机制表达：不透明度的变化，以及三档阴影。

**没有 `backdrop-filter`，这是决定而非疏漏。** 用户保留透明皮肤，希望壁纸透上来不被改写；
冻结背景（毛玻璃）在他眼里读作「背景变不透明」，试过一版后已撤回。照片上的可读性由控件
自身的不透明表面承担。

### Shadow Vocabulary

阴影令牌也来自宿主，浅色主题下为：

- **Level 1** (`0 2px 4px 0 #0000000d`)：静息态的浮起元素——主/危险按钮、悬停快捷执行钮。
- **Level 2** (`0 4px 12px 0 #00000005, 0 2px 8px 0 #0000000a`)：悬停与选中——按钮 hover、
  卡片 hover、选中卡片的基底阴影。
- **Level 3** (`0 0 1px 0 #0003, 0 0 4px 0 #00000005, 0 12px 32px 0 #00000014`)：
  真正的浮层——弹窗、锚定弹层。

外壳另有一套 `--dsw-elevation-*`（带 0.5px 描边的组合阴影）供原生表面使用；板不使用它，
因为它自带描边，而板的边界已由 `--dsh-tb-border` 承担。

### Named Rules

**The Flat-By-Default Rule.** 静息态是平的：卡片只有 1px 细边，没有阴影。阴影是**状态的响应**，
不是身份的声明——它只在悬停、选中、浮起时出现。因此一屏里同时有阴影的元素极少，而这些
阴影就自动读作「当前焦点」。

**The State-Light Rule.** 选中态的光晕用强调色的 22% + 10% 双层环比，而不是换一个填充色；
呼吸态用琥珀色的 22%（外环）/ 10%（内晕）。两种光都用同一套 alpha 阶梯与同一套动效令牌，
所以「选中」与「正在跑」在同一屏里读起来是同一族的光，只是颜色与形态不同。

## Shapes

形状语言只有两条规矩，但它们被严格执行：

- **半径与「角是不是圆弧」是两条轴**（`border-radius` 与 `corner-shape`）：半径决定角有多
  大，形状决定角是不是圆弧。全板只在设计系统层的根选择器
  （`[data-dsh-taskboard-view], [data-dsh-taskboard-view] *[class], [data-dsh-taskboard-panel]`）
  声明一次 `corner-shape: var(--dsh-tb-corner, round) !important`，**一次声明管住全部后代**。
  这条规矩是被实测逼出来的：`corner-shape` **不继承**，而环境里任何 superellipse 家族都会
  把 `50%` 圆点与 `999px` 胶囊渲染成「方加圆弧」；此时改半径毫无作用——因此历史上每次
  只改半径都没修好。`!important` 与 `*[class]` 不是风格选择：同特异性下 `!important` 平局
  由**特异性**裁决，实测 `[data-dsh-taskboard-view] *`（0,2,0）会输给 `.theme .statusDot`
  （0,2,0）而圆点仍是方的。皮肤若要换圆角家族，改 `--dsh-tb-corner` 这一个令牌，
  而不是在看板里另写一套形状声明。
- **一切可点的「按钮类」都是完整药丸（999px）**：按钮、列标签页、chip、筛选标签、开关轨道、
  时间字段。理由不是审美偏好，而是实测结论——固定 px 半径（曾用 22px）只对一个高度成立，
  在另一个高度上就变成「方形圆弧」；而完全圆角在任何高度都读作圆。
- **卡片与面板走圆角阶梯，且与尺寸成正比**：卡片 14px（`radius-md`）、列与浮起面板 20px
  （`lg`）、弹窗 28px（`xl`）。卡片刻意比所在列**更尖一档**，这样「面板里装着条目」的
  从属关系由几何本身就说明白。
- **非药丸的小物件保留自己的小半径**：仪表色块（2px）、滚动条拇指与行内 `code`（4px）、
  删除 ×（4px）、投放指示条（3px）、仪表分段（1px）、圆形徽标（50%）、会话气泡（22px,
  按气泡自身高度取圆）。它们不是按钮，不该被药丸语言同化。
- **微圆角不进 `rounded` 标度**：2/3/4px 这类值是**逐元素的细节尺寸**，不是可供复用的
  标度档位——写进标度只会诱使别人把一个细节尺寸当成系统语言。判断一条半径该不该进标度，
  看它是否会被第二处复用。
- **圆点在标题行之前**：卡片色点（8px 实心）承载精确的用户选定色；卡片背景只被同一个色以
  6% 混入做氛围。因此卡片永远不会「偏色」——身份由点承担，背景只是空气。

## Components

### Buttons

- **Shape:** 完整药丸（`border-radius: 999px`），高度由令牌给定（默认 28px，列表内 24px，
  预设行 34px）。`box-sizing: border-box` 是硬性的：否则每个 28px 控件实际是 30px，任何两行
  都永远对不齐。
- **Primary:** 宿主主填充色（`--dsw-alias-button-primary-fill`）+ 反色文字，静息带 Level 1 阴影，
  悬停升到 Level 2，按下 `translateY(1px)` + 内阴影。高亮方式来自宿主，所以换皮肤时主按钮
  跟着换。
- **Ghost（安静按钮）:** **填充**的 chip 表面（同一个共享 chip 令牌）+ 1px 细边，12px 字号，
  内边距 0/12px。刻意不做成空心描边——只有细线勾勒的药丸，眼睛会把两条长直边读成矩形框，
  即使两端是精确半圆；先给填充，几何才被看见。
- **Danger Ghost:** 透明底 + 危险色文字 + 危险色 45% 描边；悬停转 10% 填充，按下 22%。
  危险的量级靠 alpha 递增，不靠换形状。
- **Toggle 态（`aria-pressed`）:** 用悬停色调 + 更强描边表达「已按下」，**绝不**升级成主填充——
  进入「整理」这类模式必须保持安静的可用性，而不是变成一次宣布。
- **禁用:** 主按钮 `opacity: .5`，安静按钮 `.45`，光标回到默认。不用灰度滤镜，避免与皮肤冲突。

### Chips

- **Style:** 12px / 字重 500 / 行高 1.5，字号用的是次级文本色；填充态加共享 chip 底 + 药丸 +
  `2px 8px` 内边距。
- **两槽文法（关键）:** 每个 chip 由「几何槽」（`.chipLead`，承载图标或转圈）与「文本槽」
  （`.chipBody`，负责省略号）组成，两者都是 chip 的 flex 子项。文本槽吸收收缩并省略，
  几何槽永不收缩——所以标签被截断时图标不会被一起吃掉。
- **State:** 状态 chip 只改文字色（success / error / warn / muted 四个 data-kind），
  不改填充——颜色在这里是语义，不是等级。

### Cards

- **Corner Style:** 14px（`radius-md`），比所在列的 20px 更尖，读作「面板里的条目」。
- **Background:** 内层浮起表面 + 可选 6% 用户色氛围（通过 `--card-tint` 数据变量注入，
  绝不是 CSS 字面量）。
- **Shadow Strategy:** 静息无阴影，悬停出现（见 Elevation 的 Flat-By-Default）。
- **Border:** 1px `--dsh-tb-border`（宿主 l2 层级）。
- **Internal Padding:** `9px 12px`，子项间距 6px。
- **硬性契约:** `overflow: hidden` 是通用防穿模底线——任何未来落进卡片的内容（超长不可断词、
  图片、块级元素、异常字体渲染）都不可能跑出圆角盒；`min-width: 0` 加省略号是优雅层，
  裁剪是地板层。卡片自身装饰（悬停阴影、未读光环、焦点轮廓）是元素的盒装饰，不属于子内容，
  因此不被裁剪。
- **不收缩:** 卡片在滚动列内 `flex: none`——满列滚动溢出，而不是压缩卡片高度把内容藏起来。
- **两行阅读位:** 标题与事实行（`.cardNext`，“是什么 vs 有什么”）各占一行单行省略；
  描述是卡片上唯一可换行的长思考。标题不双行、事实行不复述 chip——扫描时每张卡只读两行。

### Inputs / Fields

- **Style:** 34px 高，`0 12px` 内边距，13px 字号，宿主输入面填充（与旁边的安静按钮**同一个**
  令牌，所以它们在皮肤下不会分家），1px soft 细边，14px 圆角。
- **Focus:** 边框转强调色 + `0 0 0 3px` 强调色 alpha 光环。焦点环是硬性的，不因美观取消。
- **Error:** 只有 `inputInvalid` 一个来源负责错边框——不允许各处自画红边。
- **原生 grip 隐藏:** 文本域的右下角斜纹握把被隐藏，但拉伸行为保留（拖角仍能改高）。

### Navigation

- **列导航（紧凑档）:** 五等分标签，药丸形，短名 + `aria-label` 全名。选中档用强调色 10% 填充
  + 强调色描边 + 更强墨色，**并额外带 `2px` 强调色 outline**（窄屏看不清描边时的兜底）。
- **板头工具栏:** 桌面档是一行「模式」+ 一行「搜索」的 flex 行；**紧凑档**才改成具名区域
  的两条轨道（`"modes"` / `"search"`），板名与导航在窄屏确定性地换到第二行——不靠 `order` 猜。
- **拇指栏（紧凑档）:** 底部 dock，放新建、通知铃与动态；左右下沿的出血量由
  `--dsh-tb-dock-x` / `--dsh-tb-dock-b` 两个令牌单点声明，内流元素用负边距精确花掉它们。

### Session Row（签名组件）

会话行是这块板里最密集也最讲究的一行，值得单独记为契约：

- **三槽具名 grid**：身份槽（12px 标记 + 7px 沟）+ 内容槽 + 动作槽。可选的成员不占固定轨道，
  因此行不会因为某一项缺席而错位。
- **一条派生的对齐 x**：标题、工作区胶囊、状态 chip、元信息行全部读同一个
  `--dsh-tb-lead-x`（`calc(12px + 7px)`），所以它们永远对齐——手写像素做不到这一点。
- **行内控件与文字对齐**由派生偏移完成（`--dsh-tb-button-h-sm` 与 `--dsh-tb-hint-line`
  一起算出），不是靠 ±3px 目测。
- **未读不在这一行显示**：卡片上的呼吸已经承载了同一个状态，行内再标一次是重复（用户决策）。
  会话行只在「在跑」时呼吸。

### Automation / Preset 面

任务自动化与会话规则共用一个 `AutomationEditor`，运行配置共用一个 `RunConfigFields`。
视觉上它们是**折叠披露（disclosure）**而非第二套页面：`sectionHead` 恒为一行，
折叠头带 chevron 与摘要，展开后在限高区域内滚动。每区至多一个滚动体——这是硬约束，
不允许父子各自滚动。

## Do's and Don'ts

### Do:

- **Do** 消费 `--dsh-tb-*` 别名，并让每个别名落在 `--dsw-*` 宿主令牌上。宿主换皮肤时
  改一处，全板跟着变。
- **Do** 把形状语言交给那**一条**根规则（`corner-shape` 声明处）：新增圆点或胶囊时只写
  半径，形状会自动覆盖到——不需要、也不允许逐处补 `corner-shape`。
- **Do** 用**板自身宽度**做响应式参照：`@container dsh-tb`（680px）与 `@container dsh-tb-panel`
  （600px）。它在侧栏开合、分屏、手机上都是对的。
- **Do** 让容器装不下时**让位**：换行、换列、具名区域改排、短名 + `aria-label`、折叠、
  提高地板。窄屏与桌面是同一等公民。
- **Do** 用派生偏移对齐（`calc(var(--a) + var(--b))`），让「上面有空隙下面紧贴」这类
  不一致在机制上不可能发生。
- **Do** 给每个控件可 Tab 到的焦点态；Dialog 只留一个 Escape 出口。
- **Do** 在 `prefers-reduced-motion` 下**削弱**状态呼吸（降速 2.6s 到 5s，收幅 3px 到 2px），
  绝不归零——它是消息，不是装饰。
- **Do** 让文字永远留在盒内：裁剪只发生在「文字子槽」里，`overflow: hidden` 是底线。

### Don't:

- **Don't** 写颜色字面量。没有 hex、没有 `rgb()`、没有新造近似色；`pnpm verify` 会拦。
- **Don't** 靠改半径去修「不够圆」。半径对、角是方的，是 `corner-shape` 的事；改半径只会
  把圆点改成圆角方块，问题照旧（历史上反复复发正因如此）。
- **Don't** 用 `@media (max-width)` 做布局判断。视口宽度不是这块板的真相。
- **Don't** 用藏掉标签、藏掉控件、缩小字号来「省地方」。只在一档验证过的改动视为未完成。
- **Don't** 增加字号档位。11 / 12 / 13（+16 标题）之外的新尺寸需要先改这条规则。
- **Don't** 让两个以上的元素同时带阴影。静息态是平的；阴影是当前焦点的信号。
- **Don't** 引入第二套交互副路径：同一件事在窄屏与桌面必须走同一套组件与同一套机制，
  不允许为手机另写一个组件。
- **Don't** 把必要信息挂在 `title=` 上。触屏没有悬停，说明必须可点可达。
- **Don't** 把状态指示器（呼吸光环、运行转圈）当作可省略的装饰去掉——它们是界面在说话，
  去掉等于让界面沉默。
- **Don't** 为挂载另起一套动效名。入场只有 `dshTbBoardIn`（板头/列轨/新卡同语法）、
  `dshTbDialogIn`（浮层景深）、`dshTbFadeIn`（纯淡入）三套；交错延迟一律不用——
  新卡的到达感来自结构印记（`data-fresh`），不来自排队。
- **Don't** 在同一个区里放第二个滚动体。每区至多一个，父子各自滚动会造成互相遮盖。
- **Don't** 让卡片或面板的内容溢出圆角盒。`overflow: hidden` 是这个系统唯一的通用防穿模底线。
