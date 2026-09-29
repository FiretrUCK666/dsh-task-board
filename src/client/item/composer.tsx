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
 * It is a control, not a dialog, and it is never hidden: the entry point has to
 * be reachable in every state, including the empty list, or a first-time reader
 * has nothing to press.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
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

export interface ItemComposerProps {
  /** The writing clock, so a parse resolves `@today` against a fixed now. */
  readonly now: number
  /** Hand the finished capture over. Returning `false` means it was refused. */
  readonly onSave: (input: ItemCapture) => boolean
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
export function ItemComposer({ now, onSave }: ItemComposerProps) {
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement | null>(null)
  const parsed = useMemo(() => parseComposerInput(text, now), [text, now])
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
    <div className={css.itemComposer}>
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
            className={`${css.itemChip} ${boardCss.chipFill}`}
            title={t('item.token.undo')}
            aria-label={`${t(TOKEN_LABEL[token.kind])} — ${t('item.token.undo')}`}
            onClick={() => unparse(token)}
          >
            <span className={boardCss.chipBody}>{t(TOKEN_LABEL[token.kind])}</span>
            <span className={css.itemChipReset} aria-hidden="true">×</span>
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
      <p className={css.itemHint}>{t('item.compose.hint')}</p>
    </div>
  )
}
