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
 * THE CHIPS TEACH BY BEING WRITTEN, NOT BY AN EXPLANATION. Three pressable
 * symbols — `#` `!` `@` — that type the grammar in for the reader are the only
 * part of the surface a newcomer can press, and
 * none of them mean anything until you already know what they mean: a reader who
 * taps `#` and gets a box full of `#` learns the glyph, not the sentence. What
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
import { escapeComposerToken, parseComposerInput, type ComposerParse, type ComposerToken } from './compose-parse.ts'
import { dateBadWords } from './date-field.tsx'
import { t, type TaskBoardKey } from '../locales.ts'
import { DATE_FIELD_KEY } from './labels.ts'
import { Button } from '../board/ui.tsx'
import css from './item.module.css'
import boardCss from '../board.module.css'

/** What one recognised piece is called, in the reader's language. */
/** 三种日期各读**字段自己那一份词**（`item.field.*`）：屏上说的与框里写的是同一套，
 *  一个概念只有一套词——它只有一个来源：三个键各存一份，改字段名时快记的芯片不会跟着动。 */
const TOKEN_LABEL: Readonly<Record<ComposerToken['kind'], TaskBoardKey>> = {
  tag: 'item.token.tag',
  priority: 'item.token.priority',
  due: 'item.field.dueAt',
  hard: 'item.field.hardDueAt',
  earliest: 'item.field.startsAfter',
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
  /**
   * Hand the finished capture over. Returning `false` means it was refused.
   *
   * 回车与「记下」都走它。它**必须有**：一个回车什么都不做的写入框，是把「快」这件事
   * 留给读者自己猜。
   */
  readonly onSave?: (input: ItemCapture) => boolean
  /**
   * **这一行画不画自己那一枚保存按钮。**
   *
   * `'row'`（默认）：画。没有别的地方能存的时候，「记下」就是这一行的一部分——而且它是
   * 手机上唯一存得下的那一下（单行输入框里回车是换行）。
   *
   * `'surface'`：不画。这一行只是某个表面的第一行，而那个表面在自己的位置上有一个保存
   * 动词（新建纸的纸尾那一枚「存下这一条」）。**一张纸上两个保存控件，读者猜不出哪一个
   * 带着他刚在右边填的那些字段**——所以这是一次二选一，而不是两个并列的开关。
   */
  readonly saveOwnedBy?: 'row' | 'surface'
  /**
   * What the box currently understands, handed up on every change.
   *
   * THIS IS HOW THE SHEET STAYS TRUE TO ITS CHIPS. The sentence above the field
   * grid is one sentence, and the grid below is that same sentence read field by
   * field — so the grid is SEEDED from this parse rather than typed twice. A
   * reader who writes 「改详情侧栏的地板 !1 @明天 #画廊」 sees the chips, then sees
   * those same three values sitting in the fields underneath, and can still
   * overrule any one of them by hand.
   */
  readonly onChange?: (parsed: ComposerParse) => void
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
export function ItemComposer({ now, onSave, onChange, focusRequest, saveOwnedBy = 'row' }: ItemComposerProps) {
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

/**
   * What the box understands, in the shape a capture is written in.
   *
   * ONE ASSEMBLY, READ BY BOTH EXITS. Two spellings of 「what did I just
   * understand」 — one in the save path, one in the sheet's seeding path — is how
   * the chips end up disagreeing with the row they wrote: the one
   * thing a grammar that shows its work exists to prevent. So it is assembled
   * once per parse and handed to whichever exits are wired.
   */
  const capture = useMemo((): ItemCapture => ({
    title: parsed.title,
    body: parsed.body,
    notes: '',
    // Stated, never defaulted. The provenance is the audit trail's handle and the
    // field table forbids anyone rewriting it afterwards, so a capture that left
    // it out would have it guessed on the reader's behalf.
    origin: 'human',
    /* **清单自己能写的两个值之一**，不是「还没有做」的另一个名字：`open` 是这一版之前
       那个值的名字，写它等于写一个模型里已经不存在的状态。 */
    status: 'todo',
    priority: parsed.priority ?? 'normal',
    steps: parsed.steps,
    tags: parsed.tags,
    ...(parsed.startsAfter !== undefined ? { startsAfter: parsed.startsAfter } : {}),
    ...(parsed.dueAt !== undefined ? { dueAt: parsed.dueAt } : {}),
    ...(parsed.hardDueAt !== undefined ? { hardDueAt: parsed.hardDueAt } : {}),
  }), [parsed])

  useEffect(() => { onChange?.(parsed) }, [onChange, parsed])

  const save = useCallback(() => {
    // The parse is the save's only source: what the chips showed is what gets
    // written, so the reader is never surprised by a field they could not see.
    if (onSave?.(capture) === true) setText('')
  }, [onSave, capture])

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
     * need a name. A `div` of its own would exist and do nothing — the chips row
     * below it is the layout, and the parent's grid is what puts the box under the
     * filter bar. A class on the
     * outer box is a promise of styling that may never arrive, and a promise nobody
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
      {/* **没变成芯片的那些词要说一句为什么。** 两种：同一个日期写了两遍（那一个不生效），
          以及这一串读不懂（`@13/45`、`@截止 下个月`）——后者的说法与日期框里那一句
          **同一处拼出来**（`dateBadWords`），所以「读不懂」在这两处长得一样。
          理由就近住在输入框下面，与详情里那三个日期框同一处位置。 */}
      {parsed.refused.map(one => (
        <p key={`${one.reason}-${one.raw}`} className={css.itemHint} role="status">
          {one.reason === 'duplicate'
            ? t('item.compose.refused', { word: one.raw, field: t(DATE_FIELD_KEY[one.field]) })
            : dateBadWords(one.reason, one.raw)}
        </p>
      ))}
      {/* **「记下」画出来，当且仅当这一行自己负责保存。**
        *
        * 它不是一个方便，它是**触屏上唯一存得下的那一下**（单行输入框里回车是换行）。
        * 而这一行是新建纸的第一行时，那一张纸的保存动词在纸尾——同一张纸上两个保存控件，
        * 读者猜不出哪一个带着他刚在右边填的那些字段，所以那一种由 `saveOwnedBy` 说清。 */}
      {onSave !== undefined && saveOwnedBy !== 'surface' && (
        <Button variant="primary" size="sm" className={css.itemComposerSave} onClick={save} disabled={!saveable}>
          {t('item.compose.add')}
        </Button>
      )}
    </div>
  )
}

/**
 * **三个记号各自叫什么** —— 一行图例，不是一段散文。
 *
 * 它是读者对着那行占位（`… #画廊 !1 @明天`）会问出的那个问题：「井号后面那个 tag 是什么」。
 * {@link ItemGrammarExample} 教的是**句子长什么样**（一个真的例子），这一行教的是**每个
 * 记号是什么意思**——两行回答两个问题，谁也替不了谁。
 *
 * 词从**已有的两张表**里读（`TOKEN_LABEL` 与 `DATE_FIELD_KEY`）：一个概念只有一套词，
 * 而这张图例不新造一个。
 * @returns 那一行图例。
 */
export function ItemGrammarLegend() {
  return (
    <p className={css.itemGrammarLegend}>
      {/* 标签那一格多一句「可写多个」：**这是读者问过的第一个问题**（「怎么变成多个 tag」），
          而它不能挂在共用的那个词上——`item.token.tag` 同时是芯片的可达名，那里多一句话，
          读屏读到的就成了语法说明。 */}
      <span className={css.itemGrammarLegendItem}>
        <b className={css.itemGrammarLegendSigil}>#</b>
        {t('item.grammar.tagMany')}
      </span>
      <span className={css.itemGrammarLegendItem}>
        <b className={css.itemGrammarLegendSigil}>!</b>
        {t(TOKEN_LABEL.priority)}
      </span>
      <span className={css.itemGrammarLegendItem}>
        <b className={css.itemGrammarLegendSigil}>@</b>
        {/* 三个日期**各写一个**，所以这里把它们并列写出来：这就是「@ 怎么落到开始 /
            计划 / 截止里」那一句话，而它用的还是字段自己那三个词。 */}
        {[DATE_FIELD_KEY.startsAfter, DATE_FIELD_KEY.dueAt, DATE_FIELD_KEY.hardDueAt].map(key => t(key)).join(' / ')}
      </span>
    </p>
  )
}

/**
 * ONE LINE OF THE GRAMMAR, SPELLED OUT — what an empty document shows instead of
 * a paragraph about itself.
 *
 * THE PROBLEM IT ANSWERS. An empty surface can say two things: what is missing,
 * or how to put something there. A sentence can only do the first, and the first
 * is the one nobody needs — 「还没有事项」 is a fact the reader already has, and a
 * screen that repeats it in a paragraph is a wall of text that teaches nothing.
 * Worse, the sentence it replaced had to DESCRIBE the grammar in prose
 * (「给它一个优先级、一个日期、一个标签或一张卡」), which is the longest possible
 * way to say what one line can SHOW.
 *
 * SO IT SHOWS IT. `#画廊` `!1` `@明天` and a few words, drawn with the same chips
 * the real line uses — the priority token is literally `.itemPrioChip`, the shape
 * the reader will meet on a row's title, in the property list, and on the rail.
 * Nothing here is new vocabulary; it is the vocabulary, arranged once, so that
 * learning the shape and reading the example are the same act.
 *
 * IT IS TEXT, NOT A FIELD. The chips are `<b>` inside a `<p>`: they cannot be
 * focused, clicked or typed into, so the example cannot impersonate a control
 * that swallows a press. An example that looks like an input and is not one is
 * the most expensive kind of decoration — the reader tries it once and learns
 * that things on this page do not work.
 * @returns the example line.
 */
export function ItemGrammarExample() {
  /* The reader's own language, spelled the way the box is spelled: the same
   * sigils, because the sigils are what they have to type. */
  return (
    <p className={css.itemGrammarExample}>
      <b className={css.itemGrammarExampleToken}>#画廊</b>
      <b className={`${css.itemPrioChip} ${css.itemGrammarExampleToken}`} data-tone="urgent">!1</b>
      <b className={`${css.itemGrammarExampleToken} ${css.itemGrammarExampleWhen}`}>@明天</b>
      <span className={css.itemGrammarExampleWords}>{t('item.empty.sample')}</span>
    </p>
  )
}
