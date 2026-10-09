/**
 * The hand-off: which session an item goes to, and what the reader is told.
 *
 * The judgment worth pinning is the TARGET. Everything else is plumbing, and
 * plumbing that works is invisible; a target chosen wrongly sends a person's
 * request to the wrong conversation, and nothing about that looks broken.
 *
 * ── WHY THIS FILE USED TO HAVE ONLY THE CLIENT HALF ─────────────────────────
 * `board-ask.spec.ts` drove `itemsAsk`, the fetch wrapper, through a double. The
 * host half — the function that actually picks the session — was covered by
 * nothing: every route test replaces `deps.ask`, so the production wiring was
 * never executed. A reader's text could be delivered into the wrong card's
 * conversation for as long as the wrapper behaved, and the wrapper is the part
 * that cannot go wrong. Both halves are here now.
 */
import { describe, expect, it } from 'vitest'
import { itemsAsk, type AskReply } from '../src/client/board-ask.ts'
import { handOneItemToItsCardSession } from '../src/host/board-route.ts'
import { emptyBoardDoc, applyCommit } from '../src/core/board-doc.ts'
import { applyItemsCommit, emptyItemsDoc } from '../src/core/items-doc.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import type { ItemRecord } from '../src/core/item.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { DocumentService } from '../src/host/board-service.ts'

const ASK_URL = '/api/dsh-task-board/board/ask'

const T0 = 1_700_000_000_000

function row(patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'i-1',
    ref: 1,
    title: '一件要做的事',
    body: '',
    notes: '',
    steps: [],
    status: 'todo',
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

/** The two documents, with one card holding one bound session — or none.
 *
 *  `null` and not `undefined` for 「no session」: a default parameter fires on an
 *  explicit `undefined`, so passing `undefined` here would quietly build the
 *  card WITH a session and the test would be asserting nothing. */
function face(items: readonly ItemRecord[], sessionId: string | null = 's-a') {
  const bare = createTask({ title: '卡 A', description: '', prompt: 'p' }, T0, 'card-a')
  const card: TaskRecord = sessionId === null ? bare : { ...bare, binds: [{ kind: 'session', sessionId }] }
  const doc = applyCommit(emptyBoardDoc(T0), {
    clientId: 'c',
    tasks: [card],
    deleted: [],
    cruise: { value: { enabled: false, limit: 5, schedule: [] }, at: 0 },
    schedulePresets: { value: [], at: 0 },
    runPresets: { value: { presets: [] }, at: 0 },
  }, T0)
  let itemsDoc = emptyItemsDoc(T0)
  for (const item of items) {
    itemsDoc = applyItemsCommit(itemsDoc, { clientId: 'c', items: [item], changed: [item.id], deleted: [] }, T0)
  }
  const said: string[] = []
  const ctx = {
    get: (name: string) => name === 'agents'
      ? { get: (id: string) => ({ followup: (message: { content: Array<{ text: string }> }) => { said.push(`${id}: ${message.content[0]?.text ?? ''}`) } }) }
      : undefined,
  } as unknown as Context
  const service = {
    available: true,
    getDoc: () => doc,
    getItemsDoc: () => itemsDoc,
  } as unknown as DocumentService
  return { ctx, service, said }
}

/** A fetch double answering with the host's envelope around `value`. */
function answering(value: unknown, status = 200) {
  const calls: { url: string; body: unknown }[] = []
  const impl = (async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) })
    return { ok: status >= 200 && status < 300, status, json: async () => ({ ok: true, value }) }
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('handing one item to its card session', () => {
  it('posts the card and the short id, and nothing else', async () => {
    const { impl, calls } = answering({ ok: true, sessionId: 's-1', said: 'x' })
    const reply = await itemsAsk({ taskId: 'card-9', id: 'row-1', ref: 12 }, impl)
    // The route base hands the path to `document.baseURI`, which is why it goes
    // out WITHOUT its leading slash — asserting the slash would pin a detail
    // the browser is meant to own.
    expect(calls[0]?.url).toBe(ASK_URL.replace(/^\/+/, ''))
    expect(calls[0]?.body).toEqual({ taskId: 'card-9', id: 'row-1', ref: 12 })
    expect(reply).toEqual({ ok: true, sessionId: 's-1', said: 'x' })
  })

  it('reports a refusal instead of a success the host never made', async () => {
    // THE claim. A hand-off that reports "done" because the fetch resolved is
    // worse than one that says it could not: the reader closes the panel
    // believing a conversation is working on their item, and it is not.
    for (const value of [
      { ok: false, why: 'taskHasNoSession' },
      { ok: false, why: 'noLiveAgent' },
      { ok: 'maybe' },
      'a string',
      null,
    ]) {
      const { impl } = answering(value)
      const reply = await itemsAsk({ taskId: 'c', id: 'row-1', ref: 1 }, impl)
      expect(reply.ok).toBe(false)
    }
  })

  it('names the transport when the host is unreachable', async () => {
    const offline = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    const reply: AskReply = await itemsAsk({ taskId: 'c', id: 'row-1', ref: 1 }, offline)
    expect(reply.ok).toBe(false)
    if (reply.ok === false) expect(reply.why).toBe('offline')
  })

  it('never invents a session id the host did not send', async () => {
    // `ok: true` without one is a shape we do not recognise, and reading it as
    // a success would name "undefined" as the session in the receipt.
    const { impl } = answering({ ok: true, said: 'x' })
    const reply = await itemsAsk({ taskId: 'c', id: 'row-1', ref: 1 }, impl)
    expect(reply.ok).toBe(false)
  })

  it('reports a non-200 as the host refusing, not as a malformed answer', async () => {
    const { impl, calls } = answering({ ok: true, sessionId: 's', said: '' }, 403)
    const reply = await itemsAsk({ taskId: 'c', id: 'row-1', ref: 1 }, impl)
    expect(reply.ok).toBe(false)
    if (reply.ok === false) expect(reply.why).toContain('403')
    expect(calls).toHaveLength(1)
  })
})

describe('the host half: which conversation the text goes to', () => {
  it('hands a row that hangs off the named card to that card', async () => {
    const { ctx, service, said } = face([row({ id: 'i-1', ref: 1, taskId: 'card-a' })])
    const out = await handOneItemToItsCardSession(ctx, service, { taskId: 'card-a', ref: 1, id: 'i-1' })
    expect(out.ok).toBe(true)
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('s-a')
    expect(said[0]).toContain('一件要做的事')
  })

  it('REFUSES a body whose card and row disagree', async () => {
    // THE CLAIM. The two lookups are independent — `taskId` picks the card,
    // `id`/`ref` pick the row — and nothing compared them, so a request naming
    // card A with a row of card B delivered B's text into A's conversation.
    // On a board with a dozen cards that is not a crash; it is a wrong answer
    // inside a session the reader will trust, and no screen says so.
    const { ctx, service, said } = face([row({ id: 'i-other', ref: 9, taskId: 'card-z' })])
    const out = await handOneItemToItsCardSession(ctx, service, { taskId: 'card-a', ref: 9 })
    expect(out).toEqual({ ok: false, why: 'rowBelongsElsewhere' })
    expect(said, 'text was handed to a conversation the reader did not name').toEqual([])
  })

  it('says so when the card is gone, before it looks at the row at all', async () => {
    const { ctx, service, said } = face([row({ id: 'i-1', ref: 1, taskId: 'card-a' })])
    const out = await handOneItemToItsCardSession(ctx, service, { taskId: 'card-gone', ref: 1 })
    expect(out).toEqual({ ok: false, why: 'noSuchTask' })
    expect(said).toEqual([])
  })

  it('says so when the row is gone', async () => {
    const { ctx, service } = face([row({ id: 'i-1', ref: 1, taskId: 'card-a' })])
    expect(await handOneItemToItsCardSession(ctx, service, { taskId: 'card-a', ref: 404 })).toEqual({ ok: false, why: 'noSuchItem' })
  })

  it('says so when the card has nothing to talk to', async () => {
    const { ctx, service, said } = face([row({ id: 'i-1', ref: 1, taskId: 'card-a' })], null)
    const out = await handOneItemToItsCardSession(ctx, service, { taskId: 'card-a', ref: 1 })
    expect(out).toEqual({ ok: false, why: 'taskHasNoSession' })
    expect(said).toEqual([])
  })
})
