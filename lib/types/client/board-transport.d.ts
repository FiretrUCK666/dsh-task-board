/**
 * Browser transport for the board sync client: the four board-route calls
 * over fetch, and the SSE change stream over EventSource. Every failure
 * degrades to `undefined` (the sync client treats it as "host unreachable"
 * and keeps the last known truth), so a dropped packet or a proxy hiccup can
 * never take the board down — the poll + EventSource auto-reconnect recover.
 */
import type { BoardSyncTransport } from '../core/host-sync.ts';
/**
 * Build the transport. `EventSource` is feature-detected: an environment
 * without it (an exotic WebView) still converges through the poll loop, just
 * with higher latency.
 *
 * Every request is time-bounded (`timeoutMs`, default 15s): a hanging socket
 * (dead tunnel, half-open proxy) must resolve to `undefined` like any other
 * failure — an unsettled boot fetch holds `sync.start()` forever, and the
 * sidebar entry never binds, which is exactly the mobile "点了没反应、进不去".
 * A timeout is a failure like any other: the sync client falls back and the
 * poll/EventSource loop recovers when the line is back.
 */
export declare function createBoardTransport(options?: {
    timeoutMs?: number;
}): BoardSyncTransport;
