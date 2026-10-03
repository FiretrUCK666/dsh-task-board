/**
 * The capture box: one line in, one filed row out.
 *
 * WHY A PARSER AND NOT A FORM. Filling in a priority dropdown and three date
 * fields is four decisions before the thought is safely down, and the thought is
 * the part that gets lost. So the box takes the sentence the reader already has
 * in their head and reads the structure out of it — `#tag`, `!1`..`!4`,
 * `@today`, `@hard 9/30`, `@from 9/25`, a leading `- [ ]` — which is the shape
 * every quick-capture in this category converged on, for the same reason.
 *
 * THE ESCAPE HATCH IS THE FEATURE, NOT A POLISH ITEM. A parser that
 * recognises "monthly" in "write the monthly report" as a date has silently
 * eaten a word, and the reader has no way back. So every recognised piece is
 * shown as a chip as it is typed, and clicking one puts the characters back.
 * A parser that can be wrong without a way to undo it is worse than no parser.
 *
 * THE CHIPS TEACH BY BEING WRITTEN, NOT BY AN EXPLANATION. This box used to end
 * with three pressable symbols — `#` `!` `@` — that typed the grammar in for the
 * reader. They were the only part of the surface a newcomer could press, and
 * none of them meant anything until you already knew what they meant: a reader who
 * tapped `#` and got a box full of `#` learns the glyph, not the sentence. What
 * teaches a syntax is writing one, and this box shows what it understood while
 * you write it — which is also the only evidence a first-time reader gets that
 * the syntax exists at all.
 *
 * It is a control, not a dialog, and it is never hidden: the entry point has to
 * be reachable in every state, including the empty list, or a first-time reader
 * has nothing to press.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isBlankCapture, type ItemCapture } from '../../core/item-transitions.ts'
import { escapeComposerToken, parseComposerInput, type ComposerToken } from './compose-parse.ts'
import { t } from '../locales.ts'
import { Button } from '../board/ui.tsx'
import css from './item.module.css'
import boardCss from '../board.module.css'

/** What one recognised piece is called, in the reader's language. */
const TOKEN_LABEL: Readonly<Record<ComposerToken['kind'], 'item.token.tag' | 'item.token.priority' | 'item.token.due' | 'item.token.hard' | 'item.token.earliest' | 'item.token.step'>> = {
  tag: 'item.token.tag',
  priority: 'item.token.priority',
  due: 'item.token.due',
  hard: 'item.token.hard',
  earliest: 'item.token.earliest',
  step: 'item.token.step',
}

/**
 * THE SHAPE ON EACH RECOGNISED PIECE, and it is NOT a cross.
 *
 * Pressing this puts the characters BACK into the box — it is a parser undoing
 * itself, not a chip being thrown away. A cross says 「this is gone」, and the
 * reader who pressed it (and said so: 「点那个叉，它会往输入框里面继续输入，没有
 * 把它叉掉」) watched the word COME BACK. Worse, the cross was borrowed: the
 * qualifier chip beside the search box really does delete, so the same glyph sat
 * in two places on one screen meaning two opposite things, an inch apart, and
 * the only way to tell them was to press them.
 *
 * **SO ONE SHAPE, ONE MEANING, ON THIS SURFACE: `×` REMOVES A CONDITION FROM THE
 * QUERY, AND NOTHING ELSE.** Any control that puts text back borrows a shape that
 * means 「put back」 — an arrow curving the way the text goes — or a word. Never
 * the cross. The rule is worth more than either chip, because it is what stops
 * the next cross from appearing next to something that is not a deletion.
 */
const RESTORE_MARK = '↩'

export interface ItemComposerProps {
  /** The writing clock, so a parse resolves `@today` against a fixed now. */
  readonly now: number
  /** Hand the finished capture over. Returning `false` means it was refused. */
  readonly onSave: (input: ItemCapture) => boolean
  /**
   * Put the caret in the box, from outside.
   *
   * This is what the `A` key calls, and it is a PROP rather than a method on a
   * ref for one reason: the composer owns its own input, and a parent reaching
   * into a child's DOM node is a parent that has to know how the child is built.
   * The gesture is 「write something now」, so that is what the parent asks for.
   */
  readonly focusRequest?: number
}

/**
 * The capture box.
 *
 * State is the text and nothing else: every field the capture produces is
 * derived from it on each render, so there is no second copy of the truth to
 * fall out of step with the first.
 * @param props - the clock and the save hand-off.
 * @returns the box, its live chips and its hint.
 */
export function ItemComposer({ now, onSave, focusRequest }: ItemComposerProps) {
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement | null>(null)
  const parsed = useMemo(() => parseComposerInput(text, now), [text, now])
  // A COUNTER AND NOT A BOOLEAN, because the same key pressed twice must move the
  // caret twice: a boolean that is already `true` is indistinguishable from a new
  // request, so the second `A` would do nothing and the key would look broken.
  // A counter is not state about the box — nothing renders it — so it cannot go
  // stale in a way a reader can see.
  useEffect(() => {
    if (focusRequest === undefined || focusRequest === 0) return
    input.current?.focus()
  }, [focusRequest])
  // The SAME emptiness rule the save path uses, read from the shared writer
  // rather than restated here. Two spellings of "is this blank" are two answers,
  // and the one that decides whether a button is lit is the one nobody can afford
  // to have drift from the one that decides what pressing it does.
  const saveable = !isBlankCapture(parsed)

  const save = useCallback(() => {
    // The parse is the save's only source: what the chips showed is what gets
    // written, so the reader is never surprised by a field they could not see.
    if (onSave({
      title: parsed.title,
      body: parsed.body,
      notes: '',
      // Stated, never defaulted. The provenance is the audit trail's handle and
      // the field table forbids anyone rewriting it afterwards, so a capture box
      // that left it out would have it guessed on the reader's behalf.
      origin: 'human',
      status: 'open',
      priority: parsed.priority ?? 'normal',
      steps: parsed.steps,
      tags: parsed.tags,
      ...(parsed.startsAfter !== undefined ? { startsAfter: parsed.startsAfter } : {}),
      ...(parsed.dueAt !== undefined ? { dueAt: parsed.dueAt } : {}),
      ...(parsed.hardDueAt !== undefined ? { hardDueAt: parsed.hardDueAt } : {}),
    })) {
      setText('')
    }
  }, [onSave, parsed])

  /**
   * Put one recognised piece back into plain text.
   *
   * The parser hands back the exact source range, so the edit is a splice at a
   * known offset rather than a guess at a word — a guess that goes wrong the
   * moment the same word appears twice.
   */
  const unparse = useCallback((token: ComposerToken) => {
    setText(current => `${current.slice(0, token.start)}${escapeComposerToken(current, token)}${current.slice(token.end)}`)
    input.current?.focus()
  }, [])

  return (
    /* NO WRAPPER, and the reason is that a box which lays nothing out does not
     * need a name. The composer used to sit in a `div` of its own, and the only
     * thing that div did was exist — the chips row below it is the layout, and
     * the parent's grid is what puts the box under the filter bar. A class on the
     * outer box was a promise of styling that never arrived, and a promise nobody
     * keeps is a rule nobody dares delete. */
    <div className={css.itemComposerChips}>
      <input
        ref={input}
        className={css.itemInput}
        value={text}
        placeholder={t('item.compose.title')}
        aria-label={t('item.compose.title')}
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          // An IME composition owns Enter while it is running: saving there
          // would file half a word and swallow the keystroke that chose it.
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          event.preventDefault()
          save()
        }}
      />
      {parsed.tokens.map(token => (
        <button
          key={`${token.start}-${token.kind}`}
          type="button"
          className={`${css.itemPill} ${boardCss.chipFill}`}
          title={t('item.token.undo')}
          aria-label={`${t(TOKEN_LABEL[token.kind])} — ${t('item.token.undo')}`}
          onClick={() => unparse(token)}
        >
          <span className={boardCss.chipBody}>{t(TOKEN_LABEL[token.kind])}</span>
          <span aria-hidden="true">{RESTORE_MARK}</span>
        </button>
      ))}
      {/* The button is not a convenience, it is the ONLY way to save on a
          phone: Enter in a single-line field is a newline there, and a
          capture surface whose save gesture does not exist under the thumb is
          a capture surface that loses thoughts. It sits on the base band
          beside the input and takes its own line when the row runs out. */}
      <Button variant="primary" size="sm" className={css.itemComposerSave} onClick={save} disabled={!saveable}>
        {t('item.compose.add')}
      </Button>
    </div>
  )
}
