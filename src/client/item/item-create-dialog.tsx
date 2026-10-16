/**
 * The new-row sheet: the fields, in the order a reader thinks of them.
 *
 * ── WHY IT LOOKS LIKE THIS ───────────────────────────────────────────────────
 *
 * 标题在最上面（一行字就够），下面是**三段可以写很长的话**：正文、步骤、上下文备注；
 * 右列是那张平的清单——优先级、状态、标签、三个日期、挂到哪张卡。
 *
 * ── WHY THERE IS EXACTLY ONE SCROLLER ────────────────────────────────────────
 *
 * The head and the footer stay put and the grid scrolls under them, so the button a
 * reader is about to press is never the thing that scrolled away. With `overflow:
 * hidden` on the sheet and no scroller inside, the last two fields were simply cut
 * off behind the footer on a phone — **a field you cannot reach is not a field.**
 */
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ItemCapture } from '../../core/item-transitions.ts'
import { isBlankCapture } from '../../core/item-transitions.ts'
import type { ItemPriority, ItemStatus } from '../../core/item.ts'
import { ITEM_PRIORITIES_BY_WEIGHT, ITEM_STATUSES, itemDateConflict } from '../../core/item.ts'
import { DATE_FIELD_KEY, DATE_GLOSS_KEY, DATE_HINT_KEY, PRIORITY_LABEL, GROUP_LABEL } from './labels.ts'
import { CrossMark, PriorityMark } from './marks.tsx'
import { NoteEntry, useNote } from './group-head.tsx'
import type { DateDraft } from './model.ts'
import { readDateDraft } from './model.ts'
import { DateField } from './date-field.tsx'
import { ProseField } from './prose-field.tsx'
import { t } from '../locales.ts'
import { Button } from '../design/ui.tsx'
import { TagField, tagName } from './tag-field.tsx'
import { AttachmentStrip } from '../design/AttachmentStrip.tsx'
import { attachBusyLabel, refsOf, useComposerAttachments, type AttachmentAdmitter } from '../board/composer-attachments.ts'
import { MAX_ITEM_FILES, MAX_ITEM_IMAGES, TASK_IMAGE_BUDGET } from '../board/attach.ts'
import { useDialogFocus } from '../design/dialog-focus.ts'
import { useEscapeStack } from '../design/escape-stack.ts'
import css from './item.module.css'

/** 四档，按重量排（最重的在最左）：顺序来自模型，不在这里重排一遍。 */
const PRIORITIES: readonly ItemPriority[] = ITEM_PRIORITIES_BY_WEIGHT

/**
 * 三个日期，**按这张纸画它们的顺序**。
 *
 * 它是一次声明而不是三处各写一遍：拒绝之后要说的那句「第一个读不懂的那一格」，其中的
 * 「第一个」是读者眼睛先到的那个——在三个地方各排一次序，就是三个不同的「第一个」。
 * 这一张纸上的三个框、它们各自的词、以及提交时读的那一遍，都从这一份声明长出来。
 */
const DATE_FIELDS = ['startsAfter', 'dueAt', 'hardDueAt'] as const

/** 那三个字段名，只有一处用得上（这张纸的状态、以及提交时那一遍读）。 */
type DateKey = typeof DATE_FIELDS[number]

/** 三个框一开始都是空的：一份，而不是三次 `useState('')`。 */
const NO_DATES: Readonly<Record<DateKey, string>> = { startsAfter: '', dueAt: '', hardDueAt: '' }

export interface ItemCreateDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  /**
   * THE WRITING CLOCK, so `@明天` in the grammar resolves against a fixed now.
   *
   * It is a PROP and not a call to `Date.now()` inside the parser, because that clock
   * decides what a date the reader typed MEANT. A test that cannot set it cannot pin
   * `@明天`, and a host that cannot set it cannot replay one.
   */
  readonly now: number
  /** Cards the row may hang on, by id. */
  readonly cards: readonly { readonly id: string; readonly title: string }[]
  /**
   * ONE TRACK, TWO WRITES. The finished capture, and the second arg is 「挂到一张新卡」:
   * the strip asked for a name and the reader gave one. It is handed to the SAVE,
   * not acted on here — the card and the row are born in the same promotion
   * (one plan, two writes, one receipt), so a sheet that was dismissed halfway
   * never leaves a half-named empty card on the board. `false` means it was
   * refused; the words the reader typed are still in the fields, because a
   * dialog that throws away half-written work on dismissal is a dialog nobody
   * experiments in.
   */
  readonly onCreate: (input: ItemCapture, newCard?: string) => boolean
  /**
   * **写作框那个数，与详情里那五个是一份。**
   *
   * 它是视图偏好（同一台设备上一个尺寸），所以从面板下来、拖完原路回去；这张纸与
   * 展开区共用同一个控件，也就共用同一个尺寸——不然「同一个东西」会在这两处差一截。
   */
  readonly proseHeight?: number
  readonly onProseHeight?: (px: number) => void
  /**
   * 收进官方附件库的那一次上传，与展开区那一栏**是同一个能力**（同一个钩子、同一条路由）。
   * 没有它（没接上看板、宿主没接上附件库）时，「＋」照样在，点它会明说收不了。
   */
  readonly admit?: AttachmentAdmitter
  /**
   * 「新建卡片」那一档的运行配置——**由面板装配好递进来**（与批量条那一块同一个形状）：
   * 这一格组件不该知道看板控制器、预设存储长什么样，而那一块要读目录与预设库才有五行可写。
   *
   * **只在「新建卡片」那一档画它。** 另两档没有它的位置，理由各一句：不挂 = 没有卡、也没有
   * 东西要跑（读者真要跑的时候，那一行自己那份草稿就在行上）；挂已有卡 = 那张卡本来就有自己
   * 的一份，而这张纸的律是「卡里的内容不动」。
   *
   * **是个 thunk，不是一块现成的元素**：那一块的装配要读目录与预设库，而这张纸是常驻组件
   * ——写成 `expr && <X/>` 的话，读者还没开纸、还没选那一档，表达式就已经求值过一次了。
   */
  readonly cardConfigSlot?: () => ReactNode
}

/**
 * The sheet.
 * @param props - whether it is open, the two hand-offs, the cards and the clock.
 * @returns the overlay, or nothing.
 */
export function ItemCreateDialog(props: ItemCreateDialogProps) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [notes, setNotes] = useState('')
  const [steps, setSteps] = useState('')
  const [priority, setPriority] = useState<ItemPriority>('normal')
  /* **五档都在，与展开区那一格是同一张表。**
   *
   * 这一格写的是条目**自己**的状态字段，而它自己的字段就是五档（`ITEM_STATUSES`）；
   * `MANUAL_STATUSES` 管的是「人能按的」，不是「字段能取的」。两张表不是同一张，而两处
   * 界面读的是同一张。 */
  const [status, setStatus] = useState<ItemStatus>('todo')
  const [dates, setDates] = useState<Readonly<Record<DateKey, string>>>(NO_DATES)
  /**
   * **读不懂的日期一个也不许悄悄丢掉。**
   *
   * `parseItemDate` 的 `undefined` 一旦被铺进 capture，读者写的「明天」没被读懂时就变成
   * `{ dueAt: undefined }`——条目照建、日期没了、屏上没有一个字解释。所以两处读同一个
   * 判定（`readDateDraft`）、说同一行字（`DateField`），而这一份状态只管一件事：**哪几个框正在说那句话**。
   */
  const [badDates, setBadDates] = useState<ReadonlySet<string>>(new Set())
  /** 三个日期框的焦点把手：拒绝之后光标要落在**第一个**读不懂的那一格里。 */
  const dateFields = useRef<Record<string, HTMLInputElement | null>>({})
  const [tags, setTags] = useState('')
  const [taskId, setTaskId] = useState('')
  /**
   * 「挂到一张新卡」：名字收在表单里，卡在记下时才建成。
   *
   * 在这里立刻建卡说起来更快，可表单是**正在写的那一句**——半路取消的表单不能
   * 在看板上留一张名存实亡的空卡。名字先收下，提交那一下再用同一次提升把卡和
   * 这一行一起落：计划、写、回执，都走的是面板上同一个提升入口。
   */
  const [pendingCard, setPendingCard] = useState<string | undefined>(undefined)
  const [cardNaming, setCardNaming] = useState(false)
  const [cardDraft, setCardDraft] = useState('')
  const [cardHint, setCardHint] = useState(false)
  const cardNameField = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (cardNaming) cardNameField.current?.focus()
  }, [cardNaming])
  const [words, setWords] = useState('')
  /**
   * 正文那一段的附件，**与展开区那一栏是同一个账本**（同一个钩子、同一组上限、同一句话）。
   *
   * 这一张纸是**还没出生的记录**，所以它自己保管（非受控）：没有可供往返的文档字段，
   * 存下那一下才把 ref 交给 capture 一起落。取消就是整张纸一起作废——附件也不例外。
   */
  const attach = useComposerAttachments({
    budget: TASK_IMAGE_BUDGET,
    maxImages: MAX_ITEM_IMAGES,
    maxFiles: MAX_ITEM_FILES,
    ...props.admit !== undefined ? { admit: props.admit } : {},
  })
  const { setAttachments: clearAttachments } = attach
  /** 「挂卡会动到什么」那一句的把手——按需出现，理由在下面那一行旁边。 */
  const cardNote = useNote(t('item.cardLink.why'))
  const sheet = useRef<HTMLDivElement | null>(null)
  const titleField = useRef<HTMLInputElement | null>(null)
  /* Tab stays inside the sheet, and closing hands focus back to whoever opened
     it — the two things `aria-modal` promises. Escape rides the shared stack. */
  const { onKeyDown: onSheetKeyDown } = useDialogFocus(sheet)
  useEscapeStack(props.onClose)

  /* THE WHOLE FORM GOES BACK TO ITS OPENING STATE.
   *
   * It is per-SHEET, not per-mount: the component stays mounted while `open` is
   * false, so a field left over from the last sheet would greet the next reader as
   * their own words. */
  useEffect(() => {
    if (!props.open) return
    setTitle(''); setBody(''); setNotes(''); setSteps(''); setPriority('normal'); setStatus('todo')
    setDates(NO_DATES); setTags(''); setTaskId(''); setWords('')
    setBadDates(new Set())
    setPendingCard(undefined); setCardNaming(false); setCardDraft(''); setCardHint(false)
    clearAttachments([])
    titleField.current?.focus()
  }, [props.open, clearAttachments])

  /** 「一行一步」变成清单：**两种写法都认**。
   *
   * 光一行就是一步；`- [x] 一句话` 是已经勾上的一步——那个记号是这一格的写法，
   * 不是「快记一行」的遗留（那一行整条已经删掉了）。 */
  const stepList = (): ItemCapture['steps'] =>
    steps.split('\n').map(line => line.trim()).filter(line => line !== '').map(line => {
      const box = /^[-*]\s*\[\s*([ xX]?)\s*\]\s*(.+)$/.exec(line)
      return box === null ? { text: line } : { text: (box[2] as string).trim(), done: (box[1] ?? '').toLowerCase() === 'x' }
    })

  /**
   * **这一格里现在是哪几个标签**：一处定义，四处读（芯片、去掉一枚、回车定型、存下去）。
   *
   * 四段各写一遍 `split().map().filter()` 的代价不是那几行，是**其中一处会先改**：加宽分隔符、
   * 剥掉 `#`（见 `tagName`）这类改动只会落在它记得的那一处，而另外三处读的还是旧规矩——
   * 于是同一格里「屏幕说有五个、存下去只有四个」。
   */
  const tagList = (): string[] =>
    tags.split(/[、,，]/).map(tagName).filter(one => one !== '')

  /**
   * **这一格里写着的日期**，一个字段一次读——提交与「这一组自相矛盾吗」读的是同一遍。
   *
   * 三个字段各有一次读、一次判：`readDateDraft` 的 `undefined` 一旦被铺进 capture，
   * 读者写的「明天」没被读懂时就变成 `{ dueAt: undefined }`——条目照建、日期没了、
   * 屏上没有一个字解释。所以读不懂的那一格不进 capture，而它说的话由 `DateField` 说。
   */
  const draftOf = (key: DateKey): DateDraft => readDateDraft(dates[key], props.now)

  /** 三个框里现在**读得懂**的那些日期：用来问一个已有的判定（这一组自己矛盾吗）。 */
  const datedAt = (key: DateKey): number | undefined => {
    const draft = draftOf(key)
    return draft.kind === 'at' ? draft.at : undefined
  }
  const conflict = itemDateConflict({ startsAfter: datedAt('startsAfter'), dueAt: datedAt('dueAt'), hardDueAt: datedAt('hardDueAt') })

  /**
   * **存下这一条**；返回这次到底存没存——文法行那根回车读的就是它，拒绝时读者的半句话
   * 必须留在框里。
   */
  const submit = (): boolean => {
    /* **先把三个日期读一遍，读不懂就不存。** 判定与展开区那一栏是同一个
     * （`readDateDraft`），说法也是同一句（`DateField`）；这里多做的一件事只是**把光标
     * 送到第一个读不懂的那一格**，因为这一张纸会滚，而按钮在底部——把原因留在看不见的
     * 地方等于没说。 */
    const wrong = DATE_FIELDS.filter(key => draftOf(key).kind === 'bad')
    if (wrong.length > 0) {
      setBadDates(new Set(wrong))
      setWords(t('item.create.dateBad'))
      dateFields.current[wrong[0] as string]?.focus()
      return false
    }
    /** 一个日期进 capture 的形状：空着就一个字都不提，读懂了就带上——**读不懂的到不了
     *  这里**（上面已经拒绝并返回了）。 */
    const dated = (key: DateKey): Partial<ItemCapture> => {
      const at = datedAt(key)
      return at === undefined ? {} : { [key]: at }
    }
    const input: ItemCapture = {
      title: title.trim(),
      body,
      attachments: refsOf(attach.attachments),
      notes,
      origin: 'human',
      status,
      priority,
      steps: stepList(),
      tags: tagList(),
      ...dated('startsAfter'),
      ...dated('dueAt'),
      ...dated('hardDueAt'),
      /* 选一张新卡与选一张已有的卡互斥：两个处理器各清对方的那一份，所以
         `taskId` 这一份在这里就是全部——挂新卡的那一份由提升自己写。 */
      ...(taskId === '' ? {} : { taskId }),
    }
    // The refusal is decided by the SHARED emptiness rule and it says why, in
    // place: the reader typed a priority and no words, and the sheet must not answer
    // that with a row that has no name.
    if (isBlankCapture(input)) { setWords(t('item.create.blank')); return false }
    const saved = props.onCreate(input, pendingCard)
    if (saved) props.onClose()
    else setWords(t('item.create.refused'))
    return saved
  }

  if (!props.open) return null

  return (
    <div
      className={css.itemOverlayMask}
      onPointerDown={event => { if (event.target === event.currentTarget) props.onClose() }}
    >
      <div
        ref={sheet}
        className={css.itemCreateDialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('item.create.title')}
        /* THE ONE FOCUS IMPLEMENTATION, not a second one. `aria-modal` is a
           promise that the rest of the page is inert to the keyboard, and this
           sheet was making that promise without keeping it: Tab walked straight
           out into the list behind the mask, and closing dropped focus on
           `<body>` because the sheet unmounts rather than restoring. Both are
           what `dialog-focus.ts` exists for — it traps Tab, and it returns focus
           to whoever opened the sheet. Escape comes from the shared stack for
           the same reason: one layer, one escape, no per-surface copy. */
        onKeyDown={onSheetKeyDown}
      >
        <header className={css.itemCreateDialogHead}>
          <h2 className={css.itemCreateDialogTitle}>{t('item.create.title')}</h2>
          {/* THE CROSS IS ONE SHAPE, DRAWN ONCE — see `marks.tsx` 的 `CrossMark`：同一枚记号
              只画一遍：这里与筛选芯片读同一个元件，尺寸是属性——「× 当字符会坐在字体基线上，
              框居中了、字没居中」这条教训因此只有一处。 */}
          <button
            type="button"
            className={css.itemCreateDialogClose}
            aria-label={t('item.sheet.close')}
            onClick={props.onClose}
          >
            <CrossMark size={14} />
          </button>
        </header>

        <div className={css.itemCreateDialogGrid} data-dsh-tb-scroll="">
          <div className={css.itemCreateDialogMain}>
            {/* **标题是这张纸的第一格**，与右列第一格（优先级）同一条线：两列从同一处开始，
                读者一眼看到的是「左边写什么、右边定什么」。 */}
            <label className={css.itemCreateDialogField}>
              <span className={css.itemCreateDialogLabel}>{t('item.field.title')}</span>
              <input
                ref={titleField}
                className={css.itemCreateDialogTitleField}
                value={title}
                placeholder={t('item.create.titlePlaceholder')}
                aria-label={t('item.field.title')}
                onChange={event => { setTitle(event.target.value) }}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit() } }}
              />
            </label>

            {/* **正文这一段有两个控件**（写字的框、挂附件的条），所以外面这一格是 `<div>`
                而不是 `<label>`：一个 label 只能认一个控件，而它会把条上每一枚按钮的点击都
                转给那个文本框。里面的 label 仍然把名字与写入框绑在一起（点名字就落光标），
                两格的几何都读同一个类，所以这一块看上去仍然是一个字段。 */}
            <div className={css.itemCreateDialogField} {...attach.dropProps}>
              <label className={css.itemCreateDialogField}>
                <span className={css.itemCreateDialogLabel}>{t('item.field.body')}</span>
                {/* 与展开区那一栏是**同一个写入框**（`prose-field.tsx`）：同一个地板、同一个
                    高度、同一条横贯下沿的抓条、同一个数（读者拉过的那个）。这一张纸只是把
                    它画成竖排的一张表单，而不是另一个长得像它的盒子。 */}
                <ProseField
                  value={body}
                  onChange={setBody}
                  placeholder={t('item.field.bodyHint')}
                  ariaLabel={t('item.field.body')}
                  height={props.proseHeight}
                  onHeight={props.onProseHeight}
                />
              </label>
              {/* 附件在**同一个字段里**：它是正文那一段的一部分，不是这张纸的第 7 个字段
                  ——展开区那一栏也是这么摆的（同一个组件、同一句话）。 */}
              <AttachmentStrip
                attachments={attach.attachments}
                onAdd={attach.addFiles}
                onRemove={id => { clearAttachments(attach.attachments.filter(chip => chip.id !== id)) }}
                busy={attach.busy}
                busyLabel={attach.busy ? attachBusyLabel(attach.busyKind) : undefined}
                error={attach.error}
              />
            </div>

            <label className={css.itemCreateDialogField}>
              <span className={css.itemCreateDialogLabel}>{t('item.create.steps')}</span>
              {/* 步骤在这里是**写下一串**（一行一步），不是展开区那张可以勾、可以挪的清单
                  ——那是同一件事的两个时刻：还没有这一条的时候，没有东西可以勾。变的是读法，
                  写字的那个盒子是同一个。 */}
              <ProseField
                value={steps}
                onChange={setSteps}
                placeholder={t('item.create.stepsPlaceholder')}
                ariaLabel={t('item.create.steps')}
                height={props.proseHeight}
                onHeight={props.onProseHeight}
              />
            </label>

            <label className={css.itemCreateDialogField}>
              <span className={css.itemCreateDialogLabel}>{t('item.field.notes')}</span>
              <ProseField
                value={notes}
                onChange={setNotes}
                placeholder={t('item.field.notesHint')}
                ariaLabel={t('item.field.notes')}
                height={props.proseHeight}
                onHeight={props.onProseHeight}
              />
            </label>
          </div>

          <div className={css.itemCreateDialogSide}>
            <div className={css.itemOptRow}>
              <p className={css.itemOptName}>{t('item.field.priority')}</p>
              <div className={css.itemOpts}>
                {PRIORITIES.map(one => (
                  /* **与行上、左栏、展开区是同一枚记号。**
                   *
                   * **颜色是读者要的那件事**（四档一眼分得出），所以这一排不许退成
                   * `.itemOpt`（词族）——那套的理由是「四枚记号各带各的重量，选中没地方落脚」，
                   * 而这一条由记号自己解决：`PriorityMark` 的 `data-on` 画的是**一圈墨环**，
                   * 与颜色无关。
                   */
                  <button
                    key={one}
                    type="button"
                    className={css.itemPrioButton}
                    aria-pressed={priority === one}
                    title={t(PRIORITY_LABEL[one])}
                    onClick={() => { setPriority(one) }}
                  >
                    <PriorityMark priority={one} on={priority === one} />
                  </button>
                ))}
              </div>
            </div>

            <div className={css.itemOptRow}>
              <p className={css.itemOptName}>{t('item.field.status')}</p>
              <div className={css.itemOpts}>
                {/* 新建的一行**还没有卡**，所以这里是清单自己能写的两个值——派生的那张表
                    是 `ITEM_STATUSES`，不是一张抄下来的字面量数组。 */}
                {ITEM_STATUSES.map(one => (
                  <button
                    key={one}
                    type="button"
                    className={css.itemOpt}
                    data-on={status === one ? '' : undefined}
                    aria-pressed={status === one}
                    onClick={() => { setStatus(one) }}
                  >
                    <span className={css.itemPillText} data-dsh-tb-pilltext>{t(GROUP_LABEL[one])}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={css.itemOptRow}>
              <p className={css.itemOptName}>{t('item.field.tags')}</p>
              <div className={css.itemOpts}>
                {tagList().map(one => (
                  <button
                    key={one}
                    type="button"
                    className={css.itemTag}
                    onClick={() => { setTags(tagList().filter(x => x !== one).join('、')) }}
                  >
                    <span className={css.itemPillText} data-dsh-tb-pilltext>#{one}</span>
                  </button>
                ))}
                <TagField
                  value={tags}
                  placeholder={t('item.field.tagsHint')}
                  ariaLabel={`${t('item.field.tags')}：${t('item.field.tagsHint')}`}
                  onChange={setTags}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                    event.preventDefault()
                    // 回车把读者敲的写法收拢给他看：逗号并成顿号、去掉空段、`#` 去掉。
                    // 芯片是实时读这一行的，回车的活儿是「写法定型」——与详情页同一控件
                    // 的回车是「加上」，这里的同一根键不该什么反应都没有。
                    setTags(tagList().join('、'))
                  }}
                />
              </div>
            </div>

            {/* **三个日期：共用元件、共用判定、共用那句话，也共用这一行形状。**
                每一格是「字段名 + 那一句注解」在上、框在下，框下是它读出来的那个日期或者
                它读不懂的那句拒绝（见 `date-field.tsx`）。三格由 `DATE_FIELDS` 那**一份
                声明**长出来，所以纸上的顺序、字段名、注解、占位之间不可能彼此错位。 */}
            {DATE_FIELDS.map(key => (
              <label key={key} className={css.itemCreateDialogDate}>
                <span className={css.itemCreateDialogLabel}>
                  {t(DATE_FIELD_KEY[key])}
                  <b className={css.itemFieldGloss}>{t(DATE_GLOSS_KEY[key])}</b>
                </span>
                <DateField
                  value={dates[key]}
                  onChange={value => {
                    setDates(current => ({ ...current, [key]: value }))
                    setBadDates(current => new Set([...current].filter(one => one !== key)))
                  }}
                  hint={t(DATE_HINT_KEY[key])}
                  ariaLabel={`${t(DATE_FIELD_KEY[key])}：${t(DATE_HINT_KEY[key])}`}
                  now={props.now}
                  bad={badDates.has(key)}
                  onEnter={submit}
                  focusRef={node => { dateFields.current[key] = node }}
                />
              </label>
            ))}

            {/* **这一格里只说一件事，而且是最要紧的那一件。**
             *
             * 平时说的是读者问的第一个问题：「三个是不是重复了、能不能只写一个」——答案就在
             * 那三个字段名、三句注解和这一行里。三个日期互相矛盾时，同一处换成那句判词
             * （与行尾、与详情说的是**同一句话**：`itemDateConflict` 是同一个判定）。
             *
             * **矛盾照样存得下。** 拦住这一下会把读者卡在一个他还没想好的顺序里（先改哪一个
             * 都错），而落进文档之后行尾自己会说同一句话——把话说出去，比把人拦在门外便宜。 */}
            <p className={css.itemCreateDialogNote} data-warn={conflict === undefined ? undefined : ''}>
              {conflict === undefined
                ? t('item.create.datesAny')
                : t('item.dates.contradict', { a: t(DATE_FIELD_KEY[conflict.field]), b: t(DATE_FIELD_KEY[conflict.limitField]) })}
            </p>

            {/* **三个日期的关系与两扇门的关系，都按需说。**
                这一格一句常驻的解释有五行，而它回答的是读者**问出来之后**才有的问题
                （「挂卡会动到什么」）——所以它挂在自己那一行上的一枚 `InfoMark` 后面：
                指着字段名偷看一句，按下或聚焦真开（触屏只有这一条路）。 */}
            <div className={css.itemOptRow} data-note={cardNote.open ? '' : undefined}>
              <p className={css.itemOptName} data-note-hover="">
                {/* **字段名自己是一枚盒子**（`.itemOptNameText`）：它与那枚 ⓘ 同一条线，而这一行
                    按中线把两者各自居中——记号绕 viewBox 中心对称，字装在它自己的盒子里。 */}
                <span className={css.itemOptNameText}>{t('item.field.taskId')}</span>
                <NoteEntry note={cardNote} />
              </p>
              <div className={css.itemOpts}>
                <button
                  type="button"
                  className={css.itemOpt}
                  data-on={taskId === '' && pendingCard === undefined ? '' : undefined}
                  aria-pressed={taskId === '' && pendingCard === undefined}
                  onClick={() => { setTaskId(''); setPendingCard(undefined) }}
                >
                  {t('item.field.noCard')}
                </button>
                {props.cards.map(card => (
                  <button
                    key={card.id}
                    type="button"
                    className={css.itemOpt}
                    data-on={pendingCard === undefined && taskId === card.id ? '' : undefined}
                    aria-pressed={pendingCard === undefined && taskId === card.id}
                    onClick={() => { setTaskId(card.id); setPendingCard(undefined) }}
                  >
                    {card.title}
                  </button>
                ))}
                {cardNaming ? (
                  <input
                    ref={cardNameField}
                    className={css.itemOptNaming}
                    size={13}
                    value={cardDraft}
                    placeholder={t('item.cardName.label')}
                    aria-label={t('item.cardName.label')}
                    data-dsh-tb-keys="Enter Escape"
                    onChange={event => { setCardDraft(event.target.value); setCardHint(false) }}
                    onKeyDown={event => {
                      if (event.nativeEvent.isComposing) return
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        const name = cardDraft.trim()
                        if (name === '') { setCardHint(true); return }
                        setPendingCard(name)
                        setTaskId('')
                        setCardNaming(false)
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        setCardNaming(false)
                      }
                    }}
                    onBlur={() => setCardNaming(false)}
                  />
                ) : (
                  <button
                    type="button"
                    className={css.itemOpt}
                    data-add=""
                    onClick={() => { setCardNaming(true); setCardDraft(pendingCard ?? '') }}
                  >
                    {t('item.field.newCard')}
                  </button>
                )}
                {/* 这是一枚正在「等着记下」的卡：它还不在看板上，但这一条挂哪已经
                    答完。字形与已选的卡同一档（data-on），因为对读者而言它已经是
                    答案；名字进来的一下起名框收起，答案留在原地。 */}
                {!cardNaming && pendingCard !== undefined && (
                  <button
                    type="button"
                    className={css.itemOpt}
                    data-on=""
                    aria-pressed
                    onClick={() => { setPendingCard(undefined); setCardNaming(true); setCardDraft(pendingCard) }}
                  >
                    {pendingCard}
                  </button>
                )}
                {cardHint && <p className={css.itemOptHint}>{t('item.cardName.empty')}</p>}
                {/* **卡是在这里诞生的**：选了「新建卡片」之后，那张卡带着什么跑就该让读者看见
                    （折叠头上一句摘要，展开是那五行，再点「改」是那几个下拉）。它在纸上的位置
                    与「不挂 / 已有卡」无关——那两档不画它，见 props 上那一段。 */}
                {pendingCard !== undefined && pendingCard !== '' && props.cardConfigSlot?.()}
                {/* 与详情选择器同一句真相：两边只该有一个说法，而说法只有一处。 */}
                <p className={css.itemNote} id={cardNote.id}>{t('item.cardLink.note')}</p>
              </div>
            </div>
          </div>
        </div>

        {words !== '' && <p className={css.itemHint} role="status">{words}</p>}

        <footer className={css.itemCreateDialogFoot}>
          <Button variant="ghost" size="sm" onClick={props.onClose}>{t('item.create.cancel')}</Button>
          <Button variant="primary" size="sm" onClick={submit}>{t('item.create.submit')}</Button>
        </footer>
      </div>
    </div>
  )
}