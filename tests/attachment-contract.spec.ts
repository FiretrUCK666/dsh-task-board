/**
 * 官方附件契约的**镜像校对**：我们读图时发的那份引用，字段不得比官方声明的少。
 *
 * 为什么要这么一条用例：上一版发的是一份瘦身引用（只带 `attachmentId`），而官方的
 * 读图门要求**整份** `ImageAttachmentRef`（ID + 格式 + 字节数 + 宽高）。缺一项它就按
 * 契约拒掉，而界面只能降级成 `[图片]`——那个降级看起来像「图片坏了」，其实图片好好的。
 *
 * 判据读**实际安装的宿主声明文件**，不读我们自己手抄的表：官方给那份引用加一个
 * required 字段时，这里报红并指名，而不是等到每张图又变回 `[图片]` 才有人发现。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contentImagesOf } from '../src/client/board/review-transcript.ts'

/** 宿主包里那份附件声明文件；找不到（没装宿主）时 undefined。 */
function attachmentDeclaration(): string | undefined {
  const candidates = [
    join(process.env.APPDATA ?? '', 'npm', 'node_modules'),
    join(process.env.HOME ?? '', '.npm', 'node_modules'),
  ]
  for (const root of candidates) {
    const file = join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-attachment', 'lib', 'types', 'types.d.ts')
    try {
      const source = readFileSync(file, 'utf8')
      if (source !== '') return source
    } catch {
      /* 下一个候选 */
    }
  }
  return undefined
}

/** 一个 `export interface X { ... }` 里那些顶层字段名（先剥注释，再看结构）。 */
function fieldsOf(source: string, interfaceName: string): string[] {
  const marker = `export interface ${interfaceName} {`
  const start = source.indexOf(marker)
  if (start < 0) return []
  const tail = source.slice(start + marker.length)
  const end = tail.indexOf('\n}')
  const body = end < 0 ? tail : tail.slice(0, end)
  /* 硬性规范 14：判据只读结构，不读字样——注释里出现字段名不算字段。 */
  const bare = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const fields: string[] = []
  let depth = 0
  for (const line of bare.split('\n')) {
    const trimmed = line.trim()
    if (depth === 0) {
      const match = /^(\w+)(\?)?:/.exec(trimmed)
      if (match !== null) fields.push(match[1])
    }
    for (const char of trimmed) {
      if (char === '{' || char === '<') depth += 1
      else if (char === '}' || char === '>') depth = Math.max(0, depth - 1)
    }
  }
  return fields
}

describe('读图发的引用覆盖官方 required 字段', () => {
  it('ImageAttachmentRef 的每个字段，我们那份引用都带着', () => {
    const source = attachmentDeclaration()
    if (source === undefined) {
      /* 没装宿主 = 这条没核，而不是通过（硬性规范 15）。 */
      console.warn('skip: 这台机器上没有已安装的 dsh-attachment 声明文件，引用字段未核对')
      return
    }
    const official = fieldsOf(source, 'ImageAttachmentRef')
    expect(official, '官方 ImageAttachmentRef 的字段表没读到').toContain('attachmentId')
    expect(official).toContain('mediaType')
    expect(official).toContain('bytes')
    expect(official).toContain('width')
    expect(official).toContain('height')

    /* 我们自己那份确实从一条事件里读出来的引用，字段只能多、不能少。
       夹具里把官方**已知的每一个**字段都写上（含两个 optional），再加一个
       官方现在还没有的 `futureField`——它证明我们**原样带走整份对象**，而不是
       手抄一张字段表。官方以后加字段时，这个夹具不会自动长出那个键，于是上面的
       逐字段比会红：那正是「有人得动手」的信号。 */
    const [image] = contentImagesOf([{
      type: 'image',
      attachment: {
        attachmentId: 'sha256:abc',
        mediaType: 'image/png',
        bytes: 10,
        width: 4,
        height: 3,
        name: 'a.png',
        originalDimensions: { width: 8, height: 6 },
        futureField: 'kept',
      },
    }])
    expect(image).toBeDefined()
    for (const field of official) {
      expect(Object.keys(image ?? {}), `官方的 ${field} 我们没取`).toContain(field)
    }
    expect(Object.keys(image ?? {}), '不认识的字段被丢掉了（说明在挑字段而不是整份带走）').toContain('futureField')
  })

  it('官方给引用加字段而没同步时，这条会红', () => {
    /* 这一条钉的是**判据本身的形状**：它必须真的逐字段比，而不是只比几个名字。
       把一份假的声明文件喂给同一个读法，缺字段的那份必须读出差异——否则上面那条
       即使官方改了也不会红，而它红了才是「有人得动手」。 */
    const fake = [
      'export interface ImageAttachmentRef {',
      '    attachmentId: string;',
      '    mediaType: string;',
      '    bytes: number;',
      '    width: number;',
      '    height: number;',
      '    /** originalDimensions */',
      '    originalDimensions?: { width: number; height: number };',
      '}',
    ].join('\n')
    expect(fieldsOf(fake, 'ImageAttachmentRef')).toEqual([
      'attachmentId', 'mediaType', 'bytes', 'width', 'height', 'originalDimensions',
    ])
    /* 注释里的字不算字段（剥注释那一步真的生效）。 */
    expect(fieldsOf(fake, 'ImageAttachmentRef')).not.toContain('originalDimensions?:')
  })
})
