/**
 * Locale dictionaries (client/locales.ts): the shipped copy must have no rot
 * in EITHER direction.
 *
 * What TypeScript already guarantees: `en` is typed `Record<keyof typeof zh,
 * string>` (every zh key exists in en), and `t()` takes `TaskBoardKey` (every
 * literal key exists). What NOTHING guaranteed — and this spec does:
 *   1. every dictionary key has a reader somewhere in the client source
 *      (「根本没有用的东西」 fails the build instead of rotting);
 *   2. every template call `t(`prefix.${…}`)` resolves to at least one real
 *      key (the one shape the type checker cannot see).
 *
 * Usage = a quoted occurrence in CODE (comments stripped, so a key mentioned
 * only in prose does not count as a reader): a `t('…')` literal, a template
 * prefix, or the bare-string keys derivations return (`waitingKeyOf`,
 * `noteStatusShapeOf`, `STATUS_KEY` and friends).
 *
 * THE DICTIONARY IS NOT A READER OF ITSELF. Walking every file under `src/client`
 * includes `locales.ts`, so every key is found quoted in its own definition and
 * the check goes green no matter how much has rotted, reporting nothing, while
 * dead keys sit in the dictionary. A check that cannot fail is worse than no
 * check, because it is read as evidence; so the dictionary is excluded here,
 * and {@link theOrphanScanCanFail} proves the exclusion did not turn the check
 * into "always red" either.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zh, en } from '../src/client/locales.ts'
import { MANUAL_STATUSES } from '../src/core/tasks.ts'

const clientRoot = fileURLToPath(new URL('../src/client', import.meta.url))

/**
 * The dictionary, named as the one file whose quotes are DECLARATIONS.
 *
 * Keyed on the basename because the scan is about what the interface reads,
 * and a reader in a differently-named module is still a reader — excluding by
 * path prefix would quietly exempt a whole directory the moment someone
 * reorganised it.
 */
const DICTIONARY_FILE = 'locales.ts'

/**
 * **键集合的指纹。**
 *
 * 键集合变了就要改这一行——**刻意**改，不是顺手改。孤儿扫描看不见「键和它的读者
 * 一起被删」那一种（键没了，它就不是孤儿），zh↔en 的对称性也由类型跟着一起少，
 * 所以这种删除**全绿**：屏幕上那句话没了，而没有任何门禁会报。
 *
 * 指纹用 **FNV-1a**（短、够用、不是密码学用途）：它要回答的只是「键集合是不是
 * 同一个」，不是「内容是不是没被人动过」。
 */
const KEY_SET_DIGEST = '696bb8d9'

/** 键集合的指纹（升序、拼起来算）。 */
function digestOf(list: readonly string[]): string {
  const text = [...list].sort().join('\n')
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Every .ts / .tsx file under the client half, minus the dictionary. */
function clientSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...clientSources(path))
    else if (/\.(ts|tsx)$/.test(entry) && entry !== DICTIONARY_FILE) out.push(path)
  }
  return out
}

/** Comments stripped: prose may NAME a key without being a reader of it. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * A JS string literal, matched whole — quotes included — and with escapes
 * honoured.
 *
 * THE OLD READER WAS WRONG IN A DANGEROUS WAY. It scanned for `'…'` with a
 * `+` (one or more) body, so an EMPTY literal was not a match at all: the scan
 * resumed after the opening quote, and paired that quote with the OPENING
 * quote of the next literal. In `title={image.name ?? ''}>{t('review.
 * imageMissing')}` that swallowed `review.imageMissing` — a key that is read,
 * live, in a rendered surface — and the check reported it as dead copy.
 *
 * A false positive here is worse than a false negative: the obvious response to
 * "this key has no reader" is to delete it, and deleting live copy breaks a
 * surface that was working. So a literal now matches whole (body may be empty,
 * escapes included) and the quotes are stripped afterwards.
 */
const SINGLE_QUOTED = /'(?:[^'\\\n]|\\.)*'/g
const DOUBLE_QUOTED = /"(?:[^"\\\n]|\\.)*"/g

/** Every string literal in a text, unquoted, empty ones included and harmless. */
function stringLiterals(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(SINGLE_QUOTED)) out.push(match[0].slice(1, -1))
  for (const match of text.matchAll(DOUBLE_QUOTED)) out.push(match[0].slice(1, -1))
  return out
}

const sources = clientSources(clientRoot).map(path => stripComments(readFileSync(path, 'utf8')))
const keys = Object.keys(zh)

/**
 * The keys no reader names. Split out so the self-tests below can run the very
 * same computation over source lists they chose themselves, instead of a copy
 * of it that could drift from the one doing the real work.
 */
function orphansIn(texts: readonly string[], dictionary: readonly string[]): string[] {
  const quoted = new Set<string>()
  const templates: string[] = []
  for (const text of texts) {
    for (const literal of stringLiterals(text)) quoted.add(literal)
    for (const match of text.matchAll(/t\(`([^`]+)`/g)) templates.push(match[1])
  }
  // A template prefix covers every key it can produce.
  const prefixes = templates
    .filter(template => template.includes('${'))
    .map(template => template.slice(0, template.indexOf('${')))
  return dictionary.filter(key =>
    !quoted.has(key) && !prefixes.some(prefix => key.startsWith(prefix)))
}

describe('locale dictionaries have no rot', () => {
  it('every dictionary key is referenced in client code', () => {
    const orphans = orphansIn(sources, keys)
    expect(orphans, 'keys with no reader — delete them (copy that nothing shows is dead weight)').toEqual([])
  })

  it('the key set only changes on purpose', () => {
    // **「一个键和它的读者一起被删」是上面那道孤儿扫描看不见的那一种。**
    //
    // 孤儿扫描问的是「这个键还有人读吗」——**键没了，它就不是孤儿**（不是没人读，是
    // 不存在了）。zh 与 en 的对称性由类型保证（`en: Record<keyof typeof zh, string>`），
    // 而类型**跟着键一起少**，所以「两边同时删」这件事**全绿**：没有孤儿、没有类型错、
    // 没有任何门禁会报。
    //
    // 真发生过：日程页「一行日期都没有时」的处境说明（`item.agenda.nothingDated`）与
    // 它的渲染被一起删掉，屏幕上那句话就没了——**没有一处变红**。
    //
    // 所以键集合要有一道**指纹**：键集合变了，这一条就红，并把**新的指纹值**印出来
    // （改这一行是刻意的动作，不是顺手）。
    const digest = digestOf(keys)
    expect(digest, [
      'locale 的键集合变了。',
      '如果是有意的（加了词、改了名、删了不用的词），把下面这个值填进本文件的那一行：',
      digest,
      '如果不是有意的——**键和它的读者一起被删**了，屏幕上那句话就没了，而没有任何门禁会报。',
    ].join('\n')).toBe(KEY_SET_DIGEST)
  })

  it('the orphan scan can actually fail', () => {
    // A two-key dictionary with one reader for one of them. The scan has to
    // name the unread one; a check that reports nothing is not asking.
    const dictionary = ['probe.read', 'probe.unread']
    const reader = ["t('probe.read')"]
    expect(orphansIn(reader, dictionary)).toEqual(['probe.unread'])

    // AND THE SELF-READING CASE, reproduced exactly. A reader set that includes
    // the dictionary file itself finds every key quoted in its own definition and
    // goes quiet no matter what has rotted — which is how dead keys sit behind a
    // green test. Adding the definitions back must silence the scan; that is the
    // proof the exclusion is doing the work rather than the check simply being
    // green.
    const selfReading = [...dictionary].map(key => `'${key}'`)
    expect(orphansIn([...reader, ...selfReading], dictionary)).toEqual([])
  })

  it('a live key is not mistaken for a dead one', () => {
    // THE FALSE-POSITIVE PROBE, and the reason it is here rather than folded
    // into the test above: the reader this file used had swallowed the literal
    // after an empty string, so `''}>{t('live.key')}` reported `live.key` as
    // dead. Deleting a key on that report breaks a surface that was working,
    // which makes a broken check worse than no check at all.
    const live = 'item.probeOnlyKeyWithALiveReader'
    expect(orphansIn([`const title = name ?? '' ; t('${live}')`], [live])).toEqual([])
    expect(orphansIn([`const title = name ?? '' ; t('${live}')`], [live, 'item.probeOnlyKeyNobodyReads']))
      .toEqual(['item.probeOnlyKeyNobodyReads'])
  })

  it('every template call resolves to at least one real key', () => {
    const templates = new Set<string>()
    for (const text of sources) {
      for (const match of text.matchAll(/t\(`([^`]+)`/g)) templates.add(match[1])
    }
    const dead = [...templates]
      .filter(template => template.includes('${'))
      .map(template => template.slice(0, template.indexOf('${')))
      .filter(prefix => !keys.some(key => key.startsWith(prefix)))
    expect(dead, 'template prefixes that produce a raw key at runtime').toEqual([])
  })

  it('the column verbs cover every column a reader may drag a card into', () => {
    // 上面那条只要求模板前缀能解析到**至少一个**真键。`t(\`status.move.${status}\`)`
    // （展开区那一排与行菜单各一处）是客户端唯一的模板键，于是看板加第四个人手可拖的栏时，
    // 屏上会印出 `undefined` 而没有东西会红。这一条把那张小词表钉在**模型**上：
    // `MANUAL_STATUSES` 的每一个成员都必须有自己的动词。
    const named = new Set(keys)
    const missing = MANUAL_STATUSES.filter(status => !named.has(`status.move.${status}`))
    expect(missing, 'a column a human may drag a card into has no verb — the button would render undefined').toEqual([])
  })

  it('两个晚了的节名各自带着字段自己的词，中英两档都是', () => {
    /* 「已经超期 / 已经落后」曾是一对看不出差别的孪生词（读者问过「已经超期是什么意思」），
       而答案本来就写在字段名上。现在节名说的是**哪一个日期**过了，用的就是那个字段自己的
       词——这条闸门钉的是「两处说的是同一件事」：改字段名而节名不跟，它会红。 */
    const pairs = [['item.bucket.hardOverdue', 'item.field.hardDueAt'], ['item.bucket.behind', 'item.field.dueAt']] as const
    for (const [bucket, field] of pairs) {
      expect(zh[bucket], `${bucket} 的中文里没有字段自己的词（${field}）`).toContain(zh[field])
      expect(en[bucket]?.toLowerCase(), `${bucket} 的英文里没有字段自己的词（${field}）`)
        .toContain(en[field]?.toLowerCase())
    }
  })

  it('and that scan can fail too', () => {
    // 同一件事的自测：拿一份多出一栏的名单去问，它必须报出来。
    const named = new Set(keys)
    const missing = [...MANUAL_STATUSES, 'aColumnNobodyHas'].filter(status => !named.has(`status.move.${status}`))
    expect(missing).toEqual(['aColumnNobodyHas'])
  })
})
