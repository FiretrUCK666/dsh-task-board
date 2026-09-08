/**
 * Native-activity wake channel: the 0.1.5 replacement for the dead mux
 * `session/event` fan-out.
 *
 * The host emits `api-session/activity(sessionId, updatedAt)` for every
 * durable user-authored message (gated on `user/message` with
 * `source.kind === 'user'`), and the session list projects it onto the
 * row's `updatedAt`. The event carries no text and no seq anchor, so it is
 * only a WAKE signal: the controller records the stamp, and the next
 * reconcile pass reads the transcript tail for the text + anchor (the same
 * write path, anchor-deduped, engine-gated).
 *
 * Two listeners, one input: hosts that serve `remote.$on` deliver the
 * event directly; every host (old or new) also moves the list snapshot,
 * so a `sessions.list` subscription watching `updatedAt` advances covers
 * the channel even where `$on` is absent. Both feed the same callback and
 * share one disposer. Framework-free except for the structural context
 * face; pure enough to unit-test with fakes.
 */

/** The structural slice of the remote service the wake subscribes through. */
export interface WakeRemoteFace {
  $on(event: string, listener: (...args: never[]) => unknown): () => void
}

/** The structural slice of the sessions list the wake polls through. The
 *  row only needs the activity stamp — it stays assignable from the full
 *  session-list snapshot (structural widening, never a cast). */
export interface WakeSessionsFace {
  list: {
    getSnapshot(): {
      byId: Readonly<Record<string, { readonly updatedAt?: unknown } | undefined>>
    }
    subscribe(fn: () => void): () => void
  }
}
/** The structural slice of the client context the wake reads. */
export interface WakeContextFace {
  get<T = unknown>(name: string): T | undefined
  sessions: WakeSessionsFace
}

/** The official wake event name (host → client, per user message). */
export const ACTIVITY_EVENT = 'api-session/activity'

/** Read a numeric stamp from an unknown row field (absent/garbage = undefined). */
export function stampOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Subscribe to the native-activity wake channel. Every wake calls
 * `onWake(sessionId, stamp)`; the controller owns dedup + engine gating +
 * the tail read. @returns the shared disposer.
 */
export function watchSessionActivity(
  ctx: WakeContextFace,
  onWake: (sessionId: string, stamp: number) => void,
): () => void {
  const disposers: Array<() => void> = []
  // Channel 1 — the direct event, where the host serves remote.$on.
  try {
    const remote = ctx.get<WakeRemoteFace>('remote')
    const subscribe = remote?.$on
    if (typeof subscribe === 'function') {
      disposers.push(subscribe.call(remote, ACTIVITY_EVENT, ((sessionId: unknown, updatedAt: unknown) => {
        if (typeof sessionId !== 'string' || sessionId === '') return
        const stamp = stampOf(updatedAt)
        if (stamp === undefined) return
        onWake(sessionId, stamp)
      }) as (...args: never[]) => unknown))
    }
  } catch {
    // A throwing $on must never take the board down — the list poll below
    // still covers the channel.
  }
  // Channel 2 — the list projection: every host moves `updatedAt` on the
  // same gate, so a stamp advance with no other change is the same wake.
  const seen = new Map<string, number>()
  let primed = false
  const poll = (): void => {
    let byId: Readonly<Record<string, { readonly updatedAt?: unknown } | undefined>>
    try {
      byId = ctx.sessions.list.getSnapshot().byId
    } catch {
      return
    }
    if (!primed) {
      primed = true
      for (const [id, row] of Object.entries(byId)) {
        const stamp = stampOf(row?.updatedAt)
        if (stamp !== undefined) seen.set(id, stamp)
      }
      return
    }
    for (const [id, row] of Object.entries(byId)) {
      const stamp = stampOf(row?.updatedAt)
      if (stamp === undefined) continue
      const previous = seen.get(id)
      seen.set(id, stamp)
      if (previous !== undefined && stamp > previous) onWake(id, stamp)
    }
  }
  try {
    disposers.push(ctx.sessions.list.subscribe(poll))
  } catch {
    // A list that refuses subscription degrades to the direct event alone.
  }
  poll()
  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // Disposers must never throw during teardown.
      }
    }
  }
}
