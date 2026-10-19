import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * **删除的三句文案，不许从任何一处长回来。**
 *
 * 三句各删一次，而它们的失效方式全是静默的：
 *   1. 日期格旁的注解（`item.field.*.gloss`）——删了渲染，键却还在，下一次改词只改键；
 *   2. 排队/插话那行说明（`detail.sessionDriveHint`）——删了默认值却留着兜底，
 *      于是那句又回来了而没人动过它；
 *   3. 共用的 CSS 类（`.itemFieldGloss`）——没有任何渲染它的地方，却仍占着一条规则。
 *
 * 判据是结构：**键不存在、类不存在、而这三行的其余部分都还在**。只断言「那串字看不见」
 * 是不够的——把整个日期轴删掉，那一句也看不见。
 */
const read = (rel: string): string => readFileSync(new URL(`../src/client/${rel}`, import.meta.url), 'utf8')

describe('the three deleted lines of copy', () => {
  it('the date gloss was deleted, not merely hidden', () => {
    const locales = read('locales.ts')
    for (const key of ['item.field.startsAfter.gloss', 'item.field.dueAt.gloss', 'item.field.hardDueAt.gloss']) {
      expect(locales, `词条 ${key} 还在字典里`).not.toContain(key)
    }
    const labels = read('item/labels.ts')
    expect(labels, 'DATE_GLOSS_KEY 这张表还在').not.toContain('DATE_GLOSS_KEY')
    const css = read('item/item.module.css')
    expect(css, '.itemFieldGloss 这条规则还在，而已经没有任何元素用它').not.toContain('itemFieldGloss')
    for (const file of ['item/detail-pane.tsx', 'item/item-create-dialog.tsx']) {
      expect(read(file), `${file} 还在渲染或引用注解`).not.toContain('GLOSS')
    }
  })

  it('the send-mode explanation was deleted, and the refusal line it shared still works', () => {
    const locales = read('locales.ts')
    expect(locales, 'detail.sessionDriveHint 这句还在字典里').not.toContain('sessionDriveHint')
    const panel = read('board/session-panel.tsx')
    /* **兜底也删了。** 留着 `hint ?? t(...)` 的话，删掉的句子会在没有 hint 时回来，
       而文件里看起来已经「删干净」了。 */
    expect(panel, 'composer 仍然有一个自带的兜底句子').not.toMatch(/hint \?\?/)
    /* 而拒绝的理由必须还在：那是这一行唯一的出口。 */
    expect(panel, '拒绝理由那一行被一起删掉了').toMatch(/\{hint !== undefined && <p className=\{css\.detailHint\}>\{hint\}<\/p>\}/)
  })

  it('the date rows themselves survived the deletion', () => {
    /* **删的是注解，不是字段。** 三个日期各自的名字、读数、框、取消键都还在——只断言
       「那句话不见了」的话，把整根轴删掉也会绿。 */
    const pane = read('item/detail-pane.tsx')
    for (const key of ['startsAfter', 'dueAt', 'hardDueAt']) {
      expect(pane, `详情里少了 ${key} 这一行`).toContain(`keyName='${key}'`)
    }
    expect(pane, '日期轴整根不见了').toContain('itemDateAxis')
    expect(pane, '日期框不再用共用元件').toContain('<DateField')
    const sheet = read('item/item-create-dialog.tsx')
    expect(sheet, '新建纸上不再由 DATE_FIELDS 长那三格').toContain('DATE_FIELDS.map')
    expect(sheet, '新建纸上的日期框没了').toContain('<DateField')
  })
})
