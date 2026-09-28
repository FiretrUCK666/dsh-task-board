/**
 * The archive's two calls: read what a delete is holding, put one back.
 *
 * Both exist for the same reason, and it is the reason this file is a contract
 * rather than a convenience: **a failed restore that reports success is the
 * worst outcome this surface can have.** The reader deleted something by
 * mistake, pressed the one button that says it can be undone, watched it report
 * that it worked, and then discovered the row is gone — with no error anywhere
 * to look at. So every case below is about what the caller is TOLD, not about
 * what the host happens to return.
 */
import { describe, expect, it } from 'vitest'
import { itemsArchive, itemsRestore } from '../src/client/items-archive.ts'
import type { ItemRecord } from '../src/core/item.ts'

const T0 = 1_700_000_000_000

function row(patch: Partial<ItemRecord> = {}): Record<string, unknown> {
  return {
    id: 'i-a',
    ref: 4,
    title: '找回我',
    body: '',
    notes: '',
    steps: [],
    status: 'open',
    priority: 'normal',
    tags: [],
    startsAfter: undefined,
    dueAt: undefined,
    hardDueAt: undefined,
    taskId: undefined,
    origin: { source: 'human', at: T0 },
    createdAt: T0,
    updatedAt: T0,
    ...patch,
  }
}

/** A `fetch` that answers with the plugin's own envelope. */
function answering(status: number, value: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  })) as unknown as typeof fetch
}

describe('reading the archive', () => {
  it('returns the rows the host is holding', async () => {
    const reply = await itemsArchive(answering(200, { ok: true, value: { available: true, revision: 9, deleted: [row()] } }))
    expect(reply.ok).toBe(true)
    expect(reply.ok && reply.deleted.map(item => item.ref)).toEqual([4])
  })

  it('asks for the deleted rows EXPLICITLY, never as a side effect', async () => {
    let asked = ''
    const fetchImpl = (async (url: string) => {
      asked = String(url)
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { deleted: [] } }) }
    }) as unknown as typeof fetch
    await itemsArchive(fetchImpl)
    expect(asked).toContain('includeDeleted=1')
  })

  it('drops one unreadable row instead of failing the whole read', async () => {
    // The archive is where a reader rescues ONE thing; a single malformed row
    // must not cost them the other twenty-nine.
    const reply = await itemsArchive(answering(200, {
      ok: true,
      value: { deleted: [row(), { id: '', ref: 'x' }, null, row({ id: 'i-b', ref: 5 })] },
    }))
    expect(reply.ok && reply.deleted.map(item => item.id)).toEqual(['i-a', 'i-b'])
  })

  it('says UNREADABLE, not empty, when the host never heard of the question', async () => {
    // The failure this prevents: a host that does not know about `deleted`
    // answers with a perfectly valid view, and reading that as "you have
    // removed nothing" tells the reader their deletions are gone.
    const reply = await itemsArchive(answering(200, { ok: true, value: { available: true, revision: 9, doc: {} } }))
    expect(reply).toEqual({ ok: false, why: 'unrecognisedAnswer' })
  })

  it('names the network when the host cannot be reached', async () => {
    const reply = await itemsArchive(((async () => { throw new Error('denied') }) as unknown) as typeof fetch)
    expect(reply).toEqual({ ok: false, why: 'denied' })
  })

  it('names the status when the host refuses', async () => {
    expect(await itemsArchive(answering(503, {}))).toEqual({ ok: false, why: 'hostRefused 503' })
  })
})

describe('putting one back', () => {
  it('sends the number and this tab, and reports the row that came back', async () => {
    let sent = ''
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = String(init.body)
      return { ok: true, status: 200, json: async () => ({ ok: true, value: { available: true, revision: 10, restored: row() } }) }
    }) as unknown as typeof fetch
    const reply = await itemsRestore(4, 'tab-abc', fetchImpl)
    expect(JSON.parse(sent)).toEqual({ ref: 4, clientId: 'tab-abc' })
    expect(reply.ok && reply.restored?.title).toBe('找回我')
  })

  it('is NOT a success when the row did not come back', async () => {
    // The whole point. `ok: true` with nothing in it means 「没有墓碑压着这个编号」,
    // and a panel that closes the archive on that is telling the reader their row
    // is back when it is not.
    const reply = await itemsRestore(99, 'tab-abc', answering(200, { ok: true, value: { available: true, revision: 10 } }))
    expect(reply).toEqual({ ok: true, restored: undefined })
  })

  it('tells "host has no documents" apart from "nothing holds that number"', async () => {
    // Different facts, different words: the first is an outage, the second is an
    // answer.
    const reply = await itemsRestore(4, 'tab-abc', answering(200, { ok: true, value: { available: false, revision: 0 } }))
    expect(reply).toEqual({ ok: false, why: 'hostUnavailable' })
  })

  it('never reports a refusal as a restore', async () => {
    for (const [status, value] of [
      [500, {}],
      [200, { ok: true, value: null }],
      [200, { ok: true, value: { available: true, restored: { id: '', ref: 'x' } } }],
    ] as [number, unknown][]) {
      const reply = await itemsRestore(4, 'tab-abc', answering(status, value))
      if (reply.ok) expect(reply.restored, JSON.stringify(value)).toBeUndefined()
      else expect(reply.ok).toBe(false)
    }
  })
})
