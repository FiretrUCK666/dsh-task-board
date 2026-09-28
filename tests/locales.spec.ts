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
 * THE DICTIONARY IS NOT A READER OF ITSELF. The scan used to walk every file
 * under `src/client`, which includes `locales.ts` — so every key was found
 * quoted in its own definition and the check was green no matter how much had
 * rotted. It reported nothing at all: eight dead keys sat in the dictionary
 * for months behind a passing test. A check that cannot fail is worse than no
 * check, because it is read as evidence; so the dictionary is excluded here,
 * and {@link theOrphanScanCanFail} proves the exclusion did not turn the check
 * into "always red" either.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zh } from '../src/client/locales.ts'

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

  it('the orphan scan can actually fail', () => {
    // A two-key dictionary with one reader for one of them. The scan has to
    // name the unread one; a check that reports nothing is not asking.
    const dictionary = ['probe.read', 'probe.unread']
    const reader = ["t('probe.read')"]
    expect(orphansIn(reader, dictionary)).toEqual(['probe.unread'])

    // AND THE OLD BUG, reproduced exactly. The reader set used to include the
    // dictionary file itself, so every key was found quoted in its own
    // definition and the check went quiet no matter what had rotted — which is
    // how thirteen dead keys sat behind a green test. Adding the definitions
    // back must silence the scan; that is the proof the exclusion is doing the
    // work rather than the check simply being green.
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
})
