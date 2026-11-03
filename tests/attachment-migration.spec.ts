import { describe, expect, it } from 'vitest'
import {
  LEGACY_ATTACHMENT_MIGRATION_KEY,
  decodeBase64,
  legacyImagesOf,
  migrateLegacyAttachments,
  type ImageAdmittingStore,
} from '../src/core/attachment-migration.ts'

/** A base64 payload of `n` bytes, so byte counts are checkable. */
function payload(n: number): string {
  return Buffer.alloc(n, 7).toString('base64')
}

/** A store that accepts everything and hands back a durable ref. */
function goodStore(): ImageAdmittingStore & { calls: number } {
  let calls = 0
  return {
    get calls() {
      return calls
    },
    async saveImage(input) {
      calls += 1
      return {
        attachmentId: `att-${calls}`,
        name: input.name ?? `image-${calls}.png`,
        bytes: input.data.length,
        mediaType: input.mediaType,
        width: 10,
        height: 10,
      }
    },
  }
}

/** One task carrying `images` legacy rows in its single round. */
function taskWith(images: Record<string, unknown>[]): Record<string, unknown> {
  return { id: 'card-1', executions: [{ promptImages: images }] }
}

describe('decodeBase64', () => {
  it('decodes canonical base64', () => {
    const bytes = decodeBase64(payload(12))
    expect(bytes?.length).toBe(12)
  })

  it('refuses a payload that is not base64', () => {
    expect(decodeBase64('not base64 at all!!')).toBeUndefined()
  })

  it('refuses an empty payload', () => {
    expect(decodeBase64('')).toBeUndefined()
  })
})

describe('legacyImagesOf', () => {
  it('finds every row that still carries bytes', () => {
    const tasks = [taskWith([{ data: payload(4) }, { data: payload(6) }])]
    expect(legacyImagesOf(tasks)).toHaveLength(2)
  })

  it('ignores rows with no payload — there is nothing to move', () => {
    const tasks = [taskWith([{ mediaType: 'image/png' }])]
    expect(legacyImagesOf(tasks)).toHaveLength(0)
  })

  it('ignores a row whose payload is not base64', () => {
    const tasks = [taskWith([{ data: '%%%' }])]
    expect(legacyImagesOf(tasks)).toHaveLength(0)
  })

  it('reads every round of every task', () => {
    const tasks = [
      { id: 'a', executions: [{ promptImages: [{ data: payload(2) }] }, { promptImages: [{ data: payload(3) }] }] },
      { id: 'b', executions: [{ promptImages: [{ data: payload(4) }] }] },
    ]
    expect(legacyImagesOf(tasks)).toHaveLength(3)
  })

  it('survives rows that are not shaped as expected', () => {
    expect(legacyImagesOf([{ id: 'x' }, { id: 'y', executions: 'nope' }, null, 7])).toHaveLength(0)
  })
})

describe('migrateLegacyAttachments', () => {
  it('moves bytes into the store and leaves a durable ref behind', async () => {
    const tasks = [taskWith([{ data: payload(8), mediaType: 'image/png', name: 'a.png' }])]
    const store = goodStore()
    const report = await migrateLegacyAttachments(tasks, store)

    expect(report.moved).toBe(1)
    expect(report.skipped).toHaveLength(0)
    expect(report.changed).toBe(true)
    const round = (tasks[0].executions as Record<string, unknown>[])[0]
    // The bytes are gone from the document...
    expect(round.promptImages).toBeUndefined()
    // ...and the ref is there instead.
    const refs = round.attachments as Record<string, unknown>[]
    expect(refs).toHaveLength(1)
    expect(refs[0].attachmentId).toBe('att-1')
    expect(refs[0].bytes).toBe(8)
  })

  it('keeps the ref WHOLE — a field the harness adds rides through untouched', async () => {
    const tasks = [taskWith([{ data: payload(4) }])]
    const store: ImageAdmittingStore = {
      async saveImage() {
        // A ref with an extra field no code here names.
        return { attachmentId: 'x', name: 'n.png', bytes: 4, mediaType: 'image/png', width: 3, height: 5, futureField: 'keep me' }
      },
    }
    await migrateLegacyAttachments(tasks, store)
    const ref = ((tasks[0].executions as Record<string, unknown>[])[0].attachments as Record<string, unknown>[])[0]
    expect(ref.futureField).toBe('keep me')
    expect(ref.width).toBe(3)
  })

  it('never drops a byte the store refused — the row stays verbatim', async () => {
    const original = { data: payload(5), mediaType: 'image/png', name: 'bad.png' }
    const tasks = [taskWith([{ ...original }])]
    const store: ImageAdmittingStore = {
      async saveImage() {
        throw new Error('media type refused')
      },
    }
    const report = await migrateLegacyAttachments(tasks, store)

    expect(report.moved).toBe(0)
    expect(report.changed).toBe(false)
    expect(report.skipped).toHaveLength(1)
    expect(report.skipped[0].reason).toContain('refused')
    const round = (tasks[0].executions as Record<string, unknown>[])[0]
    expect(round.promptImages).toEqual([original])
    expect(round.attachments).toBeUndefined()
  })

  it('one refusal does not stop the others', async () => {
    const tasks = [taskWith([{ data: payload(3), name: 'ok-1.png' }, { data: payload(4), name: 'bad.png' }, { data: payload(5), name: 'ok-2.png' }])]
    let call = 0
    const store: ImageAdmittingStore = {
      async saveImage(input) {
        call += 1
        if (input.name === 'bad.png') throw new Error('refused')
        return { attachmentId: `a-${call}`, name: input.name ?? 'x', bytes: input.data.length }
      },
    }
    const report = await migrateLegacyAttachments(tasks, store)

    expect(report.moved).toBe(2)
    expect(report.skipped).toHaveLength(1)
    // The refused one is still there, byte for byte; the two that moved are refs.
    const round = (tasks[0].executions as Record<string, unknown>[])[0]
    expect((round.promptImages as unknown[]).length).toBe(1)
    expect((round.attachments as unknown[]).length).toBe(2)
  })

  it('treats a store result without a usable ref as a refusal, not a success', async () => {
    const tasks = [taskWith([{ data: payload(4) }])]
    const store: ImageAdmittingStore = { async saveImage() { return { name: 'no id' } } }
    const report = await migrateLegacyAttachments(tasks, store)
    expect(report.moved).toBe(0)
    expect(report.changed).toBe(false)
    expect(report.skipped[0].reason).toContain('no usable ref')
  })

  it('accepts a ref the store returned WITHOUT a name — the harness declares it optional', async () => {
    // Demanding `name` here would report a good store result as a refusal, and
    // the image would keep its bytes forever because of a field the official
    // ImageAttachmentRef never promises.
    const tasks = [taskWith([{ data: payload(4) }])]
    const store: ImageAdmittingStore = {
      async saveImage() {
        return { attachmentId: 'x', bytes: 4, mediaType: 'image/png', width: 2, height: 2 }
      },
    }
    const report = await migrateLegacyAttachments(tasks, store)
    expect(report.moved).toBe(1)
    expect(report.changed).toBe(true)
    const round = (tasks[0].executions as Record<string, unknown>[])[0]
    expect(round.promptImages).toBeUndefined()
    expect((round.attachments as Record<string, unknown>[])[0].attachmentId).toBe('x')
  })

  it('appends to attachments that are already there instead of replacing them', async () => {
    const existing = [{ attachmentId: 'old', name: 'old.png', bytes: 1 }]
    const tasks = [{ id: 'card-1', executions: [{ promptImages: [{ data: payload(4) }], attachments: existing }] }]
    await migrateLegacyAttachments(tasks, goodStore())
    const refs = (tasks[0].executions as Record<string, unknown>[])[0].attachments as Record<string, unknown>[]
    expect(refs).toHaveLength(2)
    expect(refs[0].attachmentId).toBe('old')
  })

  it('does nothing at all when there is no legacy byte', async () => {
    const tasks = [{ id: 'card-1', executions: [{ attachments: [] }] }]
    const store = goodStore()
    const report = await migrateLegacyAttachments(tasks, store)
    expect(report.moved).toBe(0)
    expect(report.changed).toBe(false)
    expect(store.calls).toBe(0)
  })

  it('is idempotent: a second pass over the same document moves nothing', async () => {
    const tasks = [taskWith([{ data: payload(6) }])]
    const store = goodStore()
    const first = await migrateLegacyAttachments(tasks, store)
    expect(first.moved).toBe(1)
    const second = await migrateLegacyAttachments(tasks, store)
    expect(second.moved).toBe(0)
    expect(second.changed).toBe(false)
    expect(store.calls).toBe(1)
  })

  it('stops between images when the signal aborts', async () => {
    const tasks = [taskWith([{ data: payload(2) }, { data: payload(3) }])]
    const store = goodStore()
    const controller = new AbortController()
    controller.abort()
    const report = await migrateLegacyAttachments(tasks, store, controller.signal)
    expect(report.moved).toBe(0)
    expect(store.calls).toBe(0)
  })
})

describe('the marker', () => {
  it('has a stable key, so a rename cannot silently re-run the pass', () => {
    expect(LEGACY_ATTACHMENT_MIGRATION_KEY).toBe('legacyAttachmentsMovedAt')
  })
})
