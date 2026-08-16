/**
 * Pure tests for the permission-catalog route processor
 * (`createPermissionHandler`) with faked read deps and fake HTTP req/res
 * pairs. Covers GET with a composed permission service, GET without one,
 * read failures, and non-GET methods.
 */

import { describe, expect, it } from 'vitest'
import { createPermissionHandler, type PermissionCatalogView, type PermissionRouteDeps } from '../src/host/permission-route.ts'

/** A fake response capturing the written status and body. */
function fakeRes(): import('node:http').ServerResponse & { state: { status: number; body: string } } {
  const state = { status: 200, body: '' }
  return {
    state,
    writeHead(status: number) { state.status = status },
    end(payload: string) { state.body = payload },
  } as unknown as import('node:http').ServerResponse & { state: { status: number; body: string } }
}

/** A fake request stream (the permission route only reads method + headers). */
function fakeReq(method: string): import('node:http').IncomingMessage {
  return { method, headers: {} } as unknown as import('node:http').IncomingMessage
}

/** A fake deps face returning a fixed catalog view. */
function fakeDeps(view: PermissionCatalogView | undefined | (() => PermissionCatalogView)): PermissionRouteDeps {
  const read = typeof view === 'function'
    ? view as () => PermissionCatalogView
    : () => view
  return { read }
}

describe('createPermissionHandler', () => {
  it('GET returns the native permission options when the service is composed', async () => {
    const deps = fakeDeps({
      available: true,
      options: [
        { id: 'read-only', name: 'read-only', description: 'Read access only.' },
        { id: 'workspace-write', name: 'workspace-write', description: 'Write inside the workspace.' },
        { id: 'danger-full-access', name: 'danger-full-access', description: 'Full file access.' },
      ],
    })
    const handler = createPermissionHandler(deps)
    const res = fakeRes()
    await handler(fakeReq('GET'), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(true)
    expect(envelope.value.available).toBe(true)
    expect(envelope.value.options).toEqual([
      { id: 'read-only', name: 'read-only', description: 'Read access only.' },
      { id: 'workspace-write', name: 'workspace-write', description: 'Write inside the workspace.' },
      { id: 'danger-full-access', name: 'danger-full-access', description: 'Full file access.' },
    ])
  })

  it('GET reports available:false when no permission service is composed', async () => {
    const handler = createPermissionHandler(fakeDeps(undefined))
    const res = fakeRes()
    await handler(fakeReq('GET'), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(true)
    expect(envelope.value).toEqual({ available: false })
  })

  it('GET reports available:false when the read face itself returns an unavailable view', async () => {
    const handler = createPermissionHandler(fakeDeps({ available: false }))
    const res = fakeRes()
    await handler(fakeReq('GET'), res)
    expect(JSON.parse(res.state.body).value).toEqual({ available: false })
  })

  it('wraps a failing catalog read in the {ok:false} envelope instead of crashing', async () => {
    const handler = createPermissionHandler(fakeDeps(() => { throw new Error('preset table exploded') }))
    const res = fakeRes()
    await handler(fakeReq('GET'), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('permissions')
    expect(envelope.error.message).toContain('preset table exploded')
  })

  it('answers 405 for non-GET methods', async () => {
    const handler = createPermissionHandler(fakeDeps({ available: true, options: [] }))
    const res = fakeRes()
    await handler(fakeReq('POST'), res)
    expect(res.state.status).toBe(405)
  })
})
