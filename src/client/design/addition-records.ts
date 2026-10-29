/**
 * 新增登记：每加一个共享单元，就在这里留一条记录。
 *
 * **为什么要有这张表。** 「先复用，再扩展，最后才新增」这条规矩最难守的地方，不是没人想复用，
 * 而是**没人记得自己查过什么**——于是三个月后有人再写一份，而两份都还在。
 * 一条记录要回答的是**当时发生了什么**，不是现在这块代码有多好。
 *
 * **四个字段，缺一不可**：
 *
 *   - **单元**：加了什么（路径 + 一句话）；
 *   - **最接近的既有**：查过的那个最像它的东西——**必须真的存在**。写「无」等于说没查过；
 *   - **为什么不能用**：它哪里不行。写不出就是没查过；
 *   - **谁要求新增**：用户明确要求 / 门禁发现的 / 从别处机械拆出来的。
 *
 * **后两个字段空着即红**（「一个家」那道门禁读这张表）。
 * **理由写在实现之前**——实现之后补的理由都是借口：那时候你已经知道自己想要什么了。
 *
 * @module dsh-task-board/design/addition-records
 */

/** 一条新增登记。 */
export interface AdditionRecord {
  /** 加了什么：路径 + 一句话。 */
  readonly unit: string
  /** 查过的那个最像它的东西——**必须真的存在**（路径或名字）。 */
  readonly nearest: string
  /** 它哪里不行：一句话，说得出才叫查过。 */
  readonly whyNot: string
  /** 谁要求新增：用户明确要求 / 门禁发现 / 机械拆出来的。 */
  readonly askedBy: string
}

/**
 * 登记表。
 *
 * **按时间倒序**（新的在上面）——最近的那条最容易忘，也最容易在复查时被看见。
 */
export const ADDITION_RECORDS: readonly AdditionRecord[] = [
  {
    /** 一轮的画序：到达次序 + 最终回答边界（这两件事一起让「顺序对不上」消失）。 */
    unit: 'src/client/board/review-transcript.ts 的 `order` / `answerBoundaryOf` / `flowOf` —— 过程行、回复、读者插话各记一个到达序号，按它排成一条流；最终回答由官方 `answerStep` 边界算出',
    nearest: 'src/client/board/review-transcript.ts 的 `foldTurns`（它本来就把事件折成「过程数组 + 回复数组」——两个数组、各归各类）',
    whyNot: '两个数组本身没答「谁在谁之前」：画的时候只能先摆完一类再摆另一类，于是真实发生的'
      + '「思考 → 调工具 → 说一句 → 再调工具」被画成了「几十行堆在上面、两句话接在下面」，'
      + '而**没有任何一条用例会红**——两边的内容都在，只有位置错了。'
      + '所以新增的不是第二个折法，而是折的时候多记一个数（到达次序），以及把「哪一条是回答」从'
      + '「最后一条带文字的消息」换成官方那条边界（最后一步、带文字、那一步没有工具调用）。',
    askedBy: '用户明确要求：过程和回复「对不上哪一条在哪一条的顺序」，牛头不对马嘴',
  },
  {
    /** 评论区按「轮」折叠：判据、折行标题、以及那个跟着官方设置走的单例。 */
    unit: 'src/client/board/work-steps.ts + TurnItem.tsx + src/client/chat-settings.ts —— 一轮对话折成「触发句 + 过程折行 + 最后那段话」，折法读官方 `ui-chat` 设置',
    nearest: 'src/client/design/ui.tsx 的 `Disclosure`（本项目唯一的折叠语法：`aria-expanded` + `aria-controls` + 折记号只认祖先状态）',
    whyNot: '`Disclosure` 是**一个折长什么样**，它答不了「这一轮该不该折、折里放多细、折外留哪几条回复」——那是三件来自官方设置的选择。'
      + '复用它的部分正是画法（折行、折记号、展开区域），一行都没重写；新增的只有判据（`policyOfWorkSteps` / `groupsSteps` / `shouldFoldTurn`）与那个把设置读进来的单例。'
      + '官方聊天节点不能直接复用：它注册在会话流的 keyed slot 上，不是可复用组件，而跨包值导入会被 bundle 纯度门禁拒（会内联第二份运行时）。'
      + '设置本身也不许自己再做一套：同一件事两个开关，迟早一处改了另一处不动而屏上没人说话，所以按名读 `configForms` 的 `ui-chat`。'
      + '**四个能力字段（`foldCompletedTurns` / `stepGrouping` / `liveProcessDetail` / `settledReasoningPreview`）是照官方策略表镜像的**：'
      + '先写成六个自造布尔，观感就「像那么回事但不对劲」——自造的名字一出现，判断就跟着自己发明，而不是跟着官方的效果。',
    askedBy: '用户明确要求：评论区要「我一句、它一段」，中间的过程折起来，并复用官方那三个机制',
  },
  {
    /** 滚动条不越圆角：共享层一条轨道规则 + 各圆角滚动体声明缩进量 + 滑块圆角读同一变量。 */
    unit: 'src/client/design/base.module.css 的 `::-webkit-scrollbar-track { margin: var(--dsh-tb-scroll-inset, 0) }` 与 `::-webkit-scrollbar-thumb { border-radius: var(--dsh-tb-scroll-inset, 4px) }` + 各圆角滚动体声明该变量',
    nearest: 'src/client/board.module.css 的 `.reviewTranscriptScroll { border-radius: inherit }`（同一个病的那一次修法：把圆角搬到不滚动的祖先上）',
    whyNot: '`border-radius: inherit` 要求**有一个不滚动的祖先**接住圆角，而输入框自己是滚动体、没有那一层；'
      + '而且它只在自定义滚动条存在时成立，系统条不参与。轨道缩进不需要任何新结构，也不依赖谁在滚——'
      + '它直接改的正是那个几何事实（条跑在方角轨道上、盒子右下角是圆的）。'
      + '但**只缩轨道不够**：条到顶时它自己的头仍是方的，方头的两个角照样顶穿那段弧——'
      + '所以滑块圆角也读同一个变量，两件事是同一个几何问题的两面。',
    askedBy: '用户明确要求：滚动条「要冲出来了」，把它的位置挪一下',
  },
  {
    /** 「引用选中的文字」那一条手势的三个单元：文法、几何、接线。 */
    unit: 'src/client/board/quote-text.ts + quote-anchor.ts + QuoteSelection.tsx —— 选中文字后浮出按钮，以 `> ` 引用行写进输入框',
    nearest: 'src/client/board/markdown-parser.ts（引用的展示那一半：它认 `>` 引用块，Markdown.tsx 把它渲染成 .mdQuote）',
    whyNot: '展示那一半只**读**引用，不**写**引用——它没有「选区」这个概念，也不知道该插到光标的哪里，所以那两件事只能新增。'
      + '写的那一半本来想直接复用宿主：@deepseek-ai/dsh-message-quotes 就是同一个模型（引用是文本写法，不是消息类型也不是元数据），'
      + '但它**没有可复用的出口**——引用逻辑在 lib/client.js 里，那是给宿主自己的加载器用的 __ModuleLoader__ 闭包工厂，取不到任何函数；'
      + 'exports 虽有 ./src/*，files 却不含 src/，安装时根本没下载。抄它的内部实现是最容易随它一起过期的做法，'
      + '所以选了与它对表：tests/quote-contract.spec.ts 在已安装的宿主里取出它那个 quoteTextOf，喂我们生成的行，要求解码一字不差。',
    askedBy: '用户明确要求：DSH 新版有这个功能，插件的评论区也要有',
  },
  {
    /** 展开那一下只收敛内容透明度，几何一个像素都不动。 */
    unit: 'src/client/item/item.module.css —— 展开区：行高当帧到位，内容只做 itemDetailIn（70ms，opacity 0.2 到 1）',
    nearest: 'src/client/design/components.module.css 的 dshTbFadeIn（纯淡入那一套入场语法）',
    whyNot: 'dshTbFadeIn 动的是**一块正在入场的新东西**，而且从 0 开始——它属于「出现」，不是「某一行的内容定下来」。'
      + '这里有两点必须不同：一是不从 0 起（文字从全透明淡上来会在中途发灰，而糊的字同样被读成「卡」），'
      + '二是它**只作用在内容上**，容器与几何一个像素都不动。展开区高 741px / 窄档 1365px，'
      + '把高度做成动画的三版都实测过：帧时间一帧没掉，而 layout shift 累计 0.374，读者每次都报「卡」；'
      + '缩短时长反而更糟（60ms 时单帧吃掉 52% 的位移，因为位移总量固定、帧数变少）。',
    askedBy: '用户明确要求：清掉原来的展开动效，重新设计一个不卡、也不慢的（第四次反馈）',
  },
  {
    /** 裁剪形态的门禁：页面表不许自己抄「一个会裁剪的文字」这一族形态。 */
    unit: 'scripts/verify-truncation-form.mjs —— 页面表不许自己抄「一个会裁剪的文字」这一族形态',
    nearest: 'scripts/verify-design-docs.mjs —— check 5d 的 duplicateBodies',
    whyNot: '那一条判的是「**逐字完全相同**的声明体在两张表里」，而这一族的每一份拷贝都多带一条' +
      '（一个颜色 / 一个字号），所以**一条都没报**——实跑输出是「8 sheet(s) checked, 0 rule body(ies) ' +
      'declared in more than one」。抄一份不会让任何一条门禁变红，这就是本项目要消灭的那个病的准确形状。' +
      '它也判错了轴：这里是「页面表自己写出了一个形态，而共享层已经有一个家」，不是「同一段形状出现在两张表里」——' +
      '一份拷贝与它的家本来就不在任何一张表里各写一遍，按跨表比对看不见它。',
    askedBy: '用户明确要求：加一道门禁，页面表不许自己抄「一个会裁剪的文字」这一族形态',
  },
  {
    /** 模型下拉框的取值编码（provider + model，NUL 分隔）。 */
    unit: 'src/client/board/model-select.ts',
    nearest: 'src/client/board/RunConfigEditor.tsx 与 src/client/board/session-panel.tsx 里各自的一份 MODEL_SEP',
    whyNot: '那两份是各写各的本地常量与各自的拆法：改一处不动另一处，而 `<select>` 的取值只是屏上一个' +
      '**看不见的字符串**——分隔符换了一个，读者选中模型时得到的是空 provider 或空 model，' +
      '界面上看不出发生了什么，也没有任何一条测试会红。它是浏览器里一个控件的取值编码，host 与模型都不认识它，' +
      '所以不进 core。',
    askedBy: '用户要求：全项目普查后把「各自抄一份」收敛掉（lead 转来的 host 那条线的交卷清单）',
  },
  {
    /** 焦点环的宽度：一条令牌，实环与柔晕共用。 */
    unit: 'src/client/design/tokens.module.css —— --dsh-tb-ring-w，焦点环的宽度那一档',
    nearest: 'src/client/design/tokens.module.css 里的 --dsh-tb-ring（那一枚环把自己的宽度写死在值里）',
    whyNot: '那一枚是**整条环**（宽度 + 颜色），而调用点要换的是**宽度**：实环写 `outline: 2px`、' +
      '柔晕写 `box-shadow: 0 0 0 3px`，两个裸数散在四张表里。宽度该有自己的名字——' +
      '环有多宽是**一条共享的事实**，挑一次就分家：改一处，另一处留在旧值上，而屏上不会有人说一句话。',
    askedBy: '用户要求：CSS 形态层里「写死了本该走令牌的值」收敛掉',
  },
  {
    /** 输入框的焦点晕：一处配方，四处挂载。 */
    unit: 'src/client/design/base.module.css —— .focusHalo，输入框的那一枚柔晕',
    nearest: 'src/client/design/components.module.css 里的 .input:focus',
    whyNot: '那一枚在共享表的**组件**里，而清单的两个字段与看板的排期预设各写了一份逐字相同的' +
      '`box-shadow: 0 0 0 3px var(--dsh-tb-focus-ring)`——三份各写各的，改一处另两处留在旧值上。' +
      '而**柔晕是跨页面的形态**（它跨两个面板），所以它该住在形态层，而不是组件层。',
    askedBy: '用户要求：CSS 形态层里「同一段形状被抄成多份」收敛掉',
  },
  {
    /** 纸面：材质那两笔（底色 + 影）与它的两个槽。 */
    unit: 'src/client/design/base.module.css —— .paperSheet，材质那两笔（底色 + 影）与它的两个槽',
    nearest: 'src/client/design/base.module.css 里原来的 .paperSheet（边 + 圆角 + 底色 + 影捆在一起）',
    whyNot: '它把四件事捆在一起，于是**页面换个圆角就用不了它**——总览那一行要更轻的一条边与更小的角，' +
      '只能把边与圆角一起重写一遍，于是「材质」与「几何」两份声明混在同一条规则里，改一处就分家。' +
      '现在它只给材质那两笔，页面叠自己的边与角；两个槽（--dsh-tb-paper-plane / --dsh-tb-paper-cast）' +
      '让页面说「我这张纸的底色是哪一档」，而不用重写那两条声明（重写要打同一场特异性官司，谁赢靠源码顺序）。',
    askedBy: '用户要求：CSS 形态层里「同一段形状被抄成多份」「写死了本该走令牌的值」收敛掉',
  },
  {
    /** 本地日历日的键（localDayKey）：读者日历上的那一天。 */
    unit: 'src/core/local-day.ts',
    nearest: 'src/core/item-dates.ts 里的 startOfDay',
    whyNot: 'startOfDay 给的是那一天的开始时刻，这里给的是那一天的键（yyyy-mm-dd）：两个读法不能互相顶替，' +
      '但两者都认「本地」这一条规矩，所以住在同一条脉络上。它原来有**两个家**——client/item/model.ts 的 localDayKey ' +
      '与 core/board-events.ts 的 dayBucketOf，同一段算法、同样的补零，只是名字不同，' +
      '而按名字查的门禁一次也没报：改一处不动另一处，屏上不会有人说得清为什么某天的分组和某天的日期对不上。',
    askedBy: '用户要求：全项目普查后把「各自抄一份」收敛掉（ts-client 发现的同名异义那一层）',
  },
  {
    /** /update 这条路由的读数形状：证据、来源视图与应用结果。 */
    unit: 'src/core/update-view.ts',
    nearest: 'src/core/update-check.ts',
    whyNot: 'update-check.ts 是「这次更新要跑什么」的**计划**文法；这里是「现在是什么状态」的**读数**形状。' +
      '放进去会让一个叫 check 的模块装着 view 的东西；而 UpdateSourceView 还要引 ClientReport，' +
      '那又跟更新毫无关系（它是页面的自报）。',
    askedBy: '门禁发现：verify-one-implementation 报这几个 wire 形状跨半区各有一份',
  },
  {
    /** 页面自报的形状（ReportedBox / ClientReport）：浏览器量、host 存。 */
    unit: 'src/core/client-report.ts',
    nearest: 'src/host/client-report-route.ts',
    whyNot: '那一份在 host 半区，而 core 不能 import host；UpdateSourceView 的 clients 字段要引 ClientReport，' +
      '所以报告的形状必须有一个**两边都能 import** 的家。',
    askedBy: '门禁发现：verify-one-implementation 报 client 与 host 各定义一份 wire 形状',
  },
  {
    /** 表面名单（SURFACE_IDS / SurfaceId / SurfaceManifest）：host 宣告、浏览器读。 */
    unit: 'src/core/surfaces.ts',
    nearest: 'src/host/surfaces.ts',
    whyNot: '那一份在 host 半区，而浏览器 import host 是全仓唯一一处违例；名单是协议的一半（host 宣告、浏览器读），' +
      '两半都要认，所以它必须住在两边都能 import 的核心层。',
    askedBy: '门禁发现：verify-one-implementation 报 SurfaceManifest 跨半区两个家',
  },
  {
    /** 信封的形状（RouteOk / RouteFail / RouteEnvelope）：host 写、浏览器读。 */
    unit: 'src/core/http-envelope.ts',
    nearest: 'src/host/http-json.ts',
    whyNot: '那一份在 host 半区，而信封是**协议**（host 写、浏览器读），浏览器不能 import host。' +
      'http-json.ts 留下的是「怎么把一个信封写出去」与「怎么把一个请求体读进来」——传输，不是协议。',
    askedBy: '用户要求：host 半区与 core 半区里「同一段逻辑被抄成多份」的地方收敛成一份实现',
  },
  {
    /** 读一个来路不明的值的三个小工具（stringOf / messageOf / isRecord）。 */
    unit: 'src/core/values.ts',
    nearest: 'src/core/attachment.ts',
    whyNot: '那三个读法原本各自寄在用它们的文件里：附件规范化一份、目标动词一份、投影挑选一份。' +
      '而 update-apply（更新执行器）从一个**附件**模块里取一个字符串读法，那条 import 路径会骗读代码的人——' +
      '它们都属于同一件事：把一个 unknown 读成某种具体的值，所以按这个概念命名。',
    askedBy: '用户要求：host 半区与 core 半区里「同一段逻辑被抄成多份」的地方收敛成一份实现',
  },
  {
    unit: 'src/client/design/use-panel-row-exit.ts —— 「再按一次就离开面板」的那一下',
    nearest: 'src/client/home/HomeIcon.tsx 与 src/client/gallery/GalleryIcon.tsx 里各自的一份本地 effect',
    whyNot: '它们是每个图标自己的本地 effect，不是共享单元；两份本地拷贝改一处不会带着另一处走，' +
      '而这件事在两个 Icon 上真的发生过（逐 token 相同的 80 个 token）。',
    askedBy: '用户要求：全项目普查后把「各自抄一份」收敛掉',
  },
  {
    unit: 'src/client/design/base.module.css —— .stripInsetOuter / .stripInsetInner，条带的横向内衬两档',
    nearest: 'src/client/item/item.module.css 里各条带自己写的 padding',
    whyNot: '页面表里的三份拷贝各写各的：档位一改，只有被改到的那一份跟着动；' +
      '其中一份还漏了 .trim() 那一档，于是「# 12」在一个动作里找得到、在另一个动作里找不到。',
    askedBy: '用户要求：全项目普查后把「各自抄一份」收敛掉',
  },
  {
    unit: 'src/client/design/tokens.module.css —— --dsh-tb-row-pad，行内容盒的内衬那一档',
    nearest: 'src/client/item/item.module.css 里声明的 --item-row-pad',
    whyNot: '它住在页面表里，而共享形态（条带内衬）要读它——那是层方向倒置：换一个消费者就读不到，' +
      '整条声明在计算值阶段静默丢弃，屏上没有任何报错。',
    askedBy: '用户要求：全项目普查后把「各自抄一份」收敛掉',
  },
  {
    unit: 'src/client/design/components.module.css —— .titleText，标题折行那一档',
    nearest: 'src/client/item/item.module.css 的 .itemRowText 与 src/client/home/home.module.css 的 .recentTitle',
    whyNot: '两处各写一份 overflow-wrap: anywhere，第三处（看板卡的标题与摘要）当时写成两行夹——' +
      '同一种东西三个答案，改一处不会带着另两处走。收敛成「标题折行」这一个答案。',
    askedBy: '用户明确要求：卡片不能有截断',
  },
  {
    unit: 'src/client/design/tokens.module.css —— --dsh-tb-clip-floor，裁剪形态的宽度地板槽',
    nearest: 'src/client/item/item.module.css 的 .itemFacetChip 里写死的 min-inline-size: 24px',
    whyNot: '地板写进共享形态等于替所有消费者做了决定；不写又会让「允许压窄」失守（不缩的盒子不裁剪，' +
      '它是溢出）。槽是这两者之间唯一诚实的位置：默认零，页面要地板就写自己那个数。',
    askedBy: '门禁 verify-truncation-form.mjs 报出 31 处自抄的裁剪形态',
  },
  {
    unit: 'src/client/design/tokens.module.css —— --dsh-tb-paper-radius 与 .paperSheet 里那一枚角',
    nearest: 'src/client/design/base.module.css —— .paperSheet（它原先只画底色与影）',
    whyNot: '角原先被划成「页面自己的几何」，于是每个装纸的页面类都得自己记得写 border-radius——' +
      '总览页的四格、两张卡、流水线一起变成直角，屏上没有任何报错（缺一条声明是沉默的）。',
    askedBy: '用户报告：总览页的模块全部变成方形了',
  },
]

