/**
 * The session panel's permission row (client/board/session-panel.tsx + the live
 * projection read that feeds it).
 *
 * The reported bug: a user picked a permission in the session panel and the
 * select kept reading 「默认（会话默认权限）」. Two independent causes, both
 * pinned here so neither can come back:
 *
 *  1. THE WRONG SOURCE. The panel read the `permissions` block riding the
 *     transcript's HISTORY PAGE. `/permission` never opens a turn, so no new
 *     event ever appears and that copy stayed frozen at whatever the page was
 *     written with. The live read (`session/projections`) is the only source
 *     allowed to display a current fact.
 *  2. A SECOND TRUTH. The select also kept a component-local `chosen` copy
 *     "until the projection confirms it", arbitrated by an effect that read a
 *     projection value of `''` as "no information" — conflating 「会话就是默认
 *     权限」 with 「没读到」. That copy died on remount, so the two sources
 *     disagreed in whichever direction the timing happened to favour.
 *  3. THE PHANTOM OPTION. 「默认（会话默认权限）」 carried the value `''`, and
 *     applying `''` was a no-op, so choosing it silently did nothing. A session
 *     always HAS a permission and `/permission` has no "unset" verb, so the
 *     option was removed from the live select rather than fixed.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const panel = readFileSync(fileURLToPath(new URL('../src/client/board/session-panel.tsx', import.meta.url)), 'utf8')
const projections = readFileSync(fileURLToPath(new URL('../src/core/projections.ts', import.meta.url)), 'utf8')
const client = readFileSync(fileURLToPath(new URL('../src/client/index.ts', import.meta.url)), 'utf8')

describe('the permission row reads ONE live source', () => {
  it('the value comes from the live projection read, not the transcript', () => {
    // The panel asks the controller; the controller asks the host's live
    // baseline. No prop, no second copy.
    expect(panel).toContain('sessionConfig.readPermission(sessionId)')
    expect(panel).not.toMatch(/permissionValue|permissionOptions/)
    // The optimistic local copy and its arbitration effect are both gone: with
    // one live read there is nothing to arbitrate between.
    expect(panel).not.toMatch(/setChosen/)
    // No "the projection disagrees with my local copy, so drop mine" effect.
    expect(panel).not.toMatch(/permissionValue !== chosen/)
    // And the rail head no longer maps a per-session setting out of the
    // page-scoped projections.
    expect(panel).not.toContain('livePermission')
  })

  it('the history page no longer carries the permission at all', () => {
    expect(projections).not.toMatch(/projections\.permissions\s*=/)
    expect(projections).toMatch(/NOT lifted here/)
  })

  it('the live read is a real host call, guarded like its siblings', () => {
    expect(client).toContain('readPermission: async sessionId =>')
    expect(client).toContain('api.sessions.projections')
  })
})

describe('the live select offers exactly what the session has', () => {
  it('there is no empty-value option: there is no "unset permission"', () => {
    // The select's options are the host's own; a session always has one.
    expect(panel).not.toMatch(/<option value="">\{t\('new\.permissionDefault'\)\}<\/option>/)
    // The run-config form keeps its 默认, where it genuinely means "do not
    // write a preset for the next run" — a different fact, in a different place.
    const runConfig = readFileSync(fileURLToPath(new URL('../src/client/board/RunConfigEditor.tsx', import.meta.url)), 'utf8')
    expect(runConfig).toContain(`t('new.permissionDefault')`)
  })

  it('an unreadable permission says so instead of showing a fabricated default', () => {
    expect(panel).toContain(`t('review.permissionUnreadable')`)
  })
})
