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
import type { ItemPriority } from '../../core/item.ts'
import { PRIORITY_LABEL, GROUP_LABEL } from './labels.ts'
import { ItemComposer } from './composer.tsx'
import type { ComposerParse } from './compose-parse.ts'
import { parseItemDate, toItemDateField, formatItemDate } from './model.ts'
import { isEnglish } from '../locales.ts'
import { t } from '../locales.ts'
import { Button } from '../board/ui.tsx'
import css from './item.module.css'

/** The three priorities a reader can put in by tapping, in the order a scale reads. */
const PRIORITIES: readonly ItemPriority[] = ['urgent', 'high', 'normal', 'low']

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
  /* THE THREE STATES A READER MAY CHOOSE, and the fourth is not one of them.
   * 「进行中」 is DERIVED from the row's card, so it is filterable and not
   * writable — offering it here would be offering a setting that the next
   * synchronisation overwrites. */
  const [status, setStatus] = useState<ItemCapture['status']>('open')
  const [startsAfter, setStartsAfter] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [hardDueAt, setHardDueAt] = useState('')
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
    setTitle(''); setBody(''); setNotes(''); setSteps(''); setPriority('normal'); setStatus('open')
    setStartsAfter(''); setDueAt(''); setHardDueAt(''); setTags(''); setTaskId(''); setWords('')
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
    if (!touched.has('dueAt') && parsed.dueAt !== undefined) setDueAt(toItemDateField(parsed.dueAt))
  }, [parsed, touched])

  /** 「一行一步」 becomes the list, and a blank line is not a step. */
  const stepList = (): ItemCapture['steps'] =>
    steps.split('\n').map(line => line.trim()).filter(line => line !== '').map(line => ({ text: line }))

  /** 「存下这一条」；返回这次到底存没存——文法行那根回车读的就是它，拒绝时
   *  读者的半句话必须留在框里。 */
  const submit = (): boolean => {
    const at = (value: string): number | undefined => parseItemDate(value.trim(), props.now)
    const input: ItemCapture = {
      title: title.trim(),
      body,
      notes,
      origin: 'human',
      status,
      priority,
      steps: stepList(),
      tags: tags.split(/[、,，]/).map(one => one.trim()).filter(one => one !== ''),
      ...(startsAfter.trim() === '' ? {} : { startsAfter: at(startsAfter) }),
      ...(dueAt.trim() === '' ? {} : { dueAt: at(dueAt) }),
      ...(hardDueAt.trim() === '' ? {} : { hardDueAt: at(hardDueAt) }),
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
          {/* THE CROSS IS CENTRED TWICE, ONCE IN THE BOX AND ONCE IN THE GLYPH. A
              × drawn as a character sits on the font's own baseline inside a box
              centred by padding, and the two centring rules disagree by a pixel or
              two — which is why it read as 「偏上」 while the box itself was square. */}
          <button
            type="button"
            className={css.itemCreateDialogClose}
            aria-label={t('item.create.close')}
            onClick={props.onClose}
          >
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d="M2.6 2.6l6.8 6.8M9.4 2.6l-6.8 6.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
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
              <textarea
                className={css.itemCreateDialogBody}
                rows={5}
                value={body}
                placeholder={t('item.create.bodyPlaceholder')}
                aria-label={t('item.field.body')}
                onChange={event => { mark('body'); setBody(event.target.value) }}
              />
            </label>

            <label className={css.itemCreateDialogField}>
              <span className={css.itemCreateDialogLabel}>{t('item.create.steps')}</span>
              <textarea
                className={css.itemCreateDialogBody}
                rows={3}
                value={steps}
                placeholder={t('item.create.stepsPlaceholder')}
                aria-label={t('item.create.steps')}
                onChange={event => { mark('steps'); setSteps(event.target.value) }}
              />
            </label>

            <label className={css.itemCreateDialogField}>
              <span className={css.itemCreateDialogLabel}>{t('item.field.notes')}</span>
              <textarea
                className={css.itemCreateDialogBody}
                rows={2}
                value={notes}
                placeholder={t('item.field.notesHint')}
                aria-label={t('item.field.notes')}
                onChange={event => { mark('notes'); setNotes(event.target.value) }}
              />
            </label>
          </div>

          <div className={css.itemCreateDialogSide}>
            <div className={css.itemOptRow}>
              <p className={css.itemOptName}>{t('item.field.priority')}</p>
              <div className={css.itemOpts}>
                {PRIORITIES.map(one => (
                  /* THE SAME CONTROL AS THE STATUS CHIPS BESIDE IT.
                   *
                   * These four used to be `itemPrioChip` — the chip that carries
                   * LOUDNESS on a row. That class means 「this tier is shouting」,
                   * so all four of them arrived pre-painted by their own tier and
                   * the selected one had nowhere left to show it: `data-on` was
                   * set by the component and read by no rule, so pressing a
                   * priority changed the form and the screen said nothing.
                   *
                   * On the sheet the four are not four volumes — they are ONE
                   * scale with one answer, which is exactly what `.itemOpt` is:
                   * the quiet chip whose selection is the fill plus a heavier
                   * edge. The tier's loudness stays where it belongs, on the row,
                   * where only the tiers that are actually loud are drawn. */
                  <button
                    key={one}
                    type="button"
                    className={css.itemOpt}
                    data-on={priority === one ? '' : undefined}
                    aria-pressed={priority === one}
                    title={t(PRIORITY_LABEL[one])}
                    onClick={() => { mark('priority'); setPriority(one) }}
                  >
                    !{PRIORITY_DIGIT[one]}
                  </button>
                ))}
              </div>
            </div>

            <div className={css.itemOptRow}>
              <p className={css.itemOptName}>{t('item.field.status')}</p>
              <div className={css.itemOpts}>
                {(['open', 'blocked', 'done'] as const).map(one => (
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
                <input
                  className={css.itemTagAdd}
                  value={tags}
                  placeholder={t('item.field.tagsHint')}
                  aria-label={`${t('item.field.tags')}：${t('item.field.tagsHint')}`}
                  onChange={event => { mark('tags'); setTags(event.target.value) }}
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

            <DateField
              label={t('item.field.startsAfter')}
              hint={t('item.create.startsHint')}
              value={startsAfter}
              set={value => { mark('startsAfter'); setStartsAfter(value) }}
              now={props.now}
            />
            <DateField
              label={t('item.field.dueAt')}
              hint={t('item.create.dueHint')}
              value={dueAt}
              set={value => { mark('dueAt'); setDueAt(value) }}
              now={props.now}
            />
            <DateField
              label={t('item.field.hardDueAt')}
              hint={t('item.create.hardHint')}
              value={hardDueAt}
              set={value => { mark('hardDueAt'); setHardDueAt(value) }}
              now={props.now}
            />

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

/** `!1`..`!4` from the model's own table, so a re-tiering cannot leave a chip lying. */
const PRIORITY_DIGIT: Readonly<Record<ItemPriority, string>> = { urgent: '1', high: '2', normal: '3', low: '4' }

/**
 * ONE DATE, AND WHAT IT READS AS.
 *
 * A date is typed in one spelling and shown in another: 「明天」 goes in, 「明天 ·
 * 10月15日」 comes back, so a reader can see whether the machine understood the word
 * they used. **The reading is not a label above the field — it is the field's own
 * value rendered**, because a second line saying something about the first one is a
 * second thing that can be wrong.
 */
function DateField(props: {
  readonly label: string
  readonly hint: string
  readonly value: string
  readonly set: (value: string) => void
  readonly now: number
}) {
  const at = parseItemDate(props.value.trim(), props.now)
  return (
    <label className={css.itemCreateDialogDate}>
      <span className={css.itemCreateDialogLabel}>{props.label}</span>
      <input
        className={css.itemCreateDialogDateField}
        value={props.value}
        placeholder={props.hint}
        aria-label={`${props.label}：${props.hint}`}
        onChange={event => props.set(event.target.value)}
        data-set={at === undefined ? undefined : toItemDateField(at)}
        title={at === undefined ? undefined : formatItemDate(at, isEnglish(), props.now)}
      />
    </label>
  )
}