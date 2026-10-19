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
]

/** 按 id 取一条法则。 */
export function designLaw(id: string): DesignLaw | undefined {
  return DESIGN_LAWS.find((entry) => entry.id === id)
}
