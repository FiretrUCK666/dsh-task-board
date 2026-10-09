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
import { parseItemDate } from '../src/client/item/model.ts'

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

describe('三个日子各写各的，一行里可以写全三个', () => {
  it('裸 @ 就是「希望在」，不是另外两个', () => {
    const result = parse('@12/24')
    expect(result.dueAt).toBe(new Date(2026, 11, 24).getTime())
    expect(result.hardDueAt).toBeUndefined()
    expect(result.startsAfter).toBeUndefined()
  })

  it('@不晚于 写的是最后那条期限，不是希望的那个日子', () => {
    const result = parse('@不晚于 12/24')
    expect(result.hardDueAt).toBe(new Date(2026, 11, 24).getTime())
    expect(result.dueAt).toBeUndefined()
  })

  it('@不早于 写的是那扇门，不是希望的那个日子；单字 @早 / @晚 是同一件事', () => {
    const gate = parse('@不早于 12/24')
    expect(gate.startsAfter).toBe(new Date(2026, 11, 24).getTime())
    expect(gate.dueAt).toBeUndefined()
    expect(parse('@早 12/24').startsAfter).toBe(gate.startsAfter)
    expect(parse('@晚 12/24').hardDueAt).toBe(new Date(2026, 11, 24).getTime())
  })

  it('一行里三个 @ 就三个都到，@希望 与 @希望在 是同一个', () => {
    // 每一个日子都在未来：已经过去的 `M/D` 会被当成有歧义而拒掉，而这条测试要钉的是
    // 「三个都在」。
    const result = parse('大活儿 @不早于 10/25 @12/24 @不晚于 12/30')
    expect(result.startsAfter).toBe(new Date(2026, 9, 25).getTime())
    expect(result.dueAt).toBe(new Date(2026, 11, 24).getTime())
    expect(result.hardDueAt).toBe(new Date(2026, 11, 30).getTime())
    expect(result.title).toBe('大活儿')
    expect(parse('@希望 12/24').dueAt, '@希望 与 @希望在 读出了两个不同的日子').toBe(parse('@希望在 12/24').dueAt)
  })

  it('同一个日子写第二遍：那一个不生效，并且带回一句为什么', () => {
    // 静默覆盖会更省事，但那样屏上会出现两枚都写着日期的芯片而只有后一个进了文档——
    // 屏上自相矛盾，读者唯一的解释是「它随便挑了一个」。
    const result = parse('@12/24 @12/26')
    expect(result.dueAt, '后写的那个没有顶掉先写的').toBe(new Date(2026, 11, 24).getTime())
    expect(result.refused.map(one => one.raw)).toEqual(['@12/26'])
    expect(result.refused[0]?.field).toBe('dueAt')
    // 被拒的那一串**没有变成芯片**：芯片列的就是进了文档的那些。
    expect(result.tokens.filter(token => token.kind === 'due')).toHaveLength(1)
  })

  it('三个各写一次时没有一句拒绝', () => {
    expect(parse('@不早于 10/25 @10/26 @不晚于 10/27').refused).toEqual([])
  })
})

describe('一套日期词，两个入口', () => {
  it('一句话里认的写法，三个日期框里认的是同一个时刻', () => {
    // 两个入口曾经各认一半：快记认星期几与 `+N`，日期框只认 `2026-10-15` 与「明天」——
    // 读者在一个入口学会的写法，在隔壁那个框里被拒，而那两个框说的是同一件事。
    // 这一条钉的是「同一串字 → 同一个时刻」，所以它比两边的词表都强。
    for (const word of ['明天', '@明天', '周三', '2026-10-15', '10/15', '+3']) {
      const inLine = parse(`干活 @${word.replace(/^@/, '')}`).dueAt
      expect(parseItemDate(word, T0), `${word} 在两个入口里读出了两个日子`).toBe(inLine)
    }
  })

  it('日期框里带着那个日子的名字写，也读得懂——名字在那儿的身份只是读者的说话方式', () => {
    // 框本来就知道自己是哪个日子，所以「@不晚于 10/15」这个名字在这里只是语气词。
    expect(parseItemDate('@不晚于 10/15', T0)).toBe(new Date(2026, 9, 15).getTime())
    expect(parseItemDate('@不早于 10/15', T0)).toBe(new Date(2026, 9, 15).getTime())
    expect(parseItemDate('@希望 10/15', T0)).toBe(new Date(2026, 9, 15).getTime())
    // 英文那一套词同样认（两份字典是同一份文档的两个语言版本）。
    expect(parseItemDate('@wanted by 10/15', T0)).toBe(new Date(2026, 9, 15).getTime())
    expect(parseItemDate('@deadline 10/15', T0)).toBe(new Date(2026, 9, 15).getTime())
    // 带名字的那一种在**一行里**落到它自己那个字段上（同一条词的两种用法）。
    expect(parse('干活 @不晚于 10/15').hardDueAt).toBe(new Date(2026, 9, 15).getTime())
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
