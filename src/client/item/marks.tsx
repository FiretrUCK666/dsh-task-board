/**
 * 清单这一面的**小记号**，一处画，处处用。
 *
 * ── 为什么单独一个文件 ────────────────────────────────────────────────────────
 *
 * 读者点名要的一件事：「既然优先级图标在很多地方出现，就让它们全部复用同一个组件，
 * 不仅是优先级图标，其他各种地方的组件也要这样复用。」他看到的三个地方——行上、
 * 展开的详情、左栏——在这份文件之前是**三份实现**：`row-line.tsx` 画一枚
 * `.itemPrioChip`，`detail-pane.tsx` 又画一枚同名同形的，`rail.tsx` 再画一枚叫
 * `.itemRailChip` 的，而 `!1` 的数字表（`PRIORITY_DIGIT`）在四个文件里各抄了一份。
 *
 * 抄四份的代价不是「重复四行」——是**改一处不报错**：读者要求「颜色全站同步」时，
 * 有一枚芯片不会跟着变，而屏上不会有人说一句话。
 *
 * ── 记号与选择器是两件事 ──────────────────────────────────────────────────────
 *
 * 这一份是**记号**：它在说「这一条是紧急」。而「让读者挑一档」是**选择器**——那是
 * `.itemOpt` 那一族（展开区与「新建一条」共用同一排按钮），四档里只有一枚被选中，
 * 选中由 `data-on` 说。两者不共用元件是有理由的：一枚记号自己带着它的重量（实心／
 * 洗底／素底／无底），而一排选择器里的四枚必须长得一样，否则「选中」就没有地方落脚
 * ——`item-create-dialog.tsx` 里那段注释记着这次塌方。所以这里只有记号，选择器在
 * 各自的位置上，两者共用的是**同一张数字表**（下面这一份 `PRIORITY_DIGIT`）。
 *
 * 图形的另一半理由写在 `row-line.tsx` 的头部：状态用形状、优先级用字，因为数字是
 * 读者真的会说出口的东西，而自己发明的记号要单独学一遍。
 */
import type { ItemPriority, ItemStatusView } from '../../core/item-view.ts'
import css from './item.module.css'

/** `!1`..`!4`，**唯一一张表**。 从模型那一侧的排序表派生过关系，但数字本身是这一面
 *  的排版决定，所以它住在这里；四个曾经的副本都读这一份。 */
export const PRIORITY_DIGIT: Readonly<Record<ItemPriority, string>> = { urgent: '1', high: '2', normal: '3', low: '4' }

/**
 * 一枚优先级记号。`size` 只有两档，两档都是**同一个芯片**：
 *
 *   `row`  行上与详情里那一枚（默认）。
 *   `rail` 左栏那一枚：小一号。左栏的词已经写着「紧急 / 高 / 普通 / 低」，所以那一栏
 *          里的记号不必再有存在感——而「小一号」是同一个元件的属性，不是第二个元件。
 *
 * `on` 是「读者选了它」的印记（详情那一排），它画的是墨环，不是颜色：颜色的预算是
 * 留给「这一档有多重」的。
 * @param props - 哪一档，哪一档尺寸，是否被选中。
 * @returns 芯片本身；它不是控件，控件由调用点包在外面。
 */
export function PriorityMark(props: {
  readonly priority: ItemPriority
  readonly size?: 'row' | 'rail'
  readonly on?: boolean
}): React.ReactElement {
  return (
    <i
      className={css.itemPrioChip}
      data-tone={props.priority}
      data-size={props.size === 'rail' ? 'rail' : undefined}
      data-on={props.on === true ? '' : undefined}
    >
      !{PRIORITY_DIGIT[props.priority]}
    </i>
  )
}

/**
 * 一条清单行的状态记号：**两个形状，五个颜色**。
 *
 * 形状说这一行自己的那件事（还没做 = 实心点，做完了 = 空心环），颜色说它在**哪一栏**
 * ——而那个颜色就是看板列头那颗点的颜色（`--dsh-tb-status-*`，在 `board.module.css`
 * 的别名层声明一次，两个面板同读）。
 *
 * 为什么不是五个形状：形状是给「扫一眼就分得出」的那一件事用的，而一行上最常被问的
 * 就是「这条完了没有」；至于它在待审核还是在规划，那是**词**的事，词在左栏、在查询
 * 里、在看板上。给五栏各发明一个形状，读者要一次学五个记号，而其中三个他一年用不上
 * 几回——那样的记号不是信息，是噪音。
 * @param props - 这一行现在站在哪一栏。
 * @returns 一枚 10px 的图形。
 */
export function StatusMark(props: { readonly status: ItemStatusView }): React.ReactElement {
  const common = { viewBox: '0 0 10 10', width: 10, height: 10, 'aria-hidden': true } as const
  const colour = `var(--dsh-tb-status-${props.status})`
  if (props.status === 'done') {
    return <svg {...common}><circle cx="5" cy="5" r="3" fill="none" stroke={colour} strokeWidth="1.6" /></svg>
  }
  return <svg {...common}><circle cx="5" cy="5" r="3" fill={colour} /></svg>
}

/**
 * 「这一条挂在一张看板卡上」的那枚记号。
 *
 * 它今天只出现在副行里（一个 9px 的方框）——读者的判断是「一个小方块，看不出是什么」
 * 而且挂了卡之后编号左边多出来一块。它在这里是为了只有一个出处：换形状、换位置、
 * 换成带名字的芯片，都只动这一处。
 * @returns 一枚 9px 的方框。
 */
export function CardMark(): React.ReactElement {
  return (
    <svg className={css.itemRowCard} viewBox="0 0 9 9" width="9" height="9" aria-hidden="true">
      <rect x="1" y="1" width="7" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}
