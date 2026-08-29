/**
 * The board document: the ONE host-owned truth every browser replica syncs
 * against — the task ledger plus the board's shared state sections (cruise,
 * schedule presets, run presets) — and the merge grammar that makes
 * concurrent multi-device edits converge deterministically.
 *
 * Sync model (host = authority, browsers = optimistic replicas):
 * - A client commits its whole local view: the full tasks array, the section
 *   values, and the deletions it observed since its last synced baseline
 *   (each delete carries the `updatedAt` the client saw, so the host can tell
 *   a delete from a stale copy).
 * - The host resolves record by record — last-writer-wins on the record's own
 *   `updatedAt`, tombstones suppressing deletes that a stale replica would
 *   otherwise resurrect — and section by section (LWW on the section write
 *   stamp), then returns the authoritative document. Every replica converges
 *   on that response, so drift is impossible without compare-and-swap.
 * - `revision` is the host's monotonic change counter (the SSE resync signal
 *   and the "did anything actually move" test), never a write gate.
 *
 * Clock-skew rule: a tombstone is stamped one millisecond above the newest
 * `updatedAt` the host ever saw for that id, so a delete always beats the
 * stale copies other replicas still hold, while a genuinely newer edit (a
 * concurrent revive) still wins.
 *
 * Framework-free pure logic: host and client share this one grammar; tests
 * drive it directly.
 */
import { isCruiseWindow, normalizeWindow, sortWindows } from './cruise.ts'
import type { CruiseWindow } from './cruise.ts'
import { normalizeRunPresetDocument } from './run-presets.ts'
import type { RunPresetsDocument } from './run-presets.ts'
import { parseLedger } from './store.ts'
import type { TaskRecord } from './tasks.ts'
import { parsePresets } from './presets.ts'
import type { SchedulePreset } from './presets.ts'

/** The cruise section value (structurally the controller's CruiseState). */
export interface CruiseValue {
  enabled: boolean
  manual?: boolean
  limit: number
  schedule: CruiseWindow[]
}

/** One synced section: the value plus the client write stamp (LWW key). */
export interface BoardSection<T> {
  value: T
  at: number
}

/** The deletions a client observed since its baseline, with the stamp each
 *  delete was computed against. */
export interface BoardDelete {
  id: string
  baseUpdatedAt: number
}

/** One relayed user action: run this task with this trigger (the engine
 *  executes; a non-engine replica forwards the request through the host). */
export interface BoardCommand {
  type: 'run'
  taskId: string
  trigger: 'manual' | 'schedule' | 'chain'
  /** The replica the user acted on (informational; the engine executes). */
  clientId: string
}

/** Everything an SSE subscriber receives; plain JSON, one line per frame. */
export type BoardEvent =
  | { type: 'commit'; revision: number; clientId: string }
  | { type: 'lease'; holder: string | undefined; expiresAt: number | undefined }
  | { type: 'command'; command: BoardCommand }

/** The engine-lease state every board API call answers with. */
export interface LeaseState {
  held: boolean
  holder: string | undefined
  expiresAt: number | undefined
}

/** One tombstone: the logical stamp a newer edit must beat, plus the host
 *  wall time it was written (pruning key). */
export interface Tombstone {
  at: number
  seenAt: number
}

/** The full authoritative document the host owns and persists. */
export interface BoardDoc {
  /** Host monotonic change counter. */
  revision: number
  /** The task ledger (normalized rows). */
  tasks: TaskRecord[]
  /** Auto-cruise state (shared: every replica sees the same switch/limit/windows). */
  cruise: BoardSection<CruiseValue>
  /** User schedule presets (the built-in list is never stored). */
  schedulePresets: BoardSection<SchedulePreset[]>
  /** Run-config presets document (custom rows + default id). */
  runPresets: BoardSection<RunPresetsDocument>
  /** taskId → tombstone; suppresses stale replicas resurrecting a delete. */
  tombstones: Record<string, Tombstone>
  /** When the host first created the document (migration probe). */
  bornAt: number
}

/** What a client sends per commit: its full view + observed deletions. */
export interface BoardCommit {
  clientId: string
  tasks: readonly TaskRecord[]
  deleted: readonly BoardDelete[]
  cruise: BoardSection<CruiseValue>
  schedulePresets: BoardSection<SchedulePreset[]>
  runPresets: BoardSection<RunPresetsDocument>
}

/** Tombstones older than this are pruned (a delete this old cannot still be
 *  contested by a realistic offline replica). */
export const TOMBSTONE_TTL_MS = 30 * 86_400_000

/** The default cruise section value of a never-written board. */
export const DEFAULT_CRUISE_VALUE: CruiseValue = { enabled: false, limit: 5, schedule: [] }

/** A fresh empty document (host first boot; revision 0 marks "never committed"). */
export function emptyBoardDoc(now: number): BoardDoc {
  return {
    revision: 0,
    tasks: [],
    cruise: { value: DEFAULT_CRUISE_VALUE, at: now },
    schedulePresets: { value: [], at: now },
    runPresets: { value: { presets: [] }, at: now },
    tombstones: {},
    bornAt: now,
  }
}

/** Normalize an unknown cruise value (the controller constructor's grammar,
 *  shared so host and client judge persisted cruise state identically). */
export function normalizeCruiseValue(value: unknown): CruiseValue {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_CRUISE_VALUE }
  const row = value as Record<string, unknown>
  const limit = typeof row.limit === 'number' && Number.isInteger(row.limit) && row.limit >= 1 ? row.limit : DEFAULT_CRUISE_VALUE.limit
  return {
    enabled: row.enabled === true,
    ...(row.manual === true || row.manual === false ? { manual: row.manual } : {}),
    limit,
    schedule: Array.isArray(row.schedule)
      ? sortWindows((row.schedule as unknown[]).filter(isCruiseWindow).map(normalizeWindow))
      : [],
  }
}

/** Normalize an unknown section carrying a value + write stamp. */
function normalizeSection<T>(value: unknown, at: number, fallback: T, clean: (raw: unknown) => T): BoardSection<T> {
  if (typeof value !== 'object' || value === null) return { value: fallback, at }
  const row = value as Record<string, unknown>
  const stamp = typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : at
  return { value: clean(row.value), at: stamp }
}

/** Normalize an unknown persisted document (the medium's word is data, not
 *  truth: every part degrades to its empty shape rather than failing the doc).
 *  @param value - the raw medium/global value.
 *  @param now - clock for the empty/fresh fallbacks (host passes its injected
 *    clock so a first-boot document carries a deterministic birth time). */
export function normalizeBoardDoc(value: unknown, now: number = Date.now()): BoardDoc {
  if (typeof value !== 'object' || value === null) return emptyBoardDoc(now)
  const row = value as Record<string, unknown>
  const revision = typeof row.revision === 'number' && Number.isFinite(row.revision) && row.revision >= 0 ? Math.floor(row.revision) : 0
  const bornAt = typeof row.bornAt === 'number' && Number.isFinite(row.bornAt) ? row.bornAt : now
  const tasks = Array.isArray(row.tasks) ? parseLedger(JSON.stringify(row.tasks)) : []
  const tombstones: Record<string, Tombstone> = {}
  if (typeof row.tombstones === 'object' && row.tombstones !== null) {
    for (const [id, entry] of Object.entries(row.tombstones as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) continue
      const t = entry as Record<string, unknown>
      if (typeof t.at !== 'number' || !Number.isFinite(t.at)) continue
      tombstones[id] = { at: t.at, seenAt: typeof t.seenAt === 'number' && Number.isFinite(t.seenAt) ? t.seenAt : bornAt }
    }
  }
  const empty = emptyBoardDoc(bornAt)
  return {
    revision,
    tasks,
    cruise: normalizeSection(row.cruise, empty.cruise.at, DEFAULT_CRUISE_VALUE, normalizeCruiseValue),
    schedulePresets: normalizeSection(row.schedulePresets, empty.schedulePresets.at, [], parsePresetsRaw),
    runPresets: normalizeSection(row.runPresets, empty.runPresets.at, { presets: [] }, normalizeRunPresetDocument),
    tombstones,
    bornAt,
  }
}

/** Presets arrive as a raw JSON array (the persisted shape); parsePresets
 *  works on the JSON text, so round-trip through it for one grammar. */
function parsePresetsRaw(raw: unknown): SchedulePreset[] {
  if (!Array.isArray(raw)) return []
  return parsePresets(JSON.stringify(raw))
}

/** The deletions between a synced baseline and the client's next array:
 *  ids the baseline had and the next view dropped (a locally created-then-
 *  deleted task never entered the baseline, so it produces no delete). */
export function diffDeletions(
  baseline: readonly TaskRecord[],
  next: readonly TaskRecord[],
): BoardDelete[] {
  const kept = new Set(next.map(task => task.id))
  const deleted: BoardDelete[] = []
  for (const task of baseline) {
    if (!kept.has(task.id)) deleted.push({ id: task.id, baseUpdatedAt: task.updatedAt })
  }
  return deleted
}

/** Structural equality of two documents (the "did anything move" test that
 *  keeps a no-op commit from bumping the revision and storming replicas). */
export function sameBoardDocs(a: BoardDoc, b: BoardDoc): boolean {
  return JSON.stringify({ t: a.tasks, c: a.cruise, p: a.schedulePresets, r: a.runPresets, x: a.tombstones })
    === JSON.stringify({ t: b.tasks, c: b.cruise, p: b.schedulePresets, r: b.runPresets, x: b.tombstones })
}

/**
 * Apply one client commit to the authoritative document and return the new
 * truth (the input is never mutated). The merge is the whole sync contract:
 *
 * - put: a record the host lacks is inserted unless a tombstone outranks it
 *   (then the delete stands); a record the host has is replaced only when the
 *   incoming copy is strictly newer (`updatedAt` LWW, host wins ties).
 * - delete: honored only when the host copy is not newer than the baseline
 *   stamp the delete was computed against; the tombstone lands one ms above
 *   the newest `updatedAt` ever seen for the id (skew-proof).
 * - sections: replaced when the incoming write stamp is >= the stored one
 *   (host order decides ties — the later commit wins, deterministically).
 * - unchanged result → the same document object (no revision bump, no
 *   persist, no broadcast).
 */
export function applyCommit(doc: BoardDoc, commit: BoardCommit, now: number): BoardDoc {
  const byId = new Map(doc.tasks.map(task => [task.id, task]))
  const tombstones = { ...doc.tombstones }
  const result = new Map(byId)

  // 1) puts — the client's full array (absence is NOT a delete; deletes are
  // the explicit list below, so remote rows the client never saw survive).
  for (const task of commit.tasks) {
    const incoming = normalizeIncomingTask(task)
    if (incoming === undefined) continue
    const host = result.get(incoming.id)
    if (host === undefined) {
      const tomb = tombstones[incoming.id]
      if (tomb !== undefined && incoming.updatedAt <= tomb.at) continue
      delete tombstones[incoming.id]
      result.set(incoming.id, incoming)
    } else if (incoming.updatedAt > host.updatedAt) {
      result.set(incoming.id, incoming)
    }
  }

  // 2) deletes — honored against the host copy's freshness.
  for (const del of commit.deleted) {
    const host = result.get(del.id)
    if (host === undefined) {
      // Already gone (another replica deleted it): keep the existing tombstone.
      continue
    }
    if (host.updatedAt > del.baseUpdatedAt) continue // edited after the client's baseline → the delete loses
    const newest = Math.max(host.updatedAt, ...commit.tasks.filter(task => task.id === del.id).map(task => task.updatedAt), 0)
    result.delete(del.id)
    tombstones[del.id] = { at: newest + 1, seenAt: now }
  }

  // 3) prune ancient tombstones.
  for (const [id, tomb] of Object.entries(tombstones)) {
    if (now - tomb.seenAt > TOMBSTONE_TTL_MS && !result.has(id)) delete tombstones[id]
  }

  const tasks = doc.tasks
    .filter(task => result.has(task.id))
    .map(task => result.get(task.id)!)
  // Host rows keep their order; client rows the host lacked append at the end
  // (their `order` field carries the real column position).
  const seen = new Set(doc.tasks.map(task => task.id))
  for (const task of commit.tasks) {
    const merged = result.get(task.id)
    if (merged !== undefined && !seen.has(task.id)) {
      tasks.push(merged)
      seen.add(task.id)
    }
  }

  const next: BoardDoc = {
    revision: doc.revision + 1,
    tasks,
    cruise: mergeSection(doc.cruise, commit.cruise, normalizeCruiseValue),
    schedulePresets: mergeSection(doc.schedulePresets, commit.schedulePresets, parsePresetsRaw),
    runPresets: mergeSection(doc.runPresets, commit.runPresets, normalizeRunPresetDocument),
    tombstones,
    bornAt: doc.bornAt,
  }
  return sameBoardDocs(doc, next) ? doc : { ...next, revision: doc.revision + 1 }
}

/** Section LWW: the incoming write wins on >= (host-serialized arrival order
 *  decides equal stamps, so the later commit converges every replica). */
function mergeSection<T>(stored: BoardSection<T>, incoming: BoardSection<T>, clean: (raw: unknown) => T): BoardSection<T> {
  const at = typeof incoming.at === 'number' && Number.isFinite(incoming.at) ? incoming.at : 0
  if (at < stored.at) return stored
  return { value: clean(incoming.value), at }
}

/** One incoming task row, normalized through the persisted-ledger grammar
 *  (the host never trusts a replica's shape); undefined when unusable. */
function normalizeIncomingTask(task: TaskRecord): TaskRecord | undefined {
  const [row] = parseLedger(JSON.stringify([task]))
  return row
}

/** The client view of a document (what a replica feeds its stores/sections). */
export interface BoardView {
  tasks: TaskRecord[]
  cruise: CruiseValue
  schedulePresets: SchedulePreset[]
  runPresets: RunPresetsDocument
}

export function boardViewOf(doc: BoardDoc): BoardView {
  return {
    tasks: doc.tasks,
    cruise: doc.cruise.value,
    schedulePresets: doc.schedulePresets.value,
    runPresets: doc.runPresets.value,
  }
}
