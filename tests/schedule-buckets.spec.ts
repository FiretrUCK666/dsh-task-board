/**
 * The agenda's closed tables (`client/item/labels.ts`) — what the schedule page
 * is allowed to know about a bucket.
 *
 * WHY THIS FILE EXISTS. 排期页原来在渲染处写了一个三元
 * （`gated ? … : undated ? … : undefined`），而**加一个桶不会有人想起要写解释**。少一句解释在
 * 屏幕上表现为「这一节没有 ⓘ」——一处**不存在**的东西不会有人报缺陷，于是两个晚了的节
 * （截止已过 / 计划已过）就这样一直没有话说，而它们的名字只说得出「哪一个日期过去了」。
 *
 * 表的闭合性由类型保证（`Record<ScheduleBucketId, …>` 少一格就编译不过），所以这里的断言
 * **不重抄那张名单**：成员从模型自己的 `SCHEDULE_BUCKETS` 取，值从字典取，页面那一头由一条
 * 结构性读法钉住（它只能经那张表问「这一节有没有话说」）。测试里手写一份名单，就是同一个问题
 * 的第二个答案。
 */
import { describe, expect, it } from 'vitest'
import { SCHEDULE_BUCKETS, type ScheduleBucketId } from '../src/core/item-schedule.ts'
import { BUCKET_EXPLAIN, BUCKET_LABEL } from '../src/client/item/labels.ts'
import { zh, en } from '../src/client/locales.ts'
import { readSource } from './panel-harness.ts'

/** 按天的那四节：它们的名字就是那一天，所以它们**没有**第二句话可说。 */
const DAY_BUCKETS: readonly ScheduleBucketId[] = ['today', 'tomorrow', 'week', 'later']

/** 一页里有没有「拿桶 id 比出来的三元」——一次 `bucket.id` 与字符串的比较。 */
function bucketTernaryIn(text: string): boolean {
  return /bucket\.id\s*===/.test(text)
}

/** JS/TS 注释剥掉：散文里提到某个桶不算一次判断（硬性规范 14）。 */
function stripJsComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('排期页的节：一张闭合的表，一个格子都不少', () => {
  it('每一个桶都有自己的格子，而按天的那四格是**写下来的**「没有」', () => {
    // 键集**从模型取**：加一个桶而表里漏一格是编译错误，这一条钉的是「漏了会被发现」。
    expect(Object.keys(BUCKET_EXPLAIN).sort()).toEqual([...SCHEDULE_BUCKETS].sort())
    // 「按天的那几节不需要解释」不是省掉一行，是写下来的一个 `undefined`：
    // 省掉的那一行与「想过之后决定不说」在源码里长得一模一样。
    for (const id of DAY_BUCKETS) {
      expect(BUCKET_EXPLAIN[id], `${id} 是按天的一节，它的名字就是那一天`).toBeUndefined()
    }
  })

  it('两个晚了的节各自有话说，而两句话都在字典里（中英两档）', () => {
    /* 这是这一轮的缺陷本身：`behind` 与 `hardOverdue` 既没有解释也没有 ⓘ，于是「计划的那天
       过了，活还没完」这件事屏幕上没有一处会讲。 */
    for (const id of ['hardOverdue', 'behind'] as const) {
      const key = BUCKET_EXPLAIN[id]
      expect(key, `${id} 这一节没有话说——而它的名字只说得出哪一个日期过去了`).toBeDefined()
      if (key === undefined) continue
      expect((zh[key] ?? '').length, `${id} 的中文解释是空的`).toBeGreaterThan(0)
      expect((en[key] ?? '').length, `${id} 的英文解释是空的`).toBeGreaterThan(0)
    }
  })

  it('表里出现的每一个键都是真键，而且和节名不是同一句', () => {
    for (const id of SCHEDULE_BUCKETS) {
      const key = BUCKET_EXPLAIN[id]
      if (key === undefined) continue
      expect(zh[key], `${id} 的解释指向一个不存在的键（屏上会印出 undefined）`).toBeDefined()
      // 一句与节名逐字相同的话不是解释：它把同一句话说两遍，而 ⓘ 会看起来坏了。
      expect(zh[key], `${id} 的解释与它的节名逐字相同`).not.toBe(zh[BUCKET_LABEL[id]])
    }
  })

  it('排期页只能经那张表说「这一节有没有话说」', () => {
    /* **结构性读法**：这一页里不该再出现「桶 id 比出来的三元」。判据读的是结构
       （`BUCKET_EXPLAIN[bucket.id` 这一次查表），不是字样：注释里提到某个桶不算。 */
    const page = stripJsComments(readSource('item/pages/schedule.tsx'))
    expect(page, '排期页不再查那张表了——加一个桶不会有编译错误').toContain('BUCKET_EXPLAIN[bucket.id')
    expect(bucketTernaryIn(page), '排期页又用三元判断桶了：加一个桶不会有人想起写解释').toBe(false)
  })

  it('而那条读法咬得动', () => {
    const sick = "const explain = bucket.id === 'gated' ? t('item.gated.hint') : undefined"
    expect(bucketTernaryIn(sick), '种了病的一页被放过了').toBe(true)
    expect(bucketTernaryIn('const explain = BUCKET_EXPLAIN[bucket.id as ScheduleBucketId]')).toBe(false)
  })
})

describe('节名与解释来自同一处', () => {
  it('两张表的键集相同（同一个模型，同一张名单）', () => {
    expect(Object.keys(BUCKET_LABEL).sort()).toEqual(Object.keys(BUCKET_EXPLAIN).sort())
  })

  it('两个晚了的节名各自带着字段自己的词（与 `locales.spec.ts` 那条互为两侧）', () => {
    // 排期页读的就是 `BUCKET_LABEL`，所以「节名说的是哪一个日期」这件事在这一侧也成立。
    expect(zh[BUCKET_LABEL.hardOverdue]).toContain(zh['item.field.hardDueAt'])
    expect(zh[BUCKET_LABEL.behind]).toContain(zh['item.field.dueAt'])
  })
})
