/**
 * Pure tests for the update-source route processor
 * (`createUpdateHandler`) with faked read deps and fake HTTP req/res pairs.
 * Covers the view pass-through, read failures, and non-GET methods.
 */

import { describe, expect, it } from 'vitest'
import { createUpdateHandler, type UpdateRouteDeps, type UpdateSourceView } from '../src/host/update-route.ts'

/** A fake response capturing the written status and body. */
function fakeRes(): import('node:http').ServerResponse & { state: { status: number; body: string } } {
  const state = { status: 200, body: '' }
  return {
    state,
    writeHead(status: number) { state.status = status },
    end(payload: string) { state.body = payload },
  } as unknown as import('node:http').ServerResponse & { state: { status: number; body: string } }
}

/** A fake request (the update route only reads the method). */
function fakeReq(method: string): import('node:http').IncomingMessage {
  return { method, headers: {} } as unknown as import('node:http').IncomingMessage
}

const VIEW: UpdateSourceView = {
  packageName: '@firetruck666/dsh-task-board',
  version: '0.2.81',
  spec: 'link:/repo',
  mode: 'local',
  githubSpec: 'github:FiretrUCK666/dsh-task-board',
  git: { head: 'aaa', remoteHead: 'bbb', dirty: false },
}

describe('createUpdateHandler', () => {
  it('GET serves the update-source view untouched', async () => {
    const deps: UpdateRouteDeps = { read: () => VIEW }
    const res = fakeRes()
    await createUpdateHandler(deps)(fakeReq('GET'), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(true)
    expect(envelope.value).toEqual(VIEW)
  })

  it('a throwing read lands in the error envelope (HTTP 200)', async () => {
    const deps: UpdateRouteDeps = {
      read: () => { throw new Error('manifest unreadable') },
    }
    const res = fakeRes()
    await createUpdateHandler(deps)(fakeReq('GET'), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('update')
  })

  it('non-GET methods are refused with 405', async () => {
    const deps: UpdateRouteDeps = { read: () => VIEW }
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = fakeRes()
      await createUpdateHandler(deps)(fakeReq(method), res)
      expect(res.state.status).toBe(405)
    }
  })
})
