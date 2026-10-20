/**
 * 词表里的占位符必须**被填上**，而且填它的键名必须与文案里那个名字一致。
 *
 * 这条存在的理由是一次真实的缺陷：文案是 `发布于 {time}`，调用点传的是
 * `{ when: ... }`。少一个变量不是错误——`t()` 把没被替换的部分原样留在字符串里，
 * 于是屏上印出「发布于 {time}」，类型检查通过、结构测试通过、门禁通过。
 *
 * 判据读**结构**：`zh` 与 `en` 的每一句里出现的 `{name}`，在**调用点**那一行里
 * 必须出现同名的键。它不猜哪个变量该叫什么，只核对两处写的是不是同一个名字。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { en, zh } from '../src/client/locales.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const CLIENT = path.join(ROOT, 'src', 'client')

/** Every `.ts` / `.tsx` under `src/client`, minus the dictionary itself. */
function clientSources(): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name) && path.basename(full) !== 'locales.ts') {
        found.push({ file: full, text: fs.readFileSync(full, 'utf8') })
      }
    }
  }
  walk(CLIENT)
  return found
}

/** The `{name}` slots a string declares, in order. */
function slotsOf(text: string): string[] {
  return [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(match => match[1] as string)
}

/**
 * Comments out of source, keeping offsets: a `t(...)` mentioned in prose is not
 * a call site. Judgement reads STRUCTURE (AGENTS.md 14), and this test's whole
 * job is finding call sites — so a comment that happens to contain one must not
 * count, and a `// Quarters are exact …` inside an argument list must not be
 * read as an argument name.
 * @param text - the source.
 * @returns the same text with comment bodies replaced by spaces.
 */
function stripComments(text: string): string {
  let out = ''
  let index = 0
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code'
  while (index < text.length) {
    const two = text.slice(index, index + 2)
    const char = text.charAt(index)
    if (state === 'code') {
      if (two === '//') { state = 'line'; out += '  '; index += 2; continue }
      if (two === '/*') { state = 'block'; out += '  '; index += 2; continue }
      if (char === "'") state = 'single'
      else if (char === '"') state = 'double'
      else if (char === '`') state = 'template'
      out += char
      index += 1
      continue
    }
    if (state === 'line') {
      if (char === '\n') { state = 'code'; out += char } else out += ' '
      index += 1
      continue
    }
    if (state === 'block') {
      if (two === '*/') { state = 'code'; out += '  '; index += 2; continue }
      out += char === '\n' ? '\n' : ' '
      index += 1
      continue
    }
    /* Inside a string or template: keep it verbatim (it may hold `{slots}` or
       the key itself), but a backslash escape must not end the literal. */
    if (char === '\\') { out += two; index += 2; continue }
    if ((state === 'single' && char === "'")
      || (state === 'double' && char === '"')
      || (state === 'template' && char === '`')) {
      state = 'code'
    }
    out += char
    index += 1
  }
  return out
}

describe('locale placeholders are filled by name', () => {
  it('every declared slot has the same name at the call site', () => {
    const call = /\bt\(\s*'([^']+)'\s*(?:,\s*\{([^}]*)\})?/g
    const problems: string[] = []
    for (const { file, text } of clientSources()) {
      for (const match of stripComments(text).matchAll(call)) {
        const key = match[1] as string
        const declared = slotsOf((zh as Record<string, string>)[key] ?? '')
        if (declared.length === 0) continue
        const used = (match[2] ?? '')
          .split(',')
          .map(pair => (pair.split(':')[0] ?? '').trim())
          .filter(name => name !== '')
        for (const slot of declared) {
          if (!used.includes(slot)) {
            problems.push(
              `${path.relative(ROOT, file)}: t('${key}') declares {${slot}} but passes [${used.join(', ')}]`,
            )
          }
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('the two dictionaries declare the same slots for the same key', () => {
    /* 一份翻译漏掉一个占位符，那一种语言就印出原样的 `{n}`。键集由
       `tests/locales.spec.ts` 钉着，这里钉的是**名字**。 */
    const problems: string[] = []
    for (const [key, text] of Object.entries(zh as Record<string, string>)) {
      const english = (en as Record<string, string>)[key]
      if (english === undefined) continue
      const a = slotsOf(text).sort().join(',')
      const b = slotsOf(english).sort().join(',')
      if (a !== b) problems.push(`${key}: zh {${a}} vs en {${b}}`)
    }
    expect(problems).toEqual([])
  })
})
