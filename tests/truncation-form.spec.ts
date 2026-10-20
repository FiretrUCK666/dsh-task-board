/**
 * 裁剪形态只有一个家。
 *
 * ── 这一道门禁为什么存在 ───────────────────────────────────────────────────────
 *
 * 「一个标题显示几行、怎么裁、裁掉之后读者怎么读回」这个决定在这个项目里没有家，
 * 被抄成了三十份。承载它的形态共八份，散在三张表，分成四种答案（折行 / 一行省略号 /
 * 两行夹 / 不裁硬切）。共享层只有一个 `.truncate`，其余二十七处各抄一份。
 *
 * 抄一份**不会让任何一条门禁变红**：`verify-design-docs.mjs` 的 check 5d 判的是
 * 「逐字完全相同的声明体在两张表里」，而每一份拷贝都多带一条（一个颜色 / 一个字号），
 * 所以一条都没报。那就是这个病的准确形状。
 *
 * ── 判据读结构，不读字样 ───────────────────────────────────────────────────────
 *
 * 一条规则同时声明「不可换行」与「用省略号表示被裁掉」这两件事，就是自己抄了一份
 * 裁剪形态。扫描**先剥注释再匹配**——注释里出现「省略号」三个字不是一次省略号用法。
 *
 * ── 自证 ────────────────────────────────────────────────────────────────────
 *
 * 每一道判据都要**喂一份假面证明它会咬**（硬性规范 16）：造一份「页面表自己抄裁剪
 * 形态」塞进去，门禁必须报；造一份「共享层自己那份」塞进去，门禁必须放行。
 */

import { describe, expect, it } from 'vitest'
import {
  declarationsIn,
  isPageSheet,
  normaliseBody,
  PER_SHEET_EXEMPTIONS,
  SHARED_LAYER,
  truncationCopiesIn,
  truncationFormIn,
} from '../scripts/verify-truncation-form.mjs'

/** 一条页面表自己的裁剪形态（共享层的家是另一张表）。 */
const PAGE_COPY = {
  rel: 'src/client/board.module.css',
  css: [
    '.boardTitle {',
    '  color: var(--dsh-tb-text-1);',
    '  font-size: 13px;',
    '  min-width: 0;',
    '  overflow: hidden;',
    '  text-overflow: ellipsis;',
    '  white-space: nowrap;',
    '}',
  ].join('\n'),
}

/** 共享层自己那一份——那个家，不许报。 */
const SHARED_HOME = {
  rel: `${SHARED_LAYER}components.module.css`,
  css: [
    '.truncate {',
    '  min-width: 0;',
    '  overflow: hidden;',
    '  text-overflow: ellipsis;',
    '  white-space: nowrap;',
    '}',
  ].join('\n'),
}

describe('裁剪形态只有一个家', () => {
  it('页面表自己抄了一份裁剪形态——必须报出来', () => {
    const found = truncationCopiesIn([PAGE_COPY, SHARED_HOME])
    expect(found).toHaveLength(1)
    expect(found[0].file).toBe('src/client/board.module.css')
    expect(found[0].kind).toBe('ellipsis')
    /* 报告必须指名**那两条凑成裁剪形态的声明**——不然读者不知道该删什么。 */
    expect(found[0].first).toBe('white-space: nowrap')
    expect(found[0].second).toBe('text-overflow: ellipsis')
    expect(found[0].exempt).toBe(false)
  })

  it('共享层自己那一份是那个家——必须放行', () => {
    const found = truncationCopiesIn([SHARED_HOME])
    expect(found).toHaveLength(0)
  })

  it('只写「不可换行」不算裁剪——没有省略号就没有裁剪形态', () => {
    const found = truncationCopiesIn([
      {
        rel: 'src/client/board.module.css',
        css: '.label { white-space: nowrap; font-size: 12px; }',
      },
    ])
    expect(found).toHaveLength(0)
  })

  it('只写「省略号」也不算——不换行的那一条是缺的那一半', () => {
    const found = truncationCopiesIn([
      {
        rel: 'src/client/board.module.css',
        css: '.label { text-overflow: ellipsis; overflow: hidden; }',
      },
    ])
    expect(found).toHaveLength(0)
  })

  it('注释里写着「省略号」不算一次省略号用法——扫描先剥注释再匹配', () => {
    const found = truncationCopiesIn([
      {
        rel: 'src/client/board.module.css',
        css: [
          '/* 这一条用省略号表示被裁掉：text-overflow: ellipsis; white-space: nowrap */',
          '.label { font-size: 12px; }',
        ].join('\n'),
      },
    ])
    expect(found).toHaveLength(0)
  })

  it('两行夹是这一族的另一个成员——也要报（除非豁免表写明理由）', () => {
    const clamp = {
      rel: 'src/client/board.module.css',
      css: [
        '.boardExcerpt {',
        '  -webkit-box-orient: vertical;',
        '  -webkit-line-clamp: 2;',
        '  display: -webkit-box;',
        '  overflow: hidden;',
        '}',
      ].join('\n'),
    }
    const found = truncationCopiesIn([clamp], [])
    expect(found).toHaveLength(1)
    expect(found[0].kind).toBe('clamp')
  })

  it('豁免是有理由的：每一条都写清为什么，不是一张白名单', () => {
    expect(PER_SHEET_EXEMPTIONS.length).toBeGreaterThan(0)
    for (const one of PER_SHEET_EXEMPTIONS) {
      expect(one.match.length).toBeGreaterThan(0)
      expect(one.why.length).toBeGreaterThan(0)
    }
  })
})

describe('豁免是棘轮：形状一变，它自动失效', () => {
  const shaped = (clamp: string) => ({
    rel: 'src/client/board.module.css',
    css: [
      '.boardExcerpt {',
      '  -webkit-box-orient: vertical;',
      `  -webkit-line-clamp: ${clamp};`,
      '  display: -webkit-box;',
      '  overflow: hidden;',
      '}',
    ].join('\n'),
  })

  it('形状不变，豁免有效', () => {
    const found = truncationCopiesIn([shaped('2')], PER_SHEET_EXEMPTIONS)
    expect(found).toHaveLength(1)
    expect(found[0].exempt).toBe(true)
    expect(found[0].why).not.toBeNull()
    /* 放行的理由必须**就是表里写的那一条**——不是「随便哪一条都行」。 */
    expect(found[0].why).toBe(PER_SHEET_EXEMPTIONS[0].why)
  })

  it('形状一变，豁免失效，门禁重新报', () => {
    const found = truncationCopiesIn([shaped('3')], PER_SHEET_EXEMPTIONS)
    expect(found).toHaveLength(1)
    expect(found[0].exempt).toBe(false)
  })

  it('共享层一旦有了那个家，这条「还没有家」的豁免就作废', () => {
    const withHome = {
      rel: `${SHARED_LAYER}components.module.css`,
      css: [
        '.truncateTwo {',
        '  -webkit-box-orient: vertical;',
        '  -webkit-line-clamp: 2;',
        '  display: -webkit-box;',
        '  overflow: hidden;',
        '}',
      ].join('\n'),
    }
    const found = truncationCopiesIn([shaped('2'), withHome], PER_SHEET_EXEMPTIONS)
    expect(found).toHaveLength(1)
    expect(found[0].exempt).toBe(false)
  })
})

describe('读法本身', () => {
  it('页面表 = 共享层以外的那一半——共享层是家，页面表不是', () => {
    expect(isPageSheet('src/client/board.module.css')).toBe(true)
    expect(isPageSheet('src/client/item/item.module.css')).toBe(true)
    expect(isPageSheet(`${SHARED_LAYER}components.module.css`)).toBe(false)
    expect(isPageSheet(`${SHARED_LAYER}base.module.css`)).toBe(false)
  })

  it('归一化只认结构：顺序与空白都不算数', () => {
    /* 与 `verify-design-docs.mjs` 的 `duplicateBodies` 同一套归一化：声明各自
     * trim、空白折叠、顺序忽略。所以「同一段形状写成另一个顺序」仍是同一段。 */
    const a = normaliseBody('white-space: nowrap;\n  text-overflow: ellipsis;')
    const b = normaliseBody('text-overflow: ellipsis;white-space: nowrap')
    expect(a).toBe(b)
  })

  it('声明读出来是「属性 + 值」两半', () => {
    const decls = declarationsIn('color: red; white-space: nowrap')
    expect(decls).toEqual([
      { property: 'color', value: 'red' },
      { property: 'white-space', value: 'nowrap' },
    ])
  })

  it('一条规则里没有那两件事，就不是裁剪形态', () => {
    expect(truncationFormIn('color: red')).toBeNull()
    expect(truncationFormIn('overflow: hidden; text-overflow: ellipsis')).toBeNull()
  })
})
