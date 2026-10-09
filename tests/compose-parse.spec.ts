/**
 * Quick capture's parser: the sentence the reader typed, read into fields.
 *
 * WHY THIS FILE IS A CONTRACT AND NOT A CONVENIENCE. A capture box that
 * misreads its input does not fail — it files the row with the wrong day on it,
 * and the reader finds out a week later. The whole category's most-complained
 * defect is exactly this: a date phrase swallowed out of a title, a day off by
 * one, a word eaten. So the cases below are the shapes that actually happen in
 * the wild, and the escape hatch is pinned as hard as the parsing, because a
 * parser that can be wrong with no way back is worse than no parser.
 *
 * `PRIORITY_BY_DIGIT` is written out by hand in the source, and that is not
 * fussiness: the enum runs low -> high while `!1` is the LOUDEST, so anything
 * derived from array position gets the mapping exactly backwards.
 */
import { describe, expect, it } from 'vitest'
import {
  escapeComposerToken,
  parseComposerInput,
  type ComposerToken,
} from '../src/client/item/compose-parse.ts'

const DAY = 86_400_000
/** A fixed Tuesday, 10:00 local, so every relative word is arithmetic. */
const T0 = new Date(2026, 8, 29, 10, 0, 0).getTime()
const midnight = (() => { const d = new Date(T0); d.setHours(0, 0, 0, 0); return d.getTime() })()

function parse(text: string) {
  return parseComposerInput(text, T0)
}

describe('prose', () => {
  it('reads an empty box as nothing at all, not as a blank row', () => {
    const result = parse('')
    expect(result.title).toBe('')
    expect(result.steps).toEqual([])
    expect(result.tokens).toEqual([])
  })

  it('reads whitespace and a lone newline as nothing', () => {
    expect(parse('   \n  \n ').tokens).toEqual([])
  })

  it('makes the first surviving line the title and keeps the rest as the body', () => {
    const result = parse('第一行\n第二行\n第三行')
    expect(result.title).toBe('第一行')
    expect(result.body).toBe('第二行\n第三行')
  })

  it('a caption line is a step, not prose', () => {
    // The line asked to be a checkbox, so it is not also a sentence.
    const result = parse('要做的事\n- [ ] 第一步\n- [x] 已经做过的')
    expect(result.title).toBe('要做的事')
    expect(result.body).toBe('')
    expect(result.steps).toEqual([
      { text: '第一步', done: false },
      { text: '已经做过的', done: true },
    ])
  })

  it('accepts * as well as - for the checkbox, and an empty box', () => {
    expect(parse('* [ ] 星号也行').steps).toEqual([{ text: '星号也行', done: false }])
    expect(parse('- [] 空格也行').steps).toEqual([{ text: '空格也行', done: false }])
  })

  it('drops a checkbox with no caption instead of filing an empty step', () => {
    expect(parse('- [ ]\n- [ ] 真正的一步').steps).toEqual([{ text: '真正的一步', done: false }])
  })
})

describe('tags', () => {
  it('lifts a tag out of the sentence and leaves the words behind', () => {
    const result = parse('重做画廊 #画廊 #重做')
    expect(result.tags).toEqual(['画廊', '重做'])
    expect(result.title).toBe('重做画廊')
  })

  it('folds a repeated tag rather than writing it twice', () => {
    expect(parse('一件事 #a\n另一件 #a').tags).toEqual(['a'])
  })

  it('leaves a bare # alone, because there is no name to file it under', () => {
    expect(parse('标题 # 结尾').tags).toEqual([])
  })
})

describe('priority', () => {
  it('reads 1 as the loudest, not the lowest', () => {
    // The enum runs low -> high. Deriving this from array order inverts it.
    expect(parse('事情 !1').priority).toBe('urgent')
    expect(parse('事情 !2').priority).toBe('high')
    expect(parse('事情 !3').priority).toBe('normal')
    expect(parse('事情 !4').priority).toBe('low')
  })

  it('leaves a digit that is not 1-4 as ordinary text', () => {
    const result = parse('版本 !9 的说明')
    expect(result.priority).toBeUndefined()
    expect(result.title).toBe('版本 !9 的说明')
  })

  it('says nothing when no digit was typed', () => {
    // `undefined` and not the default tier: the model owns the default, and a
    // parser that answers with a value nobody typed is inventing one.
    expect(parse('普通一件事').priority).toBeUndefined()
  })
})

describe('dates', () => {
  it('reads the near words as local midnights', () => {
    expect(parse('@今天').dueAt).toBe(midnight)
    expect(parse('@明天').dueAt).toBe(midnight + DAY)
    expect(parse('@后天').dueAt).toBe(midnight + 2 * DAY)
  })

  it('reads a weekday strictly forward, and 下X as the week after', () => {
    // T0 is a Tuesday, so @三 is later this week and @一 is next week's.
    expect(parse('@三').dueAt).toBe(midnight + DAY)
    expect(parse('@一').dueAt).toBe(midnight + 6 * DAY)
    expect(parse('@下三').dueAt).toBe(midnight + 8 * DAY)
  })

  it('reads a day count', () => {
    expect(parse('@+3').dueAt).toBe(midnight + 3 * DAY)
  })

  it('reads a full date as the year the reader wrote', () => {
    expect(parse('@2026/12/24').dueAt).toBe(new Date(2026, 11, 24).getTime())
  })

  it('REFUSES a bare M/D that is already past', () => {
    // Ambiguous means untouched: `@1/2` in October could be January or last
    // January, and a capture surface must not guess which. The full form is
    // there for the year the reader means.
    const result = parse('去年的事 @1/2')
    expect(result.dueAt).toBeUndefined()
    expect(result.title).toContain('@1/2')
  })

  it('accepts a bare M/D that is still ahead', () => {
    expect(parse('@12/24').dueAt).toBe(new Date(2026, 11, 24).getTime())
  })

  it('leaves an unrecognised @ in the words, as plain text', () => {
    // The escape hatch in its most important form: a word the parser does not
    // know must never vanish.
    const result = parse('写周报 @每周')
    expect(result.dueAt).toBeUndefined()
    expect(result.title).toContain('@每周')
  })
})

describe('the three dates keep their own names', () => {
  it('reads 硬 as the hard deadline and NOT as the wanted-by date', () => {
    const result = parse('@硬 12/24')
    expect(result.hardDueAt).toBe(new Date(2026, 11, 24).getTime())
    expect(result.dueAt).toBeUndefined()
  })

  it('reads 最早 as the gate and NOT as the wanted-by date', () => {
    const result = parse('@最早 12/24')
    expect(result.startsAfter).toBe(new Date(2026, 11, 24).getTime())
    expect(result.dueAt).toBeUndefined()
  })

  it('keeps all three apart when a line carries all three', () => {
    // Every date is in the FUTURE on purpose: a bare `M/D` that has already
    // passed is refused as ambiguous, so a test that reached for "9/25" in
    // September would be asserting that the parser gets it wrong.
    const result = parse('大活儿 @最早 10/25 @12/24 @硬 12/30')
    expect(result.startsAfter).toBe(new Date(2026, 9, 25).getTime())
    expect(result.dueAt).toBe(new Date(2026, 11, 24).getTime())
    expect(result.hardDueAt).toBe(new Date(2026, 11, 30).getTime())
    expect(result.title).toBe('大活儿')
  })
})

describe('a token can always be given back', () => {
  /** Undo one token, then re-read: the field it filled must be empty again. */
  function unparse(text: string, kind: ComposerToken['kind']): string {
    const token = parse(text).tokens.find(entry => entry.kind === kind)
    if (token === undefined) {
      // A missing token here means the PARSER lost the syntax, not that the
      // test is wrong — which is the one failure this file exists to catch.
      throw new Error(`no ${kind} token was recognised in ${JSON.stringify(text)}`)
    }
    return escapeComposerToken(text, token)
  }

  it('gives a tag back as plain text', () => {
    const again = unparse('重做画廊 #画廊', 'tag')
    expect(again).toContain('画廊')
    expect(parse(again).tags).toEqual([])
    expect(parse(again).title).toContain('#画廊')
  })

  it('gives a priority back as plain text', () => {
    const again = unparse('事情 !1', 'priority')
    expect(parse(again).priority).toBeUndefined()
    expect(parse(again).title).toContain('!1')
  })

  it('gives a date back as plain text', () => {
    const again = unparse('写周报 @明天', 'due')
    expect(parse(again).dueAt).toBeUndefined()
    expect(parse(again).title).toContain('@明天')
  })

  it('leaves every OTHER token alone when one is given back', () => {
    // The point of the escape being a rewrite at a known offset rather than a
    // re-read of the words: undoing one thing must not undo the rest.
    const again = unparse('一件事 #画廊 !1 @明天', 'tag')
    const after = parse(again)
    expect(after.tags).toEqual([])
    expect(after.priority).toBe('urgent')
    expect(after.dueAt).toBe(midnight + DAY)
  })

  it('is permanent: re-reading an undone token never brings it back', () => {
    // Not "undo it twice" — after the first undo there is no token left to
    // undo, so a second call has nothing to find. The claim is that the escape
    // is IDEMPOTENT: reading the escaped text again and again gives the same
    // plain words, and never a tag. Round-tripped through the RAW text, not
    // through `source`, which is by definition the normalised text a re-parse
    // should read and which consumes the backslash.
    const escaped = unparse('一件事 #画廊', 'tag')
    const first = parse(escaped)
    const second = parse(escaped)
    expect(first.tags).toEqual([])
    expect(second.tags).toEqual([])
    // And the words are still there: undo withdraws the CLAIM, it never deletes
    // what the reader wrote.
    expect(first.title).toContain('#画廊')
    expect(second.title).toBe(first.title)
  })

  it('changes nothing when handed a token that is not there', () => {
    const text = '一件事 #画廊'
    const stale = { start: 900, end: 906, raw: '#画廊', kind: 'tag', text: '画廊', at: undefined, done: undefined } as ComposerToken
    expect(escapeComposerToken(text, stale)).toBe(text)
  })
})

describe('token ranges point back at the source', () => {
  it('every token names the exact characters it claims', () => {
    const text = '重做画廊 #画廊 !1 @明天'
    for (const token of parse(text).tokens) {
      expect(text.slice(token.start, token.end), token.raw).toBe(token.raw)
    }
  })

  it('a token on the SECOND line still indexes the whole source', () => {
    // Offsets are tracked against the whole text, not per line, so a chip drawn
    // on line two can name the right characters.
    const text = '第一行普通\n第二行 #标签'
    const token = parse(text).tokens[0] as ComposerToken
    expect(text.slice(token.start, token.end)).toBe('#标签')
  })

  it('a step line names its own characters, indent and all', () => {
    // A step token's `raw` is the whole line, so its range has to start at the
    // line's own first character. It used to start at the caption, with the indent
    // counted twice — and because the escape hatch splices at that offset, undoing
    // a step put the backslash INSIDE the sentence and left the line a checkbox, so
    // 「撤回」 looked like it did nothing.
    const text = '  - [ ] 写周报'
    const token = parse(text).tokens[0] as ComposerToken
    expect(text.slice(token.start, token.end), 'the step token does not name its own line').toBe(token.raw)
    const released = escapeComposerToken(text, token)
    expect(released).toBe('  \\- [ ] 写周报')
    const after = parse(released)
    expect(after.steps, 'the step survived its own undo').toEqual([])
    expect(after.title, 'undo dropped the reader’s words').toContain('写周报')
  })

  it('reports tokens in reading order', () => {
    const kinds = parse('#一个 !2 @明天').tokens.map(token => token.kind)
    expect(kinds).toEqual(['tag', 'priority', 'due'])
  })

  it('a backslash makes the next character ordinary, which is what makes an undo permanent', () => {
    const result = parse('标题 \\#不是标签')
    expect(result.tags).toEqual([])
    expect(result.title).toBe('标题 #不是标签')
  })
})
