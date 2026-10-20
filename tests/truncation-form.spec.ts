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

  it('共享层**内部**的第二份拷贝不算那个家——豁免区不等于没有规矩', () => {
    /* **这一条钉的是一处真实的盲区。** 门禁把共享层划成豁免区（`.truncate` 本来就住那儿），
     * 而豁免区是它唯一一处「信任」——于是共享层内部还有 5 处自己抄了同一副三件套
     * （`.chipBody` / `.inlineSummary` / 一个分节标题 / 状态栏 / 通知文字），从头到尾没人管。
     *
     * 判据：除了那个家本身，**任何地方**再出现一条同时声明那两件事的规则就是抄了一份——
     * 包括它自己那张表。 */
    const found = truncationCopiesIn([
      SHARED_HOME,
      {
        rel: 'src/client/design/components.module.css',
        css: '.secondCopy { white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }',
      },
    ])
    expect(found.length, '共享层内部的第二份拷贝被放过了——豁免区变成了没规矩的地方').toBeGreaterThan(0)
    expect(found.some(hit => hit.selector.includes('secondCopy'))).toBe(true)
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
    /* **表可以是空的，而且空着是当前正确状态**——那条唯一的历史豁免（两行夹还没有家）
     * 等到过它等的东西，而那个形态随后整个被删掉，于是这条记录也一起清掉（硬性规范 18）。
     *
     * 所以这条用例不再要求表非空（那会把「删干净」判成红的），改要求：**只要有一条，
     * 它就必须说得出理由**。机制活不活由下面那条自备豁免的用例证明。 */
    for (const one of PER_SHEET_EXEMPTIONS) {
      expect(one.match.length, '豁免的 match 是空的——它匹配不到任何东西').toBeGreaterThan(0)
      expect(one.why.length, '豁免没有写理由——那就是一张白名单').toBeGreaterThan(0)
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

  /* **自备一条豁免，不借生产表。** 生产表空着是正确的（它等的那一族已经不存在了），
   * 而「豁免机制还活着」这件事仍然要被证明——不然它就成了一个没人验证过的分支。 */
  const OWN_EXEMPTION = [
    { match: '-webkit-box-orient: vertical;-webkit-line-clamp: 2', why: '这一条只活在这个用例里：证明豁免会被读到。' },
  ]

  it('形状不变，豁免有效', () => {
    const found = truncationCopiesIn([shaped('2')], OWN_EXEMPTION)
    expect(found, '形状没变的拷贝必须被认出来').toHaveLength(1)
    expect(found[0].exempt, '写对了理由的豁免没有生效').toBe(true)
    expect(found[0].why).not.toBeNull()
    /* 放行的理由必须**就是表里写的那一条**——不是「随便哪一条都行」。 */
    expect(found[0].why).toBe(OWN_EXEMPTION[0].why)
  })

  it('形状一变，豁免失效，门禁重新报', () => {
    const found = truncationCopiesIn([shaped('3')], OWN_EXEMPTION)
    expect(found).toHaveLength(1)
    expect(found[0].exempt, '形状变了而豁免还在放行——那不是棘轮，是一张白名单').toBe(false)
  })

  it('共享层一旦有了那个家，这条「还没有家」的豁免就作废', () => {
    const withHome = {
      rel: `${SHARED_LAYER}components.module.css`,
      css: [
        '.truncate {',
        '  -webkit-box-orient: vertical;',
        '  -webkit-line-clamp: 2;',
        '  display: -webkit-box;',
        '  overflow: hidden;',
        '}',
      ].join('\n'),
    }
    const found = truncationCopiesIn([shaped('2'), withHome], PER_SHEET_EXEMPTIONS)
    /* 页面表那一处（`shaped('2')`）被报出来，而且**不再是豁免的**：共享层已经有那个家了，
     * 「等一个家」的豁免不能比那个家活得久。共享层自己那一份是答案，不报。 */
    expect(found).toHaveLength(1)
    expect(found[0].file).toBe('src/client/board.module.css')
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
