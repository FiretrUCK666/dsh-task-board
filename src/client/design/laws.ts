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
    id: 'capsule-ink-correction',
    law: '每一个胶囊（声明了 pill 圆角的盒子）都要读 `--dsh-tb-optical-drop` 当作上下内衬，一处都不能漏。',
    gate: 'align-capsules.mjs',
    specimen: 'ink',
    why:
      '这一条不是「怎么算」的问题，是覆盖率的问题：校正的算术只写一次，而它要落在'
      + '每一个胶囊上——靠人记的结果已经看见了，清单页加了 29 处所以它全对，看板页一处'
      + '没加所以它全歪。同一个界面两页表现不同，不是谁写错了，是这条约定没有机制。'
      + '判据因此是结构的（有没有那枚圆角），不是一张类名名单。',
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
]

/** 按 id 取一条法则。 */
export function designLaw(id: string): DesignLaw | undefined {
  return DESIGN_LAWS.find((entry) => entry.id === id)
}
