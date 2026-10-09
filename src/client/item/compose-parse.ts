/**
 * Quick capture: turn one line of typing into a structured row.
 *
 * WHAT THIS IS FOR. The capture box is the whole reason the panel exists, and
 * it is the one place where speed beats completeness. A reader who has to open
 * a form, pick a priority from a menu and fill a date field has spent four
 * times the effort of writing the sentence, and the thought that arrived while
 * they were clicking is gone. So the box takes the sentence and reads the
 * structure out of it: `#画廊` is a tag, `!1` is a priority, `@明天` is a date.
 *
 * TWO RULES, BOTH LEARNED FROM THE FAILURE EVERYONE ELSE SHARES.
 *
 *  **NEVER GUESS.** An ambiguous spelling stays literal text. `@9/28` resolves
 *  to this year, and when that day has already passed the token is NOT
 *  consumed — because "this year or next" is exactly the guess that makes a
 *  date land a day out, and a reader who cannot trust the box stops using it.
 *  The reader sees their own words untouched, which is the only honest answer
 *  to a string that could mean two things; `@2027/9/28` is there when they mean
 *  next year.
 *
 *  **EVERY RECOGNITION IS UNDOABLE, IN THE TEXT ITSELF.** Each recognised
 *  token comes back with the exact range it occupies, and escaping one rewrites
 *  the source with a backslash in front of it. So the escape is not a mode, not
 *  a setting and not a hidden flag: it is visible in the box, it survives the
 *  next keystroke, and a reader who disagrees with the parser can see exactly
 *  which word the parser claimed and take it back.
 *
 * A parser that cannot be argued with is worse than no parser, because the
 * reader's only remaining option is to stop writing in the box at all.
 */
import { PRIORITY_DIGIT, type ItemPriority } from '../../core/item-view.ts'
/**
 * THE DAY BOUNDARY IS THE MODEL'S, and this file used to carry its own copy.
 *
 * `@今天`, `@明天` and a bare `@9/30` all resolve against 「which day is it」, and
 * that question is answered once, in `core`, because the answer has to agree
 * across every surface: the capture box writing a date, the three date readings
 * on a row, and the agenda deciding which day a row belongs to. Two copies is
 * not a style question — the two differ the moment one of them is asked on a
 * device in another timezone, and nothing anywhere reports it.
 */
import { parseDateExpression } from './model.ts'

/** What a recognised token became. Drives the chip the box draws. */
export type ComposerTokenKind = 'tag' | 'priority' | 'due' | 'hard' | 'earliest' | 'step'

/** One recognised piece of the source, with the range it occupies. */
export interface ComposerToken {
  /** Start offset in the source text, inclusive. */
  readonly start: number
  /** End offset in the source text, exclusive. */
  readonly end: number
  /** The characters as typed, backslash excluded. */
  readonly raw: string
  readonly kind: ComposerTokenKind
  /** The tag's text, the priority tier, or a step's line. Undefined for dates. */
  readonly text: string | undefined
  /** The resolved instant, for the three date kinds. */
  readonly at: number | undefined
  /** Whether a step token was ticked. */
  readonly done: boolean | undefined
}

/** One step as it will be stored: the document mints the id, not the parser. */
export interface ComposerStep {
  readonly text: string
  readonly done: boolean
}

/** Everything a capture produced, and the tokens it was built from. */
export interface ComposerParse {
  /** The first surviving prose line. */
  readonly title: string
  /** The remaining prose lines. */
  readonly body: string
  readonly steps: ComposerStep[]
  readonly tags: string[]
  /** `undefined` when the writer never said, so the model's default is untouched. */
  readonly priority: ItemPriority | undefined
  readonly dueAt: number | undefined
  readonly hardDueAt: number | undefined
  readonly startsAfter: number | undefined
  readonly tokens: ComposerToken[]
  /**
   * 被拒的词：**同一个日子已经写过了**，所以这一个没有生效（也不画成芯片）。
   *
   * 它们留在正文里当普通文字，而输入框下面那句话就说清为什么。静默覆盖会更省事，
   * 但那样屏上会出现两枚都写着日期的芯片而只有后一个进了文档——**屏上自相矛盾**，
   * 而读者唯一的解释是「它随便挑了一个」。
   */
  readonly refused: readonly ComposerRefusal[]
  /** The source with every checkbox line removed — what a re-parse should read. */
  readonly source: string
}

/** 一个被拒的词：原样写的那串字，以及它想写的那个日子。 */
export interface ComposerRefusal {
  readonly raw: string
  readonly field: 'startsAfter' | 'dueAt' | 'hardDueAt'
}

/**
 * The result for a box with nothing in it, or nothing worth reading.
 *
 * A function rather than a shared constant, because a caller holds this across
 * renders and a frozen shared object would let one render's array be another
 * render's array. The panel never mutates a parse result, but "never mutates"
 * is a promise about every future caller, and an allocation is cheaper than it.
 */
function emptyParse(): ComposerParse {
  return {
    title: '', body: '', steps: [], tags: [], priority: undefined,
    dueAt: undefined, hardDueAt: undefined, startsAfter: undefined, tokens: [], refused: [], source: '',
  }
}

/** `!1`..`!4`，**core 那张数字表的逆表**：一行只在写下去的时候需要这个方向。 */
const PRIORITY_BY_DIGIT: Readonly<Record<string, ItemPriority>> = Object.fromEntries(
  Object.entries(PRIORITY_DIGIT).map(([priority, digit]) => [digit, priority as ItemPriority]),
)

/** A checkbox line: `- [ ] text`, `* [x] text`. The box is optional width. */
const CHECKBOX = /^(\s*)[-*]\s*\[\s*([ xX]?)\s*\]\s*(.+)$/

/** One surviving line, with where it started in the WHOLE source. */
interface SourceLine {
  readonly value: string
  readonly at: number
}

/**
 * Read one capture.
 *
 * Line-oriented on purpose: a checkbox belongs to a line, and a token belongs to
 * a line's text, so a capture written across three lines gets its steps from
 * the lines that asked for them and its prose from the rest. Offsets are
 * tracked against the whole source so a chip drawn on line three can still say
 * which characters it is claiming.
 * @param text - what is in the box.
 * @param now - the reading clock, so a date word means today.
 * @returns the structured row, and every token that was recognised.
 */
export function parseComposerInput(text: string, now: number): ComposerParse {
  const lines = text.split('\n')
  const steps: ComposerStep[] = []
  const stepTokens: ComposerToken[] = []
  const prose: SourceLine[] = []
  let offset = 0
  for (const line of lines) {
    const box = CHECKBOX.exec(line)
    if (box !== null) {
      const caption = (box[3] as string).trim()
      if (caption !== '') {
        /* **一个 token 的范围就是它自己的那串字。** 步骤这一枚的 `raw` 是整行（去掉缩进），
         * 所以 `start` 必须是**行首**（第一个 `-` 的位置），不是标题的位置：
         *  · 曾经写成 `box[1].length + line.indexOf(caption)`——缩进算了两遍，而 `indexOf`
         *    找到的是那串字的**第一次**出现，不一定是标题（`- [ ] -` 就能骗到它）；
         *  · 而撤回（`escapeComposerToken`）正是在这个偏移上插一个反斜杠，所以一个错数
         *    会把反斜杠插进读者自己的句子里；
         *  · 更要紧的是语义：插在标题前面，这一行**仍然是**一个勾选项（正则照样匹配），
         *    于是「撤回」按了等于没按。插在行首的 `-` 前面，它才真的变回普通文字。
         * `line.length - line.trimStart().length` 就是缩进的长度，精确且不必再写第二个正则。 */
        const lead = line.length - line.trimStart().length
        const ticked = (box[2] as string).toLowerCase() === 'x'
        steps.push({ text: caption, done: ticked })
        stepTokens.push({
          start: offset + lead,
          end: offset + line.length,
          raw: line.trim(),
          kind: 'step',
          text: caption,
          at: undefined,
          done: ticked,
        })
      }
      offset += line.length + 1
      continue
    }
    if (line.trim() !== '') prose.push({ value: line, at: offset })
    offset += line.length + 1
  }

  const tags: string[] = []
  const refused: ComposerRefusal[] = []
  const tokens: ComposerToken[] = [...stepTokens]
  let priority: ItemPriority | undefined
  let dueAt: number | undefined
  let hardDueAt: number | undefined
  let startsAfter: number | undefined

  // A tag is stripped from prose wherever it appears, so the rest of the line
  // becomes the words rather than a word with a marker glued to it.
  const cleaned = prose.map(entry => {
    const rest = entry.value
    const cursor = entry.at
    let out = ''
    for (let i = 0; i < rest.length; i += 1) {
      const char = rest[i] as string
      // A backslash is the escape: it is consumed and the character after it is
      // ordinary text, which is what makes an escaped token permanent.
      if (char === '\\' && i + 1 < rest.length) {
        out += rest[i + 1]
        i += 1
        continue
      }
      const at = cursor + i
      // The slice starts AT the marker, not after it. Slicing past the marker
      // and then anchoring the pattern to it means the pattern can never match
      // — the character it asks for was removed one step earlier — and the
      // whole tag/date syntax silently reads as ordinary prose. `!` survived
      // only because it indexes the next character directly instead of
      // re-anchoring, which is how one of the three markers was ever tested.
      if (char === '#') {
        const name = /^#([^\s#]+)/.exec(rest.slice(i))?.[1]
        if (name !== undefined) {
          tags.push(name)
          tokens.push({ start: at, end: at + 1 + name.length, raw: `#${name}`, kind: 'tag', text: name, at: undefined, done: undefined })
          i += name.length
          continue
        }
      }
      if (char === '!') {
        const digit = rest[i + 1]
        if (digit !== undefined && PRIORITY_BY_DIGIT[digit] !== undefined) {
          const tier = PRIORITY_BY_DIGIT[digit] as ItemPriority
          priority = tier
          tokens.push({ start: at, end: at + 2, raw: `!${digit}`, kind: 'priority', text: tier, at: undefined, done: undefined })
          i += 1
          continue
        }
      }
      if (char === '@') {
        /* **三个日子各写各的，一个字段只认一次。**
         *
         * 词表与字段名是同一套：裸 `@` 就是「希望在」（最常写的那个），`@不早于` 与
         * `@不晚于` 各写另外两个。各还有一个单字短写（`@早` / `@晚`）——快记是打字的活儿，
         * 而那个字就是词的开头，学一次就记得住。
         *
         * 同一个字段写了第二次**不静默覆盖**：那串字不变成芯片，这一份解析把它带回
         * `refused`，由输入框下面一句话说清为什么（见 {@link ComposerRefusal}）。 */
        const word = /^@((?:不早于|不晚于|希望(?:在)?|早|晚)?\s*\S+)/.exec(rest.slice(i))?.[1] ?? ''
        const named = /^(不早于|不晚于|希望(?:在)?|早|晚)\s*(\S*)/.exec(word)
        const qualifier = named?.[1]
        const kind: ComposerTokenKind = qualifier === '不晚于' || qualifier === '晚'
          ? 'hard'
          : qualifier === '不早于' || qualifier === '早' ? 'earliest' : 'due'
        const dateWord = named === null ? word : (named[2] as string)
        const at0 = parseDateExpression(dateWord, now)
        if (at0 !== undefined) {
          const raw = qualifier === undefined ? `@${dateWord}` : `@${qualifier} ${dateWord}`
          const field: 'startsAfter' | 'dueAt' | 'hardDueAt' = kind === 'hard' ? 'hardDueAt' : kind === 'earliest' ? 'startsAfter' : 'dueAt'
          const already = field === 'hardDueAt' ? hardDueAt : field === 'startsAfter' ? startsAfter : dueAt
          if (already !== undefined) {
            refused.push({ raw, field })
          } else {
            if (field === 'hardDueAt') hardDueAt = at0
            else if (field === 'startsAfter') startsAfter = at0
            else dueAt = at0
            tokens.push({
              start: at,
              end: at + raw.length,
              raw,
              kind,
              text: undefined,
              at: at0,
              done: undefined,
            })
          }
          i += raw.length - 1
          continue
        }
      }
      out += char
    }
    return out
  })

  const kept = cleaned.map(line => line.trim()).filter(line => line !== '')
  const title = kept[0] ?? ''
  const body = kept.slice(1).join('\n')
  if (title === '' && body === '' && steps.length === 0 && tags.length === 0 && priority === undefined
    && dueAt === undefined && hardDueAt === undefined && startsAfter === undefined) {
    return emptyParse()
  }
  return {
    title,
    body,
    steps,
    tags: [...new Set(tags)],
    priority,
    dueAt,
    hardDueAt,
    startsAfter,
    tokens: tokens.sort((a, b) => a.start - b.start),
    refused,
    source: kept.join('\n'),
  }
}

/**
 * Take one token back: rewrite the source so the word becomes plain text again.
 *
 * The rewrite puts a backslash in front of the token's own first character and
 * changes nothing else, so the reader can see in the box which word was claimed
 * and that the claim has been withdrawn. Re-parsing reads the backslash, drops
 * it, and hands the character back as prose.
 * @param text - the current source.
 * @param token - the token to release.
 * @returns the source with that token escaped.
 */
export function escapeComposerToken(text: string, token: ComposerToken): string {
  if (token.start < 0 || token.end > text.length || token.end <= token.start) return text
  return `${text.slice(0, token.start)}\\${text.slice(token.start)}`
}
