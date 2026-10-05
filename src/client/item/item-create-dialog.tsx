/**
 * The new-row dialog: the door for someone who does not already have a sentence.
 *
 * WHY IT EXISTS ALONGSIDE THE QUICK-CAPTURE BOX, and why it is not a second
 * writer. The capture box takes one line of grammar — `#tag`, `!1`, `@today` — and
 * it is the fastest thing on this panel for a reader who is ALREADY holding the
 * words. This is the other reader: the one who has a task in their head and no
 * sentence for it yet, for whom 「记一条新的，回车即存」 is a field that asks for a
 * syntax they have not learned. It is a dialog rather than a row because it is a
 * different amount of thinking, and it submits through **the same
 * `captureItemRecord`** the box submits through — one write path, so the row it
 * makes is the row the box would have made.
 *
 * WHY THE TWO SIDES ARE TWO SIDES. The left is the words; the right is what the
 * words turn into. A reader filling the right-hand column is answering 「what kind
 * of thing is this」, and every field there is a date, a priority or a list — the
 * ones you point at rather than type. So the left takes the sentences and the
 * right takes the choices, and neither is a column of the other.
 *
 * IT IS NOT A `Dialog`. The host's dialog is a modal for the whole shell; this is
 * a surface of this panel, it reads the same tokens the panel reads, and a layer
 * that floats over another surface is not this surface's layer.
 */
import { useEffect, useRef, useState } from 'react'
import type { ItemCapture } from '../../core/item-transitions.ts'
import { isBlankCapture } from '../../core/item-transitions.ts'
import { toItemDateField } from './model.ts'
import type { ItemPriority } from '../../core/item.ts'
import { PRIORITY_LABEL } from './labels.ts'
import { ItemComposer } from './composer.tsx'
import type { ComposerParse } from './compose-parse.ts'
import { t } from '../locales.ts'
import { Button } from '../board/ui.tsx'
import css from './item.module.css'

/** The four priorities, in the order a reader scans them. */
const PRIORITIES: readonly ItemPriority[] = ['urgent', 'high', 'normal', 'low']

export interface ItemCreateDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  /** Hand the finished capture over. `false` means it was refused; keep the words. */
  readonly onCreate: (input: ItemCapture) => boolean
/**
   * The writing clock, so `@today` in the grammar resolves against a fixed now.
   *
   * It is a PROP and not a call to `Date.now()` inside the parser because that
   * clock decides what a date the reader typed MEANT. A test that cannot set it
   * cannot pin `@明天`, and a host that cannot set it cannot replay one.
   */
  readonly now: number
  /** Cards the reader can hang the row on, by id. */
  readonly cards: readonly { readonly id: string; readonly title: string }[]
}

/**
 * The dialog.
 *
 * The caret lands in the TITLE field, because that is the one field every row
 * needs and the only one whose absence makes the rest pointless. `Esc` closes it
 * from anywhere inside, and the words already typed stay typed — a dialog that
 * throws away half-written work on dismissal is a dialog nobody experiments in.
 * @param props - whether it is open, and the hand-off.
 * @returns the overlay, or nothing.
 */
export function ItemCreateDialog(props: ItemCreateDialogProps) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<ItemPriority>('normal')
  const [due, setDue] = useState('')
  const [tags, setTags] = useState('')
  const [taskId, setTaskId] = useState('')
const [words, setWords] = useState('')
  /** WHAT THE GRAMMAR UNDERSTOOD, handed up by the box on every keystroke.
   *
   *  THE FIELDS BELOW ARE A VIEW OF THIS, NOT A SECOND PLACE TO TYPE. The line
   *  above them is one sentence; the grid underneath is that sentence read field
   *  by field. Keeping them in step by copying is how 「我打了 @明天，日期框是空的」
   *  happens — so the copy is made once per keystroke instead, and the reader can
   *  still overrule any single field by hand afterwards. */
  const [parsed, setParsed] = useState<ComposerParse | undefined>(undefined)
  const sheet = useRef<HTMLDivElement | null>(null)
  const titleField = useRef<HTMLInputElement | null>(null)

  // OPENING STARTS FROM BLANK, and the caret goes to the title. Reopening the
  // dialog is a new row, not an edit of the last one: a dialog that comes back
  // holding the previous row's words is a dialog that will file the same thing
  // twice.
  useEffect(() => {
if (!props.open) return
    setTitle(''); setBody(''); setPriority('normal'); setDue(''); setTags(''); setTaskId(''); setWords('')
    setParsed(undefined)
    titleField.current?.focus()
  }, [props.open])

  /* THE GRAMMAR FILLS THE FORM, ONCE PER KEYSTROKE.
   *
   * Seeding on every keystroke is right because it is the ONLY moment the two
   * sides are guaranteed to agree: the reader is looking at the sentence they are
   * typing. Seeding once on 「open」 would leave the grid describing nothing, and
   * re-seeding on 「submit」 would overwrite the fields the reader corrected by
   * hand — which is the one thing this grid is for.
   *
   * It only writes a field the reader has NOT touched. That is what makes the
   * form editable without the two sides fighting over it: a hand-edited date is
   * never rewritten because the sentence above still says `@明天`. */
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const mark = (field: string) => setTouched(current => new Set(current).add(field))
  useEffect(() => {
    if (parsed === undefined) return
    if (!touched.has('title')) setTitle(parsed.title)
    if (!touched.has('body')) setBody(parsed.body)
if (!touched.has('priority') && parsed.priority !== undefined) setPriority(parsed.priority)
    if (!touched.has('tags')) setTags(parsed.tags.join('、'))
    if (!touched.has('dueAt') && parsed.dueAt !== undefined) setDue(toItemDateField(parsed.dueAt))
  }, [parsed, touched])

  const submit = (): void => {
    const input: ItemCapture = {
      title: title.trim(),
      body,
      notes: '',
      origin: 'human',
      status: 'open',
      priority,
      steps: [],
      tags: tags.split(/[、,，]/).map(one => one.trim()).filter(one => one !== ''),
      ...(due.trim() === '' ? {} : { dueAt: new Date(`${due.trim()}T00:00:00`).getTime() }),
      ...(taskId === '' ? {} : { taskId }),
    }
    // The refusal is decided by the SHARED emptiness rule and it says why, in
    // place: the reader typed a priority and no words, and the dialog must not
    // answer that with a row that has no name.
    if (isBlankCapture(input)) { setWords(t('item.create.blank')); return }
    if (props.onCreate(input)) props.onClose()
    else setWords(t('item.create.refused'))
  }

  if (!props.open) return null

  return (
    <div
      /* 幕布与键位表共用同一个零件，所以共用同一个名字。给两份一模一样的幕布
         各起一个名字，等于宣布它们是两种东西——而它们不是：按下空白处关掉这一
         层，是同一个动作。 */
      className={css.itemKeyHelpMask}
      onPointerDown={event => { if (event.target === event.currentTarget) props.onClose() }}
    >
      <div
        ref={sheet}
        className={css.itemCreateDialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('item.create.title')}
        onKeyDown={event => {
          // ONE LAYER, ONE ESCAPE, and the sheet takes it before anything behind
          // it does — the same rule the key sheet follows, for the same reason.
          if (event.key !== 'Escape') return
          event.stopPropagation()
          props.onClose()
        }}
      >
{/* 左边是那句话，右边是那句话会变成什么。 */}
        <div className={css.itemCreateDialogMain}>
          {/* THE GRAMMAR IS THE FIRST LINE, AND IT IS THE ONLY LINE THAT IS
              * REQUIRED.
              *
              * It used to be an always-on box above the workbench, which meant a
              * reader could never put a second thought into a row — the sentence
              * was filed the instant they pressed Enter — and it meant this sheet
              * was a second, stranger way to do the same thing. Now there is ONE
              * door: ＋新建一条, and its first line is the sentence itself, with
              * the chips under it saying what was understood.
              *
              * AND THE FIELDS BELOW ARE SEEDED FROM THAT PARSE, not typed twice.
              * They are the same sentence read field by field, which is what lets
              * them stay on the surface at all: a field the grammar can fill is a
              * field nobody has to learn, and a field the reader can overrule is a
              * field nobody has to give up either. */}
          <ItemComposer now={props.now} onChange={setParsed} />
          <div className={css.itemCreateDialogSeeded}>
            <input
              ref={titleField}
              className={css.itemCreateDialogTitle}
              value={title}
              placeholder={t('item.field.title')}
              aria-label={t('item.field.title')}
              onChange={event => { mark('title'); setTitle(event.target.value) }}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit() } }}
            />
          <textarea
            className={css.itemCreateDialogBody}
            value={body}
            rows={6}
            placeholder={t('item.create.body')}
            aria-label={t('item.create.body')}
            onChange={event => { mark('body'); setBody(event.target.value) }}
          />
</div>
        </div>

        <div className={css.itemCreateDialogFields}>
          <label className={css.itemField}>
            <span className={css.itemFieldLabel}>{t('item.batch.priority')}</span>
            <select className={css.itemFieldValue} value={priority} onChange={event => { mark('priority'); setPriority(event.target.value as ItemPriority) }}>
              {PRIORITIES.map(one => <option key={one} value={one}>{t(PRIORITY_LABEL[one])}</option>)}
            </select>
          </label>
          <label className={css.itemField}>
            <span className={css.itemFieldLabel}>{t('item.field.dueAt')}</span>
            <input
              className={css.itemFieldValue}
              type="date"
              value={due}
              onChange={event => { mark('dueAt'); setDue(event.target.value) }}
            />
          </label>
          <label className={css.itemField}>
            <span className={css.itemFieldLabel}>{t('item.field.tags')}</span>
            <input
              className={css.itemFieldValue}
              value={tags}
              placeholder={t('item.field.tagsHint')}
              aria-label={`${t('item.field.tags')}：${t('item.field.tagsHint')}`}
              onChange={event => { mark('tags'); setTags(event.target.value) }}
            />
          </label>
          <label className={css.itemField}>
            <span className={css.itemFieldLabel}>{t('item.field.taskId')}</span>
            <select className={css.itemFieldValue} value={taskId} onChange={event => setTaskId(event.target.value)}>
              <option value="">{t('item.field.noCard')}</option>
              {props.cards.map(card => <option key={card.id} value={card.id}>{card.title}</option>)}
            </select>
          </label>
        </div>

        {words !== '' && <p className={css.itemHint} role="status">{words}</p>}

        <div className={css.itemCreateDialogActions}>
          <Button variant="ghost" size="sm" onClick={props.onClose}>{t('item.create.cancel')}</Button>
          <Button variant="primary" size="sm" onClick={submit}>{t('item.create.submit')}</Button>
        </div>
      </div>
    </div>
  )
}