/**
 * 设计法则表：**每一条都是「为什么」，实现与门禁各有一处落点**。
 *
 * ── 这张表解决的是什么 ────────────────────────────────────────────────────
 *
 * 一条规矩只写在注释里，就有三种失效方式：被下一个改这一行的人看不见、被「这次先
 * 这样」绕过、以及在另一个文件里被重新推导一遍（于是两份不一致，而屏上没声音）。
 *
 * 所以每条法则在这里登记三样东西：
 *
 *   - `gate`：哪一条门禁守它。`verify-design-sync.mjs` 逐条核对**这个门禁文件真的
 *     存在，并且真的被 `pnpm verify` 调用**——一条没人守的法则等于没有法则。
 *   - `specimen`：它在预览页上长什么样。核对它**真的被 `gallery/` 渲染**，否则
 *     「预览页里没有」会被当成「这条法则不存在」。
 *   - `why`：一句话说清违反它会看到什么。写完实现再回头补理由，理由就会变成
 *     「因为门禁要它这样」——那是循环论证。
 *
 * **顺序是先登记再写实现。** 反过来，那条法则会在表外活一段，而表外的没人替它保证。
 */

/** 一条设计法则。 */
export interface DesignLaw {
  /** 稳定的标识（用在门禁输出与文档交叉引用里）。 */
  readonly id: string
  /** 一句话的法则本身，祈使句。 */
  readonly law: string
  /** 哪一条门禁守它（`scripts/` 下的文件名）。 */
  readonly gate: string
  /** 预览页里哪一件标本演示它。 */
  readonly specimen: string
  /** 违反它会看到什么。 */
  readonly why: string
}

/**
 * 全部法则。
 *
 * 目前只有一条，因为它是**唯一一条被反复「修好」又反复复发**的——每次都有人以为
 * 那是字体问题或浏览器问题。其余视觉规矩成文在 `DESIGN.md` 的 Design System 节，
 * 那里是散文；这张表只收**必须有机械门禁**的那些。
 */
export const DESIGN_LAWS: readonly DesignLaw[] = [
  {
    id: 'mixed-row-axis',
    law: '一行里只要有图形或两种以上字号，容器用 align-items: center，且每一段自己的 line-height 是 1em。',
    gate: 'verify-capsule-centring.mjs',
    specimen: 'mixed-row',
    why:
      'center 居中的是行盒、baseline 对齐的是字的底边。混排行里这两者不同心，读起来就是'
      + '「这一行的字偏下一点点」；而它会被误诊成字体或浏览器问题，于是有人写一个像素补偿'
      + '——那个补偿换一款字体就变成新的偏差，这就是它反复复发的原因。',
  },
  {
    id: 'capsule-line-box-is-the-ink',
    law: '装字的定高盒子让 `line-height: var(--dsh-tb-text-line-h)`（行盒 = 墨高），并用 `align-items: center` 把装字的盒子居中。**不许用块向内衬去补墨位。**',
    gate: 'verify-capsule-centring.mjs',
    specimen: 'ink',
    why:
      '墨心与盒心不同心，而它被「补」过很多轮：`0.04em`、`0.5px`、`1px`、`1.4px` 四个'
      + '常数，最后是一套逐元素测量的运行时。每一版都在「补多少」上找答案，而答案是'
      + '**不该补**——块向内衬挪的是内容盒，而 `align-items: center` 会把行盒重新居中到'
      + '新的内容盒里，两者一起走，相对位置一位小数都没变（实测「行盒心 − 内容盒心」'
      + '校正前后逐字节相同）。它还有三个副作用：压扁定高盒子（28px 的按钮只剩 20.5px 的'
      + '内容盒，字被抬到盒心上方 2.75px）、把字裁掉（行高 1em 的盒子被内衬挤矮）、'
      + '以及那个变量**被继承**（药丸里的色点读到药丸那一档，6×6 的圆点变成 6×18 的竖条'
      + '——读者报的「有时是条、有时是点」）。'
      + '正解只需要两条声明，而且**不需要任何测量**：行盒高 = 墨高之后 `halfLeading` 归零，'
      + '墨心与行盒心重合；行盒再被居中到内容盒，于是墨心 = 盒心，**与字体、机器、宽度'
      + '都无关**。判据因此是「有没有那两条声明」，不是「那个数对不对」。',
  },
  {
    id: 'one-colour-per-hue',
    law: '一个色相只有一个颜色：不许派生深浅档，也不许用 `color-mix` / `oklch(from …)` 把族色洗淡成第二种颜色。',
    gate: 'verify-palette.mjs',
    specimen: 'colours',
    why:
      '把一种色相拆成两半，读者看到的是一个颜色「变暗淡」，或者一处黄与别处黄「差很多」'
      + '——两次都是屏幕先发现的，而不是检查。所以那一档被整个删掉：文字直接读族色本身。',
  },
  {
    id: 'gates-cannot-live-off-the-table',
    law: '凡是被 `pnpm verify` 调用、且名字以 `verify-` / `align-` 开头的门禁，都必须在法则表里有条目。',
    gate: 'verify-design-sync.mjs',
    specimen: 'ink',
    why:
      '一个门禁在表外活着，下一个人只会看到一条红、不知道为什么，于是他的选择只剩「想办法'
      + '让它变绿」——那正是把门禁改松的开始。这一条守的是**这张表本身**，它是其余各条的'
      + '保证：没有它，加一条法则可以忘了给门禁，加一个门禁也可以忘了登记。',
  },
  {
    id: 'hover-opposes-the-paper',
    law: '悬浮态读的那一档必须与它所在的纸**反向**（浅色更沉、深色更亮），并且方向由令牌自己声明，不读静息底、也不直读宿主那一枚 4% 的通用悬浮。',
    gate: 'verify-hover-contrast.mjs',
    specimen: 'interaction',
    why:
      '宿主的 `--dsw-alias-interactive-bg-hover` 在两个主题下确实给了不同极性，所以「直接读它」'
      + '今天看着是对的——那是**碰巧对**，不是**结构对**。第三方皮肤换一套数值，同一个交互就'
      + '在两个皮肤下两个观感，而屏上不会有人说一句话：4% 的墨在一张白纸上几乎看不见。'
      + '所以方向写进名字（`--dsh-tb-hover-mix`），深浅由主题块翻面，混的是 `--dsh-tb-text-1`'
      + '——那枚墨自己在两个主题下就是反的，所以一个颜色源给出两个方向。',
  },
  {
    id: 'a-ring-never-shares-the-material',
    law: '装饰性的环（焦点环、打开环、选中环）不许和材质（边光 + 投影）共用同一个 `box-shadow`：它们必须分开声明。',
    gate: 'verify-decoration-property.mjs',
    specimen: 'interaction',
    why:
      '一条 `box-shadow` 是整体被替换的。把环写进同一个属性，某一条状态规则（或一次动画）'
      + '换掉它的时候，纸的边缘与投影会**一起消失**，卡片变成一块没有边、没有层次、贴在'
      + '桌面上的平色块。它不报错、不抛异常、样式表合法，只是那一块少了它之所以是一张纸的'
      + '全部东西——读者看到的是「这块卡坏了」，而检查三档全绿。',
  },
  {
    id: 'scroll-floor-is-not-px',
    law: '一个会滚动的 flex 子项，不许用一个 px 的 `min-height` 当地板；地板要么是 0，要么由内容与令牌推。',
    gate: 'verify-scroll-floor.mjs',
    specimen: 'surfaces',
    why:
      'px 地板是**视口高度**的函数写死成常数：窗口一矮，那个盒子撑着自己 pid 的下沿，'
      + '滚动条就跟着它跑到卡片外面去——条落在圆角之外，或者压住下一块内容。它在高窗口上'
      + '一切正常，所以只有小屏或分屏才看得见；而它恰好是硬性规范 11 要的「让位而不是压扁」。',
  },
  {
    id: 'pinned-surface-needs-own-floor',
    law: '压在滚动内容之上、又自己画了分隔线的头，必须自带不透明的底；洗底（含 transparent 的混合）不算遮挡。',
    gate: 'verify-pinned-surface.mjs',
    specimen: 'surfaces',
    why:
      '头部坐在面板里，所以「不写背景」看着只省了一行——省掉的是一次依赖：正文在它下面'
      + '滚过时，读者看见的是谁的底，取决于那层底是否真的不透明。主题把面板底调透之后，'
      + '头部就成一扇窗，正文从标题和状态胶囊后面透出来，读作「上面被砍了一下」。这个失效'
      + '三层检查全绿：样式表合法、类名都在、测试全过，屏幕上却少了一块。',
  },
  {
    id: 'a-selector-stays-in-its-own-sheet',
    law: '一条选择器只能命名**它自己那张表**声明的类；复合选择器里只要有一个类名属于别的表，整条就死。',
    gate: 'verify-sheet-scope.mjs',
    specimen: 'surfaces',
    why:
      '构建按**文件名**给每张 `*.module.css` 算哈希前缀。所以表 A 里写下的 `.chip` 指的是 '
      + '`A_hash_chip`，而 `.chip` 真正声明在表 B 里、渲染时带的是 `B_hash_chip`——两个字符串'
      + '永不相同，这条选择器匹配不到任何节点。它不报错、不抛异常、样式表合法，只是**什么都不做**。'
      + '这个仓库栽过三次，三次都是「有一半是本表的类，所以看起来像对的」：窄档里主按钮吃满'
      + '宽度、等待提示里芯片的 `flex: none`、会话行标题的 `grid-area`，全部从未生效。',
  },
  {
    id: 'a-component-owns-only-its-own-sheet',
    law: '组件点到的类名必须由**它自己 import 的那张表**声明；点到别处的名字渲染成 `class="undefined"`。',
    gate: 'verify-sheet-ownership.mjs',
    specimen: 'surfaces',
    why:
      '`import css from "./x.module.css"` 给的是一个映射对象，表里没有的键取出来是 `undefined`。'
      + '于是点一个表里没有的名字，渲染成一个合法、无样式、**不报错**的节点，类型上也不红——'
      + '映射对象的类型是 `Record<string, string>`，任何键都「存在」。'
      + '上一条法则管的是**表与表之间**，这一条管的是**组件与表之间**：一个 import 写错、'
      + '或某个类名搬去了别的表而组件没跟上，都只表现为「那里没样式」。'
      + '一次拆表会把这张网撒得更开，所以两条必须同时在。',
  },
]

/** 按 id 取一条法则。 */
export function designLaw(id: string): DesignLaw | undefined {
  return DESIGN_LAWS.find((entry) => entry.id === id)
}
