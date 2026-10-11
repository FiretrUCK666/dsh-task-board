/**
 * ONE DATE FIELD, ONE FIELD'S WORTH OF BEHAVIOUR — AND ONE PLACE THAT SAYS
 * 「I could not read this」.
 *
 * ── WHY IT IS SHARED ─────────────────────────────────────────────────────────
 *
 * The detail and the new-row sheet both let a reader type a date, and both must
 * answer the same word the same way. An unreadable one is REFUSED in place: the
 * box stays open and a line under it says why. Nothing may be dropped quietly —
 * a word the machine could not read must never become a row saved without the day
 * the reader typed, because nobody would ever hear about it. One word, two
 * surfaces, one contract: that is not a styling question, and aligning the two by
 * hand would leave the next field free to pick either habit.
 *
 * So the field is one component with one contract:
 *
 *  - **The reading is printed**, and it is derived here from `readDateDraft` —
 *    the same function the sheet's save asks. 「明天」 in, 「10月15日」 out, so a
 *    reader can see whether the machine understood the word they used. It used
 *    to live in a `title=` on the sheet, which a touch screen cannot reach
 *    (hard rule 11③).
 *  - **The refusal is printed in place**, and it is a verdict about an ATTEMPT:
 *    only the caller knows the reader pressed Enter or pressed 「存下这一条」, so
 *    the caller says `bad` and the field says the words. A refusal that appeared
 *    on every keystroke would be shouting at half a word.
 *  - **Nothing about the layout.** The label above it, the wrapper around it and
 *    the column it sits in belong to the surface — that is why there is no
 *    `label` prop and no shape switch here. What is shared is what a date field
 *    DOES.
 *
 * `onDismiss` is the one behavioural difference the two surfaces are allowed,
 * and it is a difference about LAYERS rather than about dates: the detail's
 * field is an in-place editor, so Escape and a press outside give up on the
 * field; the sheet is a layer of its own and keeps Escape for closing itself
 * (「ONE LAYER, ONE ESCAPE」). A sheet that passed `onDismiss` would swallow the
 * key its reader uses to leave the sheet.
 */
import { type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { formatItemDate, readDateDraft, type DateBadReason } from './model.ts'
import { isEnglish, t, type TaskBoardKey } from '../locales.ts'
import css from './item.module.css'

/**
 * 三种拒绝各自的句子。**这是它们唯一的出口。**
 *
 * 「一个读不懂的日期怎么讲给人听」只该有一个答案：日期框在自己下面说，快记在输入框下面
 * 说（读者在那里写的是 `@13/45` 这种一行里的写法）。两处各拼一次，就是同一句话的两个
 * 版本，而其中一句会在某次改词里先过期——这一页已经有过一次「同一个词选不同的行」。
 */
const DATE_BAD_KEY: Readonly<Record<DateBadReason, TaskBoardKey>> = {
  unreadable: 'item.dates.bad.unreadable',
  past: 'item.dates.bad.past',
  impossible: 'item.dates.bad.impossible',
}

/**
 * 一个读不懂的日期，说给人听的那句话。
 * @param reason - 哪一种读不懂（三种的改法不同，见 `DateBadReason`）。
 * @param word - 读者写的那串字，原样带进句子里。
 * @returns 那一句。
 */
export function dateBadWords(reason: DateBadReason, word: string): string {
  return t(DATE_BAD_KEY[reason], { word })
}

/** What one date field needs. Nothing about where it is drawn. */
export interface DateFieldProps {
  /** The text the reader has typed. The field is CONTROLLED: the draft is the
   *  surface's state, because the surface is what finally writes it down. */
  readonly value: string
  readonly onChange: (value: string) => void
  /** The spellings this field accepts, shown as the placeholder. */
  readonly hint: string
  readonly ariaLabel: string
  /** The reading clock: a WORD resolves against the panel's now, not the machine's. */
  readonly now: number
  /**
   * Whether the reader has just TRIED to commit a value that cannot be read.
   *
   * A prop and not a derivation, because 「读不懂」 is a fact about an attempt:
   * the first character of 「明天」 is unreadable and is not a mistake.
   */
  readonly bad?: boolean
  /** Enter. The detail commits its edit; the sheet saves the whole capture. */
  readonly onEnter?: () => void
  /**
   * Give up on this field — Escape, and a press outside it.
   *
   * ABSENT MEANS THE KEYS ARE NOT THIS FIELD'S: see the note above about layers.
   */
  readonly onDismiss?: () => void
  /** The focus hinge, for a surface that opens the field and wants the caret in it. */
  readonly focusRef?: (node: HTMLInputElement | null) => void
}

/**
 * One date field.
 * @param props - the draft, the clock, and the two verdicts the caller owns.
 * @returns the input and, under it, one line saying what it read or why it could not.
 */
export function DateField(props: DateFieldProps) {
  const draft = readDateDraft(props.value, props.now)
  const reading = draft.kind === 'at' ? formatItemDate(draft.at, isEnglish(), props.now) : ''
  /* 拒绝是**对一次尝试**的判断，所以由调用方说（`bad`）；说的是哪一句由**哪一种不懂**
   * 决定。而读者把字改对的那一刻，这一行立刻变成读出来的那个日期——一句已经不成立的
   * 拒绝比没有拒绝更糟。 */
  const line = props.bad === true && draft.kind === 'bad'
    ? dateBadWords(draft.reason, props.value.trim())
    : reading
  const dismiss = props.onDismiss

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      if (props.onEnter === undefined) return
      event.preventDefault()
      props.onEnter()
      return
    }
    if (event.key !== 'Escape' || dismiss === undefined) return
    /* Stopping the escape keeps it a verdict about the FIELD: the panel's keymap
     * would otherwise collapse the whole row on the same press. */
    event.preventDefault()
    event.stopPropagation()
    dismiss()
  }

  return (
    <>
      <input
        ref={props.focusRef}
        className={css.itemDateField}
        size={11}
        value={props.value}
        placeholder={props.hint}
        aria-label={props.ariaLabel}
        /* THE FIELD SAYS WHICH KEYS ARE ITS OWN, and only the keys it actually
         * handles — a declaration that over-claims is a panel that stops
         * answering Enter somewhere else. */
        data-dsh-tb-keys={dismiss === undefined ? 'Enter' : 'Enter Escape'}
        onBlur={dismiss === undefined ? undefined : () => dismiss()}
        onChange={event => props.onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {line !== '' && <p className={css.itemDateBad}>{line}</p>}
    </>
  )
}
