/**
 * The new-row sheet: one sentence at the top, and everything it did not say below.
 *
 * ── WHY IT LOOKS LIKE THIS ───────────────────────────────────────────────────
 *
 * The sheet has ONE door and it is the first line. That line is the capture
 * grammar — `#画廊 !1 @明天` — and it fills six fields at once, which is why it is
 * the loudest input on the sheet and why everything below it is a field rather
 * than a form: **the reader who already has the sentence types it once; the reader
 * who does not fills the fields**, and neither has to learn the other's way.
 *
 * So the left column is three paragraphs — the sentence, the body, the notes — and
 * the right column is the flat list of everything the sentence did not say. Not a
 * form with a title field at the top and six more below: a title field duplicates
 * the sentence, and a reader who typed both has to decide which one is the truth.
 *
 * ── WHY THERE IS EXACTLY ONE SCROLLER ────────────────────────────────────────
 *
 * The head and the footer stay put and the grid scrolls under them, so the button a
 * reader is about to press is never the thing that scrolled away. With `overflow:
 * hidden` on the sheet and no scroller inside, the last two fields were simply cut
 * off behind the footer on a phone — **a field you cannot reach is not a field.**
 */
import { useEffect, useRef, useState } from 'react'
import type { ItemCapture } from '../../core/item-transitions.ts'
import { isBlankCapture } from '../../core/item-transitions.ts'
import type { ItemPriority, ItemStatus } from '../../core/item.ts'
import { ITEM_PRIORITIES_BY_WEIGHT, ITEM_STATUSES } from '../../core/item.ts'
import { PRIORITY_LABEL, GROUP_LABEL } from './labels.ts'
import { CrossMark, PriorityMark } from './marks.tsx'
import { ItemComposer } from './composer.tsx'
import type { ComposerParse } from './compose-parse.ts'
import { readDateDraft, toItemDateField } from './model.ts'
import { DateField } from './date-field.tsx'
import { ProseField } from './prose-field.tsx'
import { t } from '../locales.ts'
import { Button } from '../board/ui.tsx'
import { TagField } from './tag-field.tsx'
import css from './item.module.css'

/** 四档，按重量排（最重的在最左）：顺序来自模型，不在这里重排一遍。 */
const PRIORITIES: readonly ItemPriority[] = ITEM_PRIORITIES_BY_WEIGHT

/**
 * 三个日子，**按这张纸画它们的顺序**。
 *
 * 它是一次声明而不是三处各写一遍：拒绝之后要说的那句「第一个读不懂的那一格」，其中的
 * 「第一个」是读者眼睛先到的那个——在三个地方各排一次序，就是三个不同的「第一个」。
 */
const DATE_FIELDS = ['startsAfter', 'dueAt', 'hardDueAt'] as const

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
  const [startsAfter, setStartsAfter] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [hardDueAt, setHardDueAt] = useState('')
  /**
   * **读不懂的日子一个也不许悄悄丢掉。**
   *
   * `parseItemDate` 的 `undefined` 一旦被铺进 capture，读者写的「明天」没被读懂时就变成
   * `{ dueAt: undefined }`——条目照建、日子没了、屏上没有一个字解释。所以两处读同一个
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
  const [parsed, setParsed] = useState<ComposerParse | undefined>(undefined)
  const [words, setWords] = useState('')
  const sheet = useRef<HTMLDivElement | null>(null)
  const titleField = useRef<HTMLInputElement | null>(null)

  /* THE WHOLE FORM GOES BACK TO ITS OPENING STATE, `touched` INCLUDED.
   *
   * `touched` is what stops the grammar line from overwriting a field the reader
   * corrected by hand — and it is per-SHEET, not per-mount: the component stays
   * mounted while `open` is false. Leaving it out of this reset meant that after
   * ONE hand-edit in ONE sheet, every later sheet started with that field marked
   * as touched, so the grammar could never seed it again. The symptom is a form
   * that stops listening to its own first line, and nothing on screen says why. */
  useEffect(() => {
    if (!props.open) return
    setTitle(''); setBody(''); setNotes(''); setSteps(''); setPriority('normal'); setStatus('todo')
    setStartsAfter(''); setDueAt(''); setHardDueAt(''); setTags(''); setTaskId(''); setWords('')
    setBadDates(new Set())
    setPendingCard(undefined); setCardNaming(false); setCardDraft(''); setCardHint(false)
    setParsed(undefined)
    setTouched(new Set())
    titleField.current?.focus()
  }, [props.open])

  /**
   * THE GRAMMAR FILLS THE FORM, ONCE PER KEYSTROKE, AND ONLY WHERE THE READER
   * HAS NOT LOOKED YET.
   *
   * Seeding on every keystroke is right because it is the only moment the two sides
   * are guaranteed to agree: the reader is looking at the sentence they are typing.
   * Seeding once on 「open」 would leave the form describing nothing, and re-seeding
   * on 「submit」 would overwrite the fields the reader corrected by hand — which is
   * the one thing this form is for.
   */
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const mark = (field: string): void => setTouched(current => new Set(current).add(field))
  useEffect(() => {
    if (parsed === undefined) return
    if (!touched.has('title')) setTitle(parsed.title)
    if (!touched.has('body')) setBody(parsed.body)
    if (!touched.has('priority') && parsed.priority !== undefined) setPriority(parsed.priority)
    if (!touched.has('tags')) setTags(parsed.tags.join('、'))
    /* **一句话认出来的东西，全部都要落到各自的框里。**
     *
     * 解析出来的东西**不许静默丢掉**：`startsAfter`、`hardDueAt` 与 `- [ ] 步骤` 行漏掉
     * 任何一部分，读者在一行里写了三个日子、存下去就只有一个，而屏上没有任何东西说
     * 这件事（那正是「认了却没到」这一类缺陷）。`touched` 是同一道闸门：读者手动改过的框
     * 不会被这一行盖掉，所以「文法回填一次、之后归读者」这条律一个字都没变。 */
    if (!touched.has('startsAfter') && parsed.startsAfter !== undefined) setStartsAfter(toItemDateField(parsed.startsAfter))
    if (!touched.has('dueAt') && parsed.dueAt !== undefined) setDueAt(toItemDateField(parsed.dueAt))
    if (!touched.has('hardDueAt') && parsed.hardDueAt !== undefined) setHardDueAt(toItemDateField(parsed.hardDueAt))
    if (!touched.has('steps') && parsed.steps.length > 0) {
      // 勾过的步骤写成 `- [x] 一句话`，与快记那一行同一个写法——`stepList` 两种都认，
      // 所以从那一行带过来的勾在这里不会丢。
      setSteps(parsed.steps.map(step => (step.done ? `- [x] ${step.text}` : step.text)).join('\n'))
    }
  }, [parsed, touched])

  /**
   * 「一行一步」变成清单：**两种写法都认**。
   *
   * 光一行就是一步；`- [x] 一句话` 是已经勾上的一步——与快记那一行同一个写法，所以从
   * 那一行带过来的勾不会在这里丢掉（丢掉一次勾就是一次静默的数据损失）。
   */
  const stepList = (): ItemCapture['steps'] =>
    steps.split('\n').map(line => line.trim()).filter(line => line !== '').map(line => {
      const box = /^[-*]\s*\[\s*([ xX]?)\s*\]\s*(.+)$/.exec(line)
      return box === null ? { text: line } : { text: (box[2] as string).trim(), done: (box[1] ?? '').toLowerCase() === 'x' }
    })

  /** 「存下这一条」；返回这次到底存没存——文法行那根回车读的就是它，拒绝时
   *  读者的半句话必须留在框里。 */
  const submit = (): boolean => {
    /* **先把三个日子读一遍，读不懂就不存。**
     *
     * `parseItemDate` 的 `undefined` 一旦被铺进 capture，「明天」没读懂时条目就会带着
     * **没有日期**的字段落进文档，而读者以为它记下了。判定与展开区那一栏是同一个
     * （`readDateDraft`），说法也是同一行（`DateField`）；这里多做的一件事只是**把光标
     * 送到第一个读不懂的那一格**，因为这一张纸会滚，而按钮在底部——把原因留在看不见的
     * 地方等于没说。 */
    const drafts = {
      startsAfter: readDateDraft(startsAfter, props.now),
      dueAt: readDateDraft(dueAt, props.now),
      hardDueAt: readDateDraft(hardDueAt, props.now),
    }
    const wrong = DATE_FIELDS.filter(key => drafts[key].kind === 'bad')
    if (wrong.length > 0) {
      setBadDates(new Set(wrong))
      setWords(t('item.create.dateBad'))
      dateFields.current[wrong[0] as string]?.focus()
      return false
    }
    /** 一个日子进 capture 的形状：空着就一个字都不提，读懂了就带上——**读不懂的到不了
     *  这里**（上面已经拒绝并返回了）。 */
    const dated = (key: keyof typeof drafts): Partial<ItemCapture> => {
      const draft = drafts[key]
      return draft.kind === 'at' ? { [key]: draft.at } : {}
    }
    const input: ItemCapture = {
      title: title.trim(),
      body,
      notes,
      origin: 'human',
      status,
      priority,
      steps: stepList(),
      tags: tags.split(/[、,，]/).map(one => one.trim()).filter(one => one !== ''),
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
        onKeyDown={event => {
          // ONE LAYER, ONE ESCAPE, and the sheet takes it before anything behind it
          // does — the same rule the key sheet follows, for the same reason.
          if (event.key !== 'Escape') return
          event.stopPropagation()
          props.onClose()
        }}
      >
        <header className={css.itemCreateDialogHead}>
          <h2 className={css.itemCreateDialogTitle}>{t('item.create.title')}</h2>
          {/* THE CROSS IS ONE SHAPE, DRAWN ONCE — see `marks.tsx` 的 `CrossMark`：同一枚记号
              只画一遍：这里与筛选芯片读同一个元件，尺寸是属性——「× 当字符会坐在字体基线上，
              框居中了、字没居中」这条教训因此只有一处。 */}
          <button
            type="button"
            className={css.itemCreateDialogClose}
            aria-label={t('item.create.close')}
            onClick={props.onClose}
          >
            <CrossMark size={14} />
          </button>
        </header>

        <div className={css.itemCreateDialogGrid} data-dsh-tb-scroll="">
          <div className={css.itemCreateDialogMain}>
            <label className={css.itemCreateDialogField}>
              <span className={css.itemCreateDialogLabel}>{t('item.create.grammar')}</span>
              <ItemComposer now={props.now} onChange={setParsed} onSave={submit} />
            </label>
            <input
              ref={titleField}
              className={css.itemCreateDialogTitleField}
              value={title}
              placeholder={t('item.create.titlePlaceholder')}
              aria-label={t('item.field.title')}
              onChange={event => { mark('title'); setTitle(event.target.value) }}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit() } }}
            />

            <label className={css.itemCreateDialogField}>
              <span className={css.itemCreateDialogLabel}>{t('item.field.body')}</span>
              {/* 与展开区那一栏是**同一个写入框**（`prose-field.tsx`）：同一个地板、同一个
                  高度、同一条横贯下沿的抓条、同一个数（读者拉过的那个）。这一张纸只是把
                  它画成竖排的一张表单，而不是另一个长得像它的盒子。 */}
              <ProseField
                value={body}
                onChange={value => { mark('body'); setBody(value) }}
                placeholder={t('item.create.bodyPlaceholder')}
                ariaLabel={t('item.field.body')}
                height={props.proseHeight}
                onHeight={props.onProseHeight}
              />
            </label>

            <label className={css.itemCreateDialogField}>
              <span className={css.itemCreateDialogLabel}>{t('item.create.steps')}</span>
              {/* 步骤在这里是**写下一串**（一行一步），不是展开区那张可以勾、可以挪的清单
                  ——那是同一件事的两个时刻：还没有这一条的时候，没有东西可以勾。变的是读法，
                  写字的那个盒子是同一个。 */}
              <ProseField
                value={steps}
                onChange={value => { mark('steps'); setSteps(value) }}
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
                onChange={value => { mark('notes'); setNotes(value) }}
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
                    onClick={() => { mark('priority'); setPriority(one) }}
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
                    onClick={() => { mark('status'); setStatus(one) }}
                  >
                    {t(GROUP_LABEL[one])}
                  </button>
                ))}
              </div>
            </div>

            <div className={css.itemOptRow}>
              <p className={css.itemOptName}>{t('item.field.tags')}</p>
              <div className={css.itemOpts}>
                {tags.split(/[、,，]/).map(one => one.trim()).filter(one => one !== '').map(one => (
                  <button
                    key={one}
                    type="button"
                    className={css.itemTag}
                    onClick={() => { mark('tags'); setTags(tags.split(/[、,，]/).map(x => x.trim()).filter(x => x !== '' && x !== one).join('、')) }}
                  >
                    #{one}
                  </button>
                ))}
                <TagField
                  value={tags}
                  placeholder={t('item.field.tagsHint')}
                  ariaLabel={`${t('item.field.tags')}：${t('item.field.tagsHint')}`}
                  onChange={value => { mark('tags'); setTags(value) }}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                    event.preventDefault()
                    // 回车把读者敲的写法收拢给他看：逗号并成顿号、去掉空段。芯片是
                    // 实时读这一行的，回车的活儿是「写法定型」——与详情页同一控件
                    // 的回车是「加上」，这里的同一根键不该什么反应都没有。
                    mark('tags')
                    setTags(tags.split(/[、,，]/).map(one => one.trim()).filter(one => one !== '').join('、'))
                  }}
                />
              </div>
            </div>

            {/* **三个日期：共用元件、共用判定、共用那句话。**
                这一格的框、它下面那行读数、以及读不懂时那句拒绝，与展开区那一栏是同一个
                `DateField`——差别只在布局（这一栏是竖排的一张纸），而布局不属于字段。 */}
            <label className={css.itemCreateDialogDate}>
              <span className={css.itemCreateDialogLabel}>{t('item.field.startsAfter')}</span>
              <DateField
                value={startsAfter}
                onChange={value => { mark('startsAfter'); setStartsAfter(value); setBadDates(current => new Set([...current].filter(key => key !== 'startsAfter'))) }}
                hint={t('item.create.startsHint')}
                ariaLabel={`${t('item.field.startsAfter')}：${t('item.create.startsHint')}`}
                now={props.now}
                bad={badDates.has('startsAfter')}
                onEnter={submit}
                focusRef={node => { dateFields.current.startsAfter = node }}
              />
            </label>
            <label className={css.itemCreateDialogDate}>
              <span className={css.itemCreateDialogLabel}>{t('item.field.dueAt')}</span>
              <DateField
                value={dueAt}
                onChange={value => { mark('dueAt'); setDueAt(value); setBadDates(current => new Set([...current].filter(key => key !== 'dueAt'))) }}
                hint={t('item.create.dueHint')}
                ariaLabel={`${t('item.field.dueAt')}：${t('item.create.dueHint')}`}
                now={props.now}
                bad={badDates.has('dueAt')}
                onEnter={submit}
                focusRef={node => { dateFields.current.dueAt = node }}
              />
            </label>
            <label className={css.itemCreateDialogDate}>
              <span className={css.itemCreateDialogLabel}>{t('item.field.hardDueAt')}</span>
              <DateField
                value={hardDueAt}
                onChange={value => { mark('hardDueAt'); setHardDueAt(value); setBadDates(current => new Set([...current].filter(key => key !== 'hardDueAt'))) }}
                hint={t('item.create.hardHint')}
                ariaLabel={`${t('item.field.hardDueAt')}：${t('item.create.hardHint')}`}
                now={props.now}
                bad={badDates.has('hardDueAt')}
                onEnter={submit}
                focusRef={node => { dateFields.current.hardDueAt = node }}
              />
            </label>

            <div className={css.itemOptRow}>
              <p className={css.itemOptName}>{t('item.field.taskId')}</p>
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
                {/* 与详情选择器同一句真相：两边只该有一个说法。 */}
                <p className={css.itemOptsFoot}>{t('item.cardLink.note')}</p>
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