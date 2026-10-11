/**
 * 一枚「这一组是这些」的头：**记号 + 词 + 条数**（有日期的那几节再带一个读数）。
 *
 * ── 为什么两个页面共用它 ──────────────────────────────────────────────────────
 *
 * 清单页的日分段与日程页的节头说的是同一件事：一个名字、它下面有几条、（按天分的那些）
 * 那一天是几号。在这份文件之前它们是**两处内联实现**（`item-table.tsx` 里一枚
 * `.itemDayHead`、`schedule.tsx` 里一枚 `.itemAgendaHead`）：同形状、同事、两份几何、
 * 两处各自的微调。代价不是那几行标记，是**同一个毛病在两个页面上长得不一样**——
 * 「字与图标差半像素」在日分段上是一个样子、在节头上是另一个样子，而修一处不修另一处。
 *
 * 所以形状、记号槽、对齐律与光学补偿都只有一份（都在 `item.module.css` 的
 * `.itemGroupHead` 那一条里），两个页面只剩两样**性质上的**差别：
 *
 *   `size`  `section` 是 15/600（日程页：节是这一页的骨架，它下面可能有几十行）；
 *           `segment` 是 13/600（清单页：行才是主角，日分段只是行与行之间的一道缝）。
 *           **这是同一个元件的一个属性，不是第二个元件**——与 `PriorityMark` 的
 *           `row | rail` 同一条律。
 *   `as`    `heading` 渲染 `<h2>`（日程页：一块内容有一个名字，读屏要靠它跳节）；
 *           `presentation` 渲染 `role="presentation"`（清单页：那些行本身是一个
 *           `role="list"`，而这枚头是对它们的说明，不是其中一项）。
 *
 * ── 词与数从外面进来 ─────────────────────────────────────────────────────────
 *
 * 这一份不认识字典：`word` 与 `count` 都是**已经说好的字**（`count` 收字符串而不是数字，
 * 因为清单页说的是「3 条」而日程页只写「3」——那是词的事，词归各处的字典）。
 * 一个组件自己去查表，就会长出第二本词表。
 *
 * ── 谁按得动 ─────────────────────────────────────────────────────────────────
 *
 * 头本身按不动（所以它不是按钮），**但一句要解释的话，入口在头里**（`note`）：一枚
 * `InfoMark` 包在真按钮里，悬停、聚焦、按下都能把它叫出来，`aria-expanded` 与
 * `aria-controls` 说清它开没开、说的是哪一句。触屏没有悬停，所以入口必须是一枚控件
 * ——必要的信息不许只挂在 `title=` 上。
 */
import { useId, useState } from 'react'
import { GroupMark, InfoMark, type ItemMarkId } from './marks.tsx'
import css from './item.module.css'

/** 那一句解释的把手：谁来开、开没开、说的是哪一块。 */
export interface GroupNoteHandle {
  /** 那句话所在元素的 id（`aria-controls` 指过去）。 */
  readonly id: string
  readonly open: boolean
  readonly onToggle: () => void
  /** 这枚按钮的可达名——它要说清叫出来的是**哪一句**，而不是「按钮」。 */
  readonly label: string
}

/**
 * 一句按需解释的**一个实例**：它自己的开关、它自己的 id。
 *
 * `useId` 而不是手写字符串：这个面板可以在同一页里出现两次（看板与清单各一个舞台），
 * 手写的 id 会在第二份里撞车，而撞车之后 `aria-controls` 指向的是**另外那一份的那句话**。
 *
 * 它住在这一份文件里而不是各页各写一遍：三个消费点（日程页两种节头、安静行、新建那张纸
 * 的看板卡片）用的是**同一件事**，而三份 `useState` 里迟早有一份忘了复位。
 * @param label - 这枚按钮的可达名。
 * @returns 那枚按钮要的把手（`id` 与 `open` 也在里面，容器读它挂 `data-note`）。
 */
export function useNote(label: string): GroupNoteHandle {
  const id = useId()
  const [open, setOpen] = useState(false)
  return { id, open, onToggle: () => setOpen(current => !current), label }
}

export interface GroupHeadProps {
  /** 谁在说话：一块内容的题，还是一段列表的说明。 */
  readonly as?: 'heading' | 'presentation'
  /** 字阶两档，见文件头。 */
  readonly size?: 'section' | 'segment'
  /** 这一组戴哪一枚记号；不戴就给 `undefined`（不是每一组都有记号可戴）。 */
  readonly mark?: ItemMarkId
  readonly word: string
  readonly count: string
  /** 按天分的那几节：那一天的读数。 */
  readonly when?: string
  readonly note?: GroupNoteHandle
}

/**
 * 一枚组头。
 * @param props - 谁在说话、字阶、记号、词、数、日期，以及那句解释的把手。
 * @returns 那一行头。
 */
export function GroupHead(props: GroupHeadProps): React.ReactElement {
  const heading = props.as !== 'presentation'
  const size = props.size ?? 'segment'
  const body = (
    <>
      {props.mark !== undefined && <GroupMark mark={props.mark} size={size === 'section' ? 12 : 11} />}
      {/* **几块字装在一个盒子里，那个盒子按基线对齐自己的内容。**
       *
       * 一枚组头里常常有两种字：词（15/600 中文）与条数（13 数字）。容器按盒子居中的时候，
       * 中文与拉丁**各自坐在自己的行盒里**——两套字体度量不同，于是两串字的基线差着将近
       * 一个像素（量出来的：词 99、数 98）。这一枚盒子 `align-items: baseline` 把基线对齐
       * 变成构造性质：换了字体、换了字号都一样。
       *
       * 而**横向的光学补偿挂在这一枚盒子上**（不是挂在外面的药丸上）：外面的药丸同时还装
       * 着记号，把药丸的内容盒整体抬高半格会连记号一起抬高——而记号本来就居中。 */}
      <span className={css.itemGroupText}>
        <b>{props.word}</b>
        <i className={css.itemGroupCount}>{props.count}</i>
        {props.when !== undefined && <span>· {props.when}</span>}
      </span>
      {props.note !== undefined && (
        <button
          type="button"
          className={css.itemGroupWhy}
          aria-expanded={props.note.open}
          aria-controls={props.note.id}
          aria-label={props.note.label}
          onClick={props.note.onToggle}
        >
          <InfoMark size={size === 'section' ? 15 : 14} />
        </button>
      )}
    </>
  )
  const shared = {
    className: css.itemGroupHead,
    'data-size': size,
    // 指着这枚组头就偷看它那句解释（`item.module.css` 那条 `data-note-hover` 规则）。
    ...(props.note === undefined ? {} : { 'data-note-hover': '' }),
  }
  return heading
    ? <h2 {...shared}>{body}</h2>
    : <div {...shared} role="presentation">{body}</div>
}
