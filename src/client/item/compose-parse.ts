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
import type { ItemPriority } from '../../core/item.ts'
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
import { startOfDay } from '../../core/item-view.ts'

/** A whole day in milliseconds. */
const DAY_MS = 86_400_000

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
  /** The source with every checkbox line removed — what a re-parse should read. */
  readonly source: string
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
    dueAt: undefined, hardDueAt: undefined, startsAfter: undefined, tokens: [], source: '',
  }
}

/** `!1`..`!4` read the way every task tool numbers them: 1 is the loudest. */
const PRIORITY_BY_DIGIT: Readonly<Record<string, ItemPriority>> = {
  '1': 'urgent', '2': 'high', '3': 'normal', '4': 'low',
}

/** Weekday words, Monday first, to match `Date.getDay()` after the offset. */
const WEEKDAYS: Readonly<Record<string, number>> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
}

/** Fixed words for the near days. */
const NEAR_DAYS: Readonly<Record<string, number>> = {
  '今天': 0, '今日': 0, '明天': 1, '明日': 1, '后天': 2, '大后天': 3,
}

/**
 * Resolve a date the writer typed, or refuse.
 *
 * The accepted forms are deliberately few and each one has exactly one reading
 * in the writer's own timezone: fixed near words, a weekday, an explicit
 * `M/D` that is still ahead, an explicit `YYYY/M/D`, and a `+N` day count.
 * Anything else is `undefined`, and an unrecognised date leaves the text alone
 * rather than becoming a row with the wrong day on it.
 * @param word - what followed the `@`.
 * @param now - the reading clock.
 * @returns the instant, or `undefined` when the words do not resolve to one.
 */
function resolveDateWord(word: string, now: number): number | undefined {
  if (word === '') return undefined
  const today = startOfDay(now)
  if (NEAR_DAYS[word] !== undefined) return today + (NEAR_DAYS[word] as number) * DAY_MS
  if (word === '下周') return today + 7 * DAY_MS
  const weekday = WEEKDAYS[word.replace(/^下/, '')]
  if (weekday !== undefined) {
    // Strictly forward: a weekday that has already passed this week means the
    // next one, and saying so is arithmetic rather than a guess. `下X` pins the
    // following week, which is the one case where "next" is the whole point.
    const isNextWeek = word.startsWith('下')
    const current = today
    const name = new Date(current).getDay() === 0 ? 7 : new Date(current).getDay()
    let delta = weekday - name
    if (delta <= 0) delta += 7
    return current + (isNextWeek ? delta + 7 : delta) * DAY_MS
  }
  const relative = /^\+(\d{1,3})$/.exec(word)
  if (relative !== null) return today + Number(relative[1]) * DAY_MS
  const full = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(word)
  if (full !== null) {
    const at = new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]))
    return at.getTime()
  }
  const short = /^(\d{1,2})[\/-](\d{1,2})$/.exec(word)
  if (short !== null) {
    const at = new Date(new Date(now).getFullYear(), Number(short[1]) - 1, Number(short[2]))
    const stamp = at.getTime()
    // Past means ambiguous, and ambiguous means untouched. `YYYY/M/D` is
    // there for the year the reader actually means.
    return stamp >= today ? stamp : undefined
  }
  return undefined
}

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
        const lead = (box[1] as string).length + line.indexOf(caption)
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
        // The date word MAY be preceded by a qualifier and a space — `@硬 9/30`
        // and `@最早 9/25` are the documented forms, and `\S+` alone stops at
        // that space, so the qualifier form resolved to an empty word and was
        // thrown away. The qualifier is optional, so `@明天` still reads whole.
        const word = /^@((?:硬|最早)?\s*\S+)/.exec(rest.slice(i))?.[1] ?? ''
        const named = /^(硬|最早)\s*(\S*)/.exec(word)
        const kind: ComposerTokenKind = named === null ? 'due' : named[1] === '硬' ? 'hard' : 'earliest'
        const dateWord = named === null ? word : (named[2] as string)
        const at0 = resolveDateWord(dateWord, now)
        if (at0 !== undefined) {
          if (kind === 'due') dueAt = at0
          else if (kind === 'hard') hardDueAt = at0
          else startsAfter = at0
          const raw = named === null ? `@${dateWord}` : `@${named[1]} ${dateWord}`
          tokens.push({
            start: at,
            end: at + raw.length,
            raw,
            kind,
            text: undefined,
            at: at0,
            done: undefined,
          })
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
