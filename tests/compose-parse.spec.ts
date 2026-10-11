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
import { formatItemDate, parseItemDate, readDateDraft } from '../src/client/item/model.ts'

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

describe('三个日期各写各的，一行里可以写全三个', () => {
  it('裸 @ 就是「计划」，不是另外两个', () => {
    const result = parse('@12/24')
    expect(result.dueAt).toBe(new Date(2026, 11, 24).getTime())
    expect(result.hardDueAt).toBeUndefined()
    expect(result.startsAfter).toBeUndefined()
  })

  it('@截止 写的是最后那条期限，不是计划的那个日期', () => {
    const result = parse('@截止 12/24')
    expect(result.hardDueAt).toBe(new Date(2026, 11, 24).getTime())
    expect(result.dueAt).toBeUndefined()
  })

  it('@开始 写的是那扇门，不是计划的那个日期；单字 @早 / @晚 是同一件事', () => {
    const gate = parse('@开始 12/24')
    expect(gate.startsAfter).toBe(new Date(2026, 11, 24).getTime())
    expect(gate.dueAt).toBeUndefined()
    expect(parse('@早 12/24').startsAfter).toBe(gate.startsAfter)
    expect(parse('@晚 12/24').hardDueAt).toBe(new Date(2026, 11, 24).getTime())
  })

  it('一行里三个 @ 就三个都到，裸 @ 与 @计划 是同一个', () => {
    // 每一个日期都在未来：已经过去的 `M/D` 会被当成有歧义而拒掉，而这条测试要钉的是
    // 「三个都在」。
    const result = parse('大活儿 @开始 10/25 @12/24 @截止 12/30')
    expect(result.startsAfter).toBe(new Date(2026, 9, 25).getTime())
    expect(result.dueAt).toBe(new Date(2026, 11, 24).getTime())
    expect(result.hardDueAt).toBe(new Date(2026, 11, 30).getTime())
    expect(result.title).toBe('大活儿')
    expect(parse('@12/24').dueAt, '裸 @ 与 @计划 读出了两个不同的日期').toBe(parse('@计划 12/24').dueAt)
  })

  it('同一个日期写第二遍：那一个不生效，并且带回一句为什么', () => {
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
    expect(parse('@开始 10/25 @10/26 @截止 10/27').refused).toEqual([])
  })
})

describe('一套日期词，两个入口', () => {
  it('一句话里认的写法，三个日期框里认的是同一个时刻', () => {
    // 两个入口认同一套写法：快记认星期几与 `+N`，日期框也认它们——读者在一个入口学
    // 会的写法，不该在隔壁那个框里被拒，因为那两个框说的是同一件事。
    // 这一条钉的是「同一串字 → 同一个时刻」，所以它比两边的词表都强。
    for (const word of ['明天', '@明天', '周三', '2026-10-15', '10/15', '+3']) {
      const inLine = parse(`干活 @${word.replace(/^@/, '')}`).dueAt
      expect(parseItemDate(word, T0), `${word} 在两个入口里读出了两个日期`).toBe(inLine)
    }
  })

  it('日期框里带着那个日期的名字写，也读得懂——名字在那儿的身份只是读者的说话方式', () => {
    // 框本来就知道自己是哪个日期，所以「@截止 10/15」这个名字在这里只是语气词。
    expect(parseItemDate('@截止 10/15', T0)).toBe(new Date(2026, 9, 15).getTime())
    expect(parseItemDate('@开始 10/15', T0)).toBe(new Date(2026, 9, 15).getTime())
    expect(parseItemDate('@计划 10/15', T0)).toBe(new Date(2026, 9, 15).getTime())
    // 英文那一套词同样认（两份字典是同一份文档的两个语言版本）。
    expect(parseItemDate('@target 10/15', T0)).toBe(new Date(2026, 9, 15).getTime())
    expect(parseItemDate('@deadline 10/15', T0)).toBe(new Date(2026, 9, 15).getTime())
    // 带名字的那一种在**一行里**落到它自己那个字段上（同一条词的两种用法）。
    expect(parse('干活 @截止 10/15').hardDueAt).toBe(new Date(2026, 9, 15).getTime())
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
    // line's own first character. Starting at the caption counts the indent twice —
    // and because the escape hatch splices at that offset, undoing a step puts the
    // backslash INSIDE the sentence and leaves the line a checkbox, so 「撤回」 looks
    // like it did nothing.
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

/**
 * 印得出来的，就读得回来——**两边语言都算**。
 *
 * WHY THIS IS A PROPERTY AND NOT A LIST OF SPELLINGS. The two halves of a date
 * are written in two different places: `formatItemDate` decides what a day LOOKS
 * like and `parseDateExpression` decides what a day SOUNDS like. Nothing in the
 * type system ties them together, so they can drift apart silently — and when
 * they do, the reader is looking at `10月15日` on a row, typing exactly that
 * into the field, and being told 「这个读法我没读懂」. Generated from the
 * formatter itself, this test cannot be satisfied by adding one more spelling by
 * hand: it fails again the moment the printer changes.
 *
 * The one honest exception is a day that has already passed inside the current
 * year: `9月10日` means this year to the person who just read it off this screen,
 * but `@9/10` typed into the capture box is genuinely ambiguous (this year or
 * next), and `PRODUCT.md` pins that ambiguity as a refusal. So the property is
 * 「**读到了就必须是那一天，没读到就必须说得出为什么**」 — which no silent
 * wrong answer can satisfy.
 */
describe('日期这一门语言：印得出来的，就读得回来', () => {
  const offsets = [0, 1, 7, 30, 100, 400, -1, -30, -400]

  it('每一种印出来的写法，读回来都是同一天（中文与英文各一遍）', () => {
    for (const offset of offsets) {
      for (const english of [false, true]) {
        const at = midnight + offset * DAY
        const printed = formatItemDate(at, english, T0)
        const draft = readDateDraft(printed, T0)
        const where = `${english ? 'en' : 'zh'} 印出来「${printed}」`
        if (draft.kind === 'at') expect(draft.at, `${where}，读回来却是另一天`).toBe(at)
        else expect(draft.kind === 'bad' && draft.reason, `${where}，既没读回来也没说为什么`).toBe('past')
      }
    }
  })

  it('读得回来的一串，在同一天里只有一种意思', () => {
    // 跨年那一档必须带上年份才印得出来（见 `formatItemDate`），读回来也该带上。
    const nextYear = new Date(2027, 9, 15).getTime()
    for (const word of ['2027年10月15日', '2027-10-15', '2027/10/15', 'Oct 15, 2027']) {
      expect(parseItemDate(word, T0), `${word} 没读成 2027 年 10 月 15 日`).toBe(nextYear)
    }
    const thisYear = new Date(2026, 9, 15).getTime()
    for (const word of ['10月15日', '10月15', '2026年10月15日', 'Oct 15']) {
      expect(parseItemDate(word, T0), `${word} 没读成今年 10 月 15 日`).toBe(thisYear)
    }
  })

  it('不存在的那一天不许被悄悄滚到下个月', () => {
    // `new Date(2026, 12, 45)` 是一个**合法**的 Date：它滚到 2027-02-14。把那个时刻
    // 写进文档，读者的「12 月 45 日」就变成二月里的一天，而屏上没有一个字说这件事。
    for (const word of ['2026-13-45', '2026-02-30', '2026-4-31', '2027-02-29', '10月32日']) {
      const draft = readDateDraft(word, T0)
      expect(draft.kind === 'bad' && draft.reason, `${word} 不是一天，却被当成了 ${JSON.stringify(draft)}`).toBe('impossible')
    }
    // 闰年的 2 月 29 是真的存在的那一天，不许被上面这条规则误伤。
    expect(parseItemDate('2028-02-29', T0)).toBe(new Date(2028, 1, 29).getTime())
  })

  it('一个词读不懂，和「今年已经过了」不是同一件事', () => {
    // 两句拒绝说的是两件不同的事，改法也不同：一句教写法，一句教怎么补年份。
    const unreadable = readDateDraft('下个月中旬', T0)
    expect(unreadable.kind === 'bad' && unreadable.reason).toBe('unreadable')
    const past = readDateDraft('9/10', T0)
    expect(past.kind === 'bad' && past.reason).toBe('past')
  })
})

/**
 * 读不懂的日期要出声——**但读者写的字一个都不许丢**。
 *
 * THE SILENCE WAS THE DEFECT. `@截止 13/45` used to fall back to ordinary prose:
 * no chip, no sentence, no date — and a row that saved as if nothing had
 * happened. The opposite reflex is just as wrong: nagging on every `@`
 * (`回复 @张三`, `@每周`) turns a help line into noise, and a reader who learns
 * to ignore it has learned nothing. So the rule has two halves, and they are
 * tested together: **say something when the words after `@` are trying to be a
 * date**, and say nothing when they are not.
 */
describe('读不懂的日期要出声，而读者的字一个都不许丢', () => {
  it('带日期名字的、写得像日期的，都带回一句为什么', () => {
    const named = parse('干活 @截止 下个月中旬')
    expect(named.refused.map(one => one.raw)).toEqual(['@截止 下个月中旬'])
    expect(named.refused[0]?.reason).toBe('unreadable')
    const shaped = parse('干活 @13/45')
    expect(shaped.refused.map(one => one.raw)).toEqual(['@13/45'])
    expect(shaped.refused[0]?.reason).toBe('impossible')
  })

  it('被拒的那一串仍然在读者的句子里，一个字都没少', () => {
    // 「写了又丢」比「没写」更贵：读者看不见那个词，就以为它生效了。
    for (const text of ['干活 @截止 下个月中旬', '干活 @13/45']) {
      const result = parse(text)
      expect(result.title, `${text} 里的被拒词被吃掉了`).toBe(text)
      expect(result.tokens, `${text} 里被拒的词不该变成芯片`).toEqual([])
    }
  })

  it('不像是要写日期的 @，一个字都不说', () => {
    // `@每周` 的「每周」不是日期，而 `@张三` 是一个名字。两者都原样留着——这条
    // 与下一条一起，是「别处不要变成噪声」的那一半。
    for (const text of ['写周报 @每周', '回复 @张三', '改 @晚餐的菜单']) {
      const result = parse(text)
      expect(result.refused, `${text} 报了一个不是日期的词`).toEqual([])
      expect(result.title).toBe(text)
    }
  })

  it('同一个日期写第二遍：第一个仍然作数，第二个留在句子里并说清为什么', () => {
    const result = parse('@12/24 @12/26')
    expect(result.dueAt).toBe(new Date(2026, 11, 24).getTime())
    expect(result.refused.map(one => one.raw)).toEqual(['@12/26'])
    expect(result.refused[0]?.reason).toBe('duplicate')
    expect(result.title, '第二个日期被静默吃掉了').toBe('@12/26')
    expect(result.tokens.filter(token => token.kind === 'due')).toHaveLength(1)
  })

  it('被拒词的起止就是它自己那串字，一个字符都不差', () => {
    // 撤回（`escapeComposerToken`）正是按这个范围插反斜杠的：范围错一个字符，反斜杠
    // 就插进读者自己的句子里。
    for (const text of ['干活 @截止  下个月中旬', '干活 @13/45 收尾']) {
      for (const token of parse(text).tokens) {
        expect(text.slice(token.start, token.end)).toBe(token.raw)
      }
    }
  })

  it('印出来的那一串写在句子里，也认得', () => {
    expect(parse('交周报 @10月15日').dueAt).toBe(new Date(2026, 9, 15).getTime())
  })
})
