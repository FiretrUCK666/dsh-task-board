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

第三原则是**状态即装饰**。这个系统几乎不做装饰性动效——常驻的动画只有两个，而且都是消息：
「呼吸」光环（在跑 / 未读 / 等你）与运行转圈（正在执行）。呼吸不能被静音：
`prefers-reduced-motion` 下呼吸减速降幅，但绝不置零——置零会把「活着」读成「卡住」，
那是与事实相反的谎言。其余动效一律短促、有目的、可降级：标准过渡 160ms
（`--dsh-tb-motion`）；挂载时板头与列轨同起一次
（`dshTbBoardIn`），新卡片凭结构印记（FLIP 钩子给无旧矩形的卡片盖 `data-fresh`）
同语法到达一次；浮层家族另有自己的景深语法（`dshTbDialogIn` 带 scale），纯淡入只留
`dshTbFadeIn`——入场三套各有含义，不另起第四套；一次性事件闪光播一次即停（通知点 ping
`dshTbNotifyPing` 900ms、需求行到达 `dshTbDemandFlash` 900ms、被拒投放
`dshTbRejectFlash` 180ms）；交错延迟（stagger）一律不用。

**Key Characteristics:**
- 颜色完全借自宿主令牌，板零所有权，随主题与皮肤自动漂移
- 密集的 11/12/13/14px 四档层级（外加 16px 标题档），靠层级与对齐而非字号制造清晰
- 全药丸形状语言：按钮、标签页、chip 一律 999px；只有卡片与面板走圆角阶梯
- 常驻动效只有状态呼吸与运行转圈，两者都是消息而非装饰
- 响应式参照的是**板自身宽度**（容器查询），不是窗口宽度
- 深度靠不透明分层而非模糊：画布可透，内层一律不透明

## Colors

调色板不属于这块板，而是从 DSH 宿主**借来的语义色阶**——下面是它在浅色主题下的解析快照。

### Primary

- **Business Blue** (`#4176e6`，暗色 `#7aaaff`)：唯一的强调色，承载「可操作 / 已选中 / 交互中」。
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
- **On-Fill 两档墨色**：字写在填充上时分两种情况。浅色的强调色填充——通知徽标、选中徽标、
  筛选激活态、会话行把手——用静态深墨 `--dsh-tb-ink-on-fill`（源 `--dsw-static-neutral-bluish-1000`，
  深浅主题同值：浅底在两个主题下都需要深字；浅色主题实测对比度 8.80 / 9.88 / 8.29 / 4.46，
  白字只有 2.15 / 1.91 / 2.28 / 4.23，低于 4.5）。深色填充——品牌主按钮与危险按钮，两个主题
  都是深底——继续用会随主题翻转的 `--dsw-alias-label-primary-foreground`：它答的是「品牌深墨
  上写什么」，拿去配浅底会正好答反一半时间。
- **Hairline** (`#0000001a`，暗色 `#ffffff1f`) 与 **Hairline Soft** (`#0000000a`)：所有 1px 描边。
  颜色越浅、层级越轻的边界用 soft；这是「卡片看得见边、内部划分不喧哗」的实现方式。

### Secondary / Tertiary

不适用。这块板只有一个强调色，其余全部是状态色（见下），因此不虚构第二、第三强调色。

### 状态色（语义，非装饰）

- **State Green** (`#22c55e`)：成功、已完成。
- **State Amber** (`#f59e0b`)：**等待与未读**——这是本系统里最重要的颜色，因为它就是
  「管家在跟你说话」的信号。呼吸光环、未读徽标、通知点全部用它，22% / 10% 两档透明度
  是从它派生出的唯一 alpha 阶梯。通知铃的新到点是静态实心点；「刚刚到达」的时态由同一点
  上的一次性 ping（`dshTbNotifyPing`，`notifyPulse`）承担——同一元素、同一颜色，动画是
  时态而非第二个信号，播一次即回到静态点；reduced-motion 下只放慢，不消失。
- **State Red** (`#ec1313`，暗色 `#f25a5a`)：错误与危险操作。

### Named Rules

**The Borrowed Palette Rule.** 板不写颜色值。任何新样式只能消费 `--dsh-tb-*` 别名，
而每个别名必须落在某个 `--dsw-*` 宿主令牌上。写 hex、rgb 或新造一层近似色都是错误，
`pnpm verify` 会拦下来。

**The One Attention Color Rule.** 「需要注意」只有一种颜色（State Amber）。未读、等待作答、
运行中、通知——全部用它，只在形态上区分（外环 / 内晕带柔外沿 / 实心点）。再加第二种提醒色
就会让两种提醒互相削弱。

**The One Light Rule.** 一张卡片同一时刻只戴**一种**光，由卡片自己显示出来的状态决定，
判据唯一：`cardLightOf(active, unviewed)`（`card-view.ts`）——`active` 含**卡片自身的列状态**
（`task.status === 'running'`，与黄边 `data-status` 是同一个事实）以及等待 / 进行中；
在跑的卡戴内晕，未读的卡戴外环，两者都是 `none`。渲染只写**一个**属性
`data-light="halo|ring|none"`，样式表按它分两条规则。

**可见性也是契约的一半。** 内晕（inset、软档）单独存在时贴着满强度静态黄边**看不见**——
「进行中的卡边缘不呼吸」在判据修对两次之后仍然成立，因为缺陷从来不在判据层：呼吸必须在
**边缘**有起伏，且起伏必须**越过自己的边框**才叫可见。所以 halo 的峰值 = 内晕（10% 软洗）
+ **外沿抬到满档 22%**（与 ring 同 alpha、不同形态：3px 模糊外沿 + inset 洗涤 vs ring 的
硬实外环）——外沿停在 10% 软档时仍低于可见门槛，第三版才抬到 22%；ring 仍是纯外凸硬环，
两种形态依旧分明，`card-contract.spec` 钉住峰值形状与档位。

这条规则存在的原因**三次**踩过：① 光曾经由**会话的原生 running 标志**驱动，而卡片是否
「进行中」由**自己有没有未结算轮**决定——两个判据在「外部观察轮」上正好相反，于是卡片顶着
黄边框、chip 写着进行中，却一点不闪；② 两种光各写一个属性时，它们设的是**同一个
`animation` 属性**，谁赢取决于样式表顺序——那是「某个光悄悄换状态」的温床；③ 修好 ① 之后，
「进行中」仍有多条腿可达（在跑的轮 / 直发轮出生即结算 / 链与预算批次间隙 / 只有子代理在跑的
会话），而光只认其中一条——**黄边在、光不在**，形态与 ① 一模一样。所以：光的输入包含卡片
自己的列状态，「有黄边必有呼吸」是**结构性质**（`card-contract.spec` 钉住两端读同一条规则，
`card-view.spec` 逐档钉住），而**主从关系写成一行代码，不靠级联的隐式顺序**。

**The Session Activity Rule.** 「这个会话还在工作吗」只有一个答案：`own ∨ descendant`——
本会话自己的 turn，或它召唤的、`origin === 'subagent'` 的**无中断链**上仍在跑的后代
（`session-lineage.ts` 逐字对齐官方侧栏的 `indexSubagentDescendants`：origin 首闸、逐层计提、
fork 只写 parentId 不写 origin 所以天然不算）。卡片、会话行、会话点、详情与复核页的 state chip
全读它（`controller.sessionActiveOf`）；而「我发出去的那个 turn 结束了没有」这一类结算 / 看门狗
读点继续读**裸** `running`——两者混用会同时造成回合永不过期与幽灵外源轮。列表未就绪
（`phase === 'pending'`）或该行缺席时答案是第四档 `unknown`：既不当 idle 去写台账，也不当
active 去长占。

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
- **Control** (500, 13px, 1)：按钮、输入框、下拉框、列名、次级标题（30 处）。字重 500 是
  这里的默认强调方式——比加粗克制，比常规可读。
- **Body / Row line** (400–500, 12px, 1.5 或声明的 20px 行盒)：界面主力（88 处）。
  说明文字、列表行、chip、状态行都在这一档。
- **Meta** (400, 11px, 16px)：时间戳、路径、徽标数字、最小辅助标记（17 处）。
- **字距**：板名 `-0.02em`，弹窗 / 详情 / 复核页主标题与内容小标题 `-0.01em`，小节与字段标签
  `+0.02em`；其余不设字距。
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
  `container-type: inline-size; container-name: dsh-tb`，紧凑档规则是
  `@container dsh-tb (max-width: 680px)`。会话面板则声明 `dsh-tb-panel`（600px）。
  这样在侧栏收起/展开、分屏、手机上都是对的；而 `@media (max-width)` 会在侧栏展开时误判。
  **面板量不到自己**（声明处 `.review` 就是那个盒子），所以它的宽度与高度内缩挂在板档上：
  弹层内衬左右各 24px，面板 = 板 − 48，于是**板 648px 正好对应面板 600px**——这是同一个
  地板的两种量法，**不是第三档**。
- **紧凑档（< 680px）**：五列变成一个**横向自由滑动**的轨道（单列宽 `clamp(200px, 46cqw, 320px)`），
  配一排五等分的列导航标签（短名 + `aria-label` 全名）；板头换行成确定的两行；底部出现拇指栏
  （新建、通知、动态）。**信息与动作不缺席——只有几何会变，或者整件搬到该在的位置**：
  这三样在紧凑档移居拇指栏（页眉里的孪生钮同时隐藏，同一宽度永远只有一个可见实例），
  列导航标签只去掉与正下方列头重复的状态圆点。
- **刻意不使用 `scroll-snap`**：列导航条已经能把任一列直接带进视野，而 snap 会在每次容器
  尺寸变化时按像素 `scrollLeft` 重新吸附——开合侧栏会让整块板「每次都挪一点」（累积漂移，
  已踩过）。自由滑动才是与桌面一致的诚实模型：桌面也没有 snap。
- **列内顺序 = 「最新落地在最上」，但让位不产生虚假新鲜度。** 引擎派生的换栏（跑完、
  启动、插话完成、清扫、删会话后的离场）把卡片顶到目标栏最上方，按发生时间，最新在
  上；留在原栏的结算不重排；**用户手动拖动的位置永不被覆盖**。改顺序必然要给被让位的
  同门盖上新的 `updatedAt`（同步合并按它排序，漏盖就是两台设备顺序漂移），所以屏上的
  「更新于」读的是**卡片自己的工作推进**（创建 + 每一轮的开始与结束），不是那个戳——
  否则一次顶格会让整栏几百张卡一起写「刚刚」，恰好把「哪个先完成」这个信号抹平。
- **触屏媒体查询只做隐形人体工学**：`@media (hover: none) and (pointer: coarse)` 里的规则
  只扩热区、放大输入字号，不改任何视觉几何——手机上看到的与桌面逐像素一致。
- **节奏**：段落外边距全局清零（`[data-dsh-taskboard-view] p { margin: 0 }`），
  所有间距由具名 `gap` 声明。可见的 gap 主阶梯是 2 / 4 / 6 / 8 / 10 / 12 / 16px，
  其中 8px 出现 60 次、6px 33 次、10px 22 次；阶梯之外只剩逐元素的光学微距（chip 图文沟、
  身份列沟的 5 / 7px），与微圆角同一条判断：不进标度。
- **每个间距都必须有归属的容器**：因为段落边距已清零，一个堆叠容器内部的相邻小节之间
  不会有任何空白——**除非该容器自己声明 `gap`**。所以「叠若干小节」的容器一律是
  `display: flex; flex-direction: column` + 具名 `gap`；任何在块流里裸放的 `div`
  都会让两边的小节贴在一起（实测 0px，与旁边有意的 6/8px 并排就显得「跟其他地方不一样」，
  「运行配置（当前会话）」紧贴上方统计行就是这一类）。折叠体
  （`.detailSectionBody`，折叠标题行与正文之间归 `.detailSection`）是这类容器中被漏掉的一个。
- **小节之间 > 小节内部**：分节之间的间距必须大于该小节自己的内部间距，否则小节会读成
  上一段的附属而不是新的一段（`.reviewConfig` 标题到网格 8px，故折叠体内分节间用 12px）。
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
呼吸态用琥珀色：外环 = 22% 满档硬环，内晕 = 10% 软洗 + **22% 外沿**（可见性地板，见
「可见性也是契约的一半」）。两种光都用同一套 alpha 阶梯与同一套动效令牌，
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
- **卡片的单位是页面，不是分组。** 一个框说的是「这里有一个独立的东西」，而分组、汇总、提醒
  **都不是**独立的东西——给一组行套一个框，就是把「这一页的一个切法」说成「一批物件」。
  参考工作台的大卡框住的是整个列表（筛选工具条 + 列头 + 行都在那张卡里），不是一组一框。
  **满屏的框会互相削弱**：一屏上三个同权的框，读者的注意力落在框上而不是内容上。
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
  + 强调色描边 + 更强墨色；`2px` 强调色 outline 只属于键盘焦点（`:focus-visible`），不表示选中。
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
- **动作线 = [动作……] [时间]**：按钮在行的**左沿**、时间在**右沿**，间距由行自己承担。倒过来
  曾经让时间领着簇走：它自带一个预留宽度的槽，按钮被整体推到右边一行槽的距离，行首和它的
  控件对不齐。按钮簇自己换行，所以窄屏是「让位」不是「压扁」；时间槽保留整份日期宽度，
  `21h` 与 `2026-09-24` 不会让同一批行忽长忽短。
- **状态 chip 的词只有一套**：等待 / 在跑 / 成功 / 失败 / 取消 / 未运行。`sessionStateChip`
  是唯一文法，调用方只挑「已结算」那一对词；运行行与链入行、任务详情与复核页读**同一个会话
  状态推导**（`sessionDisplay` / `linkedSessionDisplay` 是同一个函数的两个入口），所以同一段
  对话从哪扇门进去都是同一个词——「既跑过又被绑定」的会话也只看它最新的那件事。
- **两种光、同一族琥珀**：等待/在跑的行戴 `attention`；已结束但还没复核的会话行戴 `unread`
  ——两个语义值共用同一条呼吸内晕，状态文字由 chip 区分。已读与空闲静默。行/点读**轮次未读**
  时钟（`sessionUnviewedOf`），卡片环读**任务未读**时钟（打开详情即灭）——粒度不同、各读各的，
  所以「哪个会话刚跑完」在详情列表里和在板上卡片点里答案永远一致。
- **顺序 = 最新发生的在最上**，与卡片换栏顶格同一条律：某个会话**开始工作或结束工作**时，
  它顶到列表最上方（其余行整体下移，保持相对次序）。手动拖过的排列不会被顶格打乱，
  只是让位——和卡片的手动次序同一条律。没被任何轮次动过的会话按它自己的最后动静排，
  链入会话再与宿主的 `updatedAt` 取大。**标已读不重排**（看一眼不是「工作」）。

### Feed Row（通知 / 动态共用行文法）

两个抽屉的每一行是**同一个组件 `FeedRow`**（`FeedRow.tsx`），骨架只写一次——提问行、审核行、
动态行永远长得一样，谁也不许再手拼一行（「排版各搞一块」的结构根治）：

- **身份行顺序 = [任务?][会话?][状态]**：任务和产出它的会话读作一个单元，状态紧挨着它解释的
  动作。任务槽**只缩不伸**（`0 1`，6em 地板、10em 上限）——空隙属于状态与动作之间的中段，
  短任务名不再把整行推散；会话槽 4em 地板 / 40% 上限；状态 chip `flex: none` 永不被压。
- **任务与会话是身份，不是元数据**：会话槽用二级墨色（时间戳才是三级色）。
- **动作簇 = [时间 + 按钮]**：时间是安静的等宽 12px 印章——每行不开任何东西就能回答「何时」；
  时间槽预留完整日期宽度，近年相对时间与旧日期不会仅因字符串长短把动作簇推向不同的行。
- **正文（等待摘录 / 动态文字）独占一行**，2 行截断（`notifyExcerpt`）。
- **`.notifyMain` 带最小宽度地板**（`min(100%, 16rem)`）：身份行装不下时动作簇整组**换行**，
  而不是把标题挤成细缝——让位，不压扁。
- **可选槽是结构差，不是样式差**：通知屉是平铺（一会话一行）内联两标题；动态屉在
  日 → 任务折 → 会话节的层级里，标题由头行携带、成员行只留状态+内容+时间+动作。
- **状态词表一处派生**（`noteStatusShapeOf`）：权限审批 / 计划确认 / 提问（琥珀）、
  待审核（**琥珀**——与卡片「待你决断」同语言：都是等你动手，绿读作「已完成」会骗人）、
  待决策（红）。**只有两个决断词，没有第三个**：审核行由「门」（`task-demand.gateOf`）产生，
  而门要求**有已结算的成败**，所以取消（`cancelled`）永远不产生行、也就没有词可写。
  动态行的词表是另一张纯表（`activityChipOf`），两表都只回答各自「发生了什么」。
- **门的三个子句与两处消法**：在待审核 ∧ 有已结算的成败 ∧ 用户还没看过**那个会话**。
  通过/打回即消（移栏）；看过即消——但「看过」只能由**真正打开那段对话**的动作给出（会话面板 /
  复核页 / 通知行 / 标已读）。**点开卡片不算**：卡片是摘要，摘要不是对话，所以 `openTask` 只动
  卡片自己那口钟（环、「新 N」）。这正是两层读法的由来——**卡片环读任务未读（点开即灭），
  门与会话点读轮次未读（进对话才灭）**，两件事、两口钟，谁也不冒充谁。
  卡片的「待你决断」芯片、需求行的待审核张数、抽屉的审核行**读同一个 `gateOf`**，
  所以同一张卡在三处不可能给三个答案；抽屉的行是**每会话一行**（一张卡两个会话欠你就是两行）。
- **抽屉的分类就是这两类，且各带尺寸**：三颗筛选芯片（全部 / 等你处理 / 待审核）各显示自己的
  行数，两者相加等于铃徽标。分类不需要切换就知道，因为芯片自己写着数。
- **计数单位**：铃徽标 = 抽屉行数（每会话一行），点开即所见；需求行保持自己的语义
  （等你处理按**会话**、待审核按**卡片**），两者都由同一份推导得出，标题里各自写明单位。
- **动态屉的层级**：**日标题 → 任务折（标题 ×N · 最新时间 · chevron，单开、开屉自动展开
  最新组）→ 会话节（静默小头：会话名；无会话的事件不设节）→ 事件行**；展开成员封顶 10 条
  + 余数行，键 `task|day` 单一构造。待审层逐会话出正身行：**任何已结束轮**（留言/外部/直发/
  plain）都算一条道。

### 交互卡（Interaction Card）

提问卡与计划卡共用一副骨架，两条律法管住它们的「桌面截断」史：

- **高度契约**：卡至多 `max(290px, min(320px, 100%))` 高——320 阅读上限、100% 不超所在盒、
  290 是**地板**：短盒（实测 122px 评论盒）曾把卡压到盒高，头+尾装不下，`overflow:hidden`
  把提交按钮底边切掉、正文瘪到看不见输入框；地板保证卡永不矮过自身自然高度，地板多出的
  高度由外层评论区滚动体承接（关注逻辑落点=卡底=底栏），正文内滚、头尾钉住——长计划/长题
  永远推不走确认按钮与输入框。
- **宽度契约（每层装得下）**：`width:100%` 必须配 `box-sizing: border-box`（padding/边框是
  盒自带的行头，不是额外宽度——全表扫描有契约测试，这族 bug 出现即红）；文本包装器一律带
  断词（`interactionPlanBody: break-word`、shell 选项胶囊 `anywhere` + `max-width:100%`）。
- **规范陷阱记录在案**：写 `overflow-y: auto` 的滚动体，按 CSS 规范另一轴自动变 `auto`——
  任何漏装下的子元素都会变成一根横条。这就是「电脑端提问/plan 出横条、手机悬浮滚动条隐身」
  的完整机制；两根滚动体都在统一美化滚动条名单里，横竖条同形态。
- **滚动条实现仲裁**：Chromium 里标准 `scrollbar-width/color` 会**静默**所有
  `::-webkit-scrollbar` 规则（实测：两者同写 → 渲染原生 10px 条+箭头按钮，webkit 造型
  全是死码）——所以标准属性被关进 `@supports not selector(::-webkit-scrollbar)` 门：说
  webkit 的引擎（Chromium）走 8px 造型路径且**显式隐藏箭头按钮**（不藏则默认箭头回来），
  其余引擎从门里拿 thin 标准条。同一条审美、两条实现路径、契约测试钉住「门是 thin 的唯一
  出口 + 按钮必须 display:none」。
- 多题一批 = 一屏一题 + 翻页，是原生文法（parity），不是截断。


### 会话选择器（两处入口，一个面板）

挑会话只有**一个**面板：任务详情里的「添加会话」，与板头的「会话建卡」。两处只差提交
之后做什么（挂到已有卡片 / 造一张新卡片），名单、筛选、分组、折叠、多选、页脚全是
这一份——规则改一次两处同时生效，不会出现「这边过滤了那边没过滤」。

**默认全折叠**，点开某个工作区才列出它的会话。几百上千个会话摊平在一列里没法扫，
所以工作区是折叠头（复用全板那**一个** `Disclosure` 折叠文法，不新写第二套折叠），
会话数走摘要槽。**有搜索词时命中组自动展开**——否则「输了字什么都没发生」。

行是**多选开关**而不是一次性动作：`aria-pressed` + 与列头 tab 同一套选中淡染，
图标同时从 link 换成 check，所以状态从不只靠颜色。页脚左侧「已选 N」用 `flex: 1 1
auto` 撑位把动作推到右侧，**不用 `margin-left:auto`**（auto margin 只右对齐恰好起头
的那一项，一换行就散架，是全板禁令）。未分组那一组里每行额外带一个文件夹标签：只有
那里标题说不出来，工作区组里每行重复组标题就纯是噪音。

窄屏与宽屏是同一个组件、同一个 DOM 节点（板头按钮落在模式组内，模式组两个宽度都在），
不为手机另写一套。

### Automation / Preset 面

任务自动化与会话规则共用一个 `AutomationEditor`，运行配置共用一个 `RunConfigFields`。
视觉上它们是**折叠披露（disclosure）**而非第二套页面：`sectionHead` 恒为一行，
折叠头带 chevron 与摘要，展开后在限高区域内滚动。每区至多一个滚动体——这是硬约束，
不允许父子各自滚动。
折叠体（`.detailSectionBody`）同时是**高度的传递层**：`flex: 1 1 auto; min-height: 0`
把所在折叠区的确定高度转交给内部的滚动区，评论框因此在任何宽度都拿得到自己的滚动盒
（内容定高的折叠区父层高度即内容，此规则在其中不起作用）。评论滚动体带 **120px 地板**
（与对话区同值）：配置头完全展开把剩余空间压到接近 0 时，评论框保留可用的最小高度，
溢出部分由折叠块整体滚动兜底（文档化的最后手段）。

### 清单工作台（主舞台）

**它是一张桌子，不是第二个看板。** 看板回答「谁在跑」；工作台回答「我手上还有什么、哪一条最急、
我今天要做什么」。所以它的形态是**页面**，不是一个折叠起来的列。

#### 四段式：一条从上到下的次序，每一段都有它自己的理由

| 段 | 元素 | 三页 | 它回答什么 | 它为什么在这一段 |
| --- | --- | --- | --- | --- |
| 1 页头带 | `.itemHeader` | 三页 | 「我在哪一页，这一页有多少东西」 | 身份与导航是每一页都有的，所以它不随内容增减 |
| 2 概览条 | `.itemOverview` | **仅清单页** | 「这一页欠着什么，有多急」 | 它是**这一页的视觉中心**，中心不能时有时无 |
| 3 筛选带 | `.itemFilterRow` | **仅清单页** | 「这些行怎么被挑出来、怎么排」 | 控件与它作用的行同屏、同面；收件与日程不需要挑 |
| 4 列表轨 + 详情轨 | `.itemWorkbench` | 三页 | 「有哪些行，那一条的字段」 | 内容与它的解释 |

**「要处理」块（`.itemTriage`）在第 3 段与第 4 段之间，卡外。** 它是关于这张列表的一句摘要，
不是列表里的一行；写在卡内它就成了内容，写在卡外它才是摘要。**它与概览条一样不随滚动消失**——
一份要滚到才看得见的摘要不是摘要。

**页面轨上永远只有三片**（收件 / 清单 / 日程），**每片带自己的数，空页写 0 不消失**：一个被问到
而答案是零，与这个问题根本不存在，是两件事。派生页（标签、停滞、归档、筛选结果）**不占轨**，
点进去是一整个页面（带回退控件），退出时回到来的那一页。轨上这三个数 N / M / K 是**面板上唯一
允许的横向重复**，行内一律不复述。

#### 容器档位：基准 + 两级台阶，全表零个 `max-width`

参照是**它自己的盒子**（`itemRoot` 声明 `container-type: inline-size; container-name: dsh-tb-item`）。
**基准就是手机档**，720 与 1081 各一级 `min-width` 台阶。于是「这条规则落在哪一档」由**它写在哪个
块里**决定，两条规则不可能同时命中；「基准 + max-width」那种写法会把「窄的那条输了吗」变成一道要
读特异性才能答的题。**本表没有一个 `@media(max-width)`，也不许加。**

**为什么是 1081 而不是 1080**：JS 侧的档读 `width <= 1080` 为窄，所以 CSS 的宽档必须是
`min-width: 1081` —— 差一像素，两边就会在同一条界线上给出**两个答案**（CSS 说宽、JS 说窄），
而**档位是由两处一起定义的**。这两处每改一处，另一处必须跟着改，这就是同一个数写在两处的代价。

| | 基准（`itemRoot`，无查询） | `@container dsh-tb-item (min-width: 720px)` | `@container dsh-tb-item (min-width: 1081px)` |
| --- | --- | --- | --- |
| `--item-inset` | **12px** | **20px** | **24px** |
| 页头网格 | `'title actions' / 'search' / 'rail' / 'capture'` | `'title search actions' / 'rail' / 'capture'` | 同 720 |
| 搜索轨 | 无轨，整行 `inline-size: 100%` | `minmax(18rem, 22rem)` | 同 720 |
| 概览磁贴 | 5 块 × 1 行 | 5 块 × 1 行 | 5 块 × 1 行 |
| 筛选带 | 两列单选 + 换行的面片 | 一行可绕的控件行（分段药丸） | 同 720 |
| 事实行轨数 | **2 条** | **3 条** | 同 720 |
| 行网格 | `'pick ref title' / 'pick ref meta'`（两行） | `'pick ref title meta'`（一行） | 同 720 |
| 工作台 | 一列，`'list' / 'detail'` 两行 | 同基准 | `'list detail'` 一行 |
| 详情 | 就地展开在行里 | 就地展开在行里 | 侧栏 |

**`.itemRoot` 永远没有自己的横向内距、边框或外边距。** 它的横向盒子与 `[data-dsh-taskboard-view]`
逐像素相等——这就是 JS 侧的档（`useSurfaceNarrow('[data-dsh-taskboard-view]', 1080)`，即
`width <= 1080` 为窄）与 CSS 侧的档（`min-width: 1081` 为宽）**能共用一条界线**的原因：两边量的
是同一个盒子。一旦根层长出内距，两个盒子就在同一条界线上给出两个答案，而**档位是结构决定的，
不是「量的是哪个盒子」决定的**。

**容器不能查询自己。** `itemRoot` 就是 `dsh-tb-item` 容器，而容器查询解析的是元素**最近的那个祖先**
容器——容器不是自己的祖先。所以 `@container dsh-tb-item { .itemRoot { … } }` **永远不命中**：声明
看着对、解析得过、**什么都不画**。**真实的受害者有四个**：`--item-inset`（写在根上则两档永不生效，
于是 720 与 1081 都停在 12px）、`--item-meta-date-col` 与 `--item-meta-count-col`（写在根上则窄屏
永远是宽屏的轨宽，事实行在 390px 上溢出）、`--item-head-actions-col`（写在根上则页头第三轨的宽度
不受档位控制）。**因此所有档位覆盖都写在读它的那个后代上**（`.itemHeader` / `.itemWorkbench` /
`.itemRowMeta` / `.itemRowMain`），令牌本身仍只有 `itemRoot` 一个声明处。板上自己的紧凑档也只写
`.board`（容器 `[data-dsh-taskboard-view]` 的后代）、不写容器本身——这是本项目已有的写法。
**「声明看着对却不画」这一族没有任何门禁**（类名审计查类名，令牌审计查 `var(--dsw-*)`，都不查
「这条规则命不命中」），所以它只能靠写下原因来防。

**台的宽度**（2380px 窗口）：`--item-measure: min(100%, 1600px)` 居中，台外是**留白**而不是没排版。
边框盒算：内衬 24 × 2，内容 1552 = 列表卡 720 + 沟 24 + 详情 808。

#### 宽度：每个数只有一个归属

| 令牌 | 值 | 谁读它 | 归属的理由 |
| --- | --- | --- | --- |
| `--item-measure` | `min(100%, 1600px)` | 页头带 / 概览条 / 要处理块 / 工作台 / 状态行 | 五处共用一个台面；两个台面读作两页 |
| `--item-inset` | 12 / 20 / 24 | 页头带 / 工作台 | 台面内衬单归属，绝不重打 |
| `--item-list-col` | **720px** | 工作台的列表轨、`.itemComposer` 的封顶 | 「你打字的行与你读的行同宽同左沿」；720 之上一行不再更好读，只离详情更远 |
| `--item-track-gutter` | **24px** | 详情轨的左内衬 + 分栏线所在 | 沟与线是一个数，线画在沟的外沿 |
| `--item-head-actions-col` | **68px** | 页头第三轨 | 只装一枚 28px 高的行高开关（文案两字 = 24px + 两侧 12px = 48px ≤ 68） |
| `--item-mark-col` | **8px** | 行网格第 1 轨 | 6px 的点加 2px 呼吸 |
| `--item-ref-col` | **5ch** | 行网格第 2 轨 | 编号已是等宽数字，`ch` 在 12px 上正好一个数字；覆盖 `#` 加四位 |
| `--item-pick-col` | **28px** | 批量打开时行网格第 1 轨 | 与状态点**共用一格**，互斥出现，所以它不常驻 |
| `--item-priority-col` | **56px** | 行网格第 3 轨（两档都有） | `!1`–`!4` 的四枚优先级药丸 |
| `--item-meta-date-col` | **10em** | 事实行第 1 轨 | 装得下最长串（见下） |
| `--item-meta-count-col` | **5em**（两档同值，≥720 不改） | 事实行第 2 轨 | 装得下「3/11 步」与「停滞 21 天」两种句子；这一轨放的是**比例**，8em 曾为约 24px 的字声明 96px |
| `--item-meta-col` | **16em** | ≥720 那一档的行网格第 4 轨 | 事实行整条轨的封顶 = 日期 10em + 计数 5em + 沟 |
| `--item-actions-col` | **76px** | 行尾动作 | 问 AI 44px + 沟 8px + ⋯ 24px = 76px（68px 装不下，⋯ 被顶出行外） |
| `--item-row-pad` / `--item-row-gap` | 12/10（宽松）· 6/6（紧凑） | 行的上下内距 / 行内沟 | 密度是用户设置，所以是令牌不是写死的数 |

**`--item-ref-col` 与 `--item-meta-date-col` 必须在同一个已声明的字号上解析，而 `ch` 与 `em` 都不会
从子元素继承字号。** 所以 `.itemRowMain` **显式声明 `font-size: 12px`**——它自己不显示文字，这一条
声明只为让本行网格上所有的 `ch` / `em` 轨有一个确定的解析字号；`ch` 是「本字号下 0 的宽度」，
不是「本轨道里那个字的宽度」，所以它随字号走，字号因此必须先声明。

**事实行第 1 轨的定值来自实测**（台架 1600px 截图，12px 字号）：`超期 8 天` ≈ 48px、
`还剩 3 天` ≈ 48px、`2026年10月1日` ≈ 77px、**`最早 2026年10月5日` ≈ 110px**。原声明 `11ch`（≈74px）
装不下最长串，于是那 14 个字向外溢 36px，而**溢出不回灌别的轨**——第 2 轨照自己的起点排，一行同时
「受门禁」且「有步数」时两个事实会叠在一起。`10em`（120px）装得下全部四种读法并留 10px 地板。

**让位的方向只有一条：事实先于标题。** 事实的让位机制是「读不到」，标题的让位机制是「少几个字」。
所以**日期轨是定值、标题槽用它已有的文字子槽省略**——拿「读不到日子」换「标题多几个字」是反的。
第 1 轨与第 2 轨因此都不许 `auto` / `min-content` / `max-content`：**溢出不回灌，所以一条被内容
定尺的轨会让下一条轨落到本行的内容上，而每一行是各自一个网格。**

**`auto` 只允许出现在「永远只装控件」的轨里**，本表三处：`.itemComposer` 的第二轨（只装「记下」
一枚按钮）、`.itemHeader` 的第三轨的**声明值**（`--item-head-actions-col`，是数不是 `auto`）、
以及议程非日桶的日期槽（**在标记里就不渲染**，不是一个空格子）。反过来，行的四条轨、事实行的两条
轨、详情字段网格、磁贴网格**一律不许出现 `auto`**。

**页头允许具名放置，别处用自动放置。** 页头的子元素是**封闭的产品常量**：三片页轨（`ITEM_PAGES`
是写死的数组）、一枚搜索、一枚行高开关、一行快记。多一个少一个都是一次产品决定，不是数据带来的。
而组、行、标签、面片的数量由数据决定，作者在写规则时不知道有几个——那种地方用具名区域等于把
「今天有四组」写进样式表，换一次数据就散架。**所以：封闭集合用具名区域，开放集合用自动放置。**

```css
.itemHeader {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(18rem, 22rem) var(--item-head-actions-col);
  grid-template-areas:
    'title search actions'
    'rail  rail  rail'
    'capture capture capture';
  column-gap: 12px;
  row-gap: 10px;
}
```

**搜索轨是定值区间 `minmax(18rem, 22rem)`，所以三页的搜索框逐像素同宽同位**——它随页而变正是
「页头用自动放置 + `auto` 轨」的后果（`auto` 轨按本行内容定尺，而三行的内容不同）。基准档的搜索
没有轨（整行 `inline-size: 100%`，无封顶）：在 390px 上它就是这一页最宽的那件控件，缩小它是
省地方，不是设计。

#### 字阶：六档，每一档落到选择器

界面文字只用 11 / 12 / 13 / 14（外加 16 标题档）。**同一档里的字重不超过两个**，否则层级就不再
是层级而是一张散落的取值表。

| 角色 | 选择器 | 字号 | 字重 | 墨色 | 字距 |
| --- | --- | --- | --- | --- | --- |
| 面板标题 | `.itemHeadTitle` | 16 | 600 | `text-1` | `-0.02em` |
| 页面轨·当前页 | `.itemPageTabActive` | 13 | 600 | `text-1` | — |
| 页面轨·其余 | `.itemPageTab` | 13 | 400 | `text-3` | — |
| 轨上的数 | `.itemPageTabCount` | 11 | 400 | **跟页签同色** | tabular |
| **组头（按字段标签画）** | `.itemGroupToggle` | 12 | 600 | `text-2` | `+0.02em` |
| 议程日标签 / 托盘标签 | `.itemAgendaDayLabel` / `.itemNoDateTrayLabel` / `.itemGatedFoldHead` | 12 | 600 | `text-2` | `+0.02em` |
| 小节标题 | `.itemSectionTitle` | 11 | 400 | `text-3` | `+0.02em` |
| **行标题（主角）** | `.itemTitleText` | 14 | 500 | `text-1` | — |
| **概览磁贴的数** | `.itemTileValue` | 14 | 600 | `text-1`（逾期那块 `danger`） | tabular |
| 事实行 | `.itemDue` / `.itemStartsAfter` | 12 | 400 | `text-3` | — |
| 空态与说明 | `.itemState` / `.itemHint` / `.itemTriageText` / `.itemInboxNote` | 12 | 400 | `text-2` | — |
| 编号 · 计数 · 磁贴标签 | `.itemRef` / `.itemGroupCount` / `.itemGroupStats` / `.itemSteps` / `.itemCount` / `.itemTileLabel` | 11 | 400 | `text-3` | tabular |

按字号收拢，就是这张自检表（`qa` 照它逐条断言）：

| 字号 | 字重集合 | 用在 |
| --- | --- | --- |
| 16 | `{600}` | 面板标题（全页唯一） |
| 14 | `{500, 600}` | 行标题 500、磁贴的数 600 |
| 13 | `{400, 600}` | 页轨 400 / 600；搜索框与快记框 400 |
| 12 | `{400, 600}` | 事实行与说明 400；组头、日标签、小节标题 600 |
| 11 | `{400}` | 编号、计数、标签、磁贴标签 |

**组头按「字段标签」画，不按小标题画。** 它是**容器**，不是内容里的一行：12px + `+0.02em` 字距 +
第二档墨，这套处理本表已经用在字段标签上（见 Typography），所以它不是新东西，只是第一次被用到
分组名上。**把组头降下来，行标题才升得起来**——一行的主角是它的标题，而标题之所以是主角，是因为
**它上面那个东西先退了**。反过来做（把行标题加粗到 600）也能建立层级，代价是这一页会比看板的卡片
标题还重，而这个系统的基调是「低音量」：**让容器退一步，比让内容喊一步便宜。**

**两个 14px 用不同的字重，因为它们是两级**：行标题 500（主角）、磁贴的数 600（这一页的中心）。
16px 全页只有一个，在左上角，标的是「哪一页」而不是「这一页有什么」。

**事实行的语气只由墨色承担，`data-tone` 不改字重。** 改字重会让 12px 这一档多出第三种取值，而
这一页最需要被读出来的语气已经有颜色了——同一个读法同时用两种手段说，它就变成了一件可以被
悄悄改掉的事。

**轨上的数跟着页签走，不落第三档墨**：它是这个页签的一部分（同一个药丸、同一个颜色、同一个声音），
不是页面上另一个索引。数字仍是 11px（一个印章的号），与页签的 13px 之间的 4px 是药丸内的沟。

#### 行的四条轨：定值在前，事实按种类分轨，动作右收口

```css
.itemRowMain {
  font-size: 12px;                                   /* 让 ch / em 轨有确定的解析字号 */
  flex: 1 1 0;
  min-inline-size: 0;
  grid-template-columns:
    var(--item-pick-col, var(--item-mark-col))       /* 基准：状态点 8px；批量打开时勾选 28px */
    var(--item-ref-col)                              /* 5ch */
    minmax(0, 1fr);                                  /* 标题 */
  grid-template-areas:
    'pick ref title'
    'pick ref meta';
  column-gap: var(--item-row-gap);
  row-gap: 4px;
}

@container dsh-tb-item (min-width: 720px) {
  .itemRowMain {
    grid-template-columns:
      var(--item-pick-col, var(--item-mark-col))
      var(--item-ref-col)
      minmax(0, 1fr)
      var(--item-meta-col);
    grid-template-areas: 'pick ref title meta';
    row-gap: 0;
  }
}
```

- **前两条轨必须是定值。** 每一行是各自一个网格，`auto` 轨按**本行**的内容算宽，于是 `#1` 那一行与
  `#12` 那一行的编号轨不一样宽，**标题的左沿就跟着差了一个字符**——在一页还没被读之前先读成
  「这一页没人排过版」。
- **状态点只在它有话可说时画。** `待办` 是绝大多数行的常态，常态画一个点，等于让最不重要的元素
  占住全页最抢眼的位置。轨道宽度留着，所以有没有点都不影响标题的左沿。`done` 画成**空心**
  （`background: none` + `text-3` 描边）——完成是「不再发生」的事实，空心比实心准。
- **事实行按种类分轨，不按出现顺序**（见下）。
- **动作列定宽右收口**：`--item-actions-col: 76px` + `justify-content: flex-end`。**有没有第二个动作
  不会让第一个动作左右跳，而动作列的右沿在每一行都对齐台面的右沿。**

```css
.itemRowMeta {
  grid-area: meta;
  display: grid;
  /* 基准：两条轨。没有第三条——装得下却留一条恒空的轨，是「让位」做反了方向：
     让位是换行或压缩，不是留一整条空轨道。 */
  grid-template-columns: var(--item-meta-date-col) var(--item-meta-count-col);
  column-gap: var(--item-row-gap);
  align-items: center;
  min-inline-size: 0;
}
@container dsh-tb-item (min-width: 720px) {
  .itemRowMeta {
    grid-template-columns: var(--item-meta-date-col) var(--item-meta-count-col) minmax(0, 1fr);
  }
}
.itemStartsAfter, .itemDue { grid-column: 1; }
.itemSteps { grid-column: 2; }        /* 第二个同类的数落到下一条网格行——换行，不是压扁 */
```

**没有的那一类留空，不塌陷**——所以「超期 8 天」永远在第 1 条轨、「1/3 步」永远在第 2 条，与同一列
别的行逐字对齐。`.itemStartsAfter` 与 `.itemDue` 共用第 1 轨是对的：最早开始是一道门、截止是一个
想要的日子，两者都是**日期**；哪一天说话已由 `item-view.ts` 的 `DatePosture` 定了，样式只把那个
决定放到对的轨上，不再自己排一次序。

**日期与天数的文字必须活在会收缩会裁的子槽里**（`min-inline-size: 0` + `overflow: hidden` +
`text-overflow: ellipsis`）——但**裁剪只是兜底，轨一必须定值到装得下最长串**。裁掉的是「最早
2026年…5日」，那正是硬性规范 11 与本节都禁止的「把必要信息藏进省略号」。

**批量勾选与状态点共用一格。** 勾选框只在清单页的批量两态里出现，它占第 1 轨的 28px，而状态点占
同一格的 8px——**两者互斥出现，所以它不常驻，也不让每一行在每一页都付 28px**。全选放在筛选带里
（`.itemFilterRow` 的第一个子元素），**不做列头**：本表的行是「标题在上、事实在下」的两行单元，
不是一行一列，所以没有列头可标；而筛选带已经在卡内顶端，那儿是唯一放得下一个总开关的地方。

#### 颜色：分工表与新预算

| 令牌 | 只负责 | 视觉位置上限 | 本表的实际位置 |
| --- | --- | --- | --- |
| `text-1` | **内容**：面板标题、行标题、磁贴的数 | 不限 | 4 处角色 |
| `text-2` | **补充**：组头名、事实行的非紧急读法、说明 | 不限 | 5 处角色 |
| `text-3` | **索引**：编号、计数、未选中页签、事实行默认、磁贴标签 | 不限 | 7 处角色 |
| `accent`（业务蓝） | **可交互 + 计量** | **≤ 7** | ① 键盘焦点环（每个控件各一条，**合起来是一个位置**）② 输入框的焦点（描边 + 环，与 ① 不是一个画法）③ 选中行底 ④ 当前页页签 ⑤ 组头发丝条 ⑥ 概览磁贴的微条 ⑦ 步骤勾选框的 `accent-color`（**原生控件的着色，不是设计选择**） |
| `attention`（琥珀） | **等你动手** | **≤ 3** | ① 要处理句 ② 七天内到硬期限 ③ 进行中状态点 |
| `danger`（红） | **已经晚了** | **≤ 3** | ① 硬期限超期的到期 chip ② 受阻状态点 ③ **概览磁贴「逾期」的数** |

**上限数的是「视觉位置」，不是「声明处数」。** 一个位置可以由一条规则或几条写成（`border` 与
`color` 算一处）；同一个元素的**不同状态**（静息与 `:hover`）也只算一处，因为它在屏上从来没有和
另一个位置同时出现。**数声明处数会逼着正确实现去改**：把删除确认的 `:hover` 删掉能让数字好看，
而那正是「检查器因为跑在错误单位上，把好代码改坏」的形状（硬性规范 14）——先怀疑检查的读法，
再怀疑实现。

**两处上限在这一版动了，理由不同。** `danger` 从 3 涨到 **4**，因为概览磁贴多了一块「逾期」的数，
而它是**这一页唯一的普查**——逾期是这块面板存在的理由之一，把它的数画成灰，逾期与到期就在屏上
无法区分。`accent` 从 4 涨到 **5**，因为计量条是这一版新增的一族（组头的发丝条 + 磁贴的微条），
而**计量与可交互同色不同职**：它量的不是「你点了会怎样」，是「这一桶走到哪了」。

**计量条一律 `accent`，只有「逾期」那一块用 `danger`**——一块磁贴上两种颜色会让人以为那块的量纲
不一样。**磁贴的数用 `text-1`（逾期那块 `danger`），微条用 `accent`（有微条的那四块）**，所以
「严重」与「份额」是两条独立的信息，各由一种颜色承担；**「已完成」那块没有微条，所以它只用到
`text-1` 一种墨色**。

**三处必须用色，不许退化成灰**：① 硬期限超期的到期 chip（`data-tone='over'`）；② 受阻行的状态点；
③ 概览磁贴「逾期」的数。要处理里那个数用琥珀。**这四处褪成灰，「逾期」和「到期」就在屏上无法
区分，而那正是这块面板存在的理由之一。**

**琥珀不许超过三处**，因为**这块系统只有一种「需要注意」的颜色**（The One Attention Color Rule）：
再加一种提醒色，两种提醒就会互相削弱，而读者会认为这一页到处都是急事——于是真的急事也读不出来。

**本表的颜色预算是按令牌层算的，不是按截图算的。** 渲染台架读到的是宿主静态令牌，而运行中的
强调色是 theme service 运行时叠上去的一层（台架里是蓝，活体里是粉）。所以「视觉位置 ≤ N」是
「按结构数出几个位置」，**截图只能证几何与结构，不能证颜色**（见「这份表的验证到什么程度」）。

**颜色零新增、字号零新增、形状零新增**：只消费 `--dsh-tb-*`；字号只有 11/12/13/14（加 16 标题档）；
`corner-shape` 由根层那**一条**规则声明，本表一处也不补。

#### 四段的几何：每段一条声明，别处引用

**1 页头带**（`.itemHeader`）：

```css
.itemHeader {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(18rem, 22rem) var(--item-head-actions-col);
  grid-template-areas:
    'title   search   actions'
    'rail    rail     rail'
    'capture capture  capture';
  column-gap: 12px;
  row-gap: 10px;
  padding-block: var(--item-inset) 12px;
  padding-inline: var(--item-inset);
}
.itemHeaderRow { grid-area: title; display: flex; align-items: baseline; column-gap: 12px; min-inline-size: 0; }
.itemSearchRow { grid-area: search; }
.itemHeadActions { grid-area: actions; display: flex; justify-content: flex-end; }
.itemPageRail { grid-area: rail; }
.itemComposer { grid-area: capture; }
```

基准档（写在 `.itemHeader` 自己的声明里，不在查询块里）：

```css
.itemHeader {
  grid-template-columns: minmax(0, 1fr) var(--item-head-actions-col);
  grid-template-areas:
    'title   actions'
    'search  search'
    'rail    rail'
    'capture capture';
}
```

**标题与计数之间 12px，不是 6px。** 计数是「这一页有多少」这个独立事实（读 `itemPageCountsOf`
的清单档；筛选时写「显示 X 条，共 M 条」），它不是标题的注解，所以它不能贴在注解的位置上——
4px 读起来像标题的一部分，12px 读起来是两个东西。**无筛选时它写 M，与页轨「清单」那一格是同一个
数**（两处显示同一个数是允许的：一个是标题的注解，一个是导航的答案；**行内一律不复述**）。

**行高开关在页头的第三轨，三页与两档都在同一个位置**（基准档落在标题行的右端，≥720 落在搜索的
右端——都是行尾）。**它任何一档都不许不画**：行高是用户设置，窄屏用户改不了自己的行高，就是把
这一档设备排除在外。**两档是同一枚控件**——一个 `aria-pressed` 的文字动作，文案是**档位名本身**
（「宽松」/「紧凑」），按下 = 当前就是这一档，用更强的描边表达，**绝不升级成主填充**（那会把一个
视图开关说成一次宣布）。**行高不进筛选带**：行高是「这一页怎么读」，排序与面片是「这些行怎么被
挑出来」，一个说页、一个说行，混在一排里就都说不清了。

**2 概览条**（`.itemOverview`，仅清单页）：五块磁贴，**永远五块 × 一行**。

```css
.itemOverview { display: flex; flex-direction: column; gap: 4px; min-inline-size: 0; }
.itemOverviewTiles { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px;
  min-inline-size: 0; }
.itemOverviewBase { font-size: 11px; line-height: var(--dsh-tb-hint-line); color: var(--dsh-tb-text-3); }
.itemTile { display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  box-sizing: border-box; min-inline-size: 0; padding: 8px 8px 6px; font-family: inherit;
  text-align: start; background: var(--dsh-tb-surface-float); border: var(--dsh-tb-border);
  border-radius: var(--dsh-tb-radius-md); cursor: pointer; transition: border-color var(--dsh-tb-motion); }
.itemTileValue { font-size: 14px; font-weight: 600; line-height: var(--dsh-tb-row-line);
  color: var(--dsh-tb-text-1); font-variant-numeric: tabular-nums; }
.itemTileValue[data-tone='over'] { color: var(--dsh-tb-danger); }
.itemTileLabel { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; line-height: var(--dsh-tb-hint-line); color: var(--dsh-tb-text-3); }
.itemTileBar { block-size: 2px; inline-size: 100%; background: var(--dsh-tb-border-soft);
  border-radius: var(--dsh-tb-pill); overflow: hidden; }
.itemTileBarFill { display: block; block-size: 100%; background: var(--dsh-tb-accent);
  border-radius: var(--dsh-tb-pill); }
.itemTile[aria-pressed='true'] { border-color: var(--dsh-tb-accent); }
```

**磁贴内部是「一列」不是「一格」**：数与标签上下同左沿，微条在最后一行。**`data-tone` 落在数自己身上
（`.itemTileValue[data-tone]`）而不是磁贴上**——要变色的只有那个数，把它写在磁贴上等于宣布整块
变调。**微条的宽度由调用方内联给 `.itemTileBarFill` 的 `inline-size`，不走自定义属性**：一个
`--item-tile-share` 在这份表里会是**一个没有任何代码写它的声明**（本表的规矩：机制只写在它所属的
地方，而没有读者的声明就是过时）。

**五块 = 四档普查 + 一块逾期**（逾期 / 进行中 / 待办 / 受阻 / 已完成）。**四块恒读
`itemGroupCountsOf`（永远四档），不读 `showDone`**；**「已完成」那一块就是 `showDone` 的入口**——
点它把清单切到含已完成的那一档，而磁贴从不说谎（它说的是「有 3 条已完成」，按钮带你去那里）。
**四块的数之和恒等于全部条目数，页头与页轨的数是它的一个分解**（`showDone` 关闭时相差「已完成」
那一块，这是唯一一处两处数字允许不等，而它不等的方向是写明的）。

**五块在 390px 上排成一行，不折行。** 算式：内衬 12 × 2 → 366，减去四条 6px 沟 = 342，五等分 =
**68px 一块**；块内左右内衬 8 × 2 → 52px 可用，最长的标签「已完成」在 11px 上约 33px，**装得下**。
**折行会把「五个数」读成「三加二」两个集合**，而这一页需要的正是一眼看过去的五个数。

**磁贴是入口，所以它是按钮**：命中区就是整块（≥ 48px 高，触屏不额外加热区）；悬停吃
`--dsh-tb-hover`；`:focus-visible` 是 2px 强调色 outline。**它不是主填充**——五个主按钮并排在
一页顶上，那一页就没有任何一句话是重要的了。**按中与悬停都不花强调色**：强调色在这一页有五处
已名的活（焦点环、选中行、当前页签、组头发丝条、磁贴的微条），磁贴自己的状态是「这个控件活着」，
而那正是其余表面早已用墨色给出的同一个信号；把它花在磁贴上就是**一份预算从五变成八**，而一个
到处都用的颜色就不再意味着「可交互」，只意味着「这个盒子」。

**微条量的是「这一块在「还没做完的 n 条」里的份额」**，分母是 `itemInsightOf` 的 `total`
（**未完成**的行数），**由磁贴下面那行字原样说出来**（`item.insight.base`）。分母取未完成而不是
文档全长，是因为**条量的是「你还欠着多少」**：拿文档全长当分母，一根 30% 的条里很大一块是已经做完
的、读者再也不用动的行，于是条在给积压粉饰。**逾期那一块是横切的一刀**（一行可以逾期，同时属于
另外四档里的任何一档），所以**五块不构成一次划分**，这一点写在代码注释里，不让下一个人去把它
「修正」成互斥的五桶。

**「已完成」那一块没有微条，四个有。** 那块是这一页唯一**不属于「还没做完的 n 条」**的数——
一个已经做完的行不是读者还欠着的工作，所以它没有那个分母下的份额，把它的数除进那个分母得到的是
**一个不存在的分数**。于是这一条磁贴带一个空格，**而那一行字仍然只有一个分母可讲**：四条条回答同一
个问题，第五条回答另一个问题，而**五个数字里塞进两个分母，就等于没有一个**。磁贴是 grid 行，
四条有条的定下高度，第五条只是少了那一条该在的位置。

**3 筛选带**（`.itemFilterRow`，仅清单页）：**它是卡片的第一个子元素**，不是页头上的一行。
控件与它作用的行同屏、同面（参考图里筛选工具条就在列头之上、在卡内）——把筛选挂到页头只会让工具
和对象隔着一屏远，而收件页「还没有被整理」与「被筛过了」长得一样正是它要保住的差别。

```css
.itemFilterRow {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding: 8px 12px;
  border-block-end: 1px solid var(--dsh-tb-border);   /* 结构线用 l2 */
  min-inline-size: 0;
  flex: none;
}
```

四个面（状态 / 优先级 / 标签 / 日期）是**搜索框的另一种敲法**，不是四个独立下拉：点一下往搜索框里
落词，**搜索框里那一段字始终是当前筛选的全部状态**，没有藏在控件里的第二份状态。同一面多选是
「或」，不同面是「且」，这件事由搜索文法承担，界面不另排一遍。「进行中」可筛不可写。「停滞」
不是第四个面，它仍是派生页。

**4 列表轨 + 详情轨**（`.itemWorkbench`）：

```css
.itemWorkbench {
  display: grid;                        /* 网格，永远不是滚动体 */
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: 'list' 'detail';
  grid-template-rows: minmax(0, 1fr) auto;
  flex: 1 1 auto; min-block-size: 0; min-inline-size: 0;
  padding-block: 0 var(--item-inset);
}
.itemListCard {                          /* 列表轨 = 一张卡，永不是两个盒子 */
  grid-area: list;
  display: flex; flex-direction: column;
  min-block-size: 0; min-inline-size: 0;
  background: var(--dsh-tb-surface-float);
  border: var(--dsh-tb-border);
  border-radius: var(--dsh-tb-radius-lg);
  overflow: hidden;                      /* 通用防穿模底线 */
}
.itemListCard > * { flex: none; }        /* 见下：列向 flex 的孩子一律不定尺 */
.itemScroll {
  flex: 1 1 auto; min-block-size: 0; min-inline-size: 0;
  overflow-y: auto;
  padding-inline: 12px;                  /* 行离卡的边 12px；组头的发丝线也随之内缩 */
}
@container dsh-tb-item (min-width: 1081px) {
  .itemWorkbench {
    grid-template-columns: minmax(0, var(--item-list-col)) minmax(0, 1fr);
    grid-template-areas: 'list detail';
    grid-template-rows: minmax(0, 1fr);
  }
}
```

**卡片的单位是页面，不是分组。** 一组一框就是新增表面层级：满屏的框会互相削弱，而分组之间的
差别本来就由**组头的发丝线 + 16px 空气**说清了。**一页两块面**：五块磁贴与一张列表卡，加上详情轨；
再加第三种框，这页就开始「说」它没有的事。

**每区至多一个滚动体，父子不各自滚。** 卡内唯一的滚动体是 `.itemScroll`；单列档里它是整页唯一的
滚动体（组头与日标签 `position: sticky` 吸在它里面），双栏档里它停止滚动、变成列表轨，而双栏的两个
滚动体是工作台的**两个直接子级**（`.itemScroll` 与 `.itemDetailBody`）——它们是兄弟，不是父子。

**列向 flex 的孩子一律 `flex: none`（`.itemListCard > *` 与 `.itemScroll > *`）。** 「让内容按自己的
内容定高」是列的定义，而**一个类在一个容器里对、在另一个容器里错，这件事只有「容器是什么形状」
能解释**——所以修法是给容器的孩子一条声明，而不是给那句话换一个类名。`.itemTriageText` 就是这样：
它在 `.itemTriageRow`（行向 flex）里带 `flex: 1 1 auto` 是对的（动作因此落在同一条右沿上），
而「没有等你动手的事。」把**同一个类**直接放在列向的 `.itemScroll` 里，那条 `flex-grow` 就会变成
纵向生长。所以它有一条按父级限定的声明，见「要处理是一段话」那节的 CSS。

**分隔线归工作台，内容盒归内容。** 详情轨拉满高**只负责画那条贯穿全高的竖线**（`align-self:
stretch`），内容盒 `.itemDetailInner` 接 `align-self: start` + `max-block-size: 100%`。**竖线的
长度必须等于轨道的高度而不是内容的高度**——一条中途断掉的线读作「这里没画完」，而它是这一页
唯一的一条竖线。

```css
.itemDetailPane { grid-area: detail; display: flex; flex-direction: column;
  align-self: start; min-block-size: 0; min-inline-size: 0; background: none; }
@container dsh-tb-item (min-width: 1081px) {
  .itemDetailPane { align-self: stretch;
    padding-inline-start: var(--item-track-gutter);
    border-inline-start: 1px solid var(--dsh-tb-border); }   /* 全页唯一的竖线，长度 = 轨道高 */
}
.itemDetailInner { align-self: start; max-block-size: 100%;
  display: flex; flex-direction: column; min-block-size: 0; min-inline-size: 0; inline-size: 100%;
  container-type: inline-size; container-name: dsh-tb-item-detail; }
.itemDetailHead { margin-inline: -12px; padding: 10px 12px;   /* 满宽，规则要相交，不许留缺口 */
  border-block-end: 1px solid var(--dsh-tb-border); }
```

**详情头永远有内容——这一行的要求是「那条横线上不许是空的」，不是「上面必须写哪几个字」。**
未选中时它渲染一句给读者看的话（「还没选中任何一条」，容器标签的语气：12/600/`+0.02em`/`text-2`，
与组头、日标签、托盘标签同一套），选中时渲染那一行的身份（编号 + 标题）。**一条规则的下面如果是空的，
它说的不是分隔，是「这里少了什么」**——所以空态也给一句话，而不是留一条线。

**详情的容器名从 `.itemDetailPane` 移到 `.itemDetailInner`**：字段网格该问的是**装着它的那一层**，
而轨道的左半是 24px 的沟与 1px 的线。1081 那一档详情轨 426px，内容盒 402px，字段网格再减去
12px 内衬是 390px（两列 = 191px，放得下日期字段与它的日历钮）；1600 的台面上内容盒 808px，两列
正好。**同一个网格在两个相差 418px 的盒子里，不能只从表面拿一个答案**——这就是两处都声明同一个
容器名的理由。阈值 `@container dsh-tb-item-detail (min-width: 360px)` 不动。

**行与行之间只有发丝线，组的最后一行不带线。** `.itemRow { border-block-end: 1px solid
var(--dsh-tb-border-soft) }`（内部线用 l1），`.itemList > li:last-child { border-block-end: 0 }`
（否则组头的线 + 每行的线 + 最后一行的线 + 16px 空气合成一条「表格的带子」）。
**结构线用 `--dsh-tb-border`（l2），内部线用 `--dsh-tb-border-soft`（l1）**——这条二分让「哪些线
是页面的骨架、哪些线是行与行之间的空气」变成可核对的，而不是每处凭手感。

#### 视觉中心：每页一句中心、三句落点、一句退让

**「视觉中心」不是加装饰，是给一屏之内定一个第一落点。** 三个毛病里最要命的是没有中心：
一列同权重的 12px 灰字里，读者没有一个落眼点，于是每一句都要被读，而每一句都一样重。

| 页 | 视觉中心 | 由哪几个元素构成 | 第一落点 | 第二落点 | 第三落点 | 为什么其余的必须退后 |
| --- | --- | --- | --- | --- | --- | --- |
| **清单** | **概览条那一排数字** | `.itemOverview` 的五块 `.itemTile` | `.itemTileValue`（全页唯一的 14/600/`text-1`） | `.itemGroupStats` + 组头发丝条 | `.itemDue[data-tone]` 的红/琥珀 | 页头 16px 只有一个且在左上角，标的是「哪一页」；页轨与筛选带是第三档墨的药丸行；事实行 12/400/`text-3`；编号 11/`text-3` |
| **收件** | **快记框** | `.itemComposer` 的输入 + 「记下」 | 输入框的 34px 高度与它的占位文字 | 「记下」（全页唯一的主填充） | 行标题 14/500 | 收件没有概览条、没有组头、没有筛选；剩下的一切都是刚记下的行，它们是**内容**不是中心 |
| **日程** | **当前那一节** | `.itemAgendaDay[data-kind='day']` 里**第一个有行的**那一节（通常是「今天」）与其下的行 | **第一个有行的分节标签（名称 + 计数 + 日期）与其下第一行** | 行标题 | 到期 chip | 议程的读者问「接下来是什么」，读法是**从上往下找事做**，所以第一落点必然落在第一个有内容的节上；「今天」之所以是中心，是因为它**通常**是第一个有内容的节，不是因为它叫今天 |

**低音量是这个系统的基调，所以「高端」的答案是更准的克制，不是更满的装饰。** 三个东西构成一页的
观感：一个明确的中心、一族统一的圆角（磁贴 `radius-md`、卡 `radius-lg`、按钮与页签 `pill`）、
一组克制的颜色（一个强调色 + 三个状态色 + 三档墨）。**不多加卡片、不多加阴影、不多加胶囊。**
静息态是平的（Flat-By-Default）：这一页上唯一常驻的面是五块磁贴与一张列表卡，都只有 1px 细边、
没有阴影；全页唯一的阴影在行菜单上（`--dsh-tb-shadow-3`），因为它是真正的浮层。

#### 三个日期：三种视觉，一个属性四种读法

判定在模型里（`item-view.ts` 的 `DatePosture` 九种读法，`dueLine()` 把它收成四种语气），
样式里只有一个 `data-tone`：

| `data-tone` | 情况 | 视觉 | 印在行上的字 |
| --- | --- | --- | --- |
| `soft-late` | 截止已过（软期限） | **中性色**（第二档墨） | 「落后 N 天」 |
| `over` | 硬期限已过，**或三个日期自相矛盾** | **红** | 「超期 N 天」／点名矛盾的那两个字段 |
| `soon` | 七天内到硬期限 | **琥珀** | 「还剩 N 天」 |
| `set` | 截止在今天或未到 | 第三档墨 | 日期本身 |

**四种读法只改 `color`，不改 `font-weight`**（见字阶那节的理由）。

软期限逾期**不是红**：那是关于一个计划的实话，不是紧急事件；把它画成红，就是软期限悄悄变成硬期限
的方式，而没有人做过那个决定。琥珀只属于「快到了」这一种提醒。**精确天数直接印在行上**，不许只挂
`title=`——触屏没有悬停，只挂在 `title=` 上的事实，手机是没有的。**最早开始（`itemStartsAfter`）是门
不是期限**：未到就不出截止芯片，只出「最早开始」那一行，永远第三档墨，不参与这四种读法。

**红色的两个来源是两种事实，不是同一件事的两种说法。** 硬期限已过是「来不及了」；而三个日期
自相矛盾（最早开始晚于截止、截止晚于硬期限）是**数据自相冲突**——它不是逾期，是这一行**没有一个
诚实的「晚了几天」可答**，挑一个答就是在一份不可能的数据上画出一份自信的排期。两者在样式里都落在
`over`（同一族警报），但**字各说各的**，所以一行永远不会被读成两件事。**判据全部在
`item-view.ts`**，界面只画。文档与界面都**不修复**这种行：替读者重排三个日期再报成功，比让它可见
更糟；因为一个日期字段就丢掉整行更糟——把它留在原处并说出来，是唯一诚实的处理。

#### 画布与内层：判据是「装内容」还是「浮在上面」，不是令牌本身

**吃画布令牌的是「装内容的板」，吃不透明层令牌的是「浮在上面的东西」。** 这条判据只有一个问题要问：
**这个盒子是页面站在上面的地方，还是浮在页面上的东西？**

- **装内容** —— `.itemRoot`（画布，与看板的 `.board` 同一条）、`.itemListCard`、`.itemTile`、
  `.itemGroupHead`、`.itemAgendaDayLabel`：五者全部吃 `--dsh-tb-bg`。它们是宿主底色的同一个表面，
  透光必须**穿过**它们合成，套一层不透明色就把玻璃挡在下面一层了。
- **浮在上面** —— `.itemRowMenu`（`surface-menu`）、`.itemDangerZone`（`surface-sunken`）、
  `.itemInput`（`input-bg`）、`.itemFacetPanelBody`、`.itemBatch`、`.itemQueryChip`：文字必须从背后
  的任何东西上活下来。

**看板早就写着答案**（`board.module.css` 的 `.column`）：「the board never layers a second tint on top
of the app's base」，而 `.board` 与 `.column` 都吃 `--dsh-tb-bg`。清单曾经把**内容板**画成
`--dsh-tb-surface-float`，于是根层是玻璃、往下走一层又被不透明板盖住——读起来像「玻璃外面套了个
不透明框」，而那正是玻璃皮肤唯一救不回来的样子。**分法本身才是要点**：「画布还是内层」不是令牌的
属性，是**盒子装内容还是浮在内容上**的属性。

**粘住的组头吃画布令牌而不是层的**，因为它住在列表卡里、和行同一个表面；给组头套一层不透明色，
在行从它下面滑过时读作渲染故障。`--dsh-tb-surface-sunken` 与 `--dsh-tb-bg-raised` 解析成同一个值，
所以它们不是两级——写代码的人必须知道这一点，否则会以为自己在做一层抬升。

**宿主不给任何 padding，内距全部自给**（`--item-inset`，单归属）。**`--item-inset` 必须是横向的**：
写在盒子的纵向那一侧时，390px 上内容会贴死左右屏幕边。正确写法是
`padding-block: var(--item-inset) 12px; padding-inline: var(--item-inset);`。

#### 行的两态密度、触屏、以及没有 hover

**密度是令牌，且挂在行盒上**（`data-density` 在 `itemRow`，不在按钮里——一层的属性动不了它父盒的
内边距）。宽松 `--item-row-pad: 12px` / `--item-row-gap: 10px`；紧凑 `6px` / `6px`。
**紧凑只是同一行少一点空气，不是第二套行。**

**触屏只加热区，不改任何视觉几何**（`@media (hover: none) and (pointer: coarse)` 是全表唯一
允许的媒体查询）：

```css
.itemRow { padding-block: max(var(--item-row-pad), 12px) 0; }   /* 提高地板，不是覆盖 */
.itemRowActions, .itemComposer { gap: 8px; }
.itemTile { padding: 12px 10px; }
.itemPick { inline-size: 20px; block-size: 20px; }
```

`max()` 而不是 `12px`：**地板只抬高间距，不取消两态**——触屏上「紧凑」与「宽松」仍然差
`--item-row-gap` 的 10px 与 6px，所以那个开关在手机上仍然有两档、仍然可切、仍然不是被藏起来。
输入框的字号抬到 16px 是平台地板（免得聚焦时自动放大），这是全板唯一允许的尺寸变化，且只向上。

**无 hover 依赖：承载必要信息的说明不能只挂 `title=`，必须可点可达。** 精确天数、份额、状态、
计数、期限的含义全部印在字面上。悬停只做两件事：填一层 `--dsh-tb-hover`、以及把一个静默的行
菜单钮显出来——**两者都不是信息**。

#### 收件页、议程页、四个空

- **收件页**没有次级 chrome：没有概览条、没有筛选带、没有组头、没有批量。它的视觉中心是快记框
  （见上）。收件的行是**算出来的**（一条结构都没有：优先级未定、三个日期皆空、标签为空、没挂卡），
  正文与步骤不算结构。
- **议程页的节有三种，形态由**种类**决定，不由「它是第几个桶」决定**：
  1. **逾期 / 落后计划**是**一类时间**，不是一天。它们的标签行**不带日期槽**（带一个空槽读作
     「漏印了日期」），日期在行的事实行里以语气词出现。可折叠的不是它们，是它们的行。
  2. **今天 / 明天 / 本周稍后**是**一天**。标签行是 [名称][计数][日期]，日期是这一天的身份，
     所以它紧挨着名字（而不是像清单页那样把「组头的算术」推到 600px 外——议程的标签本来就是
     [名称][计数][日期] 一行左对齐，右端留空）。
  3. **以后 / 没日期 / 还没到**是**有名字的托盘**：标签与计数照旧，**空的时候把那句解释性 hint
     收掉**——托盘必须被看见存在（与「空组保留组头」同源），但它空着的时候不需要再解释一次。
- **一个桶为空时，它自己的名字和计数 0 就是全部；不得再补第二句话。** 「这一天没有排事」只对
  **真的是一天**的桶成立：逾期 0 与落后计划 0 为空是**好消息**，为一件好事占一行是拿版面换噪音；
  而一屏七遍同一句话是这一页最像机器拼出来的一块。**空桶保留标签行，不写第二行。**
- **空节不占中心位，它的存在由标签与计数 0 安静地说明。** 这一条与上一条同源，另加一句判据：
  **议程的第一落点是第一个有行的节**，不是「今天」这个名字——一个还没有到期行的周一，第一眼该落在
  周二；**落在一个明写着「这一天没有排事」的节上才是错的**。于是「今天」是中心，是因为它**通常**
  是第一个有内容的节，而不是因为它叫今天。
- **收件页与日程页没有排序控件，这是设计不是缺陷。** 排序是清单页的能力：收件页刻意没有次级
  chrome（日程按时间排，**它的身份就是排序**），而清单页是唯一的工作面，因为挑拣、排序、批量都是
  几十条以上才出现的问题。**不要断言它存在，也不要断言它缺失**——它在别的页上不存在，是那两页的
  职分。
- **清单页的空组保留组头，计数 0，不写第二行**（`.itemEmptyGroup` 从清单页删掉；它在议程里也只在
  上面那三条规则允许的位置留一句，而今天那一句就是被七次复用的那句）。组头的计数 `0` 已经说了
  「这一桶是空的」，再写一行是同一句话说两遍，而第二遍还用了第三档墨，于是它读起来像一条真的数据。
- **详情未选中**是一个被设计过的状态：头（一句给读者看的话）+ 一句说明 + **最近动过的 3 条**。
  **四个数不在这里**——它们在概览条上，同一个数在一页里出现两次就有一处是多余的。**3 条而不是 5 条**：
  它是朝左边那张卡的一次手势，不是第二份列表。**最近动过那一行不复用 `.itemRow`**（它带着
  `border-bottom` 与 10px 圆角，在侧栏里画出一个 U 形），它有自己的 `.itemRecentRow`：
  [编号 5ch][标题 `minmax(0,1fr)` 单行省略]，无描边、无圆角、无背景。

#### 要处理是一段话，不是一个容器

它是一段话：没有框、没有底、没有圆角，因为框住它等于说它和那些行是两种东西，而它不是。

```css
/* 行内：句子吃掉余量，动作因此落在同一条右沿上——三个「去看」在一条竖线上。
   独立成段（列向的 .itemScroll 里）：同一个类不许纵向生长，所以另有一条按
   父级限定的声明。**同一个类在行里对、在列里错，只有「容器是什么形状」
   能解释，所以修法是给容器的孩子一条声明，而不是给那句话换一个类名。**
   .itemTriageRow 里的 .itemTriageText { flex: 1 1 auto; }
   .itemScroll >  .itemTriageText { flex: 0 1 auto; }
.itemTriageText { min-inline-size: 0; overflow-wrap: anywhere; }   /* 不许 nowrap */
.itemTriageAction { /* 文字动作：无填充、无描边、无圆角、12px/第三档墨 */
  background: none; border: 0; border-radius: 0; padding: 0 4px;
  font-size: 12px; line-height: var(--dsh-tb-hint-line); color: var(--dsh-tb-text-3); }
```

- **动作与句子之间恒为一条沟（10px），除非整行装不下，那时动作换到第二行。** 「去看」是**文字
  动作**而不是药丸按钮——一屏里已经有页轨与行尾菜单两排药丸，第三排只会让三排一起失效，而药丸
  有它自己的固有宽度，改 flex 改不掉它，**得改控件本身**。文字动作的固有宽度是它的两个字。
- **句子不许 `nowrap` + 省略号**（那是把「读不到」当成省地方的机制）。`min-inline-size: 0` +
  `overflow-wrap: anywhere` 让整行装不下时**换行**，而不是把句子裁成一个词。
- **严重度改由那个数字自己说**：色条去掉之后颜色还在干活，而且干的是它本该干的活（标出那个数），
  不是给一个盒子描边。「要处理」块与列表之间只留 12px 空气；块内的每一条之间是一根 `--dsh-tb-border-soft`
  的发丝线（`border-block-start`，第一条没有）。**它在卡外，所以它自己带台面与内衬**：
  `.itemTriage { inline-size: var(--item-measure); margin-inline: auto; padding: 0 var(--item-inset) 12px; }`
  ——写在卡内它就成了内容，写在卡外它才是摘要。
- **归档入口是「要处理」块里的最后一行**（`.itemTriageRow` 的同一副骨架，两槽），因为它说的也是
  「有一行需要你动手」——去把删掉的那行找回来。**它必须把期限写出来**而不只是暗示：
  「删除后 30 天内可以找回来。」

#### 派生页：归档（不是页面轨上的一格）

**归档是读者「点进去才出现」的一整个页面，不占轨。** 轨只有收件／清单／日程三片，**每片带自己的
数，空页写 0 不消失**；每问一次问题就长出一格，地图就变成了日志。入口是清单页「要处理」块的最后
一行，退出时回到来的那一页。

**它有三个状态，不是两个，而第三个是要紧的那个**：

| 状态 | 判据 | 长相 |
| --- | --- | --- |
| 读中 | 请求在飞 | 第三档墨一句安静的话 |
| **读不到** | host 没回 / 没这一项 | **明确说「读不到主机上的删除记录」** |
| 空 | 读到了，且墓碑里没有正文 | 一句「没有删掉过任何一条」 |

**「读不到」绝不能画成「空」**：那会告诉读者他的删除没了，而它们可能就在磁盘上。**「空」也不能
画成「读不到」**：那是把一次故障说成一件事实。

**恢复是 host 操作，不是客户端提交。** 墓碑的戳压在它删掉的那一行之上 1 毫秒，所以把那一行原样
再提交一次，正是墓碑存在的意义所在——它会被吃掉，接口回 200，回执说成功了，文档没变。只有 host
知道那个戳，所以只有 host 能写它。面板的义务因此是：**恢复没回来就说没回来**，不许把「没有墓碑
压着这个编号」说成成功。**删除满 30 天的那部分不进归档**（墓碑剪掉时正文一起走），入口那一句把
期限讲清楚，就是为了让这件事是**读者早就知道的**，不是丢了个东西才知道。

**删除是可就近撤销，没有确认弹窗**（它需要的是一条回来的路，不是一次「你确定吗」），撤销处同时
说出 30 天窗口与从哪儿找回来——**撤销走的是与归档「找回来」同一条通路，回来的是同一条、同一个
编号**。因此详情里那个二段确认（`itemDeleteConfirm`）与这一条冲突，**去掉**。撤销的驻留形态是
**一次**、就地、出现在那行原来的位置，用完即止；它与「30 天窗口」那句话同处（同一句话里说清），
因为它们是同一件事的两半。

#### 宽屏 / 窄屏：逐控件的结论（硬性规范 11）

**两档只能靠换行 / 换列 / 让位 / 短名 / 折叠 / 提高地板表达，禁止藏掉标签、藏掉控件、缩小字号。**
下面逐个控件给结论，**没有一条答案是「窄屏藏掉」**。

| 控件 / 处 | 基准档（手机） | ≥720 / ≥1081 | 表达的机制 |
| --- | --- | --- | --- |
| 标题 + 计数 | 一行，`column-gap: 12px` | 同一行 | 无变化 |
| 搜索框 | **整行 `inline-size: 100%`，无封顶** | 定值轨 `minmax(18rem, 22rem)`，三页逐像素同宽同位 | 换列 |
| 行高开关 | 标题行右端，**一枚 `aria-pressed` 文字动作**（`宽松` / `紧凑`），**不许不画** | 同一行的右端，同一枚 | 无变化 |
| 页面轨 | **同一行三片，自由横向滑动，无 scroll-snap** | 同一行三片 | 无变化 |
| 快记框 | **输入与「记下」同一行，不换行**（实测 390px 放得下、占位文字完整、无横向滚动） | 同一行 | **无变化**（上一版那条「换到第二行右对齐」已作废） |
| 概览磁贴 | **5 块 × 1 行**，每块 68px | 5 块 × 1 行，块变宽 | 无变化 |
| 排序（**仅清单页**） | **一个单选**（`.itemFilterSelect` = 短名「排序」+ `<select className={css.itemInput}>`），七档全在选项里 | `Segmented` 七档 | 换控件的形状 |
| 四个面 | 换行，一行一枚，**四枚都在** | 一行可绕 | 换行 |
| 筛选带整体 | 一列单选 + 换行的面片 | 一行可绕的控件行 | 换列 |
| 批量条 | 清单页的筛选带里；勾选轨 28px，**两档同宽** | 同 | 折叠（两态才出现） |
| 行网格 | 两行（标题 / 事实） | 一行（标题 / 事实同一行） | 换行 |
| 事实行 | **2 条轨**（无第三条） | 3 条轨 | 换列 |
| 行尾动作 | `--item-actions-col: 76px`，恒定 | 同 | 无变化 |
| 组头 | 算术与发丝条贴在组名右侧，右端留空 | 同 | 无变化 |
| 详情头 | 那一行的身份 / 一句给读者看的话（**横线上不许是空的**） | 同 | 无变化 |
| 详情 | **就地展开在行里**，与宽屏同一份分区 | 侧栏，`align-self: stretch` 画线 / 内容盒 `start` | 换位 |
| 磁贴微条 | 2px、满轨宽 | 同 | 无变化 |
| 要处理的文字动作 | 贴句子；整行装不下才换行 | 同 | 无变化 |
| 字 | **一字不差、一档不降** | **一字不差、一档不降** | 无变化 |

**「窄屏版」不是另一套界面，是同一套界面在一个更窄的盒子里。** 唯一在两档之间**换形状**的控件是
**选项数超过三档的枚举控件**（排序七档），判据是**装不下**而不是「某一个控件」：分段的全部价值是
「一眼看到当前在哪一档」，而七档在 390px 上放不下时它既不换行也不滚动（`.segmentedRow` 是
`inline-flex` + `white-space: nowrap`，没有 `min-inline-size: 0`），于是四档里丢掉两档、七档之后
更糟——**那不是紧凑，那是把控件藏起来**。本表面已经有单选这个控件（详情里的状态与优先级就是
`<select className={css.itemInput}>`），所以窄屏换成它而不是发明新控件：

```css
.itemFilterSelect {          /* 短名 + 控件，一列 */
  display: grid; grid-template-columns: auto minmax(0, 1fr);
  column-gap: 8px; align-items: center; min-inline-size: 0;
}
```

短名是 11px 第三档墨的「排序」，控件里显示**当前档位名**——所以「排序」与「顺序」不在同一个槽，
不重名。**行高不在这一排**：它是页头第三轨那枚 `aria-pressed` 的文字动作（行高说「这一页怎么读」，
排序与四个面说「这些行怎么被挑出来」）。**两档的选择器写在哪个块里决定它属于哪一档**：基准的写在
`.itemFilterRow` 自己的声明里（`display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px 8px`，
`.itemFilterSelect { grid-column: 1 / -1 }`），`Segmented` 写在
`@container dsh-tb-item (min-width: 720px)` 里（`.itemFilterRow { display: flex; flex-wrap: wrap; … }`）。

**底部的收口**：台面下缘由**最后一个组的下沿 + 16px** 收口，不画线、不加阴影、不加一段渐变——
渐变是「这里本来该有东西」的告示，也不靠加内容填屏。**空着的下半屏不是缺陷，空着一个 730px 高的
边框盒子才是。**

#### 类名清单（`item.module.css`）

**这张表是本文件里最容易变成谎话的一张，所以它不列清单。** 类名的清单有一份权威：
`src/client/item/item.module.css` 自己。**它有多少条，就是多少条**；把同一份清单抄进文档，
下一次加类名时两份必然有一份是旧的，而旧的那份没有人会去读。

所以这里只记**不能从样式表本身看出来的那几条**——即那些「约定」而非「声明」：

- **轨道与分层令牌单归属**：`--item-inset`（页内衬）· `--item-list-col`（列表卡封顶）·
  `--item-track-gutter`（卡与详情轨之间）· `--item-head-actions-col`（页头第三轨）·
  `--item-mark-col` / `--item-ref-col` / `--item-priority-col` / `--item-pick-col`（行首四轨）·
  `--item-meta-date-col` / `--item-meta-count-col` / `--item-meta-col`（事实行）·
  `--item-actions-col`（行尾）· `--item-row-pad` / `--item-row-gap`（密度）· `--item-measure`（页封顶）。
  **同一件事不许在两个地方各写一个数**，包括「换一个数时顺手在另一处同步」。
- **`--item-pick-col` 只在多选态存在**，由 `.itemRow[data-picking]` 声明。行首第 1 轨读
  `var(--item-pick-col, var(--item-mark-col))`——**回退就是状态点那 8px**，所以不在多选里的行
  一分不少付，而多选打开时整列的左沿**一次**移动（不是每行各移一次）。
- **`corner-shape` 与半径阶梯都在根层**，`item.module.css` 一处都不补。
- **画布 / 内层的分法**：装内容的五块（`itemRoot`、`itemListCard`、`itemTile`、
  `itemGroupHead`、`itemAgendaDayLabel`）吃 `--dsh-tb-bg`；浮起来的（`itemRowMenu`、
  `itemDangerZone`、`itemInput`、`itemFacetPanelBody`、`itemBatch`、`itemQueryChip`、
  `itemDetailInner`、`itemDetail`）吃不透明层令牌。**判据是「装内容」还是「浮在上面」，
  不是令牌本身**——理由见「画布与内层」那节。

**组头的折叠指示器必须画出来，且与看板同一套约定：折叠指向右、展开指向下。** 它是 7×7px 的
方框加两条 1.5px 的边，**不是**复用看板的图标字形——所以它自己转：`aria-expanded='false'`
时 `rotate(45deg)`，展开时 `rotate(-45deg)`。**旋转挂在哪一态取决于基础字形朝哪边**，这条理由
必须写在规则旁边：字形换了而旋转没换，展开与折叠就会整体翻转，而翻转后的箭头仍然「像」一个
折叠指示器，所以看截图是发现不了的。

#### 反 AI 味自查（每条可机械核对，跑 `pnpm verify` 之前自己过一遍）

1. 活规则里 `font-size` 的取值集合 ⊆ `{11,12,13,14,16}px`
2. 活规则里 **0** 个 `hex` / `rgb()` / `hsl()`
3. 活规则里 **0** 处 `corner-shape`（根层那一条不在本表内）
4. 活规则里 **0** 处 `margin-left: auto`（右对齐一律用具名 grid 区域或 `justify-self: end`）
5. 活规则里 **0** 个 `@media(max-width)` 与 **0** 个 `vw` / `vh`
6. `itemRowMain` 的前两条轨是**定值**（`px` / `ch` / `em`），**没有** `auto` / `min-content` / `max-content`
7. `itemRowMeta` 的两条轨是定值，且第 1 轨解析值 ≥ 最长读法的宽度（**不是 11ch**）
8. `itemActionsCol` ≥ 「问 AI + ⋯ + 沟」的实际宽度，且**每一行的动作列右沿相等**
9. `itemTriage` 的 `border-width` 为 **0**，且 `background` 与 `itemRoot` 相同
10. `.itemListCard > *` 全部 `flex: none`——**列表轨里没有纵向生长的孩子**（今天 660px 空洞那一族）
11. 详情轨的竖线**贯穿全高**：`.itemDetailPane` 是 `stretch`，`.itemDetailInner` 是 `start`
12. `.itemDetailHead` **永远非空**（未选中时是那一轨的名字）
13. **三页的搜索框同宽同位**（`minmax(18rem, 22rem)` 这一条轨道）
14. `itemTriageText` 没有 `white-space: nowrap`，`itemTriageAction` 没有 `border`
15. `.itemGroupToggle` 是 `flex: 0 1 auto`——**组头的算术不在轨道尽头**
16. 活规则里 **0** 处 `!important`
17. `--dsh-tb-accent` / `--dsh-tb-attention` / `--dsh-tb-danger` 的**视觉位置**分别 ≤ **5 / 3 / 4**
    （位置怎么数见上面那张表下的那段；一条规则写两个属性算一处，同一元素的不同状态也算一处）
18. 每一档字号里的 `font-weight` 取值 **≤ 2** 个（表见字阶那节）

**这些条目里任何一条只能靠「改注释躲开扫描」达标，就是检查错了而不是实现错了**——先怀疑检查的
读法（硬性规范 14）。第 6、7、8、10 条尤其：它们不是审美要求，是「每一行是各自一个网格」「每一列
的宽度由这一列决定」「同一件事只有一处」这三个结构的必然后果。

#### 这份表的验证到什么程度（未核的说未核）

| 结论 | 凭据 |
| --- | --- |
| **这一节的十九条，每一条现在都由一道机械断言钉着**，而不是靠人记得 | 清单轨道的四条轨、事实行两轨的零下限、字阶与颜色预算、窄档的「容器装不下就换行」分别由 `tests/panel-render.spec.ts` 断言；**断言写的是关系（「轨一装得下最长读法」）而不是像素等式**，因为等式会随字体与语言一起过期 |
| 事实行第 1 轨装得下最长读法 | 断言写在 `panel-render.spec.ts` 的日期轨那条上，比较的是**读法与轨的关系**。像素等式不写：写下来就等于把今天的字体与今天的语言刻进契约，而两者都会变 |
| 本节给的几何（概览条、磁贴、卡、分栏线、页头三段轨、窄档同一个排序控件） | **已落地，并由台架的 `3 页 × 2 档` 六张渲染核对过**。落地后的证据是截图，不是承诺 |
| 窄档是**真 390px** | 台架的渲染页带 viewport meta，`<600` 时另传 `screenWidth`，并且台架有断言把「宽窄两档渲染出不同结果」钉住。**接上了参数却悄悄丢掉**的台架比拒绝参数的更坏，所以这条断言存在的原因就是那次丢掉 |
| 三个页面的参数真的生效 | 台架有两条自测断言「三页渲染出三个不同的文档」「宽窄两档不同」 |
| **截图闭环走的是渲染台架，不是活体 App** | `127.0.0.1:3080` 返回 401，而 `dsh web` 的令牌只在启动时打印一次、本次**不重启 DSH**（用户明令）。所以这一轮的全部渲染证据来自台架（真组件 + 真 CSS + 真宿主令牌 + 真实 fixture），**3 页 × 2 档六张** |
| **颜色：未在运行中验证** | 台架的强调色来自**宿主静态 bundle**（蓝），活体是 theme service 按用户设置**运行时叠上去**的一层（粉）——同一份 CSS、同一个 `--dsh-tb-accent`。**所以台架只证结构与几何，不证颜色**；本节的「视觉位置 ≤ N」是**按令牌层数出结构位置**，不是数截图里的色块 |
| **深色主题** | **只有构造性保证，没有渲染证据。** 这张表零颜色字面量，全走 `--dsh-tb-*` → `--dsw-*`，换主题按构造会跟上。但**宿主的深色根本不在 CSS 里**——它是 theme service 运行时按用户设置叠上去的一层令牌，所以静态渲染页**没有任何办法**进入深色。把注册表读出来自己拼一层去截图，**但那截出来的是重建的深色，不是宿主输出的深色**，拿它宣布验收通过等于对着自己画的图签字。真看一眼只能在跑着的那个 App 里把外观切成深色 |
| **这一节没有任何数字式门禁** | `verify-design-docs.mjs` 只校验**令牌名**存在，**不校验任何像素、字号、次数或计数**——所以本表里任何一格数字漂了都不会红。数字要有人读，读到就要改；**这是这份文件的已知缺口，不是它的保证** |

### 加载三态（读中 / 失败 / 空）

任何一块「内容来自别处」的界面都有三态。**三态是三种判据，不是同一句话的三种语气**——
判据不同，才敢让它们长得不同；判据若相同，差异就只剩措辞，而措辞最容易被下一次改写顺手抹平。

- **读中 = 还没有答案。** 这一次读还没回来，且没有任何证据说它不会回来。长相是**一句安静的话**：
  第三档墨（`--dsh-tb-text-3`）、与正文同号、无任何补救动作。板舞台自己那句更简单——居中、
  安静、带 `role="status"`，因为面板在装配时就已经注册好、让外壳总能解析到它，它背后那层板
  才在建；**那是一段过渡，不是一次故障**。**在飞的东西不能被画成坏了**：把「读中」挂上错误色，
  用户读到的是「这里坏了」，而事实是「这里还没好」——那是关于系统状态的一句谎。读中永远不出现
  错误色、不出现重试按钮、不出现任何空态插画。

- **失败 = 试过了，答案是「答不出来」。** 答不动、答超时、或答不了这件事。长相是**一句实话加一个
  就地重试**，就这两样，不多不少（会话配置行与转录失败行是现有的两副骨架，窄屏时整组换行而不是
  压扁）。三件事配套，缺一件这条就退回「死路」：
  1. **已经读到的内容不清空。** 失败改的是这一块的状态，不是把整块换成错误页；
  2. **重试是就地手递手**，不是全局弹窗、不是「请刷新页面」。加载器在失败时什么都不缓存，
     所以那一次重试读到的是活的；
  3. **自动退避在前，手动重试在后。** 一次读失败后系统自己隔一拍再试一次；标签页从后台回到前台
     且仍处于失败态时再排一次；同一时刻只允许一个重试在飞。**错误态只在自动退避落空之后才出现**
     ——把一个还在自己修的读标成失败，等于先对用户谎报了一次。

- **空 = 试过了，答案是「没有这个东西」。** 空既不是错也不是读中，所以它穿**第二档**墨
  （`--dsh-tb-text-2`）而不是第三档：第三档在本文档里的定义是「淡、可丢弃」，而一个空列是那一屏
  上唯一的内容——它没有可以服从的对象，所以那档墨在浅色主题下实测读不出来（对比度 3.71 对
  5.80 的那组）。一个空列**只说「暂无任务」四个字，不加任何补救动作**——不摆「新建任务」、
  不摆插画、不摆一串用法提示。**空不是一件要修的事**，它只是现在没有；一旦给空态配上补救动作，
  用户就会开始问「那它是不是坏了」。

- **第四种读法：根本没有这个能力。** 它与「失败」不同类，也与「空」不同类——服务端根本不提供
  翻更早对话的端点。**对着不存在的端点重试就是无限死循环**，所以这里按钮撤掉、行留着，改成一句
  点名缺失能力的话（请升级服务端）。**能重试的失败留按钮，不能重试的失败换句子**：这条判据全板
  只有这一处，但它必须存在，否则「一直重试一个永远不会有的东西」是迟早的事。

  这四种读法在代码里是四段不同的分支，而不是一个错误位加一句文案。**新加任何一处「读别处」的
  数据，先说清它落在哪一种，再决定长相。**

**该照这条做的判据**：新界面若有一块内容**来自别处**（一次读、一个分页、一份字节），就必须落进
这四种读法之一，并**复用现有的失败行骨架**——一句实话加一个 `ui.tsx` 的小号 `Button`，不要另写
第三种失败长相。若它**本来就是空的**（界面上还没有这类数据），那它属于「空」，且不带补救动作。

### 拖拽（投放与排序）

拖拽是这块板上**唯一**会让东西换位的手势，所以它的全部反馈必须可预测到「指哪落哪、落哪成哪」。
三件套各管一段，全部结构驱动：没有任何一处靠猜，也没有任何一处自己另算一套。

- **落点几何（`drop-position.ts`）**：纯函数、不碰 DOM，所以能单独测。它把「指针的 Y」算成
  「落在哪一条插入缝」——离指针最近的缝心胜出，同栏用半分割（指针在卡片上半落在它上面的缝、
  下半落在下面的缝，上下对称，对任何列高都成立）。它同时负责把指示条的 Y 换算到滚动容器的
  **内容坐标**：**必须把滚动量加回来**，否则条会正好漂上去一个已滚过的距离，落在与它承诺的
  缝不同的位置。
- **跨列先滚进视野（`drag-autoscroll.ts`）**：唯一一套边缘自动滚动的文法（板列与详情的会话列表
  共用一套，不许第二个）。指针靠近滚动体的上下沿时，容器自己滚，步长按离边缘的远近线性放大，
  于是「把卡拖到长列表的最底」是一次手势的事，不是在边缘卡住。实现上有一个必须知道的点：滚动体
  平时是平滑滚动（`scroll-behavior: smooth`），而**每帧手改一次滚动位置**与它会互相打架——所以
  这个钩子只在真的在滚的那段时间把它临时切成 `auto`，停下就还原。每滚一帧回调一次，用**最后一次
  指针位置**重算插入缝，所以指示条跟着内容走，不说谎。
- **落位动画（`use-flip.ts`）**：**结构驱动，绝不矩形驱动**。它比的是「哪一栏、栏内第几」（读 DOM
  顺序），所以滚动、悬停抬升、拖拽中的缩放倾斜都不可能触发它。动画走浏览器自己的动画接口
  （生命周期归浏览器，卸载自动取消），并且**拖拽期间完全静音**。

一次投放的完整契约：

- **排序只在按住拖拽时发生，而且拖拽期间板是静的。** 这是双侧的：手势期间除了那一条指示条，不写
  任何新顺序；也不让别的卡动。手一离开才落位，而**投放后那一次滑移就是唯一的确认**（约 240ms），
  所以**投放成功不需要给列任何闪光**。
- **指示条是画在缝上的一条静态条**（强调色实心、细、微圆角、两侧让出列内衬、底下垫一圈画布色好
  从任何背景上读出来），不是整列高亮。它**没有入场动画**：它换列就重挂载，指针短暂离开又回来也
  重挂载，任何挂载动画都会重播成闪烁——静态条在每一种情形下的表现完全一致。
- **投放判定只有四种结果，没有第五种**（核心层 `resolveCardDrop` 是唯一实现）：落在「进行中」
  = 重跑（本来就在那一栏也是重跑）；落在自己当前所在的其它栏 = 无动作；落在别处 = 移动；**有未结算
  的执行时，「待审核」「已完成」与「离开进行中」一律拒绝**——那两种栏的归属属于执行器，手动挪走
  会被结算覆盖，而离开进行中的那一轮没人结算，会变成占着并发槽的僵尸。这条判定必须在**放手之前**
  就成立：指示条画不画、光标变不变禁止，全读同一个判定。
- **先取落点，再清状态。** 插入决定在每次 `dragover` 上同步写进一个镜像，在放手那一刻**先读出来
  再清空所有拖拽态**。反过来做，每一次投放都会静默落到栏尾——跨栏拖到某个位置、落点却跑到最底下。
- **拒绝出声，成功安静。** 悬停目标列给的是**静态强调色描边**；被拒时列边框**闪一次危险色**
  （`dshTbRejectFlash`，与「已结束未读」同族的注意力色），并且**在板头自己的列流里说一句人话**：
  是哪一栏、为什么不能、以及还能怎么办（「等它结束，或先插话」）。那行带 `role="status"`，所以
  拒绝是被**读**出来的，不只是闪出来的。**三者的分工就是「在场有要求」在本项目的落法**：做不到的
  事情当场说清楚，安静留给成功和无关。
- **抓起来的手感**（`data-dragging` 期间）：被拿起的卡半透明、微微放大、带一个极轻的倾斜、换用
  最深一档阴影——整个拖拽期间它都读成「我正拿着它」，而浏览器自带的拖拽影像跟着指针在下面走。
  **同期间悬停抬升与倾斜被关掉**：它们会污染落点测量，还会让落位动画误判。
- **从工作区拖进看板走的是同一套接收端**，此时落点列戴的是**同一族呼吸**（`dshTbBreathRing`
  配 `--dsh-tb-breath`），不是新造一种光——「这里可以放」的说法与「这里有新的」同族。

**已知能力缺口（触屏）**：换栏走的是浏览器自带的 HTML5 拖放（`draggable` + `dataTransfer`），
**触屏上根本不触发**；而从工作区把会话拖进看板的**接收端是同一套**，那一半的**发起端在宿主**，
本插件修不了——所以手机上「把会话拖进看板」也上不来。**要给触屏补齐换栏，方向是把卡片拖拽整体
换成 Pointer Events**（桌面与手机同一份实现，列内排序一并恢复），现有 HTML5 落点**只保留**用来接
宿主的侧栏拖拽。这是一件独立的、有意推迟的事。

## Do's and Don'ts

### Do:

- **Do** 消费 `--dsh-tb-*` 别名，并让每个别名落在 `--dsw-*` 宿主令牌上。宿主换皮肤时
  改一处，全板跟着变。
- **Do** 把形状语言交给那**一条**根规则（`corner-shape` 声明处）：新增圆点或胶囊时只写
  半径，形状会自动覆盖到——不需要、也不允许逐处补 `corner-shape`。
- **Do** 用**表面自身宽度**做响应式参照：`@container dsh-tb`（680px）、`@container dsh-tb-panel`
  （600px）、`@container dsh-tb-item`（清单工作台：`< 720` 单列就地、`>= 1081` 双栏）。它在侧栏
  开合、分屏、手机上都是对的。
- **Do** 让容器装不下时**让位**：换行、换列、具名区域改排、短名 + `aria-label`、折叠、
  提高地板。窄屏与桌面是同一等公民。
- **Do** 用派生偏移对齐（`calc(var(--a) + var(--b))`），让「上面有空隙下面紧贴」这类
  不一致在机制上不可能发生。
- **Do** 给每个控件可 Tab 到的焦点态；Dialog 只留一个 Escape 出口。
- **Do** 在 `prefers-reduced-motion` 下**削弱**状态呼吸（降速 2.6s 到 5s，收幅 3px 到 2px），
  绝不归零——它是消息，不是装饰。
- **Do** 让三态各自判据、各自长相：读中永远安静（绝不挂错误色），失败永远是一句实话加一个
  就地重试，空永远不加补救动作。新加「读别处」的数据先说清它落在哪一种读法，再决定长相。
- **Do** 让落点反馈只有「画在缝上的那一条」，排序靠结构差分（栏 + 栏内序）判定而不是矩形；
  做不到的事当场说清楚，安静留给成功。
- **Do** 让文字永远留在盒内：裁剪只发生在「文字子槽」里，`overflow: hidden` 是底线。
- **Do** 让清单工作台在宽屏进侧栏、窄屏就地展开（**同一个组件两处摆放**），让每一行在静止时就
  读得懂，并让每一种读法说清是哪一种。位置交给具名网格与轨道，不交给定位。
- **Do** 让**一列的宽度由这一列决定**：清单的行网格与事实行网格，前几条轨一律定值（`px`/`ch`），
  绝不 `auto`——每行是各自一个网格，`auto` 轨按本行内容算宽，标题的左沿就会一行差一个字符。
  容器查询管档位，轨道管对齐，两件事互不替代。
- **Do** 让**组头退一步**：分组名按字段标签画（12px / 600 / 第二档墨 / `+0.02em`），行标题才是
  这一页的第二主角。让容器变轻比让内容变重便宜。
- **Do** 让**提醒区是一段话而不是一个盒子**：要处理的严重度由那个数字自己说，色条与边框都去掉。
  框住它等于说它和下面那些行是两种东西，而它不是。
- **Do** 让**每一页有一个视觉中心**，并把落点写成「第一 / 第二 / 第三 + 其余为什么退后」四句。
  一屏之内眼睛有先后，靠的不是每个元素都更响，而是**有一个元素被允许更响**。
- **Do** 让**分隔线的长度由它分隔的那件事决定**：分栏线归工作台（贯穿全高），内容盒归内容
  （`align-self: start`）。线只画到内容那么高，读作「这里没画完」。
- **Do** 让**同一句话在一页里只出现一次**，且**相邻两行内不许出现同一个数**。四个数归概览条、
  一句话归列表上方、组的计数归组头；哪两个数允许相等、为什么，写在那两处的注释里。
- **Do** 让**列向 flex 的孩子按内容定高**。一个类在行向 flex 里带 `flex-grow` 是对的，把同一个类
  放进列向的滚动容器，它就变成纵向生长，吃掉整段纵向空间。
- **Do** 给**每一档控件两个结论**（用换行 / 换列 / 让位 / 短名 / 折叠 / 提高地板表达），并把
  「两档唯一允许不同的处」逐条列出来。答案是「窄屏藏掉」的，等于没做。

### Don't:

- **Don't** 写颜色字面量。没有 hex、没有 `rgb()`、没有新造近似色；`pnpm verify` 会拦。
- **Don't** 靠改半径去修「不够圆」。半径对、角是方的，是 `corner-shape` 的事；改半径只会
  把圆点改成圆角方块，问题照旧（历史上反复复发正因如此）。
- **Don't** 用 `@media (max-width)` 做布局判断。视口宽度不是这块板的真相。
- **Don't** 用藏掉标签、藏掉控件、缩小字号来「省地方」。只在一档验证过的改动视为未完成。
  一个**用户设置**（行高、密度、排序档位）在任何一档都必须有控件——窄屏用户改不了自己的设置，
  就是把这一档设备排除在外。
- **Don't** 增加字号档位。11 / 12 / 13（+16 标题）之外的新尺寸需要先改这条规则。
- **Don't** 让两个以上的元素同时带阴影。静息态是平的；阴影是当前焦点的信号。
- **Don't** 引入第二套交互副路径：同一件事在窄屏与桌面必须走同一套组件与同一套机制，
  不允许为手机另写一个组件。（唯一允许换的是**形状**：一个选项数超过三档的枚举控件在窄屏上
  换成单选，理由是装不下而不是「这一档特殊」。）
- **Don't** 把必要信息挂在 `title=` 上。触屏没有悬停，说明必须可点可达。
- **Don't** 把状态指示器（呼吸光环、运行转圈）当作可省略的装饰去掉——它们是界面在说话，
  去掉等于让界面沉默。
- **Don't** 为挂载另起一套动效名。入场只有 `dshTbBoardIn`（板头/列轨/新卡同语法）、
  `dshTbDialogIn`（浮层景深）、`dshTbFadeIn`（纯淡入）三套；交错延迟一律不用——
  新卡的到达感来自结构印记（`data-fresh`），不来自排队。
- **Don't** 在同一个区里放第二个滚动体。每区至多一个，父子各自滚动会造成互相遮盖。
- **Don't** 让卡片或面板的内容溢出圆角盒。`overflow: hidden` 是这个系统唯一的通用防穿模底线。
- **Don't** 把在飞的读画成错误色，也不要给空态配补救动作。在飞不是坏了，空不是要修的事。
- **Don't** 为窄屏另写一条换栏路径，也不要加第二套拖拽实现或用矩形判定排序——那会把一个
  已知缺口变成两套真相。
- **Don't** 在清单工作台里用 Dialog，也不要用浮动层去盖住页头的搜索框——详情的位置由工作台的
  具名轨道决定，不由定位决定。也不要把「读不到 host」画成空清单，也不要把软期限逾期画成红。
- **Don't** 用**带边框的盒子**代替视觉层级。层级由字阶、由留白、由一根发丝线表达；一个盒子
  只会说「这里有一个独立的东西」，而分组、提醒、统计**都不是**独立的东西。
  **卡片的单位是页面，不是分组**——一组一框就是新增一层表面，满屏的框会互相削弱。
- **Don't** 让每一行的**列宽**由那一行决定。`auto` / `min-content` / `max-content` 出现在行的
  网格轨道上，就是把对齐交给内容——行与行之间立刻没有一条可扫的线。
- **Don't** 让**定值轨装不下它要装的东西**。一条轨的内容溢出时**溢出不回灌别的轨**，于是下一条
  轨照自己的起点排，而两个事实会叠在一起：轨的宽度必须按**最长读法**定，不是按常见读法定。
- **Don't** 让 `ch` / `em` 轨落在一个没有声明字号的元素上。`ch` 是「本字号下 0 的宽度」，而字号
  不从子元素继承——轨的解析字号要有一个显式声明处。
- **Don't** 让**分栏线只有内容那么高**，也不要在未选中时渲染一个只有下边框的空详情头。
  一条规则的下面没有内容，它说的不是分隔，是「这里少了什么」。
- **Don't** 让**装得下的地方留一整条空轨**。让位是换行或压缩，不是留白轨道。
- **Don't** 把一个动作推到它所作用的那句话的 600px 外，也**不要**用药丸按钮去装一个只有两个字的
  动作——药丸有它自己的固有宽度，改 flex 改不掉它，得改控件本身。
- **Don't** 抄一条规则时只抄它的声明。`.itemGroupChevron` 的内容从文字字符换成朝下的图标，而
  折叠态的 `rotate(-90deg)` 照抄过来，于是折叠指上、展开指右——**旋转挂在哪个态，取决于基础
  字形朝哪边**，所以那半句理由必须和那半句声明放在一起。
- **Don't** 让**详情轨为了「看起来满」而拉成一个高盒子**。轨拉满高只负责画贯穿全高的分栏线，
  内容盒 `align-self: start`；一个装着五行却高 730px 的边框盒，是「没做完」最强的信号。
- **Don't** 把内衬只写在纵向那一侧。`--item-inset` 少了 `padding-inline`，390px 上文字会**贴死
  屏幕左右边**——那是缺陷，不是紧凑。
- **Don't** 在一页上让每一排药丸一样响。页面轨、筛选行、行尾菜单、快记钮，四排控件如果同权，
  它们的和就大于内容；页面轨当前页之外的药丸**无填充、第三档墨**。
