/**
 * Route-backed settings scope for the task-board plugin's settings namespace.
 *
 * The plugin is standalone: it must not depend on a sibling settings-surface
 * package to bind its namespace scope. Instead this scope reads and writes the
 * namespace through the plugin's own host route (`/api/dsh-task-board/settings`),
 * mirroring the contract the SDK's `SettingsScope<T>` exposes so the card form
 * can consume it unchanged.
 *
 * Fetch failures degrade to an `unavailable` snapshot rather than throwing.
 * @module dsh-task-board/client/route-scope
 */

import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/** The JSON view the host settings route returns. */
export interface SettingsRouteView {
  available: boolean
  value?: unknown
  base?: unknown
  user?: unknown
  writable?: boolean
  revision?: number
}

/** The ok/error envelope the host settings route returns. */
export interface RouteOk {
  ok: true
  value: SettingsRouteView
}
export interface RouteFail {
  ok: false
  error: { code: string; message: string }
}
export type RouteEnvelope = RouteOk | RouteFail

/** One path edit sent to the route's POST handler. */
export type SettingsRouteOp =
  | { op: 'set'; path: string[]; value?: unknown }
  | { op: 'unset'; path: string[]; value?: never }

/** Build an `unavailable` snapshot. */
function unavailableSnapshot<T>(): SettingsScopeSnapshot<T> {
  return { status: 'unavailable', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'memory' }
}

/** Translate a route view into a client scope snapshot. */
function toSnapshot<T>(view: SettingsRouteView | undefined): SettingsScopeSnapshot<T> {
  if (view === undefined || !view.available) return unavailableSnapshot<T>()
  return {
    status: 'ready',
    value: view.value as T | undefined,
    base: view.base,
    user: view.user,
    revision: view.revision,
    writable: view.writable ?? false,
    mode: 'host',
  }
}

/**
 * A reactive settings scope backed by the plugin's host route. It mirrors the
 * shape of `SettingsScope<T>` (getSnapshot/subscribe/set/unset/dispose) so the
 * card form and fixture-free tests can treat it as a drop-in.
 */
export class RouteSettingsScope<T> {
  private snapshot: SettingsScopeSnapshot<T> = { status: 'loading', value: undefined, base: undefined, user: undefined, revision: undefined, writable: false, mode: 'host' }
  private readonly listeners = new Set<() => void>()
  private disposed = false

  /**
   * @param namespace - the settings namespace this scope reads (route path tail).
   */
  constructor(private readonly namespace: string) {
    void this.load()
  }

  /** @returns the current snapshot (stable reference until the next change). */
  getSnapshot(): SettingsScopeSnapshot<T> {
    return this.snapshot
  }

  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Queue one field write through the route and adopt the returned fresh view.
   * The write carries the latest known namespace revision for stale-write
   * fencing, matching the SDK scope's revision contract.
   * @param field - scalar field inside the namespace section.
   * @param value - JSON-shaped value selected by the user.
   */
  async set(field: string, value: unknown): Promise<void> {
    await this.mutate([{ op: 'set', path: [field], value }], this.snapshot.revision)
  }

  /**
   * Queue one field clear so it re-inherits the composition layer.
   * @param field - scalar field inside the namespace section.
   */
  async unset(field: string): Promise<void> {
    await this.mutate([{ op: 'unset', path: [field] }], this.snapshot.revision)
  }

  /** Stop all listeners and drops further updates. */
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  /** Fetch the namespace view through the route and adopt it. */
  private async load(): Promise<void> {
    try {
      const response = await fetch(`/api/${this.namespace}/settings`)
      if (!response.ok) {
        this.settle(unavailableSnapshot<T>())
        return
      }
      const envelope = await response.json() as RouteEnvelope
      this.settle(toSnapshot<T>(envelope.ok ? envelope.value : undefined))
    } catch {
      this.settle(unavailableSnapshot<T>())
    }
  }

  /** Send path ops through the route and adopt the returned fresh view. */
  private async mutate(ops: SettingsRouteOp[], expectedRevision?: number): Promise<void> {
    try {
      const response = await fetch(`/api/${this.namespace}/settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(expectedRevision === undefined ? { ops } : { ops, expectedRevision }),
      })
      if (!response.ok) {
        this.settle(unavailableSnapshot<T>())
        return
      }
      const envelope = await response.json() as RouteEnvelope
      this.settle(toSnapshot<T>(envelope.ok ? envelope.value : undefined))
    } catch {
      this.settle(unavailableSnapshot<T>())
    }
  }

  /** Adopt a new snapshot and notify subscribers. */
  private settle(next: SettingsScopeSnapshot<T>): void {
    if (this.disposed) return
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}
