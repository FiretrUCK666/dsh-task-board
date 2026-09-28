/**
 * The hand-off: which session an item goes to, and what the reader is told.
 *
 * The judgment worth pinning is the TARGET. Everything else is plumbing, and
 * plumbing that works is invisible; a target chosen wrongly sends a person's
 * request to the wrong conversation, and nothing about that looks broken.
 */
import { describe, expect, it } from 'vitest'
import { itemsAsk, type AskReply } from '../src/client/board-ask.ts'

const ASK_URL = '/api/dsh-task-board/board/ask'

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
    const reply = await itemsAsk({ taskId: 'card-9', ref: 12 }, impl)
    // The route base hands the path to `document.baseURI`, which is why it goes
    // out WITHOUT its leading slash — asserting the slash would pin a detail
    // the browser is meant to own.
    expect(calls[0]?.url).toBe(ASK_URL.replace(/^\/+/, ''))
    expect(calls[0]?.body).toEqual({ taskId: 'card-9', ref: 12 })
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
      const reply = await itemsAsk({ taskId: 'c', ref: 1 }, impl)
      expect(reply.ok).toBe(false)
    }
  })

  it('names the transport when the host is unreachable', async () => {
    const offline = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    const reply: AskReply = await itemsAsk({ taskId: 'c', ref: 1 }, offline)
    expect(reply.ok).toBe(false)
    if (reply.ok === false) expect(reply.why).toBe('offline')
  })

  it('never invents a session id the host did not send', async () => {
    // `ok: true` without one is a shape we do not recognise, and reading it as
    // a success would name "undefined" as the session in the receipt.
    const { impl } = answering({ ok: true, said: 'x' })
    const reply = await itemsAsk({ taskId: 'c', ref: 1 }, impl)
    expect(reply.ok).toBe(false)
  })

  it('reports a non-200 as the host refusing, not as a malformed answer', async () => {
    const { impl, calls } = answering({ ok: true, sessionId: 's', said: '' }, 403)
    const reply = await itemsAsk({ taskId: 'c', ref: 1 }, impl)
    expect(reply.ok).toBe(false)
    if (reply.ok === false) expect(reply.why).toContain('403')
    expect(calls).toHaveLength(1)
  })
})
