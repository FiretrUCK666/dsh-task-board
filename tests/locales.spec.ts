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
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zh } from '../src/client/locales.ts'

const clientRoot = fileURLToPath(new URL('../src/client', import.meta.url))

/** Every .ts / .tsx file under the client half. */
function clientSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...clientSources(path))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path)
  }
  return out
}

/** Comments stripped: prose may NAME a key without being a reader of it. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const sources = clientSources(clientRoot).map(path => stripComments(readFileSync(path, 'utf8')))
const keys = Object.keys(zh)

describe('locale dictionaries have no rot', () => {
  it('every dictionary key is referenced in client code', () => {
    const quoted = new Set<string>()
    const templates: string[] = []
    for (const text of sources) {
      for (const match of text.matchAll(/'([^'\n]+)'/g)) quoted.add(match[1])
      for (const match of text.matchAll(/"([^"\n]+)"/g)) quoted.add(match[1])
      for (const match of text.matchAll(/t\(`([^`]+)`/g)) templates.push(match[1])
    }
    // A template prefix covers every key it can produce.
    const prefixes = templates
      .filter(template => template.includes('${'))
      .map(template => template.slice(0, template.indexOf('${')))
    const orphans = keys.filter(key =>
      !quoted.has(key) && !prefixes.some(prefix => key.startsWith(prefix)))
    expect(orphans, 'keys with no reader — delete them (copy that nothing shows is dead weight)').toEqual([])
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
