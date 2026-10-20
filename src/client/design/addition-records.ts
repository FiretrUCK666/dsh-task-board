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

